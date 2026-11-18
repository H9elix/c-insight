export interface ResultTreeFollowState {
  locked: boolean;
  visible: boolean;
  windowFocused: boolean;
  viewFocused: boolean;
  interacting: boolean;
  opening: boolean;
  hasTarget: boolean;
  followEnabled: boolean;
  opened: boolean;
}

/** Highlighting stays independent of automatic filter clearing and scrolling. */
export function resultTreeFollowAction(state: ResultTreeFollowState): {
  clear: "always" | "ifHidden"; reveal: boolean;
} | undefined {
  if (state.locked || !state.visible || !state.windowFocused || state.viewFocused ||
    state.interacting || state.opening || !state.hasTarget) return undefined;
  if (!state.opened && !state.followEnabled) return undefined;
  return { clear: state.opened ? "always" : "ifHidden", reveal: state.followEnabled };
}
