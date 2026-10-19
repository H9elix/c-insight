import type { Position, Range } from "vscode-languageclient/node";

export interface MacroDefinitionLocation {
  uri: string;
  range: Range;
}

export interface MacroCallerScope {
  queryUri: string;
  queryPosition: Position;
  queryRange?: Range;
  name: string;
  expandedTargetName?: string;
  definitions: MacroDefinitionLocation[];
}

export interface MacroDefinitionDirective {
  name: string;
  startCharacter: number;
  endCharacter: number;
}

export function macroCallerScopeKey(scope: MacroCallerScope): string {
  return [
    scope.queryUri,
    scope.queryPosition.line,
    scope.queryPosition.character,
    scope.name,
    scope.expandedTargetName ?? "unresolved",
  ].join(":");
}

export function macroDefinitionName(sourceLine: string): string | undefined {
  return macroDefinitionDirective(sourceLine)?.name;
}

/** Require clangd's macro heading as well as its same-name definition text.
 * A random #define example in an ordinary symbol's documentation is not proof.
 */
export function hoverDefinesMacro(hover: string | undefined, name: string): boolean {
  const lines = hover?.trim().split(/\r?\n/) ?? [];
  const heading = /^(?:#{1,6}\s+)?macro\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*$/.exec(lines[0] ?? "");
  return heading?.[1] === name && lines.some(line => macroDefinitionName(line) === name);
}

/** A source-less macro is anchored at its use, never at an invented #define. */
export function macroCallerAnchor(scope: MacroCallerScope): MacroDefinitionLocation {
  return scope.definitions[0] ?? {
    uri: scope.queryUri,
    range: scope.queryRange ?? {
      start: scope.queryPosition,
      end: { ...scope.queryPosition, character: scope.queryPosition.character + scope.name.length },
    },
  };
}

export function macroDefinitionDirective(
  sourceLine: string,
): MacroDefinitionDirective | undefined {
  const match = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
    sourceLine,
  );
  if (!match) return undefined;
  const name = match[1];
  const startCharacter = match[0].length - name.length;
  return {
    name,
    startCharacter,
    endCharacter: startCharacter + name.length,
  };
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
