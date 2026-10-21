import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require("vscode-jsonrpc/node");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/command-line-macros");
const build = process.env.C_INSIGHT_MACRO_BUILD_DIR ? path.resolve(process.env.C_INSIGHT_MACRO_BUILD_DIR) : path.join(root, "build");
const feature = process.env.C_INSIGHT_MACRO_FEATURE ?? "1";
const command = process.env.CINSIGHT_TEST_CLANGD20 || "/usr/bin/clangd-20";
const child = spawn(command, ["--background-index", "--log=error", `--compile-commands-dir=${build}`], { cwd: root });
const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
let stderr = "";
child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
child.on("error", error => { console.error(error.message); process.exitCode = 1; connection.dispose(); });
connection.listen();

async function request(method, params) {
  let timer;
  try {
    return await Promise.race([
      connection.sendRequest(method, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 30000); }),
    ]);
  } finally { clearTimeout(timer); }
}

try {
  await request("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
  connection.sendNotification("initialized", {});
  for (const file of ["main.c", "other.c", "conditional-calls.c"]) {
    const uri = pathToFileURL(path.join(root, file)).href;
    connection.sendNotification("textDocument/didOpen", { textDocument: {
      uri, languageId: "c", version: 1, text: readFileSync(path.join(root, file), "utf8"),
    } });
    await request("textDocument/documentSymbol", { textDocument: { uri } });
  }
  const text = readFileSync(path.join(root, "main.c"), "utf8");
  const uri = pathToFileURL(path.join(root, "main.c")).href;
  const results = [];
  for (const name of ["CI_BUILD_NUMBER", "CI_BUILD_FEATURE", "CI_BUILD_TRACE", "CI_BUILD_CALL"]) {
    const source = name === "CI_BUILD_CALL" ? readFileSync(path.join(root, "conditional-calls.c"), "utf8") : text;
    const sourceUri = name === "CI_BUILD_CALL" ? pathToFileURL(path.join(root, "conditional-calls.c")).href : uri;
    const offset = source.indexOf(name, name === "CI_BUILD_NUMBER" ? source.indexOf("int main(void)") : 0) + 1;
    assert(offset > 0);
    const lines = source.slice(0, offset).split("\n");
    const position = { line: lines.length - 1, character: lines.at(-1).length };
    const params = { textDocument: { uri: sourceUri }, position };
    const definitions = await request("textDocument/definition", params);
    const references = await request("textDocument/references", { ...params, context: { includeDeclaration: true } });
    const hover = await request("textDocument/hover", params);
    assert(hover, `No hover for ${name}`);
    results.push({ name, queryLine: position.line + 1,
      definitions: (definitions || []).map(value => ({
        file: path.basename(fileURLToPath(value.uri)), line: value.range.start.line + 1,
        column: value.range.start.character + 1,
        targetLine: readFileSync(new URL(value.uri), "utf8").split("\n")[value.range.start.line],
      })),
      references: (references || []).map(value => ({ file: path.basename(fileURLToPath(value.uri)), line: value.range.start.line + 1 })),
      hover: hover.contents,
    });
  }
  const functionCallers = [];
  const conditional = readFileSync(path.join(root, "conditional-calls.c"), "utf8");
  const conditionalUri = pathToFileURL(path.join(root, "conditional-calls.c")).href;
  for (const [name, expectedCalls] of [
    ["branch_target", [`branch_target(${feature === "1" ? 1 : 2})`, `branch_target(${feature === "1" ? 4 : 3})`]],
    ["compiler_macro_target", ["CI_BUILD_CALL(5)", "compiler_macro_target(6)"]],
  ]) {
    const offset = conditional.indexOf(name) + 1;
    const lines = conditional.slice(0, offset).split("\n");
    const roots = await request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: conditionalUri }, position: { line: lines.length - 1, character: lines.at(-1).length },
    });
    assert.equal(roots?.length, 1, `Missing function root: ${name}`);
    const incoming = await request("callHierarchy/incomingCalls", { item: roots[0] });
    const sites = incoming.flatMap(call => call.fromRanges.map(range => ({
      caller: call.from.name, file: path.basename(fileURLToPath(call.from.uri)), line: range.start.line + 1,
      source: conditional.split("\n")[range.start.line].trim(),
    })));
    const expectedLines = expectedCalls.map(snippet => conditional.slice(0, conditional.indexOf(snippet)).split("\n").length).sort((a, b) => a - b);
    assert.deepEqual(sites.map(site => site.line).sort((a, b) => a - b), expectedLines, `Unexpected function Callers: ${name}`);
    functionCallers.push({ name, roots: roots.map(root => root.name), sites });
  }
  const report = {
    engine: spawnSync(command, ["--version"], { encoding: "utf8" }).stdout.split("\n")[0],
    feature, results, functionCallers,
  };
  writeFileSync(path.join(build, "clangd-probe.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  await request("shutdown", null);
  connection.sendNotification("exit", null);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, stderr);
} finally {
  connection.dispose();
  if (child.exitCode === null) child.kill();
}
