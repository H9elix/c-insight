export class PreviewHistory<T> {
  private entries: T[] = [];
  private index = -1;

  constructor(
    private readonly equal: (left: T, right: T) => boolean,
    private readonly maximumEntries = 100,
  ) {}

  get canBack(): boolean {
    return this.index > 0;
  }

  get canForward(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  reset(value: T): void {
    this.entries = [value];
    this.index = 0;
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
  }

  push(value: T): void {
    const current = this.entries[this.index];
    if (current && this.equal(current, value)) {
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(value);
    if (this.entries.length > this.maximumEntries) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  move(delta: -1 | 1): T | undefined {
    const next = this.index + delta;
    if (next < 0 || next >= this.entries.length) {
      return undefined;
    }
    this.index = next;
    return this.entries[this.index];
  }
}
