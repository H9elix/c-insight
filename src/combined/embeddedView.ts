import * as vscode from "vscode";

/** A presentation surface, not a provider or query owner. Its lifetime belongs to one combined pane. */
export class EmbeddedView implements vscode.WebviewView, vscode.Disposable {
  title?: string;
  description?: string;
  badge?: vscode.ViewBadge;
  readonly webview: EmbeddedWebview;
  private shown = false;
  private disposed = false;
  private readonly visibility = new vscode.EventEmitter<void>();
  private readonly disposal = new vscode.EventEmitter<void>();
  readonly onDidChangeVisibility = this.visibility.event;
  readonly onDidDispose = this.disposal.event;
  get visible(): boolean { return this.shown && !this.disposed; }

  constructor(readonly viewType: string, private readonly parent: vscode.WebviewView, title: string,
    changed: () => void, post: (message: unknown) => Thenable<boolean>) {
    this.title = title;
    this.webview = new EmbeddedWebview(parent.webview, changed, post);
  }
  show(preserveFocus?: boolean): void { this.parent.show(preserveFocus); }
  setVisible(visible: boolean): void {
    if (this.disposed || visible === this.shown) return;
    this.shown = visible; this.visibility.fire();
  }
  dispose(): void {
    if (this.disposed) return;
    this.shown = false; this.disposed = true;
    this.disposal.fire(); this.disposal.dispose(); this.visibility.dispose(); this.webview.dispose();
  }
}

class EmbeddedWebview implements vscode.Webview, vscode.Disposable {
  options: vscode.WebviewOptions = {};
  private content = "";
  private readonly receive = new vscode.EventEmitter<unknown>();
  readonly onDidReceiveMessage = this.receive.event;
  constructor(private readonly parent: vscode.Webview, private readonly changed: () => void,
    readonly postMessage: (message: unknown) => Thenable<boolean>) {}
  get html(): string { return this.content; }
  set html(value: string) { this.content = value; this.changed(); }
  get cspSource(): string { return this.parent.cspSource; }
  asWebviewUri(uri: vscode.Uri): vscode.Uri { return this.parent.asWebviewUri(uri); }
  receiveMessage(message: unknown): void { this.receive.fire(message); }
  dispose(): void { this.receive.dispose(); }
}
