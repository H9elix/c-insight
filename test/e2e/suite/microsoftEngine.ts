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
    await verifyMemberCallerScope(workspace);
  } finally {
    await configuration.update(
      "engine",
      previous,
      vscode.ConfigurationTarget.Global,
    );
  }
}

async function verifyMemberCallerScope(workspace: vscode.Uri): Promise<void> {
  const uri = vscode.Uri.joinPath(workspace, "src", "call_sites.c");
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const selected = Array.from(
    { length: document.lineCount },
    (_, line) => ({ line, text: document.lineAt(line).text }),
  ).filter(({ text }) => text.includes("selected->value"));
  const other = Array.from(
    { length: document.lineCount },
    (_, line) => ({ line, text: document.lineAt(line).text }),
  ).find(({ text }) => text.includes("other->value"));
  const unresolved = Array.from(
    { length: document.lineCount },
    (_, line) => ({ line, text: document.lineAt(line).text }),
  ).find(({ text }) => text.includes("member_factory()->value"));
  assert.equal(selected.length, 2);
  assert.ok(other);
  assert.ok(unresolved);
  const position = new vscode.Position(
    selected[0].line,
    selected[0].text.indexOf("value") + 1,
  );
  editor.selection = new vscode.Selection(position, position);
  await waitFor(async () => {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      position,
    );
    return (references?.length ?? 0) >= 4 ? references : undefined;
  }, "Microsoft references for the member field did not become ready");
  await vscode.commands.executeCommand("cInsight.showIncomingCalls");
  let lastState: {
    incomingRoots?: string[];
    incomingOccurrences: Array<{
      line: number;
      depth: number;
      memberScope?: "same-variable" | "unresolved-variable";
    }>;
    incomingScopeHeadings: string[];
  } | undefined;
  const state = await waitFor(async () => {
    const value = await vscode.commands.executeCommand<{
      incomingRoots: string[];
      incomingOccurrences: Array<{
        line: number;
        depth: number;
        memberScope?: "same-variable" | "unresolved-variable";
      }>;
      incomingScopeHeadings: string[];
    }>("cInsight.test.callHierarchyState");
    lastState = value;
    const direct = value.incomingOccurrences.filter((item) => item.depth === 1);
    return direct.filter((item) => item.memberScope === "same-variable").length === 2 &&
      direct.filter((item) => item.memberScope === "unresolved-variable").length === 1
      ? value
      : undefined;
  }, "Microsoft member callers did not apply selected-variable scoping").catch(
    (error: unknown) => {
      throw new Error(`${String(error)}; last state: ${JSON.stringify(lastState)}`);
    },
  );
  const direct = state.incomingOccurrences.filter((item) => item.depth === 1);
  assert.ok(!direct.some((item) => item.line === other.line));
  assert.ok(direct.some((item) => item.line === unresolved.line));
  assert.equal(state.incomingScopeHeadings.length, 2);
}

async function waitFor<T>(
  query: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await query();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}
