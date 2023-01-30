# nodejs-testing

> ⚠️ This runner is only compatibile with Node >= 19. The `node:test` API in Node.js is [still young](https://github.com/nodejs/node/issues?q=is%3Aopen+is%3Aissue+label%3Atest_runner), which may be a source of bugs.

Provide integration with VS Code using the [`node:test` runner](https://nodejs.org/api/test.html). **This extension requires Node.js >=19**: `node:test` is quite new and did not offer features we need in prior versions.

## Read this!

- The extension looks for files that use the [Node.js test runner naming convention](https://nodejs.org/api/test.html#test-runner-execution-model). Make sure your files are named correctly!

- The Node.js test runner only supports running JavaScript files. If you have a compilation step, you'll need to make sure that runs **with sourcemaps** so we can figure out where tests appear in your source code. For example, for TypeScript, set `"sourceMap": true` in your tsconfig.json.

- If tests are initially found in your workspace folder, this extension won't keep watching for changes. Manually run the "refresh tests" action if you later add some (or just reload your window.)

## Configuring

- `nodejs-testing.include` is the list of directories in which to look for test files, relative to your workspace folder. Defaults to `['./']`.
- `nodejs-testing.exclude` is the list of glob patterns that should be excluded from the search.  Defaults to `['**/node_modules/**']`.
