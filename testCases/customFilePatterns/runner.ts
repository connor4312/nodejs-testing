import * as vscode from "vscode";
import { captureTestRun, expectTestTree, getController } from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [["hello.spec.mjs", [["addition"], ["bad addition"]]]]);
});

it("runs tests", async () => {
  const c = await getController();
  const run = await captureTestRun(c, new vscode.TestRunRequest());

  run.expectStates({
    "hello.spec.mjs/addition": ["started", "passed"],
    "hello.spec.mjs/bad addition": ["started", "failed"],
  });
});
