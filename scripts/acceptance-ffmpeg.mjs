import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(
  process.env.C_INSIGHT_FFMPEG_ROOT ?? "/home/user/projects/FFmpeg",
);
const clangd = process.env.C_INSIGHT_FFMPEG_CLANGD ?? "/usr/bin/clangd-20";
const source = path.join(root, "libavcodec/bsf/noise.c");
const database = path.join(root, "compile_commands.json");
await Promise.all([access(source), access(database)]);

const child = spawn(
  clangd,
  [
    `--compile-commands-dir=${root}`,
    "--background-index",
    "--clang-tidy=0",
    "--completion-style=detailed",
    "--header-insertion=never",
    "--log=error",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

let nextId = 1;
let buffer = Buffer.alloc(0);
const pending = new Map();
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consumeMessages();
});

function consumeMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) throw new Error(`Invalid LSP header: ${header}`);
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(
      buffer.subarray(start, start + length).toString("utf8"),
    );
    buffer = buffer.subarray(start + length);
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(waiter.timeout);
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
    }
  }
}

function write(message) {
  const json = JSON.stringify(message);
  child.stdin.write(
    `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
  );
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function request(method, params, timeoutMs = 60_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    write({ jsonrpc: "2.0", id, method, params });
  });
}

async function measure(name, action) {
  const started = performance.now();
  const result = await action();
  return { name, durationMs: Math.round((performance.now() - started) * 100) / 100, result };
}

const uri = pathToFileURL(source).toString();
const document = { textDocument: { uri } };
const scenarios = [];
let exitCode;
try {
  scenarios.push(
    await measure("initialize", () =>
      request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(root).toString(),
        capabilities: {},
      }),
    ),
  );
  notify("initialized", {});
  notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "c",
      version: 1,
      text: await readFile(source, "utf8"),
    },
  });
  const symbols = await measure("document-symbols", () =>
    request("textDocument/documentSymbol", document),
  );
  if (!Array.isArray(symbols.result) || symbols.result.length === 0) {
    throw new Error("FFmpeg document-symbol query returned no symbols");
  }
  symbols.result = { count: symbols.result.length };
  scenarios.push(symbols);

  const target = { ...document, position: { line: 129, character: 12 } };
  const definition = await measure("definition", () =>
    request("textDocument/definition", target),
  );
  const definitions = Array.isArray(definition.result)
    ? definition.result
    : definition.result
      ? [definition.result]
      : [];
  if (definitions.length === 0) {
    throw new Error("FFmpeg definition query returned no result");
  }
  definition.result = { count: definitions.length };
  scenarios.push(definition);

  const references = await measure("references", () =>
    request("textDocument/references", {
      ...target,
      context: { includeDeclaration: true },
    }),
  );
  if (!Array.isArray(references.result) || references.result.length === 0) {
    throw new Error("FFmpeg references query returned no result");
  }
  references.result = { count: references.result.length };
  scenarios.push(references);

  const prepared = await measure("prepare-call-hierarchy", () =>
    request("textDocument/prepareCallHierarchy", {
      ...document,
      position: { line: 77, character: 12 },
    }),
  );
  if (!Array.isArray(prepared.result) || prepared.result.length === 0) {
    throw new Error("FFmpeg call hierarchy preparation returned no root");
  }
  const rootItem = prepared.result[0];
  prepared.result = { count: prepared.result.length, root: rootItem.name };
  scenarios.push(prepared);

  const outgoing = await measure("outgoing-calls", () =>
    request("callHierarchy/outgoingCalls", { item: rootItem }),
  );
  if (!Array.isArray(outgoing.result)) {
    throw new Error("FFmpeg outgoing-call query did not return an array");
  }
  outgoing.result = { count: outgoing.result.length };
  scenarios.push(outgoing);

  const hover = await measure("hover", () =>
    request("textDocument/hover", target),
  );
  if (!hover.result) throw new Error("FFmpeg hover query returned no result");
  hover.result = { available: true };
  scenarios.push(hover);

  await request("shutdown", null);
  notify("exit", null);
  exitCode = await new Promise((resolve) => child.once("exit", resolve));
  if (exitCode !== 0) throw new Error(`clangd exited with ${exitCode}: ${stderr}`);
} catch (error) {
  child.kill();
  throw error;
}

const report = {
  schema: "c-insight.ffmpeg-acceptance",
  version: 1,
  generatedAt: new Date().toISOString(),
  environment: { root, clangd, source, compilationDatabase: database },
  passed: true,
  scenarios,
};
const output = process.argv[2];
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
