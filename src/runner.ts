import { replaceVariables } from "@c4312/vscode-variables";
import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { parse as parseEnv } from "dotenv";
import fs from "fs/promises";
import { createServer } from "net";
import { cpus, tmpdir } from "os";
import { isAbsolute, join } from "path";
import split from "split2";
import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { nodeSnapshotImpl } from "./constants";
import { applyC8Coverage } from "./coverage";
import { DisposableStore } from "./disposable";
import { ExtensionConfig } from "./extension-config";
import { last } from "./iterable";
import {
  ItemType,
  getContainingItemsForFile,
  getFullTestName,
  isParent,
  testMetadata,
} from "./metadata";
import { OutputQueue } from "./outputQueue";
import { Pretest } from "./pretest";
import { ILog, ITestRunFile, contract } from "./runner-protocol";
import { SourceMapStore } from "./source-map-store";
import { Style, styleFactories } from "./styles";

let socketCounter = 0;
const socketDir = process.platform === "win32" ? "\\\\.\\pipe\\" : tmpdir();
const getRandomPipe = () => join(socketDir, `nodejs-test.${process.pid}-${socketCounter++}.sock`);

export type RunHandler = (
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) => Promise<void>;

export class TestRunner implements vscode.Disposable {
  /**
   * Set via a command, before tests are re-run, to generate or update snapshots.
   */
  public static regenerateSnapshotsOnNextRun = false;

  private readonly workerPath: string;
  private readonly disposables = new DisposableStore();

  private readonly concurrency: ConfigValue<number>;
  private readonly isolation: ConfigValue<string>;
  private readonly forceExit: ConfigValue<boolean>;
  private readonly nodejsPath: ConfigValue<string>;
  private readonly verbose: ConfigValue<boolean>;
  private readonly style: ConfigValue<Style>;
  private readonly nodejsParameters: ConfigValue<string[]>;
  private readonly envFile: ConfigValue<string>;
  private readonly env: ConfigValue<Record<string, string>>;
  private readonly debugOptions: ConfigValue<Record<string, any>>;
  private readonly pretest: Pretest;

  constructor(
    folder: vscode.WorkspaceFolder,
    private readonly smStore: SourceMapStore,
    extensionDir: string,
    private readonly extensions: ConfigValue<ExtensionConfig[]>,
  ) {
    this.workerPath = join(extensionDir, "out", "runner-worker.js");
    this.concurrency = this.disposables.add(new ConfigValue("concurrency", 0, folder));
    this.isolation = this.disposables.add(new ConfigValue("isolation", "process", folder));
    this.forceExit = this.disposables.add(new ConfigValue("forceExit", false, folder));

    this.nodejsPath = this.disposables.add(new ConfigValue("nodejsPath", "node", folder));
    this.verbose = this.disposables.add(new ConfigValue("verbose", false, folder));
    this.style = this.disposables.add(new ConfigValue("style", Style.Spec, folder));
    this.nodejsParameters = this.disposables.add(new ConfigValue("nodejsParameters", [], folder));
    this.envFile = this.disposables.add(new ConfigValue("envFile", "", folder));
    this.env = this.disposables.add(new ConfigValue("env", {}, folder));
    this.pretest = this.disposables.add(new Pretest(new ConfigValue("pretest", undefined, folder)));
    this.debugOptions = this.disposables.add(new ConfigValue("debugOptions", {}, folder));
  }

  public dispose() {
    this.disposables.dispose();
  }

