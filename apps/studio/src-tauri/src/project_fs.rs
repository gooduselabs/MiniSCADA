//! Đọc/ghi file project trong thư mục người dùng đã chọn (FR-037, research R12).
//! Đường dẫn tương đối được kiểm như bộ kiểm tra project (data-model.md "Đường dẫn an toàn"),
//! chỉ nhận .json/.svg, không thoát ra ngoài thư mục gốc kể cả qua symlink; ghi atomic.
//! Lỗi đọc được phân loại để bộ kiểm tra TS báo cùng mã lỗi với runtime C++ (audit FR-032).
//! Đọc trả kèm SHA-256 của nội dung; ghi so lại hash đó ngay trước khi ghi để không đè file bị sửa
//! ngoài Studio (feature 004, FR-025, research R9).

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// Trần file JSON của project.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Trần SVG đọc để xem trước và kiểm `data-mat-uid` (ADR-003).
pub const MAX_SVG_BYTES: u64 = 5 * 1024 * 1024;

/// Lý do không đọc được file. Giao diện nhận chuỗi `"missing"`, `"bad-path"`, `"too-large"`,
/// `"bad-utf8"` (`ReadFailure` của @mat/project-schema).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadError {
    /// Không có, khác chữ hoa/thường, không phải file thường, hoặc chưa mở project.
    Missing,
    /// Đường dẫn không an toàn hoặc ra ngoài thư mục project (kể cả qua symlink/junction).
    BadPath,
    /// JSON > 1 MB, SVG > 5 MB.
    TooLarge,
    /// Không phải UTF-8 hợp lệ.
    BadUtf8,
}

/// Nội dung file kèm SHA-256 (hex chữ thường) của đúng các byte trên đĩa. Giao diện nhận
/// `{ text, hash }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileText {
    pub text: String,
    pub hash: String,
}

/// Lý do không ghi được file. Giao diện nhận chuỗi `"changed"`, `"bad-path"`, `"no-project"`, hoặc
/// `{ "io": "chi tiết" }`: bản cài không có console, nên chi tiết lỗi hệ điều hành phải tới giao diện.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WriteError {
    /// File trên đĩa khác lúc đọc (FR-025): không ghi.
    Changed,
    /// Đường dẫn không an toàn, ra ngoài thư mục project, hoặc không phải file .json.
    BadPath,
    /// Chưa mở project.
    NoProject,
    /// Lỗi hệ điều hành, hoặc nội dung lớn hơn 1 MB.
    Io(String),
}

fn io_error(e: io::Error) -> WriteError {
    WriteError::Io(e.to_string())
}

/// SHA-256 dạng hex chữ thường.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Kiểm đường dẫn tương đối: dùng `/`, không `..`/`.`/rỗng, không tuyệt đối, không `\` `:`
/// hay ký tự điều khiển ASCII (như bản TS và C++), dài ≤ 128 byte, đuôi .json hoặc .svg.
pub fn check_rel(rel: &str) -> Result<(), String> {
    if rel.is_empty() || rel.len() > 128 {
        return Err("đường dẫn rỗng hoặc dài hơn 128 ký tự".into());
    }
    if rel.starts_with('/')
        || rel
            .chars()
            .any(|c| c == '\\' || c == ':' || c.is_ascii_control())
    {
        return Err(format!("đường dẫn không an toàn: {rel}"));
    }
    if rel
        .split('/')
        .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err(format!("đường dẫn không an toàn: {rel}"));
    }
    if !(rel.ends_with(".json") || rel.ends_with(".svg")) {
        return Err(format!("chỉ cho phép file .json/.svg: {rel}"));
    }
    Ok(())
}

/// Mỗi đoạn của `rel` phải là một mục có đúng tên đó trong thư mục cha, như ext4 trên thiết bị:
/// NTFS không phân biệt hoa thường nên `screens/Main.svg` vẫn mở được `main.svg`.
fn exact_case(root: &Path, rel: &str) -> bool {
    let mut dir = root.to_path_buf();
    for part in rel.split('/') {
        let Ok(mut entries) = fs::read_dir(&dir) else {
            return false;
        };
        if !entries.any(|e| e.is_ok_and(|e| e.file_name() == part)) {
            return false;
        }
        dir.push(part);
    }
    true
}

/// Đường dẫn thật của `rel` trong `root`. `BadPath` nếu đường dẫn không an toàn hoặc ra ngoài root
/// (kể cả qua symlink/junction); `Io` nếu không tìm được thư mục project hay thư mục cha.
fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, WriteError> {
    check_rel(rel).map_err(|_| WriteError::BadPath)?;
    let root = fs::canonicalize(root).map_err(io_error)?;
    let joined = root.join(rel);
    let real = if joined.exists() {
        fs::canonicalize(&joined).map_err(io_error)?
    } else {
        // Chưa có file: đường dẫn thật của thư mục cha, nơi file sẽ được tạo.
        let (Some(parent), Some(name)) = (joined.parent(), joined.file_name()) else {
            return Err(WriteError::BadPath);
        };
        fs::canonicalize(parent).map_err(io_error)?.join(name)
    };
    if !real.starts_with(&root) || real == root {
        return Err(WriteError::BadPath);
    }
    Ok(real)
}

