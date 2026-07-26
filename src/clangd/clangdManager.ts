import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  LanguageClientOptions,
  ServerOptions,
  State,
  WorkDoneProgressBegin,
  WorkDoneProgressEnd,
  WorkDoneProgressReport,
} from "vscode-languageclient/node";
import type { LanguageClient } from "vscode-languageclient/node";
import { readConfiguration } from "../configuration/configuration";
import { ClangdState } from "../models/types";
import { buildClangdArguments } from "./clangdArguments";
import { ClangdInstallation, locateClangd } from "./clangdLocator";
import { resolveCompilationDatabase } from "./compilationDatabase";
import {
  IndexProgressState,
  initialIndexProgress,
  updateIndexProgress,
} from "./indexProgress";
import { NavigationLanguageClient } from "./navigationLanguageClient";

export class ClangdManager implements vscode.Disposable {
  private client?: LanguageClient;
  private startPromise?: Promise<LanguageClient>;
  private installation?: ClangdInstallation;
  private state: ClangdState = "stopped";
  private readonly stateEmitter = new vscode.EventEmitter<ClangdState>();
  private readonly indexProgressEmitter =
    new vscode.EventEmitter<IndexProgressState>();
  private indexProgress = initialIndexProgress(true);
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChangeState = this.stateEmitter.event;
  readonly onDidChangeIndexProgress = this.indexProgressEmitter.event;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly clangdOutput: vscode.LogOutputChannel,
  ) {}

  get currentState(): ClangdState {
    return this.state;
  }

  get languageClient(): LanguageClient | undefined {
    return this.client;
  }

  get currentIndexProgress(): IndexProgressState {
    return this.indexProgress;
  }

  get clangdInstallation(): ClangdInstallation | undefined {
    return this.installation;
  }

  get supportsOutgoingCalls(): boolean {
    return (this.installation?.major ?? 0) >= 20;
  }

  showLog(): void {
    this.clangdOutput.show(true);
  }

  async start(): Promise<LanguageClient> {
    if (this.client?.state === State.Running) {
      return this.client;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    const promise = this.startInternal();
    this.startPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startPromise === promise) {
        this.startPromise = undefined;
      }
    }
  }

  private async startInternal(): Promise<LanguageClient> {
    if (!vscode.workspace.isTrusted) {
      this.setState("failed");
      throw new Error("C Insight does not start clangd in an untrusted workspace.");
    }

    this.setState("locating");
    const config = readConfiguration();
    this.setIndexProgress(initialIndexProgress(config.backgroundIndex));
    const installation = await locateClangd(config.clangdPath);
    this.installation = installation;
    const command = installation.command;

    const compilationDatabase = await resolveCompilationDatabase();
    const args = buildClangdArguments(
      config,
      compilationDatabase?.directory,
    );
    this.output.appendLine(`Selected ${installation.version}`);
    this.output.appendLine(
      compilationDatabase
        ? `Compilation database (${compilationDatabase.source}): ${compilationDatabase.path}`
        : "Compilation database: not found; using fallback flags",
    );
    this.output.appendLine(`Starting clangd: ${command} ${args.join(" ")}`);
    this.setState("starting");

    const serverOptions: ServerOptions = {
      command,
      args,
      options: {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      },
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "file", language: "objective-c" },
        { scheme: "file", language: "objective-cpp" },
      ],
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      outputChannel: this.clangdOutput,
      traceOutputChannel: this.clangdOutput,
      initializationOptions: {
        fallbackFlags: config.fallbackFlags,
      },
      middleware: {
        handleWorkDoneProgress: (token, params, next) => {
          if (
            token === "backgroundIndexProgress" ||
            ("title" in params &&
              params.title?.toLowerCase() === "indexing")
          ) {
            this.handleIndexProgress(params);
          }
          next(token, params);
        },
      },
      errorHandler: {
        error: (_error, _message, count) => ({
          action: count && count > 3 ? ErrorAction.Shutdown : ErrorAction.Continue,
          handled: true,
        }),
        closed: () => ({
          action: CloseAction.DoNotRestart,
          handled: true,
          message: "clangd connection closed. Use C Insight: Restart clangd.",
        }),
      },
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher(
          "**/{compile_commands.json,.clangd}",
        ),
      },
    };

    const client = new NavigationLanguageClient(
      "cInsight.clangd",
      "C Insight clangd",
      serverOptions,
      clientOptions,
    );
    this.client = client;
    this.disposables.push(
      client.onDidChangeState((event) => {
        if (event.newState === State.Running) {
          this.setState("ready");
        } else if (
          event.newState === State.Stopped &&
          this.state !== "stopped" &&
          this.state !== "restarting"
        ) {
          this.setState("failed");
        }
      }),
    );
    try {
      await client.start();
      this.setState(
        this.indexProgress.status === "indexing" ? "indexing" : "ready",
      );
      return client;
    } catch (error) {
      this.client = undefined;
      this.setState("failed");
      throw error;
    }
  }

  async restart(): Promise<LanguageClient> {
    this.setState("restarting");
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    if (this.client) {
      await this.client.stop().catch((error: unknown) => {
        this.output.appendLine(`Failed to stop clangd: ${String(error)}`);
      });
      this.client = undefined;
    }
    return this.start();
  }

  async stop(): Promise<void> {
    this.setState("stopped");
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    if (this.client) {
      await this.client.stop().catch((error: unknown) => {
        this.output.appendLine(`Failed to stop clangd: ${String(error)}`);
      });
      this.client = undefined;
    }
  }

  dispose(): void {
    void this.stop();
    this.disposables.forEach((item) => item.dispose());
    this.stateEmitter.dispose();
    this.indexProgressEmitter.dispose();
  }

  private handleIndexProgress(
    value:
      | WorkDoneProgressBegin
      | WorkDoneProgressReport
      | WorkDoneProgressEnd,
  ): void {
    this.setIndexProgress(updateIndexProgress(this.indexProgress, value));
    if (value.kind === "begin" || value.kind === "report") {
      this.setState("indexing");
    } else if (this.client?.state === State.Running) {
      this.setState("ready");
    }
  }

  private setIndexProgress(progress: IndexProgressState): void {
    this.indexProgress = progress;
    this.indexProgressEmitter.fire(progress);
  }

  private setState(state: ClangdState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.output.appendLine(`clangd state: ${state}`);
    this.stateEmitter.fire(state);
  }
}
