import * as vscode from "vscode";
import { ContextController } from "../context/contextController";
import { INTERNAL_COMMANDS } from "../ids";
import { ViewRegistry } from "../views/viewRegistry";
import { RegisterCommand } from "./commandRegistrar";

export function registerCallHierarchyCommands(
  register: RegisterCommand,
  controller: ContextController,
  views: ViewRegistry,
  activePosition: () =>
    | { uri: vscode.Uri; position: vscode.Position }
    | undefined,
): void {
  register("cInsight.showIncomingCalls", async () => {
    const target = activePosition();
    if (target) {
      await controller.resolveNow(target.uri, target.position, {
        manualCallHierarchy: true,
        manualCallDirection: "incoming",
      });
      await vscode.commands.executeCommand(INTERNAL_COMMANDS.CALLERS_FOCUS);
    }
  });
  register("cInsight.showOutgoingCalls", async () => {
    const target = activePosition();
    if (target) {
      await controller.resolveNow(target.uri, target.position, {
        manualCallHierarchy: true,
        manualCallDirection: "outgoing",
      });
      await vscode.commands.executeCommand(INTERNAL_COMMANDS.CALLEES_FOCUS);
    }
  });

  register("cInsight.callers.expandToDepth", () => views.promptExpandCallHierarchy("incoming"));
  register("cInsight.callees.expandToDepth", () => views.promptExpandCallHierarchy("outgoing"));
  register("cInsight.callHierarchy.stopExpansion", () => views.stopCallExpansion());
  register("cInsight.callers.search", () => views.searchCallHierarchy("incoming"));
  register("cInsight.callees.search", () => views.searchCallHierarchy("outgoing"));
  register("cInsight.callers.findPath", () => views.findCallPath("incoming"));
  register("cInsight.callees.findPath", () => views.findCallPath("outgoing"));
  register("cInsight.callers.exportText", () => views.exportCallHierarchy("incoming", "text"));
  register("cInsight.callers.exportJson", () => views.exportCallHierarchy("incoming", "json"));
  register("cInsight.callees.exportText", () => views.exportCallHierarchy("outgoing", "text"));
  register("cInsight.callees.exportJson", () => views.exportCallHierarchy("outgoing", "json"));
  register("cInsight.callers.exportMermaid", () => views.exportCallHierarchy("incoming", "mermaid"));
  register("cInsight.callees.exportMermaid", () => views.exportCallHierarchy("outgoing", "mermaid"));
}
