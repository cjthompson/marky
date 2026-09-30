# Changelog

## 2026-09-30

### Fixes
- debug why Marky is using about 90% CPU constantly even when nothing is happening (#020) — guard notify callback against empty event batches, debounce FolderSidebar's `folder://changed` listener at 200 ms, bump `tauri` 2.10.3 → 2.12.0; idle CPU 99.4 % → 0.2 %

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Rescan Folder (⇧⌘R) and Close Folder (⇧⌘W) for the active file's folder
- Open Recent ▸ and Open Recent Folder ▸ submenus (≤10 entries + Clear Menu)
- Print… (⌘P) with print-only CSS for clean PDF export
- Reveal in Finder / Show in File Manager (⌥⌘R)
- Open With… (⌥⌘O, macOS only) — picker starts in /Applications
- Export ▸ HTML… (⌥⌘E) and Export ▸ Markdown Copy… (⇧⌘S)
- Greyed-out File menu items — Reload, Export, Reveal, Open With, Close Tab, Print, Rescan/Close Folder are disabled when no file or folder is open
- Adjustable text size — scales all text app-wide (sidebar, toolbar, command palette, markdown content) via Settings dropdown or Cmd+Plus/Cmd+Minus/Cmd+0
- Resizable sidebars — drag the edge of the folder sidebar or table of contents to resize; double-click to reset to default
- Copy contents as markdown
- Linux builds (.deb and AppImage) for amd64 and arm64

### Fixed
- CLI not opening files when Marky is already running
- Files not refreshing when edited from outside of Marky
- Contact link

## [0.1.1] - 2026-04-16

### Fixed
- Folders not working correctly

## [0.1.0] - 2026-04-16

### Added
- Tauri v2 desktop markdown viewer
- Folder sidebar with file tree (Obsidian-style)
- Cmd+K command palette with fuzzy search
- Split panes and tabs
- In-document search
- Syntax highlighting via Shiki
- KaTeX math rendering
- Mermaid diagram support
- Light/dark theme with shadcn UI
- File watching with live reload
- CLI launcher (`marky FILE` or `marky FOLDER`)
- Homebrew tap distribution
