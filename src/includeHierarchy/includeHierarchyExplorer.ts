import * as path from "node:path";
import * as vscode from "vscode";
import { IncludeDirective, parseIncludes } from "./includeModel";
import {
  IncludeResolver,
  IncludeTargetKind,
  ResolvedInclude,
} from "./includeResolver";
import {
  ReverseIncludeEdge,
  ReverseIncludeIndex,
} from "./reverseIncludeIndex";
import { MutableTreeProvider, TreeNode } from "../views/treeNode";
import {
  hierarchyExpansionMessage,
  hierarchyExpansionStopReason,
} from "../utils/hierarchyExpansion";
import { HierarchyTreeState } from "../utils/hierarchyTreeState";
import {
  HierarchyExportNode,
  hierarchyNodeStates,
  renderHierarchyExport,
} from "../utils/hierarchyExport";

export type IncludeHierarchyDirection = "includes" | "includedBy";

export class IncludeHierarchyExplorer implements vscode.Disposable {
  readonly includes = new MutableTreeProvider();
  readonly includedBy = new MutableTreeProvider();
  private readonly resolver = new IncludeResolver();
  private readonly reverse = new ReverseIncludeIndex(this.resolver);
  private readonly views = new Map<
    IncludeHierarchyDirection,
    vscode.TreeView<TreeNode>
  >();
  private readonly treeState = {
    includes: new HierarchyTreeState(),
    includedBy: new HierarchyTreeState(),
  };
  private readonly disposables: vscode.Disposable[] = [];
  private readonly cancellation: Partial<
    Record<IncludeHierarchyDirection, vscode.CancellationTokenSource>
  > = {};
  private readonly roots: Partial<
    Record<IncludeHierarchyDirection, vscode.Uri>
  > = {};
  private readonly stale = { includes: false, includedBy: false };
  private reportedTruncatedIndex = false;

