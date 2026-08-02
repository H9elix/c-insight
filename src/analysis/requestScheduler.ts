export type RequestPriority = "interactive" | "normal" | "background";

export interface SchedulerCancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface RequestSchedulerStats {
  submitted: number;
  coalesced: number;
  started: number;
  completed: number;
  failed: number;
  cancelledBeforeStart: number;
  active: number;
  queued: number;
  peakActive: number;
}

interface QueueEntry<T> {
  key: string;
  priority: RequestPriority;
  sequence: number;
  task: () => Promise<T>;
  cancellation?: SchedulerCancellation;
  started: boolean;
  settled: boolean;
  resolve(value: T): void;
  reject(error: unknown): void;
  cancellationSubscription?: { dispose(): void };
}

export class RequestScheduler {
  private readonly queue: Array<QueueEntry<unknown>> = [];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private sequence = 0;
  private active = 0;
  private activeBackground = 0;
  private counters = {
    submitted: 0,
    coalesced: 0,
    started: 0,
    completed: 0,
    failed: 0,
    cancelledBeforeStart: 0,
    peakActive: 0,
  };

  constructor(
    private maximumConcurrent = 8,
    private maximumBackground = 2,
  ) {
    this.setLimits(maximumConcurrent, maximumBackground);
  }

  setLimits(maximumConcurrent: number, maximumBackground: number): void {
    this.maximumConcurrent = positiveInteger(maximumConcurrent, 8);
    this.maximumBackground = Math.min(
      this.maximumConcurrent,
      positiveInteger(maximumBackground, 2),
    );
    this.drain();
  }

  schedule<T>(
    key: string,
    priority: RequestPriority,
    task: () => Promise<T>,
    cancellation?: SchedulerCancellation,
  ): Promise<T> {
    this.counters.submitted += 1;
    const existing = this.inFlight.get(key);
    if (existing) {
      this.counters.coalesced += 1;
      return existing as Promise<T>;
    }
    if (cancellation?.isCancellationRequested) {
      this.counters.cancelledBeforeStart += 1;
      return Promise.reject(new ScheduledRequestCancelledError());
    }
    let entry!: QueueEntry<T>;
    const promise = new Promise<T>((resolve, reject) => {
      entry = {
        key,
        priority,
        sequence: this.sequence++,
        task,
        cancellation,
        started: false,
        settled: false,
        resolve,
        reject,
      };
    });
    this.inFlight.set(key, promise);
    entry.cancellationSubscription = cancellation?.onCancellationRequested(
      () => {
        if (!entry.started && !entry.settled) {
          entry.settled = true;
          this.counters.cancelledBeforeStart += 1;
          const queuedIndex = this.queue.indexOf(entry as QueueEntry<unknown>);
          if (queuedIndex >= 0) {
            this.queue.splice(queuedIndex, 1);
          }
          entry.reject(new ScheduledRequestCancelledError());
          this.finishEntry(entry, promise);
          this.drain();
        }
      },
    );
    this.queue.push(entry as QueueEntry<unknown>);
    this.drain();
    return promise;
  }

  stats(): RequestSchedulerStats {
    return {
      ...this.counters,
      active: this.active,
      queued: this.queue.length,
    };
  }

  private drain(): void {
    while (this.active < this.maximumConcurrent) {
      const index = this.nextEligibleIndex();
      if (index < 0) {
        return;
      }
      const [entry] = this.queue.splice(index, 1);
      if (entry.settled || entry.cancellation?.isCancellationRequested) {
        if (!entry.settled) {
          entry.settled = true;
          this.counters.cancelledBeforeStart += 1;
          entry.reject(new ScheduledRequestCancelledError());
        }
        entry.cancellationSubscription?.dispose();
        continue;
      }
      this.start(entry);
    }
  }

  private nextEligibleIndex(): number {
    let selected = -1;
    for (let index = 0; index < this.queue.length; index += 1) {
      const entry = this.queue[index];
      if (
        entry.settled ||
        (entry.priority === "background" &&
          this.activeBackground >= this.maximumBackground)
      ) {
        continue;
      }
      if (
        selected < 0 ||
        priorityValue(entry.priority) >
          priorityValue(this.queue[selected].priority) ||
        (entry.priority === this.queue[selected].priority &&
          entry.sequence < this.queue[selected].sequence)
      ) {
        selected = index;
      }
    }
    return selected;
  }

  private start(entry: QueueEntry<unknown>): void {
    entry.started = true;
    this.active += 1;
    if (entry.priority === "background") {
      this.activeBackground += 1;
    }
    this.counters.started += 1;
    this.counters.peakActive = Math.max(this.counters.peakActive, this.active);
    const promise = this.inFlight.get(entry.key)!;
    void entry.task().then(
      (value) => {
        if (!entry.settled) {
          entry.settled = true;
          this.counters.completed += 1;
          entry.resolve(value);
        }
      },
      (error) => {
        if (!entry.settled) {
          entry.settled = true;
          this.counters.failed += 1;
          entry.reject(error);
        }
      },
    ).finally(() => {
      this.active -= 1;
      if (entry.priority === "background") {
        this.activeBackground -= 1;
      }
      this.finishEntry(entry, promise);
      this.drain();
    });
  }

  private finishEntry(
    entry: QueueEntry<unknown>,
    promise: Promise<unknown>,
  ): void {
    entry.cancellationSubscription?.dispose();
    if (this.inFlight.get(entry.key) === promise) {
      this.inFlight.delete(entry.key);
    }
  }
}

export class ScheduledRequestCancelledError extends Error {
  constructor() {
    super("Request cancelled before it started");
    this.name = "ScheduledRequestCancelledError";
  }
}

function priorityValue(priority: RequestPriority): number {
  return priority === "interactive" ? 2 : priority === "normal" ? 1 : 0;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
