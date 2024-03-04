import ansiColors from "ansi-colors";
import * as vscode from "vscode";
import { ItemType, testMetadata } from "./metadata";

export interface IStyle {
  started(test: vscode.TestItem): string;
  skipped(test: vscode.TestItem): string;
  passed(test: vscode.TestItem): string;
  failed(test: vscode.TestItem, message: string): string;
  done(): string;
}

export const enum Style {
  Dot = "dot",
  Spec = "spec",
}

export const styleFactories: { [K in Style]: () => IStyle } = {
  [Style.Dot]: () => new DotStyle(),
  [Style.Spec]: () => new SpecStyle(),
};

export class DotStyle implements IStyle {
  private _failed = 0;
  private _pass = 0;
  private _col = 0;

  started(): string {
    return "";
  }
  skipped(): string {
    return this.status(ansiColors.grey("s"));
  }
  passed(): string {
    this._pass++;
    return this.status(ansiColors.grey("."));
  }
  failed(): string {
    this._failed++;
    return this.status(ansiColors.red("x"));
  }
  done(): string {
    return `\r\n\r\n${this._pass}/${this._pass + this._failed} tests passed\r\n`;
  }

  private status(icon: string) {
    if (this._col++ === 80) {
      this._col = 0;
      return `\r\n${icon}`;
    }

    return icon;
  }
}

export class SpecStyle implements IStyle {
  private _failed = 0;
  private _pass = 0;

  started(): string {
    return "";
  }
  skipped(test: vscode.TestItem): string {
    return this.specLine(test, ansiColors.gray("•"));
  }
  passed(test: vscode.TestItem): string {
    this._pass++;
    return this.specLine(test, ansiColors.green("✓"));
  }
  failed(test: vscode.TestItem, message: string): string {
    this._failed++;
    return this.specLine(test, ansiColors.red("X"));
  }
  done(): string {
    return `\r\n\r\n${this._pass}/${this._pass + this._failed} tests passed\r\n`;
  }

  private specLine(test: vscode.TestItem, icon: string) {
    let indent = 0;
    for (let p = test.parent; p; p = p.parent) {
      if (testMetadata.get(p)?.type !== ItemType.Test) {
        break;
      }
      indent++;
    }

    return `${"  ".repeat(indent)}${icon} ${test.label}\r\n`;
  }
}
