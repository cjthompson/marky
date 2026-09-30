/**
 * Source-level helpers for edit mode.
 *
 * These operate on the markdown string (no DOM) or on DOM nodes that the
 * Viewer already stamps with `data-source-map` during rendering.
 */

/** Detect the line ending style of `source`. Defaults to LF when none present. */
export function detectEol(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Replace the lines `start..end` (1-based, inclusive on both ends) in
 * `source` with `text`. `text` is treated as a complete block; its own
 * line endings are preserved as-is.
 *
 * Edge cases:
 *   - replacing the first line keeps leading content intact
 *   - replacing the last line keeps trailing content (and any trailing
 *     newline) intact
 *   - if the original trailing newline is absent, the result is also
 *     missing the trailing newline
 */
export function replaceLines(
  source: string,
  start: number,
  end: number,
  text: string,
  eol: "\n" | "\r\n" = "\n",
): string {
  const lines = splitLines(source, eol);
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  const replacement = text === "" ? [] : splitLines(text, eol);
  const merged = [...before, ...replacement, ...after];
  const trailingNewline = endsWithNewline(source, eol);
  const joined = merged.join(eol);
  return trailingNewline ? joined + eol : joined;
}

/**
 * Split `source` into lines without preserving the trailing newline. An
 * empty trailing line is preserved when the source ends with \n.
 */
export function splitLines(source: string, eol: "\n" | "\r\n" = "\n"): string[] {
  if (source.length === 0) return [];
  const trailing = endsWithNewline(source, eol);
  const body = trailing ? source.slice(0, -eol.length) : source;
  return body.split(eol);
}

function endsWithNewline(source: string, eol: "\n" | "\r\n"): boolean {
  return source.endsWith(eol);
}

/**
 * Parse `data-source-map="start,end"` into `[start, end]` numbers, or
 * null if the attribute is absent or malformed.
 */
export function parseSourceMap(value: string | null): [number, number] | null {
  if (!value) return null;
  const [a, b] = value.split(",").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

/**
 * Find the deepest element under `target` that has a parseable
 * `data-source-map`. Returns the element together with its line range.
 *
 * Granularity rules:
 *   - any element inside a `<table>` resolves to the whole table (the
 *     table's own data-source-map)
 *   - code, mermaid, and `<pre>` blocks resolve to the whole fence
 *   - otherwise: the innermost element with the attribute wins
 */
export function findEditableBlock(target: HTMLElement): {
  element: HTMLElement;
  start: number;
  end: number;
} | null {
  let cursor: HTMLElement | null = target as HTMLElement;
  let found: HTMLElement | null = null;
  while (cursor) {
    const map = parseSourceMap(cursor.getAttribute("data-source-map"));
    if (map) {
      found = cursor;
      break;
    }
    cursor = cursor.parentElement;
  }
  if (!found) return null;

  // Promote to the whole table if inside one.
  const table = found.closest("table");
  if (table) {
    const tableMap = parseSourceMap(table.getAttribute("data-source-map"));
    if (tableMap) {
      return { element: table as HTMLElement, ...spreadRange(tableMap) };
    }
  }

  // Promote to the whole fence for code/mermaid/pre.
  const tag = found.tagName.toLowerCase();
  if (tag === "pre" || tag === "code") {
    const fence = found.closest("pre");
    if (fence) {
      const fenceMap = parseSourceMap(fence.getAttribute("data-source-map"));
      if (fenceMap) {
        return { element: fence as HTMLElement, ...spreadRange(fenceMap) };
      }
    }
  }

  const map = parseSourceMap(found.getAttribute("data-source-map"))!;
  return { element: found, ...spreadRange(map) };
}

function spreadRange(r: [number, number]): { start: number; end: number } {
  return { start: r[0], end: r[1] };
}

/**
 * Given a line of markdown, flip `[ ]` to `[x]` and vice versa within the
 * first task-list marker. Lines without a task marker are returned as-is.
 */
export function toggleTaskAt(source: string, line: number): string {
  const eol = detectEol(source);
  const lines = splitLines(source, eol);
  if (line < 1 || line > lines.length) return source;
  const updated = lines[line - 1].replace(
    /^(\s*[-*+]\s+\[)([ xX])(\]\s?)/,
    (_, lead, mark, tail) => `${lead}${mark === " " ? "x" : " "}${tail}`,
  );
  if (updated === lines[line - 1]) return source;
  lines[line - 1] = updated;
  const trailing = endsWithNewline(source, eol);
  return trailing ? lines.join(eol) + eol : lines.join(eol);
}

/**
 * Map a source line number to a DOM element with `data-source-map` whose
 * range includes the line. Returns null if no element matches.
 */
export function blockForLine(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestRange = Number.POSITIVE_INFINITY;
  for (const el of root.querySelectorAll<HTMLElement>("[data-source-map]")) {
    const map = parseSourceMap(el.getAttribute("data-source-map"));
    if (!map) continue;
    const span = map[1] - map[0];
    if (line >= map[0] && line <= map[1] && span <= bestRange) {
      best = el;
      bestRange = span;
    }
  }
  return best;
}

/**
 * Inverse of `blockForLine`: return the start line of the element's
 * source-map range, or null if the element has none.
 */
export function lineForElement(el: HTMLElement): number | null {
  const map = parseSourceMap(el.getAttribute("data-source-map"));
  return map ? map[0] : null;
}