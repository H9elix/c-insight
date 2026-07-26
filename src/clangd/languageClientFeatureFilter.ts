const EXECUTE_COMMAND_METHOD = "workspace/executeCommand";

interface FeatureWithRegistrationType {
  registrationType?: {
    method?: string;
  };
}

export function shouldRegisterLanguageClientFeature(feature: unknown): boolean {
  const method = (feature as FeatureWithRegistrationType)?.registrationType
    ?.method;
  return method !== EXECUTE_COMMAND_METHOD;
}
