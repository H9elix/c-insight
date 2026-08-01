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
import {
  AnalysisEngine,
  configuredAnalysisEngine,
} from "./analysisEngine";
import { MicrosoftSemanticProvider } from "./microsoftSemanticProvider";
import { runtimeDiagnostics } from "../diagnostics/runtimeDiagnostics";

export interface RequestTimingStats {
  measured: number;
  totalDurationMs: number;
  maximumDurationMs: number;
  slow: number;
  lastSlowMethod?: string;
  lastSlowDurationMs?: number;
  failed: number;
  cancelled: number;
  providerActivationDurationMs: number;
  last?: RequestTimingEntry;
  byMethod: Record<string, RequestMethodTiming>;
}

export interface RequestTimingEntry {
  method: string;
  engine: AnalysisEngine;
  outcome: "completed" | "failed" | "cancelled";
  durationMs: number;
  providerActivationDurationMs?: number;
  completedAt: string;
}

export interface RequestMethodTiming {
  measured: number;
  completed: number;
  failed: number;
  cancelled: number;
  averageDurationMs: number;
  maximumDurationMs: number;
}

interface MutableMethodTiming extends Omit<RequestMethodTiming, "averageDurationMs"> {
  totalDurationMs: number;
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
  private readonly microsoft = new MicrosoftSemanticProvider();
  private readonly scheduler = new RequestScheduler();
  private readonly tokenIds = new WeakMap<vscode.CancellationToken, number>();
  private nextTokenId = 1;
  private readonly timing: RequestTimingStats = {
    measured: 0,
    totalDurationMs: 0,
    maximumDurationMs: 0,
    slow: 0,
    failed: 0,
    cancelled: 0,
    providerActivationDurationMs: 0,
    byMethod: {},
  };
  private readonly methodTiming = new Map<string, MutableMethodTiming>();

  constructor(
    private readonly manager: ClangdManager,
    private readonly output?: vscode.OutputChannel,
    private readonly engine: AnalysisEngine = configuredAnalysisEngine(),
  ) {}

  requestSchedulerStats(): RequestSchedulerStats {
    return this.scheduler.stats();
  }

  requestTimingStats(): RequestTimingStats {
    return {
      ...this.timing,
      last: this.timing.last ? { ...this.timing.last } : undefined,
      byMethod: Object.fromEntries(
        [...this.methodTiming].map(([method, value]) => [method, {
          measured: value.measured,
          completed: value.completed,
          failed: value.failed,
          cancelled: value.cancelled,
          averageDurationMs:
            value.measured === 0 ? 0 : value.totalDurationMs / value.measured,
          maximumDurationMs: value.maximumDurationMs,
        }]),
      ),
    };
  }

  get analysisEngine(): AnalysisEngine {
    return this.engine;
  }

