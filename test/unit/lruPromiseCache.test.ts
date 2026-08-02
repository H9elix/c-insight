import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LruPromiseCache } from "../../src/utils/lruPromiseCache";

describe("call hierarchy LRU request cache", () => {
  it("coalesces identical requests and counts hits", async () => {
    const cache = new LruPromiseCache<number>(2);
    let calls = 0;
    const first = cache.getOrCreate("a", async () => ++calls);
    const second = cache.getOrCreate("a", async () => ++calls);
    assert.equal(await first, 1);
    assert.equal(await second, 1);
    assert.equal(calls, 1);
    assert.equal(cache.hits, 1);
    assert.equal(cache.misses, 1);
  });

  it("evicts least-recently-used entries", async () => {
    const cache = new LruPromiseCache<number>(2);
    await cache.getOrCreate("a", async () => 1);
    await cache.getOrCreate("b", async () => 2);
    await cache.getOrCreate("a", async () => 3);
    await cache.getOrCreate("c", async () => 4);
    await cache.getOrCreate("b", async () => 5);
    assert.equal(cache.misses, 4);
  });

  it("does not retain failed requests", async () => {
    const cache = new LruPromiseCache<number>(2);
    await assert.rejects(cache.getOrCreate("a", async () => {
      throw new Error("failed");
    }));
    assert.equal(cache.size, 0);
  });

  it("trims immediately when resized", async () => {
    const cache = new LruPromiseCache<number>(3);
    await cache.getOrCreate("a", async () => 1);
    await cache.getOrCreate("b", async () => 2);
    cache.resize(1);
    assert.equal(cache.size, 1);
  });

  it("stays bounded across prolonged churn and repeated invalidation", async () => {
    const cache = new LruPromiseCache<number>(128);
    for (let index = 0; index < 100_000; index += 1) {
      await cache.getOrCreate(`entry-${index}`, async () => index);
      if (index > 0 && index % 10_000 === 0) cache.clear();
      assert.ok(cache.size <= 128);
    }
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.hits, 0);
    assert.equal(cache.misses, 0);
  });
});
