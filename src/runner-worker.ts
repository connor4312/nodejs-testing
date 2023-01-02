import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import { spawn } from "child_process";
import { connect } from "net";
import { dirname } from "path";
import { parse as parseStackTrace } from "stacktrace-parser";
import { Parser, Result as TapResult } from "tap-parser";
import { CompleteStatus, contract, ITestRunFile, Result } from "./runner-protocol";

const enum C {
  LogPrefix = "# Log: ",
  TestPrefix = "# Subtest: ",
}

// todo: this can be simplified with https://github.com/nodejs/node/issues/46045

const start: typeof contract["TClientHandler"]["start"] = async ({ concurrency, files }) => {
  const majorVersion = /^v([0-9]+)/.exec(process.version);
  if (!majorVersion || Number(majorVersion[1]) < 19) {
    return { status: CompleteStatus.NodeVersionOutdated, message: process.version };
  }

  const todo: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    todo.push(doWork(files));
  }
  await Promise.all(todo);

  return { status: CompleteStatus.Done };
};

async function doWork(queue: ITestRunFile[]) {
  while (queue.length) {
    const next = queue.pop()!;

    let currentId: string[] | undefined;
    function connectParser(segments: string[], parser: Parser) {
      parser.on("comment", (c: string) => {
        if (c.startsWith(C.TestPrefix)) {
          currentId = [...segments, c.slice(C.TestPrefix.length, -1)];
          server.started({ id: currentId });
        }
      });

      parser.on("child", (childParser: Parser) => {
        const onComment = (c: string) => {
          if (c.startsWith(C.TestPrefix)) {
            const name = c.slice(C.TestPrefix.length, -1);
            childParser.removeListener("comment", onComment);
            connectParser([...segments, name], childParser);
          }
        };

        childParser.on("comment", onComment);
      });

      parser.on("assert", (a: TapResult) => {
        if (currentId) {
          server.finished({
            id: currentId,
            duration: a.diag.duration_ms,
            error: a.diag.error,
            expected:
              a.diag.expected !== undefined ? JSON.stringify(a.diag.expected, null, 2) : undefined,
            actual:
              a.diag.actual !== undefined ? JSON.stringify(a.diag.actual, null, 2) : undefined,
            stack: a.diag.stack
              ? // node's runner does some primitive stack cleaning that we need to
                // undo so stack-trace-parser can understand it
                parseStackTrace(
                  a.diag.stack
                    .split("\n")
                    .map((l: string) => `  at ${l}`)
                    .join("\n")
                )
              : undefined,
            status: a.skip || a.todo ? Result.Skipped : a.ok ? Result.Ok : Result.Failed,
          });
          currentId = undefined;
        }
      });
    }

    await new Promise<void>((resolve) => {
      const stderr: Buffer[] = [];
      const cp = spawn(process.argv0, [next.path], { cwd: dirname(next.path), stdio: "pipe" });
      const parser = new Parser();
      connectParser([next.uri], parser);
      cp.stderr.on("data", (d) => stderr.push(d));
      cp.stdout.pipe(parser);
      parser.on("comment", (c: string) => {
        // comments are always on the top-level parser since we don't indent them
        if (c.startsWith(C.LogPrefix) && currentId) {
          server.logged({ line: JSON.parse(c.slice(C.LogPrefix.length, -1)), id: currentId });
        }
      });
      parser.on("complete", () => resolve());
    });
  }
}

const socket = connect(process.argv[2]).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});

const { server } = Contract.getServerFromStream(
  contract,
  new NodeJsMessageStream(socket, socket),
  {},
  { start }
);
