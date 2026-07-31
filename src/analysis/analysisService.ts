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
  SignatureHelp,
  SymbolInformation,
  TypeHierarchyItem,
} from "vscode-languageclient/node";
import { ClangdManager } from "../clangd/clangdManager";
import { CallNode, LocationResult, LspSymbol } from "../models/types";
import { callHierarchyKey } from "../utils/callHierarchy";
import {
  RequestPriority,
  RequestScheduler,
  RequestSchedulerStats,
} from "./requestScheduler";

export interface RequestTimingStats {
  measured: number;
  totalDurationMs: number;
  maximumDurationMs: number;
  slow: number;
  lastSlowMethod?: string;
  lastSlowDurationMs?: number;
}

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
  private readonly scheduler = new RequestScheduler();
  private readonly tokenIds = new WeakMap<vscode.CancellationToken, number>();
  private nextTokenId = 1;
  private readonly timing: RequestTimingStats = {
    measured: 0,
    totalDurationMs: 0,
    maximumDurationMs: 0,
    slow: 0,
  };

  constructor(
    private readonly manager: ClangdManager,
    private readonly output?: vscode.OutputChannel,
  ) {}

  requestSchedulerStats(): RequestSchedulerStats {
    return this.scheduler.stats();
  }

  requestTimingStats(): RequestTimingStats {
    return { ...this.timing };
  }

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

  async activeParameterLabel(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const result = await this.request<SignatureHelp | null>(
      "textDocument/signatureHelp",
      this.positionParams(uri, position),
      token,
    );
    if (!result || result.signatures.length === 0) {
      return undefined;
    }
    const signature =
      result.signatures[result.activeSignature ?? 0] ?? result.signatures[0];
    const parameterIndex =
      result.activeParameter ?? signature.activeParameter ?? 0;
    const parameter = signature.parameters?.[parameterIndex];
    if (!parameter) {
      return undefined;
    }
    if (typeof parameter.label === "string") {
      return parameter.label;
    }
    return signature.label.slice(parameter.label[0], parameter.label[1]);
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
    const configuration = vscode.workspace.getConfiguration(
      "cInsight.analysis",
    );
    this.scheduler.setLimits(
      configuration.get<number>("maximumConcurrentRequests", 8),
      configuration.get<number>("maximumBackgroundRequests", 2),
    );
    const tokenKey = token ? `:token-${this.tokenId(token)}` : "";
    const key = `${method}:${JSON.stringify(params)}${tokenKey}`;
    return this.scheduler.schedule(
      key,
      requestPriority(method),
      async () => {
        const client =
          this.manager.languageClient ?? (await this.manager.start());
        return this.measure(
          method,
          token
            ? client.sendRequest<T>(method, params, token)
            : client.sendRequest<T>(method, params),
          token,
        );
      },
      token,
    );
  }

  private tokenId(token: vscode.CancellationToken): number {
    const existing = this.tokenIds.get(token);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.nextTokenId++;
    this.tokenIds.set(token, id);
    return id;
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
      this.timing.measured += 1;
      this.timing.totalDurationMs += elapsed;
      this.timing.maximumDurationMs = Math.max(
        this.timing.maximumDurationMs,
        elapsed,
      );
      if (elapsed >= 1_000 && !token?.isCancellationRequested) {
        this.timing.slow += 1;
        this.timing.lastSlowMethod = method;
        this.timing.lastSlowDurationMs = elapsed;
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

function requestPriority(method: string): RequestPriority {
  if (
    method === "textDocument/definition" ||
    method === "textDocument/declaration" ||
    method === "textDocument/hover" ||
    method === "textDocument/signatureHelp" ||
    method === "textDocument/symbolInfo" ||
    method === "textDocument/prepareCallHierarchy" ||
    method === "textDocument/prepareTypeHierarchy"
  ) {
    return "interactive";
  }
  if (
    method === "textDocument/documentHighlight" ||
    method === "textDocument/documentSymbol"
  ) {
    return "background";
  }
  return "normal";
}

export class UnsupportedClangdFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedClangdFeatureError";
  }
}
