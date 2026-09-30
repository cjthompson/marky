//! Native menu bar: static menu construction, id parsing, and event routing.
//!
//! Platform differences (see docs/plans/native-menu-bar.md "Platform gating")
//! live entirely in this module via `#[cfg(target_os = "macos")]` /
//! `#[cfg(not(target_os = "macos"))]`. `cfg!()` is only used for label text.

use crate::registry::SharedRegistry;
use std::path::Path;
use tauri::menu::{
    Menu, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_opener::OpenerExt;

/// Menu items whose enabled state depends on app state (has-file /
/// has-folder). Stored in Tauri managed state so a later task (#004) can
/// toggle them without rebuilding the whole menu. The recent-files/folders
/// submenus are populated by #003.
pub struct MenuHandles {
    pub file_items: Vec<MenuItem<Wry>>,
    pub folder_items: Vec<MenuItem<Wry>>,
    #[allow(dead_code)]
    pub recent_files: Submenu<Wry>,
    #[allow(dead_code)]
    pub recent_folders: Submenu<Wry>,
}

/// Build the full native menu bar (app, File, Edit, View, Window, Help).
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, MenuHandles)> {
    let mut builder = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        builder = builder.item(&app_menu(app)?);
    }

    let (file_menu, file_items, folder_items, recent_files, recent_folders) = file_menu(app)?;
    builder = builder.item(&file_menu).item(&edit_menu(app)?).item(&view_menu(app)?);

    #[cfg(target_os = "macos")]
    {
        builder = builder.item(&window_menu(app)?);
    }

    builder = builder.item(&help_menu(app)?);

    let menu = builder.build()?;

    Ok((
        menu,
        MenuHandles {
            file_items,
            folder_items,
            recent_files,
            recent_folders,
        },
    ))
}

#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Marky")
        .about_with_text("About Marky", None)
        .separator()
        .services()
        .separator()
        .hide_with_text("Hide Marky")
        .hide_others()
        .show_all()
        .separator()
        .quit_with_text("Quit Marky")
        .build()
}

type FileMenuParts = (
    Submenu<Wry>,
    Vec<MenuItem<Wry>>,
    Vec<MenuItem<Wry>>,
    Submenu<Wry>,
    Submenu<Wry>,
);