  async definition(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<LocationResult[]> {
    if (this.engine === "microsoft") {
      return this.observedMicrosoftLocations("definition", token, () =>
        this.microsoftRequest(`definition:${uri}:${position.line}:${position.character}`, token, () =>
          this.microsoft.definition(uri, position),
        ),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.observedMicrosoftLocations("declaration", token, () =>
        this.microsoftRequest(`declaration:${uri}:${position.line}:${position.character}`, token, () =>
          this.microsoft.declaration(uri, position),
        ),
      );
    }
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
    if (this.engine === "microsoft") {
      const locations = await this.observedMicrosoftLocations("references", token, () =>
        this.microsoftRequest(`references:${uri}:${position.line}:${position.character}`, token, () =>
          this.microsoft.references(uri, position),
        ),
      );
      if (includeDeclaration) return locations;
      try {
        const declarations = await this.declaration(uri, position, token);
        const definitions = await this.definition(uri, position, token);
        const excluded = new Set(
          [...declarations, ...definitions].map(
            (item) => `${item.uri}:${item.range.start.line}:${item.range.start.character}`,
          ),
        );
        const filtered = locations.filter(
          (item) =>
            !excluded.has(
              `${item.uri}:${item.range.start.line}:${item.range.start.character}`,
            ),
        );
        runtimeDiagnostics.increment("microsoft.navigation.references.postProcessing.completed");
        runtimeDiagnostics.increment("microsoft.navigation.references.postProcessing.outputLocations", filtered.length);
        return filtered;
      } catch (error) {
        runtimeDiagnostics.increment("microsoft.navigation.references.postProcessing.failed");
        throw error;
      }
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`hover:${uri}:${position.line}:${position.character}`, token, () =>
        this.microsoft.hover(uri, position),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`signatureHelp:${uri}:${position.line}:${position.character}`, token, () =>
        this.microsoft.activeParameterLabel(uri, position),
      );
    }
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
    if (this.engine === "microsoft") {
      return undefined;
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`prepareCallHierarchy:${uri}:${position.line}:${position.character}`, token, () =>
        this.microsoft.prepareCallHierarchy(uri, position),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`incomingCalls:${node.key}`, token, () =>
        this.microsoft.incomingCalls(node),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`outgoingCalls:${node.key}`, token, () =>
        this.microsoft.outgoingCalls(node),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`documentSymbols:${uri}`, undefined, () =>
        this.microsoft.documentSymbols(uri),
      );
    }
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
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`documentHighlights:${uri}:${position.line}:${position.character}`, token, () =>
        this.microsoft.documentHighlights(uri, position),
      );
    }
    return (
      (await this.request<DocumentHighlight[] | null>(
        "textDocument/documentHighlight",
        this.positionParams(uri, position),
        token,
      )) ?? []
    );
  }

  async workspaceSymbols(query: string): Promise<SymbolInformation[]> {
    if (this.engine === "microsoft") {
      return this.microsoftRequest(`workspaceSymbols:${query}`, undefined, () =>
        this.microsoft.workspaceSymbols(query),
      );
    }
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
    if (this.engine === "microsoft") {
      throw new UnsupportedEngineFeatureError(
        "Type Hierarchy is not available through the public Microsoft C/C++ Provider API.",
      );
    }
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
    if (this.engine === "microsoft") {
      throw new UnsupportedEngineFeatureError(
        "Type Hierarchy is not available through the public Microsoft C/C++ Provider API.",
      );
    }
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
    if (this.engine === "microsoft") {
      throw new UnsupportedEngineFeatureError(
        "Type Hierarchy is not available through the public Microsoft C/C++ Provider API.",
      );
    }
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
        return this.measure(method, () => token
          ? client.sendRequest<T>(method, params, token)
          : client.sendRequest<T>(method, params), token);
      },
      token,
    );
  }

  private async microsoftRequest<T>(
    method: string,
    token: vscode.CancellationToken | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const configuration = vscode.workspace.getConfiguration("cInsight.analysis");
    this.scheduler.setLimits(
      configuration.get<number>("maximumConcurrentRequests", 8),
      configuration.get<number>("maximumBackgroundRequests", 2),
    );
    const operation = method.split(":", 1)[0];
    const tokenKey = token ? `:token-${this.tokenId(token)}` : "";
    return this.scheduler.schedule(
      `microsoft:${method}${tokenKey}`,
      requestPriority(`textDocument/${operation}`),
      async () => {
        if (token?.isCancellationRequested) throw new vscode.CancellationError();
        const activationStarted = performance.now();
        await this.microsoft.activate();
        const activationDurationMs = performance.now() - activationStarted;
        const result = await this.measure(
          `microsoft/${operation}`,
          action,
          token,
          activationDurationMs,
        );
        if (token?.isCancellationRequested) throw new vscode.CancellationError();
        return result;
      },
      token,
    );
  }

  private async observedMicrosoftLocations(
    operation: "definition" | "declaration" | "references",
    token: vscode.CancellationToken | undefined,
    request: () => Promise<LocationResult[]>,
  ): Promise<LocationResult[]> {
    const prefix = `microsoft.navigation.${operation}`;
    runtimeDiagnostics.increment(`${prefix}.queries`);
    try {
      const locations = await request();
      if (locations.length === 0) {
        runtimeDiagnostics.increment(`${prefix}.empty`);
      } else {
        runtimeDiagnostics.increment(`${prefix}.locations`, locations.length);
      }
      return locations;
    } catch (error) {
      runtimeDiagnostics.increment(
        `${prefix}.${token?.isCancellationRequested || isCancellationError(error) ? "cancelled" : "failed"}`,
      );
      throw error;
    }
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
    request: () => Promise<T>,
    token?: vscode.CancellationToken,
    providerActivationDurationMs = 0,
  ): Promise<T> {
    const started = performance.now();
    let outcome: RequestTimingEntry["outcome"] = "completed";
    try {
      return await request();
    } catch (error) {
      outcome = token?.isCancellationRequested || isCancellationError(error)
        ? "cancelled"
        : "failed";
      throw error;
    } finally {
      const elapsed = performance.now() - started;
      this.timing.measured += 1;
      this.timing.totalDurationMs += elapsed;
      this.timing.maximumDurationMs = Math.max(
        this.timing.maximumDurationMs,
        elapsed,
      );
      this.timing.providerActivationDurationMs += providerActivationDurationMs;
      if (outcome === "failed") this.timing.failed += 1;
      if (outcome === "cancelled") this.timing.cancelled += 1;
      const methodTiming = this.methodTiming.get(method) ?? {
        measured: 0, completed: 0, failed: 0, cancelled: 0,
        totalDurationMs: 0, maximumDurationMs: 0,
      };
      methodTiming.measured += 1;
      methodTiming[outcome] += 1;
      methodTiming.totalDurationMs += elapsed;
      methodTiming.maximumDurationMs = Math.max(methodTiming.maximumDurationMs, elapsed);
      this.methodTiming.set(method, methodTiming);
      this.timing.last = {
        method,
        engine: this.engine,
        outcome,
        durationMs: elapsed,
        providerActivationDurationMs:
          providerActivationDurationMs > 0 ? providerActivationDurationMs : undefined,
        completedAt: new Date().toISOString(),
      };
      const slowThresholdMs = vscode.workspace
        .getConfiguration("cInsight.analysis")
        .get<number>("slowRequestThreshold", 1_000);
      if (elapsed >= slowThresholdMs && outcome !== "cancelled") {
        this.timing.slow += 1;
        this.timing.lastSlowMethod = method;
        this.timing.lastSlowDurationMs = elapsed;
        this.output?.appendLine(
          `Slow ${this.engine === "microsoft" ? "Microsoft Provider" : "clangd"} request: ${method} ${Math.round(elapsed)} ms`,
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

function isCancellationError(error: unknown): boolean {
  return error instanceof vscode.CancellationError ||
    (error instanceof Error && /cancel(?:led|ed)/i.test(error.message));
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

export class UnsupportedEngineFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedEngineFeatureError";
  }
}
