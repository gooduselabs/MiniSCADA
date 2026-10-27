//! Danh sách tệp `.svg` của project (chọn logo báo cáo trong Studio). Bỏ thư mục bắt đầu bằng dấu chấm
//! (`.mat-editor`, `.mat-backup`, `.git`) và symlink: không đi ra ngoài thư mục project.

use std::fs;
use std::path::Path;

use crate::project_fs::check_rel;

/// Trần số tệp trả về.
pub const MAX_ENTRIES: usize = 2000;
/// Độ sâu thư mục tối đa khi tìm SVG (như số cấp thư mục cha của `project_write`).
pub const MAX_SVG_DEPTH: usize = 8;

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
                std::env::temp_dir().join(format!("mat-svg-list-{name}-{}", std::process::id()));
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

    #[cfg(unix)]
    #[test]
    fn symlinked_svg_outside_is_not_listed() {
        let t = TempDir::new("link");
        std::os::unix::fs::symlink(t.0.join("outside.svg"), t.root().join("graphics/l.svg"))
            .unwrap();
        assert!(!list_svg(&t.root()).iter().any(|r| r == "graphics/l.svg"));
    }
}
