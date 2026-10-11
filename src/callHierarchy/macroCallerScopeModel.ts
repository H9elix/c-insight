import type { Position, Range } from "vscode-languageclient/node";

export interface MacroDefinitionLocation {
  uri: string;
  range: Range;
}

export interface MacroCallerScope {
  queryUri: string;
  queryPosition: Position;
  name: string;
  expandedTargetName: string;
  definitions: MacroDefinitionLocation[];
}

export function macroCallerScopeKey(scope: MacroCallerScope): string {
  return [
    scope.queryUri,
    scope.queryPosition.line,
    scope.queryPosition.character,
    scope.name,
    scope.expandedTargetName,
  ].join(":");
}

export function macroDefinitionName(sourceLine: string): string | undefined {
  return /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
    sourceLine,
  )?.[1];
}

export function sourceLineAt(source: string, line: number): string | undefined {
  if (line < 0) return undefined;
  return source.split(/\r?\n/)[line];
}

export function isMacroDefinitionLocation(
  scope: MacroCallerScope,
  uri: string,
  position: Position,
): boolean {
  return scope.definitions.some(
    (definition) =>
      definition.uri === uri &&
      definition.range.start.line === position.line &&
      definition.range.start.character === position.character,
  );
}
