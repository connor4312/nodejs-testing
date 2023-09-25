//@ts-check
const path = require("path");
const { readdirSync, statSync } = require("fs");

const testCasesDir = path.resolve(__dirname, "testCases");
const testCases = readdirSync(testCasesDir);

module.exports = testCases
  .map((testCase) => {
    const testCaseDir = path.resolve(testCasesDir, testCase);
    if (!statSync(testCaseDir).isDirectory()) {
      return;
    }

    return {
      label: testCase,
      files: path.join(testCaseDir, "runner.js"),
      workspaceFolder: path.join(testCaseDir, "workspace"),
      mocha: {
        ui: "bdd",
        bail: true,
        timeout: 5000,
      },
    };
  })
  .filter(Boolean);
