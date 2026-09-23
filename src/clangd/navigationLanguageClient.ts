import type {
  DynamicFeature,
  StaticFeature,
} from "vscode-languageclient/node";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { isBrokenClangdTransportError } from "./clangdRecovery";
import { shouldRegisterLanguageClientFeature } from "./languageClientFeatureFilter";

/**
 * C Insight shares a VS Code extension host with other clangd clients.
 * clangd's execute-command names (for example clangd.applyFix) are global,
 * so registering them from two clients throws and aborts initialization.
 *
 * C Insight does not use those commands for its navigation views, therefore
 * it deliberately omits only the execute-command feature while retaining
 * document sync and all language navigation providers.
 */
export class NavigationLanguageClient extends LanguageClient {
  private brokenTransportReported = false;

  constructor(
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
  ) {
    super(id, name, serverOptions, clientOptions);
  }

  override registerFeature(
    feature: StaticFeature | DynamicFeature<unknown>,
  ): void {
    if (!shouldRegisterLanguageClientFeature(feature)) {
      return;
    }
    super.registerFeature(feature);
  }

  resetTransportFailureLogging(): void {
    this.brokenTransportReported = false;
  }

  override error(
    message: string,
    data?: unknown,
    showNotification: boolean | "force" = true,
  ): void {
    if (
      isBrokenClangdTransportError(message) ||
      isBrokenClangdTransportError(data)
    ) {
      if (this.brokenTransportReported) {
        return;
      }
      this.brokenTransportReported = true;
      super.error(
        "clangd transport closed unexpectedly; duplicate document synchronization errors are suppressed while automatic recovery starts.",
        undefined,
        false,
      );
      return;
    }
    super.error(message, data, showNotification);
  }
}
