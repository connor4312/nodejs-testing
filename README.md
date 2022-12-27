# nodejs-testing

> Work in progress--almost done!

Provide integration with VS Code using the [`node:test` runner](https://nodejs.org/api/test.html). **This extension requires Node.js >=19**: `node:test` is quite new and did not offer features we need in prior versions.

The Node.js test runner only supports running JavaScript files. If you have a compilation step, you'll need to make sure that runs **with sourcemaps** so we can figure out where tests appear in your source code. For example, for TypeScript, set `"sourceMap": true` in your tsconfig.json.

## Configuring

This extension supports sourcemaps, and therefore watches all `.js` files in your workspace, excluding `node_modules`. To change this behavior, you use the settings `nodejs-testing.include` and `nodejs-testing.exclude`.
