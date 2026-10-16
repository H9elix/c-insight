/** Presentation-only tree state. Loading a branch is explicit; activation never loads it. */
export interface ResultTreeDescription {
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  iconColor?: string;
  highlights?: readonly (readonly [number, number])[];
  expandable: boolean;
  initiallyExpanded: boolean;
  navigable: boolean;
  actionable: boolean;
  resolutionToken?: number;
}

export interface ResultTreeRow<T> extends ResultTreeDescription {
  id: string;
  node: T;
  parent?: string;
  depth: number;
  position: number;
  siblings: number;
  expanded: boolean;
  loading?: boolean;
  error?: string;
}

export interface ResultTreeSource<T> {
  roots(): readonly T[];
  describe(node: T): ResultTreeDescription;
  children(node: T): Promise<readonly T[]>;
  parent(node: T): T | undefined;
}

export class ResultTreeModel<T extends object> {
  private revision = 0;
  private rows: ResultTreeRow<T>[] = [];
  private byId = new Map<string, ResultTreeRow<T>>();
  private readonly expansion = new Map<string, { expanded: boolean; initial: boolean }>();
  private readonly listeners = new Set<() => void>();
  private readonly expansionListeners = new Set<(node: T, expanded: boolean) => void>();

  constructor(private readonly source: ResultTreeSource<T>) {}

  onChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onExpansion(listener: (node: T, expanded: boolean) => void): { dispose(): void } {
    this.expansionListeners.add(listener);
    return { dispose: () => this.expansionListeners.delete(listener) };
  }

  snapshot(): readonly ResultTreeRow<T>[] { return this.rows; }

  row(id: string): ResultTreeRow<T> | undefined {
    return this.byId.get(id);
  }

  async refresh(collapseNewBranches = false): Promise<void> {
    const revision = ++this.revision;
    const next: ResultTreeRow<T>[] = [];
    const visit = async (nodes: readonly T[], parent?: string, depth = 0): Promise<void> => {
      const occurrences = new Map<string, number>();
      for (let index = 0; index < nodes.length && revision === this.revision; index++) {
        const node = nodes[index];
        const description = this.source.describe(node);
        const ordinal = occurrences.get(description.key) ?? 0;
        occurrences.set(description.key, ordinal + 1);
        const id = `${parent ?? ""}/${encodeURIComponent(description.key)}:${ordinal}`;
        const previous = this.expansion.get(id);
        const expanded = description.expandable && !collapseNewBranches && (
          previous?.initial === description.initiallyExpanded
            ? previous.expanded : description.initiallyExpanded
        );
        this.expansion.set(id, { expanded, initial: description.initiallyExpanded });
        const row: ResultTreeRow<T> = {
          ...description, id, node, parent, depth,
          position: index + 1, siblings: nodes.length, expanded,
        };
        next.push(row);
        if (expanded && depth < 100) {
          try {
            const children = await this.source.children(node);
            if (revision !== this.revision) return;
            await visit(children, id, depth + 1);
          } catch (error) {
            row.error = String(error);
          }
        }
      }
    };
    await visit(this.source.roots());
    if (revision !== this.revision) return;
    this.rows = next;
    this.byId = new Map(next.map((row) => [row.id, row]));
    // Retain collapsed descendants for subsequent re-expansion, but discard old roots.
    const roots = new Set(next.filter((row) => !row.parent).map((row) => row.id));
    for (const id of this.expansion.keys()) {
      const separator = id.indexOf("/", 1);
      const root = separator < 0 ? id : id.slice(0, separator);
      if (!roots.has(root)) {
        this.expansion.delete(id);
      }
    }
    if (this.expansion.size > 100_000) {
      const visible = new Set(next.map((row) => row.id));
      for (const id of this.expansion.keys()) if (!visible.has(id)) this.expansion.delete(id);
    }
    this.changed();
  }

  async setExpanded(id: string, expanded: boolean): Promise<void> {
    const row = this.row(id);
    if (!row?.expandable || row.expanded === expanded) return;
    this.expansion.set(id, { expanded, initial: row.initiallyExpanded });
    row.expanded = expanded;
    row.loading = expanded;
    if (!expanded) {
      this.rows = this.rows.filter((candidate) => !candidate.id.startsWith(`${id}/`));
      this.byId = new Map(this.rows.map((candidate) => [candidate.id, candidate]));
    }
    for (const listener of this.expansionListeners) listener(row.node, expanded);
    this.changed();
    await this.refresh();
  }

  async collapseAll(): Promise<void> {
    for (const state of this.expansion.values()) state.expanded = false;
    for (const row of this.rows) {
      if (row.expanded) {
        row.expanded = false;
        for (const listener of this.expansionListeners) listener(row.node, false);
      }
    }
    await this.refresh(true);
  }

  async reveal(node: T, depth = 0): Promise<string | undefined> {
    const ancestors: T[] = [];
    const seen = new Set<T>([node]);
    let parent = this.source.parent(node);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      ancestors.unshift(parent);
      parent = this.source.parent(parent);
    }
    await this.refresh();
    for (const ancestor of ancestors) {
      const row = this.rows.find((candidate) => candidate.node === ancestor);
      if (row) await this.setExpanded(row.id, true);
    }
    const row = this.rows.find((candidate) => candidate.node === node);
    if (!row) return undefined;
    if (depth > 0) await this.expandToDepth(row.id, Math.min(100, depth));
    return row.id;
  }

  dispose(): void {
    this.revision++;
    this.rows = [];
    this.byId.clear();
    this.expansion.clear();
    this.listeners.clear();
    this.expansionListeners.clear();
  }

  private async expandToDepth(id: string, depth: number): Promise<void> {
    await this.setExpanded(id, true);
    if (depth <= 1) return;
    const children = this.rows.filter((row) => row.parent === id && row.expandable);
    for (const child of children) await this.expandToDepth(child.id, depth - 1);
  }

  private changed(): void { for (const listener of this.listeners) listener(); }
}
