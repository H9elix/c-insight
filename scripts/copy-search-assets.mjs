import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@vscode/ripgrep-universal");
const target = resolve(root, "dist/ripgrep");
await mkdir(target, {recursive: true});
await cp(resolve(source, "bin"), target, {recursive: true, force: true});
await cp(resolve(source, "LICENSE"), resolve(target, "LICENSE"));
