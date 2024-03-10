const { describe, it } = require("node:test");
const { strictEqual } = require("node:assert");

describe("math", () => {
  it("addition", async () => {
    // console.log("some log");
    strictEqual(1 + 1, 2);
  });

  it(`subtraction`, async () => {
    // process.stdout.write("another log");
    strictEqual(1 - 1, 0);
  });

  it("should fail", () => {
    throw new Error(
      '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoEqual\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m) // deep equality\u001b[22m\n\n\u001b[32m- Expected  - 1\u001b[39m\n\u001b[31m+ Received  + 1\u001b[39m\n\n\u001b[2m  Object {\u001b[22m\n\u001b[32m-   "column": 6,\u001b[39m\n\u001b[31m+   "column": 1,\u001b[39m\n\u001b[2m    "line": 1,\u001b[22m\n\u001b[2m  }\u001b[22m',
    );
  });
});
