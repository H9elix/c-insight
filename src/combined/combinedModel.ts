/** Layout preferences only: no workspace URIs, source text or semantic nodes. */
export const COMBINED_ROLES = ["context", "preview", "references", "callers", "callees", "supertypes", "subtypes",
  "includes", "includedBy", "history", "bookmarks", "workspaceSymbols", "symbols", "projectFiles", "status", "textSearch"] as const;
export type CombinedRole = typeof COMBINED_ROLES[number];
export const COMBINED_SLOTS = [1, 2, 3, 4] as const;
export type CombinedSlot = typeof COMBINED_SLOTS[number];
export type CombinedHoverDirection = "forward" | "backward" | "both";
export interface CombinedLayout {
  enabled: boolean;
  title: string;
  direction: "horizontal" | "vertical";
  hoverDirections?: Partial<Record<CombinedRole, CombinedHoverDirection>>;
  hoverSizePercentages?: Partial<Record<CombinedRole, number>>;
  views: CombinedRole[];
  ratios: number[];
}
export const DEFAULT_COMBINED_LAYOUT: CombinedLayout = { enabled: false, title: "", direction: "horizontal", views: [], ratios: [] };
export interface CombinedHoverTiming { enterDelay: number; animationDuration: number; leaveDelay: number }
/** Also serialized into the browser, so defaults and runtime bounds stay identical. */
export function combinedHoverTiming(value?: unknown): CombinedHoverTiming {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const milliseconds = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value)
    ? Math.min(10000, Math.max(0, Math.trunc(value))) : fallback;
  return {enterDelay: milliseconds(data.enterDelay, 200), animationDuration: milliseconds(data.animationDuration, 200), leaveDelay: milliseconds(data.leaveDelay, 250)};
}
export function isCombinedRole(value: unknown): value is CombinedRole {
  return typeof value === "string" && (COMBINED_ROLES as readonly string[]).includes(value);
}
export function combinedLayout(value: unknown): CombinedLayout {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const views = Array.isArray(data.views) ? [...new Set(data.views.filter(isCombinedRole))] : [];
  const ratios = views.map((_, index) => Array.isArray(data.ratios) && typeof data.ratios[index] === "number" &&
    Number.isFinite(data.ratios[index]) && data.ratios[index] > 0 ? Math.min(1000, Math.max(0.001, data.ratios[index])) : 1);
  const sizes = data.hoverSizePercentages && typeof data.hoverSizePercentages === "object" && !Array.isArray(data.hoverSizePercentages)
    ? data.hoverSizePercentages as Record<string, unknown> : {};
  const hoverSizePercentages = Object.fromEntries(views.filter(role => Object.hasOwn(sizes, role) &&
    typeof sizes[role] === "number" && Number.isInteger(sizes[role]) && (sizes[role] as number) >= 1 && (sizes[role] as number) <= 100)
    .map(role => [role, sizes[role] as number]));
  const directions = data.hoverDirections && typeof data.hoverDirections === "object" && !Array.isArray(data.hoverDirections)
    ? data.hoverDirections as Record<string, unknown> : undefined;
  const legacy = data.hoverDirection === "forward" || data.hoverDirection === "both" ? data.hoverDirection : undefined;
  const hoverDirections = Object.fromEntries(views.flatMap(role => {
    const value = directions ? Object.hasOwn(directions, role) ? directions[role] : undefined : legacy;
    return value === "forward" || value === "backward" || value === "both" ? [[role, value]] : [];
  })) as Partial<Record<CombinedRole, CombinedHoverDirection>>;
  return { enabled: data.enabled === true, title: typeof data.title === "string" ? data.title.trim().slice(0, 80) : "",
    direction: data.direction === "vertical" ? "vertical" : "horizontal", views, ratios,
    ...(Object.keys(hoverDirections).length ? {hoverDirections} : {}),
    ...(Object.keys(hoverSizePercentages).length ? {hoverSizePercentages} : {}) };
}

/** Defaults follow visible order; explicit choices stay attached to pane identity. */
export function combinedPaneHoverDirection(layout: CombinedLayout, role: CombinedRole, expanded: readonly CombinedRole[] = layout.views): CombinedHoverDirection {
  return layout.hoverDirections?.[role] ?? (role === expanded[expanded.length - 1] ? "both" : "forward");
}

