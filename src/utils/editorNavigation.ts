import * as vscode from "vscode";

/** Open at the target atomically so restored view state is not a history stop. */
export async function showEditorLocation(
  document: vscode.TextDocument,
  range: vscode.Range,
  options: { preview?: boolean; revealType?: vscode.TextEditorRevealType } = {},
): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, {
    preview: options.preview ?? true,
    preserveFocus: false,
    selection: new vscode.Range(range.start, range.start),
  });
  // Revealing affects only the viewport; do not set selection a second time.
  editor.revealRange(range, options.revealType ?? vscode.TextEditorRevealType.InCenter);
}
