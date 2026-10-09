export class CallHierarchyViewState {
  pinned = false;
  pinnedSymbol?: string;
  pinnedStale = false;

  pin(symbol?: string): void {
    this.pinned = true;
    this.pinnedSymbol = symbol;
    this.pinnedStale = false;
  }

  unpin(): void {
    this.pinned = false;
    this.pinnedSymbol = undefined;
    this.pinnedStale = false;
  }

  replacePinnedSymbol(symbol?: string): void {
    if (!this.pinned) return;
    this.pinnedSymbol = symbol;
    this.pinnedStale = false;
  }

  markStale(): boolean {
    if (!this.pinned || this.pinnedStale) return false;
    this.pinnedStale = true;
    return true;
  }
}
