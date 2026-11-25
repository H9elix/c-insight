import type { SearchFile } from "./workspaceSearch";

export interface SearchPresentationCursor { generation: number; limit: number; files: Map<string, SearchFile>; checked: Set<string>; selections: Map<string, number> }
export function searchPresentationDelta(files: readonly SearchFile[], checked: ReadonlySet<string>, generation: number, previous?: SearchPresentationCursor, limit = Infinity) {
  const reset = !previous || previous.generation !== generation || previous.limit !== limit;
  let available = limit;
  const visible: SearchFile[] = [], counts = new Map<string, number>();
  for (const file of files) {
    if (available <= 0) break;
    visible.push(file); const count = Math.min(file.matches.length, available); counts.set(file.id, count); available -= count;
  }
  const current = new Map(visible.map(file => [file.id, file]));
  const selections = new Map(visible.map(file => [file.id, file.matches.reduce((count, match) => count + Number(checked.has(match.id)), 0)]));
  const changed = visible.filter(file => reset || previous.files.get(file.id) !== file || previous.selections.get(file.id) !== selections.get(file.id));
  const count = (file: SearchFile): number => counts.get(file.id)!;
  const visibleChecked = new Set<string>();
  for (const file of visible) for (const match of file.matches.slice(0, count(file))) if (checked.has(match.id)) visibleChecked.add(match.id);
  return {
    reset,
    files: changed.map(file => ({id: file.id, label: file.label, totalMatches: file.matches.length, checkedMatches: selections.get(file.id), matches: file.matches.slice(0, count(file)).map(match => ({id: match.id,
      line: match.line, character: match.character, snippet: match.snippet, highlightStart: match.highlightStart, highlightEnd: match.highlightEnd}))})),
    removed: reset ? [] : [...previous.files.keys()].filter(id => !current.has(id)),
    checkedAdded: [...visibleChecked].filter(id => reset || !previous.checked.has(id)),
    checkedRemoved: reset ? [] : [...previous.checked].filter(id => !visibleChecked.has(id)),
    shown: Math.min(limit, files.reduce((sum, file) => sum + file.matches.length, 0)), hiddenChecked: checked.size - visibleChecked.size,
    cursor: {generation, limit, files: current, checked: visibleChecked, selections},
  };
}
