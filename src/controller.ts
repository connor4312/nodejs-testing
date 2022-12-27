import { createHash } from "crypto";
import { readFile } from "fs/promises";
import * as path from "path";
import picomatch from "picomatch";
import * as vscode from "vscode";
import { DisposableStore } from "./disposable";
import { last } from "./iterable";
import { IParsedNode, parseSource } from "./parsing";
import { parseSourceMap } from "./source-map";

const diagnosticCollection = vscode.languages.createDiagnosticCollection("nodejs-testing-dupes");

export class Controller {
  private readonly disposable = new DisposableStore();
  private readonly includeTest: picomatch.Matcher;

  /** Mapping of the top-level tests found in each compiled */
  private readonly testsInFiles = new Map<
    /* uri */ string,
    {
      hash: number;
      items: Map<string, vscode.TestItem>;
    }
  >();

  constructor(
    private readonly ctrl: vscode.TestController,
    private readonly wf: vscode.WorkspaceFolder,
    private readonly include: string,
    exclude: string[]
  ) {
    this.includeTest = picomatch(include, {
      ignore: exclude,
      cwd: wf.uri.fsPath,
      posixSlashes: true,
    });

    ctrl.resolveHandler = this.resolveHandler();
    ctrl.createRunProfile("Run", vscode.TestRunProfileKind.Run, this.createRunHandler(false), true);
    ctrl.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      this.createRunHandler(true),
      true
    );
  }

  public dispose() {
    this.disposable.dispose();
  }

  private createRunHandler(debug: boolean) {
    return (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {};
  }

  private resolveHandler() {
    return async (test?: vscode.TestItem) => {
      if (!test) {
        await this.startWatchingWorkspace();
      }
    };
  }

  public syncFile(uri: vscode.Uri, contents?: () => string) {
    if (this.includeTest(uri.fsPath)) {
      this._syncFile(uri, contents?.());
    }
  }

  private async _syncFile(uri: vscode.Uri, contents?: string) {
    contents ??= await readFile(uri.fsPath, "utf8");

    // cheap test for relevancy:
    if (!contents.includes("node:test")) {
      this.deleteFileTests(uri);
      return;
    }

    // avoid re-parsing if the contents are the same (e.g. if a file is edited
    // and then saved.)
    const previous = this.testsInFiles.get(uri.toString());
    const hash = createHash("sha256").update(contents).digest().readInt32BE(0);
    if (hash === previous?.hash) {
      return;
    }

    const tree = parseSource(contents);
    if (!tree.length) {
      this.deleteFileTests(uri);
      return;
    }

    const sourceMap = await parseSourceMap(uri, contents);
    const add = (
      parent: vscode.TestItem,
      node: IParsedNode,
      start: vscode.Location,
      end: vscode.Location
    ): vscode.TestItem => {
      let item = parent.children.get(node.name);
      if (!item) {
        item = this.ctrl.createTestItem(node.name, node.name, start.uri);
        parent.children.add(item);
      }
      item.range = new vscode.Range(start.range.start, end.range.end);

      const seen = new Map<string, vscode.TestItem>();
      for (const child of node.children) {
        const existing = seen.get(child.name);
        const start = sourceMap.originalPositionFor(
          child.location.start.line,
          child.location.start.column
        );
        const end = sourceMap.originalPositionFor(
          child.location.end.line,
          child.location.end.column
        );
        if (existing) {
          addDuplicateDiagnostic(start, existing);
          continue;
        }

        seen.set(child.name, add(item, child, start, end));
      }

      for (const [id] of item.children) {
        if (!seen.has(id)) {
          item.children.delete(id);
        }
      }

      return item;
    };

    // We assume that all tests inside a top-leve describe/test are from the same
    // source file. This is probably a good assumption. Likewise we assume that a single
    // a single describe/test is not split between different files.
    const newTestsInFile = new Map<string, vscode.TestItem>();
    for (const node of tree) {
      const start = sourceMap.originalPositionFor(
        node.location.start.line,
        node.location.start.column
      );
      const end = sourceMap.originalPositionFor(node.location.end.line, node.location.end.column);
      const file = last(this.getContainingItemsForFile(start.uri, true))!.item!;
      diagnosticCollection.delete(start.uri);
      newTestsInFile.set(node.name, add(file, node, start, end));
    }

    if (previous) {
      for (const [id, test] of previous.items) {
        if (!newTestsInFile.has(id)) {
          (test.parent?.children ?? this.ctrl.items).delete(id);
        }
      }
    }

    this.testsInFiles.set(uri.toString(), { items: newTestsInFile, hash });
  }

  private deleteFileTests(uri: vscode.Uri) {
    const previous = this.testsInFiles.get(uri.toString());
    if (!previous) {
      return;
    }
    
    this.testsInFiles.delete(uri.toString());
    for (const [id, item] of previous.items) {
      diagnosticCollection.delete(item.uri!);
      const itemsIt = this.getContainingItemsForFile(item.uri!, false);

      // keep 'deleteFrom' as the node to remove if there are no nested children
      let deleteFrom: { items: vscode.TestItemCollection; id: string } | undefined;
      let last: vscode.TestItemCollection | undefined;
      for (const { children, item } of itemsIt) {
        if (item && children.size === 1) {
          deleteFrom ??= { items: last || this.ctrl.items, id: item.id };
        } else {
          deleteFrom = undefined;
        }

        last = children;
      }

      if (!last!.get(id)) {
        return;
      }

      if (deleteFrom) {
        deleteFrom.items.delete(deleteFrom.id);
      } else {
        last!.delete(id);
      }
    }
  }

  private async startWatchingWorkspace() {
    const pattern = new vscode.RelativePattern(this.wf, this.include);
    const watcher = this.disposable.add(vscode.workspace.createFileSystemWatcher(pattern));

    watcher.onDidCreate((uri) => this.includeTest(uri.fsPath) && this._syncFile(uri));
    watcher.onDidChange((uri) => this.includeTest(uri.fsPath) && this._syncFile(uri));
    watcher.onDidDelete((uri) => this.includeTest(uri.fsPath) && this.deleteFileTests(uri));

    for (const file of await vscode.workspace.findFiles(this.include)) {
      if (this.includeTest(file.fsPath)) {
        this._syncFile(file);
      }
    }
  }

  /** Gets the test collection for a file of the given URI, descending from the root. */
  private *getContainingItemsForFile(
    uri: vscode.Uri,
    create: boolean
  ): IterableIterator<{ children: vscode.TestItemCollection; item?: vscode.TestItem }> {
    const folderPath = this.wf.uri.path.split("/");
    const filePath = uri.path.split("/");

    let children = this.ctrl.items;
    yield { children };
    for (let i = folderPath.length; i < filePath.length; i++) {
      const existing = children.get(filePath[i]);
      if (existing) {
        children = existing.children;
        yield { children, item: existing };
      } else if (!create) {
        break;
      } else {
        const item = this.ctrl.createTestItem(
          filePath[i],
          filePath[i],
          uri.with({ path: filePath.slice(0, i + 1).join(path.sep) })
        );
        children.add(item);
        children = item.children;
        yield { children, item };
      }
    }
  }
}

const addDuplicateDiagnostic = (location: vscode.Location, existing: vscode.TestItem) => {
  const diagnostic = new vscode.Diagnostic(
    location.range,
    "Duplicate tests cannot be run individually and will not be reported correctly by the test framework. Please rename them.",
    vscode.DiagnosticSeverity.Warning
  );

  diagnostic.relatedInformation = [
    new vscode.DiagnosticRelatedInformation(
      new vscode.Location(existing.uri!, existing.range!),
      "First declared here"
    ),
  ];

  diagnosticCollection.set(
    location.uri,
    diagnosticCollection.get(location.uri)?.concat([diagnostic]) || [diagnostic]
  );
};
