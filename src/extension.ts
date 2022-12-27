import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { Controller } from "./controller";

export async function activate(context: vscode.ExtensionContext) {
  const includePattern = new ConfigValue("include", "**/*.{mjs,js}");
  const excludePatterns = new ConfigValue("exclude", ["**/node_modules/**"]);

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
            includePattern.value,
            excludePatterns.value
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
    includePattern.onChange(refreshFolders),
    excludePatterns.onChange(refreshFolders)
  );

  syncWorkspaceFolders();
  for (const editor of vscode.window.visibleTextEditors) {
    syncTextDocument(editor.document);
  }
}
