import * as vscode from "vscode";
import {
  classifyClangdLog,
  ClangdLogLevel,
  explicitClangdLogLevel,
} from "./clangdLogClassifier";

/**
 * vscode-languageclient receives clangd's stderr and reports every chunk via
 * LogOutputChannel.error(). clangd intentionally writes all log levels to
 * stderr, so classify its I/W/E/V prefix before forwarding to VS Code.
 */
export class ClangdLogOutputChannel implements vscode.LogOutputChannel {
  private previousClangdLevel?: ClangdLogLevel;
  private remainingContinuationLines = 0;

  constructor(private readonly delegate: vscode.LogOutputChannel) {}

  get name(): string {
    return this.delegate.name;
  }

  get logLevel(): vscode.LogLevel {
    return this.delegate.logLevel;
  }

  get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
    return this.delegate.onDidChangeLogLevel;
  }

  append(value: string): void {
    this.delegate.append(value);
  }

  appendLine(value: string): void {
    this.delegate.appendLine(value);
  }

  replace(value: string): void {
    this.delegate.replace(value);
  }

  clear(): void {
    this.delegate.clear();
  }

  show(
    columnOrPreserveFocus?: vscode.ViewColumn | boolean,
    preserveFocus?: boolean,
  ): void {
    if (typeof columnOrPreserveFocus === "boolean") {
      this.delegate.show(columnOrPreserveFocus);
    } else {
      this.delegate.show(columnOrPreserveFocus, preserveFocus);
    }
  }

  hide(): void {
    this.delegate.hide();
  }

  dispose(): void {
    // The extension context owns the delegate.
  }

  trace(message: string, ...args: any[]): void {
    this.delegate.trace(message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.delegate.debug(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.delegate.info(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.delegate.warn(message, ...args);
  }

  error(error: string | Error, ...args: any[]): void {
    if (error instanceof Error) {
      this.previousClangdLevel = undefined;
      this.remainingContinuationLines = 0;
      this.delegate.error(error, ...args);
      return;
    }
    const explicitLevel = explicitClangdLogLevel(error);
    const continuationLevel =
      this.remainingContinuationLines > 0
        ? this.previousClangdLevel
        : undefined;
    const level = classifyClangdLog(error, continuationLevel);
    if (explicitLevel) {
      this.previousClangdLevel = explicitLevel;
      this.remainingContinuationLines = /\bwith command\s*$/i.test(error)
        ? 2
        : 0;
    } else if (this.remainingContinuationLines > 0) {
      this.remainingContinuationLines -= 1;
      if (this.remainingContinuationLines === 0) {
        this.previousClangdLevel = undefined;
      }
    }
    switch (level) {
      case "trace":
        this.delegate.trace(error, ...args);
        break;
      case "debug":
        this.delegate.debug(error, ...args);
        break;
      case "info":
        this.delegate.info(error, ...args);
        break;
      case "warning":
        this.delegate.warn(error, ...args);
        break;
      case "error":
        this.delegate.error(error, ...args);
        break;
    }
  }
}
