import * as assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";

interface ProbeResult {
  name: string;
  available: boolean;
  durationMs: number;
  count?: number;
  uniqueLocations?: number;
  detail?: string;
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("ms-vscode.cpptools");
  assert.ok(extension, "ms-vscode.cpptools was not loaded");
  const exports = await extension.activate();
  const workspace =
    vscode.workspace.workspaceFolders?.[0]?.uri ??
    assert.fail("The provider probe fixture was not opened");
  const uri = vscode.Uri.joinPath(workspace, "src", "calculator.cpp");
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const callLine = document.lineAt(10).text;
  const addColumn = callLine.indexOf("add");
  assert.ok(addColumn >= 0, "Could not locate the add() call");
  const position = new vscode.Position(10, addColumn + 1);
  const signaturePosition = new vscode.Position(
    10,
    callLine.indexOf("(", addColumn) + 1,
  );
  const results: ProbeResult[] = [];

  const definitions = await requiredLocations(
    results,
    "definition",
    () =>
      vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >("vscode.executeDefinitionProvider", uri, position),
  );
  assert.ok(definitions.length > 0, "Microsoft provider returned no definition");

  await optionalLocations(results, "declaration", () =>
    vscode.commands.executeCommand<
      Array<vscode.Location | vscode.LocationLink>
    >("vscode.executeDeclarationProvider", uri, position),
  );

  const references = await waitFor(
    () =>
      measuredLocations(results, "references", () =>
        vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeReferenceProvider",
          uri,
          position,
        ),
      ),
    (value) => value.length >= 2,
    "Microsoft provider did not finish reference indexing",
  );
  assert.ok(references.length >= 2);

  await measured(results, "hover", async () => {
    const value = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      position,
    );
    return { available: Boolean(value?.length), count: value?.length ?? 0 };
  });
  await measured(results, "document-highlights", async () => {
    const value = await vscode.commands.executeCommand<
      vscode.DocumentHighlight[]
    >("vscode.executeDocumentHighlights", uri, position);
    const kinds = [...new Set((value ?? []).map((item) => item.kind))];
    return {
      available: Boolean(value),
      count: value?.length ?? 0,
      detail: `kinds=${kinds.join(",") || "none"}`,
    };
  });
  await measured(results, "document-symbols", async () => {
    const value = await vscode.commands.executeCommand<
      Array<vscode.DocumentSymbol | vscode.SymbolInformation>
    >("vscode.executeDocumentSymbolProvider", uri);
    return { available: Boolean(value), count: value?.length ?? 0 };
  });
  await measured(results, "workspace-symbols", async () => {
    const value = await vscode.commands.executeCommand<
      vscode.SymbolInformation[]
    >("vscode.executeWorkspaceSymbolProvider", "Calculator");
    return { available: Boolean(value), count: value?.length ?? 0 };
  });
  await measured(results, "signature-help", async () => {
    const value = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      uri,
      signaturePosition,
      "(",
    );
    return {
      available: Boolean(value),
      count: value?.signatures.length ?? 0,
    };
  });

  const callRoots = await measuredValue(results, "prepare-call-hierarchy", () =>
    vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
      "vscode.prepareCallHierarchy",
      uri,
      new vscode.Position(6, 18),
    ),
  );
  if (callRoots?.length) {
    await measured(results, "incoming-calls", async () => {
      const value = await vscode.commands.executeCommand<
        vscode.CallHierarchyIncomingCall[]
      >("vscode.provideIncomingCalls", callRoots[0]);
      return { available: Array.isArray(value), count: value?.length ?? 0 };
    });
    await measured(results, "outgoing-calls", async () => {
      const value = await vscode.commands.executeCommand<
        vscode.CallHierarchyOutgoingCall[]
      >("vscode.provideOutgoingCalls", callRoots[0]);
      return { available: Array.isArray(value), count: value?.length ?? 0 };
    });
  }

  await measured(results, "semantic-tokens", async () => {
    const [legend, tokens] = await Promise.all([
      vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
        "vscode.provideDocumentSemanticTokensLegend",
        uri,
      ),
      vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        uri,
      ),
    ]);
    return {
      available: Boolean(legend && tokens),
      count: tokens?.data.length ? tokens.data.length / 5 : 0,
      detail: `tokenTypes=${legend?.tokenTypes.length ?? 0}`,
    };
  });

  const commands = await vscode.commands.getCommands(true);
  const typeHierarchyCommands = commands.filter((command) =>
    /typeHierarchy/i.test(command),
  );
  results.push({
    name: "public-type-hierarchy-command",
    available: typeHierarchyCommands.some((command) =>
      command.startsWith("vscode."),
    ),
    durationMs: 0,
    detail: typeHierarchyCommands.join(",") || "none",
  });

  const report = {
    schema: "c-insight.microsoft-provider-probe",
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      vscode: vscode.version,
      extensionId: extension.id,
      extensionVersion: extension.packageJSON.version,
      extensionExportsGetApi: Boolean(exports?.getApi),
      workspace: vscode.workspace.name ?? "unnamed-workspace",
    },
    isolation: {
      cInsightLoaded: Boolean(
        vscode.extensions.getExtension("c-insight.c-insight"),
      ),
      note: "Only the Microsoft C/C++ development extension is loaded; provider aggregation with other semantic extensions is tested separately.",
    },
    limitations: {
      directSemanticApi: false,
      providerSelection: false,
      inFlightCancellationToken: false,
    },
    results,
  };
  const output =
    process.env.C_INSIGHT_MICROSOFT_PROBE_OUTPUT ??
    "/tmp/c-insight-microsoft-provider-probe.json";
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

