import * as vscode from "vscode";
import type { TypeHierarchyItem } from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import { typeHierarchyKey } from "../utils/typeHierarchy";

export type TypeHierarchyDirection = "supertypes" | "subtypes";

export class TypeHierarchyRepository {
  private readonly caches = {
    supertypes: new Map<string, Promise<TypeHierarchyItem[]>>(),
    subtypes: new Map<string, Promise<TypeHierarchyItem[]>>(),
  };
  private dirty = false;

  constructor(private readonly analysis: AnalysisService) {}

  prepare(
    uri: vscode.Uri,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<TypeHierarchyItem[]> {
    this.ensureFresh();
    return this.analysis.prepareTypeHierarchy(uri, position, token);
  }

  related(
    item: TypeHierarchyItem,
    direction: TypeHierarchyDirection,
    token?: vscode.CancellationToken,
  ): Promise<TypeHierarchyItem[]> {
    this.ensureFresh();
    const key = typeHierarchyKey(item);
    let request = this.caches[direction].get(key);
    if (!request) {
      request =
        direction === "supertypes"
          ? this.analysis.typeSupertypes(item, token)
          : this.analysis.typeSubtypes(item, token);
      request.catch(() => {
        if (this.caches[direction].get(key) === request) {
          this.caches[direction].delete(key);
        }
      });
      this.caches[direction].set(key, request);
    }
    return request;
  }

  invalidate(): void {
    this.dirty = false;
    this.clearCaches();
  }

  markDirty(): void {
    this.dirty = true;
  }

  private ensureFresh(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    this.clearCaches();
  }

  private clearCaches(): void {
    this.caches.supertypes.clear();
    this.caches.subtypes.clear();
  }
}
