/**
 * A declarative way to target a function call either imported from a package,
 * like node:test or from another file in the project
 */
export interface TestFunctionSpecifierConfig {
  /** The names of the functions that should be included in the test runner view */
  name: string[] | string;

  /**
   * The import location where thoes functions were imported from. If the import
   * starts with `./` it will be treated as a file import relative to the root
   * of the workspace, otherwise it refers to a package, like node:test or
   * vitest
   */
  import: string;
}

export const defaultTestFunctionSpecifiers: TestFunctionSpecifierConfig[] = [
  { import: "node:test", name: ["default", "it", "test", "describe", "suite"] },
];
