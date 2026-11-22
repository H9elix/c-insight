import { COMBINED_SLOTS, combinedLayout, isCombinedRole, type CombinedRole } from "../combined/combinedModel";
import { manifestLabel } from "../combined/combinedManifest";
import type { ViewId } from "../ids";

export interface ViewCatalogEntry {
  action: "view" | "combined" | "create" | "manage";
  label: string;
  description?: string;
  detail?: string;
  viewId?: ViewId;
  slot?: number;
}
export interface ViewCatalogLabels {
  purposes: Record<CombinedRole, string>;
  combined: (slot: number) => string;
  create: string;
  manage: string;
}
const ENGLISH_NAMES: Record<CombinedRole, string> = {
  context: "Context", preview: "Code Preview", references: "References", callers: "Callers", callees: "Callees",
  supertypes: "Supertypes", subtypes: "Subtypes", includes: "Includes", includedBy: "Included By",
  history: "Navigation History", bookmarks: "Bookmarks", workspaceSymbols: "Symbol Search",
  symbols: "Document Symbols", projectFiles: "Project Files", status: "Project Diagnostics",
};

/** A read-only UI inventory. It never opens documents, queries an engine or writes layouts. */
export function viewCatalog(
  views: ReadonlyArray<{id: string; name: unknown}>,
  slots: readonly unknown[],
  labels: ViewCatalogLabels,
): ViewCatalogEntry[] {
  const entries: ViewCatalogEntry[] = [];
  for (const view of views) {
    const role = view.id.replace(/^cInsight\./, "");
    if (!isCombinedRole(role) || view.id !== `cInsight.${role}`) continue;
    entries.push({action: "view", viewId: view.id as ViewId,
      label: manifestLabel(view.name, ENGLISH_NAMES[role]), description: ENGLISH_NAMES[role], detail: labels.purposes[role]});
  }
  for (const slot of COMBINED_SLOTS) {
    const layout = combinedLayout(slots[slot - 1]);
    if (layout.enabled) entries.push({action: "combined", slot, viewId: `cInsight.combined${slot}` as ViewId,
      label: layout.title || labels.combined(slot), description: labels.combined(slot)});
  }
  entries.push({action: "create", label: labels.create}, {action: "manage", label: labels.manage});
  return entries;
}
