import * as vscode from "vscode";
import { AnalysisEngine } from "../analysis/analysisEngine";
import { ClangdManager } from "../clangd/clangdManager";
import { ContextController } from "../context/contextController";
import { COMMANDS } from "../ids";
import { ViewRegistry } from "../views/viewRegistry";
import { RegisterCommand } from "./commandRegistrar";

export function registerExtensionControlCommands(
  register: RegisterCommand,
  context: vscode.ExtensionContext,
  engine: AnalysisEngine,
  manager: ClangdManager,
  controller: ContextController,
  views: ViewRegistry,
): void {
  register(COMMANDS.ABOUT, async () => {
    const manifest = context.extension.packageJSON as {
      displayName?: string; name?: string; version?: string;
      author?: string | { name?: string }; license?: string;
    };
    const developer = typeof manifest.author === "string" ? manifest.author : manifest.author?.name ?? "you_jinchun";
    const details = [
      vscode.l10n.t("Version: {version}", { version: manifest.version ?? "unknown" }),
      vscode.l10n.t("Developer: {developer}", { developer }),
      vscode.l10n.t("Semantic engine: {engine}", { engine }),
      vscode.l10n.t("License: {license}", { license: manifest.license ?? "MIT" }),
      vscode.l10n.t("VS Code: {version}", { version: vscode.version }),
      vscode.l10n.t("Platform: {platform} {architecture}", { platform: process.platform, architecture: process.arch }),
      vscode.l10n.t("Remote: {remote}", { remote: vscode.env.remoteName ?? "local" }),
      vscode.l10n.t("Telemetry: disabled; source code is not uploaded by C Insight"),
    ].join("\n");
    const copy = vscode.l10n.t("Copy Information");
    const guideAction = vscode.l10n.t("Open User Guide");
    const action = await vscode.window.showInformationMessage(
      manifest.displayName ?? manifest.name ?? "C Insight", { modal: true, detail: details }, copy, guideAction,
    );
    if (action === copy) await vscode.env.clipboard.writeText(`${manifest.displayName ?? "C Insight"}\n${details}\n`);
    if (action === guideAction) {
      const guide = vscode.Uri.joinPath(context.extensionUri,
        vscode.env.language.toLowerCase().startsWith("zh") ? "docs/user/user-guide.zh-CN.md" : "docs/user/user-guide.en.md");
      await vscode.commands.executeCommand("markdown.showPreview", guide);
    }
  });
  register(COMMANDS.PIN_CONTEXT, () => controller.pin());
  register(COMMANDS.UNPIN_CONTEXT, () => controller.unpin());
  register(COMMANDS.PIN_REFERENCES, () => views.pinReferences());
  register(COMMANDS.UNPIN_REFERENCES, () => { views.unpinReferences(); controller.refresh(); });
  register(COMMANDS.PIN_CALL_HIERARCHY, () => views.pinCallHierarchy());
  register(COMMANDS.UNPIN_CALL_HIERARCHY, () => { views.unpinCallHierarchy(); controller.refresh(); });
  register(COMMANDS.REFRESH, () => controller.refresh(true));
  register(COMMANDS.RESTART_CLANGD, async () => {
    if (engine === "microsoft") {
      void vscode.window.showInformationMessage(vscode.l10n.t(
        "C Insight is using the Microsoft C/C++ language service (cpptools). Reload Window to restart that extension host."));
      return;
    }
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Restarting C Insight clangd") }, () => manager.restart());
      controller.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("C Insight could not start clangd: {error}", { error: String(error) }));
    }
  });
}
