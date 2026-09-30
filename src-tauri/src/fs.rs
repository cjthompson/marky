use crate::error::{AppError, AppResult};
use atomic_write_file::OpenOptions as AtomicOpenOptions;
use std::path::Path;

#[cfg(unix)]
use atomic_write_file::unix::OpenOptionsExt;

const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024; // 25 MB

pub fn read_text<P: AsRef<Path>>(path: P) -> AppResult<String> {
    let path = path.as_ref();
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(AppError::Invalid(format!(
            "file too large: {} bytes (max {})",
            meta.len(),
            MAX_FILE_BYTES
        )));
    }
    let bytes = std::fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| AppError::Invalid("file is not valid UTF-8".into()))
}

/// Write `contents` atomically to `path`. Symlinks are followed: the file
/// pointed to by the link is rewritten and the link itself is preserved.
pub fn write_text_atomic<P: AsRef<Path>>(path: P, contents: &str) -> AppResult<()> {
    if contents.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::Invalid(format!(
            "write too large: {} bytes (max {})",
            contents.len(),
            MAX_FILE_BYTES
        )));
    }
    let target = std::fs::canonicalize(path.as_ref())?;
    let mut opts = AtomicOpenOptions::new();
    #[cfg(unix)]
    {
        opts.try_preserve_owner(true);
    }
    let mut f = opts.open(&target)?;
    use std::io::Write;
    f.write_all(contents.as_bytes())?;
    f.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs as unixfs;
    use tempfile::tempdir;

    #[test]
    fn reads_text_file() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "hello\n").unwrap();
        assert_eq!(read_text(&p).unwrap(), "hello\n");
    }

    #[test]
    fn rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("bad.md");
        fs::write(&p, [0xff, 0xfe, 0xfd]).unwrap();
        assert!(matches!(read_text(&p), Err(AppError::Invalid(_))));
    }

    #[test]
    fn missing_file_returns_io_err() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("missing.md");
        assert!(matches!(read_text(&p), Err(AppError::Io(_))));
    }

    #[test]
    fn writes_atomically_to_canonical_target() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "old\n").unwrap();
        write_text_atomic(&p, "new\n").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new\n");
    }

    #[test]
    fn writes_through_symlink_and_keeps_link() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("real.md");
        let link = dir.path().join("alias.md");
        fs::write(&target, "old\n").unwrap();
        unixfs::symlink(&target, &link).unwrap();

        write_text_atomic(&link, "new\n").unwrap();

        // Target content rewritten, link still points at the same file.
        assert_eq!(fs::read_to_string(&target).unwrap(), "new\n");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
    }

    #[test]
    fn rejects_oversize_write() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("big.md");
        fs::write(&p, "x").unwrap();
        let huge = "a".repeat((MAX_FILE_BYTES + 1) as usize);
        assert!(matches!(
            write_text_atomic(&p, &huge),
            Err(AppError::Invalid(_))
        ));
    }
}