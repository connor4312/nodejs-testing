import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import * as ansiColors from "ansi-colors";
import { spawn } from "child_process";
import { connect } from "net";
import * as path from "path";
import { dirname, join } from "path";
import split from "split2";
import { parse as parseStackTrace } from "stacktrace-parser";
import { Parser, Result as TapResult } from "tap-parser";
import { pathToFileURL } from "url";
import { WebSocket } from "ws";
import { escapeRegex } from "./regex";
import { CompleteStatus, ILog, ITestRunFile, Result, contract } from "./runner-protocol";

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
  StartingTestPrefix = "# Starting test: ",
  ListeningPrefix = "Debugger listening on ",
  WaitingForDisconnect = "Waiting for the debugger to disconnect...",
}

// todo: this can be simplified with https://github.com/nodejs/node/issues/46045

const start: (typeof contract)["TClientHandler"]["start"] = async ({
  concurrency,
  files,
  extensions,
}) => {
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

async function doWork(prefix: string, queue: ITestRunFile[], extensions: ExtensionConfig[]) {
  while (queue.length) {
    const next = queue.pop()!;
    // logs for unfinished tests, since TAP output may not be written before
    // any TAP information for a test (or the next test!)
    const logQueue: { name: string; logs: ILog[] }[] = [];

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
        if (!currentId) {
          return;
        }

        server.finished({
          id: currentId,
          duration: a.diag.duration_ms,
          error: a.diag.error,
          logs: logQueue.shift()?.logs || [],
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
                  .join("\n"),
              )
            : undefined,
          status: a.skip || a.todo ? Result.Skipped : a.ok ? Result.Ok : Result.Failed,
        });

        currentId = undefined;
      });
    }

    await new Promise<void>((resolve) => {
      server.output(`${prefix}starting ${ansiColors.underline(next.path)}`);
      const args = [];
      const ext = path.extname(next.path);
      if (extensions) {
        const parameters = extensions.find((x) => x.extensions.some((y: string) => `.${y}` == ext))
          ?.parameters;
        if (parameters) args.push(...parameters);
      }

      args.push(...["--require", join(__dirname, "runner-loader.js")]);
      for (const include of next.include || []) {
        args.push("--test-name-pattern", `^${escapeRegex(include)}$`);
      }

      args.push(next.path);

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
      parser.on("line", (line: string) => {
        if (line.startsWith(C.LogPrefix)) {
          const obj = JSON.parse(line.slice(C.LogPrefix.length));
          if (logQueue.length) {
            logQueue[logQueue.length - 1].logs.push(obj);
          } else {
            server.log({ id: currentId, prefix, log: obj });
          }
        } else if (line.startsWith(C.StartingTestPrefix)) {
          logQueue.push({ name: line.slice(C.StartingTestPrefix.length).trimEnd(), logs: [] });
        } else {
          server.output(prefix + line.trimEnd());
        }
      });
      parser.on("complete", () => resolve());

      cp.stderr.pipe(split("\n")).on("data", (line: string) => {
        if (line.startsWith(C.ListeningPrefix)) {
          setupInspector(next.path, line.slice(C.ListeningPrefix.length));
        } else if (line === C.WaitingForDisconnect) {
          cp.kill();
        }
      });
      cp.stdout.pipe(parser);
    });
  }
}

/**
 * Uses the inspector to see if there's a sourcemap in the target file. If so
 * it notifies the runner. This is used to get sourcemaps for tests transpiled
 * by the loader, like tsx, which are not present on disk.
 */
function setupInspector(testFile: string, inspectorURL: string) {
  const expectedUrl = pathToFileURL(testFile).toString().toLowerCase();
  const enableReqId = 0;

  const ws = new WebSocket(inspectorURL);
  ws.on("message", (msg: string) => {
    const line = JSON.parse(msg.toString());
    if (line.method === "Debugger.scriptParsed") {
      const params = line.params as import("inspector").Debugger.ScriptParsedEventDataType;
      if (params.url.toLowerCase() === expectedUrl && params.sourceMapURL) {
        server.sourceMap({ testFile, sourceMapURL: params.sourceMapURL });
        ws.close();
      }
    } else if (line.result && line.id === enableReqId) {
      ws.send(JSON.stringify({ method: "Runtime.runIfWaitingForDebugger", id: 1 }));
    }
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({ method: "Debugger.enable", id: enableReqId }));
  });
}

const socket = connect(process.argv[2]).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});

const { server } = Contract.getServerFromStream(
  contract,
  new NodeJsMessageStream(socket, socket),
  {},
  { start, kill: () => process.exit() },
);
