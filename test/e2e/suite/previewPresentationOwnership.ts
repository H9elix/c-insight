import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AnalysisService } from "../../../src/analysis/analysisService";
import { NavigationHistoryExplorer } from "../../../src/history/navigationHistoryExplorer";
import type { LocationResult } from "../../../src/models/types";
import { CodePreviewProvider } from "../../../src/views/codePreviewProvider";
import { EmbeddedView } from "../../../src/combined/embeddedView";

/** Real provider/controller objects with a controlled delayed definition, without changing the live engine. */
export async function verifyPreviewPresentationOwnership(uri: vscode.Uri): Promise<void> {
  let resolveDefinition: (locations: LocationResult[]) => void = () => assert.fail("No definition request");
  let token: vscode.CancellationToken | undefined;
  const analysis = {definition: (_uri: vscode.Uri, _position: vscode.Position, cancellation: vscode.CancellationToken) => {
    token = cancellation;
    return new Promise<LocationResult[]>(resolve => { resolveDefinition = resolve; });
  }} as unknown as AnalysisService;
  const history = new NavigationHistoryExplorer();
  const preview = new CodePreviewProvider(analysis, history);
  const parent = {webview:{cspSource:"vscode-webview://test",asWebviewUri:(value:vscode.Uri)=>value},show:()=>undefined} as unknown as vscode.WebviewView;
  const surface = () => {
    const view = new EmbeddedView("cInsight.preview",parent,"Preview",()=>undefined,async()=>true);
    view.setVisible(true);return view;
  };
  const root = surface();preview.resolveWebviewView(root);
  const at = (line:number): LocationResult => ({uri,range:new vscode.Range(line,0,line,3)});
  try {
    await preview.showLocation(at(2),"definition","first");
    const pending = preview.followDefinition(new vscode.Position(2,5));
    assert(token);
    await preview.showLocation(at(6),"definition","explicit");
    assert(token.isCancellationRequested,"A newer explicit target must cancel a pending definition");
    resolveDefinition([at(2)]);await pending;
    assert.equal(preview.sessionState()?.range.start.line,6);

    const child = surface();preview.createPresentation(child);
    await preview.showLocation(at(2),"definition","child source");
    token=undefined;
    child.webview.receiveMessage({type:"previewDefinition",line:2,character:5});
    assert(token,"The embedded presentation did not start its own definition action");
    child.dispose();
    assert((token as vscode.CancellationToken).isCancellationRequested,"Removing the request owner must cancel its definition");
    resolveDefinition([at(6)]);await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(preview.sessionState()?.range.start.line,2);

    const unrelated = surface();preview.createPresentation(unrelated);
    await preview.showLocation(at(2),"definition","root source");
    const ownedByRoot=preview.followDefinition(new vscode.Position(2,5));
    unrelated.dispose();
    assert(!(token as vscode.CancellationToken).isCancellationRequested,"Removing another presentation must not cancel the active owner");
    resolveDefinition([at(6)]);await ownedByRoot;
    assert.equal(preview.sessionState()?.range.start.line,6);
    const editable=await vscode.workspace.openTextDocument({language:"plaintext",content:"int sample;\n// original_context\n"});
    await preview.showLocation({uri:editable.uri,range:new vscode.Range(0,0,0,0)},"reference","editable");
    root.setVisible(false);
    const edit=new vscode.WorkspaceEdit();edit.replace(editable.uri,new vscode.Range(1,0,1,19),"// changed_context");
    assert(await vscode.workspace.applyEdit(edit));
    preview.handleDocumentChange({document:editable,contentChanges:[],reason:undefined});
    root.setVisible(true);
    const until=Date.now()+3000;
    while(!root.webview.html.includes("changed_context")&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
    assert(root.webview.html.includes("changed_context"),"A hidden presentation must render the current document version when shown again");
    console.log("PREVIEW_PRESENTATIONS: shared definition ownership, explicit supersession and scoped disposal passed.");
  } finally { root.dispose();preview.dispose();history.dispose(); }
}
