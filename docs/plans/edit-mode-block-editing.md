# Edit mode v1 (block editing) + advanced-WYSIWYG options doc

## Context

Marky (this fork) is a read-only markdown viewer, and the user wants to edit files in it. This fork does not follow the upstream "read-only by design" rules in `CLAUDE.md`.

The long-term goal is to edit directly in the rendered view while still being able to see the backing markdown. The discussion covered several ways to build that "advanced WYSIWYG" mode. They are recorded in a design doc (Deliverable 1, full text in Appendix A) and not implemented yet.

We start with the easy version (Deliverable 2): **block editing**.
- Hover, double-click, or click a rendered block while in Edit mode.
- That block turns into a small CodeMirror source editor, in place.
- On commit, only the block's source lines are replaced. Saves are byte-exact.
- The existing renderer is reused unchanged.

The same deliverable adds the pieces every future mode also needs:
- a Source view toggle
- safe saves
- handling for files that change on disk
- lint diagnostics from Rust (the agreed scope runs "through linting")

The groundwork is already in place. `src/lib/markdown.ts:48` stamps every block element with `data-source-map="startLine,endLine"`. Shiki and mermaid keep that attribute when they replace a block (`Viewer.tsx:58`, `mermaid.ts:35`). `copyAsMarkdown.ts` already maps DOM → source lines.

---

## Deliverable 1 — `docs/advanced-wysiwyg.md`

Write Appendix A verbatim. It covers the goal and the options only, with no implementation plan.

---

## Deliverable 2 — Block edit mode v1

### UX spec (decided with user)

**Per-tab state**
- `mode: "read" | "edit"`.
  - A toolbar button shows the state: lock + "Read only", or pencil + "Editing".
  - View ▸ Edit Mode (⌘E) toggles it.
  - The Welcome tab (no file path) is always read-only.