fn file_menu(app: &AppHandle) -> tauri::Result<FileMenuParts> {
    let open = MenuItemBuilder::with_id("open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", "Open Folder…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;

    // Populated by #003; empty and disabled for now.
    let recent_files = SubmenuBuilder::with_id(app, "recent-files", "Open Recent")
        .enabled(false)
        .build()?;
    let recent_folders = SubmenuBuilder::with_id(app, "recent-folders", "Open Recent Folder")
        .enabled(false)
        .build()?;

    let reload_file = MenuItemBuilder::with_id("reload-file", "Reload File")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let rescan_folder = MenuItemBuilder::with_id("rescan-folder", "Rescan Folder")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;

    let export_html = MenuItemBuilder::with_id("export-html", "HTML…")
        .accelerator("Alt+CmdOrCtrl+E")
        .build(app)?;
    let export_markdown = MenuItemBuilder::with_id("export-markdown", "Markdown Copy…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_menu = SubmenuBuilder::new(app, "Export")
        .item(&export_html)
        .item(&export_markdown)
        .build()?;

    let print = MenuItemBuilder::with_id("print", "Print…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    let reveal_label = if cfg!(target_os = "macos") {
        "Reveal in Finder"
    } else {
        "Show in File Manager"
    };
    let reveal = MenuItemBuilder::with_id("reveal", reveal_label)
        .accelerator("Alt+CmdOrCtrl+R")
        .build(app)?;

    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let close_folder = MenuItemBuilder::with_id("close-folder", "Close Folder")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;

    // Edit-mode items (#013). Save goes to File; Edit Mode and Discard are
    // split between File and View so the shortcut groups stay conventional.
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let discard_changes = MenuItemBuilder::with_id("discard-changes", "Discard Changes")
        .build(app)?;

    let builder = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&open_folder)
        .item(&recent_files)
        .item(&recent_folders)
        .separator()
        .item(&save)
        .item(&discard_changes)
        .item(&reload_file)
        .item(&rescan_folder)
        .separator()
        .item(&export_menu)
        .item(&print)
        .separator()
        .item(&reveal);

    #[cfg(target_os = "macos")]
    let open_with = MenuItemBuilder::with_id("open-with", "Open With…")
        .accelerator("Alt+CmdOrCtrl+O")
        .build(app)?;
    #[cfg(target_os = "macos")]
    let builder = builder.item(&open_with);

    let builder = builder.separator().item(&close_tab).item(&close_folder);

    #[cfg(not(target_os = "macos"))]
    let quit = MenuItemBuilder::with_id("quit", "Quit")
        .accelerator("Ctrl+Q")
        .build(app)?;
    #[cfg(not(target_os = "macos"))]
    let builder = builder.separator().item(&quit);

    let file_menu = builder.build()?;

    let mut file_items = vec![
        save,
        discard_changes,
        reload_file,
        export_html,
        export_markdown,
        print,
        reveal,
        close_tab,
    ];
    #[cfg(target_os = "macos")]
    file_items.push(open_with);

    let folder_items = vec![rescan_folder, close_folder];

    Ok((
        file_menu,
        file_items,
        folder_items,
        recent_files,
        recent_folders,
    ))
}

fn edit_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let builder = SubmenuBuilder::new(app, "Edit");

    // Custom Undo/Redo so the frontend can route them through the per-tab
    // block-commit history when focus is outside a CodeMirror editor (see
    // #013). The macOS auto-provided undo/redo are skipped on purpose.
    let undo = MenuItemBuilder::with_id("undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;

    let find = MenuItemBuilder::with_id("find", "Find…")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;

    builder
        .item(&undo)
        .item(&redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()
}

fn view_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let command_palette = MenuItemBuilder::with_id("command-palette", "Command Palette")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let edit_mode = MenuItemBuilder::with_id("edit-mode", "Edit Mode")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let source_view = MenuItemBuilder::with_id("source-view", "Source View")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let split_right = MenuItemBuilder::with_id("split-right", "Split Right")
        .accelerator("CmdOrCtrl+\\")
        .build(app)?;
    let split_down = MenuItemBuilder::with_id("split-down", "Split Down")
        .accelerator("CmdOrCtrl+Shift+\\")
        .build(app)?;
    let close_split = MenuItemBuilder::with_id("close-split", "Close Split").build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom-in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;

    let builder = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .separator()
        .item(&edit_mode)
        .item(&source_view)
        .separator()
        .item(&split_right)
        .item(&split_down)
        .item(&close_split)
        .separator()
        .item(&zoom_reset)
        .item(&zoom_in)
        .item(&zoom_out)
        .separator();

    #[cfg(target_os = "macos")]
    let builder = builder.fullscreen_with_text("Enter Full Screen");

    #[cfg(not(target_os = "macos"))]
    let builder = {
        let toggle_fullscreen = MenuItemBuilder::with_id("toggle-fullscreen", "Toggle Full Screen")
            .accelerator("F11")
            .build(app)?;
        builder.item(&toggle_fullscreen)
    };

    builder.build()
}

#[cfg(target_os = "macos")]
fn window_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .build()?;
    // Makes AppKit add "Bring All to Front" plus the window list for us.
    submenu.set_as_windows_menu_for_nsapp()?;
    Ok(submenu)
}

fn help_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let help_github = MenuItemBuilder::with_id("help-github", "Marky on GitHub").build(app)?;
    let help_issue = MenuItemBuilder::with_id("help-issue", "Report an Issue").build(app)?;

    let builder = SubmenuBuilder::new(app, "Help");

    #[cfg(not(target_os = "macos"))]
    let builder = builder.about_with_text("About Marky", None).separator();

    let submenu = builder.item(&help_github).item(&help_issue).build()?;

    #[cfg(target_os = "macos")]
    submenu.set_as_help_menu_for_nsapp()?;

    Ok(submenu)
}

/// Parsed intent of a menu id. Most ids are simply forwarded to the frontend
/// as `menu://action`; a handful are handled entirely in Rust.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuCommand {
    OpenUrl(&'static str),
    Quit,
    ToggleFullscreen,
    Forward(String),
}

/// Pure mapping from a menu item id to the command it represents. Kept free
/// of side effects so it's easy to unit test.
pub fn parse_menu_id(id: &str) -> MenuCommand {
    match id {
        "help-github" => MenuCommand::OpenUrl("https://github.com/GRVYDEV/marky"),
        "help-issue" => MenuCommand::OpenUrl("https://github.com/GRVYDEV/marky/issues/new"),
        "quit" => MenuCommand::Quit,
        "toggle-fullscreen" => MenuCommand::ToggleFullscreen,
        other => MenuCommand::Forward(other.to_string()),
    }
}

/// Route a native menu click. Ids not handled here are forwarded to the
/// frontend on `menu://action` for `App.tsx` to dispatch.
pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    match parse_menu_id(event.id().as_ref()) {
        MenuCommand::OpenUrl(url) => {
            if let Err(err) = app.opener().open_url(url, None::<&str>) {
                eprintln!("menu: failed to open {url}: {err}");
            }
        }
        MenuCommand::Quit => app.exit(0),
        MenuCommand::ToggleFullscreen => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(is_fullscreen) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!is_fullscreen);
                }
            }
        }
        MenuCommand::Forward(id) => {
            if let Some(rest) = id.strip_prefix("recent-file:") {
                handle_recent_target(app, rest);
                return;
            }
            if let Some(rest) = id.strip_prefix("recent-folder:") {
                handle_recent_target(app, rest);
                return;
            }
            if id == "clear-recent-files" || id == "clear-recent-folders" {
                handle_clear_recent(app, id == "clear-recent-files");
                return;
            }
            let _ = app.emit("menu://action", id);
        }
    }
}

