import * as vscode from "vscode";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { CallNode } from "../models/types";
import { LruPromiseCache } from "../utils/lruPromiseCache";
import { callHierarchyKey } from "../utils/callHierarchy";
import { enclosingCaller } from "./microsoftCallerFallbackModel";

export type CallDirection = "incoming" | "outgoing";

export class CallHierarchyRepository {
  private readonly incomingCache: LruPromiseCache<
    CallHierarchyIncomingCall[]
  >;
  private readonly outgoingCache: LruPromiseCache<
    CallHierarchyOutgoingCall[]
  >;

  constructor(private readonly analysis: AnalysisService) {
    const size = configuredCacheSize();
    this.incomingCache = new LruPromiseCache(size);
    this.outgoingCache = new LruPromiseCache(size);
  }

  prepare(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<CallNode[]> {
    return this.analysis.prepareCallHierarchy(uri, position, token);
  }

  incoming(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyIncomingCall[]> {
    return this.incomingCache.getOrCreate(node.key, () =>
      this.microsoftIncomingMode() === "references"
        ? this.referenceBasedIncoming(node, token)
        : this.microsoftIncomingMode() === "disabled"
          ? Promise.reject(new Error(
              "Microsoft Callers are disabled by cInsight.microsoft.callersMode.",
            ))
          : this.analysis.incomingCalls(node, token),
    );
  }

  outgoing(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyOutgoingCall[]> {
    return this.outgoingCache.getOrCreate(node.key, () =>
      this.analysis.outgoingCalls(node, token),
    );
  }

  stats(direction: CallDirection): { hits: number; misses: number } {
    const cache =
      direction === "incoming" ? this.incomingCache : this.outgoingCache;
    return { hits: cache.hits, misses: cache.misses };
  }

  incomingMode(): "references" | "native" | "disabled" {
    return this.microsoftIncomingMode();
  }

  invalidate(): void {
    const size = configuredCacheSize();
    this.incomingCache.resize(size);
    this.outgoingCache.resize(size);
    this.incomingCache.clear();
    this.outgoingCache.clear();
  }

  private microsoftIncomingMode(): "references" | "native" | "disabled" {
    if (this.analysis.analysisEngine !== "microsoft") return "native";
    return vscode.workspace
      .getConfiguration("cInsight.microsoft")
      .get<"references" | "native" | "disabled">("callersMode", "references");
  }

  private async referenceBasedIncoming(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyIncomingCall[]> {
    const targetUri = vscode.Uri.parse(node.raw.uri);
    const targetPosition = new vscode.Position(
      node.raw.selectionRange.start.line,
      node.raw.selectionRange.start.character,
    );
    const references = await this.analysis.references(
      targetUri,
      targetPosition,
      false,
      token,
    );
    const symbolsByUri = new Map<string, Awaited<ReturnType<AnalysisService["documentSymbols"]>>>();
    const callers = new Map<string, { item: CallHierarchyItem; ranges: CallHierarchyIncomingCall["fromRanges"] }>();
    const maximumNodes = vscode.workspace
      .getConfiguration("cInsight.callHierarchy")
      .get<number>("maximumNodes", 2_000);
    for (const reference of references) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const uri = reference.uri.toString();
      let symbols = symbolsByUri.get(uri);
      if (!symbols) {
        symbols = await this.analysis.documentSymbols(reference.uri);
        symbolsByUri.set(uri, symbols);
      }
      const item = enclosingCaller(
        uri,
        {
          line: reference.range.start.line,
          character: reference.range.start.character,
        },
        symbols,
      );
      if (!item) continue;
      const key = callHierarchyKey(item);
      const existing = callers.get(key);
      const range = {
        start: {
          line: reference.range.start.line,
          character: reference.range.start.character,
        },
        end: {
          line: reference.range.end.line,
          character: reference.range.end.character,
        },
      };
      if (existing) {
        existing.ranges.push(range);
      } else if (callers.size < maximumNodes) {
        callers.set(key, { item, ranges: [range] });
      }
    }
    return [...callers.values()].map(({ item, ranges }) => ({
      from: item,
      fromRanges: ranges,
    }));
  }
}

function configuredCacheSize(): number {
  return vscode.workspace
    .getConfiguration("cInsight.callHierarchy")
    .get<number>("cacheSize", 500);
}
