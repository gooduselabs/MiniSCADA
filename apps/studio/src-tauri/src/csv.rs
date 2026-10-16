//! Hộp thoại mở và lưu file CSV cho Bảng Tag, Bảng giá trị, Bảng theo dõi (feature 006,
//! contracts/tauri-commands-006.md §6).
//!
//! - `csv_open`: hộp thoại mở file (`*.csv`, `*.txt`), trả byte gốc (≤ 10 MiB). Rust không giải mã:
//!   giao diện nhận diện bảng mã (BOM UTF-8, UTF-8, Windows-1258) bằng `TextDecoder`.
//! - `csv_save`: hộp thoại lưu; ghi đúng `text` nhận được (giao diện đã thêm BOM UTF-8), atomic như
//!   `write_atomic` của 004. Giao diện không bao giờ gửi đường dẫn: người dùng chọn qua hộp thoại.

use crate::project_fs::write_atomic;
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Trần file CSV đọc vào bộ nhớ.
pub const MAX_CSV_BYTES: u64 = 10 * 1024 * 1024;

/// Lỗi của `csv_open`, `csv_save`: `"too-large"` hoặc `{ "io": "chi tiết" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CsvError {
    TooLarge,
    Io(String),
}

/// File CSV người dùng chọn: tên (không có đường dẫn) và byte gốc.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CsvFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Kết quả `csv_save`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CsvSaved {
    pub name: String,
}

fn io_error(e: std::io::Error) -> CsvError {
    CsvError::Io(e.to_string())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Đọc file CSV ≤ 10 MiB, trả byte gốc.
pub fn read_csv_file(path: &Path) -> Result<CsvFile, CsvError> {
    let file = fs::File::open(path).map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take(MAX_CSV_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_CSV_BYTES {
        return Err(CsvError::TooLarge);
    }
    Ok(CsvFile {
        name: file_name(path),
        bytes,
    })
}

/// Ghi `text` đúng như nhận (UTF-8) vào `path`, atomic. Thư mục đích phải có sẵn.
pub fn save_csv_file(path: &Path, text: &str) -> Result<CsvSaved, CsvError> {
    write_atomic(path, text.as_bytes()).map_err(io_error)?;
    Ok(CsvSaved {
        name: file_name(path),
    })
}

/// Bộ lọc hộp thoại lưu theo đuôi giao diện đề nghị: chỉ `csv` (mặc định), `json`, `md`; đuôi khác
/// (kể cả có dấu chấm hay phân cách) rơi về `csv`.
pub fn save_filter(extension: Option<&str>) -> (&'static str, &'static str) {
    match extension {
        Some("json") => ("JSON", "json"),
        Some("md") => ("Markdown", "md"),
        _ => ("CSV", "csv"),
    }
}

/// `csv_open() → { name, bytes } | null` (hủy hộp thoại thì `null`).
#[tauri::command]
pub async fn csv_open(app: AppHandle) -> Result<Option<CsvFile>, CsvError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Mở file CSV")
        .add_filter("CSV", &["csv", "txt"])
        .blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| CsvError::Io(e.to_string()))?;
    read_csv_file(&path).map(Some)
}

/// `csv_save({ suggestedName, text }) → { name } | null` (hủy hộp thoại thì `null`).
#[tauri::command]
pub async fn csv_save(
    app: AppHandle,
    suggested_name: String,
    text: String,
    extension: Option<String>,
) -> Result<Option<CsvSaved>, CsvError> {
    // 008: báo cáo nhập SVG lưu `.json`/`.md`; không có tham số thì như cũ (`.csv`).
    let (filter_name, filter_ext) = save_filter(extension.as_deref());
    // Tên gợi ý chỉ là chữ trong hộp thoại: bỏ dấu phân cách đường dẫn.
    let suggested: String = suggested_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0') && !c.is_control())
        .take(100)
        .collect();
    let picked = app
        .dialog()
        .file()
        .set_title("Lưu file CSV")
        .add_filter(filter_name, &[filter_ext])
        .set_file_name(if suggested.is_empty() {
            "xuat.csv"
        } else {
            suggested.as_str()
        })
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| CsvError::Io(e.to_string()))?;
    save_csv_file(&path, &text).map(Some)
}

/// Trần file báo cáo xuất thử (feature 010): 500 hàng × 24 cột vẫn nhỏ hơn nhiều.
pub const MAX_REPORT_BYTES: usize = 64 * 1024 * 1024;

/// Phần mở rộng của file báo cáo xuất thử: chỉ CSV, XLSX, PDF.
pub fn report_extension_ok(ext: &str) -> bool {
    matches!(ext, "csv" | "xlsx" | "pdf")
}

/// Ghi `bytes` nguyên văn vào `path` (atomic). Từ chối phần mở rộng lạ và file quá lớn.
pub fn save_report_file(path: &Path, bytes: &[u8]) -> Result<CsvSaved, CsvError> {
    if bytes.len() > MAX_REPORT_BYTES {
        return Err(CsvError::TooLarge);
    }
    write_atomic(path, bytes).map_err(io_error)?;
    Ok(CsvSaved {
        name: file_name(path),
    })
}

