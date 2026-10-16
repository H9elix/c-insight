import * as vscode from "vscode";
import { VIEWS, ViewId } from "../ids";
import { MutableTreeProvider } from "./treeNode";
import { ResultTreeView, WebviewResultTree } from "./resultTreeView";

export class ViewLifecycle implements vscode.Disposable {
  private readonly treeViews = new Map<ViewId, ResultTreeView>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly visibilityEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeVisibility = this.visibilityEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  createTreeView(
    id: ViewId,
    provider: MutableTreeProvider,
    notifyVisibility: boolean,
  ): ResultTreeView {
    const view = new WebviewResultTree(id, provider, this.extensionUri);
    this.track(vscode.window.registerWebviewViewProvider(id, view));
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

  get(id: ViewId): ResultTreeView | undefined {
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
