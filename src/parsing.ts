import type { Options } from "acorn";
import { parse } from "acorn-loose";
import * as evk from "eslint-visitor-keys";
import {
  CallExpression,
  Expression,
  Node,
  SourceLocation,
  Super,
  type ImportDeclaration,
  type VariableDeclarator,
} from "estree";
import * as PosixPath from "node:path/posix";
import {
  defaultTestFunctionSpecifiers,
  type TestFunctionSpecifierConfig,
} from "./test-function-specifier-config";
import { assertUnreachable } from "./utils";

const enum C {
  ImportDeclaration = "ImportDeclaration",
  ImportNamespaceSpecifier = "ImportNamespaceSpecifier",
  ImportDefaultSpecifier = "ImportDefaultSpecifier",
  ImportSpecifier = "ImportSpecifier",
  MemberExpression = "MemberExpression",
  CallExpression = "CallExpression",
  VariableDeclarator = "VariableDeclarator",
  ObjectPattern = "ObjectPattern",
  ParenthesizedExpression = "ParenthesizedExpression",
  SequenceExpression = "SequenceExpression",
  TemplateLiteral = "TemplateLiteral",
  Property = "Property",
  Literal = "Literal",
  Identifier = "Identifier",
  NodeTest = "node:test",
}

export const acornOptions: Options = {
  ecmaVersion: "latest",
  locations: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowReserved: true,
  allowReturnOutsideFunction: true,
};

type ExtractTest = (node: CallExpression) => string | undefined;

const unpackCalleeExpression = (n: CallExpression): Expression | Super =>
  n.callee.type === C.SequenceExpression
    ? n.callee.expressions[n.callee.expressions.length - 1]
    : n.callee;

const matchIdentified =
  (name: string, alias: string = name): ExtractTest =>
  (n) => {
    const callee = unpackCalleeExpression(n);
    return callee.type === C.Identifier && callee.name === alias ? name : undefined;
  };

const matchNamespaced =
  (objectName: string, validTestNames: Set<string>): ExtractTest =>
  (n) => {
    const callee = unpackCalleeExpression(n);
    if (callee.type === C.Identifier && callee.name === objectName) {
      return "test"; // default export, #42
    }

    if (
      !(
        callee.type === C.MemberExpression &&
        callee.object.type === C.Identifier &&
        callee.object.name === objectName &&
        callee.property.type === C.Identifier
      )
    ) {
      return undefined;
    }

    const calleeName = callee.property.name;
    return validTestNames.has(calleeName) ? calleeName : undefined;
  };

const getStringish = (nameArg: Node | undefined): string | undefined => {
  if (nameArg?.type === C.Literal && typeof nameArg.value === "string") {
    return nameArg.value;
  }
  if (nameArg?.type === C.TemplateLiteral && nameArg.quasis.length === 1) {
    return nameArg.quasis[0].value.cooked || nameArg.quasis[0].value.raw;
  }
};

export interface IParsedNode {
  fn: string;
  name: string;
  location: SourceLocation;
  children: IParsedNode[];
}

/**
 * Resolve the import of `importString` from the file at `fileUriPath` relative to the workspace root.
 *
 * If the `importString` refers a package it remains unchanged.
 */
function importRelativeToWorkspaceRoot(
  workspaceFolderUriPath: string,
  fileUriPath: string,
  importString: string,
) {
  let importValue = importString;
  if (importString.startsWith("./") || importString.startsWith("../")) {
    // This is a relative import, we need to adjust the import value for matching purposes
    const importRelativeToRoot = PosixPath.relative(
      workspaceFolderUriPath,
      PosixPath.resolve(PosixPath.dirname(fileUriPath), importString),
    );

    importValue = `./${importRelativeToRoot}`;
  }

  return importValue;
}

/**
 * Look for test ESM imports in this AST node
 *
 * @param workspaceFolderUriPath The path component of the workspace folder URI this file belongs to, used for relative path references to a custom test function
 * @param fileUriPath The path component of the URI of the file we are extracting tests from
 * @param testFunctions the tests function imports to check for
 * @param node the ImportDeclaration to look for test imports
 * @returns
 */
function importDeclarationExtractTests(
  workspaceFolderUriPath: string,
  fileUriPath: string,
  testFunctions: TestFunctionSpecifierConfig[],
  node: ImportDeclaration,
): ExtractTest[] {
  const idTests: ExtractTest[] = [];
  if (typeof node.source.value !== "string") {
    return idTests;
  }

  const fromRootImport = importRelativeToWorkspaceRoot(
    workspaceFolderUriPath,
    fileUriPath,
    node.source.value,
  );

  for (const specifier of testFunctions) {
    if (specifier.import !== fromRootImport) {
      continue;
    }

    // Next check to see if the functions imported are tests functions
    const validNames = new Set(
      typeof specifier.name === "string" ? [specifier.name] : specifier.name,
    );

    for (const spec of node.specifiers) {
      const specType = spec.type;
      if (specType === C.ImportDefaultSpecifier) {
        // The name "default" is special, it is used when you are trying to
        // target a default export from a file in your workspace
        if (validNames.has("default")) {
          idTests.push(matchNamespaced(spec.local.name, validNames));
        }
      } else if (specType === C.ImportNamespaceSpecifier) {
        idTests.push(matchNamespaced(spec.local.name, validNames));
      } else if (specType === C.ImportSpecifier) {
        if (spec.imported.type === C.Identifier) {
          if (validNames.has(spec.imported.name)) {
            idTests.push(matchIdentified(spec.imported.name, spec.local.name));
          }
        }
      } else {
        assertUnreachable(specType, `${specType} was unhandled`);
      }
    }
  }

  return idTests;
}

