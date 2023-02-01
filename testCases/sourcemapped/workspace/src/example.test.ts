import { strictEqual } from "assert";
import { describe, it } from "node:test";

describe("math", () => {
  it("addition", () => {
    strictEqual(1 + 1, 2);
  });

  it("subtraction", () => {
    strictEqual(1 - 1, -2);
  });
});
