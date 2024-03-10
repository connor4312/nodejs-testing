/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { spawn } from "child_process";
import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { DisposableStore } from "./disposable";

export class Pretest implements vscode.Disposable {
  private lastRun = Promise.resolve(true);

  constructor(private readonly cmd: ConfigValue<string[] | undefined>) {}

  /**
   * Runs the pretest script in the working directory, returning true if
   * it was run successfully.
   */
  public run(cwd: string, run: vscode.TestRun, token: vscode.CancellationToken) {
    const cmd = this.cmd.value;
    if (!cmd?.length) {
      return Promise.resolve(true);
    }

    return (this.lastRun = this.lastRun.then(() =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Running pretest script...",
        },
        () => this.spawn(run, cmd, cwd, token),
      ),
    ));
  }

  private spawn(run: vscode.TestRun, cmd: string[], cwd: string, token: vscode.CancellationToken) {
    run.appendOutput(formatMessage(`Running pretest script: ${cmd.join(" ")}`) + crlf);

    const runDisposables = new DisposableStore();
    const prom = new Promise<boolean>((resolve) => {
      const cp = spawn(cmd[0], cmd.slice(1), { stdio: "pipe", cwd });
      runDisposables.add(
        token.onCancellationRequested(() => {
          run.appendOutput(formatMessage("The test run was cancelled before pretest finished"));
          resolve(false);
          cp.kill();
        }),
      );
      cp.stdout.setEncoding("utf8").on("data", (d) => run.appendOutput(d));
      cp.stderr.setEncoding("utf8").on("data", (d) => run.appendOutput(d));
      cp.on("error", (err) => {
        run.appendOutput(err.message.replace(/\n/g, "\r\n"));
        resolve(false);
      });
      cp.on("exit", (code) => {
        run.appendOutput(crlf + formatMessage(`Pretest exited with code ${code}`) + crlf);
        resolve(code === 0);
      });
    });

    prom.finally(() => runDisposables.dispose());

    return prom;
  }

  /** @inheritdoc */
  public dispose() {
    this.cmd.dispose();
  }
}

const crlf = "\r\n";
const formatMessage = (message: string) => `\x1b[0m\x1b[7m * \x1b[0m ${message} \x1b[0m\n\r`;