async function requiredLocations(
  results: ProbeResult[],
  name: string,
  query: () => Thenable<Array<vscode.Location | vscode.LocationLink> | undefined>,
): Promise<Array<vscode.Location | vscode.LocationLink>> {
  return measuredLocations(results, name, query);
}

async function optionalLocations(
  results: ProbeResult[],
  name: string,
  query: () => Thenable<Array<vscode.Location | vscode.LocationLink> | undefined>,
): Promise<void> {
  await measuredLocations(results, name, query);
}

async function measuredLocations<T extends vscode.Location | vscode.LocationLink>(
  results: ProbeResult[],
  name: string,
  query: () => Thenable<T[] | undefined>,
): Promise<T[]> {
  const started = performance.now();
  const value = (await query()) ?? [];
  const keys = new Set(value.map(locationKey));
  const result = {
    name,
    available: true,
    durationMs: round(performance.now() - started),
    count: value.length,
    uniqueLocations: keys.size,
  };
  const previous = results.findIndex((item) => item.name === name);
  if (previous >= 0) results[previous] = result;
  else results.push(result);
  return value;
}

async function measured(
  results: ProbeResult[],
  name: string,
  query: () => Promise<Omit<ProbeResult, "name" | "durationMs">>,
): Promise<void> {
  const started = performance.now();
  const value = await query();
  results.push({ name, durationMs: round(performance.now() - started), ...value });
}

async function measuredValue<T>(
  results: ProbeResult[],
  name: string,
  query: () => Thenable<T[] | undefined>,
): Promise<T[] | undefined> {
  const started = performance.now();
  const value = await query();
  results.push({
    name,
    available: Array.isArray(value),
    durationMs: round(performance.now() - started),
    count: value?.length ?? 0,
  });
  return value;
}

async function waitFor<T>(
  query: () => Promise<T>,
  accept: (value: T) => boolean,
  message: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value!: T;
  while (Date.now() < deadline) {
    value = await query();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

function locationKey(location: vscode.Location | vscode.LocationLink): string {
  const uri = location instanceof vscode.Location ? location.uri : location.targetUri;
  const range =
    location instanceof vscode.Location
      ? location.range
      : location.targetSelectionRange ?? location.targetRange;
  return `${uri.toString()}:${range.start.line}:${range.start.character}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
