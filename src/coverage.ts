import { Report } from "c8";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { IstanbulCoverageContext } from "istanbul-to-vscode";
import { tmpdir } from "os";
import { join } from "path";
import { TestRun } from "vscode";

export const coverageContext = new IstanbulCoverageContext();

export const applyC8Coverage = async (testRun: TestRun, coverageDir: string, srcDir: string) => {
  const stagingDir = join(tmpdir(), `nodejs-coverage-${randomUUID()}`);
  const report = new Report({
    tempDirectory: coverageDir,
    reporter: ["json"],
    reportsDirectory: stagingDir,
    src: [srcDir],
    excludeNodeModules: true,
    // not yet in the .d.ts for c8:
    //@ts-ignore
    mergeAsync: true,
  });

  // A hacky fix due to an outstanding bug in Istanbul's exclusion testing
  // code: its subdirectory checks are case-sensitive on Windows, but file
  // URIs might have mixed casing.
  //
  // Setting `relativePath: false` on the exclude bypasses this code path.
  //
  // https://github.com/istanbuljs/test-exclude/issues/43
  // https://github.com/istanbuljs/test-exclude/blob/a5b1d07584109f5f553ccef97de64c6cbfca4764/index.js#L91
  (report as any).exclude.relativePath = false;

  // While we're hacking, may as well keep hacking: we don't want to mess
  // with default excludes, but we want to exclude the .vscode-test internals
  (report as any).exclude.exclude.push("**/runner-loader.js");

  await report.run();
  await fs.rm(coverageDir, { recursive: true, force: true });

  await coverageContext.apply(testRun, stagingDir);
};
