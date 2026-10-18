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
const command = process.env.CINSIGHT_TEST_CLANGD20 || "/usr/bin/clangd-20";
const child = spawn(command, ["--background-index", "--log=error", `--compile-commands-dir=${path.join(root, "build")}`], { cwd: root });
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
  for (const file of ["main.c", "other.c"]) {
    const uri = pathToFileURL(path.join(root, file)).href;
    connection.sendNotification("textDocument/didOpen", { textDocument: {
      uri, languageId: "c", version: 1, text: readFileSync(path.join(root, file), "utf8"),
    } });
    await request("textDocument/documentSymbol", { textDocument: { uri } });
  }
  const text = readFileSync(path.join(root, "main.c"), "utf8");
  const uri = pathToFileURL(path.join(root, "main.c")).href;
  const results = [];
  for (const name of ["CI_BUILD_NUMBER", "CI_BUILD_FEATURE", "CI_BUILD_TRACE"]) {
    const offset = text.indexOf(name) + 1;
    assert(offset > 0);
    const lines = text.slice(0, offset).split("\n");
    const position = { line: lines.length - 1, character: lines.at(-1).length };
    const params = { textDocument: { uri }, position };
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
  const report = {
    engine: spawnSync(command, ["--version"], { encoding: "utf8" }).stdout.split("\n")[0],
    results,
  };
  writeFileSync(path.join(root, "build/clangd-probe.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  await request("shutdown", null);
  connection.sendNotification("exit", null);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, stderr);
} finally {
  connection.dispose();
  if (child.exitCode === null) child.kill();
}
