import * as path from "path";
import * as vscode from "vscode";

export const enum ItemType {
  Directory,
  File,
  Test,
}

export type ItemMetadata =
  | { type: ItemType.Directory | ItemType.Test }
  | { type: ItemType.File; compiledIn: vscode.Uri };

export const testMetadata = new WeakMap<vscode.TestItem, ItemMetadata>();

export interface ICreateOpts {
  compiledFile: vscode.Uri;
}

/** Gets the test collection for a file of the given URI, descending from the root. */
export function* getContainingItemsForFile(
  wf: vscode.WorkspaceFolder,
  ctrl: vscode.TestController,
  uri: vscode.Uri,
  createOpts?: ICreateOpts,
): IterableIterator<{ children: vscode.TestItemCollection; item?: vscode.TestItem }> {
  const folderPath = wf.uri.path.split("/");
  const filePath = uri.path.split("/");

  let children = ctrl.items;
  yield { children };
  for (let i = folderPath.length; i < filePath.length; i++) {
    const existing = children.get(filePath[i]);
    if (existing) {
      children = existing.children;
      yield { children, item: existing };
    } else if (!createOpts) {
      break;
    } else {
      const item = ctrl.createTestItem(
        filePath[i],
        filePath[i],
        uri.with({ path: filePath.slice(0, i + 1).join(path.sep) }),
      );
      testMetadata.set(
        item,
        i === filePath.length - 1
          ? { type: ItemType.File, compiledIn: createOpts.compiledFile }
          : { type: ItemType.Directory },
      );
      children.add(item);
      children = item.children;
      yield { children, item };
    }
  }
}
