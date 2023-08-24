import * as vscode from "vscode";

const sectionName = "nodejs-testing";

export class ConfigValue<T> {
  private readonly changeEmitter = new vscode.EventEmitter<T>();
  private readonly changeListener: vscode.Disposable;
  private _value: T;

  public readonly onChange = this.changeEmitter.event;

  public get value() {
    return this._value;
  }

  public get key() {
    return `${sectionName}.${this.sectionKey}`;
  }

  constructor(
    private readonly sectionKey: string,
    defaultValue: T,
  ) {
    this.changeListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(this.key)) {
        this._value =
          vscode.workspace.getConfiguration(sectionName).get(sectionKey) ?? defaultValue;
        this.changeEmitter.fire(this._value);
      }
    });

    this._value = vscode.workspace.getConfiguration(sectionName).get(sectionKey) ?? defaultValue;
  }

  public dispose() {
    this.changeListener.dispose();
    this.changeEmitter.dispose();
  }
}
