import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { Controller } from "./controller";
import { TestRunner } from "./runner";
import { SourceMapStore } from "./source-map-store";

export async function activate(context: vscode.ExtensionContext) {
  const smStore = new SourceMapStore();
  const includePattern = new ConfigValue("include", ["${workspaceFolder}"]);
  const excludePatterns = new ConfigValue("exclude", ["**/node_modules/**"]);
  const extensions = new ConfigValue("extensions", [
    {
      "extensions": ["mjs", "cjs", "js"],
      "parameters": []
    }]);

  const runner = new TestRunner(
    smStore,
    new ConfigValue("concurrency", 0),
    new ConfigValue("nodejsPath", "node"),
    context.extensionUri.fsPath,
    new ConfigValue("nodejsParameters", []),
    extensions);

  const ctrls = new Map<vscode.WorkspaceFolder, Controller>();
  const refreshFolders = () => {
    for (const ctrl of ctrls.values()) {
      ctrl.dispose();
    }
    ctrls.clear();
    syncWorkspaceFolders();
  };

  const syncWorkspaceFolders = () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      if (!ctrls.has(folder)) {
        ctrls.set(
          folder,
          new Controller(
            vscode.tests.createTestController(
              `nodejs-tests-${folder.name || folder.index}`,
              `node:test's in ${folder.name}`
            ),
            folder,
            smStore,
            runner,
            includePattern.value,
            excludePatterns.value,
            extensions.value
          )
        );
      }
    }

    for (const [folder, ctrl] of ctrls) {
      if (!folders.includes(folder)) {
        ctrl.dispose();
        ctrls.delete(folder);
      }
    }
  };

  const changesDebounce = new Map<string, NodeJS.Timeout>();
  const syncTextDocument = (document: vscode.TextDocument) => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (document.uri.scheme !== "file" || !folder) {
      return;
    }

    const debounce = changesDebounce.get(document.uri.toString());
    if (debounce) {
      clearTimeout(debounce);
    }

    changesDebounce.set(
      document.uri.toString(),
      setTimeout(() => {
        const ctrl = folder && ctrls.get(folder);
        ctrl?.syncFile(document.uri, () => document.getText());
      }, 300)
    );
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(syncWorkspaceFolders),
    vscode.workspace.onDidChangeTextDocument((e) => syncTextDocument(e.document)),
    vscode.commands.registerCommand("nodejs-testing.get-controllers-for-test", () => {
      refreshFolders();
      return ctrls;
    }),
    includePattern.onChange(refreshFolders),
    excludePatterns.onChange(refreshFolders),
    extensions.onChange(refreshFolders),
    new vscode.Disposable(() => ctrls.forEach((c) => c.dispose()))
  );

  syncWorkspaceFolders();
  for (const editor of vscode.window.visibleTextEditors) {
    syncTextDocument(editor.document);
  }
}

export function deactivate() { }
