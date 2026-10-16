//! Thư mục trạng thái soạn thảo `.mat-editor/` của trình vẽ SVG (feature 011, contracts/svg-editor.md §6,
//! FR-105, FR-112) và danh sách tệp SVG của project (cây "Đồ họa SVG", FR-097).
//!
//! Đọc và ghi nội dung đi qua `project_read`/`project_write` có sẵn (đường dẫn `.mat-editor/...` qua
//! `check_rel`, ghi atomic). Ở đây chỉ có những việc hai lệnh đó không làm: liệt kê và xóa bản tự lưu
//! (chỉ trong `.mat-editor/autosave/`), và liệt kê `*.svg` của project (bỏ thư mục bắt đầu bằng dấu chấm).
//! Không đi ra ngoài thư mục project kể cả qua symlink/junction.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::project_fs::{check_rel, mtime_ms};

/// Thư mục trạng thái soạn thảo (không vào gói, không vào digest).
pub const EDITOR_DIR: &str = ".mat-editor";
/// Thư mục con được phép liệt kê và xóa.
pub const AUTOSAVE_DIR: &str = "autosave";
/// Trần số mục trả về (danh sách tự lưu, danh sách SVG).
pub const MAX_ENTRIES: usize = 2000;
/// Độ sâu thư mục tối đa khi tìm SVG (như số cấp thư mục cha của `project_write`).
pub const MAX_SVG_DEPTH: usize = 8;

/// Một tệp trong `.mat-editor/autosave/`: tên (không đường dẫn), mtime (ms UTC), cỡ (byte).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    pub name: String,
    pub mtime_ms: u64,
    pub size: u64,
}

/// Lỗi của `editor_remove`: `"bad-path"`, `"missing"`, `{ "io": … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorError {
    BadPath,
    Missing,
    Io(String),
}

/// Thư mục thật của `.mat-editor/<sub>` nếu có và nằm trong project (không qua symlink ra ngoài).
fn editor_subdir(root: &Path, sub: &str) -> Option<std::path::PathBuf> {
    let root = fs::canonicalize(root).ok()?;
    let dir = root.join(EDITOR_DIR).join(sub);
    let meta = fs::symlink_metadata(&dir).ok()?;
    if !meta.is_dir() {
        return None;
    }
    let real = fs::canonicalize(&dir).ok()?;
    real.starts_with(&root).then_some(real)
}

