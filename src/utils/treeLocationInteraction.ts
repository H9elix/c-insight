export type TreeLocationActivation = "preview" | "open";

interface PendingActivation {
  key: string;
  timestamp: number;
}

export class TreeLocationClickClassifier {
  private pending?: PendingActivation;

  classify(
    key: string,
    intervalMs: number,
    now = Date.now(),
  ): TreeLocationActivation {
    const previous = this.pending;
    if (
      previous?.key === key &&
      now >= previous.timestamp &&
      now - previous.timestamp <= intervalMs
    ) {
      this.pending = undefined;
      return "open";
    }
    this.pending = { key, timestamp: now };
    return "preview";
  }

  reset(): void {
    this.pending = undefined;
  }
}
