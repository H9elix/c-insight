import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "c-insight.c-insight";

export async function run(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("cInsight");
  const previousEngine = configuration.inspect<string>("engine")?.globalValue;
  await configuration.update(
    "engine",
    "clangd",
    vscode.ConfigurationTarget.Global,
  );
  try {
    await runClangdAcceptance();
  } finally {
    await configuration.update(
      "engine",
      previousEngine,
      vscode.ConfigurationTarget.Global,
    );
  }
}

async function runClangdAcceptance(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `${extensionId} was not loaded in the Extension Host`);
  await extension.activate();

  const uri = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders?.[0]?.uri ??
      assert.fail("The C++ fixture workspace was not opened"),
    "src",
    "calculator.cpp",
  );
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const callLine = document.lineAt(10).text;
  const addColumn = callLine.indexOf("add");
  assert.ok(addColumn >= 0, "Could not find the add call in the fixture");
  const position = new vscode.Position(10, addColumn + 1);

  // Exercise cursor-follow cancellation before waiting for the final symbol.
  // Large projects otherwise accumulate expensive stale reference/call queries.
  for (let index = 0; index < 1_000; index += 1) {
    const transient = new vscode.Position(
      index % document.lineCount,
      0,
    );
    editor.selection = new vscode.Selection(transient, transient);
  }
  editor.selection = new vscode.Selection(position, position);

  for (let index = 0; index < 100; index += 1) {
    await vscode.commands.executeCommand("cInsight.pinReferences");
    await vscode.commands.executeCommand("cInsight.unpinReferences");
    await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
    await vscode.commands.executeCommand("cInsight.unpinCallHierarchy");
  }

  const definitions = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >("vscode.executeDefinitionProvider", uri, position);
    return value && value.length > 0 ? value : undefined;
  }, "clangd did not return a definition for Calculator::add");

  const references = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      position,
    );
    return value && value.length >= 2 ? value : undefined;
  }, "clangd did not return references for Calculator::add");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "cInsight.goToDefinition",
    "cInsight.findReferences",
    "cInsight.showIncomingCalls",
    "cInsight.showOutgoingCalls",
    "cInsight.previewLocation",
    "cInsight.activateTreeLocation",
    "cInsight.references.search",
    "cInsight.references.groupBy",
    "cInsight.references.scope",
    "cInsight.references.loadMore",
    "cInsight.references.exportJson",
    "cInsight.callers.expandToDepth",
    "cInsight.callees.expandToDepth",
    "cInsight.callHierarchy.stopExpansion",
    "cInsight.callers.search",
    "cInsight.callees.search",
    "cInsight.callers.exportJson",
    "cInsight.callees.exportJson",
    "cInsight.callers.findPath",
    "cInsight.callees.findPath",
    "cInsight.callers.exportMermaid",
    "cInsight.callees.exportMermaid",
    "cInsight.pinReferences",
    "cInsight.unpinReferences",
    "cInsight.pinCallHierarchy",
    "cInsight.unpinCallHierarchy",
    "cInsight.restoreProviderSettings",
    "cInsight.diagnostics.refresh",
    "cInsight.openProjectDiagnostics",
    "cInsight.history.filter",
    "cInsight.history.clear",
    "cInsight.bookmarks.addCurrent",
    "cInsight.bookmarks.add",
    "cInsight.bookmarks.rename",
    "cInsight.bookmarks.changeGroup",
    "cInsight.bookmarks.delete",
    "cInsight.bookmarks.refresh",
    "cInsight.bookmarks.search",
    "cInsight.bookmarks.clearSearch",
    "cInsight.bookmarks.sort",
    "cInsight.bookmarks.import",
    "cInsight.bookmarks.export",
    "cInsight.bookmarks.renameGroup",
    "cInsight.bookmarks.deleteGroup",
    "cInsight.session.restore",
    "cInsight.session.clear",
    "cInsight.typeHierarchy.showSupertypes",
    "cInsight.typeHierarchy.showSubtypes",
    "cInsight.supertypes.expandToDepth",
    "cInsight.subtypes.expandToDepth",
    "cInsight.typeHierarchy.stopExpansion",
    "cInsight.supertypes.search",
    "cInsight.subtypes.search",
    "cInsight.supertypes.exportText",
    "cInsight.supertypes.exportJson",
    "cInsight.supertypes.exportMermaid",
    "cInsight.subtypes.exportText",
    "cInsight.subtypes.exportJson",
    "cInsight.subtypes.exportMermaid",
    "cInsight.includeHierarchy.showIncludes",
    "cInsight.includeHierarchy.showIncludedBy",
    "cInsight.includes.expandToDepth",
    "cInsight.includedBy.expandToDepth",
    "cInsight.includes.stopExpansion",
    "cInsight.includedBy.stopExpansion",
    "cInsight.includes.search",
    "cInsight.includedBy.search",
    "cInsight.includes.exportText",
    "cInsight.includes.exportJson",
    "cInsight.includes.exportMermaid",
    "cInsight.includedBy.exportText",
    "cInsight.includedBy.exportJson",
    "cInsight.includedBy.exportMermaid",
    "cInsight.relationshipGraph.show",
    "cInsight.relationshipGraph.showFile",
    "cInsight.relationshipGraph.exportText",
    "cInsight.relationshipGraph.exportJson",
    "cInsight.relationshipGraph.exportMermaid",
    "cInsight.searchSymbols",
    "cInsight.symbolSearch.refresh",
    "cInsight.symbolSearch.clear",
    "cInsight.symbolSearch.groupBy",
    "cInsight.symbolSearch.filterKinds",
    "cInsight.diagnostics.showClangdLog",
    "cInsight.diagnostics.copyReport",
    "cInsight.diagnostics.exportText",
    "cInsight.diagnostics.exportJson",
    "cInsight.index.refresh",
    "cInsight.diagnostics.selectCompilationDatabase",
    "cInsight.diagnostics.clearCompilationDatabase",
  ]) {
    assert.ok(commands.includes(command), `${command} was not registered`);
  }

  await verifyPersistentSymbolSearch();
  await verifyPreferredDefinitionRoots();
  await verifyFlatCallOccurrences();
  await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(position, position);

  await vscode.commands.executeCommand("cInsight.relationshipGraph.show");
  await waitFor(
    async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.label.startsWith("Relationship Graph") &&
            tab.label.includes("add"),
        )
        ? true
        : undefined,
    "Relationship Graph did not open with Calculator::add as its call root",
  );

  const headerUri = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders![0].uri,
    "include",
    "calculator.hpp",
  );
  const header = await vscode.workspace.openTextDocument(headerUri);
  const headerEditor = await vscode.window.showTextDocument(header);
  const calculatorLine = header.lineAt(7).text;
  const calculatorColumn = calculatorLine.indexOf("Calculator");
  assert.ok(calculatorColumn >= 0, "Could not find Calculator type");
  const typePosition = new vscode.Position(7, calculatorColumn + 1);
  headerEditor.selection = new vscode.Selection(typePosition, typePosition);
  await vscode.commands.executeCommand("cInsight.relationshipGraph.show");
  await waitFor(
    async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.label.startsWith("Relationship Graph") &&
            tab.label.includes("Calculator"),
        )
        ? true
        : undefined,
    "Relationship Graph did not open with Calculator as its type root",
  );

  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("cInsight.relationshipGraph.showFile");
  await waitFor(
    async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.label.startsWith("Relationship Graph") &&
            tab.label.includes("calculator.cpp"),
        )
        ? true
        : undefined,
    "Relationship Graph did not open with calculator.cpp as its file root",
  );

  const firstDefinition = definitions[0];
  const definitionLocation =
    firstDefinition instanceof vscode.Location
      ? firstDefinition
      : new vscode.Location(
          firstDefinition.targetUri,
          firstDefinition.targetSelectionRange ??
            firstDefinition.targetRange,
        );
  const callLocation = new vscode.Location(
    uri,
    new vscode.Range(position, position),
  );
  assert.notEqual(
    definitionLocation.range.start.line,
    callLocation.range.start.line,
    "The fixture call site must differ from its definition",
  );
  const treeLocationNode = {
    id: "e2e-reference",
    label: "Calculator::add call",
    location: callLocation,
    previewMode: "reference",
    previewTitle: "Calculator::add call",
    contextValue: "referenceLocation",
  };
  const firstTreeActivation = vscode.commands.executeCommand(
    "cInsight.activateTreeLocation",
    treeLocationNode,
    "cInsight.symbols",
  );
  const secondTreeActivation = vscode.commands.executeCommand(
    "cInsight.activateTreeLocation",
    treeLocationNode,
    "cInsight.symbols",
  );
  await Promise.all([firstTreeActivation, secondTreeActivation]);
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    callLocation.uri.toString(),
  );
  assert.equal(
    vscode.window.activeTextEditor?.selection.active.line,
    callLocation.range.start.line,
  );
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const previewAfterTreeOpen = await vscode.commands.executeCommand<{
    uri: string;
    range: { start: { line: number } };
  }>("cInsight.test.previewState");
  assert.equal(previewAfterTreeOpen?.uri, callLocation.uri.toString());
  assert.equal(
    previewAfterTreeOpen?.range.start.line,
    callLocation.range.start.line,
    "Tree double-click unexpectedly refreshed Code Preview from the editor cursor",
  );
  await vscode.commands.executeCommand("cInsight.findReferences");
  await vscode.commands.executeCommand("cInsight.references.showAll");
  await vscode.commands.executeCommand("cInsight.references.clearSearch");
  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  await vscode.commands.executeCommand("cInsight.pinReferences");
  await vscode.commands.executeCommand("cInsight.unpinReferences");
  await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
  await vscode.commands.executeCommand("cInsight.unpinCallHierarchy");
  await vscode.commands.executeCommand("cInsight.callHierarchy.stopExpansion");

  assert.ok(references.length >= 2);
}

