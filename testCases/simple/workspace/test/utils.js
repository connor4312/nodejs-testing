const { test: nodeTest } = require("node:test");

exports.test = function test(name, fn) {
  return nodeTest(name, fn);
};
