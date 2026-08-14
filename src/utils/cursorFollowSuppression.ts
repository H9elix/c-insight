export type CursorFollowInputKind =
  | "keyboard"
  | "mouse"
  | "command"
  | "unknown";

export interface CursorFollowTarget {
  uri: string;
  line: number;
  character: number;
}

interface PendingSuppression extends CursorFollowTarget {
  token: number;
  opening: boolean;
}

export class CursorFollowSuppression {
  private pending?: PendingSuppression;
  private nextToken = 1;

  begin(target: CursorFollowTarget): number {
    const token = this.nextToken++;
    this.pending = { ...target, token, opening: true };
    return token;
  }

  complete(token: number): void {
    if (this.pending?.token === token) {
      this.pending.opening = false;
    }
  }

  cancel(token: number): void {
    if (this.pending?.token === token) {
      this.pending = undefined;
    }
  }

  suppressActiveEditor(uri: string): boolean {
    if (!this.pending) {
      return false;
    }
    if (this.pending.uri !== uri) {
      this.pending = undefined;
      return false;
    }
    return true;
  }

  suppressSelection(
    target: CursorFollowTarget,
    kind: CursorFollowInputKind,
  ): boolean {
    if (!this.pending) {
      return false;
    }
    if (this.pending.uri !== target.uri) {
      this.pending = undefined;
      return false;
    }
    const moved =
      this.pending.line !== target.line ||
      this.pending.character !== target.character;
    if (
      !this.pending.opening &&
      moved &&
      (kind === "mouse" || kind === "keyboard")
    ) {
      this.pending = undefined;
      return false;
    }
    return true;
  }

  suppressAutomaticUpdate(uri: string): boolean {
    return this.pending?.uri === uri;
  }
}
