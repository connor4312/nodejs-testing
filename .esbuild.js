const esbuild = require("esbuild");
const fs = require("fs/promises");

const watch = process.argv.includes("--watch");
const minify = watch ? process.argv.includes("--minify") : !process.argv.includes("--no-minify");

const ctx = esbuild.context({
  entryPoints: [
    "src/extension.ts",
    "src/test/run.ts",
    "src/test/workspace-runner.ts",
    "src/runner-loader.ts",
    "src/runner-worker.ts",
    "src/server-plugin/server-plugin.ts",
  ],
  tsconfig: "./tsconfig.json",
  bundle: true,
  external: ["vscode", "esbuild", "mocha", "monocart-coverage-reports"],
  sourcemap: !minify,
  minify,
  platform: "node",
  target: "node20",
  outdir: "out",
  plugins: [
    {
      name: "alias-module",
      setup: (build) => {
        build.onResolve({ filter: /^istanbul-reports$/ }, () => ({
          path: `${__dirname}/src/istanbul-reports-stub.ts`,
        }));
      },
    },
  ],
});

const serverPluginDir = "node_modules/@c4312/nodejs-testing-ts-server-plugin";
async function addServerPlugin() {
  await fs.mkdir(serverPluginDir, { recursive: true });
  await fs.writeFile(
    `${serverPluginDir}/index.js`,
    'module.exports=require("../../../out/server-plugin/server-plugin.js")',
  );
}

addServerPlugin()
  .then(() => ctx)
  .then((ctx) => (watch ? ctx.watch() : ctx.rebuild()))
  .then(
    () => !watch && process.exit(0),
    () => process.exit(1),
  );
