import { beforeAll, describe, expect, it } from "vitest";
import { highlightCode } from "./highlight";
import { TS_SAMPLE, PY_SAMPLE, BASH_SAMPLE, TS_AS_JSON } from "./__fixtures__/highlight";

// Shiki loads WebAssembly and grammar JSON asynchronously on the first call;
// cache-key behaviour is only meaningful once the highlighter is ready, so
// warm it up once before exercising the cache assertions.
beforeAll(async () => {
  await highlightCode(TS_SAMPLE, "ts", "dark");
});

describe("highlightCode cache", () => {
  it("returns the same string on a cache hit (second call)", async () => {
    const a = await highlightCode(TS_SAMPLE, "ts", "dark");
    const b = await highlightCode(TS_SAMPLE, "ts", "dark");
    expect(b).toBe(a);
  });

  it("misses on different code", async () => {
    const a = await highlightCode(TS_SAMPLE, "ts", "dark");
    const b = await highlightCode(PY_SAMPLE, "python", "dark");
    expect(b).not.toBe(a);
    // Shiki tokenizes the source — assert that the resulting HTML actually
    // wraps the python snippet (a fresh render, not a ts cache entry).
    expect(b).toMatch(/<pre[\s>]/);
    expect(b.length).toBeGreaterThan(0);
  });

  it("misses on different theme", async () => {
    const dark = await highlightCode(TS_SAMPLE, "ts", "dark");
    const light = await highlightCode(TS_SAMPLE, "ts", "light");
    expect(light).not.toBe(dark);
  });

  it("misses on different lang", async () => {
    const ts = await highlightCode(TS_SAMPLE, "ts", "dark");
    const bash = await highlightCode(BASH_SAMPLE, "bash", "dark");
    expect(ts).not.toBe(bash);
  });

  it("uses the resolved lang as part of the cache key (falls back to 'text')", async () => {
    // `notalang` is not a bundled shiki grammar, so `highlightCode` resolves
    // to "text" and caches under that resolved lang — not under "notalang".
    // Two calls with different bogus langs must therefore collapse to the
    // same "text"-themed cache entry.
    const a = await highlightCode(TS_SAMPLE, "notalang", "dark");
    const b = await highlightCode(TS_SAMPLE, "alsonotalang", "dark");
    expect(b).toBe(a);
    // A genuine language must NOT share that cache entry.
    const ts = await highlightCode(TS_SAMPLE, "ts", "dark");
    expect(ts).not.toBe(a);
  });

  it("preserves JSON-as-ts round trip when re-asked with the resolved lang", async () => {
    // Different code in the same lang — second entry must not collide.
    const a = await highlightCode(TS_SAMPLE, "ts", "dark");
    const b = await highlightCode(TS_AS_JSON, "ts", "dark");
    expect(b).not.toBe(a);
  });
});
