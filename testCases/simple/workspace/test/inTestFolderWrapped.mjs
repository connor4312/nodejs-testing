import { test } from "./utils.js";
import { strictEqual } from "node:assert";

test("using wrapped test function from the workspace/test folder", () => {
  strictEqual(1 + 1, 2);
});
