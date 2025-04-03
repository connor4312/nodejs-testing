import * as assert from "assert";
import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  captureTestRun,
  expectTestTree,
  getController,
  getNodeVersion,
  onceChanged,
  saveAndRestoreWorkspace,
} from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [
    ["hello.test.js", [["math", [["addition"]]], ["math", [["subtraction"]]]]],
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
      ["hello.test.js", [["math", [["addition"]]], ["math", [["subtraction"]]]]],
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
    "hello.test.js/math": ["started", "passed", "started", "passed"],
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
    "hello.test.js/math": ["started", "passed", "started", "passed"],
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

  const nodeVersion = getNodeVersion();
  if (nodeVersion < 22) {
    run.expectStates({
      "hello.test.js/math": ["started", "passed", "started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
      // did not work in earlier versions due to nodejs/node#51577
      "hello.test.js/math/subtraction": ["started", "passed"],
    });
  } else {
    run.expectStates({
      "hello.test.js/math": ["started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
    });
  }
});
console.log("node verison==", getNodeVersion());

if (getNodeVersion() >= 22) {
  const snapshotFile = path.join(__dirname, "workspace", "snapshot.test.js.snapshot");

  const snapshotTestFile = path.join(__dirname, "workspace", "snapshot.test.js");
  const snapshotTestContents = `const { suite, test } = require("node:test");

  suite('suite of snapshot tests', () => {
    test('snapshot test', (t) => {
      t.assert.snapshot({ value1: 1, value2: 2 });
      t.assert.snapshot(5);
    });
  });
  `;

  describe("snapshot tests", () => {
    beforeEach(async () => {
      await fs.writeFile(snapshotTestFile, snapshotTestContents);
    });

    afterEach(async () => {
      await fs.rm(snapshotFile, { force: true });
      await fs.rm(snapshotTestFile, { force: true });
    });

    it("generates snapshots", async () => {
      const c = await getController();
      const run1 = await captureTestRun(
        c,
        new vscode.TestRunRequest([c.ctrl.items.get("snapshot.test.js")]),
      );
      run1.expectStates({
        "snapshot.test.js/suite of snapshot tests": ["started", "failed"],
        "snapshot.test.js/suite of snapshot tests/snapshot test": ["started", "failed"],
      });

      await vscode.commands.executeCommand("nodejs-testing.pre-rerun-with-snapshot-for-test");
      const run2 = await captureTestRun(
        c,
        new vscode.TestRunRequest([c.ctrl.items.get("snapshot.test.js")]),
      );

      run2.expectStates({
        "snapshot.test.js/suite of snapshot tests": ["started", "passed"],
        "snapshot.test.js/suite of snapshot tests/snapshot test": ["started", "passed"],
      });
      assert.doesNotThrow(() => {
        readFileSync(path.join(__dirname, "workspace", "snapshot.test.js.snapshot"));
      });
    });

    it("updates incorrect snapshots", async () => {
      const c = await getController();

      await vscode.commands.executeCommand("nodejs-testing.pre-rerun-with-snapshot-for-test");
      await captureTestRun(c, new vscode.TestRunRequest([c.ctrl.items.get("snapshot.test.js")]));

      const original = await fs.readFile(snapshotFile, "utf8");
      await fs.writeFile(snapshotFile, original.replace("value2", "value3"));

      const run1 = await captureTestRun(
        c,
        new vscode.TestRunRequest([c.ctrl.items.get("snapshot.test.js")]),
      );
      run1.expectStates({
        "snapshot.test.js/suite of snapshot tests": ["started", "failed"],
        "snapshot.test.js/suite of snapshot tests/snapshot test": ["started", "failed"],
      });

      await vscode.commands.executeCommand("nodejs-testing.pre-rerun-with-snapshot-for-test");
      const run2 = await captureTestRun(
        c,
        new vscode.TestRunRequest([c.ctrl.items.get("snapshot.test.js")]),
      );
      run2.expectStates({
        "snapshot.test.js/suite of snapshot tests": ["started", "passed"],
        "snapshot.test.js/suite of snapshot tests/snapshot test": ["started", "passed"],
      });

      assert.strictEqual(await fs.readFile(snapshotFile, "utf8"), original);
    });
  });
}

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

  const nodeVersion = getNodeVersion();
  if (nodeVersion < 22) {
    run.expectStates({
      "test/inAFolder.js/addition": ["started", "passed"],
      "hello.test.js/math": ["started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
      // did not work in earlier versions due to nodejs/node#51577
      "hello.test.js/math/subtraction": ["started", "passed"],
      "withADot.test.js/addition": ["started", "passed"],
    });
  } else {
    run.expectStates({
      "test/inAFolder.js/addition": ["started", "passed"],
      "hello.test.js/math": ["started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
      "withADot.test.js/addition": ["started", "passed"],
    });
  }
});

it("handles test excludes", async () => {
  const c = await getController();
  const run = await captureTestRun(
    c,
    new vscode.TestRunRequest(
      [c.ctrl.items.get("hello.test.js")!],
      [c.ctrl.items.get("hello.test.js")!.children.get("math#0")!.children.get("subtraction")!],
    ),
  );

  const nodeVersion = getNodeVersion();
  if (nodeVersion < 22) {
    run.expectStates({
      "hello.test.js/math": ["started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
      // did not work in earlier versions due to nodejs/node#51577
      "hello.test.js/math/subtraction": ["started", "passed"],
    });
  } else {
    run.expectStates({
      "hello.test.js/math": ["started", "passed"],
      "hello.test.js/math/addition": ["started", "passed"],
    });
  }
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

  assert.deepStrictEqual(
    run.output.filter((o) => !!o.location),
    [
      {
        output: "some log\r\n",
        location: new vscode.Location(uri, new vscode.Position(5, 13)),
        test: undefined,
      },
      {
        output: "another log",
        location: new vscode.Location(uri, new vscode.Position(12, 20)),
        test: undefined,
      },
    ],
  );
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
