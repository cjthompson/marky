# Advanced WYSIWYG editing — goal and options

Status: exploration. Nothing here is scheduled. v1 ships block editing (see CHANGELOG).

## Goal

Edit directly in the rendered view — no mode switch needed to make a change — while
the backing markdown stays viewable (Source view). Specifically:

- Typing flows across the whole document, not one block at a time.
- Saves are byte-exact: untouched text is never rewritten (no reformatting, no
  normalised list markers, escapes, or table padding).
- The rendered look matches the existing Viewer (markdown-it + Shiki + KaTeX + mermaid).
- Lint diagnostics can point at exact text.

## What v1 (block editing) already provides

- Line-level source mapping (`data-source-map`) and byte-exact line splicing.
- CodeMirror 6 setup (`lib/codemirror.ts`) and a full-document Source view.
- Atomic saves, conflict detection, three-way merge, external-change handling.
- Rust lint pipeline (rumdl) with line/column diagnostics.
- Shiki/mermaid output caching keyed by content.

Its limits: editing is one block at a time; cross-block selection edits and
splitting/joining blocks need Source view; lint markers are per block.

## Options

### A. CodeMirror 6 live preview (Obsidian model)

One CodeMirror editor holds the markdown. Decorations make it *look* rendered:
syntax markers are hidden except on the line/element under the cursor; tables, math,
mermaid, images and code render as widgets (reusing `markdown.ts`, Shiki, mermaid).

- The editor owns the DOM; input, IME, selection, undo, and jumping over hidden syntax
  (atomic ranges) are already solved by CodeMirror.
- Byte-exact by construction; lint diagnostics map 1:1 to text ranges.
- Inline rendering is re-implemented as CSS on source ranges, so it approximates
  `markdown.css` rather than reusing markdown-it's HTML.
- Prior art: Obsidian; `kenforthewin/atomic-editor`; `blueberrycongee/codemirror-live-markdown`.

### B. Projected editing over the existing renderer (source-mapped rendering)

The markdown string is the only truth. The existing rendered HTML is made editable;
each keystroke is translated to a source offset (skipping syntax characters), applied
to the markdown, the affected block is re-rendered, and the caret is restored at the
mapped position.

- Renders exactly like the Viewer; byte-exact; syntax can stay hidden.
- Prior art: MarkText's editor engine (muya) keeps each block's markdown as text,
  re-renders a block only when the tokens near the caret change, and shows a token's
  markers only while the caret is within one character of it. (Muya regenerates
  container markdown from its block tree, which is why MarkText reports false
  "unsaved" states and git-diff noise — B must keep the string as the truth to avoid that.)

Hard parts:
- **Character-level map.** markdown-it records only block line ranges; add a plugin
  recording inline positions or align rendered text against block source. Escapes,
  entities and typographer quotes (enabled in `markdown.ts`) break 1:1 correspondence.
- **Boundary ambiguity.** A caret after "bold" in `**bold**` has two source positions.
  Needs a rule, or reveal markers near the caret (muya/Typora). Always-hidden syntax
  also needs UI for link URLs, image paths, heading levels.
- **Typing markdown characters.** Does `*` insert a literal (`\*`) or start emphasis?
- **macOS text input.** Press-and-hold accents, dictation, autocorrect and IME
  composition can't be cancelled; the DOM mutates first and must be reconciled.
  WebKit (Tauri's macOS webview) has its own quirks.
- **Structural keys.** Enter/Backspace/Tab in lists, headings, tables, quotes each need
  a source-level rule.
- **Non-text content.** Math, mermaid, images, checkboxes, footnote refs are atomic.
- **Own undo, paste, cross-block selection.**

Render speed: re-rendering one block with markdown-it is cheap; Shiki/KaTeX/mermaid
are the slow parts and must be cached by content (v1 does this). A debounce cannot
delay the typed character appearing; viable patterns are (1) synchronous re-render of
just the edited block, or (2) let the browser insert plain text natively (instant,
IME-safe), reconcile into the source after a short debounce, and intercept only
structural input.

Suggested de-risking spike: character map + plain typing in paragraphs over the
existing Viewer; test press-and-hold accents, dictation, and caret placement at
formatting boundaries in the Tauri macOS webview.

### C. ProseMirror WYSIWYG (Milkdown / Tiptap)

Rich-text document model; markdown is parsed in on open and serialised out on save.

- Most Typora-like; syntax never visible.
- Re-serialisation rewrites untouched content (list markers, spacing, escapes, table
  padding); out-of-the-box round-trip tests mostly fail. Needs a layer that writes
  unchanged top-level blocks back as their original text.
- Different parser (Milkdown: remark; Tiptap: marked) from the Viewer (markdown-it), so
  the same file can render differently. Milkdown's Crepe UI pulls in Vue.
- Prior art: `smartmemory/marky` (Tauri 2 + React + Milkdown), Toril, AndyMD.

### D. Embed muya directly

Standalone JS engine from MarkText implementing roughly option B.

- Least engine work for B-style UX.
- Own renderer (not markdown-it) and regenerates markdown from its block tree —
  loses both rendering parity and byte-exact saves.

## Comparison

|                               | A. Live preview | B. Projected | C. ProseMirror | D. muya |
|-------------------------------|-----------------|--------------|----------------|---------|
| Continuous typing             | yes             | yes          | yes            | yes     |
| Byte-exact saves              | yes             | yes          | extra layer    | no      |
| Matches current rendering     | approximate     | exact        | different parser | different |
| Syntax visibility             | at cursor       | hidden or at cursor | never   | at cursor |
| Exact lint underlines         | yes             | via map      | hard           | hard    |
| Editing-engine work           | low (CodeMirror)| high (own)   | low (ProseMirror) + round-trip layer | low |

## Open questions

- Syntax always hidden, or revealed near the caret?
- Typed markdown characters: literal or live formatting?
- Is exact rendering parity (B) worth owning an editing engine vs. A?