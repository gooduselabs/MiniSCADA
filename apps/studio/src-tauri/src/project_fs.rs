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
    let path = resolve_in_root(root, rel)?;
    if !force && !unchanged(&path, expected)? {
        return Err(WriteError::Changed);
    }
    write_atomic(&path, content.as_bytes()).map_err(io_error)?;
    Ok(sha256_hex(content.as_bytes()))
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
        // thư mục cha không tồn tại: lỗi, không tạo gì
        assert!(matches!(
            write_text_if_unchanged(&t.root(), "nope/x.json", "{}", None, true),
            Err(WriteError::Io(_))
        ));
        assert!(!t.root().join("nope").exists());
        assert!(leftovers(&t.root()).is_empty());
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