/// Tệp thường trong `.mat-editor/<sub>/` (`sub` chỉ là `autosave`), sắp theo tên. Thư mục chưa có: rỗng.
pub fn editor_list(root: &Path, sub: &str) -> Result<Vec<EditorFile>, EditorError> {
    if sub != AUTOSAVE_DIR {
        return Err(EditorError::BadPath);
    }
    let Some(dir) = editor_subdir(root, sub) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| EditorError::Io(e.to_string()))? {
        let Ok(e) = e else { continue };
        let Ok(meta) = fs::symlink_metadata(e.path()) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || check_rel(&format!("{EDITOR_DIR}/{sub}/{name}")).is_err() {
            continue; // file tạm `.x.tmp-<pid>` của lần ghi dở, tên lạ
        }
        out.push(EditorFile {
            name,
            mtime_ms: mtime_ms(&meta),
            size: meta.len(),
        });
        if out.len() >= MAX_ENTRIES {
            break;
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Xóa một tệp `.mat-editor/autosave/<tên>` (bản tự lưu cũ, hoặc sau khi lưu thật).
pub fn editor_remove(root: &Path, rel: &str) -> Result<(), EditorError> {
    let prefix = format!("{EDITOR_DIR}/{AUTOSAVE_DIR}/");
    let Some(name) = rel.strip_prefix(&prefix) else {
        return Err(EditorError::BadPath);
    };
    if name.contains('/') || check_rel(rel).is_err() {
        return Err(EditorError::BadPath);
    }
    let Some(dir) = editor_subdir(root, AUTOSAVE_DIR) else {
        return Err(EditorError::Missing);
    };
    let path = dir.join(name);
    match fs::symlink_metadata(&path) {
        Ok(m) if m.is_file() => fs::remove_file(&path).map_err(|e| EditorError::Io(e.to_string())),
        Ok(_) => Err(EditorError::BadPath),
        Err(_) => Err(EditorError::Missing),
    }
}

/// Đường dẫn tương đối (dùng `/`) của mọi tệp `.svg` trong project, sắp xếp; bỏ thư mục bắt đầu bằng dấu
/// chấm (`.mat-editor`, `.mat-backup`, `.git`) và symlink; sâu tối đa 8 cấp thư mục; tối đa 2000 tệp.
pub fn list_svg(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(root) = fs::canonicalize(root) else {
        return out;
    };
    let mut stack: Vec<(std::path::PathBuf, String, usize)> =
        vec![(root.clone(), String::new(), 0)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(meta) = fs::symlink_metadata(e.path()) else {
                continue;
            };
            let rel = format!("{prefix}{name}");
            if meta.is_dir() {
                if depth < MAX_SVG_DEPTH {
                    stack.push((e.path(), format!("{rel}/"), depth + 1));
                }
            } else if meta.is_file() && name.ends_with(".svg") && check_rel(&rel).is_ok() {
                out.push(rel);
                if out.len() >= MAX_ENTRIES {
                    out.sort();
                    return out;
                }
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let p =
                std::env::temp_dir().join(format!("mat-editor-fs-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(p.join("project/graphics/symbols")).unwrap();
            fs::create_dir_all(p.join("project/.mat-editor/autosave")).unwrap();
            fs::create_dir_all(p.join("project/.mat-backup/0.1.0-x/graphics")).unwrap();
            fs::write(p.join("project/project.json"), "{}").unwrap();
            fs::write(p.join("project/graphics/a.svg"), "<svg/>").unwrap();
            fs::write(p.join("project/graphics/symbols/b.svg"), "<svg/>").unwrap();
            fs::write(p.join("project/graphics/notes.txt"), "x").unwrap();
            fs::write(
                p.join("project/.mat-backup/0.1.0-x/graphics/a.svg"),
                "<svg/>",
            )
            .unwrap();
            fs::write(p.join("project/.mat-editor/autosave/a.svg"), "<svg/>").unwrap();
            fs::write(p.join("outside.svg"), "<svg/>").unwrap();
            TempDir(p)
        }
        fn root(&self) -> PathBuf {
            self.0.join("project")
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lists_svg_files_skipping_dot_directories() {
        let t = TempDir::new("list");
        assert_eq!(
            list_svg(&t.root()),
            vec!["graphics/a.svg", "graphics/symbols/b.svg"]
        );
    }

    #[test]
    fn lists_svg_down_to_eight_levels() {
        let t = TempDir::new("deep");
        let ok = t.root().join(["d"; 8].join("/"));
        fs::create_dir_all(&ok).unwrap();
        fs::write(ok.join("x.svg"), "<svg/>").unwrap();
        let deep = t.root().join(["e"; 9].join("/"));
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("y.svg"), "<svg/>").unwrap();
        let all = list_svg(&t.root());
        assert!(all.iter().any(|r| r.ends_with("/x.svg")));
        assert!(!all.iter().any(|r| r.ends_with("/y.svg")));
    }

    #[test]
    fn lists_autosave_files_only() {
        let t = TempDir::new("auto");
        fs::write(t.root().join(".mat-editor/autosave/.a.svg.tmp-1"), "x").unwrap();
        let list = editor_list(&t.root(), "autosave").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "a.svg");
        assert_eq!(list[0].size, 6);
        assert!(list[0].mtime_ms > 1_600_000_000_000);
        assert_eq!(
            editor_list(&t.root(), "../graphics"),
            Err(EditorError::BadPath)
        );
        assert_eq!(editor_list(&t.root(), "other"), Err(EditorError::BadPath));
        let json = serde_json::to_value(&list[0]).unwrap();
        assert!(json.get("mtimeMs").is_some());
    }

    #[test]
    fn autosave_list_of_a_new_project_is_empty() {
        let t = TempDir::new("auto-none");
        fs::remove_dir_all(t.root().join(".mat-editor")).unwrap();
        assert_eq!(editor_list(&t.root(), "autosave"), Ok(vec![]));
    }

    #[test]
    fn removes_autosave_files_only() {
        let t = TempDir::new("rm");
        for bad in [
            "graphics/a.svg",
            ".mat-editor/svg-state.json",
            ".mat-editor/autosave/../../graphics/a.svg",
            ".mat-editor/autosave/x/y.svg",
            "../outside.svg",
        ] {
            assert_eq!(
                editor_remove(&t.root(), bad),
                Err(EditorError::BadPath),
                "{bad}"
            );
        }
        assert!(t.root().join("graphics/a.svg").exists());
        assert_eq!(
            editor_remove(&t.root(), ".mat-editor/autosave/none.svg"),
            Err(EditorError::Missing)
        );
        editor_remove(&t.root(), ".mat-editor/autosave/a.svg").unwrap();
        assert!(!t.root().join(".mat-editor/autosave/a.svg").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_autosave_dir_is_not_followed_outside() {
        let t = TempDir::new("link");
        fs::remove_dir_all(t.root().join(".mat-editor/autosave")).unwrap();
        fs::create_dir_all(t.0.join("elsewhere")).unwrap();
        fs::write(t.0.join("elsewhere/z.svg"), "<svg/>").unwrap();
        std::os::unix::fs::symlink(t.0.join("elsewhere"), t.root().join(".mat-editor/autosave"))
            .unwrap();
        assert_eq!(editor_list(&t.root(), "autosave"), Ok(vec![]));
        assert_eq!(
            editor_remove(&t.root(), ".mat-editor/autosave/z.svg"),
            Err(EditorError::Missing)
        );
        assert!(t.0.join("elsewhere/z.svg").exists());
        // symlink tới tệp ngoài project không được liệt kê là SVG
        std::os::unix::fs::symlink(t.0.join("outside.svg"), t.root().join("graphics/l.svg"))
            .unwrap();
        assert!(!list_svg(&t.root()).iter().any(|r| r == "graphics/l.svg"));
    }

    #[test]
    fn errors_use_contract_names() {
        let names: Vec<String> = [
            EditorError::BadPath,
            EditorError::Missing,
            EditorError::Io("x".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(names, ["\"bad-path\"", "\"missing\"", "{\"io\":\"x\"}"]);
    }
}
