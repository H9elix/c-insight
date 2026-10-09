export interface CursorRefreshAnchor {
  uri: string;
  version: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export type CursorRefreshDecision = "query" | "unchanged" | "preserve";

export interface EditSelectionMarker {
  uri: string;
  version: number;
  positions: ReadonlySet<string>;
  createdAt: number;
}

export class EditSelectionGuard {
  private static readonly relatedMismatchWindowMs = 100;
  private static readonly exactPositionWindowMs = 250;
  private marker?: EditSelectionMarker;

  begin(
    uri: string,
    version: number,
    positions: ReadonlySet<string>,
    now = Date.now(),
  ): void {
    const marker = { uri, version, positions, createdAt: now };
    this.marker = marker;
  }

  shouldSuppress(
    uri: string,
    version: number,
    position: string,
    now = Date.now(),
  ): boolean {
    if (!this.marker) {
      return false;
    }
    if (
      this.marker.uri === uri &&
      this.marker.version === version &&
      (
        (
          this.marker.positions.has(position) &&
          now - this.marker.createdAt <=
            EditSelectionGuard.exactPositionWindowMs
        ) ||
        now - this.marker.createdAt <=
          EditSelectionGuard.relatedMismatchWindowMs
      )
    ) {
      return true;
    }
    this.marker = undefined;
    return false;
  }

  blocksAutomatic(uri: string, version: number): boolean {
    return this.marker?.uri === uri && this.marker.version === version;
  }

  clear(): void {
    this.marker = undefined;
  }

  get active(): boolean {
    return this.marker !== undefined;
  }
}

export class CursorRefreshModel {
  private lastAnchorKey?: string;
  private readonly emptyAnchorKeys = new Map<string, undefined>();

  constructor(private readonly maximumEmptyAnchors = 256) {}

  decide(anchor: CursorRefreshAnchor | undefined): CursorRefreshDecision {
    if (!anchor) {
      this.lastAnchorKey = undefined;
      return "preserve";
    }
    const key = cursorRefreshAnchorKey(anchor);
    if (key === this.lastAnchorKey) {
      return "unchanged";
    }
    this.lastAnchorKey = key;
    if (this.emptyAnchorKeys.has(key)) {
      this.touchEmpty(key);
      return "preserve";
    }
    return "query";
  }

  track(anchor: CursorRefreshAnchor | undefined): void {
    this.lastAnchorKey = anchor ? cursorRefreshAnchorKey(anchor) : undefined;
  }

  recordResult(
    anchor: CursorRefreshAnchor | undefined,
    hasSymbolEvidence: boolean,
  ): void {
    if (!anchor) {
      return;
    }
    const key = cursorRefreshAnchorKey(anchor);
    if (hasSymbolEvidence) {
      this.emptyAnchorKeys.delete(key);
      return;
    }
    this.emptyAnchorKeys.set(key, undefined);
    this.touchEmpty(key);
    while (this.emptyAnchorKeys.size > this.maximumEmptyAnchors) {
      const oldest = this.emptyAnchorKeys.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        break;
      }
      this.emptyAnchorKeys.delete(oldest);
    }
  }

  documentChanged(uri: string): void {
    this.lastAnchorKey = undefined;
    const prefix = `${uri}\0`;
    for (const key of this.emptyAnchorKeys.keys()) {
      if (key.startsWith(prefix)) {
        this.emptyAnchorKeys.delete(key);
      }
    }
  }

  clear(): void {
    this.lastAnchorKey = undefined;
    this.emptyAnchorKeys.clear();
  }

  private touchEmpty(key: string): void {
    this.emptyAnchorKeys.delete(key);
    this.emptyAnchorKeys.set(key, undefined);
  }
}

export function cursorRefreshAnchorKey(anchor: CursorRefreshAnchor): string {
  return [
    anchor.uri,
    anchor.version,
    anchor.startLine,
    anchor.startCharacter,
    anchor.endLine,
    anchor.endCharacter,
  ].join("\0");
}
