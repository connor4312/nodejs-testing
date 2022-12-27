const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const minify = !watch || process.argv.includes("--minify");

// Build the editor provider
esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    tsconfig: "./tsconfig.json",
    bundle: true,
    external: ["vscode"],
    sourcemap: watch,
    minify,
    watch,
    external: ["@swc/core-*", "vscode"],
    platform: "node",
    outfile: "out/extension.js",
  })
  .catch(() => process.exit(1));
