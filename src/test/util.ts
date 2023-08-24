import * as assert from "assert";
import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import * as sinon from "sinon";
import { setTimeout } from "timers/promises";
import * as vscode from "vscode";
import type { Controller } from "../controller";

export const getController = async () => {
  const c = await vscode.commands.executeCommand<Map<vscode.WorkspaceFolder, Controller>>(
    "nodejs-testing.get-controllers-for-test",
  );

  if (!c.size) {
    throw new Error("no controllers registered");
  }

  const controller = c.values().next().value as Controller;
  await controller.startWatchingWorkspace();
  return controller;
};

type TestTreeExpectation = [string, TestTreeExpectation[]?];

const buildTreeExpectation = (entry: TestTreeExpectation, c: vscode.TestItemCollection) => {
  for (const [id, { children }] of c) {
    const node: TestTreeExpectation = [id];
    buildTreeExpectation(node, children);
    if (entry.length === 1) {
      entry[1] = [node];
    } else {
      entry[1]!.push(node);
    }
  }

  entry[1]?.sort(([a], [b]) => a.localeCompare(b));
};

export const onceChanged = (controller: Controller) =>
  new Promise<void>((resolve) => {
    const l = controller.onDidChange(() => {
      l.dispose();
      resolve();
    });
  });

export const expectTestTree = async ({ ctrl }: Controller, tree: TestTreeExpectation[]) => {
  const e = ["root", []] satisfies TestTreeExpectation;
  buildTreeExpectation(e, ctrl.items);
  assert.deepStrictEqual(e[1], tree);
};

export const saveAndRestoreWorkspace = async (cwd: string, fn: () => unknown) => {
  const original = path.join(cwd, "workspace");
  const backup = path.join(tmpdir(), `nodejs-test-backup-${randomBytes(8).toString("hex")}`);

  await fs.cp(original, backup, { recursive: true });

  try {
    await fn();
  } finally {
    // vscode behaves badly when we delete the workspace folder; delete contents instead.
    const files = await fs.readdir(original);
    await Promise.all(
      files.map((f) => fs.rm(path.join(original, f), { recursive: true, force: true })),
    );

    await fs.cp(backup, original, { recursive: true });
    await fs.rm(backup, { recursive: true, force: true });

    // it seems like all these files changes can require a moment for vscode's file
    // watcher to update before we can run the next test. 500 seems to do it 🤷‍♂️
    await setTimeout(500);
  }
};

type TestState = "enqueued" | "started" | "skipped" | "failed" | "errored" | "passed";

export class FakeTestRun implements vscode.TestRun {
  public output: { output: string; location?: vscode.Location; test?: vscode.TestItem }[] = [];
  public states: { test: vscode.TestItem; state: TestState; message?: vscode.TestMessage }[] = [];
  public ended = false;

  public expectStates(expected: { [test: string]: TestState[] }) {
    const actual: { [test: string]: TestState[] } = {};
    for (const { test, state } of this.states) {
      let key = test.id;
      for (let p = test.parent; p; p = p.parent) {
        key = `${p.id}/${key}`;
      }
      (actual[key] ??= []).push(state);
    }

    assert.deepStrictEqual(actual, expected, JSON.stringify(actual));
  }

  //#region fake implementation
  public readonly name = undefined;
  public readonly token = new vscode.CancellationTokenSource().token;
  public readonly isPersisted = true;

  enqueued(test: vscode.TestItem): void {
    this.states.push({ test, state: "enqueued" });
  }
  started(test: vscode.TestItem): void {
    this.states.push({ test, state: "started" });
  }
  skipped(test: vscode.TestItem): void {
    this.states.push({ test, state: "skipped" });
  }
  failed(
    test: vscode.TestItem,
    message: vscode.TestMessage | readonly vscode.TestMessage[],
    _duration?: number | undefined,
  ): void {
    this.states.push({
      test,
      state: "failed",
      message: message instanceof Array ? message[0] : message,
    });
  }
  errored(
    test: vscode.TestItem,
    message: vscode.TestMessage | readonly vscode.TestMessage[],
    _duration?: number | undefined,
  ): void {
    this.states.push({
      test,
      state: "errored",
      message: message instanceof Array ? message[0] : message,
    });
  }
  passed(test: vscode.TestItem, _duration?: number | undefined): void {
    this.states.push({ test, state: "passed" });
  }
  appendOutput(
    output: string,
    location?: vscode.Location | undefined,
    test?: vscode.TestItem | undefined,
  ): void {
    this.output.push({ output, location, test });
  }
  end(): void {
    this.ended = true;
  }
  //#endregion
}

export const captureTestRun = async (ctrl: Controller, req: vscode.TestRunRequest) => {
  const fake = new FakeTestRun();
  const createTestRun = sinon.stub(ctrl.ctrl, "createTestRun").returns(fake);
  try {
    await ctrl.runHandler(req, new vscode.CancellationTokenSource().token);
    return fake;
  } finally {
    createTestRun.restore();
  }
};
