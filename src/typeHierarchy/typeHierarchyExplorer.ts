import * as vscode from "vscode";
import {
  SymbolKind,
  TypeHierarchyItem,
} from "vscode-languageclient/node";
import { AnalysisService } from "../analysis/analysisService";
import {
  hierarchyExpansionMessage,
  hierarchyExpansionStopReason,
} from "../utils/hierarchyExpansion";
import { HierarchyTreeState } from "../utils/hierarchyTreeState";
import {
  isTypeHierarchyRecursion,
  typeHierarchyKey,
  typeHierarchyMermaidEdge,
} from "../utils/typeHierarchy";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";

export type TypeHierarchyDirection = "supertypes" | "subtypes";

export class TypeHierarchyExplorer implements vscode.Disposable {
  readonly supertypes = new MutableTreeProvider();
  readonly subtypes = new MutableTreeProvider();
  private readonly views = new Map<
    TypeHierarchyDirection,
    vscode.TreeView<TreeNode>
  >();
  private readonly caches = {
    supertypes: new Map<string, Promise<TypeHierarchyItem[]>>(),
    subtypes: new Map<string, Promise<TypeHierarchyItem[]>>(),
  };
  private readonly treeState = {
    supertypes: new HierarchyTreeState(),
    subtypes: new HierarchyTreeState(),
  };
  private cancellation?: vscode.CancellationTokenSource;
  private rootName?: string;
  private stale = false;

  constructor(private readonly analysis: AnalysisService) {
    this.publishEmpty();
  }

  attachTreeView(
    direction: TypeHierarchyDirection,
    view: vscode.TreeView<TreeNode>,
  ): void {
    this.views.set(direction, view);
  }

