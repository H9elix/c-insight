/** Test-only CDP access to isolated workbench/Webview renderers. Never loaded by the extension. */
export class RendererProbe {
  private sequence = 0;
  private readonly pending = new Map<number, {resolve: (value: any) => void; reject: (reason: Error) => void}>();
  private readonly contexts = new Map<string, {id: number; session?: string}>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message)); else pending?.resolve(message.result);
      } else if (message.method === "Runtime.executionContextCreated") {
        const context = message.params.context;
        this.contexts.set(`${message.sessionId ?? ""}/${context.id}`, {id: context.id, session: message.sessionId});
      } else if (message.method === "Runtime.executionContextDestroyed") this.contexts.delete(`${message.sessionId ?? ""}/${message.params.executionContextId}`);
      else if (message.method === "Target.attachedToTarget") {
        void this.enable(message.params.sessionId).catch(() => undefined);
      }
    });
  }
  static async connect(port: string): Promise<RendererProbe> {
    let url: string | undefined;
    for (let attempt = 0; attempt < 100 && !url; attempt++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{type: string; url: string; webSocketDebuggerUrl: string}>;
        url = pages.find(page => page.type === "page" && /workbench/.test(page.url))?.webSocketDebuggerUrl;
      } catch { /* Workbench is still starting. */ }
      if (!url) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!url) throw new Error("Isolated workbench CDP target unavailable");
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {socket.addEventListener("open", () => resolve(), {once: true}); socket.addEventListener("error", () => reject(new Error("CDP connection failed")), {once: true});});
    const probe = new RendererProbe(socket); await probe.enable(); return probe;
  }
  private async enable(session?: string): Promise<void> {
    await this.send("Runtime.enable", {}, session);
    await this.send("Target.setAutoAttach", {autoAttach: true, waitForDebuggerOnStart: false, flatten: true}, session);
  }
  private send(method: string, params: object, sessionId?: string): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`));}, 10000);
      this.pending.set(id, {resolve: value => {clearTimeout(timeout); resolve(value);}, reject: error => {clearTimeout(timeout); reject(error);}});
      this.socket.send(JSON.stringify({id, method, params, sessionId}));
    });
  }
  async evaluate<T>(expression: string, context?: {id: number; session?: string}): Promise<T> {
    const result = await this.send("Runtime.evaluate", {expression, contextId: context?.id, awaitPromise: true, returnByValue: true}, context?.session);
    if (result.exceptionDetails) throw new Error("Renderer probe expression failed");
    return result.result?.value as T;
  }
  async context(selector: string): Promise<{id: number; session?: string}> {
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const context of this.contexts.values()) {
        try {if (await this.evaluate<boolean>(`typeof document!=='undefined'&&!!document.querySelector(${JSON.stringify(selector)})`, context)) return context;}
        catch { /* A renderer may have been replaced. */ }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Renderer not ready: ${selector}`);
  }
  dispose(): void {this.socket.close(); for (const pending of this.pending.values()) pending.reject(new Error("Renderer probe disposed")); this.pending.clear();}
}
