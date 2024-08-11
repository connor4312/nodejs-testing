import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import * as ansiColors from "ansi-colors";
import { spawn } from "child_process";
import { connect } from "net";
import * as path from "path";
import { dirname, join } from "path";
import split from "split2";
import { StackFrame } from "stacktrace-parser";
import { pathToFileURL } from "url";
import { WebSocket } from "ws";
import { ExtensionConfig } from "./extension-config";
import { escapeRegex } from "./regex";
import { ITestRunFile, JsonFromReporter, contract } from "./runner-protocol";

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
  AttachedPrefix = "Debugger attached",
  ForHelpPrefix = "For help, see",
  EndingPrefix = "Debugger ending on",
  ListeningPrefix = "Debugger listening on ",
  WaitingForDisconnect = "Waiting for the debugger to disconnect...",
}

const ignoredLines = [C.ForHelpPrefix, C.WaitingForDisconnect, C.AttachedPrefix, C.EndingPrefix];

// todo: this can be simplified with https://github.com/nodejs/node/issues/46045

const start: (typeof contract)["TClientHandler"]["start"] = async ({
  concurrency,
  files,
  extensions,
  verbose,
  extraEnv,
  coverageDir,
}) => {
  const todo: Promise<void>[] = [];
  for (let i = 0; i < concurrency && i < files.length; i++) {
    const prefix = colors[i % colors.length](`worker${i + 1}> `);
    todo.push(doWork(prefix, files, extensions, verbose, extraEnv, coverageDir));
  }
  await Promise.all(todo);

  return null;
};

