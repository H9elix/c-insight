import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import { CallHierarchyRepository } from "../../../src/callHierarchy/callHierarchyRepository";
import { ContextController } from "../../../src/context/contextController";
import type { NavigationVisibility } from "../../../src/context/navigationDemand";
import type { LocationResult, SymbolContext } from "../../../src/models/types";
import type { ViewRegistry } from "../../../src/views/viewRegistry";

/** Actual controller base/detail paths, live Provider evidence, controlled visibility.
 * This intentionally does not claim native mouse events or physical view layout coverage.
 */
export async function verifyCommandLineMacroAutoRefresh(
  uri: vscode.Uri,
  feature: vscode.Position,
  number: vscode.Position,
): Promise<unknown[]> {
  const reports = [];
  for (const [name, at, contextVisible, manual] of [
    ["feature-hidden-context", feature, false, false],
    ["number-hidden-context", number, false, false],
    ["feature-visible-context", feature, true, false],
    ["feature-manual-refresh", feature, false, true],
  ] as const) {
    const queries: string[] = [];
    const published: SymbolContext[] = [];
    const errors: string[] = [];
    const visibility = new vscode.EventEmitter<string>();
    const locations = (values: Array<vscode.Location | vscode.LocationLink> = []): LocationResult[] => values.map(value =>
      "targetUri" in value
        ? { uri: value.targetUri, range: value.targetSelectionRange ?? value.targetRange }
        : value,
    );
    const analysis = {
      analysisEngine: "clangd",
      async definition(target: vscode.Uri, position: vscode.Position) {
        queries.push("definition");
        return locations(await vscode.commands.executeCommand("vscode.executeDefinitionProvider", target, position));
      },
      async declaration(target: vscode.Uri, position: vscode.Position) {
        queries.push("declaration");
        return locations(await vscode.commands.executeCommand("vscode.executeDeclarationProvider", target, position));
      },
      async prepareCallHierarchy(target: vscode.Uri, position: vscode.Position) {
        queries.push("prepareCallHierarchy");
        const roots = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", target, position);
        assert.equal(roots?.length ?? 0, 0, "This macro scenario no longer has an empty native root; recharacterize it");
        return [];
      },
      async hover(target: vscode.Uri, position: vscode.Position) {
        queries.push("hover");
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", target, position);
        return hovers?.flatMap(value => value.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
      },
      async symbolInfo() {
        queries.push("symbolInfo-unavailable-in-public-adapter");
        return undefined;
      },
      async references(target: vscode.Uri, position: vscode.Position) {
        queries.push("references");
        return locations(await vscode.commands.executeCommand("vscode.executeReferenceProvider", target, position));
      },
    } as unknown as AnalysisService;
    const views = {
      navigationVisible: true,
      navigationVisibility: { context: contextVisible, preview: true, references: true, callers: true, callees: false } as NavigationVisibility,
      preferredDefinitionNeedsUpgrade: false,
      onDidChangeNavigationVisibility: visibility.event,
      updateContext: (context: SymbolContext) => { published.push(context); },
      beginContextPreview() {},
      invalidateCallHierarchy() {},
    } as unknown as ViewRegistry;
    const controller = new ContextController(analysis, new CallHierarchyRepository(analysis), views, {
      appendLine: (line: string) => { errors.push(line); },
    } as vscode.OutputChannel);
    try {
      if (manual) {
        await vscode.window.showTextDocument(uri, { selection: new vscode.Range(at, at) });
        controller.refresh(true);
      } else {
        await (controller as unknown as {
          resolveCursor(uri: vscode.Uri, at: vscode.Position, generation: number, intent: object): Promise<void>;
        }).resolveCursor(uri, at, 0, {});
      }
      if (name !== "feature-hidden-context") {
        const deadline = Date.now() + 10_000;
        while (published.at(-1)?.detailsPending !== false && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(published.at(-1)?.detailsPending, false, `Details did not finish: ${name}`);
        assert.equal(published.at(-1)?.references.length, at === feature ? 2 : 5);
      } else {
        assert.equal(published.length, 0, "The visibility-dependent false-negative changed; recharacterize this limitation");
        assert(!queries.includes("references"));
      }
      assert.deepEqual(errors, []);
      reports.push({ name, contextVisible, manual, queries, publications: published.length,
        finalReferences: published.at(-1)?.references.length ?? 0,
        finalCallRoots: published.at(-1)?.callRoots.length ?? 0,
      });
    } finally {
      controller.dispose();
      visibility.dispose();
    }
  }
  console.log("COMMAND_LINE_MACRO_AUTO_REFRESH " + JSON.stringify(reports));
  return reports;
}
