export function sessionAfterPanelDispose<T>(
  state: T | undefined,
  extensionDisposing: boolean,
): T | undefined {
  return extensionDisposing ? state : undefined;
}
