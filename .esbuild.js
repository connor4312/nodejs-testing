const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const minify = watch ? process.argv.includes("--minify") : !process.argv.includes("--no-minify");

const ctx = esbuild.context({
  entryPoints: [
    "src/extension.ts",
    "src/test/run.ts",
    "src/test/workspace-runner.ts",
    "src/runner-loader.ts",
    "src/runner-worker.ts",
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

ctx
  .then((ctx) => (watch ? ctx.watch() : ctx.rebuild()))
  .then(
    () => !watch && process.exit(0),
    () => process.exit(1),
  );
