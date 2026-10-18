import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

interface TreeRow { label: string; uri?: string; line?: number }
interface CallState {
  incomingRoots: string[];
  incomingLabels: string[];
  incomingOccurrences: Array<{ label: string; uri: string; line: number; depth: number }>;
}

export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0].uri;
  const config = vscode.workspace.getConfiguration("cInsight");
  const settings: Record<string, unknown> = {
    engine: "clangd", "clangd.path": process.env.CINSIGHT_TEST_CLANGD20 || "/usr/bin/clangd-20",
    compileCommandsDir: vscode.Uri.joinPath(workspace, "build").fsPath,
    followCursor: false, "session.restore": false,
    "references.groupBy": "flat", "codePreview.semanticHighlighting": false,
  };
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(settings)) {
    previous.set(key, config.inspect(key)?.globalValue);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
  try {
    const extension = vscode.extensions.getExtension("H9elix.c-insight");
    assert(extension);
    await extension.activate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace, "main.c"));
    const other = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspace, "other.c"));
    const editor = await vscode.window.showTextDocument(document);
    const position = (snippet: string, name: string) => {
      const offset = document.getText().indexOf(snippet);
      assert(offset >= 0, `Missing fixture snippet: ${snippet}`);
      return document.positionAt(offset + snippet.indexOf(name) + 1);
    };
    const numberPosition = position("return CI_BUILD_NUMBER;", "CI_BUILD_NUMBER");
    for (const opened of [document, other]) {
      await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", opened.uri);
    }
    await waitFor(async () => {
      const values = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, numberPosition);
      return hoverText(values).includes("7") ? true : undefined;
    }, "The compile-command macro value was not visible to clangd");

    const cases = [
      ["CI_BUILD_NUMBER", numberPosition],
      ["CI_BUILD_FEATURE", position("#if CI_BUILD_FEATURE", "CI_BUILD_FEATURE")],
      ["CI_BUILD_TRACE", position("CI_BUILD_TRACE(CI_BUILD_NUMBER)", "CI_BUILD_TRACE")],
      ["SOURCE_TRACE", position("SOURCE_TRACE(CI_BUILD_NUMBER)", "SOURCE_TRACE")],
      ["trace_value", position("int direct = trace_value(CI_BUILD_NUMBER)", "trace_value")],
    ] as const;
    const reports = [];
    for (const [name, at] of cases) {
      await vscode.window.showTextDocument(document);
      editor.selection = new vscode.Selection(at, at);
      const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
        "vscode.executeDefinitionProvider", document.uri, at,
      );
      const cInsightDefinitions = await vscode.commands.executeCommand<vscode.Location[]>("cInsight.test.definitionAtCursor");
      const hover = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", document.uri, at);
      const references = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", document.uri, at);
      const nativeRoots = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", document.uri, at);
      await vscode.commands.executeCommand("cInsight.findReferences");
      await vscode.commands.executeCommand("cInsight.references.showAll");
      const referenceRows = await vscode.commands.executeCommand<TreeRow[]>("cInsight.test.resultTreeInteraction", "cInsight.references");
      await vscode.commands.executeCommand("cInsight.showIncomingCalls");
      await vscode.commands.executeCommand("cInsight.test.expandCallHierarchy", "incoming", 1);
      const callers = await vscode.commands.executeCommand<CallState>("cInsight.test.callHierarchyState");
      await vscode.commands.executeCommand("cInsight.test.symbolSearchQuery", name);
      const symbols = await waitFor(async () => {
        const state = await vscode.commands.executeCommand<{ query: string; loading: boolean; results: number }>("cInsight.test.symbolSearchState");
        return state.query === name && !state.loading ? state : undefined;
      }, "Symbol search did not finish");
      const locations = (values: Array<vscode.Location | vscode.LocationLink> = []) => values.map(value => {
        const uri = "targetUri" in value ? value.targetUri : value.uri;
        const range = "targetUri" in value ? value.targetSelectionRange ?? value.targetRange : value.range;
        return { file: path.basename(uri.fsPath), line: range.start.line + 1 };
      });
      const report = {
        name, queryLine: at.line + 1, hover: hoverText(hover),
        definitions: locations(definitions), cInsightDefinitions: locations(cInsightDefinitions),
        references: locations(references),
        cInsightReferenceRows: referenceRows.filter(row => row.uri).map(row => ({
          file: path.basename(vscode.Uri.parse(row.uri!).fsPath), line: (row.line ?? 0) + 1,
        })),
        nativeRoots: nativeRoots?.map(root => root.name) ?? [],
        cInsightCallerRoots: callers.incomingRoots,
        cInsightCallerLabels: callers.incomingLabels,
        cInsightCallSites: callers.incomingOccurrences.filter(row => row.depth === 1).map(row => ({
          name: row.label, line: row.line + 1,
        })),
        workspaceSymbolResults: symbols.results,
      };
      assert.deepEqual(report.cInsightDefinitions, report.definitions, "C Insight changed the Provider's definition locations");
      assert.deepEqual(report.cInsightReferenceRows, report.references, `References UI lost source uses of ${name}`);
      if (name.startsWith("CI_BUILD_")) {
        assert(report.hover.includes(`#define ${name}`), `Missing command-line macro recognition: ${name}`);
        const expected = [document, other].flatMap(source => Array.from(
          source.getText().matchAll(new RegExp(`\\b${name}\\b`, "g")),
          match => ({ file: path.basename(source.uri.fsPath), line: source.positionAt(match.index).line + 1 }),
        ));
        assert.deepEqual(report.references, expected, `Macro References do not match all exact uses: ${name}`);
      }
      if (name === "SOURCE_TRACE") {
        assert.deepEqual(report.cInsightCallerRoots, ["SOURCE_TRACE"]);
        assert.deepEqual(report.cInsightCallSites.map(site => site.line), [at.line + 1], "Source-defined macro control lost its exact-use scope");
      }
      reports.push(report);
    }
    writeFileSync(vscode.Uri.joinPath(workspace, "build/c-insight-probe.json").fsPath, JSON.stringify({
      extensionVersion: extension.packageJSON.version, vscodeVersion: vscode.version,
      engine: "clangd", results: reports,
    }, null, 2) + "\n");
    console.log("COMMAND_LINE_MACRO_PROBE " + JSON.stringify(reports));
    console.log("Positive assertions passed: command-line macro hover, complete exact References, shared Provider definition mapping, and source-defined macro Caller control. Command-line macro definition/Caller limitations remain characterization results, not fixes.");
  } finally {
    for (const [key, value] of previous) await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
}

function hoverText(values: vscode.Hover[] = []): string {
  return values.flatMap(value => value.contents.map(content => typeof content === "string" ? content : content.value)).join("\n");
}

async function waitFor<T>(query: () => Promise<T | undefined>, message: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await query();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(message);
}
