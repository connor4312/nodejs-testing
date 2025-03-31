import * as vscode from "vscode";
import { ConfigValue } from "./configValue";
import { Controller } from "./controller";
import { TestRunner } from "./runner";
import { SourceMapStore } from "./source-map-store";
import { defaultTestFunctionSpecifiers } from "./test-function-specifier-config";

export async function activate(context: vscode.ExtensionContext) {
  const smStore = new SourceMapStore();
  const includePattern = new ConfigValue("include", ["${workspaceFolder}"]);
  const excludePatterns = new ConfigValue("exclude", ["**/node_modules/**"]);
  const extensions = new ConfigValue("extensions", [
    {
      extensions: ["mjs", "cjs", "js"],
      parameters: [],
    },
  ]);

  const testSpecifiers = new ConfigValue("testSpecifiers", defaultTestFunctionSpecifiers);

  const ctrls = new Map<vscode.WorkspaceFolder, Controller>();
  const refreshFolders = () => {
    for (const ctrl of ctrls.values()) {
      ctrl.dispose();
    }
    ctrls.clear();
    syncWorkspaceFolders();
  };

  const syncWorkspaceFolders = () => {
    if (!extensions.value?.length) {
      const msg =
        "nodejs-testing.extensions array is empty. Please remove the setting 'nodejs-testing.extensions' or define at least one element.";
      vscode.window.showErrorMessage(msg);
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      if (!ctrls.has(folder)) {
        const runner = new TestRunner(folder, smStore, context.extensionUri.fsPath, extensions);
        ctrls.set(
          folder,
          new Controller(
            vscode.tests.createTestController(
              `nodejs-tests-${folder.name || folder.index}`,
              `node:test's in ${folder.name}`,
            ),
            folder,
            smStore,
            runner,
            includePattern.value,
            excludePatterns.value,
            extensions.value,
            testSpecifiers.value,
          ),
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
      }, 300),
    );
  };

  function updateSnapshots() {
    TestRunner.regenerateSnapshotsOnNextRun = true;
    return vscode.commands.executeCommand("testing.reRunFailTests");
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(syncWorkspaceFolders),
    vscode.workspace.onDidChangeTextDocument((e) => syncTextDocument(e.document)),
    vscode.commands.registerCommand("nodejs-testing.get-controllers-for-test", () => {
      refreshFolders();
      return ctrls;
    }),
    vscode.commands.registerCommand("nodejs-testing.pre-rerun-with-snapshot-for-test", () => {
      TestRunner.regenerateSnapshotsOnNextRun = true;
    }),
    vscode.commands.registerCommand("nodejs-testing.rerunWithSnapshot", updateSnapshots),
    vscode.commands.registerCommand("nodejs-testing.rerunWithSnapshot2", updateSnapshots),
    includePattern.onChange(refreshFolders),
    excludePatterns.onChange(refreshFolders),
    extensions.onChange(refreshFolders),
    testSpecifiers.onChange(refreshFolders),
    new vscode.Disposable(() => ctrls.forEach((c) => c.dispose())),
  );

  syncWorkspaceFolders();
  for (const editor of vscode.window.visibleTextEditors) {
    syncTextDocument(editor.document);
  }
}

export function deactivate() {}
