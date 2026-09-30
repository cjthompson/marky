# Native menu bar for Marky (File / Edit / View / Window / Help)

## Context

Marky has no native menu. Today every shortcut is a JS `keydown` listener in `src/App.tsx` (⌘K, ⌘O, ⌘F, ⌘\, ⌘W, zoom), so users can't find them and they don't follow macOS conventions. The goal is a real macOS menu bar. Every command gets a menu shortcut (an accelerator), which works only while Marky is focused. This deliberately avoids `tauri-plugin-global-shortcut`: that registers system-wide hotkeys and would take ⌘O away from every other app.

Marky also doesn't declare any markdown file types, so macOS won't offer it as an "Open With" choice or let it be the default `.md` app. This plan fixes that too.

Decisions confirmed with the user:
- ⌘W = **Close Tab** (current behavior); ⇧⌘W = **Close Folder**
- Close Folder and Rescan Folder act on **the folder containing the active file**
- Export produces **HTML and a Markdown copy**. **No PDF export**: `Print… ⌘P` covers it through the macOS print dialog's "Save as PDF"
- Extra items: **Open Recent ▸**, **Open Recent Folder ▸**, **Print… ⌘P**, **Reveal in Finder ⌥⌘R**, **Open With…** (a file picker that starts in `/Applications`)
- **No "Open in Default App"**, since Marky should be the default app
- Declare `.md` / `.markdown` / `.mdx` file associations with role **Viewer**
- Items that need more input get the `…` character (U+2026), per Apple's HIG (Human Interface Guidelines)
- On macOS, Quit lives in the app menu (`Marky ▸ Quit Marky ⌘Q`). On other platforms it goes at the bottom of File.
- **The app must keep building and running on Linux.** `.github/workflows/release.yml` ships `.deb` and AppImage builds for Ubuntu 22.04 on amd64 and arm64. All macOS-only behavior is gated; see "Platform gating".

## Menu layout (macOS shown; accelerators use `CmdOrCtrl`, which becomes Ctrl on Linux; see "Platform gating" for Linux differences)

**Marky** (app menu, macOS only): About Marky · — · Services · — · Hide Marky ⌘H · Hide Others ⌥⌘H · Show All · — · Quit Marky ⌘Q (all predefined items)

**File**
| Item | Shortcut | Enabled when |
|---|---|---|
| Open… | ⌘O | always |
| Open Folder… | ⇧⌘O | always |
| Open Recent ▸ (≤10 files, — , Clear Menu) | — | list non-empty |
| Open Recent Folder ▸ (≤10 folders, — , Clear Menu) | — | list non-empty |
| — | | |
| Reload File | ⌘R | active tab has a file |
| Rescan Folder | ⇧⌘R | active file is inside a registered folder |
| — | | |
| Export ▸ HTML… | ⌥⌘E | active tab has a file |
| Export ▸ Markdown Copy… | ⇧⌘S | active tab has a file |
| Print… | ⌘P | active tab present |
| — | | |
| Reveal in Finder (Linux: "Show in File Manager") | ⌥⌘R | active tab has a file |
| Open With… (macOS only) | ⌥⌘O | active tab has a file |
| — | | |
| Close Tab | ⌘W | active tab present |
| Close Folder | ⇧⌘W | active file is inside a registered folder |
| (non-macOS only) — · Quit | Ctrl+Q | always |