  async show(
    direction: TypeHierarchyDirection,
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<void> {
    this.stopExpansion();
    this.provider(direction).setRoots([
      {
        label: "Querying type hierarchy…",
        icon: new vscode.ThemeIcon("loading~spin"),
      },
    ]);
    try {
      const roots = await this.analysis.prepareTypeHierarchy(uri, position);
      if (roots.length === 0) {
        this.provider(direction).setRoots([
          {
            label: "No type hierarchy is available at the cursor",
            icon: new vscode.ThemeIcon("info"),
          },
        ]);
        return;
      }
      this.setRoots(roots);
      await vscode.commands.executeCommand(
        direction === "supertypes"
          ? "cInsight.supertypes.focus"
          : "cInsight.subtypes.focus",
      );
    } catch (error) {
      this.provider(direction).setRoots([
        {
          label: `Type hierarchy query failed: ${String(error)}`,
          icon: new vscode.ThemeIcon("error"),
        },
      ]);
    }
  }

  async search(direction: TypeHierarchyDirection): Promise<void> {
    const nodes = flatten(this.provider(direction).getRoots()).filter(
      (node) => node.location,
    );
    if (nodes.length === 0) {
      void vscode.window.showInformationMessage(
        "C Insight: No loaded type hierarchy nodes to search.",
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(
      nodes.map((node) => ({
        label: node.label,
        description: node.description,
        detail: node.location
          ? `${vscode.workspace.asRelativePath(node.location.uri)}:${node.location.range.start.line + 1}`
          : undefined,
        node,
      })),
      {
        title: `Search Loaded ${label(direction)}`,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (selected) {
      await this.views.get(direction)?.reveal(selected.node, {
        focus: true,
        select: true,
        expand: true,
      });
    }
  }

  async promptExpand(direction: TypeHierarchyDirection): Promise<void> {
    const maximum = this.maximumDepth;
    const value = await vscode.window.showInputBox({
      title: `Expand ${label(direction)} to Depth`,
      value: String(Math.max(1, this.defaultDepth)),
      validateInput: (input) => {
        const depth = Number(input);
        return Number.isInteger(depth) && depth >= 1 && depth <= maximum
          ? undefined
          : `Enter an integer from 1 to ${maximum}`;
      },
    });
    if (value !== undefined) {
      await this.expand(direction, Number(value), true);
    }
  }

  stopExpansion(): void {
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.cancellation = undefined;
  }

  async export(
    direction: TypeHierarchyDirection,
    format: "text" | "json" | "mermaid",
  ): Promise<void> {
    const roots = this.dataRoots(direction);
    if (roots.length === 0) {
      void vscode.window.showInformationMessage(
        `C Insight: No loaded ${label(direction).toLowerCase()} to export.`,
      );
      return;
    }
    const target = await vscode.window.showSaveDialog({
      title: `Export ${label(direction)} as ${format.toUpperCase()}`,
      filters:
        format === "json"
          ? { JSON: ["json"] }
          : format === "mermaid"
            ? { Mermaid: ["mmd"], Markdown: ["md"] }
            : { Text: ["txt"] },
    });
    if (!target) {
      return;
    }
    const content =
      format === "json"
        ? JSON.stringify(roots.map(treeJson), undefined, 2)
        : format === "mermaid"
          ? mermaid(roots, direction)
          : roots.map((root) => treeText(root)).join("\n");
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(
        format === "mermaid" && target.path.toLowerCase().endsWith(".md")
          ? `\`\`\`mermaid\n${content}\n\`\`\`\n`
          : content,
      ),
    );
  }

  invalidate(): void {
    this.stopExpansion();
    this.caches.supertypes.clear();
    this.caches.subtypes.clear();
    this.treeState.supertypes.clearSeen();
    this.treeState.subtypes.clearSeen();
    if (this.rootName) {
      this.markStale();
    }
  }

  dispose(): void {
    this.stopExpansion();
    this.supertypes.dispose();
    this.subtypes.dispose();
  }

  private setRoots(items: TypeHierarchyItem[]): void {
    this.caches.supertypes.clear();
    this.caches.subtypes.clear();
    this.stale = false;
    this.rootName = items[0]?.name;
    for (const direction of ["supertypes", "subtypes"] as const) {
      this.treeState[direction].reset();
      this.provider(direction).setRoots(
        items.map((item) => this.node(item, direction, [], 0)),
      );
    }
    if (this.defaultDepth > 0) {
      void this.expand("supertypes", this.defaultDepth).then(() =>
        this.expand("subtypes", this.defaultDepth),
      );
    }
  }

  private node(
    item: TypeHierarchyItem,
    direction: TypeHierarchyDirection,
    ancestors: string[],
    depth: number,
  ): TreeNode {
    const key = typeHierarchyKey(item);
    const recursive = isTypeHierarchyRecursion(item, ancestors);
    const { duplicate } = this.treeState[direction].record(key, recursive);
    const uri = vscode.Uri.parse(item.uri);
    const range = this.analysis.toVsRange(item.selectionRange);
    const atDepthLimit = depth >= this.maximumDepth;
    const detail = duplicate
      ? `duplicate · ${item.detail ?? vscode.workspace.asRelativePath(uri)}`
      : item.detail ??
        `${vscode.workspace.asRelativePath(uri)}:${range.start.line + 1}`;
    return {
      id: `type:${direction}:${ancestors.join(">")}:${key}`,
      label: item.name,
      description: atDepthLimit ? `${detail} · max depth` : detail,
      tooltip: `${item.detail ?? typeKindLabel(item.kind)}\n${uri.fsPath}:${range.start.line + 1}`,
      icon: new vscode.ThemeIcon(typeIcon(item.kind)),
      location: { uri, range },
      previewMode: "definition",
      previewTitle: item.name,
      contextValue: "typeHierarchyLocation",
      collapsibleState:
        recursive || duplicate || atDepthLimit
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed,
      loadChildren:
        recursive || duplicate || atDepthLimit
          ? undefined
          : async () => {
              if (this.treeState[direction].atLimit(this.maximumNodes)) {
                return [limitNode()];
              }
              const children = await this.children(item, direction);
              return children.length === 0
                ? [emptyNode(direction)]
                : children
                    .slice(
                      0,
                      this.treeState[direction].remaining(this.maximumNodes),
                    )
                    .map((child) =>
                      this.node(child, direction, [...ancestors, key], depth + 1),
                    );
            },
    };
  }

  private children(
    item: TypeHierarchyItem,
    direction: TypeHierarchyDirection,
  ): Promise<TypeHierarchyItem[]> {
    const key = typeHierarchyKey(item);
    let request = this.caches[direction].get(key);
    if (!request) {
      request =
        direction === "supertypes"
          ? this.analysis.typeSupertypes(item, this.cancellation?.token)
          : this.analysis.typeSubtypes(item, this.cancellation?.token);
      request.catch(() => {
        if (this.caches[direction].get(key) === request) {
          this.caches[direction].delete(key);
        }
      });
      this.caches[direction].set(key, request);
    }
    return request;
  }

  private async expand(
    direction: TypeHierarchyDirection,
    depth: number,
    announce = false,
  ): Promise<void> {
    this.stopExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    try {
      const visit = async (nodes: TreeNode[], current: number): Promise<void> => {
        if (
          current >= depth ||
          cancellation.token.isCancellationRequested ||
          this.treeState[direction].atLimit(this.maximumNodes)
        ) {
          return;
        }
        for (const node of nodes) {
          if (cancellation.token.isCancellationRequested) {
            return;
          }
          if (node.loadChildren && !node.children) {
            node.children = await node.loadChildren();
            for (const child of node.children) {
              child.parent = node;
            }
            node.loadChildren = undefined;
            this.provider(direction).refresh(node);
          }
          if (node.children) {
            await visit(node.children, current + 1);
          }
        }
      };
      await visit(this.dataRoots(direction), 0);
      if (announce) {
        this.publishExpansionStatus(direction, depth, false);
      }
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        throw error;
      }
      if (announce) {
        this.publishExpansionStatus(direction, depth, true);
      }
    } finally {
      if (this.cancellation === cancellation) {
        this.cancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private publishExpansionStatus(
    direction: TypeHierarchyDirection,
    requestedDepth: number,
    cancelled: boolean,
  ): void {
    const reason = hierarchyExpansionStopReason({
      cancelled,
      loadedNodes: this.treeState[direction].loadedNodes,
      maximumNodes: this.maximumNodes,
      requestedDepth,
      maximumDepth: this.maximumDepth,
    });
    if (!reason) {
      return;
    }
    const message = hierarchyExpansionMessage(
      reason,
      this.maximumDepth,
      this.maximumNodes,
    );
    const provider = this.provider(direction);
    provider.setRoots([
      statusNode(message.label, message.description),
      ...provider
        .getRoots()
        .filter((node) => node.contextValue !== "hierarchyExpansionStatus"),
    ]);
  }

  private markStale(): void {
    if (this.stale) {
      return;
    }
    this.stale = true;
    for (const direction of ["supertypes", "subtypes"] as const) {
      this.provider(direction).setRoots([
        {
          label: `Type hierarchy for ${this.rootName ?? "type"} is stale`,
          description: "run Show Type Hierarchy again",
          icon: new vscode.ThemeIcon("history"),
        },
        ...this.provider(direction).getRoots(),
      ]);
    }
  }

  private publishEmpty(): void {
    for (const direction of ["supertypes", "subtypes"] as const) {
      this.provider(direction).setRoots([
        {
          label: `Place the cursor on a C++ type and show ${label(direction)}`,
          icon: new vscode.ThemeIcon("info"),
        },
      ]);
    }
  }

  private provider(direction: TypeHierarchyDirection): MutableTreeProvider {
    return direction === "supertypes" ? this.supertypes : this.subtypes;
  }

  private dataRoots(direction: TypeHierarchyDirection): TreeNode[] {
    return this.provider(direction)
      .getRoots()
      .filter((node) => node.location);
  }

  private get defaultDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.typeHierarchy")
      .get<number>("defaultDepth", 0);
  }

  private get maximumDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.typeHierarchy")
      .get<number>("maximumDepth", 10);
  }

  private get maximumNodes(): number {
    return vscode.workspace
      .getConfiguration("cInsight.typeHierarchy")
      .get<number>("maximumNodes", 2_000);
  }
}

function flatten(roots: TreeNode[]): TreeNode[] {
  return roots.flatMap((root) => [
    root,
    ...(root.children ? flatten(root.children) : []),
  ]);
}

function label(direction: TypeHierarchyDirection): string {
  return direction === "supertypes" ? "Supertypes" : "Subtypes";
}

function typeKindLabel(kind: number): string {
  if (kind === SymbolKind.Class) {
    return "Class";
  }
  if (kind === SymbolKind.Struct) {
    return "Struct";
  }
  if (kind === SymbolKind.Interface) {
    return "Interface";
  }
  return "Type";
}

function typeIcon(kind: number): string {
  if (kind === SymbolKind.Struct) {
    return "symbol-struct";
  }
  if (kind === SymbolKind.Interface) {
    return "symbol-interface";
  }
  return "symbol-class";
}

function emptyNode(direction: TypeHierarchyDirection): TreeNode {
  return {
    label: direction === "supertypes" ? "No supertypes" : "No subtypes",
    icon: new vscode.ThemeIcon("circle-outline"),
  };
}

function limitNode(): TreeNode {
  return {
    label: "Type hierarchy node limit reached",
    icon: new vscode.ThemeIcon("warning"),
  };
}

function statusNode(label: string, description: string): TreeNode {
  return {
    label,
    description,
    icon: new vscode.ThemeIcon("info"),
    contextValue: "hierarchyExpansionStatus",
  };
}

function treeText(node: TreeNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}${node.label}${
    node.location
      ? ` — ${vscode.workspace.asRelativePath(node.location.uri)}:${node.location.range.start.line + 1}`
      : ""
  }`;
  return node.children?.length
    ? `${line}\n${node.children.map((child) => treeText(child, depth + 1)).join("\n")}`
    : line;
}

function treeJson(node: TreeNode): unknown {
  return {
    name: node.label,
    detail: node.description,
    uri: node.location?.uri.toString(),
    line: node.location ? node.location.range.start.line + 1 : undefined,
    children: node.children?.map(treeJson) ?? [],
  };
}

function mermaid(
  roots: TreeNode[],
  direction: TypeHierarchyDirection,
): string {
  const nodes = flatten(roots).filter((node) => node.location);
  const ids = new Map<TreeNode, string>(
    nodes.map((node, index) => [node, `n${index}`]),
  );
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    lines.push(`  ${ids.get(node)}["${escapeLabel(node.label)}"]`);
    for (const child of node.children ?? []) {
      if (!ids.has(child)) {
        continue;
      }
      const supertype =
        direction === "supertypes" ? child : node;
      const subtype =
        direction === "supertypes" ? node : child;
      lines.push(
        `  ${typeHierarchyMermaidEdge(ids.get(supertype)!, ids.get(subtype)!)}`,
      );
    }
  }
  return lines.join("\n");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
