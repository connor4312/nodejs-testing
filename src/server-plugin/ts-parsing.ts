import { SourceLocation } from "estree";
import type _ts from "typescript";

const enum C {
  NodeTest = "node:test",
  Require = "require",
}

type ExtractTest = (node: _ts.CallExpression) => string | undefined;

const unpackCalleeExpression = (ts: typeof _ts, n: _ts.CallExpression): _ts.Expression =>
  ts.isParenthesizedExpression(n.expression) && ts.isBinaryExpression(n.expression.expression)
    ? n.expression.expression.right
    : n.expression;

const matchIdentified =
  (ts: typeof _ts, name: string, alias: string = name): ExtractTest =>
  (n) => {
    const callee = unpackCalleeExpression(ts, n);
    return ts.isIdentifier(callee) && callee.text === alias ? name : undefined;
  };

const matchNamespaced =
  (ts: typeof _ts, name: string): ExtractTest =>
  (n) => {
    const callee = unpackCalleeExpression(ts, n);
    if (ts.isIdentifier(callee) && callee.text === name) {
      return "test"; // default export, #42
    }

    return ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === name &&
      ts.isIdentifier(callee.name)
      ? callee.name.text
      : undefined;
  };

const getStringish = (ts: typeof _ts, nameArg: _ts.Node | undefined): string | undefined => {
  if (nameArg && ts.isStringLiteral(nameArg)) {
    return nameArg.text;
  }
  if (nameArg && ts.isNoSubstitutionTemplateLiteral(nameArg)) {
    return nameArg.text;
  }
};

export interface IParsedNode {
  fn: string;
  name: string;
  location: SourceLocation;
  children: IParsedNode[];
}

export const parseSource = (ts: typeof _ts, sourceFile: _ts.SourceFile) => {
  const idTests: ExtractTest[] = [];
  const stack: { node: _ts.Node; r: IParsedNode }[] = [];
  stack.push({ node: undefined, r: { children: [] } } as any);

  const visitor = (node: _ts.Node) => {
    let pop = false;

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === C.NodeTest &&
      node.importClause
    ) {
      const binding = node.importClause?.namedBindings;
      if (binding && ts.isNamespaceImport(binding)) {
        idTests.push(matchNamespaced(ts, binding.name.text));
      } else if (binding && ts.isNamedImports(binding)) {
        for (const spec of binding.elements) {
          idTests.push(
            matchIdentified(ts, spec.propertyName?.text || spec.name.text, spec.name.text),
          );
        }
      } else if (node.importClause?.name && ts.isIdentifier(node.importClause.name)) {
        idTests.push(matchNamespaced(ts, node.importClause.name.text));
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === C.Require
    ) {
      const firstArg = getStringish(ts, node.initializer.arguments[0]);
      if (firstArg === C.NodeTest) {
        if (ts.isObjectBindingPattern(node.name)) {
          for (const prop of node.name.elements) {
            if (ts.isBindingElement(prop) && ts.isIdentifier(prop.name)) {
              idTests.push(
                matchIdentified(
                  ts,
                  prop.propertyName && ts.isIdentifier(prop.propertyName)
                    ? prop.propertyName.text
                    : prop.name.text,
                  prop.name.text,
                ),
              );
            }
          }
        } else if (ts.isIdentifier(node.name)) {
          idTests.push(matchNamespaced(ts, node.name.text));
        }
      }
    } else if (ts.isCallExpression(node)) {
      const name = getStringish(ts, node.arguments[0]);
      if (name === undefined) {
        return;
      }

      for (const test of idTests) {
        const fn = test(node);
        if (!fn) {
          continue;
        }

        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const child: IParsedNode = {
          children: [],
          location: {
            start: { line: start.line + 1, column: start.character },
            end: { line: end.line + 1, column: 0 },
          },
          fn,
          name,
        };
        stack[stack.length - 1].r.children.push(child);
        stack.push({ node, r: child });
        pop = true;
        break;
      }
    }

    ts.forEachChild(node, visitor);

    if (pop) {
      stack.pop();
    }
  };

  visitor(sourceFile);

  return stack[0].r.children;
};
