import * as vscode from "vscode";
import { isCppDocument } from "../configuration/configuration";
import { COMMANDS } from "../ids";
import { IncludeHierarchyDirection, IncludeHierarchyExplorer } from "../includeHierarchy/includeHierarchyExplorer";
import { TypeHierarchyDirection, TypeHierarchyExplorer } from "../typeHierarchy/typeHierarchyExplorer";
import { RegisterCommand } from "./commandRegistrar";

type ActivePosition = () => { uri: vscode.Uri; position: vscode.Position } | undefined;

export function registerHierarchyCommands(
  register: RegisterCommand,
  typeHierarchy: TypeHierarchyExplorer,
  includeHierarchy: IncludeHierarchyExplorer,
  activePosition: ActivePosition,
): void {
  const showType = async (direction: TypeHierarchyDirection): Promise<void> => {
    const target = activePosition();
    if (target) await typeHierarchy.show(direction, target.uri, target.position);
  };
  register(COMMANDS.TYPE_HIERARCHY_SHOW_SUPERTYPES, () => showType("supertypes"));
  register(COMMANDS.TYPE_HIERARCHY_SHOW_SUBTYPES, () => showType("subtypes"));
  register(COMMANDS.SUPERTYPES_EXPAND_TO_DEPTH, () => typeHierarchy.promptExpand("supertypes"));
  register(COMMANDS.SUBTYPES_EXPAND_TO_DEPTH, () => typeHierarchy.promptExpand("subtypes"));
  register(COMMANDS.TYPE_HIERARCHY_STOP_EXPANSION, () => typeHierarchy.stopExpansion());
  register(COMMANDS.SUPERTYPES_SEARCH, () => typeHierarchy.search("supertypes"));
  register(COMMANDS.SUBTYPES_SEARCH, () => typeHierarchy.search("subtypes"));
  register(COMMANDS.SUPERTYPES_EXPORT_TEXT, () => typeHierarchy.export("supertypes", "text"));
  register(COMMANDS.SUPERTYPES_EXPORT_JSON, () => typeHierarchy.export("supertypes", "json"));
  register(COMMANDS.SUPERTYPES_EXPORT_MERMAID, () => typeHierarchy.export("supertypes", "mermaid"));
  register(COMMANDS.SUBTYPES_EXPORT_TEXT, () => typeHierarchy.export("subtypes", "text"));
  register(COMMANDS.SUBTYPES_EXPORT_JSON, () => typeHierarchy.export("subtypes", "json"));
  register(COMMANDS.SUBTYPES_EXPORT_MERMAID, () => typeHierarchy.export("subtypes", "mermaid"));

  const showInclude = async (direction: IncludeHierarchyDirection): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file" || !isCppDocument(editor.document)) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t("C Insight: Open and activate a local C/C++ source or header file first."),
      );
      return;
    }
    await includeHierarchy.show(direction, editor.document.uri);
  };
  register(COMMANDS.INCLUDE_HIERARCHY_SHOW_INCLUDES, () => showInclude("includes"));
  register(COMMANDS.INCLUDE_HIERARCHY_SHOW_INCLUDED_BY, () => showInclude("includedBy"));
  register(COMMANDS.INCLUDES_EXPAND_TO_DEPTH, () => includeHierarchy.promptExpand("includes"));
  register(COMMANDS.INCLUDED_BY_EXPAND_TO_DEPTH, () => includeHierarchy.promptExpand("includedBy"));
  register(COMMANDS.INCLUDES_STOP_EXPANSION, () => includeHierarchy.stopExpansion("includes"));
  register(COMMANDS.INCLUDED_BY_STOP_EXPANSION, () => includeHierarchy.stopExpansion("includedBy"));
  register(COMMANDS.INCLUDES_SEARCH, () => includeHierarchy.search("includes"));
  register(COMMANDS.INCLUDED_BY_SEARCH, () => includeHierarchy.search("includedBy"));
  register(COMMANDS.INCLUDES_EXPORT_TEXT, () => includeHierarchy.export("includes", "text"));
  register(COMMANDS.INCLUDES_EXPORT_JSON, () => includeHierarchy.export("includes", "json"));
  register(COMMANDS.INCLUDES_EXPORT_MERMAID, () => includeHierarchy.export("includes", "mermaid"));
  register(COMMANDS.INCLUDED_BY_EXPORT_TEXT, () => includeHierarchy.export("includedBy", "text"));
  register(COMMANDS.INCLUDED_BY_EXPORT_JSON, () => includeHierarchy.export("includedBy", "json"));
  register(COMMANDS.INCLUDED_BY_EXPORT_MERMAID, () => includeHierarchy.export("includedBy", "mermaid"));
}