/// Nội dung file (UTF-8, giữ BOM nếu có) kèm SHA-256, hoặc lý do không đọc được.
pub fn read_text(root: &Path, rel: &str) -> Result<FileText, ReadError> {
    check_rel(rel).map_err(|_| ReadError::BadPath)?;
    if !exact_case(root, rel) {
        return Err(ReadError::Missing);
    }
    let path = resolve_in_root(root, rel).map_err(|_| ReadError::BadPath)?;
    let meta = fs::metadata(&path).map_err(|_| ReadError::Missing)?;
    if !meta.is_file() {
        return Err(ReadError::Missing);
    }
    let limit = if rel.ends_with(".svg") {
        MAX_SVG_BYTES
    } else {
        MAX_FILE_BYTES
    };
    if meta.len() > limit {
        return Err(ReadError::TooLarge);
    }
    let bytes = fs::read(&path).map_err(|_| ReadError::Missing)?;
    let hash = sha256_hex(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| ReadError::BadUtf8)?;
    Ok(FileText { text, hash })
}

/// Ghi `content` vào `rel` nếu file trên đĩa vẫn như lúc đọc: SHA-256 hiện tại bằng `expected`
/// (`None`: lúc đọc chưa có file). Khác thì trả `Changed` và không ghi, trừ khi `force` (Ghi đè).
/// Hash được đọc lại ngay trước khi ghi atomic. Chỉ ghi file .json (SVG chỉ đọc). Trả hash của
/// nội dung mới.
pub fn write_text_if_unchanged(
    root: &Path,
    rel: &str,
    content: &str,
    expected: Option<&str>,
    force: bool,
) -> Result<String, WriteError> {
    if !rel.ends_with(".json") {
        return Err(WriteError::BadPath);
    }
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(WriteError::Io("nội dung lớn hơn 1 MB".into()));
    }
    ensure_parents(root, rel)?;
    let path = resolve_in_root(root, rel)?;
    if !force && !unchanged(&path, expected)? {
        return Err(WriteError::Changed);
    }
    write_atomic(&path, content.as_bytes()).map_err(io_error)?;
    Ok(sha256_hex(content.as_bytes()))
}

/// Số cấp thư mục cha tối đa `project_write` tạo (contract tauri-commands-006 §5).
pub const MAX_PARENT_DEPTH: usize = 8;

/// Tạo các thư mục cha còn thiếu của `rel` bên trong thư mục project (feature 006: `value-tables/`,
/// `watch-tables/`). Sâu tối đa 8 cấp; mỗi cấp đã có phải là thư mục thật nằm trong project (junction
/// hay symlink ra ngoài → `BadPath`). Đường dẫn chưa qua `check_rel` thì không tạo gì.
fn ensure_parents(root: &Path, rel: &str) -> Result<(), WriteError> {
    check_rel(rel).map_err(|_| WriteError::BadPath)?;
    let parents: Vec<&str> = rel.split('/').collect();
    let parents = &parents[..parents.len() - 1];
    if parents.is_empty() {
        return Ok(());
    }
    if parents.len() > MAX_PARENT_DEPTH {
        return Err(WriteError::BadPath);
    }
    let canonical_root = fs::canonicalize(root).map_err(io_error)?;
    let mut dir = canonical_root.clone();
    for part in parents {
        dir.push(part);
        match fs::symlink_metadata(&dir) {
            Ok(meta) => {
                if !meta.is_dir() {
                    return Err(WriteError::BadPath);
                }
                // Junction và symlink: đường dẫn thật phải còn nằm trong project.
                let real = fs::canonicalize(&dir).map_err(io_error)?;
                if !real.starts_with(&canonical_root) {
                    return Err(WriteError::BadPath);
                }
                dir = real;
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                fs::create_dir(&dir).map_err(io_error)?;
            }
            Err(e) => return Err(io_error(e)),
        }
    }
    Ok(())
}

/// File ở `path` còn đúng như lúc đọc không: có file và SHA-256 bằng `expected`, hoặc không có file
/// và `expected = None`.
fn unchanged(path: &Path, expected: Option<&str>) -> Result<bool, WriteError> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(expected.is_none()),
        Err(e) => return Err(io_error(e)),
    };
    let Some(expected) = expected else {
        return Ok(false);
    };
    // Đọc tối đa 1 MB + 1 byte: file lớn hơn trần đọc không thể là file giao diện đã đọc.
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    Ok(bytes.len() as u64 <= MAX_FILE_BYTES && sha256_hex(&bytes) == expected)
}

