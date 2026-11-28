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
    assert.match(script, /rendered\.get\(entry\.key\)/);
    assert.match(script, /row\.match!==match/);
    assert.equal(script.match(/details\.addEventListener\('toggle'/g)?.length, 1);
    assert.doesNotMatch(script, /results\.replaceChildren/);
  });
  it("does not depend on semantic engines or expose arbitrary edit locations", () => {
    const source = readFileSync("src/textSearch/textSearchExplorer.ts", "utf8");
    assert.doesNotMatch(source, /AnalysisService|analysis\.|executeDefinitionProvider|findTextInFiles/);
    assert.match(source, /message\.revision !== this\.revision/);
    assert.doesNotMatch(source, /Uri\.parse\(message\./);
  });
  it("places scope and filters above the adjacent search and replacement inputs", () => {
    const labels = new Proxy({}, {get: (_, key) => String(key)}) as ReturnType<typeof textSearchLabels>;
    const html = renderTextSearch("vscode-webview://test", "test-nonce", labels);
    const markers = ['class="row scope-row"', 'id="filterSummary"', 'id="filterArea"', 'class="row query-row"', 'id="replaceArea"'];
    const positions = markers.map(marker => html.indexOf(marker));
    assert(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
    const between = html.slice(positions[3], positions[4]);
    assert.doesNotMatch(between, /id="(?:scope|filterSummary|filterArea)"/);
  });
  it("keeps a single results-window entry above the list without a bottom control", () => {
    const labels = new Proxy({}, {get: (_, key) => String(key)}) as ReturnType<typeof textSearchLabels>;
    for (const readOnly of [false, true]) {
      const html = renderTextSearch("vscode-webview://test", "test-nonce", labels, readOnly);
      assert.equal(html.match(/id="openResultsTop"/g)?.length, 1);
      assert.equal(html.match(/class="result-actions"/g)?.length, 1);
      assert(html.indexOf('id="openResultsTop"') < html.indexOf('id="results"'));
      assert.doesNotMatch(html, /openResultsBottom/);
      assert.match(html, /\$\('openResultsTop'\)\.onclick=\(\)=>send\('openResults'\)/);
    }
  });
  it("uses the concise results-window label in both languages and the command palette", () => {
    const english = JSON.parse(readFileSync("l10n/bundle.l10n.json", "utf8")), chinese = JSON.parse(readFileSync("l10n/bundle.l10n.zh-cn.json", "utf8"));
    assert.equal(english["Open results window"], "Open results window");
    assert.equal(chinese["Open results window"], "打开结果窗口");
    assert(!("Open large results window" in english)); assert(!("Open large results window" in chinese));
    assert.equal(JSON.parse(readFileSync("package.nls.json", "utf8"))["command.cInsight.textSearch.openResults.title"], "C Insight: Open Results Window");
    assert.equal(JSON.parse(readFileSync("package.nls.zh-cn.json", "utf8"))["command.cInsight.textSearch.openResults.title"], "C Insight: 打开结果窗口");
  });
});
