import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { languageClientMinimatchCompat } from "./languageclient-minimatch-compat.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/extension.js",
  logLevel: "info",
  plugins: [languageClientMinimatchCompat(repositoryRoot)],
});