/// Ghi atomic: file tạm cùng thư mục, `fsync`, rồi đổi tên đè lên `path`; lỗi giữa chừng không làm
/// hỏng file cũ và không để lại file tạm.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "đường dẫn không hợp lệ",
        ));
    };
    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        name.to_str().unwrap_or("file"),
        std::process::id()
    ));
    let result = (|| -> io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

// ---------------------------------------------------------------------------------------------
// Feature 006: sao lưu khi nâng cấp 0.1 → 0.2 và xóa file (contracts/tauri-commands-006.md §5)

/// Một file của project 0.1 giao diện đã đọc, kèm SHA-256 lúc đọc.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct BackupFile {
    pub rel: String,
    pub hash: String,
}

/// Kết quả `project_backup`: `dir` tương đối trong project (để hiện), `abs` đầy đủ (hiện và mở bằng
/// Explorer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BackupDone {
    pub dir: String,
    pub abs: String,
}

/// Lỗi `project_backup`: `"exists"`, `{ "changed": rel }`, `"bad-path"`, `"no-project"`, `{ "io": … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupError {
    /// Thư mục sao lưu đã có: không bao giờ ghi đè.
    Exists,
    /// File trên đĩa khác hash lúc giao diện đọc (hoặc không còn).
    Changed(String),
    BadPath,
    NoProject,
    Io(String),
}

/// Lỗi `project_remove`: `{ "changed": rel }`, `"missing"`, `"bad-path"`, `{ "io": … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoveError {
    Changed(String),
    Missing,
    BadPath,
    Io(String),
}

/// `^[0-9]+\.[0-9]+\.[0-9]+$` (phiên bản gốc dùng làm nhãn thư mục sao lưu).
fn valid_label(label: &str) -> bool {
    let parts: Vec<&str> = label.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// `20261020T030000Z` → `2026-10-20T03:00:00Z`.
fn iso_from_stamp(stamp: &str) -> String {
    let b = stamp.as_bytes();
    if b.len() != 16 {
        return stamp.to_string();
    }
    format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stamp[0..4],
        &stamp[4..6],
        &stamp[6..8],
        &stamp[9..11],
        &stamp[11..13],
        &stamp[13..15]
    )
}

/// Dấu thời gian UTC `yyyyMMddTHHmmssZ` của lúc này.
pub fn stamp_now() -> String {
    crate::recent::now_utc().replace(['-', ':'], "")
}

