import { promises as fs } from "fs";
import * as path from "path";
import {
  expectTestTree,
  getController,
  onceChanced,
  saveAndRestoreWorkspace,
} from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();

  await expectTestTree(c, [
    ["src", [["example.test.ts", [["math", [["addition"], ["subtraction"]]]]]]],
  ]);
});

it("discovers new file", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();

    const onChange = onceChanced(c);

    await fs.cp(
      path.join(__dirname, "fixtures/another.test.js"),
      path.join(__dirname, "workspace/out/another.test.js")
    );
    await fs.cp(
      path.join(__dirname, "fixtures/another.test.js.map"),
      path.join(__dirname, "workspace/out/another.test.js.map")
    );
    await onChange;

    await expectTestTree(c, [
      [
        "src",
        [
          ["another.test.ts", [["addition"]]],
          ["example.test.ts", [["math", [["addition"], ["subtraction"]]]]],
        ],
      ],
    ]);
  }));

it("handles file deletion", () =>
  saveAndRestoreWorkspace(__dirname, async () => {
    const c = await getController();

    const onChange = onceChanced(c);

    await fs.rm(path.join(__dirname, "workspace/out/example.test.js"));
    await fs.rm(path.join(__dirname, "workspace/out/example.test.js.map"));
    await onChange;

    await expectTestTree(c, []);
  }));
