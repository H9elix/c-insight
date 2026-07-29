import * as vscode from "vscode";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { CallNode } from "../models/types";
import { LruPromiseCache } from "../utils/lruPromiseCache";

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
      this.analysis.incomingCalls(node, token),
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

  invalidate(): void {
    const size = configuredCacheSize();
    this.incomingCache.resize(size);
    this.outgoingCache.resize(size);
    this.incomingCache.clear();
    this.outgoingCache.clear();
  }
}

function configuredCacheSize(): number {
  return vscode.workspace
    .getConfiguration("cInsight.callHierarchy")
    .get<number>("cacheSize", 500);
}