/// `report_save({ suggestedName, bytes, ext }) → { name } | null` (feature 010, contracts/studio-010.md §2): hộp thoại lưu cho
/// file báo cáo xuất thử (CSV, XLSX, PDF). Giao diện dựng file từ `ReportTable` và chỉ gửi byte; đường dẫn do người dùng chọn
/// qua hộp thoại, không bao giờ ghi tự động. Hủy hộp thoại thì `null`.
#[tauri::command]
pub async fn report_save(
    app: AppHandle,
    suggested_name: String,
    bytes: Vec<u8>,
    ext: String,
) -> Result<Option<CsvSaved>, CsvError> {
    if !report_extension_ok(&ext) {
        return Err(CsvError::Io("phần mở rộng không hỗ trợ".into()));
    }
    if bytes.len() > MAX_REPORT_BYTES {
        return Err(CsvError::TooLarge);
    }
    let suggested: String = suggested_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '\0') && !c.is_control())
        .take(100)
        .collect();
    let default_name = format!("bao-cao.{ext}");
    let picked = app
        .dialog()
        .file()
        .set_title("Lưu báo cáo")
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .set_file_name(if suggested.is_empty() {
            default_name.as_str()
        } else {
            suggested.as_str()
        })
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| CsvError::Io(e.to_string()))?;
    save_report_file(&path, &bytes).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn report_extensions_are_limited() {
        for ok in ["csv", "xlsx", "pdf"] {
            assert!(report_extension_ok(ok), "{ok}");
        }
        for bad in ["", "exe", "CSV", "csv ", "../x", "html", "json"] {
            assert!(!report_extension_ok(bad), "{bad}");
        }
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let p =
                std::env::temp_dir().join(format!("mat-studio-csv-{name}-{}", std::process::id()));
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

    /// T113: `csv_open` trả byte gốc của file, không giải mã (Windows-1258 vẫn nguyên byte).
    #[test]
    fn open_returns_the_raw_bytes_without_decoding() {
        let t = TempDir::new("open");
        let path = t.0.join("tags.csv");
        let bytes = vec![0xEF, 0xBB, 0xBF, b'a', b';', 0xD0, 0xFF, b'\r', b'\n'];
        fs::write(&path, &bytes).unwrap();
        let got = read_csv_file(&path).unwrap();
        assert_eq!(got.name, "tags.csv");
        assert_eq!(got.bytes, bytes);
        assert_eq!(
            serde_json::to_value(&got).unwrap(),
            serde_json::json!({ "name": "tags.csv", "bytes": bytes })
        );
    }

    /// T113: ≤ 10 MiB; lớn hơn → `too-large`; không có file → `io`.
    #[test]
    fn open_refuses_files_over_ten_mebibytes() {
        let t = TempDir::new("big");
        let ok = t.0.join("ok.csv");
        fs::write(&ok, vec![b'x'; MAX_CSV_BYTES as usize]).unwrap();
        assert_eq!(
            read_csv_file(&ok).unwrap().bytes.len() as u64,
            MAX_CSV_BYTES
        );
        let big = t.0.join("big.csv");
        fs::write(&big, vec![b'x'; MAX_CSV_BYTES as usize + 1]).unwrap();
        assert_eq!(read_csv_file(&big), Err(CsvError::TooLarge));
        assert!(matches!(
            read_csv_file(&t.0.join("khong-co.csv")),
            Err(CsvError::Io(_))
        ));
        assert_eq!(
            serde_json::to_string(&CsvError::TooLarge).unwrap(),
            "\"too-large\""
        );
        assert_eq!(
            serde_json::to_string(&CsvError::Io("x".into())).unwrap(),
            "{\"io\":\"x\"}"
        );
    }

    /// T113: `csv_save` ghi đúng `text` nhận được (BOM do giao diện thêm), atomic như `write_atomic`
    /// của 004 (không để lại file tạm), đè được file cũ; trả `{ name }`.
    #[test]
    fn save_writes_exactly_the_text_atomically() {
        let t = TempDir::new("save");
        let path = t.0.join("xuat.csv");
        fs::write(&path, "cũ").unwrap();
        let text = "\u{feff}Tên;Kiểu\r\nTANK01.LEVEL;FLOAT32\r\n";
        let saved = save_csv_file(&path, text).unwrap();
        assert_eq!(
            saved,
            CsvSaved {
                name: "xuat.csv".into()
            }
        );
        assert_eq!(fs::read(&path).unwrap(), text.as_bytes());
        let leftovers: Vec<_> = fs::read_dir(&t.0)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        assert_eq!(
            serde_json::to_value(&saved).unwrap(),
            serde_json::json!({ "name": "xuat.csv" })
        );
    }

    /// T055 (008): bộ lọc lưu theo đuôi; mặc định và đuôi lạ là CSV.
    #[test]
    fn save_filter_maps_known_extensions_only() {
        assert_eq!(save_filter(None), ("CSV", "csv"));
        assert_eq!(save_filter(Some("csv")), ("CSV", "csv"));
        assert_eq!(save_filter(Some("json")), ("JSON", "json"));
        assert_eq!(save_filter(Some("md")), ("Markdown", "md"));
        assert_eq!(save_filter(Some("exe")), ("CSV", "csv"));
        assert_eq!(save_filter(Some("../json")), ("CSV", "csv"));
    }

    /// T113: thư mục đích không có → `io`, không tạo gì.
    #[test]
    fn save_into_a_missing_directory_is_an_io_error() {
        let t = TempDir::new("save-missing");
        let path = t.0.join("nope/x.csv");
        assert!(matches!(save_csv_file(&path, "a"), Err(CsvError::Io(_))));
        assert!(!t.0.join("nope").exists());
    }
}
