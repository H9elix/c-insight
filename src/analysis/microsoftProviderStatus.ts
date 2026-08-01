import * as vscode from "vscode";
import {
  deriveMicrosoftProviderStatus,
  MicrosoftProviderState,
  MicrosoftProviderStatus,
} from "./microsoftProviderStatusModel";
export type {
  MicrosoftProviderInputs,
  MicrosoftProviderState,
  MicrosoftProviderStatus,
} from "./microsoftProviderStatusModel";
export { deriveMicrosoftProviderStatus } from "./microsoftProviderStatusModel";

const KNOWN_CONFLICTS = ["llvm-vs-code-extensions.vscode-clangd"];

export function microsoftProviderStatus(
  resource?: vscode.Uri,
): MicrosoftProviderStatus {
  const extension = vscode.extensions.getExtension("ms-vscode.cpptools");
  const intelliSenseEngine = vscode.workspace
    .getConfiguration("C_Cpp", resource)
    .get<string>("intelliSenseEngine", "default");
  const conflicts = KNOWN_CONFLICTS.filter(
    (id) => vscode.extensions.getExtension(id)?.isActive,
  );
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
