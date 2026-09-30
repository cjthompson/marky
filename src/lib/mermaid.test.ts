import { beforeAll, describe, expect, it } from "vitest";
import { renderMermaidSource } from "./mermaid";
import { FLOWCHART, SEQUENCE, INVALID } from "./__fixtures__/mermaid";

// Mermaid is lazy-imported on first call, so warm the module once before
// timing-sensitive cache assertions.
beforeAll(async () => {
  await renderMermaidSource(FLOWCHART, "dark");
});

describe("renderMermaidSource cache", () => {
  it("returns the same string on a cache hit (second call)", async () => {
    const a = await renderMermaidSource(FLOWCHART, "dark");
    const b = await renderMermaidSource(FLOWCHART, "dark");
    expect(b).toBe(a);
  });

  it("misses on different source", async () => {
    const a = await renderMermaidSource(FLOWCHART, "dark");
    const b = await renderMermaidSource(SEQUENCE, "dark");
    expect(b).not.toBe(a);
  });

  it("misses on different theme", async () => {
    const dark = await renderMermaidSource(FLOWCHART, "dark");
    const light = await renderMermaidSource(FLOWCHART, "light");
    expect(light).not.toBe(dark);
  });

  it("caches the error-fallback markup (does not re-render an invalid diagram)", async () => {
    // First call: either an SVG (if mermaid's parser is permissive) or an
    // error-fallback string starting with "Mermaid render error:". Either
    // way, the second call must return the exact same string.
    const a = await renderMermaidSource(INVALID, "dark");
    const b = await renderMermaidSource(INVALID, "dark");
    expect(b).toBe(a);
  });
});
