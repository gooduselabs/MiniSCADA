//! Hộp thoại mở file SVG cho hộp thoại Nhập SVG (feature 008, research R24, ADR-023).
//!
//! `svg_open`: hộp thoại mở file (`*.svg`), trả byte gốc (≤ 5 MiB + 64 B). Rust không giải mã, không
//! phân tích nội dung: bộ quét, bộ parse và allowlist nằm ở `@mat/svg-import` (Worker). Giao diện không
//! bao giờ gửi đường dẫn: người dùng chọn qua hộp thoại hệ thống, nên không có đường đọc file tùy ý.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Trần byte đọc vào bộ nhớ: 5 MiB của giới hạn nhập cộng 64 B để bộ quét phía TS còn thấy file quá
/// lớn và báo `E_IMPORT_LIMIT` đúng mã (FR-011).
pub const MAX_SVG_BYTES: u64 = 5 * 1024 * 1024 + 64;

/// Lỗi của `svg_open`: `"too-large"`, `"bad-extension"` hoặc `{ "io": "chi tiết" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SvgError {
    TooLarge,
    BadExtension,
    Io(String),
}

/// File SVG người dùng chọn: tên (không có đường dẫn) và byte gốc.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SvgFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn io_error(e: std::io::Error) -> SvgError {
    SvgError::Io(e.to_string())
}

fn has_svg_extension(path: &Path) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("svg"))
        .unwrap_or(false)
}

/// Đọc file `.svg` ≤ 5 MiB + 64 B, trả byte gốc. Kiểm đuôi trước khi mở file.
pub fn read_svg_file(path: &Path) -> Result<SvgFile, SvgError> {
    if !has_svg_extension(path) {
        return Err(SvgError::BadExtension);
    }
    let file = fs::File::open(path).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take(MAX_SVG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_SVG_BYTES {
        return Err(SvgError::TooLarge);
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(SvgFile { name, bytes })
}

/// `svg_open() → { name, bytes } | null` (hủy hộp thoại thì `null`).
#[tauri::command]
pub async fn svg_open(app: AppHandle) -> Result<Option<SvgFile>, SvgError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Nhập SVG")
        .add_filter("SVG", &["svg"])
        .blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| SvgError::Io(e.to_string()))?;
    read_svg_file(&path).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let p =
                std::env::temp_dir().join(format!("mat-studio-svg-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// T055: trả đúng byte gốc (BOM, byte không phải UTF-8 vẫn nguyên), chỉ tên file, không đường dẫn.
    #[test]
    fn open_returns_the_raw_bytes_and_only_the_name() {
        let t = TempDir::new("raw");
        let path = t.0.join("bon.svg");
        let bytes = vec![0xEF, 0xBB, 0xBF, b'<', b's', b'v', b'g', 0xFF, 0x00];
        fs::write(&path, &bytes).unwrap();
        let got = read_svg_file(&path).unwrap();
        assert_eq!(got.name, "bon.svg");
        assert_eq!(got.bytes, bytes);
        assert_eq!(
            serde_json::to_value(&got).unwrap(),
            serde_json::json!({ "name": "bon.svg", "bytes": bytes })
        );
    }

    /// T055: đúng ngưỡng 5 MiB + 64 B thì nhận, thêm 1 byte thì `too-large`; thiếu file thì `io`.
    #[test]
    fn open_refuses_files_over_five_mebibytes_plus_64_bytes() {
        let t = TempDir::new("big");
        let ok = t.0.join("ok.svg");
        fs::write(&ok, vec![b'x'; MAX_SVG_BYTES as usize]).unwrap();
        assert_eq!(
            read_svg_file(&ok).unwrap().bytes.len() as u64,
            MAX_SVG_BYTES
        );
        let big = t.0.join("big.svg");
        fs::write(&big, vec![b'x'; MAX_SVG_BYTES as usize + 1]).unwrap();
        assert_eq!(read_svg_file(&big), Err(SvgError::TooLarge));
        assert!(matches!(
            read_svg_file(&t.0.join("khong-co.svg")),
            Err(SvgError::Io(_))
        ));
        assert_eq!(
            serde_json::to_string(&SvgError::TooLarge).unwrap(),
            "\"too-large\""
        );
        assert_eq!(
            serde_json::to_string(&SvgError::BadExtension).unwrap(),
            "\"bad-extension\""
        );
        assert_eq!(
            serde_json::to_string(&SvgError::Io("x".into())).unwrap(),
            "{\"io\":\"x\"}"
        );
    }

    /// T055: đuôi khác `.svg` (kể cả không đuôi, `.svgz`, `.svg.exe`) bị từ chối trước khi mở file;
    /// `.SVG` viết hoa vẫn nhận.
    #[test]
    fn open_rejects_other_extensions() {
        let t = TempDir::new("ext");
        for name in ["a.png", "a", "a.svgz", "a.svg.exe", "a.txt"] {
            let p = t.0.join(name);
            fs::write(&p, b"<svg/>").unwrap();
            assert_eq!(read_svg_file(&p), Err(SvgError::BadExtension), "{name}");
        }
        // Đuôi sai bị từ chối cả khi file không tồn tại (không chạm đĩa).
        assert_eq!(
            read_svg_file(&t.0.join("khong-co.png")),
            Err(SvgError::BadExtension)
        );
        let upper = t.0.join("A.SVG");
        fs::write(&upper, b"<svg/>").unwrap();
        assert_eq!(read_svg_file(&upper).unwrap().name, "A.SVG");
    }
}
