import assert from "node:assert/strict";
import * as vscode from "vscode";
import { verifyCombinedViewportFollow } from "./combinedViewportFollow";

/** Focused UI regression: cached lists need no source files or running analysis engine. */
export async function run():Promise<void>{
  const config=vscode.workspace.getConfiguration("cInsight");
  await config.update("followCursor",false,vscode.ConfigurationTarget.Global);
  await config.update("session.restore",false,vscode.ConfigurationTarget.Global);
  const extension=vscode.extensions.getExtension("H9elix.c-insight");assert(extension);
  await extension.activate();
  const requestCount=async()=>{
    const value=await vscode.commands.executeCommand<{scheduler:{submitted:number}}>("cInsight.test.navigationState");
    assert(value);return value.scheduler.submitted;
  };
  await verifyCombinedViewportFollow(requestCount);
  console.log(`Focused viewport follow regression passed (VS Code ${vscode.version}).`);
}
