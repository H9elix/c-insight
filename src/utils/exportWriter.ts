import * as vscode from "vscode";
import { encodeExportWithinBudget } from "./exportBudget";
import { runtimeDiagnostics } from "../diagnostics/runtimeDiagnostics";

export async function writeExportWithinBudget(
  uri: vscode.Uri,
  content: string,
): Promise<boolean> {
  const maximumMegabytes = vscode.workspace
    .getConfiguration("cInsight.export")
    .get<number>("maximumMegabytes", 64);
  const encoded = encodeExportWithinBudget(content, maximumMegabytes);
  if (!encoded.data) {
    runtimeDiagnostics.increment("limits.export.maximumMegabytes");
    void vscode.window.showErrorMessage(
      `C Insight: Export is ${formatBytes(encoded.bytes)}, exceeding the ${formatBytes(encoded.maximumBytes)} limit. Increase cInsight.export.maximumMegabytes or export a smaller loaded result set.`,
    );
    return false;
  }
  await vscode.workspace.fs.writeFile(uri, encoded.data);
  return true;
}

function formatBytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
}
