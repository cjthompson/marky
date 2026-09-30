//! Markdown lint pipeline.
//!
//! Runs `rumdl` (lib `rumdl_lib`) with MD013 disabled, discovers a per-file
//! `.rumdl.toml` if one is reachable, and overlays a YAML front-matter validity
//! check using `yaml-rust2`. Pure helper [`lint_impl`] is the workhorse; the
//! `#[tauri::command]` wrapper in `commands.rs` runs it on a blocking task so a
//! panic inside rumdl never tears down the UI.

use rumdl_lib::config::{Config, MarkdownFlavor};
use rumdl_lib::lint as rumdl_lint;
use rumdl_lib::rule::{Fix, LintWarning, Severity};
use rumdl_lib::rules::all_rules;
use serde::{Deserialize, Serialize};
use std::path::Path;
use yaml_rust2::{ScanError, YamlLoader};

/// Front-matter YAML rule id. Stable across releases — used by the toolbar
/// badge and the editor's quick-fix menu to look up lint hits that came from
/// this module rather than rumdl proper.
pub const YAML_RULE: &str = "MD041Y";

/// Diagnostic shape shared with the frontend. Mirrors `Diagnostic` in
/// `src/lib/workspace.ts:18`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Diagnostic {
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub rule: String,
    pub message: String,
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<DiagnosticFix>,
}

/// `Fix` translated into the frontend's `(from_line, from_col, to_line, to_col,
/// replacement)` tuple. `Fix::range` from rumdl is **byte offsets**, so we
/// convert them to (line, column) by walking the document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiagnosticFix {
    pub from_line: u32,
    pub from_col: u32,
    pub to_line: u32,
    pub to_col: u32,
    pub replacement: String,
}

/// Run lint on `contents`. `source_path` is used only for config discovery
/// (walk up from its directory to find `.rumdl.toml`) and is passed through to
/// rumdl so rule messages can quote the file name. `None` means "ad-hoc /
/// unsaved content": rumdl still runs with the built-in default config.
pub fn lint_impl(contents: &str, source_path: Option<&Path>) -> Vec<Diagnostic> {
    let config = build_config(source_path);
    let rules = all_rules(&config);
    let mut diagnostics = Vec::new();

    let warnings = match rumdl_lint(
        contents,
        &rules,
        false,
        MarkdownFlavor::Standard,
        source_path.map(|p| p.to_path_buf()),
        Some(&config),
    ) {
        Ok(ws) => ws,
        Err(_) => return diagnostics,
    };
    for w in warnings {
        diagnostics.push(convert_warning(contents, w));
    }
    if let Some(yaml_diag) = yaml_check(contents) {
        diagnostics.push(yaml_diag);
    }
    diagnostics
}

fn build_config(source_path: Option<&Path>) -> Config {
    let mut config = Config::default();
    // MD013 (line length) is per the plan's defaults: disabled so long prose
    // lines pass without complaint.
    config.global.disable.push("MD013".to_string());
    if let Some(path) = source_path {
        if let Some(parent) = path.parent() {
            discover_rumdl_toml(parent, &mut config);
        }
    }
    config
}

/// Walk up from `dir` looking for `.rumdl.toml` or `rumdl.toml`. Found files
/// apply their `global.disable` / `disable` / `enable` keys on top of our
/// defaults; everything else is ignored. Errors are swallowed — fall back to
/// the default rules.
fn discover_rumdl_toml(dir: &Path, config: &mut Config) {
    const NAMES: &[&str] = &[".rumdl.toml", "rumdl.toml"];
    let mut cur: Option<&Path> = Some(dir);
    while let Some(d) = cur {
        for name in NAMES {
            let p = d.join(name);
            if p.is_file() {
                if let Ok(raw) = std::fs::read_to_string(&p) {
                    if let Ok(parsed) = toml::from_str::<toml::Value>(&raw) {
                        apply_overrides(&parsed, config);
                        return;
                    }
                }
            }
        }
        cur = d.parent();
    }
}

fn apply_overrides(toml: &toml::Value, config: &mut Config) {
    if let Some(disable) = toml.get("global").and_then(|g| g.get("disable")).and_then(|d| d.as_array()) {
        push_all_strings(disable, &mut config.global.disable);
    }
    if let Some(disable) = toml.get("disable").and_then(|d| d.as_array()) {
        push_all_strings(disable, &mut config.global.disable);
    }
    if let Some(enable) = toml.get("enable").and_then(|d| d.as_array()) {
        config.global.enable.clear();
        push_all_strings(enable, &mut config.global.enable);
    }
}

fn push_all_strings(arr: &toml::value::Array, target: &mut Vec<String>) {
    for entry in arr {
        if let Some(s) = entry.as_str() {
            if !target.iter().any(|x| x == s) {
                target.push(s.to_string());
            }
        }
    }
}

fn convert_warning(contents: &str, w: LintWarning) -> Diagnostic {
    let severity = match w.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "info",
    }
    .to_string();
    let fix = w.fix.map(|f| convert_fix(contents, &f));
    Diagnostic {
        line: w.line as u32,
        column: w.column as u32,
        end_line: w.end_line as u32,
        end_column: w.end_column as u32,
        rule: w.rule_name.unwrap_or_default(),
        message: w.message,
        severity,
        fix,
    }
}

fn convert_fix(contents: &str, fix: &Fix) -> DiagnosticFix {
    let (from_line, from_col) = byte_to_line_col(contents, fix.range.start);
    let (to_line, to_col) = byte_to_line_col(contents, fix.range.end);
    DiagnosticFix {
        from_line,
        from_col,
        to_line,
        to_col,
        replacement: fix.replacement.clone(),
    }
}

