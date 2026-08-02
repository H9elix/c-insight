import { SymbolKind } from "vscode-languageserver-protocol";

const ICONS: Partial<Record<SymbolKind, string>> = {
  [SymbolKind.File]: "symbol-file",
  [SymbolKind.Module]: "symbol-module",
  [SymbolKind.Namespace]: "symbol-namespace",
  [SymbolKind.Package]: "symbol-package",
  [SymbolKind.Class]: "symbol-class",
  [SymbolKind.Method]: "symbol-method",
  [SymbolKind.Property]: "symbol-property",
  [SymbolKind.Field]: "symbol-field",
  [SymbolKind.Constructor]: "symbol-constructor",
  [SymbolKind.Enum]: "symbol-enum",
  [SymbolKind.Interface]: "symbol-interface",
  [SymbolKind.Function]: "symbol-function",
  [SymbolKind.Variable]: "symbol-variable",
  [SymbolKind.Constant]: "symbol-constant",
  [SymbolKind.String]: "symbol-string",
  [SymbolKind.Number]: "symbol-number",
  [SymbolKind.Boolean]: "symbol-boolean",
  [SymbolKind.Array]: "symbol-array",
  [SymbolKind.Object]: "symbol-object",
  [SymbolKind.Key]: "symbol-key",
  [SymbolKind.Null]: "symbol-null",
  [SymbolKind.EnumMember]: "symbol-enum-member",
  [SymbolKind.Struct]: "symbol-struct",
  [SymbolKind.Event]: "symbol-event",
  [SymbolKind.Operator]: "symbol-operator",
  [SymbolKind.TypeParameter]: "symbol-type-parameter",
};

export function symbolKindIconId(kind: number): string {
  return ICONS[kind as SymbolKind] ?? "symbol-misc";
}