interface SymbolSearchProbe {
  query: string;
  results: number;
  visibleResults: number;
  viewResolved: boolean;
  loading: boolean;
}

async function verifyPersistentSymbolSearch(): Promise<void> {
  await vscode.commands.executeCommand("cInsight.searchSymbols");
  await waitFor(async () => {
    const state = await vscode.commands.executeCommand<SymbolSearchProbe>(
      "cInsight.test.symbolSearchState",
    );
    return state.viewResolved ? state : undefined;
  }, "The persistent Symbol Search webview did not resolve");
  await vscode.commands.executeCommand(
    "cInsight.test.symbolSearchQuery",
    "Calculator",
  );
  const searched = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<SymbolSearchProbe>(
      "cInsight.test.symbolSearchState",
    );
    return !state.loading && state.query === "Calculator" &&
      state.visibleResults > 0
      ? state
      : undefined;
  }, "The persistent Symbol Search input did not produce workspace results");
  assert.ok(searched.results >= searched.visibleResults);
  await vscode.commands.executeCommand("cInsight.symbolSearch.clear");
  const cleared = await vscode.commands.executeCommand<SymbolSearchProbe>(
    "cInsight.test.symbolSearchState",
  );
  assert.equal(cleared.query, "");
  assert.equal(cleared.visibleResults, 0);
}