fn handle_recent_target(app: &AppHandle, path: &str) {
    crate::handle_target(app, crate::cli::classify(Path::new(path)));
}

fn handle_clear_recent(app: &AppHandle, files: bool) {
    let registry = app.state::<SharedRegistry>();
    if files {
        registry.clear_recent_files();
    } else {
        registry.clear_recent_folders();
    }
    let _ = registry.save(&crate::settings::data_dir());
    let _ = refresh_recent(app);
}

/// Rebuild the "Open Recent" and "Open Recent Folder" submenus from current
/// settings. Caps display at 10 items per side. Idempotent.
pub fn refresh_recent(app: &AppHandle) -> tauri::Result<()> {
    let handles = app.state::<MenuHandles>();
    let registry = app.state::<SharedRegistry>();
    let settings = registry.settings();

    refresh_one_submenu(
        app,
        &handles.recent_files,
        &settings.recent_files,
        "recent-file:",
        "clear-recent-files",
    )?;

    refresh_one_submenu(
        app,
        &handles.recent_folders,
        &settings.recent_folders,
        "recent-folder:",
        "clear-recent-folders",
    )?;

    Ok(())
}

fn refresh_one_submenu(
    app: &AppHandle,
    submenu: &Submenu<Wry>,
    items: &[String],
    id_prefix: &str,
    clear_id: &str,
) -> tauri::Result<()> {
    // Clear existing items.
    while let Ok(existing) = submenu.items() {
        if existing.is_empty() {
            break;
        }
        if submenu.remove_at(0).is_err() {
            break;
        }
    }

    if items.is_empty() {
        let _ = submenu.set_enabled(false);
        return Ok(());
    }

    let _ = submenu.set_enabled(true);

    let display_count = items.len().min(10);
    for path in &items[..display_count] {
        let label = format_label(path);
        let id = format!("{id_prefix}{path}");
        let menu_item = MenuItemBuilder::with_id(&id, &label).build(app)?;
        submenu.append(&menu_item)?;
    }

    let separator = PredefinedMenuItem::separator(app)?;
    submenu.append(&separator)?;

    let clear_label = if id_prefix == "recent-file:" {
        "Clear Menu"
    } else {
        "Clear Menu"
    };
    let clear_item = MenuItemBuilder::with_id(clear_id, clear_label).build(app)?;
    submenu.append(&clear_item)?;

    Ok(())
}

fn format_label(path: &str) -> String {
    let p = Path::new(path);
    let file_name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    let parent_display = p
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|n| n.to_string_lossy().to_string());

    match parent_display {
        Some(parent) => format!("{file_name} — {parent}"),
        None => file_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_help_github() {
        assert_eq!(
            parse_menu_id("help-github"),
            MenuCommand::OpenUrl("https://github.com/GRVYDEV/marky")
        );
    }

    #[test]
    fn parses_help_issue() {
        assert_eq!(
            parse_menu_id("help-issue"),
            MenuCommand::OpenUrl("https://github.com/GRVYDEV/marky/issues/new")
        );
    }

    #[test]
    fn parses_quit() {
        assert_eq!(parse_menu_id("quit"), MenuCommand::Quit);
    }

    #[test]
    fn parses_toggle_fullscreen() {
        assert_eq!(
            parse_menu_id("toggle-fullscreen"),
            MenuCommand::ToggleFullscreen
        );
    }

    #[test]
    fn forwards_unrecognized_ids() {
        assert_eq!(
            parse_menu_id("close-tab"),
            MenuCommand::Forward("close-tab".to_string())
        );
    }

    #[test]
    fn parses_recent_file_id() {
        assert_eq!(
            parse_menu_id("recent-file:/abs/path.md"),
            MenuCommand::Forward("recent-file:/abs/path.md".to_string())
        );
    }

    #[test]
    fn parses_recent_folder_id() {
        assert_eq!(
            parse_menu_id("recent-folder:/abs/folder"),
            MenuCommand::Forward("recent-folder:/abs/folder".to_string())
        );
    }

    #[test]
    fn parses_clear_recent_files() {
        assert_eq!(
            parse_menu_id("clear-recent-files"),
            MenuCommand::Forward("clear-recent-files".to_string())
        );
    }

    #[test]
    fn parses_clear_recent_folders() {
        assert_eq!(
            parse_menu_id("clear-recent-folders"),
            MenuCommand::Forward("clear-recent-folders".to_string())
        );
    }
}
