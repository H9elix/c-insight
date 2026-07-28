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
  private built = false;
  private building?: Promise<void>;
  private truncated = false;

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
      return;
    }
    this.removeSource(uri);
    await this.indexSource(uri, source);
  }

  remove(uri: vscode.Uri): void {
    if (this.built) {
      this.removeSource(uri);
    }
  }

  invalidate(): void {
    this.built = false;
    this.building = undefined;
    this.truncated = false;
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
    this.building ??= this.build(token, onProgress);
    try {
      await this.building;
    } finally {
      this.building = undefined;
    }
  }

  private async build(
    token?: vscode.CancellationToken,
    onProgress?: ReverseIndexProgress,
  ): Promise<void> {
    this.byTarget.clear();
    this.bySource.clear();
    this.truncated = false;
    const maximum = vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<number>("workspaceFileLimit", 20_000);
    const discovered = await vscode.workspace.findFiles(
      "**/*.{c,h,cc,hh,cpp,hpp,cxx,hxx,m,mm}",
      "**/{.git,node_modules,.vscode-test,build,Build,out}/**",
      maximum + 1,
    );
    this.truncated = discovered.length > maximum;
    const files = discovered.slice(0, maximum);
    let completed = 0;
    onProgress?.(completed, files.length);
    await mapLimit(files, 12, async (uri) => {
      if (token?.isCancellationRequested) {
        return;
      }
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        await this.indexSource(uri, Buffer.from(content).toString("utf8"));
      } catch {
        // Files can disappear while the workspace index is being built.
      } finally {
        completed += 1;
        onProgress?.(completed, files.length);
      }
    });
    this.built = !token?.isCancellationRequested;
  }

  private async indexSource(uri: vscode.Uri, source: string): Promise<void> {
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
      const targetEdges = this.byTarget.get(resolved.uri.toString()) ?? [];
      targetEdges.push(edge);
      this.byTarget.set(resolved.uri.toString(), targetEdges);
    }
    this.bySource.set(uri.toString(), edges);
  }

  private removeSource(uri: vscode.Uri): void {
    const key = uri.toString();
    for (const edge of this.bySource.get(key) ?? []) {
      const targetKey = edge.target.toString();
      const remaining = (this.byTarget.get(targetKey) ?? []).filter(
        (candidate) => candidate.source.toString() !== key,
      );
      if (remaining.length > 0) {
        this.byTarget.set(targetKey, remaining);
      } else {
        this.byTarget.delete(targetKey);
      }
    }
    this.bySource.delete(key);
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
