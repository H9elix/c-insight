import * as assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("cInsight");
  const previous = configuration.inspect<string>("engine")?.globalValue;
  await configuration.update(
    "engine",
    "microsoft",
    vscode.ConfigurationTarget.Global,
  );
  try {
    const cInsight = vscode.extensions.getExtension("c-insight.c-insight");
    const cpptools = vscode.extensions.getExtension("ms-vscode.cpptools");
    assert.ok(cInsight, "C Insight was not loaded");
    assert.ok(cpptools, "Microsoft C/C++ was not loaded");
    await cpptools.activate();
    await cInsight.activate();

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(workspace);
    const uri = vscode.Uri.joinPath(workspace, "src", "calculator.cpp");
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const callLine = document.lineAt(10).text;
    const addColumn = callLine.indexOf("add");
    assert.ok(addColumn >= 0);
    editor.selection = new vscode.Selection(
      10,
      addColumn + 1,
      10,
      addColumn + 1,
    );

    await vscode.commands.executeCommand("cInsight.goToDefinition");
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      uri.toString(),
    );
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 2);

    editor.selection = new vscode.Selection(6, 18, 6, 18);
    await vscode.window.showTextDocument(document, {
      selection: editor.selection,
    });
    await vscode.commands.executeCommand("cInsight.findReferences");
    await vscode.commands.executeCommand("cInsight.showIncomingCalls");
    await vscode.commands.executeCommand("cInsight.showOutgoingCalls");

    assert.equal(
      vscode.workspace.getConfiguration("cInsight").get("engine"),
      "microsoft",
    );
  } finally {
    await configuration.update(
      "engine",
      previous,
      vscode.ConfigurationTarget.Global,
    );
  }
}
