import * as vscode from "vscode";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
} from "vscode-languageclient/node";
import { SymbolKind } from "vscode-languageclient/node";
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
import {
  locationKey,
  memberAccessOperator,
  MemberCallerOccurrenceScope,
  MemberCallerScope,
  memberCallerScopeKey,
  parseDirectMemberAccess,
} from "./memberCallerScopeModel";

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

export interface ScopedIncomingCalls {
  anchorName?: string;
  sameVariable: CallHierarchyIncomingCall[];
  unresolvedVariable: CallHierarchyIncomingCall[];
  excludedOtherVariableOccurrences: number;
}

export interface IncomingCallResult {
  calls: CallHierarchyIncomingCall[];
  memberScope?: ScopedIncomingCalls;
}

export class CallHierarchyRepository {
  private readonly microsoftIncomingEvidence = new Map<string, MicrosoftCallerEvidence>();
  private readonly microsoftOutgoingEvidence = new Map<string, MicrosoftCalleeEvidence>();
  private readonly incomingCache: LruPromiseCache<
    IncomingCallResult
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
    return this.prepareWithMemberScope(uri, position, token);
  }

  async incoming(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<CallHierarchyIncomingCall[]> {
    return (await this.incomingResult(node, token)).calls;
  }

  incomingResult(
    node: CallNode,
    token?: vscode.CancellationToken,
  ): Promise<IncomingCallResult> {
    const requestKey = this.incomingRequestKey(node);
    return this.incomingCache.getOrCreate(requestKey, async () => {
      const incomingMode = this.microsoftIncomingMode();
      const calls = await (
        incomingMode === "disabled"
          ? Promise.reject(new Error(
              "Microsoft Callers are disabled by cInsight.microsoft.callersMode.",
            ))
          : incomingMode === "references" ||
              (this.analysis.analysisEngine === "microsoft" &&
                node.syntheticMemberRoot)
          ? this.referenceBasedIncoming(node, token)
          : this.analysis.incomingCalls(node, token)
      );
      if (!node.memberCallerScope) {
        return { calls };
      }
      const memberScope = await this.classifyMemberIncomingCalls(
        calls,
        node.memberCallerScope,
        token,
      );
      const result = {
        calls: [
          ...memberScope.sameVariable,
          ...memberScope.unresolvedVariable,
        ],
        memberScope,
      };
      if (
        this.analysis.analysisEngine === "microsoft" &&
        calls.length === 0
      ) {
        // cpptools can publish an empty field-reference result while its
        // browse database is still becoming ready. Do not make that transient
        // observation sticky for the lifetime of the hierarchy cache.
        this.incomingCache.delete(requestKey);
      }
      return result;
    });
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
    return this.microsoftIncomingEvidence.get(this.incomingRequestKey(node));
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

  private async prepareWithMemberScope(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<CallNode[]> {
    let roots = await this.analysis.prepareCallHierarchy(uri, position, token);
    if (token?.isCancellationRequested) return roots;
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return roots;
    }
    const wordRange = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*/,
    );
    if (!wordRange) {
      return roots;
    }
    const memberName = document.getText(wordRange);
    const source = document.getText();
    if (
      roots.length === 0 &&
      this.analysis.analysisEngine === "microsoft" &&
      memberAccessOperator(source, document.offsetAt(wordRange.start))
    ) {
      const definitions = await this.analysis.definition(uri, position, token);
      const definition = definitions[0];
      if (definition) {
        const range = toProtocolRange(definition.range);
        roots = [{
          ...this.analysis.callNode({
            name: memberName,
            kind: SymbolKind.Field,
            detail: vscode.l10n.t("References-based member"),
            uri: definition.uri.toString(),
            range,
            selectionRange: range,
          }),
          syntheticMemberRoot: true,
        }];
      }
    }
    const memberRoots = roots.filter(
      (root) =>
        root.raw.kind === SymbolKind.Field ||
        root.raw.kind === SymbolKind.Property,
    );
    if (memberRoots.length === 0 || token?.isCancellationRequested) {
      return roots;
    }
    const matching = memberRoots.filter(
      (root) => (root.raw.name.split("::").at(-1) ?? root.raw.name) === memberName,
    );
    if (matching.length === 0) {
      return roots;
    }
    const direct = parseDirectMemberAccess(
      source,
      document.offsetAt(wordRange.start),
    );
    const scope: MemberCallerScope = {
      queryUri: uri.toString(),
      queryPosition: toProtocolPosition(position),
      memberName,
      memberRange: toProtocolRange(wordRange),
      anchor: direct
        ? {
            name: direct.baseName,
            range: {
              start: toProtocolPosition(document.positionAt(direct.baseStart)),
              end: toProtocolPosition(document.positionAt(direct.baseEnd)),
            },
            operator: direct.operator,
          }
        : undefined,
    };
    const matchingKeys = new Set(matching.map((root) => root.key));
    return roots.map((root) =>
      matchingKeys.has(root.key) ? { ...root, memberCallerScope: scope } : root,
    );
  }

  private incomingRequestKey(node: CallNode): string {
    return node.memberCallerScope
      ? `${node.key}:member:${memberCallerScopeKey(node.memberCallerScope)}`
      : node.key;
  }

  private async classifyMemberIncomingCalls(
    calls: CallHierarchyIncomingCall[],
    scope: MemberCallerScope,
    token?: vscode.CancellationToken,
  ): Promise<ScopedIncomingCalls> {
    const documents = new Map<string, Promise<vscode.TextDocument>>();
    const documentFor = (uri: string): Promise<vscode.TextDocument> => {
      let request = documents.get(uri);
      if (!request) {
        request = Promise.resolve(
          vscode.workspace.openTextDocument(vscode.Uri.parse(uri)),
        );
        documents.set(uri, request);
      }
      return request;
    };
    const anchor = scope.anchor;
    const anchorReferenceKeys = new Set<string>();
    if (anchor) {
      anchorReferenceKeys.add(locationKey(scope.queryUri, anchor.range.start));
      try {
        const references = await this.analysis.references(
          vscode.Uri.parse(scope.queryUri),
          new vscode.Position(
            anchor.range.start.line,
            anchor.range.start.character,
          ),
          true,
          token,
        );
        for (const reference of references) {
          anchorReferenceKeys.add(
            locationKey(reference.uri.toString(), {
              line: reference.range.start.line,
              character: reference.range.start.character,
            }),
          );
        }
      } catch {
        // The query origin remains exact. Other same-name occurrences are
        // resolved by their definitions below or kept in the unresolved set.
      }
    }

    let anchorDefinitions: Promise<Set<string>> | undefined;
    const definitionCache = new Map<string, Promise<Set<string>>>();
    const definitionsAt = (
      uri: string,
      position: { line: number; character: number },
    ): Promise<Set<string>> => {
      const key = locationKey(uri, position);
      let request = definitionCache.get(key);
      if (!request) {
        request = this.analysis.definition(
          vscode.Uri.parse(uri),
          new vscode.Position(position.line, position.character),
          token,
        ).then(
          (locations) => new Set(locations.map((location) =>
            locationKey(location.uri.toString(), {
              line: location.range.start.line,
              character: location.range.start.character,
            })
          )),
          () => new Set<string>(),
        );
        definitionCache.set(key, request);
      }
      return request;
    };
    if (anchor) {
      anchorDefinitions = definitionsAt(scope.queryUri, anchor.range.start);
    }

    const sameVariable: CallHierarchyIncomingCall[] = [];
    const unresolvedVariable: CallHierarchyIncomingCall[] = [];
    let excludedOtherVariableOccurrences = 0;
    for (const call of calls) {
      const sameRanges: CallHierarchyIncomingCall["fromRanges"] = [];
      const unresolvedRanges: CallHierarchyIncomingCall["fromRanges"] = [];
      let document: vscode.TextDocument | undefined;
      try {
        document = await documentFor(call.from.uri);
      } catch {
        document = undefined;
      }
      for (const range of call.fromRanges) {
        if (token?.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        const occurrenceScope = document
          ? await this.classifyMemberOccurrence(
              document,
              range.start,
              anchor,
              anchorReferenceKeys,
              anchorDefinitions,
              definitionsAt,
            )
          : "unresolved-variable";
        if (occurrenceScope === "same-variable") {
          sameRanges.push(range);
        } else if (occurrenceScope === "unresolved-variable") {
          unresolvedRanges.push(range);
        } else {
          excludedOtherVariableOccurrences += 1;
        }
      }
      if (sameRanges.length > 0) {
        sameVariable.push({ ...call, fromRanges: sameRanges });
      }
      if (unresolvedRanges.length > 0) {
        unresolvedVariable.push({ ...call, fromRanges: unresolvedRanges });
      }
    }
    return {
      anchorName: anchor?.name,
      sameVariable,
      unresolvedVariable,
      excludedOtherVariableOccurrences,
    };
  }

  private async classifyMemberOccurrence(
    document: vscode.TextDocument,
    memberPosition: { line: number; character: number },
    anchor: MemberCallerScope["anchor"],
    anchorReferenceKeys: Set<string>,
    anchorDefinitions: Promise<Set<string>> | undefined,
    definitionsAt: (
      uri: string,
      position: { line: number; character: number },
    ) => Promise<Set<string>>,
  ): Promise<MemberCallerOccurrenceScope | "other-variable"> {
    if (!anchor) {
      return "unresolved-variable";
    }
    const direct = parseDirectMemberAccess(
      document.getText(),
      document.offsetAt(
        new vscode.Position(memberPosition.line, memberPosition.character),
      ),
    );
    if (!direct) {
      return "unresolved-variable";
    }
    if (direct.baseName !== anchor.name) {
      return "other-variable";
    }
    const basePosition = document.positionAt(direct.baseStart);
    const uri = document.uri.toString();
    if (
      anchorReferenceKeys.has(
        locationKey(uri, {
          line: basePosition.line,
          character: basePosition.character,
        }),
      )
    ) {
      return "same-variable";
    }
    const [selected, candidate] = await Promise.all([
      anchorDefinitions ?? Promise.resolve(new Set<string>()),
      definitionsAt(uri, {
        line: basePosition.line,
        character: basePosition.character,
      }),
    ]);
    if ([...candidate].some((key) => selected.has(key))) {
      return "same-variable";
    }
    return selected.size > 0 && candidate.size > 0
      ? "other-variable"
      : "unresolved-variable";
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
    const targetUri = vscode.Uri.parse(
      node.memberCallerScope?.queryUri ?? node.raw.uri,
    );
    const targetPosition = node.memberCallerScope
      ? new vscode.Position(
          node.memberCallerScope.queryPosition.line,
          node.memberCallerScope.queryPosition.character,
        )
      : new vscode.Position(
          node.raw.selectionRange.start.line,
          node.raw.selectionRange.start.character,
        );
    const references = await this.analysis.references(
      targetUri,
      targetPosition,
      Boolean(node.memberCallerScope),
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
    this.microsoftIncomingEvidence.set(this.incomingRequestKey(node), {
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

function toProtocolPosition(position: vscode.Position): {
  line: number;
  character: number;
} {
  return { line: position.line, character: position.character };
}

function toProtocolRange(range: vscode.Range): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: toProtocolPosition(range.start),
    end: toProtocolPosition(range.end),
  };
}
