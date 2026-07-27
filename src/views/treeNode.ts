import * as vscode from "vscode";
import { CallNode, LocationResult } from "../models/types";
import type { NavigationMode } from "../history/navigationHistoryModel";

export interface TreeNode {
  id?: string;
  label: string;
  description?: string;
  tooltip?: string | vscode.MarkdownString;
  icon?: vscode.ThemeIcon;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  children?: TreeNode[];
  location?: LocationResult;
  previewMode?: NavigationMode;
  previewTitle?: string;
  contextValue?: string;
  loadChildren?: () => Promise<TreeNode[]>;
  resolveVisible?: () => Promise<void>;
  command?: vscode.Command;
  callKey?: string;
  callDepth?: number;
  callNode?: CallNode;
  parent?: TreeNode;
  bookmarkId?: string;
}

export class MutableTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private roots: TreeNode[] = [];
  private readonly emitter = new vscode.EventEmitter<
    TreeNode | undefined | null | void
  >();

  readonly onDidChangeTreeData = this.emitter.event;

  setRoots(roots: TreeNode[]): void {
    this.roots = roots;
    this.emitter.fire();
  }

  clear(): void {
    this.setRoots([]);
  }

  getRoots(): TreeNode[] {
    return this.roots;
  }

  refresh(node?: TreeNode): void {
    this.emitter.fire(node);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.collapsibleState ??
        (node.children || node.loadChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None),
    );
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = node.icon;
    item.contextValue = node.contextValue;
    if (node.command) {
      item.command = node.command;
    } else if (node.location) {
      item.command = {
        command: "cInsight.previewLocation",
        title: "Preview",
        arguments: [
          node.location,
          node.previewMode ?? "reference",
          node.previewTitle ?? node.label,
        ],
      };
      item.contextValue = node.contextValue ?? "location";
    }
    if (node.resolveVisible) {
      const resolve = node.resolveVisible;
      node.resolveVisible = undefined;
      void resolve().then(
        () => this.refresh(node),
        () => undefined,
      );
    }
    return item;
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    if (!node) {
      return this.roots;
    }
    if (node.loadChildren && !node.children) {
      node.children = await node.loadChildren();
      node.loadChildren = undefined;
    }
    const children = node.children ?? [];
    for (const child of children) {
      child.parent = node;
    }
    return children;
  }

  getParent(node: TreeNode): TreeNode | undefined {
    return node.parent;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
