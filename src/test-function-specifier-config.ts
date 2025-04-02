import * as PathPosix from "node:path/posix";

/**
 * A declarative way to target a function call either imported from a package,
 * like node:test or from another file in the project
 */
export interface TestFunctionSpecifierConfig {
  /** The names of the functions that should be included in the test runner view */
  name: string[] | string;

  /**
   * The import location where those functions were imported from. If the import
   * starts with `./` it will be treated as a file import relative to the root
   * of the workspace, otherwise it refers to a package, like node:test or
   * vitest
   */
  import: string;
}

export const defaultTestFunctionSpecifiers: TestFunctionSpecifierConfig[] = [
  { import: "node:test", name: ["default", "it", "test", "describe", "suite"] },
];

function singleFileMightHaveTests(
  testSpec: TestFunctionSpecifierConfig,
  contents: string,
): boolean {
  if (testSpec.import.startsWith("./")) {
    // If this test specifier is a relative import, like
    // './my/test/functions/utils.ts' it is a little harder to do an easy check
    // for tests, since it could be anything like:
    // ./utils
    // ./utils.js
    // ./utils.ts
    // ../utils.ts
    // ./functions/utils.ts
    // ../functions/utils.ts
    // etc.
    // We look for the extension-less basename of the test-defining file in the test-
    return contents.includes(PathPosix.parse(testSpec.import).name);
  }

  // This is a test function imported from a package
  return contents.includes(testSpec.import);
}

/**
 * Cheaply check if this file _might_ include any tests matched by the given specifications
 *
 * @param testSpecs the test specifiers to cheaply check the file contents
 * @param contents the contents of the file we are checking for tests
 * @returns true if this file requires further processing to check for tests
 */
export function fileMightHaveTests(
  testSpecs: TestFunctionSpecifierConfig[],
  contents: string,
): boolean {
  return testSpecs.some((spec) => singleFileMightHaveTests(spec, contents));
}
