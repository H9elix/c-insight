export function shouldUpdatePinnedView(
  pinned: boolean,
  manual: boolean | undefined,
): boolean {
  return !pinned || manual === true;
}
