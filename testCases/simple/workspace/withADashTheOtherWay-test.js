const { test } = require("node:test");
const { strictEqual } = require("node:assert");

test("addition", () => {
  require('node:fs').readFileSync('does not exist');
});
