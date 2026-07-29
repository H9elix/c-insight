import * as vscode from "vscode";
import { IncludeDirective, parseIncludes } from "./includeModel";
import {
  IncludeResolver,
  IncludeTargetKind,
} from "./includeResolver";

export interface ReverseIncludeEdge {
  source: vscode.Uri;
  target: vscode.Uri;
  directive: IncludeDirective;
  kind: IncludeTargetKind;
}

export type ReverseIndexProgress = (
  completed: number,
  total: number,
) => void;

export class ReverseIncludeIndex {
  private readonly byTarget = new Map<string, ReverseIncludeEdge[]>();
  private readonly bySource = new Map<string, ReverseIncludeEdge[]>();
  private readonly pendingChanges = new Map<
    string,
    { uri: vscode.Uri; source?: string }
  >();
  private built = false;
  private building?: Promise<void>;
  private buildCancellation?: vscode.CancellationTokenSource;
  private truncated = false;
  private generation = 0;

  constructor(private readonly resolver: IncludeResolver) {}

  async incoming(
    target: vscode.Uri,
    token?: vscode.CancellationToken,
    onProgress?: ReverseIndexProgress,
  ): Promise<ReverseIncludeEdge[]> {
    await this.ensureBuilt(token, onProgress);
    if (token?.isCancellationRequested) {
      return [];
    }
    return this.byTarget.get(target.toString()) ?? [];
  }

  get isBuilt(): boolean {
    return this.built;
  }

  get wasTruncated(): boolean {
    return this.truncated;
  }

  async update(uri: vscode.Uri, source: string): Promise<void> {
    if (!this.built) {
      if (this.building) {
        this.pendingChanges.set(uri.toString(), { uri, source });
      }
      return;
    }
    this.removeSource(uri);
    await this.indexSource(uri, source);
  }

  remove(uri: vscode.Uri): void {
    if (this.built) {
      this.removeSource(uri);
    } else if (this.building) {
      this.pendingChanges.set(uri.toString(), { uri });
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.buildCancellation?.cancel();
    this.buildCancellation?.dispose();
    this.buildCancellation = undefined;
    this.built = false;
    this.building = undefined;
    this.truncated = false;
    this.pendingChanges.clear();
    this.byTarget.clear();
    this.bySource.clear();
  }

  private async ensureBuilt(
    token?: vscode.CancellationToken,
    onProgress?: ReverseIndexProgress,
  ): Promise<void> {
    if (this.built) {
      return;
    }
    const generation = this.generation;
    this.building ??= this.build(token, onProgress, generation);
    const building = this.building;
    try {
      await building;
    } finally {
      if (this.building === building) {
        this.building = undefined;
      }
    }
  }

  private async build(
    token?: vscode.CancellationToken,
    onProgress?: ReverseIndexProgress,
    generation = this.generation,
  ): Promise<void> {
    const cancellation = new vscode.CancellationTokenSource();
    this.buildCancellation = cancellation;
    const subscription = token?.onCancellationRequested(() =>
      cancellation.cancel(),
    );
    if (token?.isCancellationRequested) {
      cancellation.cancel();
    }
    try {
      const byTarget = new Map<string, ReverseIncludeEdge[]>();
      const bySource = new Map<string, ReverseIncludeEdge[]>();
      const maximum = vscode.workspace
        .getConfiguration("cInsight.includeHierarchy")
        .get<number>("workspaceFileLimit", 20_000);
      const discovered = await vscode.workspace.findFiles(
        "**/*.{c,h,cc,hh,cpp,hpp,cxx,hxx,m,mm}",
        "**/{.git,node_modules,.vscode-test,build,Build,out}/**",
        maximum + 1,
      );
      const truncated = discovered.length > maximum;
      const files = discovered.slice(0, maximum);
      let completed = 0;
      onProgress?.(completed, files.length);
      await mapLimit(files, 12, async (uri) => {
        if (cancellation.token.isCancellationRequested) {
          return;
        }
        try {
          const content = await vscode.workspace.fs.readFile(uri);
          await this.indexSource(
            uri,
            Buffer.from(content).toString("utf8"),
            byTarget,
            bySource,
          );
        } catch {
          // Files can disappear while the workspace index is being built.
        } finally {
          completed += 1;
          onProgress?.(completed, files.length);
        }
      });
      if (
        cancellation.token.isCancellationRequested ||
        generation !== this.generation
      ) {
        return;
      }
      while (this.pendingChanges.size > 0) {
        const changes = [...this.pendingChanges.values()];
        this.pendingChanges.clear();
        for (const change of changes) {
          this.removeSource(change.uri, byTarget, bySource);
          if (change.source !== undefined) {
            await this.indexSource(
              change.uri,
              change.source,
              byTarget,
              bySource,
            );
          }
        }
        if (
          cancellation.token.isCancellationRequested ||
          generation !== this.generation
        ) {
          return;
        }
      }
      this.byTarget.clear();
      this.bySource.clear();
      byTarget.forEach((edges, key) => this.byTarget.set(key, edges));
      bySource.forEach((edges, key) => this.bySource.set(key, edges));
      this.truncated = truncated;
      this.built = true;
    } finally {
      subscription?.dispose();
      if (this.buildCancellation === cancellation) {
        this.buildCancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private async indexSource(
    uri: vscode.Uri,
    source: string,
    byTarget = this.byTarget,
    bySource = this.bySource,
  ): Promise<void> {
    const edges: ReverseIncludeEdge[] = [];
    for (const directive of parseIncludes(source)) {
      const resolved = await this.resolver.resolve(uri, directive);
      if (!resolved.uri) {
        continue;
      }
      const edge: ReverseIncludeEdge = {
        source: uri,
        target: resolved.uri,
        directive,
        kind: resolved.kind,
      };
      edges.push(edge);
      const targetEdges = byTarget.get(resolved.uri.toString()) ?? [];
      targetEdges.push(edge);
      byTarget.set(resolved.uri.toString(), targetEdges);
    }
    bySource.set(uri.toString(), edges);
  }

  private removeSource(
    uri: vscode.Uri,
    byTarget = this.byTarget,
    bySource = this.bySource,
  ): void {
    const key = uri.toString();
    for (const edge of bySource.get(key) ?? []) {
      const targetKey = edge.target.toString();
      const remaining = (byTarget.get(targetKey) ?? []).filter(
        (candidate) => candidate.source.toString() !== key,
      );
      if (remaining.length > 0) {
        byTarget.set(targetKey, remaining);
      } else {
        byTarget.delete(targetKey);
      }
    }
    bySource.delete(key);
  }
}

async function mapLimit<T>(
  values: readonly T[],
  limit: number,
  callback: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (index < values.length) {
        const value = values[index++];
        await callback(value);
      }
    },
  );
  await Promise.all(workers);
}
