const DEFAULT_MAX_AUTOMATIC_RESTARTS = 4;
const DEFAULT_RESTART_WINDOW_MS = 3 * 60 * 1000;

export interface ClangdRecoveryDecision {
  action: "restart" | "stop";
  crashCount: number;
  maxAutomaticRestarts: number;
  windowMs: number;
}

/**
 * Bounds automatic restarts so a repeatedly crashing clangd cannot leave the
 * extension host in an unending process-spawn loop.
 */
export class ClangdRecoveryPolicy {
  private unexpectedCloseTimes: number[] = [];

  constructor(
    private readonly maxAutomaticRestarts = DEFAULT_MAX_AUTOMATIC_RESTARTS,
    private readonly windowMs = DEFAULT_RESTART_WINDOW_MS,
  ) {}

  recordUnexpectedClose(now = Date.now()): ClangdRecoveryDecision {
    const cutoff = now - this.windowMs;
    this.unexpectedCloseTimes = this.unexpectedCloseTimes.filter(
      (timestamp) => timestamp >= cutoff,
    );
    this.unexpectedCloseTimes.push(now);

    return {
      action:
        this.unexpectedCloseTimes.length <= this.maxAutomaticRestarts
          ? "restart"
          : "stop",
      crashCount: this.unexpectedCloseTimes.length,
      maxAutomaticRestarts: this.maxAutomaticRestarts,
      windowMs: this.windowMs,
    };
  }
}

/**
 * These errors are normally secondary effects of the clangd process exiting:
 * the language client is still flushing document notifications while the
 * process pipe is already gone.
 */
export function isBrokenClangdTransportError(value: unknown): boolean {
  const text = transportErrorText(value);
  return (
    /\bEPIPE\b/i.test(text) ||
    /\bERR_STREAM_DESTROYED\b/i.test(text) ||
    /write after (?:a stream was destroyed|end)/i.test(text) ||
    /stream (?:has been|was|is) destroyed/i.test(text)
  );
}

function transportErrorText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code;
    return `${typeof code === "string" ? code : ""} ${value.message}`;
  }
  if (value && typeof value === "object") {
    const candidate = value as { code?: unknown; message?: unknown };
    return `${typeof candidate.code === "string" ? candidate.code : ""} ${
      typeof candidate.message === "string" ? candidate.message : ""
    }`;
  }
  return "";
}
