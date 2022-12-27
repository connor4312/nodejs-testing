import * as vscode from "vscode";
export class DisposableStore {
  private disposables: vscode.Disposable[] | undefined = [];

  public add<T extends vscode.Disposable>(disposable: T): T {
    if (!this.disposables) {
      disposable.dispose();
    } else {
      this.disposables.push(disposable);
    }
    return disposable;
  }

  public dispose() {
    if (this.disposables) {
      for (const disposable of this.disposables) {
        disposable.dispose();
      }
      this.disposables = undefined;
    }
  }
}
