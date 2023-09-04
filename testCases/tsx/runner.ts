import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { captureTestRun, expectTestTree, getController } from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [["hello.test.mts", [["addition"], ["bad addition"]]]]);
});

it("runs tests", async () => {
  const c = await getController();
  const run = await captureTestRun(c, new vscode.TestRunRequest());

  const uri = vscode.Uri.file(path.join(__dirname, "workspace", "hello.test.mts"));
  assert.deepStrictEqual(
    run.output.filter((o) => !!o.test),
    [
      {
        output: "some log\r\n",
        location: new vscode.Location(uri, new vscode.Position(4, 10)),
        test: c.ctrl.items.get("hello.test.mts")!.children.get("addition"),
      },
    ],
  );

  const message = vscode.TestMessage.diff(
    "Expected values to be strictly equal:\n\n2 !== 4",
    "4",
    "2",
  );
  message.location = new vscode.Location(uri, new vscode.Position(9, 2));

  assert.deepStrictEqual(run.terminalStates(), [
    {
      test: c.ctrl.items.get("hello.test.mts")!.children.get("addition"),
      state: "passed",
    },
    {
      test: c.ctrl.items.get("hello.test.mts")!.children.get("bad addition"),
      state: "failed",
      message,
    },
  ]);
});
