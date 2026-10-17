import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import type { BookmarkExplorer } from "../../../src/bookmarks/bookmarkExplorer";
import type { CallHierarchyRepository } from "../../../src/callHierarchy/callHierarchyRepository";
import type { NavigationHistoryExplorer } from "../../../src/history/navigationHistoryExplorer";
import type { IncludeHierarchyRepository } from "../../../src/includeHierarchy/includeHierarchyRepository";
import type { LocationResult } from "../../../src/models/types";
import type { RelationshipGraphModel } from "../../../src/relationshipGraph/graphModel";
import { RelationshipGraphPanel } from "../../../src/relationshipGraph/relationshipGraphPanel";
import type { TypeHierarchyRepository } from "../../../src/typeHierarchy/typeHierarchyRepository";
import { CodePreviewProvider } from "../../../src/views/codePreviewProvider";

interface PreviewNavigationProbe {
  state?: { mode: "reference"; title: string; location: LocationResult };
  rendered?: {
    document: vscode.TextDocument;
    startLine: number;
    endLine: number;
    target: LocationResult;
  };
  receiveMessage(message: {
    type: string;
    line?: number;
    character?: number;
  }): Promise<void>;
}

export async function run(): Promise<void> {
  await vscode.extensions.getExtension("H9elix.c-insight")!.activate();
  await verifyEditorNavigationHistory();
}