async function doWork(
  prefix: string,
  queue: ITestRunFile[],
  extensions: ExtensionConfig[],
  verbose: boolean,
  extraEnv: Record<string, string>,
  coverageDir: string | undefined,
) {
  while (queue.length) {
    const next = queue.pop()!;
    await new Promise<void>((resolve) => {
      if (verbose) {
        server.output(`${prefix}starting ${ansiColors.underline(next.path)}`);
      }
      const args = [];
      const ext = path.extname(next.path);
      if (extensions) {
        const parameters = extensions.find((x) =>
          x.extensions.some((y: string) => `.${y}` == ext),
        )?.parameters;
        if (parameters) args.push(...parameters);
      }

      args.push("--test-reporter", pathToFileURL(join(__dirname, "runner-loader.js")).toString());
      for (const include of next.include || []) {
        args.push("--test-name-pattern", `^${escapeRegex(include)}$`);
      }

      args.push(next.path);
      if (verbose) {
        server.output(`${prefix}${process.argv0} ${args.join('" "')}`);
      }

      const cp = spawn(process.argv0, args, {
        cwd: dirname(next.path),
        stdio: "pipe",
        env: {
          // enable color for modules that use `supports-color` or similar
          FORCE_COLOR: "true",
          NODE_V8_COVERAGE: coverageDir,
          ...process.env,
          ...extraEnv,
        },
      });

      // startId and finishId track the tests that have started running and are
      // expected to finish, respectively. The Node test reporter emits dequeue
      // and test start events in order and so we use these to track and form
      // the complete test IDs.
      const startId: string[] = [next.uri];
      const finishId: string[] = [next.uri];
      const setId = (id: string[], data: { nesting: number; name: string }) => {
        id.length = data.nesting + 2;
        id[data.nesting + 1] = data.name;
        linesThatWillCauseFileToFail = undefined;
      };
      let inspector: WebSocket | undefined;

      // Set to an array until the first test reports its status. If the process
      // exits before that happens, it's probably because of some syntax error
      // and these lines will be reported as the failure.
      let linesThatWillCauseFileToFail: string[] | undefined = [];

      const handleLine = (line: string) => {
        if (verbose) {
          server.output(`${prefix}${line}`);
        }

        let json: JsonFromReporter;
        try {
          json = JSON.parse(line);
        } catch {
          server.output(`${prefix}${line}`);
          linesThatWillCauseFileToFail?.push(line);
          return;
        }

        linesThatWillCauseFileToFail = undefined;

        switch (json.type) {
          case "runner:log":
            server.log({ prefix, log: json });
            break;
          case "test:dequeue":
            setId(startId, json.data);
            server.started({ id: startId });
            break;
          case "test:start":
            setId(finishId, json.data);
            break;
          case "test:pass":
            setId(finishId, json.data); // this should generally no-op? But just in case...
            if (json.data.skip || json.data.todo) {
              server.skipped({ id: finishId });
            } else {
              server.passed({ id: finishId, duration: json.data.details.duration_ms });
            }
            break;

          case "test:fail":
            setId(finishId, json.data); // this should generally no-op? But just in case...
            const cause = json.data.details.error.cause;
            const causeObj: {
              actual?: any;
              expected?: any;
              _stack?: StackFrame[];
              _message?: string;
            } = cause && typeof cause === "object" ? cause : {};
            const message =
              causeObj._message ||
              (typeof cause === "string" ? cause : JSON.stringify(cause, null, 2));

            server.failed({
              id: finishId,
              duration: json.data.details.duration_ms,
              error: message,
              stack: causeObj._stack,
              expected: typeof causeObj.expected === "string" ? causeObj.expected : undefined,
              actual: typeof causeObj.actual === "string" ? causeObj.actual : undefined,
            });
            break;

          case "test:plan":
            if (json.data.nesting === 0) {
              inspector?.close();
            }
            break;
        }
      };

      cp.on("error", (e) => {
        server.failed({
          id: finishId,
          error: String(e),
        });
      });

      cp.stdout
        .pipe(split("\n"))
        .on("data", handleLine)
        .on("end", () => {
          if (verbose) {
            server.output(`${prefix}stdout closed`);
          }
          if (linesThatWillCauseFileToFail) {
            server.fileFailed({
              uri: next.uri,
              error: linesThatWillCauseFileToFail.join("\n"),
            });
          }
          resolve();
        })
        .resume();
      cp.stderr
        .pipe(split("\n"))
        .on("data", (line: string) => {
          if (line.startsWith(C.ListeningPrefix)) {
            inspector = setupInspector(next.path, line.slice(C.ListeningPrefix.length));
          } else if (line === C.WaitingForDisconnect) {
            cp.kill();
          } else if (ignoredLines.some((l) => line.startsWith(l))) {
            // hide
          } else {
            handleLine(line);
          }
        })
        .resume();
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
  let done = 0;

  const ws = new WebSocket(inspectorURL);
  const onMessage = (msg: string) => {
    const line = JSON.parse(msg.toString());
    if (line.method === "Debugger.scriptParsed") {
      const params = line.params as import("inspector").Debugger.ScriptParsedEventDataType;
      if (params.url.toLowerCase() === expectedUrl) {
        if (params.sourceMapURL) {
          server.sourceMap({ testFile, sourceMapURL: params.sourceMapURL });
        }
        done++;
      }
    } else if (line.result && line.id === enableReqId) {
      ws.send(JSON.stringify({ method: "Runtime.runIfWaitingForDebugger", id: 1 }));
      done++;
    }

    if (done === 2) {
      // we don't close the websocket, since it seems like doing so can sometimes
      // make the debugged process exit prematurely(??)
      ws.removeListener("message", onMessage);
    }
  };

  ws.on("message", onMessage);

  ws.on("open", () => {
    ws.send(JSON.stringify({ method: "Debugger.enable", id: enableReqId }));
  });

  return ws;
}

const socket = connect(process.argv[2]).on("error", (e) => {
  console.error(e.message);
  flushThenExit(1);
});

const stream = new NodeJsMessageStream(socket, socket);
const { server } = Contract.getServerFromStream(
  contract,
  stream,
  {},
  {
    start,
    kill: () => queueMicrotask(() => flushThenExit()),
    version: () => Promise.resolve(process.version),
  },
);

const flushThenExit = (code = 0) => {
  stream.onClosed.then(() => process.exit(code));
  stream.close();
};
