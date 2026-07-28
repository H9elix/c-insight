export class HierarchyTreeState {
  private readonly seen = new Set<string>();
  private count = 0;

  get loadedNodes(): number {
    return this.count;
  }

  reset(): void {
    this.clearSeen();
    this.count = 0;
  }

  clearSeen(): void {
    this.seen.clear();
  }

  record(key: string, recursive: boolean): { duplicate: boolean } {
    const duplicate = !recursive && this.seen.has(key);
    this.seen.add(key);
    this.count += 1;
    return { duplicate };
  }

  atLimit(maximumNodes: number): boolean {
    return this.count >= maximumNodes;
  }

  remaining(maximumNodes: number): number {
    return Math.max(0, maximumNodes - this.count);
  }
}
