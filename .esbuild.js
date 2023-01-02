const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const minify = !watch || process.argv.includes("--minify");

esbuild
  .build({
    entryPoints: ["src/extension.ts", "src/runner-loader.ts", "src/runner-worker.ts"],
    tsconfig: "./tsconfig.json",
    bundle: true,
    external: ["vscode"],
    sourcemap: watch,
    minify,
    watch,
    external: ["vscode"],
    platform: "node",
    outdir: "out",
  })
  .catch(() => process.exit(1));
