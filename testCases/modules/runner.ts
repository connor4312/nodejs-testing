import * as vscode from "vscode";
import { captureTestRun, expectTestTree, getController } from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [["hello.test.mjs", [["addition"]]]]);
});

it("runs tests", async () => {
  const c = await getController();
  const run = await captureTestRun(c, new vscode.TestRunRequest());

  run.expectStates({
    "hello.test.mjs/addition": ["started", "passed"],
  });
});
