import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  captureTestRun,
  expectTestTree,
  getController,
  onceChanged,
  saveAndRestoreWorkspace,
} from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [
    ["hello.test.js", [["math", [["addition"], ["subtraction"]]]]],
    ["otherFolder", [["some.test.js", [["addition"]]]]],
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
    const onChange = onceChanged(c);

    await fs.rm(path.join(__dirname, "workspace/hello.test.js"));
    await onChange;

    await expectTestTree(c, [
      ["otherFolder", [["some.test.js", [["addition"]]]]],
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
    const onChange = onceChanged(c);

    await fs.rm(path.join(__dirname, "workspace/test/inAFolder.js"));
    await onChange;

    await expectTestTree(c, [
      ["hello.test.js", [["math", [["addition"], ["subtraction"]]]]],
      ["otherFolder", [["some.test.js", [["addition"]]]]],
      ["test-WithADash.js", [["addition"]]],
      ["test.js", [["addition"]]],
      ["withADashTheOtherWay-test.js", [["addition"]]],
      ["withADot.test.js", [["addition"]]],
    ]);
  }));

it("handles file change", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();
    const onChange = onceChanged(c);

    await fs.writeFile(
      path.join(__dirname, "workspace/hello.test.js"),
      `
      const { test } = require("node:test");

      test("subtraction", () => {
        strictEqual(1 - 2, -1);
      });
    `,
    );
    await onChange;

    await expectTestTree(c, [
      ["hello.test.js", [["subtraction"]]],
      ["otherFolder", [["some.test.js", [["addition"]]]]],
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
    "withADashTheOtherWay-test.js/addition": ["started", "failed"],
    "hello.test.js/math": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    "hello.test.js/math/subtraction": ["started", "passed"],
    "otherFolder/some.test.js/addition": ["started", "passed"],
    "withADot.test.js/addition": ["started", "passed"],
  });
});

it("runs tests in directory", async () => {
  const c = await getController();
  const run = await captureTestRun(c, new vscode.TestRunRequest([c.ctrl.items.get("test")!]));

  run.expectStates({
    "test/inAFolder.js/addition": ["started", "passed"],
  });
});

it("runs tests in a file", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest([
      c.ctrl.items.get("hello.test.js")!,
      c.ctrl.items.get("withADot.test.js")!,
    ]),
  );

  run.expectStates({
    "hello.test.js/math": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    "hello.test.js/math/subtraction": ["started", "passed"],
    "withADot.test.js/addition": ["started", "passed"],
  });
});

it("runs subsets of tests", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest([
      c.ctrl.items.get("hello.test.js")!.children.get("math")!.children.get("addition")!,
    ]),
  );

  run.expectStates({
    "hello.test.js/math": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    // note: skipped should work once nodejs/node#51577 is out
    "hello.test.js/math/subtraction": ["started", "passed"],
    // "hello.test.js/math/subtraction": ["started", "skipped"],
  });
});

it("runs mixed test requests", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest([
      c.ctrl.items.get("hello.test.js")!.children.get("math")!.children.get("addition")!,
      c.ctrl.items.get("withADot.test.js")!,
      c.ctrl.items.get("test")!,
    ]),
  );

  run.expectStates({
    "test/inAFolder.js/addition": ["started", "passed"],
    "hello.test.js/math": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    // note: skipped should work once nodejs/node#51577 is out
    "hello.test.js/math/subtraction": ["started", "passed"],
    // "hello.test.js/math/subtraction": ["started", "skipped"],
    "withADot.test.js/addition": ["started", "passed"],
  });
});

it("handles test excludes", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest(
      [c.ctrl.items.get("hello.test.js")!],
      [c.ctrl.items.get("hello.test.js")!.children.get("math")!.children.get("subtraction")!],
    ),
  );

  run.expectStates({
    "hello.test.js/math": ["started", "passed"],
    "hello.test.js/math/addition": ["started", "passed"],
    // note: skipped should work once nodejs/node#51577 is out
    "hello.test.js/math/subtraction": ["started", "passed"],
    // "hello.test.js/math/subtraction": ["started", "skipped"],
  });
});

