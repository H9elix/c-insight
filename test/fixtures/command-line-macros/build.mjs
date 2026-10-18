import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const build = process.env.C_INSIGHT_MACRO_BUILD_DIR
  ? path.resolve(process.env.C_INSIGHT_MACRO_BUILD_DIR) : path.join(root, "build");
const compiler = process.env.CC || "cc";
const flags = [
  "-std=c17", "-Wall", "-Wextra", "-Werror",
  "-DCI_BUILD_FEATURE=1", "-DCI_BUILD_NUMBER=7", "-DCI_BUILD_TRACE=trace_value",
];
mkdirSync(build, { recursive: true });
const commands = ["main.c", "other.c"].map(name => ({
  directory: root,
  file: path.join(root, name),
  arguments: [compiler, ...flags, "-c", path.join(root, name), "-o", path.join(build, `${name}.o`)],
}));
writeFileSync(path.join(build, "compile_commands.json"), JSON.stringify(commands, null, 2) + "\n");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: exit=${result.status}, signal=${result.signal}`);
}
for (const entry of commands) run(entry.arguments[0], entry.arguments.slice(1));
const executable = path.join(build, "macro-demo");
run(compiler, [path.join(build, "main.c.o"), path.join(build, "other.c.o"), "-o", executable]);
run(executable, []);
console.log("Command-line macro fixture compiled, linked and ran successfully.");
console.log(`Flags: ${flags.filter(flag => flag.startsWith("-D")).join(" ")}`);
console.log("Compilation database generated for both translation units.");