  public makeHandler(
    wf: vscode.WorkspaceFolder,
    ctrl: vscode.TestController,
    debug: boolean,
    coverage: boolean,
  ): RunHandler {
    return async (request, token) => {
      const run = ctrl.createTestRun(request);
      if (!(await this.pretest.run(wf.uri.fsPath, run, token))) {
        run.end();
        return;
      }

      if (token.isCancellationRequested) {
        return;
      }

      const concurrency = this.concurrency.value || cpus().length;
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

      // inline source maps read from the runtime. These will both be definitive
      // and possibly the only ones presents from transpiled code.
      const inlineSourceMaps = new Map<string, string>();
      const smStore = this.smStore.createScoped();
      const style = styleFactories[this.style.value]();
      const mapLocation = async (path: string, line: number | null, col: number | null) => {
        // stacktraces can have file URIs on some platforms (#7)
        const fileUri = path.startsWith("file:") ? vscode.Uri.parse(path) : vscode.Uri.file(path);
        const smMaintainer = smStore.maintain(fileUri, inlineSourceMaps.get(fileUri.fsPath));
        run.token.onCancellationRequested(() => smMaintainer.dispose());
        const sourceMap = await (smMaintainer.value || smMaintainer.refresh());
        return sourceMap.originalPositionFor(line || 1, col || 0);
      };

      try {
        const outputQueue = new OutputQueue();
        const coverageDir = coverage
          ? join(tmpdir(), `nodejs-coverage-${randomUUID()}`)
          : undefined;
        const extensions = this.extensions.value;
        const isolation = this.isolation.value;
        const forceExit = this.forceExit.value;
        const envFile = this.envFile.value
          ? await fs.readFile(replaceVariables(this.envFile.value))
          : null;
        const envFileValues = envFile ? parseEnv(envFile) : {};
        const extraEnv = {
          ...envFileValues,
          ...this.env.value,
        };

        await new Promise<void>((resolve, reject) => {
          const socket = getRandomPipe();
          run.token.onCancellationRequested(() => fs.unlink(socket).catch(() => {}));

          const server = createServer((stream) => {
            run.token.onCancellationRequested(stream.end, stream);

            const onLog = (test: vscode.TestItem | undefined, prefix: string, log: ILog) => {
              const location = log.sf?.file
                ? mapLocation(log.sf.file, log.sf.lineNumber, log.sf.column).then(
                    (r) => {
                      return r;
                    },
                    (err) => {
                      run.appendOutput(
                        `Error while mapping location from ${log.sf!.file}, please report: ${err}`,
                      );
                      return undefined;
                    },
                  )
                : undefined;

              outputQueue.enqueue(location, (location) => {
                run.appendOutput(prefix);
                run.appendOutput(log.chunk.replace(/\r?\n/g, "\r\n"), location, test);
              });
            };

            const reg = Contract.registerServerToStream(
              contract,
              new NodeJsMessageStream(stream, stream),
              {},
              {
                started({ id }) {
                  const test = getTestByPath(id);
                  if (test) {
                    run.started(test);
                    outputQueue.enqueue(() => run.appendOutput(style.started(test)));
                  }
                },

                skipped({ id }) {
                  const test = getTestByPath(id);
                  if (test) {
                    run.skipped(test);
                    outputQueue.enqueue(() => run.appendOutput(style.skipped(test)));
                  }
                },

                passed({ id, duration }) {
                  const test = getTestByPath(id);
                  if (test) {
                    run.passed(test, duration);
                    outputQueue.enqueue(() => run.appendOutput(style.passed(test)));
                  }
                },

                output(line) {
                  outputQueue.enqueue(() => run.appendOutput(`${line}\r\n`));
                },

                sourceMap({ testFile, sourceMapURL }) {
                  inlineSourceMaps.set(testFile, sourceMapURL);
                },

                log({ id, prefix, log }) {
                  const test = id ? getTestByPath(id) : undefined;
                  onLog(test, prefix, log);
                },

                fileFailed({ uri, error }) {
                  // File failures call all tests in a URI to fail. Either mark
                  // all those include (if any) or just get the root tests for
                  // that file, if running all tests.
                  let tests = request.include?.filter((t) => t.uri?.toString() === uri);
                  if (!tests?.length) {
                    let byUri = getTestByPath([uri]);
                    if (!byUri) return;
                    tests = [byUri];
                  }

                  const message = new vscode.TestMessage(error);
                  outputQueue.enqueue(undefined, () => {
                    for (const test of tests) {
                      run.failed(test, message);
                    }
                  });
                },

                failed({ id, duration, actual, expected, error, stack, isSnapshotMissing }) {
                  const test = getTestByPath(id);
                  if (!test) {
                    return;
                  }

                  if (isSnapshotMissing && expected === undefined) {
                    const message = new vscode.TestMessage(
                      "Snapshot not found...\n\nPlease click the button to the right to generate them.",
                    );
                    message.contextValue = "isNodejsSnapshotMissing";
                    outputQueue.enqueue(() => {
                      run.appendOutput(style.failed(test, "Snapshot missing."));
                      run.failed(test, message);
                    });
                    return;
                  }

                  const asText = error || "Test failed";
                  const testMessage =
                    actual !== undefined && expected !== undefined
                      ? vscode.TestMessage.diff(asText, expected, actual)
                      : new vscode.TestMessage(asText);

                  testMessage.stackTrace = stack?.map(
                    (s) =>
                      new vscode.TestMessageStackFrame(
                        s.file || "<unknown>",
                        s.file ? pathOrUriToUri(s.file) : undefined,
                        new vscode.Position((s.lineNumber || 1) - 1, (s.column || 1) - 1),
                      ),
                  );
                  if (stack) {
                    const startOfMessage = /^\s*at /.exec(asText);
                    if (startOfMessage) {
                      testMessage.message = asText.slice(0, startOfMessage.index - 1);
                    }
                    if (stack.some((s) => s.file === nodeSnapshotImpl)) {
                      testMessage.contextValue = "isNodejsSnapshotOutdated";
                    }
                  }

                  const lastFrame = stack?.find((s) => !s.file?.startsWith("node:"));
                  const location = lastFrame?.file
                    ? mapLocation(lastFrame.file, lastFrame.lineNumber, lastFrame.column)
                    : undefined;
                  outputQueue.enqueue(location, (location) => {
                    run.appendOutput(style.failed(test, asText));
                    testMessage.location = location;
                    run.failed(test, testMessage, duration);
                  });
                },
              },
            );

            reg.client
              .version(null)
              .then(async (version) => {
                const majorVersion = /^v([0-9]+)/.exec(version);
                if (!majorVersion || Number(majorVersion[1]) < 19) {
                  throw new Error(
                    `This extension only works with Node.js version 19 and above (you have ${version}). You can change the setting '${this.nodejsPath.key}' if you want to use a different Node.js executable.`,
                  );
                }

                const files = await this.solveArguments(ctrl, request, Number(majorVersion[1]));
                await reg.client.start({
                  files,
                  concurrency,
                  isolation,
                  forceExit,
                  extensions,
                  regenerateSnapshots: TestRunner.regenerateSnapshotsOnNextRun,
                  verbose: this.verbose.value,
                  extraEnv,
                  coverageDir,
                });

                TestRunner.regenerateSnapshotsOnNextRun = false;
                outputQueue.enqueue(() => run.appendOutput(style.done()));
                await outputQueue.drain();
                resolve();
              })
              .catch(reject)
              .finally(() => reg.client.kill());
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

        if (coverageDir) {
          await applyC8Coverage(run, coverageDir, wf.uri.fsPath);
        }
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
      return new Promise<void>((resolve, reject) => {
        const stderr: Uint8Array[] = [];
        const cp = spawn(this.nodejsPath.value, [
          ...resolvedNodejsParameters,
          this.workerPath,
          socketPath,
        ]);
        cp.stdout.pipe(split()).on("data", (d) => console.log(`[worker] ${d}`));
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
      ...this.debugOptions.value,
      type: "pwa-node",
      name: "Run Tests",
      request: "launch",
      args: [socketPath],
      program: this.workerPath,
      runtimeExecutable: this.nodejsPath.value,
    });

    return sessionPromise;
  }

  private async solveArguments(
    ctrl: vscode.TestController,
    request: vscode.TestRunRequest,
    nodeMajorVersion: number,
  ) {
    interface IIncludeFile {
      uri: vscode.Uri;
      path: string;
      include?: Set<string>;
    }

    const exclude = new Set(request.exclude);
    const includeFiles = new Map<string, IIncludeFile>();

    // Node <22 did not support running tests by full names and excluded
    // children of tests whose names did not also match (nodejs/node#46728).
    //
    // Node 22 and above are much more similar to Mocha et al. who allow
    // filtering to space-delimited full test names and they automatically run
    // subtests of tests included this way.
    const modernNamePatterns = nodeMajorVersion >= 22;

    const addTestsToFileRecord = (record: IIncludeFile, queue: vscode.TestItem[]) => {
      record.include ??= new Set();

      while (queue.length) {
        const item = queue.pop()!;

        // For legacy node, each previous part must be included. For modern Node,
        // include the labels of nodes for whom we wish to run all subtests --
        // that is, tests with no excludes.
        if (!modernNamePatterns) {
          record.include.add(item.label);
          for (const [, child] of item.children) {
            if (!request.exclude?.includes(child)) {
              queue.push(child);
            }
          }
        } else {
          // not the fastest to check every time, but this is not that common
          // of a code path and request.exclude is usually very small
          if (request.exclude?.some((t) => isParent(item, t))) {
            for (const [, child] of item.children) {
              if (!request.exclude?.includes(child)) {
                queue.push(child);
              }
            }
          } else {
            record.include.add(getFullTestName(item));
          }
        }
      }
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

          const rec: IIncludeFile = { uri: test.uri!, path: metadata.compiledIn.fsPath };
          includeFiles.set(key, rec);
          // if there's any exclude in this file, we need to expand its tests so we can omit it.
          if (request.exclude?.some((t) => isParent(test, t))) {
            addTestsToFileRecord(
              rec,
              [...test.children].map(([, t]) => t),
            );
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
                  uri: test.uri!,
                  include: new Set(),
                };
                break;
              }
            }

            if (!record) {
              throw new Error(`could not find parent file for test ${test.id}`);
            }

            includeFiles.set(key, record);
          }

          record.include ??= new Set();

          if (!modernNamePatterns) {
            for (let f = test.parent; f; f = f.parent) {
              record.include.add(f.label);
            }
          }

          // Include the test without qualifications if its subtests will run
          // (with modernNamePatterns) and if there's not exclusions below.
          if (modernNamePatterns && !request.exclude?.some((t) => isParent(test, t))) {
            record.include.add(getFullTestName(test));
          } else {
            addTestsToFileRecord(record, [test]);
          }
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
    return [...includeFiles.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(
        (f): ITestRunFile => ({
          uri: f.uri.toString(),
          path: f.path,
          include: f.include ? [...f.include] : undefined,
        }),
      );
  }
}

function pathOrUriToUri(path: string): vscode.Uri | undefined {
  return isAbsolute(path)
    ? vscode.Uri.file(path)
    : // note: intentionally not using URL.canParse, since `node:internals` and
      // other things you don't expect could parse to URLs.
      path.includes("://")
      ? vscode.Uri.parse(path)
      : undefined;
}
