import { Worker } from "node:worker_threads";
import type { MatchResult, SearchOptions } from "./searchModel";

export class SearchCancelled extends Error { constructor() { super("Search cancelled."); } }
export class MatchTimeout extends Error { constructor() { super("Regular expression timed out."); } }

/** One slot per scanning lane. No unbounded work queue; callers await before reading another file. */
export class MatchingWorker {
  private worker?: Worker;
  constructor(private readonly path: string, private readonly timeout = 2000) {}
  async match(text: string, options: SearchOptions, maximum: number, signal: AbortSignal, positions?: number[]): Promise<MatchResult> {
    if (signal.aborted) throw new SearchCancelled();
    if (!this.worker) {
      const environment = {...process.env}; delete environment.NODE_TEST_CONTEXT;
      this.worker = new Worker(this.path, {env: environment});
    }
    const worker = this.worker;
    return new Promise<MatchResult>((resolve, reject) => {
      const finish = (error?: Error, result?: MatchResult): void => {
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        worker.removeListener("message", receive); worker.removeListener("error", failed); worker.removeListener("exit", exited);
        if (error) { this.dispose(); reject(error); } else resolve(result!);
      };
      const abort = (): void => finish(new SearchCancelled());
      const failed = (error: Error): void => finish(error);
      const exited = (code: number): void => finish(new Error(`Search worker exited (${code}).`));
      const receive = (message: {error?: string; result?: MatchResult}): void => finish(message.error ? new Error(message.error) : undefined, message.result);
      const timer = setTimeout(() => finish(new MatchTimeout()), this.timeout);
      worker.once("message", receive); worker.once("error", failed); worker.once("exit", exited);
      signal.addEventListener("abort", abort, {once: true});
      worker.postMessage({text, options, maximum, positions});
    });
  }
  dispose(): void { const worker = this.worker; this.worker = undefined; if (worker) void worker.terminate(); }
}
