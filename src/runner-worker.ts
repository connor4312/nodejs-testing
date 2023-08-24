import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import * as ansiColors from "ansi-colors";
import { spawn } from "child_process";
import { connect } from "net";
import { dirname, join } from "path";
import { parse as parseStackTrace } from "stacktrace-parser";
import { Parser, Result as TapResult } from "tap-parser";
import { escapeRegex } from "./regex";
import { CompleteStatus, ILog, ITestRunFile, Result, contract } from "./runner-protocol";
import * as path from "path";

const colors = [
  ansiColors.redBright,
  ansiColors.greenBright,
  ansiColors.yellowBright,
  ansiColors.blueBright,
  ansiColors.magentaBright,
  ansiColors.cyanBright,
  ansiColors.whiteBright,
];

const enum C {
  LogPrefix = "# Log: ",
  TestPrefix = "# Subtest: ",
}

// todo: this can be simplified with https://github.com/nodejs/node/issues/46045

const start: typeof contract["TClientHandler"]["start"] = async ({ concurrency, files, extensions }) => {
  const majorVersion = /^v([0-9]+)/.exec(process.version);
  if (!majorVersion || Number(majorVersion[1]) < 19) {
    return { status: CompleteStatus.NodeVersionOutdated, message: process.version };
  }

  const todo: Promise<void>[] = [];
  for (let i = 0; i < concurrency && i < files.length; i++) {
    const prefix = colors[i % colors.length](`worker${i + 1}> `);
    todo.push(doWork(prefix, files, extensions));
  }
  await Promise.all(todo);

  return { status: CompleteStatus.Done };
};

async function doWork(prefix: string, queue: ITestRunFile[], extensions:ExtensionConfig[]) {
  while (queue.length) {
    const next = queue.pop()!;

    let currentId: string[] | undefined;
    // logs for the currently running test:
    let currentLogs: ILog[] = [];
    // logs staged for the next assertion. The TAP parser doesn't emit the
    // previous test assertion until it parses the next one, due to the way YAML
    // works (yay YAML!) So when we see the start comment of a new test, we
    // stage the old logs so that they can be captured in the following assertion
    let stagedLogs: ILog[] = [];
    function connectParser(segments: string[], parser: Parser) {
      parser.on("comment", (c: string) => {
        if (c.startsWith(C.TestPrefix)) {
          currentId = [...segments, c.slice(C.TestPrefix.length, -1)];
          server.started({ id: currentId });
          stagedLogs = currentLogs;
          currentLogs = [];
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
        if (!currentId) {
          return;
        }

        server.finished({
          id: currentId,
          duration: a.diag.duration_ms,
          error: a.diag.error,
          logs: stagedLogs,
          logPrefix: prefix,
          expected:
            a.diag.expected !== undefined ? JSON.stringify(a.diag.expected, null, 2) : undefined,
          actual: a.diag.actual !== undefined ? JSON.stringify(a.diag.actual, null, 2) : undefined,
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
      });
    }

    await new Promise<void>((resolve) => {
      server.output(`${prefix}starting ${ansiColors.underline(next.path)}`);
      const args = []
      const ext = path.extname(next.path);
      if(extensions) {
        const parameters = extensions.find(x=> x.extensions.some( (y:string) => `.${y}`== ext))?.parameters;
        if(parameters)
          args.push(...parameters);
      }

      args.push(...["--require", join(__dirname, "runner-loader.js")]);
      for (const include of next.include || []) {
        args.push("--test-name-pattern", `^${escapeRegex(include)}$`);
      }

      args.push(next.path);

      const stderr: Buffer[] = [];

      server.output(`spawn command=${process.argv0} args=${args}`);

      const cp = spawn(process.argv0, args, {
        cwd: dirname(next.path),
        stdio: "pipe",
        env: {
          // enable color for modules that use `supports-color` or similarq
          FORCE_COLOR: "true",
          ...process.env,
        },
      });
      const parser = new Parser();
      connectParser([next.uri], parser);
      cp.stderr.on("data", (d) => stderr.push(d));
      cp.stdout.pipe(parser);
      parser.on("line", (line: string) => {
        if (line.startsWith(C.LogPrefix)) {
          currentLogs.push(JSON.parse(line.slice(C.LogPrefix.length, -1)));
        } else {
          server.output(prefix + line.trimEnd());
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