**Edit**: Undo · Redo · — · Cut · Copy · Paste · Select All (predefined; *required*, because a custom menu replaces Tauri's default and ⌘C/⌘V would otherwise stop working in inputs) · — · Find… ⌘F

**View**: Command Palette ⌘K · — · Split Right ⌘\ · Split Down ⇧⌘\ · Close Split · — · Actual Size ⌘0 · Zoom In ⌘= · Zoom Out ⌘- · — · Enter Full Screen (predefined, ⌃⌘F)

**Window**: Minimize ⌘M · Zoom · — · Bring All to Front. *Don't* use predefined `close_window`: its built-in ⌘W would clash with Close Tab.

**Help**: Marky on GitHub (opens `https://github.com/GRVYDEV/marky` in the system browser via the opener plugin) · Report an Issue

## Architecture

### Rust — new `src-tauri/src/menu.rs` (keeps `lib.rs` thin)
- `pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, MenuHandles)>`. Builds everything with `MenuBuilder` / `SubmenuBuilder` / `MenuItemBuilder::with_id(id, text).accelerator(..)` / `PredefinedMenuItem::*`. App menu and Quit placement are gated with `#[cfg(target_os = "macos")]`.
- `MenuHandles` (Tauri managed state) holds:
  - `file_items: Vec<MenuItem<Wry>>`: items gated on "has file"
  - `folder_items: Vec<MenuItem<Wry>>`: items gated on "has folder"
  - `recent_files: Submenu<Wry>` and `recent_folders: Submenu<Wry>`
- `pub fn refresh_recent(app: &AppHandle)`: clears both recent submenus and repopulates them from `registry.settings()`. Labels are `file-name — parent-dir`. IDs are `recent-file:<abs>` / `recent-folder:<abs>`, followed by a separator and `Clear Menu`.
- `pub fn handle_event(app: &AppHandle, event: MenuEvent)`, routed by a pure `parse_menu_id(&str) -> MenuCommand` (unit-tested):
  - `recent-file:<p>` / `recent-folder:<p>` → **reuse `handle_target(app, cli::classify(path))`** from `lib.rs`. That function already registers and watches folders, emits `cli://target`, and focuses the window. Move it to `pub(crate)` if needed. Paths that no longer exist classify to `None` and are ignored.
  - `clear-recent-files` / `clear-recent-folders` → clear in settings, save, `refresh_recent`
  - `help-github` / `help-issue` → `app.opener().open_url(..)`
  - everything else → `app.emit("menu://action", id)` for the frontend
- `lib.rs`: in `setup`, call `menu::build`, `app.set_menu(menu)`, `app.manage(handles)`, `menu::refresh_recent`. Register `.on_menu_event(menu::handle_event)` on the builder.

### Rust — commands (`commands.rs`), registered in `lib.rs` `invoke_handler`
- `rescan_folder(id)`: `registry.refresh_folder(&id)`. Then recreate the watcher with `watch_folder` + `watchers.insert` (fixes a watcher that died) and emit `folder://changed`.
- `set_menu_state(has_file: bool, has_folder: bool)`: calls `set_enabled` on the `MenuHandles` items.
- `read_file`: add an `app: AppHandle` param and call `menu::refresh_recent(&app)` after `push_recent`.
- `add_folder` / `remove_folder`: push the path to `recent_folders`, then `refresh_recent`.
- Save and pick dialogs run **in Rust** (`tauri_plugin_dialog::DialogExt`, `blocking_*` inside `async` commands, so they stay off the main thread). The frontend never passes a destination path, so it can only write where the user chose. Thin `#[tauri::command]` wrappers live in `commands.rs`; the logic is in new `src-tauri/src/export.rs`. Each returns `Option<String>` (the chosen path, or `None` if cancelled).
  - `export_html(html: String, suggested_name: String)` → save dialog filtered to `.html`, writes the text
  - `export_markdown(source_path: String)` → save dialog filtered to `.md`, `std::fs::copy` (byte-identical)
  - `open_with(path: String)`:
    - pick dialog with `set_directory("/Applications")` and filter `Applications` → `["app"]`
    - then `app.opener().open_path(path, Some(chosen_app))` (on macOS this becomes `open -a <app> <file>`)
    - no native code needed
    - the command exists on every platform so `generate_handler!` stays unconditional; the body is `#[cfg(target_os = "macos")]`, and elsewhere it returns `AppError::Invalid("unsupported on this platform")`
- `settings.rs`: add `#[serde(default)] recent_folders: Vec<String>` plus `push_recent_folder` (same dedup/cap logic as `push_recent`) and `clear_recent_files` / `clear_recent_folders`. Expose them via `FolderRegistry`.

### Platform gating

Principle: every platform difference lives in `menu.rs` (plus the one `open_with` body). The frontend stays platform-agnostic: it just never receives actions for menu items that don't exist. Menu items that call macOS-only builders get `#[cfg(target_os = "macos")]` / `#[cfg(not(target_os = "macos"))]`, so Linux never compiles them. `cfg!()` is only for label strings.

The macOS-only predefined items come from the `muda` docs, which mark them "Linux: Unsupported". `muda` is the menu library Tauri uses.

| Piece | macOS | Linux |
|---|---|---|
| App menu (About, Services, Hide, Hide Others, Show All, Quit) | predefined items, first submenu | **omitted** (it would show as a literal "Marky" menu). About moves to Help ▸ About Marky (`about` is cross-platform) |
| Quit | predefined, app menu, ⌘Q | **custom** File ▸ Quit, Ctrl+Q → `app.exit(0)` (predefined `quit` is unsupported on Linux) |
| Edit ▸ Undo / Redo | predefined | **omitted** (unsupported); Cut / Copy / Paste / Select All are cross-platform and stay |
| View ▸ Full Screen | predefined `fullscreen` (⌃⌘F) | **custom** "Toggle Full Screen", F11 → `window.set_fullscreen(!window.is_fullscreen()?)` |
| Window menu (Minimize, Zoom, Bring All to Front) | predefined | **omitted entirely** (all three are unsupported) |
| Help menu | also `set_as_help_menu_for_nsapp()`, which adds macOS's Help search field | plain submenu |
| Reveal | "Reveal in Finder" | "Show in File Manager" (opener's `revealItemInDir` works on Linux via the file manager's D-Bus interface) |
| Open With… | picker at `/Applications` | **omitted**. Possible follow-up: the xdg-desktop-portal "OpenURI" call with `ask: true` shows the native app chooser, but it needs the `ashpd` crate |
| Print… | `window.print()` | same; Tauri documents `window.print()` as working on all platforms |
| File associations | `CFBundleDocumentTypes` in the `.app` | the bundler writes `MimeType=` into the `.desktop` file for `.deb` and AppImage. Opening goes through argv → `cli::resolve` plus single-instance forwarding, which already works |
| `RunEvent::Opened` | already `#[cfg(target_os = "macos")]` in `lib.rs` | unchanged |

Out of scope: the `⌘` glyphs hard-coded in the `WELCOME` text and toolbar tooltips also show on Linux. That's an existing issue and isn't touched here.

### Bundle — `src-tauri/tauri.conf.json`
- Add `bundle.fileAssociations`:
  - one entry with `ext: ["md", "markdown", "mdx"]`, `name: "Markdown Document"`, `role: "Viewer"`, `mimeType: "text/markdown"`
  - if the Tauri schema supports it, also `contentTypes: ["net.daringfireball.markdown"]` for the macOS UTI (Uniform Type Identifier)
- The open-file path is already handled by `RunEvent::Opened` in `lib.rs`. No runtime changes.

### Frontend
- `src/lib/tauri.ts`:
  - `type MenuAction = "open" | "open-folder" | "reload-file" | …` (string union mirroring the Rust IDs)
  - `onMenuAction(cb)` listening on `menu://action`
  - wrappers `rescanFolder`, `setMenuState`, `exportHtml`, `exportMarkdown`, `openWith`
- `src/lib/folders.ts` (new): `folderForPath(folders, path): AnnotatedFolder | null`. Longest path-prefix match on `folder.path + "/"`.
- `src/lib/exportHtml.ts` (new):
  - pure `buildStandaloneHtml({ title, bodyHtml, css, dark })` → full `<!doctype html>` document with `<html class="dark">` when dark
  - `collectExport(article)`: clones the rendered `article.markdown-body` (post-Shiki, post-mermaid SVG), strips `.copy-code-btn`, and gathers CSS text from `document.styleSheets` (all same-origin)
- `src/App.tsx`:
  - **Delete the global `keydown` effect.** Every shortcut it handled moves to a menu accelerator; keeping both would fire twice.
  - Add one `useEffect` subscribed to `onMenuAction` that switches on the action. Handlers:
    - existing: `handlePickFile`, `setPaletteOpen`, `setSearchPaneId`, `dispatch SPLIT / CLOSE_SPLIT / CLOSE_TAB`, `zoomIn/Out/Reset`
    - new: reload (`tauri.readFile` → `UPDATE_TAB_SOURCE`), open-folder (dialog + `tauri.addFolder`), rescan / close-folder via `folderForPath(folders, activeTab.filePath)`, print (`window.print()`), reveal (`revealItemInDir` from `@tauri-apps/plugin-opener`), `tauri.openWith`, exports
  - Add a `useEffect` on `[activeTab?.filePath, folders]` that calls `tauri.setMenuState(hasFile, hasFolder)`.
- `src/components/FolderSidebar.tsx`: `handleAdd` duplicates the Open Folder flow. Lift it into a shared helper (or have App own it) so the menu and the + button use one code path.
- Print CSS uses Tailwind's built-in `print:` variant. This is what makes Print… a usable PDF path:
  - `print:hidden` on the sidebar, resize handles, `Toolbar`, `TabBar`, TOC aside, and non-focused panes
  - `print:h-auto print:overflow-visible` on the Viewer scroller and the flex containers above it, so the full document prints
  - `break-inside: avoid` for `pre` / `table` / mermaid SVGs, under `@media print` in `src/styles/markdown.css`
  - **`markdown.css` has uncommitted user edits.** Append only; don't rewrite.
- Update the `WELCOME` text if any shortcut changes. The README "Keyboard Shortcuts" table gets the full list; add a CHANGELOG entry.

## Implementation order

Steps run top to bottom, and each one leaves the app working. Every step heading below is one task.

### Static menus and menu-action wiring
- Build `menu.rs` with every static menu (app, File, Edit, View, Window, Help) and the platform gating.
- Emit `menu://action`; add the `onMenuAction` wrapper and the listener in `App.tsx`.
- Delete the `keydown` effect. Wire the existing actions plus Reload File and Open Folder.
- Verify each shortcut fires **once**, and that ⌘C/⌘V work in the ⌘K palette input.
- Depends on: none.

### Rescan Folder and Close Folder
- Add `folderForPath` in `src/lib/folders.ts`, with a Vitest test.
- Add the `rescan_folder` command, and wire Rescan Folder (⇧⌘R) and Close Folder (⇧⌘W) to the active file's folder.
- Depends on: Static menus and menu-action wiring.

### Open Recent and Open Recent Folder submenus
- Add the `recent_folders` setting, with `cargo test` coverage for dedup/cap and for older `settings.json` files that lack the field.
- Add `refresh_recent` and Clear Menu, plus `parse_menu_id` unit tests.
- Recent items open through the existing `handle_target`.
- Depends on: Static menus and menu-action wiring.

### Menu item enabled state
- Add the `set_menu_state` command and the frontend effect on `[activeTab?.filePath, folders]`.
- Grey out file-dependent and folder-dependent items as listed in the File menu table.
- Depends on: Rescan Folder and Close Folder.

### Print, Reveal in Finder, and Open With
- Add the print CSS (Tailwind `print:` variant, plus an append-only `@media print` block in `markdown.css`) and Print… via `window.print()`.
- Add Reveal in Finder (labeled "Show in File Manager" on Linux).
- Add the `open_with` command, macOS only.
- Depends on: Static menus and menu-action wiring.

### Export HTML and Markdown copy
- Add `src/lib/exportHtml.ts` (`buildStandaloneHtml` with a Vitest snapshot, and `collectExport`).
- Add the `export_html` and `export_markdown` commands in `export.rs`, with the save dialogs running in Rust.
- Depends on: Static menus and menu-action wiring.

### Markdown file associations
- Add `bundle.fileAssociations` for `.md` / `.markdown` / `.mdx` with role Viewer in `tauri.conf.json`.
- Depends on: none.

### Linux build verification
- In an OrbStack Ubuntu 22.04 container, run `cargo check`, `cargo test` and `pnpm tauri build --bundles deb`, then inspect the `.desktop` file (see Verification).
- Also run it after the first step, so a gating mistake shows up early instead of at release time.
- Depends on: every step above.

### PR check workflow
- *(Recommended, small)* Add `.github/workflows/check.yml` running on PRs: `cargo test` on `ubuntu-22.04` (same apt packages as `release.yml`) and on `macos-latest`.
- Today Linux only builds on a `v*` tag push, so a Linux-only compile error would first appear during a release.
- Depends on: none.

## Verification
- `cd src-tauri && cargo test`: new tests for `push_recent_folder` dedup/cap, `recent_folders` default when absent from old `settings.json`, and `parse_menu_id`
- `pnpm test`: `folderForPath` (nested folders pick the longest match; sibling-prefix `/a/foo` vs `/a/foobar`), `buildStandaloneHtml` snapshot
- `pnpm tauri dev`, then manually:
  - every menu item and every shortcut fires exactly once
  - Welcome tab: Reload / Export / Reveal / Open With / Close Folder are greyed out
  - open a file inside a folder: they're enabled, and ⇧⌘W removes that folder from the sidebar
  - touch a new `.md` in a folder, then ⇧⌘R: the tree shows it
  - edit the open file externally, then ⌘R: the content updates
  - Open Recent lists the file just opened; Clear Menu empties it; a recent folder that was closed re-adds on click
  - ⌥⌘E → `.html` opens in Safari offline with highlighting and mermaid intact (dark theme preserved)
  - ⇧⌘S → `cmp` shows the copy is byte-identical
  - ⌘P → print preview shows only the document, paginated. "Save as PDF" gives a clean PDF
  - ⌥⌘R → Finder selects the file
  - ⌥⌘O → picker opens in `/Applications`; choosing TextEdit opens the file there
  - Help → GitHub opens in the browser
- **Linux**, in an OrbStack `ubuntu:22.04` container with the repo mounted and the apt packages from `release.yml` installed:
  - `cd src-tauri && cargo check && cargo test`, with no warnings about unused macOS-only code
  - `pnpm tauri build --bundles deb`, then `dpkg-deb -x` the output and inspect `usr/share/applications/*.desktop`:
    - `MimeType=` should include `text/markdown`
    - `Exec=` should carry a file placeholder (`%F` or `%U`). If it doesn't, add `bundle.linux.deb.desktopTemplate` so double-clicked files reach argv
  - a GUI smoke test (menu renders, Ctrl shortcuts fire, F11 fullscreen) needs a real Linux desktop. It's listed as a manual check, not run here
- `pnpm tauri build`, install the `.app`, then:
  - Finder → Get Info on a `.md` → Open With lists Marky
  - "Change All" makes it the default
  - double-clicking a `.md` opens it in Marky
