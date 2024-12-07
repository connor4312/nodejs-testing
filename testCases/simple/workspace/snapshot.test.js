const { describe, it } = require("node:test");

describe('suite of snapshot tests', () => {
  it('snapshot test', (t) => {
    t.assert.snapshot({ value1: 1, value2: 2 });
    t.assert.snapshot(5);
  });
});
