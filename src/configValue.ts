import * as vscode from "vscode";

const sectionName = "nodejs-testing";
const section = vscode.workspace.getConfiguration("nodejs-testing");

export class ConfigValue<T> {
  private readonly changeEmitter = new vscode.EventEmitter<T>();
  private readonly changeListener: vscode.Disposable;
  private _value: T;

  public readonly onChange = this.changeEmitter.event;

  public get value() {
    return this._value;
  }

  constructor(public readonly key: string, defaultValue: T) {
    this.changeListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${sectionName}.key`)) {
        this._value = section.get(key) ?? defaultValue;
      }
    });

    this._value = section.get(key) ?? defaultValue;
  }

  public dispose() {
    this.changeListener.dispose();
    this.changeEmitter.dispose();
  }
}
