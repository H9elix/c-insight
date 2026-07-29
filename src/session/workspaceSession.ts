import * as vscode from "vscode";
import {
  parseWorkspaceSession,
  WORKSPACE_SESSION_VERSION,
  WorkspaceSessionSnapshot,
} from "./workspaceSessionModel";
export type {
  CallHierarchySessionState,
  HistorySessionState,
  PreviewSessionState,
  ReferenceSessionState,
  RelationshipGraphSessionState,
  SymbolSearchSessionState,
  WorkspaceSessionSnapshot,
} from "./workspaceSessionModel";

const STORAGE_KEY = "cInsight.workspaceSession";
export interface WorkspaceSessionAdapters {
  capture(): Omit<WorkspaceSessionSnapshot, "format" | "version" | "savedAt">;
}

export class WorkspaceSessionManager implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private suspended = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly adapters: WorkspaceSessionAdapters,
  ) {}

  load(ignoreEnabled = false): WorkspaceSessionSnapshot | undefined {
    if (!ignoreEnabled && !this.enabled) {
      return undefined;
    }
    const snapshot = parseWorkspaceSession(
      this.context.workspaceState.get<unknown>(STORAGE_KEY),
    );
    const maximumAgeDays = vscode.workspace
      .getConfiguration("cInsight.session")
      .get<number>("maximumAgeDays", 30);
    if (
      snapshot &&
      Date.now() - snapshot.savedAt > maximumAgeDays * 24 * 60 * 60 * 1_000
    ) {
      return undefined;
    }
    return snapshot;
  }

  startAutosave(): void {
    if (!this.enabled || this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.save(), 5_000);
  }

  async save(): Promise<void> {
    if (!this.enabled || this.suspended) {
      return;
    }
    const snapshot: WorkspaceSessionSnapshot = {
      format: "c-insight-workspace-session",
      version: WORKSPACE_SESSION_VERSION,
      savedAt: Date.now(),
      ...this.adapters.capture(),
    };
    await this.context.workspaceState.update(STORAGE_KEY, snapshot);
  }

  async clear(): Promise<void> {
    this.suspended = true;
    await this.context.workspaceState.update(STORAGE_KEY, undefined);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    void this.save();
  }

  private get enabled(): boolean {
    return vscode.workspace
      .getConfiguration("cInsight.session")
      .get<boolean>("restore", true);
  }
}
