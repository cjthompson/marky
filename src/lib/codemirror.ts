/**
 * Single shared CodeMirror setup, mirroring the `markdown.ts` convention.
 *
 * Anything that opens a CodeMirror editor (`BlockEditor`, `SourceView`)
 * composes the same set of extensions so the look, keymap, and line-ending
 * handling stay consistent.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { detectEol } from "./sourceEdit";

/** Minimal theme derived from the shadcn CSS variables. */
export const markyTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
      fontSize: "0.9rem",
    },
    ".cm-content": {
      caretColor: "var(--foreground)",
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--foreground)" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--background)",
      color: "var(--muted-foreground)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--muted)",
      color: "var(--foreground)",
    },
    ".cm-activeLine": { backgroundColor: "var(--muted)" },
  },
  { dark: true },
);

/** Build the canonical set of extensions used by every editor in the app. */
export function markdownExtensions(eol: "\n" | "\r\n" = "\n"): Extension[] {
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    markdown({ codeLanguages: languages }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    markyTheme,
    EditorState.lineSeparator.of(eol),
  ];
}

/** Re-export of @codemirror/state pieces used by the editors. */
export { EditorState } from "@codemirror/state";
export { EditorView, keymap };
export type { Extension } from "@codemirror/state";
export type { ViewUpdate } from "@codemirror/view";

/** Read the file's EOL once and pass it through to markdownExtensions. */
export function extensionsForSource(source: string): Extension[] {
  return markdownExtensions(detectEol(source));
}