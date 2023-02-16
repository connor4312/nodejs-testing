import * as inspector from "inspector";
import Mocha from "mocha";
import * as path from "path";
import vscode from "vscode";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    bail: true,
    timeout: inspector.url() ? Infinity : 5000,
  });

  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    throw new Error("expected to have open workspace folder");
  }

  return new Promise((c, e) => {
    try {
      mocha.addFile(path.resolve(workspace.uri.fsPath, "../runner.js"));
      mocha.run((failures: number) => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err);
    }
  });
}
