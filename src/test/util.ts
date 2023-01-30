import * as vscode from "vscode";
import type { Controller } from "../controller";
import { expect } from 'chai';

export const getController = async () => {
  const c = await vscode.commands.executeCommand<Map<vscode.WorkspaceFolder, Controller>>(
    "nodejs-testing.get-controllers-for-test"
  );

  if (!c.size) {
    throw new Error("no controllers registered");
  }

  return c.values().next().value as Controller;
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

export const expectTestTree = async ({ ctrl }: Controller, tree: TestTreeExpectation[]) => {
  const e = ["root", []] satisfies TestTreeExpectation;
  buildTreeExpectation(e, ctrl.items);
  expect(e[1]).to.deep.equal(tree);
};
