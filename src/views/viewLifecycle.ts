import * as vscode from "vscode";
import { VIEWS, ViewId } from "../ids";

export class ViewLifecycle<T> implements vscode.Disposable {
  private readonly treeViews = new Map<ViewId, vscode.TreeView<T>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  createTreeView(
    id: ViewId,
    provider: vscode.TreeDataProvider<T>,
    notifyVisibility: boolean,
  ): vscode.TreeView<T> {
    const view = vscode.window.createTreeView(id, {
      treeDataProvider: provider,
      showCollapseAll: true,
    });
    this.treeViews.set(id, view);
    this.track(view);
    if (notifyVisibility) {
      this.track(view.onDidChangeVisibility(() => this.visibilityEmitter.fire(id)));
    }
    return view;
  }

  registerWebview(
    provider: vscode.WebviewViewProvider & vscode.Disposable,
    onDidChangeVisibility: vscode.Event<void>,
  ): void {
    this.track(
      vscode.window.registerWebviewViewProvider(VIEWS.PREVIEW, provider),
      provider,
      onDidChangeVisibility(() => this.visibilityEmitter.fire(VIEWS.PREVIEW)),
    );
  }

  get(id: ViewId): vscode.TreeView<T> | undefined {
    return this.treeViews.get(id);
  }

  isVisible(id: ViewId): boolean {
    return this.treeViews.get(id)?.visible ?? false;
  }

  track(...items: vscode.Disposable[]): void {
    this.disposables.push(...items);
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose());
    this.disposables.length = 0;
    this.treeViews.clear();
    this.visibilityEmitter.dispose();
  }
}
