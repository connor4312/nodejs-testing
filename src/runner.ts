import { replaceVariables } from "@c4312/vscode-variables";
import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { createServer } from "net";
import { cpus, tmpdir } from "os";
import { join } from "path";
import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { last } from "./iterable";
import { ItemType, getContainingItemsForFile, testMetadata } from "./metadata";
import { OutputQueue } from "./outputQueue";
import { CompleteStatus, ITestRunFile, Result, contract } from "./runner-protocol";
import { SourceMapStore } from "./source-map-store";

let socketCounter = 0;
const socketDir = process.platform === "win32" ? "\\\\.\\pipe\\" : tmpdir();
const getRandomPipe = () => join(socketDir, `nodejs-test.${process.pid}-${socketCounter++}.sock`);

export type RunHandler = (
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) => Promise<void>;

export class TestRunner {
  private readonly workerPath: string;

  constructor(
    private readonly smStore: SourceMapStore,
    private readonly concurrency: ConfigValue<number>,
    private readonly nodejsPath: ConfigValue<string>,
    extensionDir: string,
    private readonly nodejsParameters: ConfigValue<string[]>,
    private readonly extensions: ConfigValue<ExtensionConfig[]>,
  ) {
    this.workerPath = join(extensionDir, "out", "runner-worker.js");
  }

  public makeHandler(
    wf: vscode.WorkspaceFolder,
    ctrl: vscode.TestController,
    debug: boolean,
  ): RunHandler {
    return async (request, token) => {
      const files = await this.solveArguments(ctrl, request);
      if (token.isCancellationRequested) {
        return;
      }

      const concurrency = this.concurrency.value || cpus().length;
      const run = ctrl.createTestRun(request);
      const getTestByPath = (path: string[]): vscode.TestItem | undefined => {
        const uri = vscode.Uri.parse(path[0]);
        let item = last(getContainingItemsForFile(wf, ctrl, uri))!.item;
        if (!item) {
          return undefined;
        }

        for (let i = 1; item && i < path.length; i++) {
          item = item.children.get(path[i]);
        }

        return item;
      };

      const mapLocation = async (path: string, line: number | null, col: number | null) => {
        // stacktraces can have file URIs on some platforms (#7)
        const fileUri = path.startsWith("file:") ? vscode.Uri.parse(path) : vscode.Uri.file(path);
        const smMaintainer = this.smStore.maintain(fileUri);
        run.token.onCancellationRequested(() => smMaintainer.dispose());
        const sourceMap = await (smMaintainer.value || smMaintainer.refresh());
        return sourceMap.originalPositionFor(line || 1, col || 0);
      };

      try {
        const outputQueue = new OutputQueue();
        await new Promise<void>((resolve, reject) => {
          const socket = getRandomPipe();
          run.token.onCancellationRequested(() => fs.unlink(socket).catch(() => {}));

          const server = createServer((stream) => {
            run.token.onCancellationRequested(stream.end, stream);
            const extensions = this.extensions.value;

            const reg = Contract.registerServerToStream(
              contract,
              new NodeJsMessageStream(stream, stream),
              {},
              {
                started({ id }) {
                  const test = getTestByPath(id);
                  if (test) {
                    run.started(test);
                  }
                },

                output(line) {
                  outputQueue.enqueue(() => run.appendOutput(`${line}\r\n`));
                },

                finished({
                  id,
                  status,
                  duration,
                  actual,
                  expected,
                  error,
                  stack,
                  logs,
                  logPrefix,
                }) {
                  const test = getTestByPath(id);
                  if (!test) {
                    return;
                  }

                  for (const l of logs) {
                    const location = l.sf.file
                      ? mapLocation(l.sf.file, l.sf.lineNumber, l.sf.column)
                      : undefined;
                    outputQueue.enqueue(location, (location) => {
                      run.appendOutput(logPrefix);
                      run.appendOutput(l.chunk.replace(/\r?\n/g, "\r\n"), location, test);
                    });
                  }

                  if (status === Result.Failed) {
                    const asText = error || "Test failed";
                    const testMessage =
                      actual !== undefined && expected !== undefined
                        ? vscode.TestMessage.diff(asText, expected, actual)
                        : new vscode.TestMessage(asText);
                    const lastFrame = stack?.find((s) => !s.file?.startsWith("node:"));
                    const location = lastFrame?.file
                      ? mapLocation(lastFrame.file, lastFrame.lineNumber, lastFrame.column)
                      : undefined;
                    outputQueue.enqueue(location, (location) => {
                      testMessage.location = location;
                      run.failed(test, testMessage);
                    });
                  } else if (status === Result.Skipped) {
                    outputQueue.enqueue(() => run.skipped(test));
                  } else if (status === Result.Ok) {
                    outputQueue.enqueue(() => run.passed(test, duration));
                  }
                },
              },
            );

            reg.client
              .start({ files, concurrency, extensions })
              .then(({ status, message }) => {
                switch (status) {
                  case CompleteStatus.Done:
                    return resolve(outputQueue.drain());
                  case CompleteStatus.NodeVersionOutdated:
                    return reject(
                      new Error(
                        `This extension only works with Node.js version 19 and above (you have ${message}). You can change the setting '${this.nodejsPath.key}' if you want to use a different Node.js executable.`,
                      ),
                    );
                }
              })
              .catch(reject);
          });
          run.token.onCancellationRequested(server.close, server);
          server.once("error", reject);
          server.listen(socket);

          const resolvedNodejsParameters = this.nodejsParameters.value.map((p) =>
            replaceVariables(p),
          );
          this.spawnWorker(wf, debug, socket, run.token, resolvedNodejsParameters).then(
            () => reject(new Error("Worker executed without signalling its completion")),
            reject,
          );
        });
      } catch (e) {
        if (!token.isCancellationRequested) {
          vscode.window.showErrorMessage((e as Error).message);
        }
      } finally {
        run.end();
      }
    };
  }