/** Shared by the host and browser. Excludes titles and unrelated toolbar updates. */
export function combinedLayoutRevision(layout: CombinedLayout): string {
  return JSON.stringify([layout.enabled, layout.direction, layout.views, layout.ratios,
    layout.views.map(role => layout.hoverSizePercentages?.[role] ?? null), layout.views.map(role => layout.hoverDirections?.[role] ?? null)]);
}

/** Insert a pane without changing identities or detaching its base weight. */
export function reorderCombinedPane(layout: CombinedLayout, source: string, target: string, side: "before" | "after"): CombinedLayout {
  const from = layout.views.indexOf(source as CombinedRole);
  if (!layout.enabled || from < 0 || source === target || !layout.views.includes(target as CombinedRole) || !["before", "after"].includes(side)) return layout;
  const entries = layout.views.map((role, index) => ({role, ratio: layout.ratios[index] ?? 1}));
  const [entry] = entries.splice(from, 1);
  const to = entries.findIndex(entry => entry.role === target) + (side === "after" ? 1 : 0);
  entries.splice(to, 0, entry);
  if (entries.every((entry, index) => entry.role === layout.views[index])) return layout;
  return {...layout, views: entries.map(entry => entry.role), ratios: entries.map(entry => entry.ratio)};
}

/** Pixel sizes with minimums. The caller scrolls the layout when total < count * minimum. */
export function combinedPaneSizes(total: number, ratios: readonly number[], minimum: number, hovered: number, percentage?: number): number[] {
  if (!ratios.length) return [];
  const available = Math.max(total, ratios.length * minimum);
  if (ratios.length > 1 && Number.isInteger(hovered) && hovered >= 0 && hovered < ratios.length &&
    typeof percentage === "number" && Number.isInteger(percentage) && percentage >= 1 && percentage <= 100) {
    const base = combinedPaneSizes(total, ratios, minimum, -1);
    const target = Math.min(available - (ratios.length - 1) * minimum, Math.max(base[hovered], total * percentage / 100));
    const others = combinedPaneSizes(available - target, ratios.filter((_, index) => index !== hovered), minimum, -1);
    return ratios.map((_, index) => index === hovered ? target : others[index < hovered ? index : index - 1]);
  }
  const weights = ratios.map((value, index) => Math.max(0.001, value) * (index === hovered && ratios.length > 1 ? 2 : 1));
  const sizes = weights.map(() => 0);
  const remaining = new Set(weights.map((_, index) => index));
  let budget = available;
  while (remaining.size) {
    const sum = [...remaining].reduce((sum, index) => sum + weights[index], 0);
    const constrained = [...remaining].filter(index => budget * weights[index] / sum < minimum);
    if (!constrained.length) {
      remaining.forEach(index => { sizes[index] = budget * weights[index] / sum; });
      break;
    }
    constrained.forEach(index => { sizes[index] = minimum; budget -= minimum; remaining.delete(index); });
  }
  return sizes;
}

/** Grow from a visible snapshot, borrowing one side only and fixing the opposite edge. */
export function combinedOneWaySizes(current: readonly number[], minimum: number, hovered: number, target: number, direction: "forward" | "backward" = "forward"): number[] {
  const sizes = [...current];
  if (!Number.isInteger(hovered) || hovered < 0 || hovered >= sizes.length || !Number.isFinite(target)) return sizes;
  const slack = sizes.map((size, index) => (direction === "backward" ? index < hovered : index > hovered) ? Math.max(0, size - minimum) : 0);
  const available = slack.reduce((sum, value) => sum + value, 0);
  const growth = Math.min(Math.max(0, target - sizes[hovered]), available);
  if (!growth || !available) return sizes;
  sizes[hovered] += growth;
  slack.forEach((value, index) => { if (value) sizes[index] -= growth * value / available; });
  return sizes;
}

export const combinedForwardSizes = combinedOneWaySizes;

/** Interpret only the known simple clauses in this extension's own view/title menus. */
export function matchesPaneCondition(when: string, view: string, flags: Readonly<Record<string, boolean>>): boolean {
  return when.split(/\s+\|\|\s+/).some(or => or.split(/\s+&&\s+/).every(raw => {
    const term = raw.trim();
    const equal = /^view == ([\w.]+)$/.exec(term);
    if (equal) return view === equal[1];
    const pattern = /^view =~ \/(.+)\/$/.exec(term);
    if (pattern) return new RegExp(pattern[1]).test(view);
    const flag = /^(!?)(cInsight\.[\w.]+)$/.exec(term);
    return !!flag && Object.hasOwn(flags, flag[2]) && (flag[1] ? !flags[flag[2]] : flags[flag[2]]);
  }));
}
