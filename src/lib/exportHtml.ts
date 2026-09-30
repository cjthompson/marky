/**
 * Build a standalone, self-contained HTML document from a rendered markdown
 * article and its computed styles, suitable for opening offline in any
 * browser (syntax highlighting, mermaid diagrams, and dark theme intact).
 */

export interface StandaloneHtmlOptions {
  title: string;
  bodyHtml: string;
  css: string;
  dark: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildStandaloneHtml({ title, bodyHtml, css, dark }: StandaloneHtmlOptions): string {
  const htmlClass = dark ? ' class="dark"' : "";
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html lang="en"${htmlClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${safeCss}
</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>
</body>
</html>`;
}

export interface CollectedExport {
  bodyHtml: string;
  css: string;
  title: string | null;
}

/**
 * Snapshot the rendered markdown article and the page's stylesheets into
 * data suitable for `buildStandaloneHtml`. Strips interactive-only chrome
 * (copy-code buttons, header anchor links) that doesn't make sense in a
 * static export.
 */
export function collectExport(article: HTMLElement, doc: Document = document): CollectedExport {
  const clone = article.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".copy-code-btn").forEach((el) => el.remove());

  const h1 = clone.querySelector("h1");
  h1?.querySelectorAll(".header-anchor").forEach((a) => a.remove());
  const title = h1?.textContent?.trim() || null;

  const bodyHtml = clone.innerHTML;

  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        parts.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheets throw a SecurityError on cssRules access;
      // skip them since we can't inline their contents anyway.
    }
  }
  const css = parts.join("\n");

  return { bodyHtml, css, title };
}
