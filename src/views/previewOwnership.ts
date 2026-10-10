export class PreviewOwnership {
  private owner: "context" | "interaction" = "context";
  private contextGeneration?: number;

  beginContext(generation: number, reclaim: boolean): void {
    if (!reclaim && this.owner === "interaction") {
      return;
    }
    this.owner = "context";
    this.contextGeneration = generation;
  }

  claimInteraction(): void {
    this.owner = "interaction";
    this.contextGeneration = undefined;
  }

  allowsContext(generation: number | undefined): boolean {
    return generation !== undefined &&
      this.owner === "context" &&
      this.contextGeneration === generation;
  }

  get contextOwned(): boolean {
    return this.owner === "context" && this.contextGeneration !== undefined;
  }
}
