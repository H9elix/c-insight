import * as path from "node:path";
import * as vscode from "vscode";
import { ClangdManager } from "../clangd/clangdManager";
import { ProjectDiagnostics } from "../diagnostics/projectDiagnostics";
import { COMMANDS, INTERNAL_COMMANDS } from "../ids";
import { RegisterCommand } from "./commandRegistrar";

export function registerDiagnosticCommands(
  register: RegisterCommand,
  manager: ClangdManager,
  diagnostics: ProjectDiagnostics,
): void {
  register(COMMANDS.DIAGNOSTICS_REFRESH, () => diagnostics.refresh());
  register(COMMANDS.OPEN_PROJECT_DIAGNOSTICS, () =>
    vscode.commands.executeCommand(INTERNAL_COMMANDS.STATUS_FOCUS));
  register(COMMANDS.DIAGNOSTICS_SHOW_CLANGD_LOG, () => manager.showLog());
  register(COMMANDS.DIAGNOSTICS_COPY_REPORT, () => diagnostics.copyReport("text"));
  register(COMMANDS.DIAGNOSTICS_EXPORT_TEXT, () => diagnostics.exportReport("text"));
  register(COMMANDS.DIAGNOSTICS_EXPORT_JSON, () => diagnostics.exportReport("json"));
  register(COMMANDS.INDEX_REFRESH, () => vscode.commands.executeCommand(COMMANDS.RESTART_CLANGD));
  register(COMMANDS.DIAGNOSTICS_SELECT_COMPILATION_DATABASE, async () => {
    const selected = await vscode.window.showOpenDialog({
      title: vscode.l10n.t("Select compile_commands.json"),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { JSON: ["json"] },
    });
    if (!selected?.[0]) return;
    if (path.basename(selected[0].fsPath) !== "compile_commands.json") {
      void vscode.window.showErrorMessage(
        vscode.l10n.t("C Insight: Select a file named compile_commands.json."),
      );
      return;
    }
    await vscode.workspace.getConfiguration("cInsight").update(
      "compileCommandsDir",
      path.dirname(selected[0].fsPath),
      vscode.ConfigurationTarget.Workspace,
    );
  });
  register(COMMANDS.DIAGNOSTICS_CLEAR_COMPILATION_DATABASE, () =>
    vscode.workspace.getConfiguration("cInsight").update(
      "compileCommandsDir",
      "",
      vscode.ConfigurationTarget.Workspace,
    ));
}
