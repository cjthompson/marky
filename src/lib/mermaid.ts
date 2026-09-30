let initialized = false;
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// Module-level render cache. Keyed by `mermaid|${theme}|${source}` so that
// a viewer re-render of the same diagram returns synchronously and skips the
// re-render. Error fallbacks are cached too — re-trying a broken diagram
// every commit is wasteful.
const renderCache = new Map<string, string>();

function cacheKey(theme: "light" | "dark", source: string) {
  return `mermaid|${theme}|${source}`;
}

/**
 * Render one mermaid source string to an SVG fragment (or error-fallback
 * markup) for the given theme. Pure — no DOM access, no block walking.
 * Caches by `(theme, source)`.
 */
export async function renderMermaidSource(
  source: string,
  theme: "light" | "dark"
): Promise<string> {
  const key = cacheKey(theme, source);
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  const mermaid = await loadMermaid();
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default" });
    initialized = true;
  } else {
    mermaid.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default" });
  }
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let out: string;
  try {
    const { svg } = await mermaid.render(id, source);
    out = svg;
  } catch (err) {
    out = `Mermaid render error: ${(err as Error).message}`;
  }
  renderCache.set(key, out);
  return out;
}

/**
 * Walk every `pre.mermaid-pending` under `root` and replace it with the
 * rendered diagram. Each replacement goes through the render cache first;
 * a cache hit returns synchronously and skips the `replaceWith` flicker.
 * `data-source-map` is preserved across cache hits.
 */
export async function renderMermaidBlocks(root: HTMLElement, theme: "light" | "dark") {
  const blocks = root.querySelectorAll<HTMLPreElement>("pre.mermaid-pending");
  if (blocks.length === 0) return;

  let i = 0;
  for (const pre of Array.from(blocks)) {
    const source = pre.textContent || "";
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-block";
    const inner = await renderMermaidSource(source, theme);
    wrapper.innerHTML = inner;
    // Preserve source map attribute through mermaid replacement.
    const sourceMap = pre.getAttribute("data-source-map");
    if (sourceMap) wrapper.setAttribute("data-source-map", sourceMap);
    pre.replaceWith(wrapper);
    i++;
  }
}