it("handles file and directory excludes", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest(undefined, [
      c.ctrl.items.get("hello.test.js")!,
      c.ctrl.items.get("test")!,
    ]),
  );

  run.expectStates({
    "otherFolder/some.test.js/addition": ["started", "passed"],
    "test-WithADash.js/addition": ["started", "passed"],
    "test.js/addition": ["started", "passed"],
    "withADashTheOtherWay-test.js/addition": ["started", "failed"],
    "withADot.test.js/addition": ["started", "passed"],
  });
});

it("shows test output", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest([c.ctrl.items.get("hello.test.js")!]),
  );

  const uri = vscode.Uri.file(path.join(__dirname, "workspace", "hello.test.js"));

  // todo@connor4312: this is needed because vscode caches these values on
  // underscore properties, and if they are not computed the assertion fails
  // https://github.com/microsoft/vscode/issues/174680
  uri.toString();
  uri.fsPath;

  assert.deepStrictEqual(run.output.filter(o => !!o.location), [
    {
      output: "some log\r\n",
      location: new vscode.Location(uri, new vscode.Position(5, 13)),
      test: undefined,
    },
    {
      output: "another log",
      location: new vscode.Location(uri, new vscode.Position(10, 20)),
      test: undefined,
    },
  ]);
});

describe("exclude/include settings", () => {
  const doUpdate = async (key: string, value: any) => {
    const promise = new Promise<void>((resolve) => {
      const l = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`nodejs-testing.${key}`)) {
          setTimeout(resolve, 0);
          l.dispose();
        }
      });
    });
    vscode.workspace
      .getConfiguration("nodejs-testing")
      .update(key, value, vscode.ConfigurationTarget.Workspace);
    return promise;
  };

  afterEach(async () => {
    await Promise.any([doUpdate("exclude", undefined), doUpdate("include", undefined)]);
  });

  it("excludes directory", async () => {
    await doUpdate("exclude", ["./test", "**/node_modules/**"]);
    const c = await getController();
    assert.strictEqual(c.ctrl.items.get("test"), undefined);
  });

  it("excludes glob", async () => {
    await doUpdate("exclude", ["**/*.test.js"]);
    const c = await getController();
    await expectTestTree(c, [
      ["test", [["inAFolder.js", [["addition"]]]]],
      ["test-WithADash.js", [["addition"]]],
      ["test.js", [["addition"]]],
      ["withADashTheOtherWay-test.js", [["addition"]]],
    ]);
  });

  it("excludes file", async () => {
    await doUpdate("exclude", ["test-WithADash.js"]);
    const c = await getController();
    assert.strictEqual(c.ctrl.items.get("test-WithADash.js"), undefined);
  });

  it("excludes absolute file", async () => {
    await doUpdate("exclude", [path.join(__dirname, "workspace", "test-WithADash.js")]);
    const c = await getController();
    assert.strictEqual(c.ctrl.items.get("test-WithADash.js"), undefined);
  });

  it("sets include folder", async () => {
    await doUpdate("include", ["./otherFolder"]);
    const c = await getController();
    await expectTestTree(c, [["otherFolder", [["some.test.js", [["addition"]]]]]]);
  });

  it("includes multiple", async () => {
    // tests an extra glob path
    const target = path.join(__dirname, "workspace", "yetAnotherFolder");
    await fs.cp(path.join(__dirname, "workspace", "otherFolder"), target, {
      recursive: true,
      force: true,
    });
    try {
      await doUpdate("include", ["./otherFolder", "./yetAnotherFolder"]);
      const c = await getController();

      await expectTestTree(c, [
        ["otherFolder", [["some.test.js", [["addition"]]]]],
        ["yetAnotherFolder", [["some.test.js", [["addition"]]]]],
      ]);

      // check watcher works:
      const onChange = onceChanged(c);
      await fs.writeFile(
        path.join(target, "some.test.js"),
        `
          const { test } = require("node:test");

          test("subtraction", () => {
            strictEqual(1 - 2, -1);
          });
        `,
      );
      await onChange;
      await expectTestTree(c, [
        ["otherFolder", [["some.test.js", [["addition"]]]]],
        ["yetAnotherFolder", [["some.test.js", [["subtraction"]]]]],
      ]);
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
