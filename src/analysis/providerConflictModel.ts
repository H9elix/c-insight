export const LLVM_CLANGD_EXTENSION_ID =
  "llvm-vs-code-extensions.vscode-clangd";
export const MICROSOFT_CPP_EXTENSION_ID = "ms-vscode.cpptools";

export interface ProviderConflictInputs {
  llvmClangdAvailable: boolean;
  llvmClangdEnabled: boolean;
  microsoftCppAvailable: boolean;
  microsoftIntelliSenseEngine: string;
}

export function activeProviderConflicts(
  inputs: ProviderConflictInputs,
): string[] {
  const conflicts: string[] = [];
  if (inputs.llvmClangdAvailable && inputs.llvmClangdEnabled) {
    conflicts.push(LLVM_CLANGD_EXTENSION_ID);
  }
  if (
    inputs.microsoftCppAvailable &&
    inputs.microsoftIntelliSenseEngine !== "disabled"
  ) {
    conflicts.push(MICROSOFT_CPP_EXTENSION_ID);
  }
  return conflicts;
}