interface CallOccurrenceProbe {
  label: string;
  uri: string;
  line: number;
  character: number;
  depth: number;
  canonical: boolean;
  expandable: boolean;
  previewMode?: string;
}

interface CallHierarchyProbe {
  incomingRoots: string[];
  outgoingRoots: string[];
  incomingRootLocations: LocationProbe[];
  outgoingRootLocations: LocationProbe[];
  incomingOccurrences: CallOccurrenceProbe[];
  outgoingOccurrences: CallOccurrenceProbe[];
  incomingDeclarations: LocationProbe[];
  incomingNavigationLabels: string[];
}

interface LocationProbe {
  label: string;
  uri: string;
  line: number;
  character: number;
}

async function verifyPreferredDefinitionRoots(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri ??
    assert.fail("The C++ fixture workspace was not opened");
  const mainUri = vscode.Uri.joinPath(workspace, "src", "main.cpp");
  const definitionUri = vscode.Uri.joinPath(workspace, "src", "calculator.cpp");
  const declarationUri = vscode.Uri.joinPath(workspace, "include", "calculator.hpp");
  const document = await vscode.workspace.openTextDocument(mainUri);
  const editor = await vscode.window.showTextDocument(document);
  const call = findPosition(document, "return calculator.sumTo", "sumTo");
  const definitionDocument = await vscode.workspace.openTextDocument(definitionUri);
  const targetDefinition = findPosition(
    definitionDocument,
    "int Calculator::sumTo",
    "sumTo",
  );
  const declarationDocument = await vscode.workspace.openTextDocument(
    declarationUri,
  );
  const targetDeclaration = findPosition(
    declarationDocument,
    "int sumTo",
    "sumTo",
  );
  const callerDeclaration = findPosition(
    declarationDocument,
    "int calculate",
    "calculate",
  );
  editor.selection = new vscode.Selection(call, call);
  await vscode.commands.executeCommand("cInsight.showIncomingCalls");

  const state = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    const incomingRoot = value.incomingRootLocations[0];
    const outgoingRoot = value.outgoingRootLocations[0];
    const declaration = value.incomingDeclarations.find((item) =>
      item.label.startsWith("sumTo ·"),
    );
    return incomingRoot?.uri === definitionUri.toString() &&
      incomingRoot.line === targetDefinition.line &&
      outgoingRoot?.uri === definitionUri.toString() &&
      outgoingRoot.line === targetDefinition.line &&
      declaration?.uri === declarationUri.toString() &&
      declaration.line === targetDeclaration.line
      ? value
      : undefined;
  }, "Definition-preferred roots or root declaration rows were not produced");
  assert.equal(state.incomingRootLocations[0].label, "sumTo");
  assert.equal(state.incomingDeclarations[0]?.label, "sumTo · Declaration");
  assert.ok(
    state.incomingNavigationLabels.every((label) =>
      !label.includes("· Definition")
    ),
  );

  const preview = await vscode.commands.executeCommand<{
    uri?: string;
    range?: { start: { line: number } };
  }>("cInsight.test.previewState");
  assert.equal(preview?.uri, definitionUri.toString());
  assert.equal(preview?.range?.start.line, targetDefinition.line);

  const activated = await vscode.commands.executeCommand<boolean>(
    "cInsight.test.activateCallerDeclaration",
    "sumTo",
  );
  assert.equal(activated, true);
  await waitFor(async () => {
    const current = await vscode.commands.executeCommand<{
      uri?: string;
      range?: { start: { line: number } };
    }>("cInsight.test.previewState");
    return current?.uri === declarationUri.toString() &&
      current.range?.start.line === targetDeclaration.line
      ? current
      : undefined;
  }, "Selecting the root declaration row did not preview its declaration");

  await vscode.commands.executeCommand(
    "cInsight.test.expandCallHierarchy",
    "incoming",
    2,
  );
  const nested = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    const declaration = value.incomingDeclarations.find((item) =>
      item.label.startsWith("calculate ·"),
    );
    return declaration?.uri === declarationUri.toString() &&
      declaration.line === callerDeclaration.line
      ? value
      : undefined;
  }, "Expanding calculate did not add its independent declaration");
  assert.equal(
    nested.incomingDeclarations.filter((item) =>
      item.label.startsWith("calculate ·")
    ).length,
    1,
  );
  assert.ok(
    nested.incomingOccurrences.some((item) =>
      item.label === "calculate" && item.line === call.line
    ),
  );
}