  private async spawnWorker(
    wf: vscode.WorkspaceFolder,
    debug: boolean,
    socketPath: string,
    ct: vscode.CancellationToken,
    resolvedNodejsParameters: string[],
  ) {
    if (!debug) {
      await new Promise<void>((resolve, reject) => {
        const stderr: Buffer[] = [];
        const cp = spawn(this.nodejsPath.value, [
          ...resolvedNodejsParameters,
          this.workerPath,
          socketPath,
        ]);
        cp.stderr.on("data", (d) => stderr.push(d));
        cp.on("error", reject);
        cp.on("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`Worker executed with code ${code}: ${Buffer.concat(stderr)}`));
          } else {
            resolve();
          }
        });
        ct.onCancellationRequested(() => cp.kill());
      });
    }

    const sessionPromise = new Promise<void>((resolve) => {
      const startListener = vscode.debug.onDidStartDebugSession((session) => {
        if (!session.configuration.args || session.configuration.args[0] !== socketPath) {
          return;
        }

        startListener.dispose();
        ct.onCancellationRequested(() => vscode.debug.stopDebugging(session));

        const endListener = vscode.debug.onDidTerminateDebugSession((ended) => {
          if (ended === session) {
            endListener.dispose();
            resolve();
          }
        });
      });
    });

    await vscode.debug.startDebugging(wf, {
      type: "pwa-node",
      name: "Run Tests",
      request: "launch",
      args: [socketPath],
      program: this.workerPath,
      runtimeExecutable: this.nodejsPath.value,
    });

    return sessionPromise;
  }

  private async solveArguments(ctrl: vscode.TestController, request: vscode.TestRunRequest) {
    const exclude = new Set(request.exclude);
    const includeFiles = new Map<string, ITestRunFile>();

    const addTestsToFileRecord = (record: ITestRunFile, queue: vscode.TestItem[]) => {
      if (!record.include) {
        return; // already running whole file
      }

      // node's runner doesn't automatically include subtests of an included
      // test. Do so here, avoiding exclusions.
      const include = new Set(record.include);
      while (queue.length) {
        const item = queue.pop()!;
        include.add(item.label);
        for (const [, child] of item.children) {
          if (!request.exclude?.includes(child)) {
            queue.push(child);
          }
        }
      }
      record.include = [...include];
    };

    const addInclude = (test: vscode.TestItem) => {
      if (exclude.has(test)) {
        return;
      }

      const metadata = testMetadata.get(test);
      switch (metadata?.type) {
        case ItemType.Directory:
          for (const [, item] of test.children) {
            addInclude(item);
          }
          break;

        case ItemType.File: {
          const key = test.uri!.toString();
          if (includeFiles.has(key)) {
            break;
          }

          const rec: ITestRunFile = { uri: test.uri!.toString(), path: metadata.compiledIn.fsPath };
          includeFiles.set(key, rec);
          // if there's any exclude in this file, we need to expand its tests so we can omit it.
          if (request.exclude?.some((e) => e.uri?.toString() === test.uri!.toString())) {
            rec.include = [];
            addTestsToFileRecord(
              rec,
              [...test.children].map(([, t]) => t),
            );
          }
        }

        case ItemType.Test: {
          const key = test.uri!.toString();
          let record = includeFiles.get(key);
          if (!record) {
            let include: string[] = [];
            for (let f = test.parent; f; f = f.parent) {
              const metadata = testMetadata.get(f);
              if (metadata?.type === ItemType.File) {
                record = {
                  path: metadata.compiledIn.fsPath,
                  uri: test.uri!.toString(),
                  include,
                };
                break;
              }

              include.push(f.label);
            }

            if (!record) {
              throw new Error(`could not find parent file for test ${test.id}`);
            }

            includeFiles.set(key, record);
          }

          addTestsToFileRecord(record, [test]);
          break;
        }
      }
    };

    if (request.include) {
      request.include.forEach(addInclude);
    } else {
      // this only work on VS Code Insiders 1.76 and above 🤦‍♂️
      // https://github.com/microsoft/vscode/pull/173001
      await ctrl.resolveHandler?.(undefined);
      for (const [, item] of ctrl.items) {
        addInclude(item);
      }
    }

    // sort run order to avoid jumping around in the test explorer
    return [...includeFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
}
