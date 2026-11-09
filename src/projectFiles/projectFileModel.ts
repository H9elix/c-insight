export type ProjectFileSort = "name" | "path" | "type";

export interface ProjectFileEntry {
  uri: string;
  name: string;
  relativePath: string;
  rootName: string;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function projectFileSort(value: unknown): ProjectFileSort {
  return value === "path" || value === "type" ? value : "name";
}

export function projectFileLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1000, Math.min(200000, Math.floor(value))) : 50000;
}

export function isGitMetadata(relativePath: string): boolean {
  return relativePath.split("/").includes(".git");
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function sortProjectFiles(entries: readonly ProjectFileEntry[], order: ProjectFileSort): ProjectFileEntry[] {
  const path = (entry: ProjectFileEntry) => `${entry.rootName}/${entry.relativePath}`;
  return [...entries].sort((left, right) => {
    const primary = order === "path" ? collator.compare(path(left), path(right))
      : order === "type" ? collator.compare(extension(left.name), extension(right.name)) : 0;
    return primary || collator.compare(left.name, right.name) || collator.compare(path(left), path(right)) ||
      (left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0);
  });
}

/** Only a selected file is inspected; listing never opens documents or reads contents. */
export function isKnownBinaryFile(name: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|xz|7z|tar|bz2|o|a|so|dll|exe|bin|class|woff2?|ttf|mp[34]|sqlite|db)$/i.test(name);
}
