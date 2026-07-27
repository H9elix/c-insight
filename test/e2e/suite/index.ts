import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "c-insight.c-insight";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `${extensionId} was not loaded in the Extension Host`);
  await extension.activate();

  const uri = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders?.[0]?.uri ??
      assert.fail("The C++ fixture workspace was not opened"),
    "src",
    "calculator.cpp",
  );
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const callLine = document.lineAt(10).text;
  const addColumn = callLine.indexOf("add");
  assert.ok(addColumn >= 0, "Could not find the add call in the fixture");
  const position = new vscode.Position(10, addColumn + 1);

  // Exercise cursor-follow cancellation before waiting for the final symbol.
  // Large projects otherwise accumulate expensive stale reference/call queries.
  for (let index = 0; index < 20; index += 1) {
    const transient = new vscode.Position(
      index % document.lineCount,
      0,
    );
    editor.selection = new vscode.Selection(transient, transient);
  }
  editor.selection = new vscode.Selection(position, position);

  const definitions = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >("vscode.executeDefinitionProvider", uri, position);
    return value && value.length > 0 ? value : undefined;
  }, "clangd did not return a definition for Calculator::add");

  const references = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      position,
    );
    return value && value.length >= 2 ? value : undefined;
  }, "clangd did not return references for Calculator::add");

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "cInsight.goToDefinition",
    "cInsight.findReferences",
    "cInsight.showIncomingCalls",
    "cInsight.showOutgoingCalls",
    "cInsight.previewLocation",
    "cInsight.references.search",
    "cInsight.references.groupBy",
    "cInsight.references.scope",
    "cInsight.references.loadMore",
    "cInsight.references.exportJson",
    "cInsight.callers.expandToDepth",
    "cInsight.callees.expandToDepth",
    "cInsight.callHierarchy.stopExpansion",
    "cInsight.callers.search",
    "cInsight.callees.search",
    "cInsight.callers.exportJson",
    "cInsight.callees.exportJson",
    "cInsight.callers.findPath",
    "cInsight.callees.findPath",
    "cInsight.callers.exportMermaid",
    "cInsight.callees.exportMermaid",
    "cInsight.pinReferences",
    "cInsight.unpinReferences",
    "cInsight.pinCallHierarchy",
    "cInsight.unpinCallHierarchy",
    "cInsight.diagnostics.refresh",
    "cInsight.openProjectDiagnostics",
    "cInsight.history.preview",
    "cInsight.history.filter",
    "cInsight.history.clear",
    "cInsight.bookmarks.addCurrent",
    "cInsight.bookmarks.add",
    "cInsight.bookmarks.rename",
    "cInsight.bookmarks.changeGroup",
    "cInsight.bookmarks.delete",
    "cInsight.bookmarks.refresh",
    "cInsight.diagnostics.showClangdLog",
    "cInsight.index.refresh",
    "cInsight.diagnostics.selectCompilationDatabase",
    "cInsight.diagnostics.clearCompilationDatabase",
  ]) {
    assert.ok(commands.includes(command), `${command} was not registered`);
  }

  const firstDefinition = definitions[0];
  const definitionLocation =
    firstDefinition instanceof vscode.Location
      ? firstDefinition
      : new vscode.Location(
          firstDefinition.targetUri,
          firstDefinition.targetSelectionRange ??
            firstDefinition.targetRange,
        );
  await vscode.commands.executeCommand(
    "cInsight.previewLocation",
    definitionLocation,
    "definition",
    "Calculator::add",
  );
  await vscode.commands.executeCommand("cInsight.findReferences");
  await vscode.commands.executeCommand("cInsight.references.showAll");
  await vscode.commands.executeCommand("cInsight.references.clearSearch");
  await vscode.commands.executeCommand("cInsight.showOutgoingCalls");
  await vscode.commands.executeCommand("cInsight.pinReferences");
  await vscode.commands.executeCommand("cInsight.unpinReferences");
  await vscode.commands.executeCommand("cInsight.pinCallHierarchy");
  await vscode.commands.executeCommand("cInsight.unpinCallHierarchy");
  await vscode.commands.executeCommand("cInsight.callHierarchy.stopExpansion");

  assert.ok(references.length >= 2);
}

async function waitFor<T>(
  query: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await query();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    lastError === undefined ? message : `${message}: ${String(lastError)}`,
  );
}
