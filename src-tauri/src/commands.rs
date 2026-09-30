use crate::cli::InitialTarget;
use crate::error::{AppError, AppResult};
use crate::folder::TreeNode;
use crate::registry::SharedRegistry;
use crate::search::{search, SearchResult};
use crate::settings::{data_dir, Folder};
use crate::watcher::{watch_folder, SharedWatchers};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct InitialTargetState(pub Mutex<InitialTarget>);

#[tauri::command]
pub fn get_initial_target(state: State<'_, InitialTargetState>) -> InitialTarget {
    state.0.lock().clone()
}

#[tauri::command]
pub fn set_initial_target(target: InitialTarget, state: State<'_, InitialTargetState>) {
    *state.0.lock() = target;
}

#[tauri::command]
pub fn read_file(
    app: AppHandle,
    path: String,
    registry: State<'_, SharedRegistry>,
    opened: State<'_, crate::OpenedFiles>,
) -> AppResult<String> {
    let contents = crate::fs::read_text(&path)?;
    registry.push_recent(path.clone());
    let _ = registry.save(&data_dir());
    if let Ok(canonical) = std::fs::canonicalize(PathBuf::from(&path)) {
        opened.inner().0.lock().insert(canonical);
    }
    let _ = crate::menu::refresh_recent(&app);
    Ok(contents)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WriteOutcome {
    Saved,
    Conflict { disk: String },
}

#[tauri::command]
pub fn write_file(
    path: String,
    contents: String,
    expected_base: String,
    opened: State<'_, crate::OpenedFiles>,
) -> AppResult<WriteOutcome> {
    let canonical = std::fs::canonicalize(PathBuf::from(&path))
        .map_err(|_| AppError::NotFound(format!("path {path}")))?;
    {
        let set = opened.inner().0.lock();
        if !set.contains(&canonical) {
            return Err(AppError::Invalid(format!(
                "path {path} was not opened in this session"
            )));
        }
    }
    let disk = crate::fs::read_text(&canonical)?;
    if disk != expected_base {
        return Ok(WriteOutcome::Conflict { disk });
    }
    crate::fs::write_text_atomic(&canonical, &contents)?;
    Ok(WriteOutcome::Saved)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct MergeResult {
    pub merged: String,
    pub conflicts: bool,
}

#[tauri::command]
pub fn merge_text(base: String, ours: String, theirs: String) -> AppResult<MergeResult> {
    merge_text_impl(&base, &ours, &theirs)
}

/// Pure helper for testability. The command body delegates here.
pub fn merge_text_impl(base: &str, ours: &str, theirs: &str) -> AppResult<MergeResult> {
    match diffy::merge(base, ours, theirs) {
        Ok(merged) => Ok(MergeResult {
            merged,
            conflicts: false,
        }),
        Err(conflict_text) => Ok(MergeResult {
            merged: conflict_text.to_string(),
            conflicts: true,
        }),
    }
}

#[tauri::command]
pub fn list_folders(registry: State<'_, SharedRegistry>) -> Vec<Folder> {
    registry.folders()
}

#[derive(serde::Serialize)]
pub struct AnnotatedFolder {
    #[serde(flatten)]
    pub folder: Folder,
    pub repo_root: Option<String>,
    pub repo_name: Option<String>,
}

#[tauri::command]
pub fn list_folders_grouped(registry: State<'_, SharedRegistry>) -> Vec<AnnotatedFolder> {
    registry
        .folders()
        .into_iter()
        .map(|f| {
            let repo_root =
                crate::folder::find_git_repo_root(std::path::Path::new(&f.path));
            let repo_name = repo_root.as_ref().and_then(|r| {
                std::path::Path::new(r)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(String::from)
            });
            AnnotatedFolder {
                folder: f,
                repo_root,
                repo_name,
            }
        })
        .collect()
}

#[tauri::command]
pub fn add_folder(
    app: AppHandle,
    path: String,
    registry: State<'_, SharedRegistry>,
    watchers: State<'_, SharedWatchers>,
) -> AppResult<Folder> {
    let folder = registry.add_folder(PathBuf::from(&path))?;
    registry.save(&data_dir())?;
    registry.push_recent_folder(folder.path.clone());
    let _ = registry.save(&data_dir());
    if let Ok(handle) = watch_folder(
        app.clone(),
        Arc::clone(&registry),
        folder.id.clone(),
        PathBuf::from(&folder.path),
    ) {
        watchers.insert(folder.id.clone(), handle);
    }
    let _ = app.emit("folder://changed", &folder.id);
    let _ = crate::menu::refresh_recent(&app);
    Ok(folder)
}

#[tauri::command]
pub fn remove_folder(
    app: AppHandle,
    id: String,
    registry: State<'_, SharedRegistry>,
    watchers: State<'_, SharedWatchers>,
) -> AppResult<()> {
    registry.remove_folder(&id);
    watchers.remove(&id);
    registry.save(&data_dir())?;
    let _ = app.emit("folder://changed", &id);
    Ok(())
}

#[tauri::command]
pub fn rescan_folder(
    app: AppHandle,
    id: String,
    registry: State<'_, SharedRegistry>,
    watchers: State<'_, SharedWatchers>,
) -> AppResult<()> {
    registry.refresh_folder(&id);
    let folder = registry.folders().into_iter().find(|v| v.id == id);
    if let Some(v) = folder {
        if let Ok(handle) = watch_folder(
            app.clone(),
            Arc::clone(&registry),
            v.id.clone(),
            PathBuf::from(&v.path),
        ) {
            watchers.remove(&v.id);
            watchers.insert(v.id.clone(), handle);
        }
    }
    let _ = app.emit("folder://changed", &id);
    Ok(())
}

#[tauri::command]
pub fn read_folder_tree(id: String, registry: State<'_, SharedRegistry>) -> AppResult<TreeNode> {
    registry
        .tree(&id)
        .ok_or_else(|| AppError::NotFound(format!("folder {id}")))
}

#[derive(serde::Deserialize)]
pub struct SearchArgs {
    pub query: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    50
}

#[tauri::command]
pub fn search_files(
    args: SearchArgs,
    registry: State<'_, SharedRegistry>,
) -> Vec<SearchResult> {
    let snapshot = registry.index_snapshot();
    search(&snapshot, &args.query, args.limit)
}

#[tauri::command]
pub fn get_recent_files(registry: State<'_, SharedRegistry>) -> Vec<String> {
    registry.settings().recent_files
}

#[tauri::command]
pub fn save_theme(theme: String, registry: State<'_, SharedRegistry>) -> AppResult<()> {
    registry.save_with(&data_dir(), |s| s.theme = Some(theme))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct PreferencesPayload {
    pub zoom: Option<f64>,
    pub sidebar_left_width: Option<u32>,
    pub sidebar_right_width: Option<u32>,
    pub copy_as_markdown: Option<bool>,
    pub sidebar_group_by_repo: Option<bool>,
}

#[tauri::command]
pub fn save_preferences(
    prefs: PreferencesPayload,
    registry: State<'_, SharedRegistry>,
) -> AppResult<()> {
    registry.save_with(&data_dir(), |s| {
        s.zoom = prefs.zoom;
        s.sidebar_left_width = prefs.sidebar_left_width;
        s.sidebar_right_width = prefs.sidebar_right_width;
        s.copy_as_markdown = prefs.copy_as_markdown;
        s.sidebar_group_by_repo = prefs.sidebar_group_by_repo;
    })
}

#[tauri::command]
pub fn load_preferences(registry: State<'_, SharedRegistry>) -> PreferencesPayload {
    let s = registry.settings();
    PreferencesPayload {
        zoom: s.zoom,
        sidebar_left_width: s.sidebar_left_width,
        sidebar_right_width: s.sidebar_right_width,
        copy_as_markdown: s.copy_as_markdown,
        sidebar_group_by_repo: s.sidebar_group_by_repo,
    }
}

#[tauri::command]
pub fn set_menu_state(
    has_file: bool,
    has_folder: bool,
    handles: State<'_, crate::menu::MenuHandles>,
) {
    for item in &handles.file_items {
        let _ = item.set_enabled(has_file);
    }
    for item in &handles.folder_items {
        let _ = item.set_enabled(has_folder);
    }
}

#[tauri::command]
pub async fn open_with(app: AppHandle, path: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_dialog::DialogExt;
        use tauri_plugin_opener::OpenerExt;

        // Synchronous pick inside an async command per the plan
        let chosen = app
            .dialog()
            .file()
            .set_directory("/Applications")
            .add_filter("Applications", &["app"])
            .blocking_pick_file();

        let Some(chosen) = chosen else { return Ok(()) };
        let app_path = match chosen.into_path() {
            Ok(p) => p,
            Err(e) => return Err(AppError::Invalid(format!("invalid app path: {e}"))),
        };

        app.opener()
            .open_path(path, Some(app_path.to_string_lossy().to_string()))
            .map_err(|e| AppError::Invalid(format!("opener: {e}")))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, path);
        Err(AppError::Invalid("unsupported on this platform".to_string()))
    }
}

#[tauri::command]
pub async fn export_html(app: AppHandle, html: String, suggested_name: String) -> AppResult<Option<String>> {
    crate::export::export_html(&app, html, suggested_name)
}

#[tauri::command]
pub async fn export_markdown(app: AppHandle, source_path: String) -> AppResult<Option<String>> {
    crate::export::export_markdown(&app, source_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_clean_keeps_unique_changes() {
        // Ours changes the top, theirs changes the bottom: independent hunks.
        let r = merge_text_impl(
            "shared-a\nshared-b\nshared-c\n",
            "ours-top\nshared-a\nshared-b\nshared-c\n",
            "shared-a\nshared-b\nshared-c\ntheirs-bottom\n",
        )
        .unwrap();
        assert!(!r.conflicts);
        assert!(r.merged.contains("ours-top"));
        assert!(r.merged.contains("theirs-bottom"));
    }

    #[test]
    fn merge_conflict_emits_markers() {
        let r = merge_text_impl(
            "line1\nline2\nline3\n",
            "line1\nours2\nline3\n",
            "line1\ntheirs2\nline3\n",
        )
        .unwrap();
        assert!(r.conflicts);
        assert!(r.merged.contains("<<<<<<<"));
        assert!(r.merged.contains(">>>>>>>"));
    }
}