/**
 * Look for test imports in a `require` call
 * For example:
 * ```
 * const test = require("node:test");
 * const { test } = require("node:test");
 * const { test: renamedTest } = require("node:test");
 * ```
 *
 * @param workspaceFolderUriPath The path component of the workspace folder URI this file belongs to, used for relative path references to a custom test function
 * @param fileUriPath The path component of the URI of the file we are extracting tests from
 * @param testFunctions the tests function imports to check for
 * @param node the VariableDeclarator to look for
 * @returns
 */
function requireCallExtractTests(
  workspaceFolderUriPath: string,
  fileUriPath: string,
  testFunctions: TestFunctionSpecifierConfig[],
  node: VariableDeclarator,
) {
  const idTests: ExtractTest[] = [];
  if (node.init?.type !== C.CallExpression) {
    return idTests;
  }

  const firstArg = getStringish(node.init.arguments[0]);
  if (!firstArg) {
    return idTests;
  }

  const fromRootImport = importRelativeToWorkspaceRoot(
    workspaceFolderUriPath,
    fileUriPath,
    firstArg,
  );

  for (const specifier of testFunctions) {
    if (specifier.import !== fromRootImport) {
      continue;
    }

    // Next check to see if the functions imported are tests functions
    const validNames = new Set(
      typeof specifier.name === "string" ? [specifier.name] : specifier.name,
    );

    if (node.id.type === C.Identifier) {
      idTests.push(matchNamespaced(node.id.name, validNames));
      continue;
    }

    if (node.id.type === C.ObjectPattern) {
      for (const prop of node.id.properties) {
        if (
          prop.type === C.Property &&
          prop.key.type === C.Identifier &&
          prop.value.type === C.Identifier &&
          validNames.has(prop.key.name)
        ) {
          idTests.push(matchIdentified(prop.key.name, prop.value.name));
        }
      }
    }
  }

  return idTests;
}

/**
 * Parse the source code in `text` to identify any tests that match `testFunctions`
 *
 * @param text the contents of the file we want to parse
 * @param workspaceFolderUriPath the path component of the URI of the workspace this file exists.
 *        If you have a `const folder: vscode.WorkspaceFolder`, then use folder.uri.path
 * @param fileUriPath the path component of the URI of the file we are checking for tests
 * @param testFunctions the configured test specifiers for the kinds of tests we are looking for
 * @returns A hierarchical tree of tests that exist in this file
 */
export const parseSource = (
  text: string,
  workspaceFolderUriPath: string,
  fileUriPath: string,
  testFunctions: TestFunctionSpecifierConfig[],
): IParsedNode[] => {
  const ast = parse(text, acornOptions);
  const testMatchers = testFunctions ?? defaultTestFunctionSpecifiers;

  const idTests: ExtractTest[] = [];

  // Since tests can be nested inside of each other, for example a test suite.
  // We keep track of the test declarations in a tree.
  const stack: { node: Node; r: IParsedNode }[] = [];
  stack.push({ node: undefined, r: { children: [] } } as any);

  traverse(ast as Node, {
    enter(node) {
      if (node.type === C.ImportDeclaration) {
        const matchers = importDeclarationExtractTests(
          workspaceFolderUriPath,
          fileUriPath,
          testMatchers,
          node,
        );
        idTests.push(...matchers);
      } else if (
        node.type === C.VariableDeclarator &&
        node.init?.type === C.CallExpression &&
        node.init.callee.type === C.Identifier &&
        node.init.callee.name === "require"
      ) {
        const matchers = requireCallExtractTests(
          workspaceFolderUriPath,
          fileUriPath,
          testMatchers,
          node,
        );
        idTests.push(...matchers);
      } else if (node.type === C.CallExpression) {
        const name = getStringish(node.arguments[0]);
        if (name === undefined) {
          return;
        }

        for (const test of idTests) {
          const fn = test(node);
          if (fn) {
            const child: IParsedNode = {
              children: [],
              location: node.loc!,
              fn,
              name,
            };

            // We have encountered a test function, record it in the tree.
            stack[stack.length - 1].r.children.push(child);

            // This test function is potentially a "parent" for subtests, so
            // keep it as the "current leaf" of the stack, so future sub-tests
            // can be associated with it
            stack.push({ node, r: child });
            break;
          }
        }
      }
    },
    leave(node) {
      // We are exiting a node that was potentially a test function.  If it was,
      // we need to pop it of the stack, since there are no more subtests to be
      // associated with it.
      if (stack[stack.length - 1].node === node) {
        stack.pop();
      }
    },
  });

  return stack[0].r.children;
};

const traverse = (
  node: Node | undefined,
  visitor: {
    enter: (node: Node, parent?: Node) => void;
    leave: (node: Node) => void;
  },
  parent?: Node,
) => {
  if (!node) {
    return;
  }

  visitor.enter(node, parent);

  const keys = evk.KEYS[node.type];
  if (keys) {
    for (const key of keys) {
      const child = (node as unknown as Record<string, Node | Node[]>)[key];
      if (child instanceof Array) {
        for (const [i, c] of child.entries()) {
          traverse(c, visitor, node);
        }
      } else if (child) {
        traverse(child, visitor, node);
      }
    }
  }

  visitor.leave(node);
};
