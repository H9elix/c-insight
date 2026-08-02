import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import {
  graphEdgeId,
  graphNodeId,
  RelationshipGraphModel,
} from "../dist/src/relationshipGraph/graphModel.js";
import { renderHierarchyExport } from "../dist/src/utils/hierarchyExport.js";
import { enhanceReferenceClassification } from "../dist/src/views/referenceModel.js";
import { expandPreviewRange } from "../dist/src/views/previewRange.js";
import { parseIncludes } from "../dist/src/includeHierarchy/includeModel.js";
import { boundWorkspaceSessionSnapshot } from "../dist/src/session/workspaceSessionModel.js";

const scale = positiveNumber(process.env.C_INSIGHT_BENCHMARK_SCALE, 1);
const strict = process.env.C_INSIGHT_BENCHMARK_STRICT !== "0";
const scenarios = [];

function run(name, budgetMs, operation) {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = operation();
  const durationMs = performance.now() - started;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  scenarios.push({
    name,
    durationMs: round(durationMs),
    budgetMs: round(budgetMs * scale),
    withinBudget: durationMs <= budgetMs * scale,
    heapDeltaBytes,
    result,
  });
}

const referenceCount = Math.floor(100_000 * scale);
run("reference-classification", 1_500, () => {
  let inferred = 0;
  for (let index = 0; index < referenceCount; index += 1) {
    const sourceLine =
      index % 4 === 0
        ? "value += 1;"
        : index % 4 === 1
          ? "consume(value);"
          : index % 4 === 2
            ? "*value = other;"
            : "value = other;";
    const classification = enhanceReferenceClassification(
      {
        uri: { toString: () => "file:///benchmark.c" },
        range: {
          start: { line: index, character: sourceLine.indexOf("value") },
          end: { line: index, character: sourceLine.indexOf("value") + 5 },
        },
      },
      "reference",
      {
        sourceLine,
        highlightKind: index % 2 === 0 ? 3 : 2,
        parameterLabel: index % 10 === 1 ? "Widget &output" : undefined,
      },
    );
    if (classification.confidence === "inferred") inferred += 1;
  }
  return { classified: referenceCount, inferred };
});

const graphNodes = Math.floor(20_000 * scale);
run("relationship-graph-build-snapshot", 2_000, () => {
  const model = new RelationshipGraphModel(graphNodes, graphNodes * 2);
  const root = graphNode("node-0", 0);
  model.replaceRoot(root);
  let previous = root;
  for (let index = 1; index < graphNodes; index += 1) {
    const current = graphNode(`node-${index}`, index);
    model.addNode(current);
    model.addEdge({
      id: graphEdgeId("calls", previous.id, current.id, current.uri, index),
      from: previous.id,
      to: current.id,
      relation: "calls",
      sourceUri: current.uri,
      line: index,
      states: [],
    });
    previous = current;
  }
  const snapshot = model.snapshot();
  return { nodes: snapshot.nodes.length, edges: snapshot.edges.length };
});

const exportNodes = Math.floor(10_000 * scale);
run("hierarchy-json-export", 1_500, () => {
  const roots = buildHierarchy(exportNodes, 20);
  const text = renderHierarchyExport(
    roots,
    {
      relation: "type",
      direction: "subtypes",
      edgeDirection: "parent-to-child",
      summary: { loadedNodes: exportNodes },
    },
    "json",
  );
  return { nodes: exportNodes, bytes: Buffer.byteLength(text) };
});

const previewSteps = Math.floor(100_000 * scale);
run("preview-range-scroll", 750, () => {
  let range = { startLine: 50_000, endLine: 50_199 };
  let expansions = 0;
  for (let index = 0; index < previewSteps; index += 1) {
    const expanded = expandPreviewRange(
      range,
      index % 2 === 0 ? "before" : "after",
      40,
      800,
      100_000,
    );
    if (expanded) {
      range = expanded;
      expansions += 1;
    }
  }
  return { steps: previewSteps, expansions, range };
});

const includeLines = Math.floor(100_000 * scale);
run("include-directive-scan", 1_000, () => {
  const source = Array.from({ length: includeLines }, (_, index) =>
    index % 4 === 0
      ? `#include \"generated/header_${index}.h\"`
      : index % 4 === 1
        ? `/* #include <ignored_${index}.h> */`
        : index % 4 === 2
          ? `int value_${index}; // #include \"ignored.h\"`
          : `# include <system_${index}.h>`,
  ).join("\n");
  const directives = parseIncludes(source);
  return { lines: includeLines, directives: directives.length };
});

const historyEntries = Math.floor(50_000 * scale);
run("workspace-session-bounding", 1_000, () => {
  const entries = Array.from({ length: historyEntries }, (_, index) => ({
    id: index + 1,
    uri: `file:///benchmark/source_${index % 1_000}.cpp`,
    range: {
      start: { line: index, character: 0 },
      end: { line: index, character: 5 },
    },
    mode: "reference",
    title: `Symbol ${index}`,
    source: "selection",
    timestamp: index,
  }));
  const bounded = boundWorkspaceSessionSnapshot({
    format: "c-insight-workspace-session",
    version: 1,
    savedAt: Date.now(),
    engine: "clangd",
    history: { entries, currentId: historyEntries, filter: "all" },
  }, 1024 * 1024);
  return {
    inputEntries: historyEntries,
    retainedEntries: bounded.snapshot.history?.entries.length ?? 0,
    bytes: bounded.byteLength,
    dropped: bounded.dropped,
  };
});

const report = {
  schema: "c-insight.performance-baseline",
  version: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: (await import("node:os")).cpus().length,
    totalMemoryBytes: (await import("node:os")).totalmem(),
  },
  scale,
  strict,
  passed: scenarios.every((scenario) => scenario.withinBudget),
  scenarios,
};

const serialized = `${JSON.stringify(report, undefined, 2)}\n`;
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (outputIndex >= 0 && !outputPath) {
  throw new Error("--output requires a file path");
}
if (outputPath) {
  writeFileSync(outputPath, serialized, "utf8");
  process.stdout.write(`C Insight benchmark report: ${outputPath}\n`);
} else {
  process.stdout.write(serialized);
}
if (strict && !report.passed) process.exitCode = 1;

function graphNode(name, line) {
  const uri = `file:///benchmark/${name}.cpp`;
  return {
    id: graphNodeId("function", uri, line, name),
    kind: "function",
    name,
    uri,
    line,
    character: 0,
    states: [],
    capabilities: ["calls"],
  };
}

function buildHierarchy(count, width) {
  const roots = [];
  const all = [];
  for (let index = 0; index < count; index += 1) {
    const node = {
      name: `Type${index}`,
      uri: `file:///benchmark/type${index}.hpp`,
      line: index + 1,
      states: index % 997 === 0 ? ["duplicate"] : [],
      kind: "Class",
      relationship: index === 0 ? "queried-type" : "direct-subtype",
      evidence: {
        source: "clangd",
        method: "typeHierarchy/subtypes",
        confidence: "semantic",
      },
      children: [],
    };
    if (index < width) {
      roots.push(node);
    } else {
      all[Math.floor((index - width) / width)].children.push(node);
    }
    all.push(node);
  }
  return roots;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
