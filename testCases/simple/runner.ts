import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  captureTestRun,
  expectTestTree,
  getController,
  onceChanced,
  saveAndRestoreWorkspace,
} from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [
    ["hello.test.js", [["math", [["addition"], ["subtraction"]]]]],
    ["test", [["inAFolder.js", [["addition"]]]]],
    ["test-WithADash.js", [["addition"]]],
    ["test.js", [["addition"]]],
    ["withADashTheOtherWay-test.js", [["addition"]]],
    ["withADot.test.js", [["addition"]]],
  ]);
});

it("handles file delete", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();
    const onChange = onceChanced(c);

    await fs.rm(path.join(__dirname, "workspace/hello.test.js"));
    await onChange;

    await expectTestTree(c, [
      ["test", [["inAFolder.js", [["addition"]]]]],
      ["test-WithADash.js", [["addition"]]],
      ["test.js", [["addition"]]],
      ["withADashTheOtherWay-test.js", [["addition"]]],
      ["withADot.test.js", [["addition"]]],
    ]);
  }));

it("cleans up folder if all child files are deleted", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();
    const onChange = onceChanced(c);

    await fs.rm(path.join(__dirname, "workspace/test/inAFolder.js"));
    await onChange;

    await expectTestTree(c, [
      ["hello.test.js", [["math", [["addition"], ["subtraction"]]]]],
      ["test-WithADash.js", [["addition"]]],
      ["test.js", [["addition"]]],
      ["withADashTheOtherWay-test.js", [["addition"]]],
      ["withADot.test.js", [["addition"]]],
    ]);
  }));

it("handles file change", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();
    const onChange = onceChanced(c);

    await fs.writeFile(
      path.join(__dirname, "workspace/hello.test.js"),
      `
      const { test } = require("node:test");

      test("subtraction", () => {
        strictEqual(1 - 2, -1);
      });
    `
    );
    await onChange;

    await expectTestTree(c, [
      ["hello.test.js", [["subtraction"]]],
      ["test", [["inAFolder.js", [["addition"]]]]],
      ["test-WithADash.js", [["addition"]]],
      ["test.js", [["addition"]]],
      ["withADashTheOtherWay-test.js", [["addition"]]],
      ["withADot.test.js", [["addition"]]],
    ]);
  }));

it("runs tests", async () => {
  const c = await getController();
  const run = await captureTestRun(c, new vscode.TestRunRequest());

  run.expectStates({
    "test/inAFolder.js/addition": ["started", "passed"],
    "test-WithADash.js/addition": ["started", "passed"],
    "test.js/addition": ["started", "passed"],
    "withADashTheOtherWay-test.js/addition": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    "hello.test.js/math/subtraction": ["started", "passed"],
    "withADot.test.js/addition": ["started", "passed"],
  });
});
