use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Save the given standalone HTML export to a user-chosen path.
///
/// Returns `Ok(None)` if the user cancels the save dialog.
pub fn export_html(app: &AppHandle, html: String, suggested_name: String) -> AppResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(suggested_name)
        .blocking_save_file();

    let fp = match picked {
        Some(fp) => fp,
        None => return Ok(None),
    };

    let mut path = fp.into_path().map_err(|e| AppError::Invalid(e.to_string()))?;
    ensure_extension(&mut path, "html");
    write_html(&path, &html)?;

    Ok(Some(path.to_str().ok_or(AppError::NonUtf8Path)?.to_string()))
}

/// Copy the markdown file at `source_path` to a user-chosen destination.
///
/// Returns `Ok(None)` if the user cancels the save dialog.
pub fn export_markdown(app: &AppHandle, source_path: String) -> AppResult<Option<String>> {
    let src = PathBuf::from(&source_path);
    if !src.is_absolute() {
        return Err(AppError::Invalid("source path must be absolute".into()));
    }
    std::fs::metadata(&src).map_err(AppError::Io)?;

    let default_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.md");

    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdx"])
        .set_file_name(default_name)
        .blocking_save_file();

    let fp = match picked {
        Some(fp) => fp,
        None => return Ok(None),
    };

    let mut dest = fp.into_path().map_err(|e| AppError::Invalid(e.to_string()))?;
    ensure_extension(&mut dest, "md");

    let dest_str = dest.to_str().ok_or(AppError::NonUtf8Path)?.to_string();

    // If the destination resolves to the same file as the source, skip the
    // copy entirely rather than truncating the file we're reading from.
    if src.canonicalize().ok() == dest.canonicalize().ok() {
        return Ok(Some(dest_str));
    }

    copy_markdown(&src, &dest)?;

    Ok(Some(dest_str))
}

/// If `path` has no extension, set it to `default_ext`.
fn ensure_extension(path: &mut PathBuf, default_ext: &str) {
    if path.extension().is_none() {
        path.set_extension(default_ext);
    }
}

/// Write standalone HTML to `path`.
pub fn write_html(path: &Path, html: &str) -> AppResult<()> {
    std::fs::write(path, html)?;
    Ok(())
}

/// Byte-for-byte copy of the markdown source file to `dest`.
pub fn copy_markdown(src: &Path, dest: &Path) -> AppResult<()> {
    // `std::fs::copy` opens `dest` with truncate+create before reading
    // `src`; if both paths are literally identical this destroys the file's
    // contents. Note this is a plain path-equality check, distinct from the
    // canonicalize-based same-file guard in `export_markdown`.
    if src == dest {
        return Ok(());
    }
    std::fs::copy(src, dest).map(|_| ())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_path(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        dir.path().join(name)
    }

    #[test]
    fn ensure_extension_adds_html_when_missing() {
        let mut p = PathBuf::from("/tmp/export");
        ensure_extension(&mut p, "html");
        assert_eq!(p, PathBuf::from("/tmp/export.html"));
    }

    #[test]
    fn ensure_extension_preserves_existing_html() {
        let mut p = PathBuf::from("/tmp/export.html");
        ensure_extension(&mut p, "html");
        assert_eq!(p, PathBuf::from("/tmp/export.html"));
    }

    #[test]
    fn ensure_extension_preserves_markdown_mdx_txt() {
        for ext in ["markdown", "mdx", "txt"] {
            let mut p = PathBuf::from(format!("/tmp/export.{ext}"));
            ensure_extension(&mut p, "md");
            assert_eq!(p, PathBuf::from(format!("/tmp/export.{ext}")));
        }
    }

    #[test]
    fn write_html_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir, "out.html");
        write_html(&path, "<html></html>").unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "<html></html>");
    }

    #[test]
    fn copy_markdown_is_byte_identical_including_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let src = temp_path(&dir, "src.md");
        let dest = temp_path(&dir, "dest.md");
        let bytes: &[u8] = &[0xFF, 0xFE, 0x00, 0x41];
        std::fs::write(&src, bytes).unwrap();

        copy_markdown(&src, &dest).unwrap();

        let copied = std::fs::read(&dest).unwrap();
        assert_eq!(copied, bytes);
    }

    #[test]
    fn copy_markdown_onto_same_path_leaves_contents_intact() {
        let dir = tempfile::tempdir().unwrap();
        let src = temp_path(&dir, "same.md");
        std::fs::write(&src, "# Hello\n").unwrap();

        copy_markdown(&src, &src).unwrap();

        let contents = std::fs::read_to_string(&src).unwrap();
        assert_eq!(contents, "# Hello\n");
    }
}
