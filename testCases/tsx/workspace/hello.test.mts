import { strictEqual } from "assert";
import { it } from "node:test";

it("addition", () => {
  console.log('some log');
  strictEqual(1 + 1, 2);
});

it("bad addition", () => {
  strictEqual(1 + 1, 4);
});
