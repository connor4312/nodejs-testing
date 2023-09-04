import * as inspector from "node:inspector";
import { beforeEach } from "node:test";
import { isMainThread } from "node:worker_threads";
import { parse } from "stacktrace-parser";

const stackObj = { stack: "" };

if (isMainThread) {
  if (!inspector.url()) {
    inspector.open(0, undefined, true);
  } else {
    if (process.env.NODE_OPTIONS?.includes("--inspect-publish-uid=http")) {
      process.stderr.write(`Debugger listening on ${inspector.url()}\n`);
    }
    inspector.waitForDebugger();
  }
}

const ogStdoutWrite = process.stdout.write;
beforeEach((context) => {
  ogStdoutWrite.call(process.stdout, `# Starting test: ${context.name}\n`);
});

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
        chunk = `# Log: ${JSON.stringify({
          chunk: chunk.toString(),
          sf: stack[firstNotInternal],
        })}\n`;
      }

      return ogWrite.call(this, chunk, encoding, callback);
    },
  });
}
