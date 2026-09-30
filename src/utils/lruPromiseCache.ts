export class LruPromiseCache<T> {
  private readonly entries = new Map<string, Promise<T>>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private maximumEntries: number) {}

  get hits(): number {
    return this.hitCount;
  }

  get misses(): number {
    return this.missCount;
  }

  get size(): number {
    return this.entries.size;
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      this.hitCount += 1;
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    this.missCount += 1;
    const created = factory();
    this.entries.set(key, created);
    void created.catch(() => {
      if (this.entries.get(key) === created) {
        this.entries.delete(key);
      }
    });
    this.trim();
    return created;
  }

  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  resize(maximumEntries: number): void {
    this.maximumEntries = maximumEntries;
    this.trim();
  }

  private trim(): void {
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
