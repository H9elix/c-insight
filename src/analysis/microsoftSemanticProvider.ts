import * as vscode from "vscode";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentHighlight,
  DocumentSymbol,
  SymbolInformation,
} from "vscode-languageclient/node";
import { CallNode, LocationResult, LspSymbol } from "../models/types";
import { callHierarchyKey } from "../utils/callHierarchy";

export class MicrosoftSemanticProvider {
  private readonly callItems = new Map<string, vscode.CallHierarchyItem>();
  async activate(): Promise<void> {
    const extension = vscode.extensions.getExtension("ms-vscode.cpptools");
    if (!extension) {
      throw new MicrosoftProviderUnavailableError(
        "Microsoft C/C++ extension (ms-vscode.cpptools) is not installed in this VS Code host.",
      );
    }
    await extension.activate();
  }

  definition(uri: vscode.Uri, position: vscode.Position): Promise<LocationResult[]> {
    return this.locations("vscode.executeDefinitionProvider", uri, position);
  }

  declaration(uri: vscode.Uri, position: vscode.Position): Promise<LocationResult[]> {
    return this.locations("vscode.executeDeclarationProvider", uri, position);
  }

  references(uri: vscode.Uri, position: vscode.Position): Promise<LocationResult[]> {
    return this.locations("vscode.executeReferenceProvider", uri, position);
  }

  async hover(uri: vscode.Uri, position: vscode.Position): Promise<string | undefined> {
    const values = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      position,
    );
    const contents = values?.flatMap((value) => value.contents) ?? [];
    const rendered = contents
      .map((value) => (typeof value === "string" ? value : value.value))
      .filter(Boolean)
      .join("\n");
    return rendered || undefined;
  }

  async activeParameterLabel(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<string | undefined> {
    const result = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      uri,
      position,
    );
    const signature = result?.signatures[result.activeSignature ?? 0];
    if (!signature) return undefined;
    const parameter = signature.parameters?.[
      result.activeParameter ?? signature.activeParameter ?? 0
    ];
    if (!parameter) return undefined;
    return typeof parameter.label === "string"
      ? parameter.label
      : signature.label.slice(parameter.label[0], parameter.label[1]);
  }

  async prepareCallHierarchy(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<CallNode[]> {
    const values =
      (await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
        "vscode.prepareCallHierarchy",
        uri,
        position,
      )) ?? [];
    return values.map((value) => {
      const raw = toLspCallItem(value);
      const key = callHierarchyKey(raw);
      this.callItems.set(key, value);
      return { key, raw };
    });
  }

  async incomingCalls(node: CallNode): Promise<CallHierarchyIncomingCall[]> {
    const values =
      (await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        "vscode.provideIncomingCalls",
        this.callItems.get(node.key) ?? toVsCallItem(node.raw),
      )) ?? [];
    return values.map((value) => {
      const from = toLspCallItem(value.from);
      this.callItems.set(callHierarchyKey(from), value.from);
      return { from, fromRanges: value.fromRanges.map(toLspRange) };
    });
  }

  async outgoingCalls(node: CallNode): Promise<CallHierarchyOutgoingCall[]> {
    const values =
      (await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        "vscode.provideOutgoingCalls",
        this.callItems.get(node.key) ?? toVsCallItem(node.raw),
      )) ?? [];
    return values.map((value) => {
      const to = toLspCallItem(value.to);
      this.callItems.set(callHierarchyKey(to), value.to);
      return { to, fromRanges: value.fromRanges.map(toLspRange) };
    });
  }

  async documentSymbols(uri: vscode.Uri): Promise<LspSymbol[]> {
    const values =
      (await vscode.commands.executeCommand<
        Array<vscode.DocumentSymbol | vscode.SymbolInformation>
      >("vscode.executeDocumentSymbolProvider", uri)) ?? [];
    return values.map(toLspSymbol);
  }

  async documentHighlights(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<DocumentHighlight[]> {
    const values =
      (await vscode.commands.executeCommand<vscode.DocumentHighlight[]>(
        "vscode.executeDocumentHighlights",
        uri,
        position,
      )) ?? [];
    return values.map((value) => ({
      range: toLspRange(value.range),
      kind: value.kind as number as DocumentHighlight["kind"],
    }));
  }

  async workspaceSymbols(query: string): Promise<SymbolInformation[]> {
    const values =
      (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query,
      )) ?? [];
    return values.map((value) => toLspSymbol(value) as SymbolInformation);
  }

  private async locations(
    command: string,
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<LocationResult[]> {
    const values =
      (await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >(command, uri, position)) ?? [];
    return values.map((value) =>
      value instanceof vscode.Location
        ? { uri: value.uri, range: value.range }
        : {
            uri: value.targetUri,
            range: value.targetSelectionRange ?? value.targetRange,
          },
    );
  }
}

export class MicrosoftProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftProviderUnavailableError";
  }
}

function toLspPosition(value: vscode.Position): { line: number; character: number } {
  return { line: value.line, character: value.character };
}

function toLspRange(value: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return { start: toLspPosition(value.start), end: toLspPosition(value.end) };
}

function toLspCallItem(value: vscode.CallHierarchyItem): CallHierarchyItem {
  return {
    name: value.name,
    kind: value.kind as number as CallHierarchyItem["kind"],
    tags: value.tags ? ([...value.tags] as CallHierarchyItem["tags"]) : undefined,
    detail: value.detail,
    uri: value.uri.toString(),
    range: toLspRange(value.range),
    selectionRange: toLspRange(value.selectionRange),
  };
}

function toVsCallItem(value: CallHierarchyItem): vscode.CallHierarchyItem {
  return new vscode.CallHierarchyItem(
    value.kind as number as vscode.SymbolKind,
    value.name,
    value.detail ?? "",
    vscode.Uri.parse(value.uri),
    new vscode.Range(
      value.range.start.line,
      value.range.start.character,
      value.range.end.line,
      value.range.end.character,
    ),
    new vscode.Range(
      value.selectionRange.start.line,
      value.selectionRange.start.character,
      value.selectionRange.end.line,
      value.selectionRange.end.character,
    ),
  );
}

function toLspSymbol(
  value: vscode.DocumentSymbol | vscode.SymbolInformation,
): DocumentSymbol | SymbolInformation {
  if (value instanceof vscode.SymbolInformation) {
    return {
      name: value.name,
      kind: value.kind as number as SymbolInformation["kind"],
      tags: value.tags ? ([...value.tags] as SymbolInformation["tags"]) : undefined,
      containerName: value.containerName,
      location: {
        uri: value.location.uri.toString(),
        range: toLspRange(value.location.range),
      },
    };
  }
  return {
    name: value.name,
    detail: value.detail,
    kind: value.kind as number as DocumentSymbol["kind"],
    tags: value.tags ? ([...value.tags] as DocumentSymbol["tags"]) : undefined,
    range: toLspRange(value.range),
    selectionRange: toLspRange(value.selectionRange),
    children: value.children.map((child) => toLspSymbol(child) as DocumentSymbol),
  };
}
