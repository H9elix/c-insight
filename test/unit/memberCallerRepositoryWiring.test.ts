import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const repositorySource = readFileSync(
  join(process.cwd(), "src", "callHierarchy", "callHierarchyRepository.ts"),
  "utf8",
);

describe("member caller repository wiring", () => {
  it("classifies candidate source without opening VS Code documents", () => {
    const classification = repositorySource.slice(
      repositorySource.indexOf("private async classifyMemberIncomingCalls"),
      repositorySource.indexOf("private async observedMicrosoftOutgoing"),
    );
    assert.doesNotMatch(classification, /openTextDocument/);
    assert.match(classification, /readSourceText/);
    assert.match(classification, /remainingDefinitionFallbacks = 16/);
    assert.match(repositorySource, /vscode\.workspace\.fs\.readFile\(parsed\)/);
  });

  it("keeps selected, other, and unresolved member results", () => {
    assert.match(
      repositorySource,
      /\.\.\.memberScope\.sameVariable,[\s\S]*\.\.\.memberScope\.otherVariable,[\s\S]*\.\.\.memberScope\.unresolvedVariable/,
    );
  });

  it("bypasses all member classification work for clangd by default", () => {
    assert.match(
      repositorySource,
      /get<boolean>\("classifyMemberCallers", false\)/,
    );
    assert.match(
      repositorySource,
      /!classifyMemberCallers &&[\s\S]*analysisEngine !== "microsoft"[\s\S]*return this\.analysis\.prepareCallHierarchy/,
    );
    assert.match(
      repositorySource,
      /if \(!classifyMemberCallers\) \{\s*return roots;\s*\}[\s\S]*const memberRoots/,
    );
    assert.match(
      repositorySource,
      /if \(!this\.classifyMemberCallers\(\) \|\| !node\.memberCallerScope\) \{\s*return \{ calls \};/,
    );
  });
});
