import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";

const COMMON_LANGS: BundledLanguage[] = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "rust",
  "python",
  "go",
  "bash",
  "shell",
  "yaml",
  "toml",
  "html",
  "css",
  "sql",
  "md",
  "diff",
  "java",
  "c",
  "cpp",
  "ruby",
];

const THEMES: BundledTheme[] = ["github-light", "github-dark"];

let promise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!promise) {
    promise = createHighlighter({ themes: THEMES, langs: COMMON_LANGS });
  }
  return promise;
}

// Module-level render cache. Keyed by `${resolvedLang}|${theme}|${code}` so
// that a viewer re-render of the same block returns synchronously from the
// cache and skips the flash back to plain text. `resolvedLang` is used (not
// the raw `lang`) so that a hit after a failed language load collapses to
// the same `text`-fallback entry the first miss stored.
const renderCache = new Map<string, string>();

export async function highlightCode(
  code: string,
  lang: string | undefined,
  theme: "light" | "dark" = "dark"
): Promise<string> {
  const hl = await getHighlighter();
  const loaded = hl.getLoadedLanguages();
  let resolvedLang = lang && loaded.includes(lang as BundledLanguage) ? lang : "";
  if (lang && !resolvedLang) {
    try {
      await hl.loadLanguage(lang as BundledLanguage);
      resolvedLang = lang;
    } catch {
      resolvedLang = "";
    }
  }
  const finalLang = resolvedLang || "text";
  const key = `${finalLang}|${theme}|${code}`;
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  const out = hl.codeToHtml(code, {
    lang: finalLang,
    theme: theme === "dark" ? "github-dark" : "github-light",
  });
  renderCache.set(key, out);
  return out;
}
