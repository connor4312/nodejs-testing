import { runTests } from "@vscode/test-electron";
import chalk from "chalk";
import esbuild from "esbuild";
import { readdirSync, statSync } from "fs";
import * as path from "path";

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const testCasesDir = path.resolve(extensionDevelopmentPath, "testCases");
    const argvTestCases = process.argv.slice(2).filter((a) => !a.startsWith("-"));
    const testCases = argvTestCases.length ? argvTestCases : readdirSync(testCasesDir);

    for (const testCase of testCases) {
      const testCaseDir = path.resolve(testCasesDir, testCase);
      if (!statSync(testCaseDir).isDirectory()) {
        continue;
      }

      console.log(chalk.blue(`Running tests in ${chalk.bold(`testCases/${testCase}`)}`));
      console.log();

      await esbuild.build({
        bundle: true,
        external: ["vscode"],
        packages: "external",
        entryPoints: [path.join(testCaseDir, "runner.ts")],
        outfile: path.join(testCaseDir, "runner.js"),
        sourcemap: "inline",
        platform: "node",
      });

      await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: path.resolve(__dirname, "workspace-runner.js"),
        launchArgs: [path.join(testCaseDir, "workspace")],
      });
    }
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