/// Chép đúng các file của `files` vào `<root>/.mat-backup/<label>-<stamp>/` (giữ đường dẫn tương đối),
/// ghi `backup.json`, rồi đọc lại so SHA-256 từng file. Không bao giờ ghi đè thư mục đã có; lỗi giữa
/// chừng thì xóa thư mục dở.
pub fn backup_files(
    root: &Path,
    files: &[BackupFile],
    label: &str,
    stamp: &str,
    generator: &str,
) -> Result<BackupDone, BackupError> {
    let io = |e: io::Error| BackupError::Io(e.to_string());
    if !valid_label(label) || stamp.len() != 16 || !stamp.is_ascii() {
        return Err(BackupError::BadPath);
    }
    for f in files {
        check_rel(&f.rel).map_err(|_| BackupError::BadPath)?;
        if f.rel.starts_with(".mat-backup/") {
            return Err(BackupError::BadPath);
        }
    }
    let canonical = fs::canonicalize(root).map_err(io)?;
    // Đọc và kiểm hash trước: file đã đổi thì không tạo gì.
    let mut contents = Vec::with_capacity(files.len());
    for f in files {
        let path = resolve_in_root(root, &f.rel).map_err(|_| BackupError::BadPath)?;
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Err(BackupError::Changed(f.rel.clone()));
            }
            Err(e) => return Err(io(e)),
        };
        if sha256_hex(&bytes) != f.hash {
            return Err(BackupError::Changed(f.rel.clone()));
        }
        contents.push(bytes);
    }
    let store = canonical.join(".mat-backup");
    match fs::symlink_metadata(&store) {
        Ok(m) if !m.is_dir() => return Err(BackupError::BadPath),
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(&store).map_err(io)?,
        Err(e) => return Err(io(e)),
    }
    let name = format!("{label}-{stamp}");
    let dir = store.join(&name);
    // `create_dir` thất bại nếu đã có: không bao giờ ghi đè.
    match fs::create_dir(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(BackupError::Exists),
        Err(e) => return Err(io(e)),
    }
    let result = (|| -> Result<(), BackupError> {
        let mut entries = Vec::new();
        for (f, bytes) in files.iter().zip(&contents) {
            let dest = dir.join(&f.rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(io)?;
            }
            write_atomic(&dest, bytes).map_err(io)?;
            let back = fs::read(&dest).map_err(io)?;
            if sha256_hex(&back) != f.hash {
                return Err(BackupError::Io(format!("đọc lại khác hash: {}", f.rel)));
            }
            entries.push(serde_json::json!({ "path": f.rel, "sha256": f.hash }));
        }
        let manifest = serde_json::json!({
            "from": label,
            "to": "0.2.0",
            "createdAt": iso_from_stamp(stamp),
            "generator": generator,
            "files": entries,
        });
        let text = serde_json::to_string_pretty(&manifest)
            .map_err(|e| BackupError::Io(e.to_string()))?
            + "\n";
        write_atomic(&dir.join("backup.json"), text.as_bytes()).map_err(io)
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(BackupDone {
        dir: format!(".mat-backup/{name}"),
        abs: dir.display().to_string(),
    })
}

/// `tagFile` của project.json (mặc định `tags.json`).
fn tag_file_of(root: &Path) -> String {
    fs::read(root.join("project.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| {
            v.get("tagFile")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "tags.json".to_string())
}

/// Xóa file `.json` của project khi SHA-256 trên đĩa bằng `hash` (bảng giá trị, bảng theo dõi đã bị
/// xóa rồi lưu). Không xóa `project.json` và file Tag.
pub fn remove_file(root: &Path, rel: &str, hash: &str) -> Result<(), RemoveError> {
    if !rel.ends_with(".json") || check_rel(rel).is_err() {
        return Err(RemoveError::BadPath);
    }
    if rel == "project.json" || rel == tag_file_of(root) {
        return Err(RemoveError::BadPath);
    }
    let path = resolve_in_root(root, rel).map_err(|e| match e {
        WriteError::BadPath => RemoveError::BadPath,
        // Thư mục cha không còn thì file cũng không còn.
        _ => RemoveError::Missing,
    })?;
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(RemoveError::Missing),
        Err(e) => return Err(RemoveError::Io(e.to_string())),
    };
    if sha256_hex(&bytes) != hash {
        return Err(RemoveError::Changed(rel.to_string()));
    }
    fs::remove_file(&path).map_err(|e| RemoveError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SHA-256 của "abc" (FIPS 180-2, phụ lục B.1) và của chuỗi rỗng.
    const SHA256_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const SHA256_EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

    fn leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp-"))
            .collect()
    }

    /// Phần nội dung của `read_text`, để so ngắn gọn.
    fn text(root: &Path, rel: &str) -> Result<String, ReadError> {
        read_text(root, rel).map(|f| f.text)
    }

    fn disk(path: PathBuf) -> String {
        fs::read_to_string(path).unwrap()
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
            "screens/s\u{7f}.svg",
        ] {
            assert!(check_rel(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(check_rel(&format!("{}.json", "a".repeat(124))).is_err());
        assert!(check_rel("screens/tank-motor.screen.json").is_ok());
        assert!(check_rel("screens/tank-motor.svg").is_ok());
        // Ký tự điều khiển C1 (U+0085) hợp lệ ở bản TS và C++: Rust phải nhận như vậy.
        assert!(check_rel("screens/a\u{85}.svg").is_ok());
    }

    #[test]
    fn reads_inside_root_only() {
        let t = TempDir::new("read");
        assert_eq!(text(&t.root(), "project.json").as_deref(), Ok("{\"a\":1}"));
        assert_eq!(text(&t.root(), "screens/s.svg").as_deref(), Ok("<svg/>"));
        assert_eq!(
            read_text(&t.root(), "missing.json"),
            Err(ReadError::Missing)
        );
        assert_eq!(
            read_text(&t.root(), "../secret.json"),
            Err(ReadError::BadPath)
        );
        assert_eq!(
            read_text(&t.root(), "screens/s.exe"),
            Err(ReadError::BadPath)
        );
    }

    #[test]
    fn classifies_read_errors() {
        let t = TempDir::new("classes");
        fs::create_dir_all(t.root().join("dir.json")).unwrap();
        assert_eq!(read_text(&t.root(), "dir.json"), Err(ReadError::Missing));
        fs::write(
            t.root().join("bad.json"),
            [b'{', b'"', 0xea, 0xd2, b'"', b'}'],
        )
        .unwrap();
        assert_eq!(read_text(&t.root(), "bad.json"), Err(ReadError::BadUtf8));
        // BOM được giữ: bộ kiểm tra TS bỏ đúng một BOM như bản C++.
        fs::write(t.root().join("bom.json"), [0xef, 0xbb, 0xbf, b'{', b'}']).unwrap();
        assert_eq!(text(&t.root(), "bom.json").as_deref(), Ok("\u{feff}{}"));
        // Tên lỗi gửi qua IPC trùng ReadFailure của TS.
        let names: Vec<String> = [
            ReadError::Missing,
            ReadError::BadPath,
            ReadError::TooLarge,
            ReadError::BadUtf8,
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"missing\"",
                "\"bad-path\"",
                "\"too-large\"",
                "\"bad-utf8\""
            ]
        );
    }

    #[test]
    fn refuses_big_files() {
        let t = TempDir::new("big");
        fs::write(
            t.root().join("big.json"),
            vec![b' '; (MAX_FILE_BYTES + 1) as usize],
        )
        .unwrap();
        assert_eq!(read_text(&t.root(), "big.json"), Err(ReadError::TooLarge));
        fs::write(
            t.root().join("big.svg"),
            vec![b' '; (MAX_SVG_BYTES + 1) as usize],
        )
        .unwrap();
        assert_eq!(read_text(&t.root(), "big.svg"), Err(ReadError::TooLarge));
        assert!(matches!(
            write_text_if_unchanged(
                &t.root(),
                "x.json",
                &" ".repeat(MAX_FILE_BYTES as usize + 1),
                None,
                true
            ),
            Err(WriteError::Io(_))
        ));
        assert!(!t.root().join("x.json").exists());
    }

    #[test]
    fn reads_svg_up_to_5_mb() {
        let t = TempDir::new("svg5");
        fs::write(
            t.root().join("screens/mid.svg"),
            vec![b' '; 3 * 1024 * 1024],
        )
        .unwrap();
        assert!(read_text(&t.root(), "screens/mid.svg").is_ok());
        fs::write(
            t.root().join("screens/max.svg"),
            vec![b' '; MAX_SVG_BYTES as usize],
        )
        .unwrap();
        assert!(read_text(&t.root(), "screens/max.svg").is_ok());
    }

    #[test]
    fn file_names_are_case_sensitive() {
        let t = TempDir::new("case");
        assert_eq!(
            read_text(&t.root(), "screens/S.svg"),
            Err(ReadError::Missing)
        );
        assert_eq!(
            read_text(&t.root(), "Screens/s.svg"),
            Err(ReadError::Missing)
        );
        assert_eq!(
            read_text(&t.root(), "Project.json"),
            Err(ReadError::Missing)
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_blocked() {
        let t = TempDir::new("link");
        std::os::unix::fs::symlink(t.0.join("secret.json"), t.root().join("link.json")).unwrap();
        assert_eq!(read_text(&t.root(), "link.json"), Err(ReadError::BadPath));
    }

    /// Windows (nền tảng của Studio): junction ra ngoài thư mục project. Junction không cần quyền
    /// tạo symlink, nên test này luôn chạy được (audit C-03).
    #[cfg(windows)]
    #[test]
    fn junction_escape_is_blocked() {
        let t = TempDir::new("junction");
        fs::create_dir_all(t.0.join("outside")).unwrap();
        fs::write(t.0.join("outside/x.json"), "{}").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(t.root().join("out"))
            .arg(t.0.join("outside"))
            .output()
            .unwrap()
            .status;
        assert!(status.success(), "mklink /J failed");
        assert_eq!(read_text(&t.root(), "out/x.json"), Err(ReadError::BadPath));
        assert_eq!(
            write_text_if_unchanged(&t.root(), "out/y.json", "{}", None, true),
            Err(WriteError::BadPath)
        );
        assert!(!t.0.join("outside/y.json").exists());
    }

    #[test]
    fn writes_atomically_and_only_json() {
        let t = TempDir::new("write");
        write_text_if_unchanged(&t.root(), "project.json", "{\"a\":2}\n", None, true).unwrap();
        assert_eq!(disk(t.root().join("project.json")), "{\"a\":2}\n");
        assert_eq!(
            write_text_if_unchanged(&t.root(), "screens/s.svg", "<x/>", None, true),
            Err(WriteError::BadPath)
        );
        assert_eq!(disk(t.root().join("screens/s.svg")), "<svg/>");
        assert_eq!(
            write_text_if_unchanged(&t.root(), "../secret.json", "{\"b\":1}", None, true),
            Err(WriteError::BadPath)
        );
        assert_eq!(disk(t.0.join("secret.json")), "{}");
        // Feature 006 (contract tauri-commands-006 §5): thư mục cha còn thiếu được tạo, nhưng chỉ khi
        // đường dẫn đã qua kiểm tra; đường dẫn xấu không tạo gì.
        assert!(
            write_text_if_unchanged(&t.root(), "nope/x.json", "{}", None, true).is_ok(),
            "006: tạo thư mục cha còn thiếu"
        );
        assert_eq!(disk(t.root().join("nope/x.json")), "{}");
        assert!(matches!(
            write_text_if_unchanged(&t.root(), "bad/../x.json", "{}", None, true),
            Err(WriteError::BadPath)
        ));
        assert!(!t.root().join("bad").exists());
        assert!(leftovers(&t.root()).is_empty());
    }

    /// T077: `project_write` tạo thư mục cha còn thiếu (`value-tables/`, `watch-tables/`) trong thư
    /// mục project; sâu tối đa 8 cấp; mỗi cấp không phải junction hay symlink trỏ ra ngoài.
    #[test]
    fn write_creates_parents_up_to_eight_levels_inside_the_project() {
        let t = TempDir::new("w-parents");
        write_text_if_unchanged(&t.root(), "value-tables/TrangThai.json", "{}", None, false)
            .unwrap();
        write_text_if_unchanged(&t.root(), "watch-tables/van-hanh.json", "{}", None, false)
            .unwrap();
        assert!(t.root().join("value-tables").is_dir());
        // 8 cấp thư mục cha là vừa đủ; 9 cấp thì từ chối và không tạo gì.
        let ok = format!("{}/x.json", ["d"; 8].join("/"));
        assert!(write_text_if_unchanged(&t.root(), &ok, "{}", None, false).is_ok());
        let deep = format!("{}/x.json", ["e"; 9].join("/"));
        assert_eq!(
            write_text_if_unchanged(&t.root(), &deep, "{}", None, false),
            Err(WriteError::BadPath)
        );
        assert!(!t.root().join("e").exists());
        // Chỉ .json (không tạo thư mục cho .svg hay đuôi khác).
        assert_eq!(
            write_text_if_unchanged(&t.root(), "svgs/a.svg", "<svg/>", None, false),
            Err(WriteError::BadPath)
        );
        assert!(!t.root().join("svgs").exists());
        // Thư mục cha là một file: lỗi, không đè lên file đó.
        assert!(matches!(
            write_text_if_unchanged(&t.root(), "project.json/x.json", "{}", None, false),
            Err(WriteError::Io(_) | WriteError::BadPath)
        ));
        assert_eq!(disk(t.root().join("project.json")), "{\"a\":1}");
    }

    /// T077: junction ra ngoài ở một cấp thư mục cha: từ chối, không ghi ra ngoài (Windows).
    #[cfg(windows)]
    #[test]
    fn write_through_a_junction_parent_is_refused() {
        let t = TempDir::new("w-junction-parent");
        fs::create_dir_all(t.0.join("outside")).unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(t.root().join("value-tables"))
            .arg(t.0.join("outside"))
            .output()
            .unwrap()
            .status;
        assert!(status.success());
        assert_eq!(
            write_text_if_unchanged(&t.root(), "value-tables/a/x.json", "{}", None, false),
            Err(WriteError::BadPath)
        );
        assert!(fs::read_dir(t.0.join("outside")).unwrap().next().is_none());
    }

    fn files_of(t: &TempDir, rels: &[&str]) -> Vec<BackupFile> {
        rels.iter()
            .map(|rel| BackupFile {
                rel: (*rel).into(),
                hash: sha256_hex(&fs::read(t.root().join(rel)).unwrap()),
            })
            .collect()
    }

    /// T077: `project_backup` chép đúng các file vào `.mat-backup/<label>-<UTC>/`, giữ đường dẫn tương
    /// đối (kể cả svg), ghi `backup.json` (data-model §12), đọc lại so SHA-256; trả `{ dir, abs }`.
    #[test]
    fn backup_copies_files_with_a_manifest() {
        let t = TempDir::new("backup");
        let files = files_of(&t, &["project.json", "screens/s.svg"]);
        let done = backup_files(
            &t.root(),
            &files,
            "0.1.0",
            "20261020T030000Z",
            "mAT Studio 0.4.0",
        )
        .unwrap();
        assert_eq!(done.dir, ".mat-backup/0.1.0-20261020T030000Z");
        assert!(
            done.abs.replace('\\', "/").ends_with(&done.dir),
            "{}",
            done.abs
        );
        let base = t.root().join(&done.dir);
        assert_eq!(disk(base.join("project.json")), "{\"a\":1}");
        assert_eq!(disk(base.join("screens/s.svg")), "<svg/>");
        let manifest: serde_json::Value =
            serde_json::from_str(&disk(base.join("backup.json"))).unwrap();
        assert_eq!(manifest["from"], "0.1.0");
        assert_eq!(manifest["to"], "0.2.0");
        assert_eq!(manifest["createdAt"], "2026-10-20T03:00:00Z");
        assert_eq!(manifest["generator"], "mAT Studio 0.4.0");
        assert_eq!(
            manifest["files"],
            serde_json::json!([
                { "path": "project.json", "sha256": files[0].hash },
                { "path": "screens/s.svg", "sha256": files[1].hash }
            ])
        );
        // File gốc không bị đụng.
        assert_eq!(disk(t.root().join("project.json")), "{\"a\":1}");
    }

    /// T077: không bao giờ ghi đè (`exists`); file khác hash lúc đọc → `{ changed: rel }` và không để
    /// lại thư mục dở; nhãn và đường dẫn xấu → `bad-path`; lỗi gửi qua IPC theo contract.
    #[test]
    fn backup_never_overwrites_and_guards_inputs() {
        let t = TempDir::new("backup-guard");
        let files = files_of(&t, &["project.json"]);
        let run = |files: &[BackupFile], label: &str, stamp: &str| {
            backup_files(&t.root(), files, label, stamp, "mAT Studio 0.4.0")
        };
        run(&files, "0.1.0", "20261020T030000Z").unwrap();
        assert_eq!(
            run(&files, "0.1.0", "20261020T030000Z"),
            Err(BackupError::Exists)
        );
        let mut stale = files.clone();
        stale[0].hash = "0".repeat(64);
        assert_eq!(
            run(&stale, "0.1.0", "20261020T030001Z"),
            Err(BackupError::Changed("project.json".into()))
        );
        assert!(!t.root().join(".mat-backup/0.1.0-20261020T030001Z").exists());
        for label in ["0.1", "v0.1.0", "0.1.0/../x", "", "0.1.0 "] {
            assert_eq!(
                run(&files, label, "20261020T030002Z"),
                Err(BackupError::BadPath),
                "{label:?}"
            );
        }
        let bad = [BackupFile {
            rel: "../secret.json".into(),
            hash: sha256_hex(b"{}"),
        }];
        assert_eq!(
            run(&bad, "0.1.0", "20261020T030003Z"),
            Err(BackupError::BadPath)
        );
        let missing = [BackupFile {
            rel: "nope.json".into(),
            hash: sha256_hex(b"{}"),
        }];
        assert_eq!(
            run(&missing, "0.1.0", "20261020T030004Z"),
            Err(BackupError::Changed("nope.json".into()))
        );
        let names: Vec<String> = [
            BackupError::Exists,
            BackupError::Changed("tags.json".into()),
            BackupError::BadPath,
            BackupError::NoProject,
            BackupError::Io("x".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"exists\"",
                "{\"changed\":\"tags.json\"}",
                "\"bad-path\"",
                "\"no-project\"",
                "{\"io\":\"x\"}"
            ]
        );
    }

    /// T077: `project_remove` xóa file .json khi hash khớp; không xóa `project.json` và file Tag;
    /// lỗi `changed`, `missing`, `bad-path`.
    #[test]
    fn remove_checks_the_hash_and_protects_core_files() {
        let t = TempDir::new("remove");
        fs::write(t.root().join("tags.json"), "{\"tags\":[]}").unwrap();
        fs::create_dir_all(t.root().join("value-tables")).unwrap();
        fs::write(t.root().join("value-tables/A.json"), "{}").unwrap();
        fs::write(t.root().join("value-tables/B.json"), "{}").unwrap();
        let hash = |rel: &str| sha256_hex(&fs::read(t.root().join(rel)).unwrap());
        assert_eq!(
            remove_file(&t.root(), "value-tables/A.json", &"0".repeat(64)),
            Err(RemoveError::Changed("value-tables/A.json".into()))
        );
        assert!(t.root().join("value-tables/A.json").exists());
        assert_eq!(
            remove_file(
                &t.root(),
                "value-tables/A.json",
                &hash("value-tables/A.json")
            ),
            Ok(())
        );
        assert!(!t.root().join("value-tables/A.json").exists());
        assert_eq!(
            remove_file(&t.root(), "value-tables/A.json", &sha256_hex(b"{}")),
            Err(RemoveError::Missing)
        );
        for protected in ["project.json", "tags.json"] {
            assert_eq!(
                remove_file(&t.root(), protected, &hash(protected)),
                Err(RemoveError::BadPath),
                "{protected}"
            );
            assert!(t.root().join(protected).exists());
        }
        // `tagFile` do project.json đặt cũng được bảo vệ.
        fs::write(
            t.root().join("project.json"),
            "{\"tagFile\":\"my-tags.json\"}",
        )
        .unwrap();
        fs::write(t.root().join("my-tags.json"), "{}").unwrap();
        assert_eq!(
            remove_file(&t.root(), "my-tags.json", &hash("my-tags.json")),
            Err(RemoveError::BadPath)
        );
        for bad in [
            "../secret.json",
            "screens/s.svg",
            "value-tables\\B.json",
            "x.txt",
        ] {
            assert_eq!(
                remove_file(&t.root(), bad, &sha256_hex(b"{}")),
                Err(RemoveError::BadPath),
                "{bad}"
            );
        }
        assert!(t.0.join("secret.json").exists());
        let names: Vec<String> = [
            RemoveError::Changed("a.json".into()),
            RemoveError::Missing,
            RemoveError::BadPath,
            RemoveError::Io("x".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "{\"changed\":\"a.json\"}",
                "\"missing\"",
                "\"bad-path\"",
                "{\"io\":\"x\"}"
            ]
        );
    }

    /// Lỗi SAU khi đã ghi file tạm (đổi tên thất bại): mục cũ còn nguyên, không còn file tạm
    /// (audit C-03).
    #[test]
    fn failed_rename_keeps_the_old_entry() {
        let t = TempDir::new("rename");
        fs::create_dir_all(t.root().join("dir.json/sub")).unwrap();
        let err = write_text_if_unchanged(&t.root(), "dir.json", "{}", None, true).unwrap_err();
        // Giao diện nhận cả chi tiết của hệ điều hành: `{ "io": "..." }`.
        let detail = serde_json::to_value(&err).unwrap()["io"]
            .as_str()
            .map(str::to_owned);
        assert!(detail.is_some_and(|d| !d.is_empty()), "{err:?}");
        assert!(t.root().join("dir.json/sub").is_dir());
        assert!(leftovers(&t.root()).is_empty());
    }

    /// Windows: file đích chỉ đọc thì đổi tên thất bại; nội dung cũ phải còn nguyên.
    #[cfg(windows)]
    #[test]
    fn failed_write_keeps_old_content() {
        let t = TempDir::new("readonly");
        let p = t.root().join("project.json");
        let hash = read_text(&t.root(), "project.json").unwrap().hash;
        // Giữ quyền gốc để trả lại sau (không dùng `set_readonly(false)`: trên Unix nó mở quyền ghi
        // cho mọi người, clippy `permissions_set_readonly_false`).
        let original = fs::metadata(&p).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&p, readonly).unwrap();
        let r = write_text_if_unchanged(&t.root(), "project.json", "{\"a\":3}", Some(&hash), false);
        fs::set_permissions(&p, original).unwrap();
        assert!(
            matches!(r, Err(WriteError::Io(_))),
            "rename over a read-only file must fail on Windows: {r:?}"
        );
        assert_eq!(disk(p), "{\"a\":1}");
        assert!(leftovers(&t.root()).is_empty());
    }

    /// T018: hash là SHA-256 hex chữ thường của đúng các byte trên đĩa (kể cả BOM); giao diện nhận
    /// `{ text, hash }`.
    #[test]
    fn read_returns_sha256_of_the_content() {
        let t = TempDir::new("hash");
        fs::write(t.root().join("abc.json"), "abc").unwrap();
        let f = read_text(&t.root(), "abc.json").unwrap();
        assert_eq!(
            f,
            FileText {
                text: "abc".into(),
                hash: SHA256_ABC.into()
            }
        );
        assert_eq!(
            serde_json::to_value(&f).unwrap(),
            serde_json::json!({ "text": "abc", "hash": SHA256_ABC })
        );
        fs::write(t.root().join("empty.json"), "").unwrap();
        assert_eq!(
            read_text(&t.root(), "empty.json").unwrap().hash,
            SHA256_EMPTY
        );
        fs::write(t.root().join("bom.json"), "\u{feff}abc").unwrap();
        assert_ne!(read_text(&t.root(), "bom.json").unwrap().hash, SHA256_ABC);
    }

    /// T018: hash khớp → ghi, trả hash của nội dung mới; lần ghi sau dùng hash mới đó.
    #[test]
    fn writes_when_hash_matches() {
        let t = TempDir::new("w-match");
        let old = read_text(&t.root(), "project.json").unwrap();
        assert_eq!(
            write_text_if_unchanged(&t.root(), "project.json", "abc", Some(&old.hash), false)
                .as_deref(),
            Ok(SHA256_ABC)
        );
        assert_eq!(disk(t.root().join("project.json")), "abc");
        let next = write_text_if_unchanged(&t.root(), "project.json", "", Some(SHA256_ABC), false);
        assert_eq!(next.as_deref(), Ok(SHA256_EMPTY));
        assert_eq!(disk(t.root().join("project.json")), "");
        assert!(leftovers(&t.root()).is_empty());
    }

    /// T018: file bị sửa ngoài Studio → `Changed`, file giữ nguyên; `force` thì ghi đè.
    #[test]
    fn changed_file_needs_force() {
        let t = TempDir::new("w-changed");
        let old = read_text(&t.root(), "project.json").unwrap();
        fs::write(t.root().join("project.json"), "{\"a\":9}").unwrap();
        assert_eq!(
            write_text_if_unchanged(
                &t.root(),
                "project.json",
                "{\"a\":2}",
                Some(&old.hash),
                false
            ),
            Err(WriteError::Changed)
        );
        assert_eq!(disk(t.root().join("project.json")), "{\"a\":9}");
        assert!(leftovers(&t.root()).is_empty());
        assert_eq!(
            write_text_if_unchanged(&t.root(), "project.json", "abc", Some(&old.hash), true)
                .as_deref(),
            Ok(SHA256_ABC)
        );
        assert_eq!(disk(t.root().join("project.json")), "abc");
    }

    /// T018: `expected = None` nghĩa là file mới: file đã có thì `Changed`, chưa có thì tạo. File đã
    /// đọc mà bị xóa ngoài Studio cũng là thay đổi.
    #[test]
    fn expected_none_means_a_new_file() {
        let t = TempDir::new("w-new");
        assert_eq!(
            write_text_if_unchanged(&t.root(), "project.json", "{}", None, false),
            Err(WriteError::Changed)
        );
        assert_eq!(disk(t.root().join("project.json")), "{\"a\":1}");
        assert_eq!(
            write_text_if_unchanged(&t.root(), "screens/new.json", "abc", None, false).as_deref(),
            Ok(SHA256_ABC)
        );
        assert_eq!(disk(t.root().join("screens/new.json")), "abc");
        fs::remove_file(t.root().join("screens/new.json")).unwrap();
        assert_eq!(
            write_text_if_unchanged(&t.root(), "screens/new.json", "{}", Some(SHA256_ABC), false),
            Err(WriteError::Changed)
        );
        assert!(!t.root().join("screens/new.json").exists());
    }

    /// T018: lỗi ghi gửi qua IPC theo contracts/tauri-commands.md: chuỗi kebab-case, riêng `io` là
    /// đối tượng một khóa kèm chi tiết (bản cài không có console để đọc stderr).
    #[test]
    fn write_errors_use_contract_names() {
        let names: Vec<String> = [
            WriteError::Changed,
            WriteError::BadPath,
            WriteError::NoProject,
            WriteError::Io("Access is denied. (os error 5)".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"changed\"",
                "\"bad-path\"",
                "\"no-project\"",
                "{\"io\":\"Access is denied. (os error 5)\"}"
            ]
        );
    }
}
