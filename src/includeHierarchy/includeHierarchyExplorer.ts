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
import { typeHierarchyMermaidEdge } from "../utils/typeHierarchy";

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
  private readonly seen = {
    includes: new Set<string>(),
    includedBy: new Set<string>(),
  };
  private readonly disposables: vscode.Disposable[] = [];
  private cancellation?: vscode.CancellationTokenSource;
  private root?: vscode.Uri;
  private loadedNodes = 0;
  private stale = false;

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
    this.stopExpansion();
    this.root = uri;
    this.loadedNodes = 0;
    this.stale = false;
    this.seen.includes.clear();
    this.seen.includedBy.clear();
    for (const current of ["includes", "includedBy"] as const) {
      this.provider(current).setRoots([
        this.fileNode(uri, current, [], 0, undefined),
      ]);
    }
    await vscode.commands.executeCommand(
      direction === "includes"
        ? "cInsight.includes.focus"
        : "cInsight.includedBy.focus",
    );
    if (this.defaultDepth > 0) {
      void this.expand("includes", this.defaultDepth).then(() =>
        this.expand("includedBy", this.defaultDepth),
      );
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
      await this.expand(direction, Number(value));
    }
  }

  stopExpansion(): void {
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.cancellation = undefined;
  }

  handleDocumentChange(document: vscode.TextDocument): void {
    if (!isIncludeFile(document.uri)) {
      return;
    }
    void this.reverse.update(document.uri, document.getText());
    if (this.root) {
      this.markStale();
    }
  }

  invalidate(): void {
    this.stopExpansion();
    this.resolver.invalidate();
    this.reverse.invalidate();
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
    const content =
      format === "json"
        ? JSON.stringify(roots.map(treeJson), undefined, 2)
        : format === "mermaid"
          ? mermaid(roots, direction)
          : roots.map((root) => treeText(root)).join("\n");
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
    const duplicate = !recursive && this.seen[direction].has(key);
    this.seen[direction].add(key);
    this.loadedNodes += 1;
    const directive = relation?.directive;
    const source =
      relation && "source" in relation
        ? relation.source
        : relationSource ?? this.root ?? uri;
    const previewLocation = directive
      ? directiveLocation(directive)
      : new vscode.Range(0, 0, 0, 0);
    const locationUri = directive ? source : uri;
    const kind = relation?.kind;
    return {
      id: `include:${direction}:${ancestors.join(">")}:${key}`,
      label: path.basename(uri.fsPath),
      description: [
        kindLabel(kind),
        duplicate ? "duplicate" : undefined,
        recursive ? "cycle" : undefined,
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
        recursive || duplicate || depth >= this.maximumDepth
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed,
      loadChildren:
        recursive || duplicate || depth >= this.maximumDepth
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
    if (this.loadedNodes >= this.maximumNodes) {
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
    if (this.loadedNodes >= this.maximumNodes) {
      return [limitNode()];
    }
    try {
      const incoming = await this.reverse.incoming(
        uri,
        this.cancellation?.token,
      );
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

  private async expand(
    direction: IncludeHierarchyDirection,
    depth: number,
  ): Promise<void> {
    this.stopExpansion();
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    const visit = async (nodes: TreeNode[], current: number): Promise<void> => {
      if (
        current >= depth ||
        cancellation.token.isCancellationRequested ||
        this.loadedNodes >= this.maximumNodes
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
    } finally {
      if (this.cancellation === cancellation) {
        this.cancellation = undefined;
      }
      cancellation.dispose();
    }
  }

  private markStale(): void {
    if (!this.root || this.stale) {
      return;
    }
    this.stale = true;
    for (const direction of ["includes", "includedBy"] as const) {
      this.provider(direction).setRoots([
        {
          label: "Include hierarchy is stale",
          description: "run Show Includes or Show Included By again",
          icon: new vscode.ThemeIcon("history"),
        },
        ...this.provider(direction).getRoots(),
      ]);
    }
  }

  private async updateFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      await this.reverse.update(uri, Buffer.from(content).toString("utf8"));
    } finally {
      if (this.root) {
        this.markStale();
      }
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

function errorNode(error: unknown): TreeNode {
  return {
    label: `Include hierarchy failed: ${String(error)}`,
    icon: new vscode.ThemeIcon("error"),
  };
}

function treeText(node: TreeNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}${node.label}${
    node.includeFileUri
      ? ` — ${vscode.workspace.asRelativePath(node.includeFileUri)}`
      : ""
  }`;
  return node.children?.length
    ? `${line}\n${node.children.map((child) => treeText(child, depth + 1)).join("\n")}`
    : line;
}

function treeJson(node: TreeNode): unknown {
  return {
    name: node.label,
    uri: node.includeFileUri?.toString(),
    source: node.location?.uri.toString(),
    line: node.location ? node.location.range.start.line + 1 : undefined,
    classification: node.description,
    children: node.children?.map(treeJson) ?? [],
  };
}

function mermaid(
  roots: TreeNode[],
  direction: IncludeHierarchyDirection,
): string {
  const nodes = flatten(roots).filter((node) => node.includeFileUri);
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
      const including = direction === "includes" ? node : child;
      const included = direction === "includes" ? child : node;
      lines.push(
        `  ${typeHierarchyMermaidEdge(ids.get(including)!, ids.get(included)!)}`,
      );
    }
  }
  return lines.join("\n");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
