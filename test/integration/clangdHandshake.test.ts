import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("clangd accepts an LSP initialize request over default stdio", async () => {
  const child = spawn(
    process.env.CINSIGHT_TEST_CLANGD || "clangd",
    [
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
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const response = waitForResponse(child.stdout, 1);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    },
  });
  const initialized = await response;
  assert.ok(initialized.result?.capabilities, stderr);

  const shutdown = waitForResponse(child.stdout, 2);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "shutdown",
    params: null,
  });
  await shutdown;
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    method: "exit",
    params: null,
  });
  const [code] = (await once(child, "exit")) as [number | null];
  assert.equal(code, 0, stderr);
});

test("clangd 20 returns outgoing calls for a C++ function", async () => {
  const command = process.env.CINSIGHT_TEST_CLANGD20 || "/usr/bin/clangd-20";
  const child = spawn(command, ["--background-index", "--log=error"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const fixture = path.join(
    process.cwd(),
    "test/fixtures/basic-cpp/src/calculator.cpp",
  );
  const uri = pathToFileURL(fixture).toString();
  const initialize = waitForResponse(child.stdout, 1);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: pathToFileURL(
        path.join(process.cwd(), "test/fixtures/basic-cpp"),
      ).toString(),
      capabilities: {},
    },
  });
  await initialize;
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    method: "initialized",
    params: {},
  });
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId: "cpp",
        version: 1,
        text: await readFile(fixture, "utf8"),
      },
    },
  });

  const prepare = waitForResponse(child.stdout, 2);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/prepareCallHierarchy",
    params: {
      textDocument: { uri },
      position: { line: 6, character: 18 },
    },
  });
  const prepared = await prepare;
  assert.ok(Array.isArray(prepared.result) && prepared.result.length > 0, stderr);

  const outgoing = waitForResponse(child.stdout, 3);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 3,
    method: "callHierarchy/outgoingCalls",
    params: { item: prepared.result[0] },
  });
  const result = await outgoing;
  assert.equal(result.error, undefined, JSON.stringify(result.error) || stderr);
  assert.ok(
    result.result.some(
      (call: { to?: { name?: string } }) => call.to?.name === "add",
    ),
    `Expected sumTo() to call add(); response=${JSON.stringify(result)}`,
  );

  const highlightsResponse = waitForResponse(child.stdout, 4);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 4,
    method: "textDocument/documentHighlight",
    params: {
      textDocument: { uri },
      position: { line: 3, character: 12 },
    },
  });
  const highlights = await highlightsResponse;
  assert.equal(
    highlights.error,
    undefined,
    JSON.stringify(highlights.error) || stderr,
  );
  assert.ok(
    highlights.result.some(
      (highlight: { kind?: number }) => highlight.kind === 2,
    ),
    `Expected a semantic Read highlight; response=${JSON.stringify(highlights)}`,
  );

  const shutdown = waitForResponse(child.stdout, 5);
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    id: 5,
    method: "shutdown",
    params: null,
  });
  await shutdown;
  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    method: "exit",
    params: null,
  });
  const [code] = (await once(child, "exit")) as [number | null];
  assert.equal(code, 0, stderr);
});

function writeMessage(
  stream: NodeJS.WritableStream,
  message: unknown,
): void {
  const json = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function waitForResponse(
  stream: NodeJS.ReadableStream,
  id: number,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for LSP response ${id}`)),
      10_000,
    );
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          return;
        }
        const header = buffer.subarray(0, headerEnd).toString("ascii");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          reject(new Error(`Invalid LSP header: ${header}`));
          return;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) {
          return;
        }
        const body = buffer
          .subarray(bodyStart, bodyStart + length)
          .toString("utf8");
        buffer = buffer.subarray(bodyStart + length);
        const parsed = JSON.parse(body) as Record<string, any>;
        if (parsed.id === id) {
          clearTimeout(timeout);
          stream.off("data", onData);
          resolve(parsed);
          return;
        }
      }
    };
    stream.on("data", onData);
  });
}