export async function verifyEditorNavigationHistory(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "c-insight-navigation-"));
  const sourceUri = vscode.Uri.file(path.join(root, "source.txt"));
  const targetUri = vscode.Uri.file(path.join(root, "target.txt"));
  const text = Array.from({ length: 120 }, (_, line) => `navigation line ${line}`).join("\n");
  await Promise.all([
    writeFile(sourceUri.fsPath, text),
    writeFile(targetUri.fsPath, text),
  ]);
  const source = await vscode.workspace.openTextDocument(sourceUri);
  const target = await vscode.workspace.openTextDocument(targetUri);
  const origin = new vscode.Position(37, 3);
  const remembered = new vscode.Position(90, 2);
  const destination = new vscode.Position(15, 4);
  const location: LocationResult = {
    uri: targetUri,
    range: new vscode.Range(destination, destination.translate(0, 5)),
  };
  const preview = new CodePreviewProvider(
    {} as AnalysisService,
    {} as NavigationHistoryExplorer,
  );
  const previewProbe = preview as unknown as PreviewNavigationProbe;
  // Exercise the real Webview message handlers without browser timing or any
  // semantic query: only a document and a known graph location are needed.
  const output = vscode.window.createOutputChannel("C Insight navigation regression");
  const graph = new RelationshipGraphPanel(
    {} as AnalysisService,
    {} as CallHierarchyRepository,
    {} as TypeHierarchyRepository,
    {} as IncludeHierarchyRepository,
    {} as BookmarkExplorer,
    output,
  );
  const graphProbe = graph as unknown as {
    model: RelationshipGraphModel;
    handleMessage(message: unknown): Promise<void>;
  };
  graphProbe.model.addNode({
    id: "navigation-target", kind: "function", name: "Navigation target",
    uri: targetUri.toString(), line: destination.line + 1,
    character: destination.character, states: [], capabilities: [],
  });
  const node = {
    id: "e2e-editor-navigation",
    label: "Navigation target",
    location,
    previewMode: "reference",
    contextValue: "referenceLocation",
  };
  const navigations: Array<[string, () => PromiseLike<unknown>]> = [
    ["Open Location", () => vscode.commands.executeCommand("cInsight.openLocation", node)],
    ["Callers tree double-click", () => vscode.commands.executeCommand(
      "cInsight.activateTreeLocation", node, "cInsight.callers", "open",
    )],
    ["Callees tree Enter", () => vscode.commands.executeCommand(
      "cInsight.activateTreeLocation", node, "cInsight.callees", "open",
    )],
    ["Code Preview double-click", () => {
      previewProbe.rendered = {
        document: target, startLine: 0, endLine: target.lineCount - 1, target: location,
      };
      return previewProbe.receiveMessage({
        type: "openPosition", line: destination.line, character: destination.character,
      });
    }],
    ["Code Preview Open in Editor", () => {
      previewProbe.state = { mode: "reference", title: "Navigation target", location };
      return previewProbe.receiveMessage({ type: "openCurrent" });
    }],
    ["Relationship Graph double-click", () => graphProbe.handleMessage({
      type: "openNode", nodeId: "navigation-target",
    })],
  ];
  try {
    for (const [label, navigate] of navigations) {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("workbench.action.clearEditorHistory");
      await showAt(target, remembered);
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await showAt(source, origin);
      await navigate();
      await settleNavigation();
      assertEditorAt(targetUri, destination, `${label}: destination`);
      assert.equal(vscode.window.activeTextEditor?.selection.isEmpty, true,
        `${label}: opening a source result must keep the caret collapsed`);
      if (label === "Relationship Graph double-click") {
        assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, false,
          "Graph navigation must keep its pinned-tab policy");
      }
      for (let repeat = 0; repeat < 2; repeat++) {
        await vscode.commands.executeCommand("workbench.action.navigateBack");
        await settleNavigation();
        const actual = vscode.window.activeTextEditor;
        console.log(`${label}: Back -> ${actual?.document.uri.fsPath}:${(actual?.selection.active.line ?? -1) + 1}`);
        assertEditorAt(sourceUri, origin,
          `${label}: Back must return directly to the origin, not the target's remembered position`);
        await vscode.commands.executeCommand("workbench.action.navigateForward");
        await settleNavigation();
        assertEditorAt(targetUri, destination,
          `${label}: Forward must return directly to the destination`);
      }
    }

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.clearEditorHistory");
    await showAt(target, remembered);
    await showAt(source, origin);
    await vscode.commands.executeCommand("cInsight.openLocation", location);
    await settleNavigation();
    assertEditorAt(targetUri, destination, "Already-open target destination");
    await vscode.commands.executeCommand("workbench.action.navigateBack");
    await settleNavigation();
    assertEditorAt(sourceUri, origin, "Already-open target Back must return to the origin");
    await vscode.commands.executeCommand("workbench.action.navigateForward");
    await settleNavigation();
    assertEditorAt(targetUri, destination, "Already-open target Forward must return to the destination");

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.clearEditorHistory");
    await showAt(source, origin);
    const sameFileTarget = new vscode.Position(80, 6);
    await vscode.commands.executeCommand("cInsight.openLocation", {
      uri: sourceUri, range: new vscode.Range(sameFileTarget, sameFileTarget),
    });
    await settleNavigation();
    assertEditorAt(sourceUri, sameFileTarget, "Same-file destination");
    await vscode.commands.executeCommand("workbench.action.navigateBack");
    await settleNavigation();
    assertEditorAt(sourceUri, origin, "Same-file Back must retain the original caret");
    await vscode.commands.executeCommand("workbench.action.navigateForward");
    await settleNavigation();
    assertEditorAt(sourceUri, sameFileTarget, "Same-file Forward must retain the destination");
    console.log("Editor navigation regressions passed: closed/open target view state, tree activation, Code Preview, graph navigation, same-file Back/Forward, and collapsed carets.");
  } finally {
    preview.dispose();
    graph.dispose();
    output.dispose();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.clearEditorHistory");
    await rm(root, { recursive: true, force: true });
  }
}

async function showAt(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
  await vscode.window.showTextDocument(document, {
    preview: false, preserveFocus: false, selection: new vscode.Range(position, position),
  });
  await settleNavigation();
}

function assertEditorAt(uri: vscode.Uri, position: vscode.Position, message: string): void {
  const editor = vscode.window.activeTextEditor;
  assert.equal(editor?.document.uri.toString(), uri.toString(), message);
  assert.equal(editor?.selection.active.line, position.line, message);
  assert.equal(editor?.selection.active.character, position.character, message);
}

async function settleNavigation(): Promise<void> {
  // The workbench forwards editor and selection events asynchronously. Wait for
  // its native navigation stack, rather than emulating history in the test.
  await new Promise((resolve) => setTimeout(resolve, 250));
}
