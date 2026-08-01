export type MicrosoftProviderState =
  | "verified"
  | "ambiguous"
  | "disabled"
  | "unavailable";

export interface MicrosoftProviderStatus {
  state: MicrosoftProviderState;
  extensionInstalled: boolean;
  extensionActive: boolean;
  extensionVersion?: string;
  intelliSenseEngine: string;
  conflicts: string[];
  detail: string;
}

export interface MicrosoftProviderInputs {
  extensionInstalled: boolean;
  extensionActive: boolean;
  extensionVersion?: string;
  intelliSenseEngine: string;
  conflicts: string[];
}

export function deriveMicrosoftProviderStatus(
  inputs: MicrosoftProviderInputs,
): MicrosoftProviderStatus {
  if (!inputs.extensionInstalled) {
    return {
      ...inputs,
      state: "unavailable",
      detail: "Microsoft C/C++ is not installed in this extension host.",
    };
  }
  if (inputs.intelliSenseEngine === "disabled") {
    return {
      ...inputs,
      state: "disabled",
      detail:
        "C_Cpp.intelliSenseEngine is disabled; Microsoft language-service Providers are unavailable.",
    };
  }
  if (inputs.intelliSenseEngine !== "default") {
    return {
      ...inputs,
      state: "unavailable",
      detail: `C_Cpp.intelliSenseEngine=${inputs.intelliSenseEngine}; C Insight requires default for Microsoft semantic queries.`,
    };
  }
  if (inputs.conflicts.length > 0) {
    return {
      ...inputs,
      state: "ambiguous",
      detail: `Known active C/C++ Provider conflicts: ${inputs.conflicts.join(", ")}.`,
    };
  }
  return {
    ...inputs,
    state: "verified",
    detail:
      "Microsoft C/C++ is enabled and no known competing C/C++ Provider is active.",
  };
}
