import * as vscode from "vscode";

interface CacheEntry {
  text: string;
  version: number;
}

export class SourceLineCache implements vscode.Disposable {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly documentRequests = new Map<
    string,
    Promise<vscode.TextDocument>
  >();
  private readonly changeSubscription: vscode.Disposable;

  constructor(private readonly maximumLines = 2_000) {
    this.changeSubscription = vscode.workspace.onDidChangeTextDocument(
      (event) => this.invalidate(event.document.uri),
    );
  }

  async line(uri: vscode.Uri, line: number): Promise<string | undefined> {
    const document = await this.document(uri);
    if (line < 0 || line >= document.lineCount) {
      return undefined;
    }
    const key = this.key(uri, line);
    const cached = this.entries.get(key);
    if (cached?.version === document.version) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.text;
    }
    const text = document.lineAt(line).text;
    this.entries.set(key, { text, version: document.version });
    this.trim();
    return text;
  }

  invalidate(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    this.entries.clear();
    this.documentRequests.clear();
    this.changeSubscription.dispose();
  }

  private async document(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const key = uri.toString();
    const existing = this.documentRequests.get(key);
    if (existing) {
      return existing;
    }
    const request = Promise.resolve(vscode.workspace.openTextDocument(uri));
    this.documentRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (this.documentRequests.get(key) === request) {
        this.documentRequests.delete(key);
      }
    }
  }

  private key(uri: vscode.Uri, line: number): string {
    return `${uri.toString()}:${line}`;
  }

  private trim(): void {
    while (this.entries.size > this.maximumLines) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }
}
