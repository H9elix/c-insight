import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { CallHierarchyItem, DocumentSymbol } from "vscode-languageclient/node";
import { AnalysisService } from "../../../src/analysis/analysisService";
import { CallHierarchyRepository } from "../../../src/callHierarchy/callHierarchyRepository";
import { CallNode, LocationResult } from "../../../src/models/types";
import { callHierarchyKey } from "../../../src/utils/callHierarchy";

export async function verifyMacroCallerRepositoryRegressions(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0].uri;
  const uri = vscode.Uri.joinPath(workspace, "src", "call_sites.c");
  const document = await vscode.workspace.openTextDocument(uri);
  const headerUri = vscode.Uri.joinPath(workspace, "include", "macro_values.h");
  const unopenedUri = vscode.Uri.joinPath(workspace, "src", "macro_unopened.c");
  assert(!vscode.workspace.textDocuments.some((item) => item.uri.toString() === unopenedUri.toString()));

  const position = tokenPosition(document, "return MACRO_VALUE(MACRO_NUMBER)", "MACRO_NUMBER");
  const ownDefinition = new vscode.Location(headerUri, new vscode.Range(3, 8, 3, 20));
  const callReference = new vscode.Location(uri, new vscode.Range(position, position.translate(0, 1)));
  const closedReferences = [4, 5].map((line) => new vscode.Location(
    unopenedUri, new vscode.Range(line, 11, line, 23),
  ));
  const functionPosition = tokenPosition(document, "static int numeric_macro_user", "numeric_macro_user");
  const functionRange = {
    start: { line: functionPosition.line, character: 0 },
    end: { line: functionPosition.line + 3, character: 1 },
  };
  const callable: CallHierarchyItem = {
    name: "numeric_macro_user", kind: 12, uri: uri.toString(), range: functionRange,
    selectionRange: { start: functionPosition, end: functionPosition.translate(0, 1) },
  };
  const symbols: DocumentSymbol[] = [{
    name: callable.name, kind: callable.kind, range: callable.range,
    selectionRange: callable.selectionRange,
  }];
  let nativeRoots: CallNode[] = [];
  let definitions: LocationResult[] = [ownDefinition];
  let references: LocationResult[] = [ownDefinition, callReference, ...closedReferences];
  let definitionRequests = 0;
  let referenceRequests = 0;
  let nativeIncomingRequests = 0;
  let hoverRequests = 0;
  let macroHover: string | undefined = undefined;
  let hoverError: Error | undefined;
  let symbolError: Error | undefined;
  const symbolRequests: string[] = [];
  const analysis = {
    analysisEngine: "clangd",
    prepareCallHierarchy: async () => nativeRoots,
    definition: async () => { definitionRequests++; return definitions; },
    hover: async () => {
      hoverRequests++;
      if (hoverError) throw hoverError;
      return macroHover;
    },
    references: async () => { referenceRequests++; return references; },
    documentSymbols: async (target: vscode.Uri) => {
      symbolRequests.push(target.toString());
      if (symbolError) throw symbolError;
      return symbols;
    },
    incomingCalls: async () => { nativeIncomingRequests++; return []; },
    callNode: (raw: CallHierarchyItem): CallNode => ({ raw, key: callHierarchyKey(raw) }),
  } as unknown as AnalysisService;
  const repository = new CallHierarchyRepository(analysis);

  // Empty native roots must not prevent macro detection, and the cursor's
  // in-flight Definition request must not be repeated by macro preparation.
  const [numberRoot] = await repository.prepare(uri, position, undefined, {
    macroCallers: true, definitions: Promise.resolve(definitions),
  });
  assert.equal(numberRoot.raw.name, "MACRO_NUMBER");
  assert.equal(numberRoot.syntheticMacroRoot, true);
  assert.equal(numberRoot.macroCallerScope?.expandedTargetName, undefined);
  assert.equal(definitionRequests, 0);
  const incoming = await repository.incomingResult(numberRoot);
  assert.equal(incoming.calls[0].from.name, "numeric_macro_user");
  assert.deepEqual(incoming.macroScope?.unmappedReferences, closedReferences);
  assert.deepEqual(symbolRequests, [uri.toString()]);
  assert.equal(nativeIncomingRequests, 0);
  assert(!vscode.workspace.textDocuments.some((item) => item.uri.toString() === unopenedUri.toString()));
  assert.equal(await repository.incomingResult(numberRoot), incoming);
  assert.equal(referenceRequests, 1);

  // A failed AST/Provider lookup preserves every exact macro reference, but
  // cancellation remains cancellation and must not become a cached result.
  repository.invalidate();
  symbolError = new Error("trying to get AST for non-added document");
  const unavailable = await repository.incomingResult(numberRoot);
  assert.equal(unavailable.calls.length, 0);
  assert.deepEqual(unavailable.macroScope?.unmappedReferences, [callReference, ...closedReferences]);
  repository.invalidate();
  symbolError = new vscode.CancellationError();
  await assert.rejects(repository.incomingResult(numberRoot), vscode.CancellationError);
  symbolError = undefined;
  assert.equal((await repository.incomingResult(numberRoot)).calls.length, 1);

  // The selected macro's spelling owns the default query even when its native
  // root is a function; only the explicit action enters native Incoming Calls.
  const macroUse = tokenPosition(document, "MACRO_TARGET_2(value)", "MACRO_TARGET_2");
  const macroDefinition = tokenPosition(document, "#define MACRO_TARGET_2", "MACRO_TARGET_2");
  definitions = [new vscode.Location(uri, new vscode.Range(macroDefinition, macroDefinition.translate(0, 1)))];
  references = [new vscode.Location(uri, new vscode.Range(macroUse, macroUse.translate(0, 1)))];
  nativeRoots = [analysis.callNode({ ...callable, name: "macro_target" })];
  const [functionMacro] = await repository.prepare(uri, macroUse, undefined, { macroCallers: true });
  assert.equal(functionMacro.macroCallerScope?.name, "MACRO_TARGET_2");
  assert.equal(functionMacro.macroCallerScope?.expandedTargetName, "macro_target");
  await repository.incomingResult(functionMacro);
  assert.equal(nativeIncomingRequests, 0);
  const expanded = await repository.resolveExpandedMacroTarget(functionMacro);
  assert(expanded?.expandedMacroTarget);
  await repository.incomingResult(expanded);
  assert.equal(nativeIncomingRequests, 1);

  references = [callReference];
  nativeRoots = [analysis.callNode({ ...callable, name: "MACRO_NUMBER", kind: 14 })];
  assert.equal(await repository.resolveExpandedMacroTarget(numberRoot), undefined,
    "A constant must not be accepted as an expanded function target");
  assert.equal(nativeIncomingRequests, 1);

  // Ordinary functions retain their native fast path, including when macro
  // detection is enabled by the cursor controller.
  nativeRoots = [analysis.callNode(callable)];
  const before = definitionRequests;
  const beforeHover = hoverRequests;
  const ordinary = await repository.prepare(uri, functionPosition, undefined, { macroCallers: true });
  assert.equal(ordinary[0], nativeRoots[0]);
  assert.equal(definitionRequests, before);
  assert.equal(hoverRequests, beforeHover, "Ordinary matching functions must not acquire a new Hover query");

  nativeRoots = [];
  definitions = [];
  assert.deepEqual(await repository.prepare(uri, position, undefined, { macroCallers: true }), [],
    "An empty native result is not itself macro evidence");
  macroHover = "### macro `MACRO_NUMBER`\n\n```cpp\n#define MACRO_NUMBER 7\n```";
  const [hoverRoot] = await repository.prepare(uri, position, undefined, { macroCallers: true });
  assert.equal(hoverRoot.syntheticMacroRoot, true);
  assert.deepEqual(hoverRoot.macroCallerScope?.definitions, []);
  const selected = document.getWordRangeAtPosition(position)!;
  assert.deepEqual(hoverRoot.raw.selectionRange, { start: { line: selected.start.line, character: selected.start.character },
    end: { line: selected.end.line, character: selected.end.character } });
  const beforeMicrosoftHover = hoverRequests;
  const microsoft = new CallHierarchyRepository({ ...analysis, analysisEngine: "microsoft" } as unknown as AnalysisService);
  assert.deepEqual(await microsoft.prepare(uri, position, undefined, { macroCallers: true }), []);
  assert.equal(hoverRequests, beforeMicrosoftHover, "Do not silently expand Microsoft macro evidence capabilities");
  hoverError = new Error("Hover unavailable");
  assert.deepEqual(await repository.prepare(uri, position, undefined, { macroCallers: true }), []);
  hoverError = new vscode.CancellationError();
  await assert.rejects(repository.prepare(uri, position, undefined, { macroCallers: true }), vscode.CancellationError);
  console.log("Macro repository regressions passed: empty roots, source/hover evidence, ordinary fast path, exact references, unopened files, AST/Hover failure, cancellation, caching, and explicit expanded targets.");
}

function tokenPosition(document: vscode.TextDocument, fragment: string, token: string): vscode.Position {
  const lines = document.getText().split(/\r?\n/);
  const line = lines.findIndex((text) => text.includes(fragment));
  assert(line >= 0, fragment);
  return new vscode.Position(line, lines[line].indexOf(token) + 1);
}