/// Convert a byte offset into `(line, column)` where both are 1-indexed and
/// the column is measured in UTF-8 characters. This mirrors how rumdl reports
/// positions, so the same byte offset yields matching coordinates.
fn byte_to_line_col(contents: &str, byte: usize) -> (u32, u32) {
    let mut line: u32 = 1;
    let mut col_chars: u32 = 1;
    for (i, ch) in contents.char_indices() {
        if i >= byte {
            return (line, col_chars);
        }
        if ch == '\n' {
            line += 1;
            col_chars = 1;
        } else {
            col_chars += 1;
        }
    }
    (line, col_chars)
}

/// Front-matter YAML validity check. The plan calls for: "Front matter is
/// invisible in the rendered view, so broken YAML would otherwise go
/// unnoticed." We emit a single Diagnostic at the front-matter's document line
/// (1-indexed) with the YAML parser's own line number inside the message body.
pub fn yaml_check(contents: &str) -> Option<Diagnostic> {
    let (yaml_start_line, yaml_block) = extract_front_matter(contents)?;
    if let Err(err) = YamlLoader::load_from_str(yaml_block) {
        return Some(yaml_error_to_diag(&err, yaml_start_line));
    }
    None
}

fn extract_front_matter(contents: &str) -> Option<(u32, &str)> {
    // Front matter is `---\n...\n---\n` at the top of the file.
    let first = contents.strip_prefix("---")?;
    let after_open = first.strip_prefix('\n').or_else(|| first.strip_prefix("\r\n"))?;
    let closing = after_open.find("\n---")?;
    let yaml_block = &after_open[..closing];
    // Document line where the YAML body begins (line 1 = the opening `---`).
    Some((2, yaml_block))
}

fn yaml_error_to_diag(err: &ScanError, yaml_start_line: u32) -> Diagnostic {
    let inner_line = err.marker().line() as u32;
    let inner_col = err.marker().col() as u32;
    let doc_line = yaml_start_line + inner_line.saturating_sub(1);
    Diagnostic {
        line: doc_line,
        column: inner_col,
        end_line: doc_line,
        end_column: inner_col.saturating_add(1),
        rule: YAML_RULE.to_string(),
        message: format!("Invalid YAML front matter: {} (line {})", err.info(), inner_line),
        severity: "error".to_string(),
        fix: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Heading increment (MD001) detection — H1 → H3 should fail.
    #[test]
    fn detects_md001_heading_increment() {
        let md = "# H1\n\n### H3 skip\n\n## H2\n";
        let diags = lint_impl(md, None);
        assert!(
            diags.iter().any(|d| d.rule == "MD001"),
            "expected MD001 hit, got {:?}",
            diags
        );
    }

    /// Conflict markers — MD092 fires on `<<<<<<<` / `=======` / `>>>>>>>`.
    #[test]
    fn detects_md092_conflict_markers() {
        let md = "<<<<<<< HEAD\nline1\n=======\nline2\n>>>>>>> branch\n";
        let diags = lint_impl(md, None);
        assert!(
            diags.iter().any(|d| d.rule == "MD092"),
            "expected MD092 hit, got {:?}",
            diags
        );
    }

    /// Bad front-matter YAML — `yaml-rust2::ScanError` becomes a single
    /// Diagnostic with rule id `MD041Y` at the line of the YAML error.
    #[test]
    fn detects_bad_front_matter_yaml() {
        let md = "---\ntitle: Test\ninvalid: [unclosed bracket\n---\n\n# Body\n";
        let diags = lint_impl(md, None);
        let yaml_diag = diags.iter().find(|d| d.rule == YAML_RULE);
        assert!(yaml_diag.is_some(), "expected yaml diagnostic, got {:?}", diags);
        let d = yaml_diag.unwrap();
        assert_eq!(d.severity, "error");
        assert!(d.line >= 2, "front-matter starts at line 2");
        assert!(d.message.contains("Invalid YAML"));
    }

    /// MD013 (line length) is off by default — a 200-char single line returns
    /// no MD013 diagnostic.
    #[test]
    fn md013_disabled_by_default() {
        let long = format!("# H\n\n{}", "a".repeat(200));
        let diags = lint_impl(&long, None);
        assert!(
            !diags.iter().any(|d| d.rule == "MD013"),
            "MD013 should be disabled; got {:?}",
            diags
        );
    }

    /// No front matter → no YAML diagnostic.
    #[test]
    fn no_front_matter_no_yaml_diagnostic() {
        let md = "# Just a heading\n\nNo front matter here.";
        let diags = lint_impl(md, None);
        assert!(
            !diags.iter().any(|d| d.rule == YAML_RULE),
            "expected no YAML diagnostic, got {:?}",
            diags
        );
    }

    /// Fix ranges from rumdl come back as byte offsets; we convert them into
    /// (line, col) by walking the document.
    #[test]
    fn fix_range_maps_to_line_col() {
        let md = "# H1\n\n### H3 skip\n";
        let diags = lint_impl(md, None);
        let md001 = diags.iter().find(|d| d.rule == "MD001").expect("MD001");
        let fix = md001.fix.as_ref().expect("fix");
        // The MD001 fix rewrites `### H3 skip` on line 3.
        assert_eq!(fix.from_line, 3);
        assert_eq!(fix.to_line, 3);
        assert!(fix.replacement.starts_with("##"), "got {:?}", fix.replacement);
    }
}
