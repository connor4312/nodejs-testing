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
import { getContainingItemsForFile, ItemType, testMetadata } from "./metadata";
import { CompleteStatus, contract, ITestRunFile, Result } from "./runner-protocol";
import { SourceMapStore } from "./source-map-store";

let socketCounter = 0;
const socketDir = process.platform === "win32" ? "\\\\.\\pipe\\" : tmpdir();
const getRandomPipe = () => join(socketDir, `nodejs-test.${process.pid}-${socketCounter++}.sock`);

export type RunHandler = (
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken
) => Promise<void>;

export class TestRunner {
  private readonly workerPath: string;

  constructor(
    private readonly smStore: SourceMapStore,
    private readonly concurrency: ConfigValue<number>,
    private readonly nodejsPath: ConfigValue<string>,
    extensionDir: string
  ) {
    this.workerPath = join(extensionDir, "out", "runner-worker.js");
  }

  public makeHandler(
    wf: vscode.WorkspaceFolder,
    ctrl: vscode.TestController,
    debug: boolean
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
        const smMaintainer = this.smStore.maintain(vscode.Uri.file(path));
        run.token.onCancellationRequested(() => smMaintainer.dispose());
        const sourceMap = await (smMaintainer.value || smMaintainer.refresh());
        return sourceMap.originalPositionFor(line || 1, col || 0);
      };

      try {
        await new Promise<void>((resolve, reject) => {
          const socket = getRandomPipe();
          run.token.onCancellationRequested(() => fs.unlink(socket).catch(() => {}));

          let outputQueue = Promise.resolve();
          const server = createServer((stream) => {
            run.token.onCancellationRequested(stream.end, stream);
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

                logged({ line, id }) {
                  const test = id && getTestByPath(id);
                  const location = line.sh.file
                    ? mapLocation(line.sh.file, line.sh.lineNumber, line.sh.column)
                    : undefined;
                  outputQueue = outputQueue.then(async () =>
                    run.appendOutput(line.chunk, await location, test)
                  );
                },

                finished({ id, status, duration, actual, expected, error, stack }) {
                  const test = getTestByPath(id);
                  if (!test) {
                    return;
                  }

                  if (status === Result.Failed) {
                    const asText = error || "Test failed";
                    const testMessage =
                      actual !== undefined && expected !== undefined
                        ? vscode.TestMessage.diff(asText, expected, actual)
                        : new vscode.TestMessage(asText);
                    const lastFrame = stack?.[0];
                    const location = lastFrame?.file
                      ? mapLocation(lastFrame.file, lastFrame.lineNumber, lastFrame.column)
                      : undefined;
                    outputQueue = outputQueue.then(async () => {
                      testMessage.location = await location;
                      run.failed(test, testMessage);
                    });
                  } else if (status === Result.Skipped) {
                    run.skipped(test);
                  } else if (status === Result.Ok) {
                    run.passed(test, duration);
                  }
                },
              }
            );

            reg.client
              .start({ files, concurrency })
              .then(({ status, message }) => {
                switch (status) {
                  case CompleteStatus.Done:
                    return resolve(outputQueue);
                  case CompleteStatus.NodeVersionOutdated:
                    return reject(
                      new Error(
                        `This extension only works with Node.js version 19 and above (you have ${message}). You can change the setting '${this.nodejsPath.key}' if you want to use a different Node.js executable.`
                      )
                    );
                }
              })
              .catch(reject);
          });
          run.token.onCancellationRequested(server.close, server);
          server.once("error", reject);
          server.listen(socket);

          this.spawnWorker(wf, debug, socket, run.token).then(
            () => reject(new Error("Worker executed without signalling its completion")),
            reject
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
    ct: vscode.CancellationToken
  ) {
    if (!debug) {
      await new Promise<void>((resolve, reject) => {
        const stderr: Buffer[] = [];
        const cp = spawn(this.nodejsPath.value, [this.workerPath, socketPath]);
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
          if (!includeFiles.has(key)) {
            includeFiles.set(key, { uri: test.uri!.toString(), path: metadata.compiledIn.fsPath });
          }
          break;
        }

        case ItemType.Test: {
          const key = test.uri!.toString();
          let record = includeFiles.get(key);
          if (!record) {
            for (let f = test.parent; f; f = f.parent) {
              const metadata = testMetadata.get(f);
              if (metadata?.type === ItemType.File) {
                record = {
                  path: metadata.compiledIn.fsPath,
                  uri: test.uri!.toString(),
                  include: [],
                };
                break;
              }
            }

            if (!record) {
              throw new Error(`could not find parent file for test ${test.id}`);
            }

            includeFiles.set(key, record);
          }
          if (!record.include) {
            // already running the whole file
            return;
          }

          record.include.push(getFullNameForTest(test));
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

    if (request.exclude) {
      // we only need to check direct test exclusions, since we filter out
      // files/directories in `addInclude` alreadu
      for (const exclude of request.exclude) {
        if (testMetadata.get(exclude)?.type === ItemType.Test) {
          const rec = includeFiles.get(exclude.uri!.toString());
          if (!rec) {
            continue;
          }

          rec.exclude ??= [];
          rec.exclude.push(getFullNameForTest(exclude));
        }
      }
    }

    return [...includeFiles.values()];
  }
}

const getFullNameForTest = (test: vscode.TestItem) => {
  let testPath: string[] = [];
  for (
    let p: vscode.TestItem | undefined = test;
    p && testMetadata.get(p)?.type === ItemType.Test;
    p = p.parent
  ) {
    testPath.unshift(p.label);
  }
  return testPath.join(" ");
};
