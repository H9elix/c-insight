import * as vscode from "vscode";
import {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  DocumentHighlight,
  Hover,
  Location,
  LocationLink,
  Position,
  Range,
  SymbolInformation,
  TypeHierarchyItem,
} from "vscode-languageclient/node";
import { ClangdManager } from "../clangd/clangdManager";
import { CallNode, LocationResult, LspSymbol } from "../models/types";
import { callHierarchyKey } from "../utils/callHierarchy";

interface PositionParams {
  textDocument: { uri: string };
  position: Position;
}

interface SymbolDetails {
  name: string;
  containerName?: string;
  usr?: string;
  id?: string;
}

export class AnalysisService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly manager: ClangdManager,
    private readonly output?: vscode.OutputChannel,
  ) {}

  async definition(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<LocationResult[]> {
    const result = await this.request<Location | Location[] | LocationLink[] | null>(
      "textDocument/definition",
      this.positionParams(uri, position),
      token,
    );
    return this.toLocations(result);
  }

  async declaration(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<LocationResult[]> {
    const result = await this.request<Location | Location[] | LocationLink[] | null>(
      "textDocument/declaration",
      this.positionParams(uri, position),
      token,
    );
    return this.toLocations(result);
  }

  async references(
    uri: vscode.Uri,
    position: vscode.Position,
    includeDeclaration: boolean,
    token?: vscode.CancellationToken,
  ): Promise<LocationResult[]> {
    const result = await this.request<Location[] | null>(
      "textDocument/references",
      {
        ...this.positionParams(uri, position),
        context: { includeDeclaration },
      },
      token,
    );
    return this.toLocations(result);
  }

  async hover(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const result = await this.request<Hover | null>(
      "textDocument/hover",
      this.positionParams(uri, position),
      token,
    );
    if (!result) {
      return undefined;
    }
    const content = result.contents;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item === "string" ? item : item.value))
        .join("\n");
    }
    return "value" in content ? content.value : undefined;
  }

  async symbolInfo(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<SymbolDetails | undefined> {
    const result = await this.request<SymbolDetails[] | null>(
      "textDocument/symbolInfo",
      this.positionParams(uri, position),
      token,
    );
    return result?.[0];
  }

  async prepareCallHierarchy(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<CallNode[]> {
    const items = await this.request<CallHierarchyItem[] | CallHierarchyItem | null>(
      "textDocument/prepareCallHierarchy",
      this.positionParams(uri, position),
      token,
    );
    const list = !items ? [] : Array.isArray(items) ? items : [items];
    return list.map((raw) => this.callNode(raw));
  }

  async incomingCalls(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyIncomingCall[]> {
    return (
      (await this.request<CallHierarchyIncomingCall[] | null>(
        "callHierarchy/incomingCalls",
        { item: node.raw },
        token,
      )) ?? []
    );
  }

  async outgoingCalls(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyOutgoingCall[]> {
    if (!this.manager.supportsOutgoingCalls) {
      const version =
        this.manager.clangdInstallation?.version ?? "unknown clangd version";
      throw new UnsupportedClangdFeatureError(
        `Callees requires clangd 20 or newer; selected ${version}.`,
      );
    }
    return (
      (await this.request<CallHierarchyOutgoingCall[] | null>(
        "callHierarchy/outgoingCalls",
        { item: node.raw },
        token,
      )) ?? []
    );
  }

  async documentSymbols(uri: vscode.Uri): Promise<LspSymbol[]> {
    return (
      (await this.request<Array<DocumentSymbol | SymbolInformation> | null>(
        "textDocument/documentSymbol",
        { textDocument: { uri: uri.toString() } },
      )) ?? []
    );
  }

  async documentHighlights(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<DocumentHighlight[]> {
    return (
      (await this.request<DocumentHighlight[] | null>(
        "textDocument/documentHighlight",
        this.positionParams(uri, position),
        token,
      )) ?? []
    );
  }

  async workspaceSymbols(query: string): Promise<SymbolInformation[]> {
    return (
      (await this.request<SymbolInformation[] | null>("workspace/symbol", {
        query,
      })) ?? []
    );
  }

  async prepareTypeHierarchy(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<TypeHierarchyItem[]> {
    return (
      (await this.request<TypeHierarchyItem[] | null>(
        "textDocument/prepareTypeHierarchy",
        this.positionParams(uri, position),
        token,
      )) ?? []
    );
  }

  async typeSupertypes(
    item: TypeHierarchyItem,
    token?: vscode.CancellationToken,
  ): Promise<TypeHierarchyItem[]> {
    return (
      (await this.request<TypeHierarchyItem[] | null>(
        "typeHierarchy/supertypes",
        { item },
        token,
      )) ?? []
    );
  }

  async typeSubtypes(
    item: TypeHierarchyItem,
    token?: vscode.CancellationToken,
  ): Promise<TypeHierarchyItem[]> {
    return (
      (await this.request<TypeHierarchyItem[] | null>(
        "typeHierarchy/subtypes",
        { item },
        token,
      )) ?? []
    );
  }

  callNode(raw: CallHierarchyItem): CallNode {
    return {
      key: callHierarchyKey(raw),
      raw,
    };
  }

  toVsLocation(location: Location): LocationResult {
    return {
      uri: vscode.Uri.parse(location.uri),
      range: this.toVsRange(location.range),
    };
  }

  toVsRange(range: Range): vscode.Range {
    return new vscode.Range(
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character,
    );
  }

  private async request<T>(
    method: string,
    params: unknown,
    token?: vscode.CancellationToken,
  ): Promise<T> {
    const client = this.manager.languageClient ?? (await this.manager.start());
    if (token) {
      return this.measure(
        method,
        client.sendRequest<T>(method, params, token),
        token,
      );
    }
    const key = `${method}:${JSON.stringify(params)}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const request = this.measure(method, client.sendRequest<T>(method, params));
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key);
      }
    }
  }

  private async measure<T>(
    method: string,
    request: Promise<T>,
    token?: vscode.CancellationToken,
  ): Promise<T> {
    const started = performance.now();
    try {
      return await request;
    } finally {
      const elapsed = performance.now() - started;
      if (elapsed >= 1_000 && !token?.isCancellationRequested) {
        this.output?.appendLine(
          `Slow clangd request: ${method} ${Math.round(elapsed)} ms`,
        );
      }
    }
  }

  private positionParams(
    uri: vscode.Uri,
    position: vscode.Position,
  ): PositionParams {
    return {
      textDocument: { uri: uri.toString() },
      position: { line: position.line, character: position.character },
    };
  }

  private toLocations(
    result: Location | Location[] | LocationLink[] | null,
  ): LocationResult[] {
    if (!result) {
      return [];
    }
    const list = Array.isArray(result) ? result : [result];
    return list.map((item) => {
      if ("targetUri" in item) {
        return {
          uri: vscode.Uri.parse(item.targetUri),
          range: this.toVsRange(item.targetSelectionRange),
        };
      }
      return this.toVsLocation(item);
    });
  }
}

export class UnsupportedClangdFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedClangdFeatureError";
  }
}
