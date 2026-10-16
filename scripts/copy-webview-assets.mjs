import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "dist/codicons");
mkdirSync(destination, { recursive: true });
for (const file of ["codicon.css", "codicon.ttf"]) {
  copyFileSync(resolve(root, "node_modules/@vscode/codicons/dist", file), resolve(destination, file));
}
