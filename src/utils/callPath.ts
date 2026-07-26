export interface CallPathSearchOptions<T> {
  roots: T[];
  key: (node: T) => string;
  label: (node: T) => string;
  target: string;
  neighbors: (node: T) => Promise<T[]>;
  maximumDepth: number;
  maximumPaths: number;
  maximumVisitedNodes: number;
  isCancelled?: () => boolean;
}

export interface CallPathSearchResult<T> {
  paths: T[][];
  visitedNodes: number;
  truncated: boolean;
}

export async function findCallPaths<T>(
  options: CallPathSearchOptions<T>,
): Promise<CallPathSearchResult<T>> {
  const paths: T[][] = [];
  const target = options.target.toLocaleLowerCase();
  let visitedNodes = 0;
  let truncated = false;

  const visit = async (
    node: T,
    path: T[],
    pathKeys: Set<string>,
  ): Promise<void> => {
    if (
      options.isCancelled?.() ||
      paths.length >= options.maximumPaths ||
      visitedNodes >= options.maximumVisitedNodes
    ) {
      truncated =
        paths.length >= options.maximumPaths ||
        visitedNodes >= options.maximumVisitedNodes;
      return;
    }
    visitedNodes += 1;
    const nextPath = [...path, node];
    if (options.label(node).toLocaleLowerCase().includes(target)) {
      paths.push(nextPath);
      if (paths.length >= options.maximumPaths) {
        truncated = true;
      }
      return;
    }
    if (nextPath.length - 1 >= options.maximumDepth) {
      return;
    }
    const nodeKey = options.key(node);
    const lineage = new Set(pathKeys);
    lineage.add(nodeKey);
    const neighbors = await options.neighbors(node);
    for (const neighbor of neighbors) {
      if (options.isCancelled?.()) {
        return;
      }
      if (lineage.has(options.key(neighbor))) {
        continue;
      }
      await visit(neighbor, nextPath, lineage);
      if (
        paths.length >= options.maximumPaths ||
        visitedNodes >= options.maximumVisitedNodes
      ) {
        return;
      }
    }
  };

  for (const root of options.roots) {
    await visit(root, [], new Set());
    if (
      options.isCancelled?.() ||
      paths.length >= options.maximumPaths ||
      visitedNodes >= options.maximumVisitedNodes
    ) {
      break;
    }
  }
  return { paths, visitedNodes, truncated };
}
