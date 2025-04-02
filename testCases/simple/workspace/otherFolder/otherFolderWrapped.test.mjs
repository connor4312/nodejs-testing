import { test } from "../test/utils.js";
import { strictEqual } from "node:assert";

test("using wrapped test function from the workspace/otherFolder folder", () => {
  strictEqual(1 + 1, 2);
});
