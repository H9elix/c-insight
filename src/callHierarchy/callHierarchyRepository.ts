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
  offsetAtPosition,
  parseMemberAccessChain,
  positionAtOffset,
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
  otherVariable: CallHierarchyIncomingCall[];
  unresolvedVariable: CallHierarchyIncomingCall[];
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
          ...memberScope.otherVariable,
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
    const chain = parseMemberAccessChain(
      source,
      document.offsetAt(wordRange.start),
    );
    const scope: MemberCallerScope = {
      queryUri: uri.toString(),
      queryPosition: toProtocolPosition(position),
      memberName,
      memberRange: toProtocolRange(wordRange),
      anchor: chain
        ? {
            name: chain.rootName,
            range: {
              start: toProtocolPosition(document.positionAt(chain.rootStart)),
              end: toProtocolPosition(document.positionAt(chain.rootEnd)),
            },
            operator: chain.segments[0].operator,
            path: chain.segments.map(({ name, operator }) => ({ name, operator })),
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
    const documents = new Map<string, Promise<string>>();
    const sourceFor = (uri: string): Promise<string> => {
      let request = documents.get(uri);
      if (!request) {
        request = this.readSourceText(uri);
        documents.set(uri, request);
      }
      return request;
    };
    const anchor = scope.anchor;
    if (!anchor) {
      return {
        sameVariable: [],
        otherVariable: [],
        unresolvedVariable: calls,
      };
    }
    const anchorReferenceKeys = new Set<string>();
    anchorReferenceKeys.add(locationKey(scope.queryUri, anchor.range.start));
    let referencesAvailable = false;
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
      referencesAvailable = references.length > 0;
      for (const reference of references) {
        anchorReferenceKeys.add(
          locationKey(reference.uri.toString(), {
            line: reference.range.start.line,
            character: reference.range.start.character,
          }),
        );
      }
    } catch {
      // A bounded Definition fallback below can still classify simple
      // same-name roots. All remaining calls stay visible as unresolved.
    }

    let anchorDefinitions: Promise<Set<string>> | undefined;
    let remainingDefinitionFallbacks = 16;
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
    const sameVariable: CallHierarchyIncomingCall[] = [];
    const otherVariable: CallHierarchyIncomingCall[] = [];
    const unresolvedVariable: CallHierarchyIncomingCall[] = [];
    for (const call of calls) {
      const sameRanges: CallHierarchyIncomingCall["fromRanges"] = [];
      const otherRanges: CallHierarchyIncomingCall["fromRanges"] = [];
      const unresolvedRanges: CallHierarchyIncomingCall["fromRanges"] = [];
      let source: string | undefined;
      try {
        source = await sourceFor(call.from.uri);
      } catch {
        source = undefined;
      }
      for (const range of call.fromRanges) {
        if (token?.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        const occurrenceScope = source
          ? await this.classifyMemberOccurrence(
              source,
              call.from.uri,
              range.start,
              anchor,
              anchorReferenceKeys,
              referencesAvailable,
              () => {
                anchorDefinitions ??= definitionsAt(
                  scope.queryUri,
                  anchor.range.start,
                );
                return anchorDefinitions;
              },
              definitionsAt,
              () => {
                if (remainingDefinitionFallbacks <= 0) return false;
                remainingDefinitionFallbacks -= 1;
                return true;
              },
            )
          : "unresolved-variable";
        if (occurrenceScope === "same-variable") {
          sameRanges.push(range);
        } else if (occurrenceScope === "other-variable") {
          otherRanges.push(range);
        } else if (occurrenceScope === "unresolved-variable") {
          unresolvedRanges.push(range);
        }
      }
      if (sameRanges.length > 0) {
        sameVariable.push({ ...call, fromRanges: sameRanges });
      }
      if (otherRanges.length > 0) {
        otherVariable.push({ ...call, fromRanges: otherRanges });
      }
      if (unresolvedRanges.length > 0) {
        unresolvedVariable.push({ ...call, fromRanges: unresolvedRanges });
      }
    }
    return {
      anchorName: anchor.name,
      sameVariable,
      otherVariable,
      unresolvedVariable,
    };
  }

  private async classifyMemberOccurrence(
    source: string,
    uri: string,
    memberPosition: { line: number; character: number },
    anchor: NonNullable<MemberCallerScope["anchor"]>,
    anchorReferenceKeys: Set<string>,
    referencesAvailable: boolean,
    anchorDefinitions: () => Promise<Set<string>>,
    definitionsAt: (
      uri: string,
      position: { line: number; character: number },
    ) => Promise<Set<string>>,
    takeDefinitionFallback: () => boolean,
  ): Promise<MemberCallerOccurrenceScope> {
    const chain = parseMemberAccessChain(
      source,
      offsetAtPosition(source, memberPosition),
    );
    if (!chain) {
      return "unresolved-variable";
    }
    const selectedPath = anchor.path ?? [{
      name: chain.segments.at(-1)?.name ?? "",
      operator: anchor.operator,
    }];
    if (!sameMemberPath(chain.segments, selectedPath)) {
      return "other-variable";
    }
    if (chain.rootName !== anchor.name) {
      return "other-variable";
    }
    const basePosition = positionAtOffset(source, chain.rootStart);
    const candidateKey = locationKey(uri, basePosition);
    if (anchorReferenceKeys.has(candidateKey)) {
      return "same-variable";
    }
    if (referencesAvailable) {
      return "other-variable";
    }
    if (!takeDefinitionFallback()) {
      return "unresolved-variable";
    }
    const [selected, candidate] = await Promise.all([
      anchorDefinitions(),
      definitionsAt(uri, basePosition),
    ]);
    if ([...candidate].some((key) => selected.has(key))) {
      return "same-variable";
    }
    return selected.size > 0 && candidate.size > 0
      ? "other-variable"
      : "unresolved-variable";
  }

  private async readSourceText(uri: string): Promise<string> {
    const parsed = vscode.Uri.parse(uri);
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === parsed.toString(),
    );
    if (open) {
      return open.getText();
    }
    const content = await vscode.workspace.fs.readFile(parsed);
    return Buffer.from(content).toString("utf8");
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

function sameMemberPath(
  left: Array<{ name: string; operator: "." | "->" }>,
  right: Array<{ name: string; operator: "." | "->" }>,
): boolean {
  return left.length === right.length && left.every(
    (segment, index) =>
      segment.name === right[index].name &&
      segment.operator === right[index].operator,
  );
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
