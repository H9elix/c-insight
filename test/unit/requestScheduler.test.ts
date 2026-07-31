import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RequestScheduler,
  ScheduledRequestCancelledError,
  SchedulerCancellation,
} from "../../src/analysis/requestScheduler";

describe("semantic request scheduler", () => {
  it("runs queued interactive work before normal and background work", async () => {
    const scheduler = new RequestScheduler(1, 1);
    const gate = deferred<void>();
    const order: string[] = [];
    const active = scheduler.schedule("active", "normal", async () => {
      order.push("active");
      await gate.promise;
    });
    const background = scheduler.schedule("background", "background", async () => {
      order.push("background");
    });
    const normal = scheduler.schedule("normal", "normal", async () => {
      order.push("normal");
    });
    const interactive = scheduler.schedule(
      "interactive",
      "interactive",
      async () => {
        order.push("interactive");
      },
    );
    gate.resolve(undefined);
    await Promise.all([active, background, normal, interactive]);
    assert.deepEqual(order, ["active", "interactive", "normal", "background"]);
  });

  it("coalesces identical requests and reports scheduler statistics", async () => {
    const scheduler = new RequestScheduler(2, 1);
    let executions = 0;
    const first = scheduler.schedule("same", "normal", async () => {
      executions += 1;
      return 42;
    });
    const second = scheduler.schedule("same", "normal", async () => 99);
    assert.equal(await first, 42);
    assert.equal(await second, 42);
    assert.equal(executions, 1);
    assert.equal(scheduler.stats().submitted, 2);
    assert.equal(scheduler.stats().coalesced, 1);
  });

  it("limits background concurrency while leaving capacity for foreground work", async () => {
    const scheduler = new RequestScheduler(3, 1);
    const gate = deferred<void>();
    let activeBackground = 0;
    let peakBackground = 0;
    const background = Array.from({ length: 3 }, (_, index) =>
      scheduler.schedule(`background-${index}`, "background", async () => {
        activeBackground += 1;
        peakBackground = Math.max(peakBackground, activeBackground);
        await gate.promise;
        activeBackground -= 1;
      }),
    );
    const interactive = scheduler.schedule("interactive", "interactive", async () => 7);
    assert.equal(await interactive, 7);
    gate.resolve(undefined);
    await Promise.all(background);
    assert.equal(peakBackground, 1);
  });

  it("rejects cancellation while a request is still queued", async () => {
    const scheduler = new RequestScheduler(1, 1);
    const gate = deferred<void>();
    const active = scheduler.schedule("active", "normal", () => gate.promise);
    const cancellation = new TestCancellation();
    const queued = scheduler.schedule(
      "queued",
      "normal",
      async () => "unexpected",
      cancellation,
    );
    cancellation.cancel();
    await assert.rejects(queued, ScheduledRequestCancelledError);
    gate.resolve(undefined);
    await active;
    assert.equal(scheduler.stats().cancelledBeforeStart, 1);
  });
});

class TestCancellation implements SchedulerCancellation {
  isCancellationRequested = false;
  private readonly listeners = new Set<() => void>();

  onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  cancel(): void {
    this.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}
