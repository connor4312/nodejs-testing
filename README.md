# nodejs-testing

> ⚠️ This runner is only compatibile with Node >= 19. The `node:test` API in Node.js is [still young](https://github.com/nodejs/node/issues?q=is%3Aopen+is%3Aissue+label%3Atest_runner), which may be a source of bugs.

Provide integration with VS Code using the [`node:test` runner](https://nodejs.org/api/test.html). **This extension requires Node.js >=19**: `node:test` is quite new and did not offer features we need in prior versions.

The Node.js test runner only supports running JavaScript files. If you have a compilation step, you'll need to make sure that runs **with sourcemaps** so we can figure out where tests appear in your source code. For example, for TypeScript, set `"sourceMap": true` in your tsconfig.json.

## Configuring

This extension supports sourcemaps, and therefore watches [relevant `.js` files](https://nodejs.org/api/test.html#test-runner-execution-model) in your workspace. To change this behavior, you can use the settings `nodejs-testing.include` and `nodejs-testing.exclude`.
