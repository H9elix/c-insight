import * as vscode from "vscode";
import { parseIncludes } from "./includeModel";
import { IncludeResolver, ResolvedInclude } from "./includeResolver";
import {
  ReverseIncludeEdge,
  ReverseIncludeIndex,
  ReverseIndexProgress,
} from "./reverseIncludeIndex";

export type IncludeHierarchyDirection = "includes" | "includedBy";

export class IncludeHierarchyRepository {
  private readonly resolver = new IncludeResolver();
  private readonly reverse = new ReverseIncludeIndex(this.resolver);
  private readonly forwardCache = new Map<
    string,
    Promise<ResolvedInclude[]>
  >();

  forward(uri: vscode.Uri): Promise<ResolvedInclude[]> {
    const key = uri.toString();
    let request = this.forwardCache.get(key);
    if (!request) {
      request = this.loadForward(uri);
      request.catch(() => {
        if (this.forwardCache.get(key) === request) {
          this.forwardCache.delete(key);
        }
      });
      this.forwardCache.set(key, request);
    }
    return request;
  }

  incoming(
    uri: vscode.Uri,
    token?: vscode.CancellationToken,
    progress?: ReverseIndexProgress,
  ): Promise<ReverseIncludeEdge[]> {
    return this.reverse.incoming(uri, token, progress);
  }

  get isReverseBuilt(): boolean {
    return this.reverse.isBuilt;
  }

  get wasReverseTruncated(): boolean {
    return this.reverse.wasTruncated;
  }

  async update(uri: vscode.Uri, source: string): Promise<void> {
    this.forwardCache.delete(uri.toString());
    await this.reverse.update(uri, source);
  }

  remove(uri: vscode.Uri): void {
    this.forwardCache.delete(uri.toString());
    this.reverse.remove(uri);
  }

  invalidate(): void {
    this.forwardCache.clear();
    this.resolver.invalidate();
    this.reverse.invalidate();
  }

  private async loadForward(uri: vscode.Uri): Promise<ResolvedInclude[]> {
    const document = await vscode.workspace.openTextDocument(uri);
    return Promise.all(
      parseIncludes(document.getText()).map((directive) =>
        this.resolver.resolve(uri, directive),
      ),
    );
  }
}
