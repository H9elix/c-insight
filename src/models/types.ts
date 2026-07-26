import * as vscode from "vscode";
import type {
  CallHierarchyItem,
  DocumentSymbol,
  SymbolInformation,
} from "vscode-languageclient/node";

export type ClangdState =
  | "stopped"
  | "locating"
  | "starting"
  | "indexing"
  | "ready"
  | "restarting"
  | "failed";

export interface LocationResult {
  uri: vscode.Uri;
  range: vscode.Range;
}

export interface ReferenceGroup {
  uri: vscode.Uri;
  locations: LocationResult[];
}

export interface CallNode {
  key: string;
  raw: CallHierarchyItem;
  recursive?: boolean;
}

export type LspSymbol = DocumentSymbol | SymbolInformation;

export interface SymbolContext {
  uri: vscode.Uri;
  position: vscode.Position;
  generation: number;
  definitions: LocationResult[];
  declarations: LocationResult[];
  references: LocationResult[];
  callRoots: CallNode[];
  hover?: string;
  name?: string;
  qualifiedName?: string;
  symbolId?: string;
  incomingCount?: number;
  outgoingCount?: number;
  detailsPending?: boolean;
}

export interface ViewUpdateIntent {
  manualReferences?: boolean;
  manualCallHierarchy?: boolean;
}
