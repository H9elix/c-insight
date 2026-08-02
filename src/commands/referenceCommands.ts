import * as vscode from "vscode";
import { AnalysisService } from "../analysis/analysisService";
import { readConfiguration } from "../configuration/configuration";
import { ViewRegistry } from "../views/viewRegistry";
import { INTERNAL_COMMANDS } from "../ids";
import { RegisterCommand } from "./commandRegistrar";

export function registerReferenceCommands(
  register: RegisterCommand,
  analysis: AnalysisService,
  views: ViewRegistry,
  activePosition: () =>
    | { uri: vscode.Uri; position: vscode.Position }
    | undefined,
): void {
  register("cInsight.findReferences", async () => {
    const target = activePosition();
    if (!target) {
      return;
    }
    views.referenceExplorer.loading();
    try {
      const [locations, definitions, declarations, callRoots] = await Promise.all([
        analysis.references(
          target.uri,
          target.position,
          readConfiguration().includeDeclarationInReferences,
        ),
        analysis.definition(target.uri, target.position),
        analysis.declaration(target.uri, target.position),
        analysis.prepareCallHierarchy(target.uri, target.position).catch(() => []),
      ]);
      views.updateReferences(
        locations,
        definitions,
        declarations,
        callRoots.length > 0,
        callRoots[0]?.raw.name,
        true,
      );
      await vscode.commands.executeCommand(INTERNAL_COMMANDS.REFERENCES_FOCUS);
    } catch (error) {
      views.referencesFailed(error, true);
    }
  });

  register("cInsight.references.search", () => views.referenceExplorer.promptSearch());
  register("cInsight.references.clearSearch", () => views.referenceExplorer.clearSearch());
  register("cInsight.references.groupBy", () => views.referenceExplorer.chooseGrouping());
  register("cInsight.references.scope", () => views.referenceExplorer.chooseScope());
  register("cInsight.references.filterEvidence", () => views.referenceExplorer.chooseEvidenceFilter());
  register("cInsight.references.loadMore", () => views.referenceExplorer.loadMore());
  register("cInsight.references.showAll", () => views.referenceExplorer.showAll());
  register("cInsight.references.copy", (value: unknown) => views.referenceExplorer.copyReference(value));
  register("cInsight.references.copyAll", () => views.referenceExplorer.copyAll());
  register("cInsight.references.exportText", () => views.referenceExplorer.exportResults("text"));
  register("cInsight.references.exportJson", () => views.referenceExplorer.exportResults("json"));
  register("cInsight.references.openList", () => views.referenceExplorer.openResultList());
  register("cInsight.references.expandAll", () => views.referenceExplorer.expandAll());
  register("cInsight.references.collapseAll", () => views.referenceExplorer.collapseAll());
}
