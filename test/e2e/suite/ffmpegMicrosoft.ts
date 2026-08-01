import assert from "node:assert/strict";
import * as vscode from "vscode";

interface PreviewState {
  uri: string;
  title: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface DefinitionLocation {
  uri: vscode.Uri;
  range: vscode.Range;
}

interface CallerProbe {
  roots: number;
  callers: number;
  evidence: {
    queriedNodes: number;
    references: number;
    mappedReferences: number;
    unmappedReferences: number;
    callerFunctions: number;
  };
}

interface CalleeProbe {
  roots: number;
  callees: number;
  evidence: {
    queriedNodes: number;
    successful: number;
    failed: number;
    cancelled: number;
    empty: number;
    callees: number;
    averageDurationMs: number;
    maximumDurationMs: number;
  };
}

interface CallInteractionState {
  pinned: boolean;
  pinnedSymbol?: string;
  incomingRoots: string[];
  outgoingRoots: string[];
  incomingLabels: string[];
  outgoingLabels: string[];
  loadedIncoming: number;
  loadedOutgoing: number;
  incomingCache: { hits: number; misses: number };
  outgoingCache: { hits: number; misses: number };
  callerEvidence: CallerProbe["evidence"];
  calleeEvidence: CalleeProbe["evidence"];
  session?: { incomingDepth: number; outgoingDepth: number };
}

export async function run(): Promise<void> {
  const engine = vscode.workspace.getConfiguration("cInsight");
  const microsoft = vscode.workspace.getConfiguration("cInsight.microsoft");
  await engine.update("engine", "microsoft", vscode.ConfigurationTarget.Global);
  await microsoft.update(
    "callersMode",
    "references",
    vscode.ConfigurationTarget.Global,
  );
  const extension = vscode.extensions.getExtension("c-insight.c-insight");
  assert.ok(extension);
  await extension.activate();

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(workspace);
  const uri = vscode.Uri.joinPath(workspace, "tools", "decode_simple.c");
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const position = symbolPosition(document, "avcodec_receive_frame");
  await vscode.commands.executeCommand("cInsight.preview.focus");
  const activeEditor = await vscode.window.showTextDocument(document);
  activeEditor.selection = new vscode.Selection(position, position);

  const definitions = await waitFor(async () => {
    const result = await vscode.commands.executeCommand<DefinitionLocation[]>(
      "cInsight.test.definitionAtCursor",
    );
    return result[0] ? result : undefined;
  }, 180_000);
  const localPosition = symbolPosition(document, "decode_read");
  activeEditor.selection = new vscode.Selection(localPosition, localPosition);
  await vscode.commands.executeCommand("cInsight.test.clearPreview");
  assert.equal(
    await vscode.commands.executeCommand("cInsight.test.previewState"),
    undefined,
  );
  activeEditor.selection = new vscode.Selection(position, position);

  let preview: PreviewState;
  try {
    preview = await waitFor(async () => {
      const state = await vscode.commands.executeCommand<PreviewState | undefined>(
        "cInsight.test.previewState",
      );
      return state?.uri === definitions[0].uri.toString() &&
        state.range.start.line === definitions[0].range.start.line
        ? state
        : undefined;
    }, 30_000);
  } catch (error) {
    const state = await vscode.commands.executeCommand("cInsight.test.previewState");
    const timing = await vscode.commands.executeCommand("cInsight.test.requestTiming");
    throw new Error(
      `${String(error)}; preview=${JSON.stringify(state)}; definition=${definitions[0].uri}:${definitions[0].range.start.line + 1}; timing=${JSON.stringify(timing)}`,
    );
  }
  assert.equal(preview.uri, definitions[0].uri.toString());
  assert.equal(preview.range.start.line, definitions[0].range.start.line);

  await vscode.commands.executeCommand("cInsight.context.focus");
  await vscode.commands.executeCommand("cInsight.callers.focus");
  await vscode.commands.executeCommand("cInsight.callees.focus");
  await vscode.commands.executeCommand("cInsight.preview.focus");
  const multiViewEditor = await vscode.window.showTextDocument(document);
  multiViewEditor.selection = new vscode.Selection(localPosition, localPosition);
  await vscode.commands.executeCommand("cInsight.test.clearPreview");
  multiViewEditor.selection = new vscode.Selection(position, position);
  try {
    await waitFor(async () => {
      const state = await vscode.commands.executeCommand<PreviewState | undefined>(
        "cInsight.test.previewState",
      );
      return state?.uri === definitions[0].uri.toString() &&
        state.range.start.line === definitions[0].range.start.line
        ? state
        : undefined;
    }, 30_000);
  } catch (error) {
    const navigation = await vscode.commands.executeCommand(
      "cInsight.test.navigationState",
    );
    const timing = await vscode.commands.executeCommand("cInsight.test.requestTiming");
    throw new Error(
      `Multi-view preview failed: ${String(error)}; navigation=${JSON.stringify(navigation)}; timing=${JSON.stringify(timing)}`,
    );
  }

  await vscode.commands.executeCommand(
    "cInsight.previewLocation",
    { uri, range: new vscode.Range(position, position) },
    "reference",
    "avcodec_receive_frame call",
    "selection",
  );
  const callSitePreview = await vscode.commands.executeCommand<PreviewState>(
    "cInsight.test.previewState",
  );
  assert.equal(callSitePreview.uri, uri.toString());
  const beforeClick = await vscode.commands.executeCommand(
    "cInsight.test.navigationState",
  );
  console.log(`C Insight state before Preview click: ${JSON.stringify(beforeClick)}`);
  await Promise.race([
    vscode.commands.executeCommand(
      "cInsight.test.followPreviewDefinition",
      position.line,
      position.character,
    ),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(
        `Preview click timed out; before=${JSON.stringify(beforeClick)}`,
      )),
      15_000,
    )),
  ]);
  const clickedPreview = await vscode.commands.executeCommand<PreviewState>(
    "cInsight.test.previewState",
  );
  assert.equal(clickedPreview.uri, definitions[0].uri.toString());
  assert.equal(clickedPreview.range.start.line, definitions[0].range.start.line);

  const callerEditor = await vscode.window.showTextDocument(document);
  callerEditor.selection = new vscode.Selection(position, position);
  const referenceDiagnostics = await vscode.commands.executeCommand(
    "cInsight.test.referenceDiagnostics",
  );
  console.log(
    `C Insight FFmpeg reference diagnostics: ${JSON.stringify(referenceDiagnostics)}`,
  );
  const callers = await vscode.commands.executeCommand<CallerProbe>(
    "cInsight.test.referenceBasedCallers",
  );
  assert.ok(callers.roots > 0);
  assert.ok(Number.isInteger(callers.callers));
  assert.ok(callers.callers > 0, "Microsoft reference-based Callers should find decode_read");
  assert.deepEqual(callers.evidence, {
    queriedNodes: 1,
    references: 1,
    mappedReferences: 1,
    unmappedReferences: 0,
    callerFunctions: 1,
  });

  callerEditor.selection = new vscode.Selection(localPosition, localPosition);
  const callees = await vscode.commands.executeCommand<CalleeProbe>(
    "cInsight.test.microsoftCallees",
  );
  assert.ok(callees.roots > 0);
  assert.ok(callees.callees > 0, "Microsoft native Callees should find decode_read calls");
  assert.equal(callees.evidence.queriedNodes, 1);
  assert.equal(callees.evidence.successful, 1);
  assert.equal(callees.evidence.failed, 0);
  assert.equal(callees.evidence.cancelled, 0);
  assert.equal(callees.evidence.empty, 0);
  assert.equal(callees.evidence.callees, callees.callees);
  assert.ok(callees.evidence.maximumDurationMs > 0);

  callerEditor.selection = new vscode.Selection(localPosition, localPosition);
  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  const initialHierarchy = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallInteractionState>(
      "cInsight.test.callHierarchyState",
    );
    return state.outgoingRoots.some((name) => name.includes("decode_read"))
      ? state
      : undefined;
  }, 30_000);
  for (let index = 0; index < 3; index += 1) {
    await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
    await vscode.commands.executeCommand("cInsight.unpinCallHierarchy");
  }
  const repeatedPinState = await vscode.commands.executeCommand<CallInteractionState>(
    "cInsight.test.callHierarchyState",
  );
  assert.equal(
    repeatedPinState.incomingLabels.filter((label) =>
      label.startsWith("Microsoft Callers:"),
    ).length,
    1,
  );
  assert.equal(
    repeatedPinState.incomingLabels.filter((label) => label.startsWith("Pinned:"))
      .length,
    0,
  );
  assert.deepEqual(repeatedPinState.outgoingRoots, initialHierarchy.outgoingRoots);
  await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
  const dsFree = symbolPosition(document, "ds_free");
  callerEditor.selection = new vscode.Selection(dsFree, dsFree);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const pinnedHierarchy = await vscode.commands.executeCommand<CallInteractionState>(
    "cInsight.test.callHierarchyState",
  );
  assert.equal(pinnedHierarchy.pinned, true);
  assert.deepEqual(pinnedHierarchy.outgoingRoots, initialHierarchy.outgoingRoots);

  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  const manuallyRefreshed = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallInteractionState>(
      "cInsight.test.callHierarchyState",
    );
    return state.outgoingRoots.some((name) => name.includes("ds_free"))
      ? state
      : undefined;
  }, 30_000);
  assert.equal(manuallyRefreshed.pinned, true);
  await vscode.commands.executeCommand("cInsight.unpinCallHierarchy");

  callerEditor.selection = new vscode.Selection(localPosition, localPosition);
  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallInteractionState>(
      "cInsight.test.callHierarchyState",
    );
    return state.outgoingRoots.some((name) => name.includes("decode_read")) &&
      state.incomingRoots.some((name) => name.includes("decode_read"))
      ? state
      : undefined;
  }, 30_000);
  await vscode.commands.executeCommand(
    "cInsight.test.expandCallHierarchy",
    "outgoing",
    1,
  );
  await vscode.commands.executeCommand(
    "cInsight.test.expandCallHierarchy",
    "incoming",
    1,
  );
  const expanded = await vscode.commands.executeCommand<CallInteractionState>(
    "cInsight.test.callHierarchyState",
  );
  console.log(`C Insight expanded hierarchy state: ${JSON.stringify(expanded)}`);
  assert.ok(expanded.loadedOutgoing > expanded.outgoingRoots.length);
  assert.ok(expanded.loadedIncoming > expanded.incomingRoots.length);
  assert.ok((expanded.session?.outgoingDepth ?? 0) >= 1);
  assert.ok((expanded.session?.incomingDepth ?? 0) >= 1);
  assert.ok(expanded.outgoingCache.misses > 0);
  assert.ok(expanded.incomingCache.misses > 0);

  await vscode.commands.executeCommand("cInsight.test.invalidateCallHierarchy");
  const invalidated = await vscode.commands.executeCommand<CallInteractionState>(
    "cInsight.test.callHierarchyState",
  );
  assert.deepEqual(invalidated.outgoingCache, { hits: 0, misses: 0 });
  assert.deepEqual(invalidated.incomingCache, { hits: 0, misses: 0 });

  const headerSymbol = symbolPosition(document, "DecodeContext");
  callerEditor.selection = new vscode.Selection(headerSymbol, headerSymbol);
  const headerDefinitions = await waitFor(async () => {
    const result = await vscode.commands.executeCommand<DefinitionLocation[]>(
      "cInsight.test.definitionAtCursor",
    );
    return result[0] ? result : undefined;
  }, 30_000);
  assert.match(headerDefinitions[0].uri.fsPath, /decode_simple\.h$/);

  const macro = symbolPosition(document, "AVERROR_EOF");
  callerEditor.selection = new vscode.Selection(macro, macro);
  const macroDefinitions = await waitFor(async () => {
    const result = await vscode.commands.executeCommand<DefinitionLocation[]>(
      "cInsight.test.definitionAtCursor",
    );
    return result[0] ? result : undefined;
  }, 30_000);
  assert.match(macroDefinitions[0].uri.fsPath, /libavutil\/error\.h$/);

  const noSymbol = new vscode.Position(17, 0);
  callerEditor.selection = new vscode.Selection(noSymbol, noSymbol);
  const noDefinitions = await vscode.commands.executeCommand<DefinitionLocation[]>(
    "cInsight.test.definitionAtCursor",
  );
  assert.deepEqual(noDefinitions, []);

  const runtime = await vscode.commands.executeCommand<{
    counters: Record<string, number>;
  }>("cInsight.test.runtimeDiagnostics");
  assert.ok(runtime.counters["microsoft.navigation.definition.queries"] >= 3);
  assert.ok(runtime.counters["microsoft.navigation.definition.locations"] >= 2);
  assert.ok(runtime.counters["microsoft.navigation.definition.empty"] >= 1);
  assert.ok(runtime.counters["microsoft.navigation.references.queries"] >= 1);
  assert.ok(
    (runtime.counters["microsoft.preview.semanticTokens.completed"] ?? 0) +
      (runtime.counters["microsoft.preview.lexicalFallback"] ?? 0) >= 1,
  );
}

function symbolPosition(document: vscode.TextDocument, symbol: string): vscode.Position {
  for (let line = 0; line < document.lineCount; line += 1) {
    const column = document.lineAt(line).text.indexOf(symbol);
    if (column >= 0) return new vscode.Position(line, column + 1);
  }
  throw new Error(`Symbol not found: ${symbol}`);
}

async function waitFor<T>(action: () => Promise<T | undefined>, timeout: number): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeout} ms`);
}
