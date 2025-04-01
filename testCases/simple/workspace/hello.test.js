const { describe, it } = require("node:test");
const { strictEqual } = require("node:assert");

describe("math", () => {
  it("addition", async () => {
    console.log("some log");
    strictEqual(1 + 1, 2);
  });
});

describe("math", () => {
  it(`subtraction`, async () => {
    process.stdout.write("another log");
    strictEqual(1 - 1, 0);
  });
});
