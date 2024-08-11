import type { Options } from "acorn";
import { parse } from "acorn-loose";
import { traverse } from "estraverse";
import { CallExpression, Expression, Node, SourceLocation, Super } from "estree";

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
  (name: string): ExtractTest =>
  (n) => {
    const callee = unpackCalleeExpression(n);
    if (callee.type === C.Identifier && callee.name === name) {
      return 'test'; // default export, #42
    }

    return callee.type === C.MemberExpression &&
      callee.object.type === C.Identifier &&
      callee.object.name === name &&
      callee.property.type === C.Identifier
      ? callee.property.name
      : undefined;
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

export const parseSource = (text: string) => {
  const ast = parse(text, acornOptions);

  const idTests: ExtractTest[] = [];

  const stack: { node: Node; r: IParsedNode }[] = [];
  stack.push({ node: undefined, r: { children: [] } } as any);

  traverse(ast as Node, {
    enter(node) {
      if (node.type === C.ImportDeclaration && node.source.value === C.NodeTest) {
        for (const spec of node.specifiers) {
          switch (spec.type) {
            case C.ImportNamespaceSpecifier:
            case C.ImportDefaultSpecifier:
              idTests.push(matchNamespaced(spec.local.name));
              break;
            case C.ImportSpecifier:
              idTests.push(matchIdentified(spec.imported.name, spec.local.name));
              break;
          }
        }
      } else if (
        node.type === C.VariableDeclarator &&
        node.init?.type === C.CallExpression &&
        node.init.callee.type === C.Identifier &&
        node.init.callee.name === "require"
      ) {
        const firstArg = getStringish(node.init.arguments[0]);
        if (firstArg === C.NodeTest) {
          if (node.id.type === C.ObjectPattern) {
            for (const prop of node.id.properties) {
              if (
                prop.type === C.Property &&
                prop.key.type === C.Identifier &&
                prop.value.type === C.Identifier
              ) {
                idTests.push(matchIdentified(prop.key.name, prop.value.name));
              }
            }
          } else if (node.id.type === C.Identifier) {
            idTests.push(matchNamespaced(node.id.name));
          }
        }
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
            stack[stack.length - 1].r.children.push(child);
            stack.push({ node, r: child });
            break;
          }
        }
      }
    },
    leave(node) {
      if (stack[stack.length - 1].node === node) {
        stack.pop();
      }
    },
  });

  return stack[0].r.children;
};