async function verifyFlatCallOccurrences(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri ??
    assert.fail("The C++ fixture workspace was not opened");
  const uri = vscode.Uri.joinPath(workspace, "src", "call_sites.c");
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const reportDefinition = findPosition(document, "static void report", "report");
  const addDefinition = findPosition(document, "static int add", "add");
  const addStart = addDefinition.line;
  const mainStart = findPosition(document, "int main", "main").line;
  const reportCalls = Array.from({ length: document.lineCount }, (_, line) => ({
    line,
    text: document.lineAt(line).text,
  }))
    .filter(({ line, text }) => line !== reportDefinition.line && text.includes("report("))
    .map(({ line }) => line);
  const addCalls = reportCalls.filter((line) => line > addStart && line < mainStart);
  const mainCalls = reportCalls.filter((line) => line > mainStart);
  assert.equal(addCalls.length, 2);
  assert.equal(mainCalls.length, 3);

  editor.selection = new vscode.Selection(reportDefinition, reportDefinition);
  await vscode.commands.executeCommand("cInsight.showIncomingCalls");
  await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    return state.incomingRoots.includes("report") ? state : undefined;
  }, "Callers did not prepare report as the root");
  const incoming = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    const direct = state.incomingOccurrences.filter((item) => item.depth === 1);
    return direct.length === 5 ? direct : undefined;
  }, "Callers did not automatically expand and flatten all five report call sites");
  assert.deepEqual(incoming.map((item) => item.label), [
    "add",
    "add",
    "main",
    "main",
    "main",
  ]);
  assert.deepEqual(incoming.map((item) => item.line), [...addCalls, ...mainCalls]);
  assert.deepEqual(
    incoming.filter((item) => item.canonical).map((item) => [item.label, item.line]),
    [
      ["add", addCalls[0]],
      ["main", mainCalls[0]],
    ],
  );
  assert.ok(incoming.filter((item) => item.canonical).every((item) => item.expandable));
  assert.ok(incoming.every((item) => item.previewMode === "caller"));

  const activated = await vscode.commands.executeCommand<boolean>(
    "cInsight.test.activateCallOccurrence",
    "incoming",
    "main",
    2,
  );
  assert.equal(activated, true);
  const preview = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<{
      uri?: string;
      range?: { start: { line: number } };
    }>("cInsight.test.previewState");
    return state?.uri === uri.toString() &&
      state.range?.start.line === mainCalls[1]
      ? state
      : undefined;
  }, "Selecting a caller occurrence did not preview its exact call site");
  assert.equal(preview.range?.start.line, mainCalls[1]);

  editor.selection = new vscode.Selection(addDefinition, addDefinition);
  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    return state.outgoingRoots.includes("add") ? state : undefined;
  }, "Callees did not prepare add as the root");
  const outgoing = await waitFor(async () => {
    const state = await vscode.commands.executeCommand<CallHierarchyProbe>(
      "cInsight.test.callHierarchyState",
    );
    const direct = state.outgoingOccurrences.filter((item) => item.depth === 1);
    return direct.length === 2 ? direct : undefined;
  }, "Callees did not automatically expand and flatten both calls to report");
  assert.deepEqual(outgoing.map((item) => item.label), ["report", "report"]);
  assert.deepEqual(outgoing.map((item) => item.line), addCalls);
  assert.deepEqual(outgoing.map((item) => item.canonical), [true, false]);
  assert.ok(outgoing.every((item) => item.previewMode === "callee-call-site"));
}

function findPosition(
  document: vscode.TextDocument,
  lineFragment: string,
  symbol: string,
): vscode.Position {
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    if (!text.includes(lineFragment)) {
      continue;
    }
    const character = text.indexOf(symbol);
    assert.ok(character >= 0, `Could not find ${symbol} in ${lineFragment}`);
    return new vscode.Position(line, character + 1);
  }
  return assert.fail(`Could not find line containing ${lineFragment}`);
}

async function waitFor<T>(
  query: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await query();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    lastError === undefined ? message : `${message}: ${String(lastError)}`,
  );
}
