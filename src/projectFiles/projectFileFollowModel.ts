export interface ProjectFileFollowState {
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

/** Highlighting is independent; this policy controls only automatic filter/scroll actions. */
export function projectFileFollowAction(state: ProjectFileFollowState): {
  clear: "always" | "ifHidden"; reveal: boolean;
} | undefined {
  if (state.locked || !state.visible || !state.windowFocused || state.viewFocused ||
    state.interacting || state.opening || !state.hasTarget) return undefined;
  if (!state.opened && !state.followEnabled) return undefined;
  return { clear: state.opened ? "always" : "ifHidden", reveal: state.followEnabled };
}
