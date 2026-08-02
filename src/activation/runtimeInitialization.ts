import * as vscode from "vscode";
import { AnalysisEngine } from "../analysis/analysisEngine";
import { analysisEngineDisplayName } from "../analysis/enginePresentation";
import { MicrosoftSemanticProvider } from "../analysis/microsoftSemanticProvider";
import { ClangdManager } from "../clangd/clangdManager";
import { CONTEXT_KEYS } from "../ids";

export async function initializeContextKeys(): Promise<void> {
  await Promise.all([
    vscode.commands.executeCommand("setContext", CONTEXT_KEYS.ACTIVE, true),
    vscode.commands.executeCommand("setContext", CONTEXT_KEYS.CONTEXT_PINNED, false),
    vscode.commands.executeCommand("setContext", CONTEXT_KEYS.PREVIEW_LOCKED, false),
    vscode.commands.executeCommand("setContext", CONTEXT_KEYS.REFERENCES_PINNED, false),
    vscode.commands.executeCommand("setContext", CONTEXT_KEYS.CALL_HIERARCHY_PINNED, false),
  ]);
}

export async function startAnalysisEngine(
  engine: AnalysisEngine,
  manager: ClangdManager,
  output: vscode.OutputChannel,
  showMicrosoftNotice: () => void,
): Promise<void> {
  if (engine === "microsoft") {
    await new MicrosoftSemanticProvider().activate();
    manager.useMicrosoftProvider();
    output.appendLine(`Analysis engine: ${analysisEngineDisplayName(engine)}`);
    showMicrosoftNotice();
    return;
  }
  await manager.start();
}
