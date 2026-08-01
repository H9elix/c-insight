import * as vscode from "vscode";
import {
  deriveMicrosoftProviderStatus,
  MicrosoftProviderState,
  MicrosoftProviderStatus,
} from "./microsoftProviderStatusModel";
import {
  activeProviderConflicts,
  LLVM_CLANGD_EXTENSION_ID,
  MICROSOFT_CPP_EXTENSION_ID,
} from "./providerConflictModel";
export type {
  MicrosoftProviderInputs,
  MicrosoftProviderState,
  MicrosoftProviderStatus,
} from "./microsoftProviderStatusModel";
export { deriveMicrosoftProviderStatus } from "./microsoftProviderStatusModel";

export function microsoftProviderStatus(
  resource?: vscode.Uri,
): MicrosoftProviderStatus {
  const extension = vscode.extensions.getExtension(MICROSOFT_CPP_EXTENSION_ID);
  const intelliSenseEngine = vscode.workspace
    .getConfiguration("C_Cpp", resource)
    .get<string>("intelliSenseEngine", "default");
  const conflicts = activeProviderConflicts({
    engine: "microsoft",
    llvmClangdActive: Boolean(
      vscode.extensions.getExtension(LLVM_CLANGD_EXTENSION_ID)?.isActive,
    ),
    llvmClangdEnabled: vscode.workspace
      .getConfiguration("clangd", resource)
      .get<boolean>("enable", true),
    microsoftCppActive: Boolean(extension?.isActive),
    microsoftIntelliSenseEngine: intelliSenseEngine,
  });
  return deriveMicrosoftProviderStatus({
    extensionInstalled: Boolean(extension),
    extensionActive: Boolean(extension?.isActive),
    extensionVersion: extension?.packageJSON.version,
    intelliSenseEngine,
    conflicts,
  });
}

export function assertMicrosoftProviderUsable(
  status: MicrosoftProviderStatus,
): void {
  if (status.state === "disabled" || status.state === "unavailable") {
    throw new MicrosoftProviderConfigurationError(status.detail, status.state);
  }
  if (status.state === "ambiguous") {
    throw new MicrosoftProviderConfigurationError(status.detail, status.state);
  }
}

export class MicrosoftProviderConfigurationError extends Error {
  constructor(
    message: string,
    readonly state: Exclude<MicrosoftProviderState, "verified">,
  ) {
    super(message);
    this.name = "MicrosoftProviderConfigurationError";
  }
}