- `view: "rendered" | "source"`.
  - A toolbar toggle and View ▸ Source View (⌘/, Typora's shortcut) switch it.
  - Source view is a full-document CodeMirror. It is editable only in Edit mode.

**Opening a block for editing (rendered view)**
- Hovering any mapped block shows a **pencil** button in the left margin, in both modes.
- The **pencil** or a **double-click** opens that block's editor. If the tab is in Read mode, it switches to Edit mode.
- In **Edit mode**, a plain single click on a block also opens it. "Plain" means no drag-selection and not on a link or checkbox.
  - Links need ⌘-click in Edit mode.
  - Drag-to-select and copy work as today.
- In **Edit mode**, clicking a task checkbox toggles `[ ]`/`[x]` directly in the source line.
- Block granularity: the innermost element with `data-source-map` under the pointer, with these overrides:
  - Anything inside a `<table>` edits the whole table.
  - Code, mermaid and `pre` blocks edit the whole fence.
  - Front matter, raw HTML blocks and footnote definitions are unmapped. They are editable only in Source view.
- Caret placement is best-effort. If the double-click selected a word, put the caret at the first occurrence of that word in the block source. Otherwise, put it at the start.

**Block editor**
- An inline CodeMirror 6 editor replaces the rendered block, grows to fit its content, and uses markdown highlighting.
- Enter continues lists. Backspace removes list markup.
- **Esc**, **click outside** or **⌘Enter** commits and closes.
- If the text is unchanged, nothing happens. Otherwise the block's lines are spliced into `tab.source`, which makes the tab dirty, and the view re-renders.
- ⌘Z inside the editor uses the editor's own undo.
- Edit ▸ Undo / Redo (⌘Z / ⇧⌘Z) outside any editor undoes/redoes whole block commits through a per-tab history, capped at 100 entries.

**Save / discard / dirty**
- File ▸ Save (⌘S) saves. It commits an open block editor first.
- The Toolbar gets **Save** and **Discard changes**, both enabled when the tab is dirty. File ▸ Discard Changes does the same.
- Discard reloads from disk. It pushes to history, so ⌘Z recovers the discarded edits, and needs no confirmation.
- File ▸ Reload File (⌘R, from P001) on a tab with unsaved changes behaves exactly like Discard changes.
- A dirty dot appears on the tab in `TabBar`.
- **Invariant: Read mode means clean.**
  - Toggling Edit → Read with unsaved changes asks **Save / Discard / Cancel**.
  - The same dialog appears when closing a dirty tab, closing the split (CLOSE_SPLIT drops the other pane's tabs), or quitting the app via the window close-requested event.
- An open block editor with uncommitted changes counts as dirty.

**External changes on disk** (the watcher already emits `file://changed`)
- Disk content equal to `savedSource` is ignored. This covers the echo from our own save, and needs no watcher changes.
- **Clean tab: auto-reload**, then show a banner at the top of the pane:
  > File was changed on disk and reloaded | [Show changes] | [Restore current version] | [×]
  - `previous` is the content shown before the *first* unacknowledged reload. Repeated reloads (Claude rewriting a plan) keep the original `previous` until the banner is dismissed.
  - *Show changes*: a diff dialog comparing `previous` with the current disk version.
  - *Restore current version*:
    1. set `source = previous` and `savedSource = disk`, which makes the tab dirty
    2. switch to Edit mode
    3. clear the banner

    ⌘S then writes it back. This choice is non-destructive; flip it if Restore should write immediately.
  - *×* dismisses the banner.
- **Dirty tab: never auto-reload.** Show this banner instead:
  > File changed on disk while you have unsaved changes | [Show changes] | [Reload from disk] | [Keep mine] | [Merge changes]
  - *Show changes*: a diff of yours vs disk.
  - *Reload from disk*: same as Discard.
  - *Keep mine*: sets `savedSource = disk`, so the next save overwrites disk without a conflict. The tab stays dirty.
  - *Merge changes*: calls Rust `merge_text(base=savedSource, ours=source, theirs=disk)`.
    - Clean merge: `source = merged`, `savedSource = disk`, still dirty.
    - Conflicts: `source` = the text with conflict markers. Switch to Source view and show a banner "Resolve N conflicts, then save". Lint flags the markers.
- Background tabs keep their notice. `TabBar` shows an indicator, and the banner appears when the tab is viewed.
- A save that races an external write gets a `Conflict` result from Rust. That shows the dirty-tab banner.

**Lint diagnostics**
- Lint runs on open, on block commit, on Source-view edits (debounced 400 ms) and on save.
- Source view and the block editor use `@codemirror/lint`, which gives underlines, gutter marks and hover messages.
  - The block editor shows only diagnostics within its lines, shifted to its offsets.
  - A quick-fix action appears when rumdl provides a fix.
- In the rendered view, blocks whose line range contains a diagnostic get a margin marker with a tooltip. Clicking the marker opens the block editor.
- A Toolbar "N problems" badge opens a dropdown of rule, message and line. Clicking an entry scrolls to the block (rendered) or the line (source).
- A preference turns linting on or off. It defaults to on.

### Rust (`src-tauri/`)
- **`Cargo.toml`**: add `atomic-write-file`, `diffy`, `rumdl` (lib `rumdl_lib`) and `yaml-rust2`, all at their latest versions.
  - Pin `rumdl` to an **exact** version, because its library API changes between releases. The planned signature is `lint(content, rules, verbose, flavor, source_file, config) -> LintResult` (0.2.78).
  - Check the release binary size after adding rumdl. If it balloons, fall back to running the `rumdl` CLI as a sidecar with JSON output.
- **`fs.rs`**: add `write_text_atomic(path, contents)`. It:
  - calls `canonicalize` first, so saving a symlinked file writes the target and keeps the link
  - enforces the same 25 MB cap as `read_text`
  - keeps file permissions (verify `atomic-write-file`'s preserve-mode behavior)
- **`commands.rs`** (register all new commands in `lib.rs` `generate_handler!`):
  - `read_file` also records the canonical path in a new managed `OpenedFiles` set (`Arc<Mutex<HashSet<PathBuf>>>`, managed in `lib.rs`).
  - `write_file(path, contents, expected_base) -> WriteOutcome { Saved | Conflict { disk } }`:
    1. Reject paths not in `OpenedFiles`.
    2. Re-read the disk. If it differs from `expected_base`, return `Conflict`.
    3. Otherwise write atomically.

    Conflict is a success value, not an `AppError`, because `AppError` serializes to a string only.
  - `merge_text(base, ours, theirs) -> { merged, conflicts: usize }`, using `diffy::merge` (`Err` holds the text with markers).
  - `lint_markdown(path: Option<String>, contents) -> Vec<Diagnostic>`. It is async with `spawn_blocking`, and delegates to `lint.rs`.
- **New `lint.rs`**:
  - Builds the rumdl rule set and config. It discovers `.rumdl.toml` or markdownlint config from the file's directory upward. Otherwise it uses built-in defaults with MD013 (line length) disabled.
  - Runs `rumdl_lib::lint` and maps warnings to `Diagnostic { line, column, end_line, end_column, rule, message, severity, fix: Option<{ from_line, from_col, to_line, to_col, replacement }> }`.
  - rumdl 0.2.78 includes conflict-marker handling (MD092).
  - Adds a front-matter YAML validity check with `yaml-rust2`. Front matter is invisible in the rendered view, so broken YAML would otherwise go unnoticed.
- **`settings.rs` / `PreferencesPayload`**: add `lint_enabled: Option<bool>`.
- **Capabilities**: custom commands need no fs plugin. Verify whether the close-requested handling needs `core:window:allow-destroy` (or similar) in `capabilities/default.json`.

### Frontend (`src/`)
- **Dependencies** (latest): `@codemirror/state`, `view`, `commands`, `language`, `lang-markdown`, `language-data`, `lint`, `search`, `merge`.
- **`lib/codemirror.ts`** is the single shared CodeMirror setup, mirroring the `markdown.ts` convention. It provides:
  - the markdown language with fenced-code languages
  - a theme built from the shadcn CSS variables
  - keymaps
  - lint integration
  - `EditorState.lineSeparator.of(eol)`, so CRLF files stay CRLF
- **`lib/sourceEdit.ts`**:
  - `detectEol`
  - `replaceLines(source, start, end, text, eol)` — handles the last line and the trailing newline
  - `findEditableBlock(target)` — the granularity rules above
  - `toggleTaskAt(source, line)`
  - `blockForLine` / `lineForElement` — scroll sync between views
- **`lib/workspace.ts`**:
  - `TabState` gains:
    - `savedSource?`
    - `mode`
    - `view`
    - `history`/`future`
    - `diskNotice?: { kind: "reloaded"; previous } | { kind: "conflict"; disk }`
    - `diagnostics?`
  - Dirty is derived as `source !== savedSource`.
  - New actions:
    - edit and save: `COMMIT_EDIT`, `SAVED`, `UNDO`/`REDO`, `SET_MODE`/`SET_VIEW`
    - disk changes: `DISK_RELOADED`, `DISK_CONFLICT`, `RESTORE_PREVIOUS`, `KEEP_MINE`, `APPLY_MERGE`, `DISMISS_NOTICE`
    - lint: `SET_DIAGNOSTICS`
  - `OPEN_FILE` sets `savedSource = source`.
- **`lib/tauri.ts`**: typed wrappers `writeFile`, `mergeText`, `lintMarkdown`, plus the TS `Diagnostic` / `WriteOutcome` types.
- **`components/Viewer.tsx`**:
  - pencil hover overlay (same pattern as `attachCopyButtons`)
  - dblclick and Edit-mode click handlers
  - checkbox toggling
  - opening a block: hide the target element, insert a placeholder of the same tag (`li` stays inside `ul`/`ol`), and `createPortal(<BlockEditor>)` into it
  - diagnostic margin markers
- **New components**:
  - `BlockEditor.tsx`
  - `SourceView.tsx`
    - Edit ▸ Find… (⌘F) opens CodeMirror search when this view is active.
    - Switching views keeps the reading position through `data-source-map`.
  - `DiskChangeBanner.tsx`
  - `DiffDialog.tsx` (shadcn Dialog + `@codemirror/merge`)
  - `UnsavedChangesDialog.tsx`
  - `ProblemsMenu.tsx` (shadcn dropdown)
- **`components/Pane.tsx`**: render `Viewer` or `SourceView` depending on `view`, with the banner on top.
- **`components/Toolbar.tsx`**: mode toggle, view toggle, Save, Discard changes, problems badge.
- **`components/TabBar.tsx`**: dirty dot and disk-notice indicator.
- **Native menu (P001's `menu.rs` and `onMenuAction`)**: P001 task `#001` replaces the JS `keydown` handler with menu accelerators, so edit-mode shortcuts are menu items, never `keydown` listeners.
  - File ▸ Save (⌘S) and File ▸ Discard Changes.
  - View ▸ Edit Mode (⌘E) and View ▸ Source View (⌘/).
  - Edit ▸ Undo / Redo: when focus is outside a CodeMirror editor, route to the tab's block-commit history; inside an editor, keep the editor's own undo.
  - Edit ▸ Find… (⌘F): CodeMirror search in Source view; the existing document search otherwise.
  - File ▸ Reload File and File ▸ Close Tab: go through the unsaved-changes rules above.
  - If P001's menu enabled-state task (`#004`) has landed, enable Save and Discard Changes only when the tab is dirty.
- **`App.tsx`**:
  - handle the new menu actions
  - rewrite the `onFileChanged` handler (`App.tsx:95`) per the external-change spec
  - add the close-requested guard
- **`lib/markdown.ts`**: `extractHeadings` also returns the source line, so the TOC can scroll Source view.
- **Flicker fix**:
  - The problem: each commit re-renders the article, so every code block flashes plain, and mermaid re-renders.
  - `highlight.ts` and `mermaid.ts` cache their output keyed by `(lang|"mermaid", theme, code)`.
  - `Viewer` applies cache hits synchronously in a `useLayoutEffect` before paint. Only misses take the async path.
- **`lib/preferences.tsx`**: `lintEnabled`.

### Docs
- `docs/advanced-wysiwyg.md` (Appendix A).
- `CLAUDE.md`:
  - remove the read-only rules: "Don't add a markdown editor", "no contenteditable/textareas", "fs:read only"
  - document the edit-mode conventions: single `lib/codemirror.ts`, all writes through `write_file`, Read mode means clean
- `README.md` feature list and keyboard shortcuts.
- `CHANGELOG.md` is generated from completed tasks, so no step edits it by hand.

## Implementation order

Every step heading below is one task. No branch is stacked on another unmerged branch:
- Steps that name a shared branch run one after another in the same worktree and branch, and merge together.
- Every other step starts from an up-to-date `main` after its dependencies are merged.

### Advanced WYSIWYG options doc
- Write `docs/advanced-wysiwyg.md` with the text of Appendix A.
- Depends on: none.
- Branch: `docs/advanced-wysiwyg`.

### Safe saves and merging in Rust
- Add `write_text_atomic` to `fs.rs`, the `OpenedFiles` set filled by `read_file`, and the `write_file` and `merge_text` commands, as described under "Rust".
- Add the `writeFile` and `mergeText` wrappers and the `WriteOutcome` type in `src/lib/tauri.ts`.
- `cargo test`: atomic write, unopened path rejected, conflict on base mismatch, symlink target kept, merge clean vs conflict.
- Depends on: none.
- Branch: `feat/edit-mode-foundation`, shared with "Source splicing and tab edit state".

### Source splicing and tab edit state
- Add `src/lib/sourceEdit.ts`, as described under "Frontend".
- Extend `TabState` and the reducer in `src/lib/workspace.ts` with the new fields and actions.
- Vitest: `replaceLines` (LF/CRLF, first/last line, trailing newline), `findEditableBlock`, `toggleTaskAt`, reducer transitions.
- Depends on: none.
- Branch: `feat/edit-mode-foundation`, shared with "Safe saves and merging in Rust".

### Edit mode, save and discard
- Toolbar Read/Edit toggle, Save and Discard changes; dirty dot in `TabBar`.
- Menu items File ▸ Save (⌘S), File ▸ Discard Changes and View ▸ Edit Mode (⌘E).
- File ▸ Reload File on a tab with unsaved changes behaves like Discard changes.
- `UnsavedChangesDialog` for Edit → Read, Close Tab, Close Split and quitting (close-requested).
- Depends on: "Safe saves and merging in Rust", "Source splicing and tab edit state", P001 `#001`.

### Block editor
- `src/lib/codemirror.ts`, `BlockEditor.tsx`, and the `Viewer.tsx` changes: pencil, double-click, Edit-mode click, checkbox toggle.
- Edit ▸ Undo / Redo undo block commits when focus is outside an editor.
- Depends on: "Edit mode, save and discard", P001 `#001`.

### Source view
- `SourceView.tsx`, the toolbar toggle and View ▸ Source View (⌘/).
- Edit ▸ Find… opens CodeMirror search while Source view is active.
- Scroll sync through `data-source-map`; `extractHeadings` returns source lines so the TOC works in Source view.
- Depends on: "Block editor", P001 `#001`.

### External changes on disk
- Rewrite the `onFileChanged` handler in `App.tsx`; add `DiskChangeBanner.tsx` and `DiffDialog.tsx`.
- Both banners and every action described in the UX spec.
- Depends on: "Edit mode, save and discard", "Source view".
- Branch: `feat/edit-mode-sync-and-lint`, shared with the next two steps.

### Render cache for code and diagrams
- Cache Shiki and mermaid output and apply cache hits before paint, as described under "Flicker fix".
- Depends on: "Block editor".
- Branch: `feat/edit-mode-sync-and-lint`.

### Markdown linting
- `lint.rs`, the `lint_markdown` command and `lintMarkdown` wrapper, `@codemirror/lint` in both editors, rendered-block markers, `ProblemsMenu.tsx` and the `lint_enabled` preference.
- Check the release bundle size after adding `rumdl`.
- Depends on: "Block editor", "Source view".
- Branch: `feat/edit-mode-sync-and-lint`.

### Edit-mode docs
- The `CLAUDE.md` and `README.md` changes listed under "Docs".
- Depends on: "External changes on disk", "Render cache for code and diagrams", "Markdown linting".

---

## Verification
- `cargo test` (in `src-tauri/`):
  - atomic write
  - `write_file` rejects unopened paths
  - conflict on base mismatch
  - symlink target preserved
  - `merge_text` clean vs conflict
  - lint fixtures: heading increment, conflict markers, bad front-matter YAML
- `pnpm test`:
  - `replaceLines` (LF/CRLF, first/last line, trailing newline)
  - `findEditableBlock` granularity
  - `toggleTaskAt`
  - reducer transitions: commit, undo, save, reload, restore, keep mine, merge
- `pnpm typecheck`.
- `pnpm tauri dev`, manual. Use a fixture with a table, fenced code, mermaid, task list, footnotes and front matter, plus a CRLF copy.
  1. Toggle Edit and Read with no edits, save, then run `git diff`. It should be empty: a byte-identical round trip.
  2. Double-click a paragraph, edit it, press Esc, then ⌘S. `git diff` should show only that line, and `file` should still report CRLF for the CRLF copy.
  3. Use the pencil on a list item. Toggle a checkbox in Edit mode. Edit a table and a mermaid block. Code blocks should not flash on commit.
  4. Press ⌘Z outside the editor to undo a commit. Discard changes, then ⌘Z to recover.
  5. Press ⌘/ to open Source view, edit there, then switch back. The reading position should be kept.
  6. On a clean tab, run `echo "x" >> file`. It should auto-reload with the banner. Check Show changes, then Restore.
  7. On a dirty tab, change the file externally. Check each of the four actions. Force a merge conflict and resolve it in Source view.
  8. Change the file externally, then save before the watcher fires. Expect the conflict banner.
  9. Save a symlinked `.md`. `ls -l` should show the link still intact.
  10. Break heading order. Check the margin marker, the problems menu, and the quick fix in Source view.
  11. Close a dirty tab, close the split, and quit with a dirty tab. Each should show Save/Discard/Cancel.

---

## Appendix A — contents of `docs/advanced-wysiwyg.md`

```markdown
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
```
