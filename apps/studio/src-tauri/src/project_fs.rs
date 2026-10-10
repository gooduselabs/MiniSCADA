//! Đọc/ghi file project trong thư mục người dùng đã chọn (FR-037, research R12).
//! Đường dẫn tương đối được kiểm như bộ kiểm tra project (data-model.md "Đường dẫn an toàn"),
//! chỉ nhận .json/.svg, không thoát ra ngoài thư mục gốc kể cả qua symlink; ghi atomic.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Kiểm đường dẫn tương đối: dùng `/`, không `..`/`.`/rỗng, không tuyệt đối, không `\` `:`
/// hay ký tự điều khiển, dài ≤ 128, đuôi .json hoặc .svg.
pub fn check_rel(rel: &str) -> Result<(), String> {
    if rel.is_empty() || rel.len() > 128 {
        return Err("đường dẫn rỗng hoặc dài hơn 128 ký tự".into());
    }
    if rel.starts_with('/') || rel.chars().any(|c| c == '\\' || c == ':' || c.is_control()) {
        return Err(format!("đường dẫn không an toàn: {rel}"));
    }
    if rel.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return Err(format!("đường dẫn không an toàn: {rel}"));
    }
    if !(rel.ends_with(".json") || rel.ends_with(".svg")) {
        return Err(format!("chỉ cho phép file .json/.svg: {rel}"));
    }
    Ok(())
}

/// Đường dẫn tuyệt đối của `rel` trong `root`; lỗi nếu ra ngoài root (kể cả qua symlink).
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    check_rel(rel)?;
    let root = fs::canonicalize(root).map_err(|e| format!("thư mục project: {e}"))?;
    let joined = root.join(rel);
    let real = if joined.exists() {
        fs::canonicalize(&joined).map_err(|e| e.to_string())?
    } else {
        let parent = joined.parent().ok_or("đường dẫn không hợp lệ")?;
        let parent = fs::canonicalize(parent).map_err(|e| format!("thư mục cha: {e}"))?;
        parent.join(joined.file_name().ok_or("đường dẫn không hợp lệ")?)
    };
    if !real.starts_with(&root) || real == root {
        return Err(format!("đường dẫn ra ngoài thư mục project: {rel}"));
    }
    Ok(real)
}

/// Nội dung file; Ok(None) nếu không tồn tại.
pub fn read_text(root: &Path, rel: &str) -> Result<Option<String>, String> {
    check_rel(rel)?;
    if !root.join(rel).exists() {
        return Ok(None);
    }
    let path = resolve_in_root(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("không phải file: {rel}"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("file lớn hơn 1 MB: {rel}"));
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// Ghi atomic: file tạm cùng thư mục rồi đổi tên; lỗi giữa chừng không làm hỏng file cũ.
/// Studio Sprint 1 chỉ ghi file .json (không sửa SVG).
pub fn write_text_atomic(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    if !rel.ends_with(".json") {
        return Err(format!("Studio chỉ ghi file .json: {rel}"));
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err("nội dung lớn hơn 1 MB".into());
    }
    let path = resolve_in_root(root, rel)?;
    let dir = path.parent().ok_or("đường dẫn không hợp lệ")?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        std::process::id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("mat-studio-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(p.join("project/screens")).unwrap();
            fs::write(p.join("project/project.json"), "{\"a\":1}").unwrap();
            fs::write(p.join("project/screens/s.svg"), "<svg/>").unwrap();
            fs::write(p.join("secret.json"), "{}").unwrap();
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
    fn rejects_unsafe_paths() {
        for bad in [
            "../secret.json",
            "screens/../../secret.json",
            "/etc/passwd.json",
            "C:/x.json",
            "C:\\x.json",
            "a\\b.json",
            "./project.json",
            "a//b.json",
            "",
            "project.exe",
            "screens/s.svg\u{0}.json",
        ] {
            assert!(check_rel(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(check_rel(&format!("{}.json", "a".repeat(124))).is_err());
        assert!(check_rel("screens/tank-motor.screen.json").is_ok());
        assert!(check_rel("screens/tank-motor.svg").is_ok());
    }

    #[test]
    fn reads_inside_root_only() {
        let t = TempDir::new("read");
        assert_eq!(read_text(&t.root(), "project.json").unwrap().as_deref(), Some("{\"a\":1}"));
        assert_eq!(read_text(&t.root(), "screens/s.svg").unwrap().as_deref(), Some("<svg/>"));
        assert_eq!(read_text(&t.root(), "missing.json").unwrap(), None);
        assert!(read_text(&t.root(), "../secret.json").is_err());
    }

    #[test]
    fn refuses_big_files() {
        let t = TempDir::new("big");
        fs::write(t.root().join("big.json"), vec![b' '; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(read_text(&t.root(), "big.json").is_err());
        assert!(write_text_atomic(&t.root(), "x.json", &" ".repeat(MAX_FILE_BYTES as usize + 1)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_blocked() {
        let t = TempDir::new("link");
        std::os::unix::fs::symlink(t.0.join("secret.json"), t.root().join("link.json")).unwrap();
        assert!(read_text(&t.root(), "link.json").is_err());
    }

    #[test]
    fn writes_atomically_and_only_json() {
        let t = TempDir::new("write");
        write_text_atomic(&t.root(), "project.json", "{\"a\":2}\n").unwrap();
        assert_eq!(fs::read_to_string(t.root().join("project.json")).unwrap(), "{\"a\":2}\n");
        assert!(write_text_atomic(&t.root(), "screens/s.svg", "<svg/>").is_err());
        assert!(write_text_atomic(&t.root(), "../secret.json", "{}").is_err());
        // thư mục cha không tồn tại: lỗi, không tạo gì
        assert!(write_text_atomic(&t.root(), "nope/x.json", "{}").is_err());
        // không để lại file tạm
        let leftovers: Vec<_> = fs::read_dir(t.root())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
