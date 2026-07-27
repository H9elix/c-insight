export interface NavigationVisibility {
  context: boolean;
  preview: boolean;
  references: boolean;
  callers: boolean;
  callees: boolean;
}

export interface CursorQueryDemand {
  active: boolean;
  definitions: boolean;
  declarations: boolean;
  callRoots: boolean;
  hover: boolean;
  symbolInfo: boolean;
  references: boolean;
  incomingCount: boolean;
  outgoingCount: boolean;
}

export function cursorQueryDemand(
  visibility: NavigationVisibility,
): CursorQueryDemand {
  const active = Object.values(visibility).some(Boolean);
  return {
    active,
    definitions:
      visibility.context ||
      visibility.preview ||
      visibility.references,
    declarations: visibility.context || visibility.references,
    callRoots:
      visibility.context ||
      visibility.references ||
      visibility.callers ||
      visibility.callees,
    hover: visibility.context,
    symbolInfo: visibility.context,
    references: visibility.references,
    incomingCount: visibility.context && visibility.callers,
    outgoingCount: visibility.context && visibility.callees,
  };
}
