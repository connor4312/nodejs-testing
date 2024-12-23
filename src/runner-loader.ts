import * as inspector from "node:inspector";
import type { TestEvent } from "node:test/reporters";
import { isatty } from "node:tty";
import { isMainThread } from "node:worker_threads";
import {
  format as prettyFormat,
  plugins as prettyFormatPlugins,
  type PrettyFormatOptions,
} from "pretty-format";
import { parse } from "stacktrace-parser";
import { nodeSnapshotImpl } from "./constants";
import type { JsonFromReporter } from "./runner-protocol";

// Default options borrowed from jest-diff:
// https://github.com/jestjs/jest/blob/442c7f692e3a92f14a2fb56c1737b26fc663a0ef/packages/jest-diff/src/index.ts#L33
const {
  AsymmetricMatcher,
  DOMCollection,
  DOMElement,
  Immutable,
  ReactElement,
  ReactTestComponent,
} = prettyFormatPlugins;

const PLUGINS = [
  ReactTestComponent,
  ReactElement,
  DOMElement,
  DOMCollection,
  Immutable,
  AsymmetricMatcher,
];
const FORMAT_OPTIONS: PrettyFormatOptions = {
  plugins: PLUGINS,
};
const FALLBACK_FORMAT_OPTIONS = {
  callToJSON: false,
  maxDepth: 10,
  plugins: PLUGINS,
};

const stackObj = { stack: "" };
const stdoutWrite = process.stdout.write;

if (isMainThread && !isatty(0)) {
  if (!inspector.url()) {
    inspector.open(0, undefined, true);
  } else {
    if (process.env.NODE_OPTIONS?.includes("--inspect-publish-uid=http")) {
      process.stderr.write(`Debugger listening on ${inspector.url()}\n`);
    }
    inspector.waitForDebugger();
  }
}

// Kinda delicate thing to separate test tap output from output logged by tests.
// Node.js doesn't know about output that happens when running tests, so we put
// them in tap comments and include their location.
for (const channel of ["stderr", "stdout"] as const) {
  const ogWrite = process[channel].write;
  Object.assign(process[channel], {
    write(chunk: any, encoding: any, callback: any) {
      Error.captureStackTrace(stackObj);
      const stack = parse(stackObj.stack);

      const firstNotInternal = stack.findIndex(
        (s, i) => i > 0 && s.file?.startsWith("node:") === false,
      );
      const atTestRunner = stack.findIndex((s) => s.file?.includes("node:internal/test_runner"));

      // Treat this as a user log if there's an not `node:` internal log before
      // the first (if any) location from `node:internal/test_runner`
      if (firstNotInternal !== -1 && (atTestRunner === -1 || firstNotInternal < atTestRunner)) {
        chunk =
          JSON.stringify({
            type: "runner:log",
            chunk: chunk.toString(),
            sf: stack[firstNotInternal],
          } satisfies JsonFromReporter) + "\n";
      }

      return ogWrite.call(this, chunk, encoding, callback);
    },
  });
}

function isSnapshotMissingError(err: any): err is Error & {
  snapshot: string;
  filename: string;
} {
  // https://github.com/nodejs/node/blob/0547dcfc005ae7d9b60d31a7edc90f5a180f907a/lib/internal/test_runner/snapshot.js#L70-L75
  return (
    err &&
    typeof err === "object" &&
    err.code === "ERR_INVALID_STATE" &&
    err.cause?.code === "ENOENT"
  );
}

function formatSnapValue(s: string) {
  // snapshot's serializer adds a newline at the start and end of the string,
  // so remove that for better diffing
  return typeof s === "string" && s.startsWith("\n") && s.endsWith("\n") ? s.slice(1, -1) : s;
}

module.exports = async function* reporter(source: AsyncGenerator<TestEvent>) {
  for await (const evt of source) {
    if (evt.type === "test:fail") {
      const err = evt.data.details.error as Error & { cause?: any };
      if (err.cause instanceof Error) {
        (err.cause as any)._message = err.cause.message;
        (err.cause as any)._stack = err.cause.stack ? parse(err.cause.stack) : undefined;
      }

      if (isSnapshotMissingError(err.cause)) {
        (err.cause as any)._isNodeSnapshotError = true;
      }

      if (err.cause?.hasOwnProperty("expected") && err.cause?.hasOwnProperty("actual")) {
        // snapshot always compares as strings, so don't do extra formatting
        const isSnap = err.cause?.stack?.includes(nodeSnapshotImpl);
        let actual = isSnap
          ? formatSnapValue(err.cause.actual)
          : prettyFormat(err.cause.actual, FORMAT_OPTIONS);
        let expected = isSnap
          ? formatSnapValue(err.cause.expected)
          : prettyFormat(err.cause.expected, FORMAT_OPTIONS);
        if (actual === expected) {
          actual = prettyFormat(err.cause.actual, FALLBACK_FORMAT_OPTIONS);
          expected = prettyFormat(err.cause.expected, FALLBACK_FORMAT_OPTIONS);
        }
        err.cause.actual = actual;
        err.cause.expected = expected;
      }
    }

    stdoutWrite.call(process.stdout, JSON.stringify(evt) + "\n");
  }
};
