export class PreviewClearGuard {
  private deadline = 0;

  constructor(private readonly durationMs = 1_000) {}

  arm(now = Date.now()): void {
    this.deadline = now + this.durationMs;
  }

  shouldPreserve(now = Date.now()): boolean {
    return now < this.deadline;
  }

  reset(): void {
    this.deadline = 0;
  }
}