  constructor() {
    this.publishEmpty();
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{c,h,cc,hh,cpp,hpp,cxx,hxx,m,mm}",
    );
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => void this.updateFile(uri)),
      watcher.onDidChange((uri) => void this.updateFile(uri)),
      watcher.onDidDelete((uri) => {
        this.reverse.remove(uri);
        this.markStale();
      }),
    );
  }

  attachTreeView(
    direction: IncludeHierarchyDirection,
    view: vscode.TreeView<TreeNode>,
  ): void {
    this.views.set(direction, view);
  }

  async show(
    direction: IncludeHierarchyDirection,
    uri: vscode.Uri,
  ): Promise<void> {
    this.stopExpansion(direction);
    this.roots[direction] = uri;
    this.treeState[direction].reset();
    this.stale[direction] = false;
    this.provider(direction).setRoots([
      this.fileNode(uri, direction, [], 0, undefined),
    ]);
    await vscode.commands.executeCommand(
      direction === "includes"
        ? "cInsight.includes.focus"
        : "cInsight.includedBy.focus",
    );
    if (this.defaultDepth > 0) {
      void this.expand(direction, this.defaultDepth);
    }
  }

  async search(direction: IncludeHierarchyDirection): Promise<void> {
    const nodes = flatten(this.dataRoots(direction));
    const picked = await vscode.window.showQuickPick(
      nodes.map((node) => ({
        label: node.label,
        description: node.description,
        detail: node.includeFileUri
          ? vscode.workspace.asRelativePath(node.includeFileUri)
          : undefined,
        node,
      })),
      {
        title: `Search Loaded ${directionLabel(direction)}`,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (picked) {
      await this.views.get(direction)?.reveal(picked.node, {
        focus: true,
        select: true,
        expand: true,
      });
    }
  }

  async promptExpand(direction: IncludeHierarchyDirection): Promise<void> {
    const maximum = this.maximumDepth;
    const value = await vscode.window.showInputBox({
      title: `Expand ${directionLabel(direction)} to Depth`,
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

  stopExpansion(direction?: IncludeHierarchyDirection): void {
    const directions = direction
      ? [direction]
      : (["includes", "includedBy"] as const);
    for (const current of directions) {
      this.cancellation[current]?.cancel();
      this.cancellation[current]?.dispose();
      delete this.cancellation[current];
    }
  }

  handleDocumentChange(document: vscode.TextDocument): void {
    if (!isIncludeFile(document.uri)) {
      return;
    }
    void this.reverse.update(document.uri, document.getText());
    this.markStale();
  }

  invalidate(): void {
    this.stopExpansion();
    this.resolver.invalidate();
    this.reverse.invalidate();
    this.reportedTruncatedIndex = false;
    this.markStale();
  }

  async export(
    direction: IncludeHierarchyDirection,
    format: "text" | "json" | "mermaid",
  ): Promise<void> {
    const roots = this.dataRoots(direction);
    if (roots.length === 0) {
      return;
    }
    const target = await vscode.window.showSaveDialog({
      title: `Export ${directionLabel(direction)} as ${format.toUpperCase()}`,
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
    const content = renderHierarchyExport(
      roots.map(includeExportNode),
      {
        relation: "include",
        direction,
        edgeDirection:
          direction === "includes" ? "parent-to-child" : "child-to-parent",
      },
      format,
    );
    const rendered =
      format === "mermaid" && target.path.toLowerCase().endsWith(".md")
        ? `\`\`\`mermaid\n${content}\n\`\`\`\n`
        : content;
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(rendered),
    );
  }

  dispose(): void {
    this.stopExpansion();
    this.disposables.forEach((item) => item.dispose());
    this.includes.dispose();
    this.includedBy.dispose();
  }

  private fileNode(
    uri: vscode.Uri,
    direction: IncludeHierarchyDirection,
    ancestors: string[],
    depth: number,
    relation: ResolvedInclude | ReverseIncludeEdge | undefined,
    relationSource?: vscode.Uri,
  ): TreeNode {
    const key = uri.toString();
    const recursive = ancestors.includes(key);
    const { duplicate } = this.treeState[direction].record(key, recursive);
    const directive = relation?.directive;
    const source =
      relation && "source" in relation
        ? relation.source
        : relationSource ?? this.roots[direction] ?? uri;
    const previewLocation = directive
      ? directiveLocation(directive)
      : new vscode.Range(0, 0, 0, 0);
    const locationUri = directive ? source : uri;
    const kind = relation?.kind;
    const atDepthLimit = depth >= this.maximumDepth;
    return {
      id: `include:${direction}:${ancestors.join(">")}:${key}`,
      label: path.basename(uri.fsPath),
      description: [
        kindLabel(kind),
        duplicate ? "duplicate" : undefined,
        recursive ? "cycle" : undefined,
        atDepthLimit ? "max depth" : undefined,
      ].filter(Boolean).join(" · "),
      tooltip:
        `${uri.fsPath}` +
        (directive ? `\n${source.fsPath}:${directive.line + 1}\n${directive.text}` : ""),
      icon: new vscode.ThemeIcon(kindIcon(kind)),
      location: { uri: locationUri, range: previewLocation },
      includeFileUri: uri,
      previewMode: "reference",
      previewTitle: directive?.text ?? path.basename(uri.fsPath),
      contextValue: "includeHierarchyLocation",
      collapsibleState:
        recursive || duplicate || atDepthLimit
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed,
      loadChildren:
        recursive || duplicate || atDepthLimit
          ? undefined
          : () =>
              direction === "includes"
                ? this.forwardChildren(uri, [...ancestors, key], depth + 1)
                : this.reverseChildren(uri, [...ancestors, key], depth + 1),
    };
  }

  private async forwardChildren(
    uri: vscode.Uri,
    ancestors: string[],
    depth: number,
  ): Promise<TreeNode[]> {
    if (this.treeState.includes.atLimit(this.maximumNodes)) {
      return [limitNode()];
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const resolved = await Promise.all(
        parseIncludes(document.getText()).map((directive) =>
          this.resolver.resolve(uri, directive),
        ),
      );
      return resolved
        .filter(
          (include) =>
            this.includeSystemHeaders || include.kind !== "system",
        )
        .map((include) =>
          include.uri
            ? this.fileNode(
                include.uri,
                "includes",
                ancestors,
                depth,
                include,
                uri,
              )
            : unresolvedNode(uri, include),
        );
    } catch (error) {
      return [errorNode(error)];
    }
  }

  private async reverseChildren(
    uri: vscode.Uri,
    ancestors: string[],
    depth: number,
  ): Promise<TreeNode[]> {
    if (this.treeState.includedBy.atLimit(this.maximumNodes)) {
      return [limitNode()];
    }
    try {
      const incoming = this.reverse.isBuilt
        ? await this.reverse.incoming(uri)
        : await this.buildReverseIndex(uri);
      if (
        this.reverse.isBuilt &&
        this.reverse.wasTruncated &&
        !this.reportedTruncatedIndex
      ) {
        this.reportedTruncatedIndex = true;
        void vscode.window.showWarningMessage(
          `C Insight: Included By scanned the configured limit of ${this.workspaceFileLimit} files. Results may be incomplete.`,
        );
      }
      return incoming.map((edge) =>
        this.fileNode(
          edge.source,
          "includedBy",
          ancestors,
          depth,
          edge,
          edge.source,
        ),
      );
    } catch (error) {
      return [errorNode(error)];
    }
  }

  private async buildReverseIndex(
    uri: vscode.Uri,
  ): Promise<ReverseIncludeEdge[]> {
    const expansionToken = this.cancellation.includedBy?.token;
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "C Insight: Building Included By index",
        cancellable: true,
      },
      async (progress, progressToken) => {
        const linked = new vscode.CancellationTokenSource();
        const subscriptions = [
          expansionToken?.onCancellationRequested(() => linked.cancel()),
          progressToken.onCancellationRequested(() => linked.cancel()),
        ].filter((item): item is vscode.Disposable => item !== undefined);
        let percentage = 0;
        try {
          return await this.reverse.incoming(
            uri,
            linked.token,
            (completed, total) => {
              const next =
                total === 0 ? 100 : Math.floor((completed / total) * 100);
              progress.report({
                increment: Math.max(0, next - percentage),
                message: `${completed}/${total} files`,
              });
              percentage = next;
            },
          );
        } finally {
          subscriptions.forEach((item) => item.dispose());
          linked.dispose();
        }
      },
    );
  }

  private async expand(
    direction: IncludeHierarchyDirection,
    depth: number,
    announce = false,
  ): Promise<void> {
    this.stopExpansion(direction);
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation[direction] = cancellation;
    const visit = async (nodes: TreeNode[], current: number): Promise<void> => {
      if (
        current >= depth ||
        cancellation.token.isCancellationRequested ||
        this.treeState[direction].atLimit(this.maximumNodes)
      ) {
        return;
      }
      for (const node of nodes) {
        if (node.loadChildren && !node.children) {
          node.children = await node.loadChildren();
          node.loadChildren = undefined;
          node.children.forEach((child) => {
            child.parent = node;
          });
          this.provider(direction).refresh(node);
        }
        if (node.children) {
          await visit(node.children, current + 1);
        }
      }
    };
    try {
      await visit(this.dataRoots(direction), 0);
      if (announce) {
        this.publishExpansionStatus(direction, depth, false);
      }
    } finally {
      if (announce && cancellation.token.isCancellationRequested) {
        this.publishExpansionStatus(direction, depth, true);
      }
      if (this.cancellation[direction] === cancellation) {
        delete this.cancellation[direction];
      }
      cancellation.dispose();
    }
  }

  private publishExpansionStatus(
    direction: IncludeHierarchyDirection,
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

  private markStale(direction?: IncludeHierarchyDirection): void {
    const directions = direction
      ? [direction]
      : (["includes", "includedBy"] as const);
    for (const current of directions) {
      if (!this.roots[current] || this.stale[current]) {
        continue;
      }
      this.stale[current] = true;
      this.provider(current).setRoots([
        {
          label: "Include hierarchy is stale",
          description: `run Show ${directionLabel(current)} again`,
          icon: new vscode.ThemeIcon("history"),
        },
        ...this.provider(current).getRoots(),
      ]);
    }
  }

  private async updateFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      await this.reverse.update(uri, Buffer.from(content).toString("utf8"));
    } finally {
      this.markStale();
    }
  }

  private publishEmpty(): void {
    this.includes.setRoots([
      commandNode(
        "Show Includes for the active C/C++ file",
        "cInsight.includeHierarchy.showIncludes",
      ),
    ]);
    this.includedBy.setRoots([
      commandNode(
        "Show Included By for the active C/C++ file",
        "cInsight.includeHierarchy.showIncludedBy",
      ),
    ]);
  }

  private provider(direction: IncludeHierarchyDirection): MutableTreeProvider {
    return direction === "includes" ? this.includes : this.includedBy;
  }

  private dataRoots(direction: IncludeHierarchyDirection): TreeNode[] {
    return this.provider(direction).getRoots().filter((node) => node.includeFileUri);
  }

  private get defaultDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<number>("defaultDepth", 0);
  }

  private get maximumDepth(): number {
    return vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<number>("maximumDepth", 10);
  }

  private get maximumNodes(): number {
    return vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<number>("maximumNodes", 5_000);
  }

  private get includeSystemHeaders(): boolean {
    return vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<boolean>("includeSystemHeaders", false);
  }

  private get workspaceFileLimit(): number {
    return vscode.workspace
      .getConfiguration("cInsight.includeHierarchy")
      .get<number>("workspaceFileLimit", 20_000);
  }
}

function directiveLocation(directive: IncludeDirective): vscode.Range {
  return new vscode.Range(
    directive.line,
    0,
    directive.line,
    directive.text.length,
  );
}

function unresolvedNode(source: vscode.Uri, include: ResolvedInclude): TreeNode {
  return {
    label: include.directive.target,
    description: "unresolved",
    tooltip: include.reason,
    icon: new vscode.ThemeIcon("warning"),
    location: {
      uri: source,
      range: directiveLocation(include.directive),
    },
    previewMode: "reference",
    previewTitle: include.directive.text,
    contextValue: "unresolvedIncludeLocation",
  };
}

function flatten(roots: TreeNode[]): TreeNode[] {
  return roots.flatMap((root) => [
    root,
    ...(root.children ? flatten(root.children) : []),
  ]);
}

function isIncludeFile(uri: vscode.Uri): boolean {
  return /\.(?:c|h|cc|hh|cpp|hpp|cxx|hxx|m|mm)$/i.test(uri.fsPath);
}

function directionLabel(direction: IncludeHierarchyDirection): string {
  return direction === "includes" ? "Includes" : "Included By";
}

function kindLabel(kind: IncludeTargetKind | undefined): string | undefined {
  switch (kind) {
    case "workspace-header":
      return "workspace header";
    case "workspace-source":
      return "workspace source";
    case "system":
      return "system";
    case "external":
      return "external";
    case "unresolved":
      return "unresolved";
    case undefined:
      return undefined;
  }
}

function kindIcon(kind: IncludeTargetKind | undefined): string {
  return kind === "system"
    ? "library"
    : kind === "external"
      ? "globe"
      : "file-code";
}

function commandNode(label: string, command: string): TreeNode {
  return {
    label,
    icon: new vscode.ThemeIcon("play"),
    command: { command, title: label },
  };
}

function limitNode(): TreeNode {
  return {
    label: "Include hierarchy node limit reached",
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

function errorNode(error: unknown): TreeNode {
  return {
    label: `Include hierarchy failed: ${String(error)}`,
    icon: new vscode.ThemeIcon("error"),
  };
}

function includeExportNode(node: TreeNode): HierarchyExportNode {
  return {
    name: node.label,
    uri: node.includeFileUri?.toString(),
    sourceUri: node.location?.uri.toString(),
    line: node.location ? node.location.range.start.line + 1 : undefined,
    description: node.description,
    states: hierarchyNodeStates(node.label, node.description),
    children: node.children?.map(includeExportNode) ?? [],
  };
}
