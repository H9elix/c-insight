import type { SearchFile } from "./workspaceSearch";

export interface SearchPresentationCursor { generation: number; files: Map<string, SearchFile>; checked: Set<string> }
export function searchPresentationDelta(files: readonly SearchFile[], checked: ReadonlySet<string>, generation: number, previous?: SearchPresentationCursor) {
  const reset = !previous || previous.generation !== generation;
  const changed = files.filter(file => reset || previous.files.get(file.id) !== file);
  const current = new Map(files.map(file => [file.id, file]));
  return {
    reset,
    files: changed.map(file => ({id: file.id, label: file.label, matches: file.matches.map(match => ({id: match.id,
      line: match.line, character: match.character, snippet: match.snippet, highlightStart: match.highlightStart, highlightEnd: match.highlightEnd}))})),
    removed: reset ? [] : [...previous.files.keys()].filter(id => !current.has(id)),
    checkedAdded: [...checked].filter(id => reset || !previous.checked.has(id)),
    checkedRemoved: reset ? [] : [...previous.checked].filter(id => !checked.has(id)),
    cursor: {generation, files: current, checked: new Set(checked)},
  };
}
