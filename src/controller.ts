import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import picomatch from "picomatch";
import * as vscode from "vscode";
import { DisposableStore, MutableDisposable } from "./disposable";
import { last } from "./iterable";
import { getContainingItemsForFile, ICreateOpts, ItemType, testMetadata } from "./metadata";
import { IParsedNode, parseSource } from "./parsing";
import { TestRunner } from "./runner";
import { ISourceMapMaintainer, SourceMapStore } from "./source-map-store";

const diagnosticCollection = vscode.languages.createDiagnosticCollection("nodejs-testing-dupes");
const jsExtensions = ".{mjs,cjs,js}";

/** @see https://nodejs.org/api/test.html#test-runner-execution-model */
const testPatterns = [
  `**/{test,test-*,*.test,*-test,*_test}${jsExtensions}`,
  `**/test/**/*${jsExtensions}`,
];

const forceForwardSlashes = (p: string) => p.replace(/\\/g, "/");

export class Controller {
  private readonly disposable = new DisposableStore();
  private readonly watcher = this.disposable.add(new MutableDisposable());
  /** Include pattern for workspace foles. */
  private readonly pattern: vscode.RelativePattern;
  /** Pattern to check included files */
  private readonly includeTest: picomatch.Matcher;
  /** Promise that resolves when workspace files have been scanned */
  private initialFileScan?: Promise<void>;

  /** Mapping of the top-level tests found in each compiled */
  private readonly testsInFiles = new Map<
    /* uri */ string,
    {
      hash: number;
      sourceMap: ISourceMapMaintainer;
      items: Map<string, vscode.TestItem>;
    }
  >();

  constructor(
    public readonly ctrl: vscode.TestController,
    private readonly wf: vscode.WorkspaceFolder,
    private readonly smStore: SourceMapStore,
    runner: TestRunner,
    include: string[],
    exclude: string[]
  ) {
    include = include.map((p) => path.posix.normalize(forceForwardSlashes(p)));
    exclude = exclude.map((p) => path.posix.normalize(forceForwardSlashes(p)));

    const watcherGlob =
      include.length <= 1
        ? path.posix.join(include[0] || "./", `**/*${jsExtensions}`)
        : `{${include.join(",")}}/**/*${jsExtensions}`;
    this.pattern = new vscode.RelativePattern(wf, watcherGlob);

    this.includeTest = picomatch(
      include.flatMap((i) => testPatterns.map((tp) => path.posix.join(i, tp))),
      {
        ignore: exclude,
        cwd: wf.uri.fsPath,
        posixSlashes: true,
      }
    );

    ctrl.resolveHandler = this.resolveHandler();
    ctrl.refreshHandler = () => this.scanFiles();
    ctrl.createRunProfile(
      "Run",
      vscode.TestRunProfileKind.Run,
      runner.makeHandler(wf, ctrl, false),
      true
    );
    ctrl.createRunProfile(
      "Debug",
      vscode.TestRunProfileKind.Debug,
      runner.makeHandler(wf, ctrl, true),
      true
    );
  }

  public dispose() {
    this.disposable.dispose();
  }

  private resolveHandler() {
    return async (test?: vscode.TestItem) => {
      if (!test) {
        if (this.watcher.value) {
          await this.initialFileScan; // will have been set when the watcher was created
        } else {
          await this.startWatchingWorkspace();
        }
      }
    };
  }

  public syncFile(uri: vscode.Uri, contents?: () => string) {
    if (this.includeTest(uri.fsPath)) {
      this._syncFile(uri, contents?.());
    }
  }

  private async _syncFile(uri: vscode.Uri, contents?: string) {
    contents ??= await fs.readFile(uri.fsPath, "utf8");

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

    const smMaintainer = previous?.sourceMap ?? this.smStore.maintain(uri);
    const sourceMap = await smMaintainer.refresh(contents);
    const add = (
      parent: vscode.TestItem,
      node: IParsedNode,
      start: vscode.Location,
      end: vscode.Location
    ): vscode.TestItem => {
      let item = parent.children.get(node.name);
      if (!item) {
        item = this.ctrl.createTestItem(node.name, node.name, start.uri);
        testMetadata.set(item, { type: ItemType.Test });
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
      const file = last(this.getContainingItemsForFile(start.uri, { compiledFile: uri }))!.item!;
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

    this.testsInFiles.set(uri.toString(), { items: newTestsInFile, hash, sourceMap: smMaintainer });
  }

  private deleteFileTests(uri: vscode.Uri) {
    const previous = this.testsInFiles.get(uri.toString());
    if (!previous) {
      return;
    }

    this.testsInFiles.delete(uri.toString());
    for (const [id, item] of previous.items) {
      diagnosticCollection.delete(item.uri!);
      const itemsIt = this.getContainingItemsForFile(item.uri!);

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

  public async startWatchingWorkspace() {
    const watcher = (this.watcher.value = vscode.workspace.createFileSystemWatcher(this.pattern));

    watcher.onDidCreate((uri) => this.includeTest(uri.fsPath) && this._syncFile(uri));
    watcher.onDidChange((uri) => this.includeTest(uri.fsPath) && this._syncFile(uri));
    watcher.onDidDelete((uri) => this.includeTest(uri.fsPath) && this.deleteFileTests(uri));

    const promise = (this.initialFileScan = this.scanFiles());
    await promise;
  }

  private async scanFiles() {
    if (!this.watcher.value) {
      // starting the watcher will call this again
      return this.startWatchingWorkspace();
    }

    const toRemove = new Set(this.testsInFiles.keys());
    const todo = [];
    for (const file of await vscode.workspace.findFiles(this.pattern)) {
      if (this.includeTest(file.fsPath)) {
        todo.push(this._syncFile(file));
        toRemove.delete(file.toString());
      }
    }

    for (const uriStr of toRemove) {
      this.deleteFileTests(vscode.Uri.parse(uriStr));
    }

    if (this.testsInFiles.size === 0) {
      this.watcher.dispose(); // stop watching if there are no tests discovered
    }

    await Promise.all(todo);
  }

  /** Gets the test collection for a file of the given URI, descending from the root. */
  private getContainingItemsForFile(uri: vscode.Uri, createOpts?: ICreateOpts) {
    return getContainingItemsForFile(this.wf, this.ctrl, uri, createOpts);
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
