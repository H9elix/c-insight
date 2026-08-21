import * as vscode from "vscode";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { CallNode, LocationResult } from "../models/types";
import { LruPromiseCache } from "../utils/lruPromiseCache";
import { callHierarchyKey } from "../utils/callHierarchy";
import {
  enclosingCaller,
  MicrosoftCallerEvidence,
} from "./microsoftCallerFallbackModel";
import {
  MicrosoftCalleeEvidence,
  MicrosoftCalleeEvidenceStats,
  summarizeMicrosoftCalleeEvidence,
} from "./microsoftCalleeEvidenceModel";

export type CallDirection = "incoming" | "outgoing";

export interface MicrosoftCallerEvidenceStats {
  queriedNodes: number;
  references: number;
  mappedReferences: number;
  unmappedReferences: number;
  callerFunctions: number;
}

export interface CallSymbolLocations {
  definitions: LocationResult[];
  declarations: LocationResult[];
}

export class CallHierarchyRepository {
  private readonly microsoftIncomingEvidence = new Map<string, MicrosoftCallerEvidence>();
  private readonly microsoftOutgoingEvidence = new Map<string, MicrosoftCalleeEvidence>();
  private readonly incomingCache: LruPromiseCache<
    CallHierarchyIncomingCall[]
  >;
  private readonly outgoingCache: LruPromiseCache<
    CallHierarchyOutgoingCall[]
  >;
  private readonly symbolLocationCache: LruPromiseCache<CallSymbolLocations>;

  constructor(private readonly analysis: AnalysisService) {
    const size = configuredCacheSize();
    this.incomingCache = new LruPromiseCache(size);
    this.outgoingCache = new LruPromiseCache(size);
    this.symbolLocationCache = new LruPromiseCache(size);
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
      this.analysis.analysisEngine === "microsoft"
        ? this.observedMicrosoftOutgoing(node, token)
        : this.analysis.outgoingCalls(node, token),
    );
  }

  symbolLocations(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallSymbolLocations> {
    return this.symbolLocationCache.getOrCreate(node.key, async () => {
      const uri = vscode.Uri.parse(node.raw.uri);
      const position = new vscode.Position(
        node.raw.selectionRange.start.line,
        node.raw.selectionRange.start.character,
      );
      const [definitions, declarations] = await Promise.all([
        this.analysis.definition(uri, position, token),
        this.analysis.declaration(uri, position, token),
      ]);
      return { definitions, declarations };
    });
  }

  stats(direction: CallDirection): { hits: number; misses: number } {
    const cache =
      direction === "incoming" ? this.incomingCache : this.outgoingCache;
    return { hits: cache.hits, misses: cache.misses };
  }

  incomingMode(): "references" | "native" | "disabled" {
    return this.microsoftIncomingMode();
  }

  incomingEvidence(node: CallNode): MicrosoftCallerEvidence | undefined {
    return this.microsoftIncomingEvidence.get(node.key);
  }

  microsoftCallerEvidenceStats(): MicrosoftCallerEvidenceStats {
    const result: MicrosoftCallerEvidenceStats = {
      queriedNodes: this.microsoftIncomingEvidence.size,
      references: 0,
      mappedReferences: 0,
      unmappedReferences: 0,
      callerFunctions: 0,
    };
    for (const evidence of this.microsoftIncomingEvidence.values()) {
      result.references += evidence.references;
      result.mappedReferences += evidence.mappedReferences;
      result.unmappedReferences += evidence.unmappedReferences;
      result.callerFunctions += evidence.callerFunctions;
    }
    return result;
  }

  microsoftCalleeEvidenceStats(): MicrosoftCalleeEvidenceStats {
    return summarizeMicrosoftCalleeEvidence(this.microsoftOutgoingEvidence.values());
  }

  invalidate(): void {
    const size = configuredCacheSize();
    this.incomingCache.resize(size);
    this.outgoingCache.resize(size);
    this.symbolLocationCache.resize(size);
    this.incomingCache.clear();
    this.outgoingCache.clear();
    this.symbolLocationCache.clear();
    this.microsoftIncomingEvidence.clear();
    this.microsoftOutgoingEvidence.clear();
  }

  private microsoftIncomingMode(): "references" | "native" | "disabled" {
    if (this.analysis.analysisEngine !== "microsoft") return "native";
    return vscode.workspace
      .getConfiguration("cInsight.microsoft")
      .get<"references" | "native" | "disabled">("callersMode", "references");
  }

  private async observedMicrosoftOutgoing(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyOutgoingCall[]> {
    const started = performance.now();
    try {
      const calls = await this.analysis.outgoingCalls(node, token);
      this.microsoftOutgoingEvidence.set(node.key, {
        outcome: "completed",
        calls: calls.length,
        durationMs: performance.now() - started,
      });
      return calls;
    } catch (error) {
      this.microsoftOutgoingEvidence.set(node.key, {
        outcome:
          token?.isCancellationRequested || error instanceof vscode.CancellationError
            ? "cancelled"
            : "failed",
        calls: 0,
        durationMs: performance.now() - started,
      });
      throw error;
    }
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
    let unmappedReferences = 0;
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
      if (!item) {
        unmappedReferences += 1;
        continue;
      }
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
    this.microsoftIncomingEvidence.set(node.key, {
      references: references.length,
      mappedReferences: references.length - unmappedReferences,
      unmappedReferences,
      callerFunctions: callers.size,
    });
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
