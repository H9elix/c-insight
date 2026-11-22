import * as vscode from "vscode";
import { VIEWS, ViewId } from "../ids";
import { MutableTreeProvider } from "./treeNode";
import { ResultTreeOptions, ResultTreeView, WebviewResultTree } from "./resultTreeView";
import type { ViewRegistrar } from "./viewDiscovery";

export class ViewLifecycle implements vscode.Disposable {
  private readonly treeViews = new Map<ViewId, ResultTreeView>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri, private readonly registerView: ViewRegistrar = (...args) => vscode.window.registerWebviewViewProvider(...args)) {}

  createTreeView(
    id: ViewId,
    provider: MutableTreeProvider,
    notifyVisibility: boolean,
    options?: ResultTreeOptions,
  ): ResultTreeView {
    const view = new WebviewResultTree(id, provider, this.extensionUri, options);
    this.track(this.registerView(id, view, options?.persistentFilter
      ? { webviewOptions: { retainContextWhenHidden: true } } : undefined));
    this.treeViews.set(id, view);
    this.track(view);
    if (notifyVisibility) {
      this.track(view.onDidChangeEffectiveVisibility(() => this.visibilityEmitter.fire(id)));
    }
    return view;
  }

  registerWebview(
    provider: vscode.WebviewViewProvider & vscode.Disposable,
    onDidChangeVisibility: vscode.Event<void>,
  ): void {
    this.track(
      this.registerView(VIEWS.PREVIEW, provider),
      provider,
      onDidChangeVisibility(() => this.visibilityEmitter.fire(VIEWS.PREVIEW)),
    );
  }

  get(id: ViewId): ResultTreeView | undefined {
    return this.treeViews.get(id);
  }

  isVisible(id: ViewId): boolean {
    const view = this.treeViews.get(id);
    return view instanceof WebviewResultTree ? view.effectiveVisible : view?.visible ?? false;
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
