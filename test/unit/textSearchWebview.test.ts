import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Script } from "node:vm";
import { readFileSync } from "node:fs";
import { renderTextSearch } from "../../src/textSearch/textSearchWebview";
import type { textSearchLabels } from "../../src/textSearch/textSearchLabels";

describe("text search view isolation", () => {
  it("uses safe DOM text, scoped keyboard handlers and a valid nonce script", () => {
    const labels = new Proxy({}, {get: (_, key) => String(key)}) as ReturnType<typeof textSearchLabels>;
    const html = renderTextSearch("vscode-webview://test", "test-nonce", labels);
    assert.match(html, /script-src 'nonce-test-nonce'/);
    assert.doesNotMatch(html, /\.innerHTML\s*=/);
    assert(html.indexOf('id="query"') < html.indexOf('id="results"'));
    const script = /<script nonce="test-nonce">([\s\S]*?)<\/script>/.exec(html)?.[1]; assert(script);
    assert.doesNotThrow(() => new Script(script));
    assert.match(script, /event\.preventDefault\(\);event\.stopPropagation\(\)/);
    assert.doesNotMatch(script, /setTimeout|debounce/);
    assert.match(script, /key===renderKey/);
  });
  it("does not depend on semantic engines or expose arbitrary edit locations", () => {
    const source = readFileSync("src/textSearch/textSearchExplorer.ts", "utf8");
    assert.doesNotMatch(source, /AnalysisService|analysis\.|executeDefinitionProvider|findTextInFiles/);
    assert.match(source, /message\.revision !== this\.revision/);
    assert.doesNotMatch(source, /Uri\.parse\(message\./);
  });
});
