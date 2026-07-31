export interface RuntimeDiagnosticsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

class RuntimeDiagnostics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, amount = 1): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  setGauge(name: string, value: number): void {
    if (Number.isFinite(value) && value >= 0) {
      this.gauges.set(name, value);
    }
  }

  snapshot(): RuntimeDiagnosticsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
  }
}

export const runtimeDiagnostics = new RuntimeDiagnostics();
