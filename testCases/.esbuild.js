const esbuild = require("esbuild");
const path = require("path");
const { readdirSync, statSync } = require("fs");

const watch = process.argv.includes("--watch");
const cases = readdirSync(__dirname)
  .map((f) => path.join(__dirname, f))
  .filter((f) => statSync(f).isDirectory());

const ctx = esbuild.context({
  entryPoints: cases.map((c) => path.join(c, "runner.ts")),
  tsconfig: "./tsconfig.json",
  bundle: true,
  packages: "external",
  sourcemap: "inline",
  platform: "node",
  outdir: __dirname,
});

ctx
  .then((ctx) => (watch ? ctx.watch() : ctx.rebuild()))
  .then(
    () => !watch && process.exit(0),
    () => process.exit(1)
  );
