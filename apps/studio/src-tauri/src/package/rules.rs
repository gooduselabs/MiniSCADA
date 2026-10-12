//! Luật chung của gói `.matscada` cho bộ đọc và bộ ghi (contracts/matscada-package.md §5, §6, §8a):
//! giới hạn, kiểu lỗi, đường dẫn, bí mật, trường định danh của `project.json`. Bản Rust của
//! `core/package/package_rules.cpp`: cùng bộ vector `tests/package-vectors/`, cùng mã lỗi.

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use std::cell::RefCell;
use std::fmt;

/// Gói ≤ 50 MiB (`E_PKG_TOO_LARGE`).
pub const MAX_PACKAGE_BYTES: u64 = 52_428_800;
/// Số entry, gồm manifest (`E_PKG_ENTRIES`).
pub const MAX_ENTRIES: usize = 1024;
/// File `.json` sau giải nén (`E_PKG_SIZE`).
pub const MAX_JSON_BYTES: u64 = 1024 * 1024;
/// File `.svg` sau giải nén (`E_PKG_SIZE`).
pub const MAX_SVG_BYTES: u64 = 5 * 1024 * 1024;
/// Tổng sau giải nén, gồm manifest (`E_PKG_SIZE`).
pub const MAX_TOTAL_BYTES: u64 = 200 * 1024 * 1024;
/// `matscada.json` (`E_PKG_MANIFEST`).
pub const MAX_MANIFEST_BYTES: u64 = 262_144;
/// Luật tỉ lệ nén chỉ áp cho entry lớn hơn mức này.
pub const RATIO_MIN_BYTES: u64 = 64 * 1024;
pub const MAX_RATIO: u64 = 100;
pub const MAX_PATH_BYTES: usize = 128;
pub const MAX_PATH_DEPTH: usize = 8;
pub const MANIFEST_NAME: &str = "matscada.json";

/// Lỗi của gói: `code` là `E_PKG_*` (contract §6), hoặc `STORE_IO` khi không đọc được; `path` là
/// entry gây lỗi (`None` khi lỗi của cả gói); `message` cho người đọc.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageError {
    pub code: &'static str,
    pub path: Option<String>,
    pub message: String,
}

impl PackageError {
    pub fn new(code: &'static str, path: Option<&str>, message: impl Into<String>) -> Self {
        PackageError {
            code,
            path: path.map(str::to_string),
            message: message.into(),
        }
    }

    pub fn whole(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(code, None, message)
    }

    pub fn at(code: &'static str, path: &str, message: impl Into<String>) -> Self {
        Self::new(code, Some(path), message)
    }
}

impl fmt::Display for PackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(p) => write!(f, "{} '{p}': {}", self.code, self.message),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

fn path_error(path: &str, message: &str) -> PackageError {
    PackageError::at("E_PKG_PATH", &display_name(path.as_bytes()), message)
}

fn is_control(c: u8) -> bool {
    c < 0x20 || c == 0x7f
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, có hay không có đuôi, mọi kiểu chữ.
fn is_windows_device_name(segment: &str) -> bool {
    let base = segment.split('.').next().unwrap_or("").to_ascii_lowercase();
    if matches!(base.as_str(), "con" | "prn" | "aux" | "nul") {
        return true;
    }
    let b = base.as_bytes();
    b.len() == 4
        && (base.starts_with("com") || base.starts_with("lpt"))
        && (b'1'..=b'9').contains(&b[3])
}

/// Luật 1–5 của §5 cho một đường dẫn (`E_PKG_PATH`).
pub fn path_rule_error(path: &str) -> Option<PackageError> {
    if path.is_empty() || path.len() > MAX_PATH_BYTES {
        return Some(path_error(path, "Đường dẫn phải dài 1–128 byte"));
    }
    if path.starts_with('/') {
        return Some(path_error(path, "Đường dẫn tuyệt đối (bắt đầu bằng '/')"));
    }
    for c in path.bytes() {
        if c == b'\\' || c == b':' {
            return Some(path_error(path, "Đường dẫn có ký tự '\\' hoặc ':'"));
        }
        if is_control(c) {
            return Some(path_error(path, "Đường dẫn có ký tự điều khiển"));
        }
        if matches!(c, b'<' | b'>' | b'"' | b'|' | b'?' | b'*') {
            return Some(path_error(
                path,
                "Đường dẫn có ký tự Windows không nhận (< > \" | ? *)",
            ));
        }
    }
    let mut segments = 0;
    for seg in path.split('/') {
        segments += 1;
        if seg.is_empty() || seg == "." || seg == ".." {
            return Some(path_error(path, "Đường dẫn có đoạn rỗng, '.' hoặc '..'"));
        }
        if seg.ends_with('.') || seg.ends_with(' ') {
            return Some(path_error(
                path,
                "Một đoạn của đường dẫn kết thúc bằng dấu chấm hoặc khoảng trắng",
            ));
        }
        if is_windows_device_name(seg) {
            return Some(path_error(
                path,
                "Một đoạn của đường dẫn là tên thiết bị của Windows (CON, PRN, AUX, NUL, COM1–9, LPT1–9)",
            ));
        }
    }
    if segments > MAX_PATH_DEPTH {
        return Some(path_error(path, "Đường dẫn sâu hơn 8 cấp"));
    }
    None
}

/// Luật 6 (`E_PKG_TYPE`): đuôi `.json` hoặc `.svg`, chữ thường.
pub fn path_type_error(path: &str) -> Option<PackageError> {
    if path.ends_with(".json") || path.ends_with(".svg") {
        None
    } else {
        Some(PackageError::at(
            "E_PKG_TYPE",
            &display_name(path.as_bytes()),
            "Gói chỉ chứa file .json và .svg (đuôi chữ thường)",
        ))
    }
}

/// Khóa của luật 7: hai đường dẫn cùng khóa là trùng (chỉ đổi A–Z).
pub fn path_key(path: &str) -> String {
    path.to_ascii_lowercase()
}

/// Giới hạn §6 của một entry theo kích thước khai báo: `E_PKG_SIZE` cho `.json` > 1 MiB, `.svg` > 5
/// MiB (trừ manifest, có giới hạn riêng); rồi `E_PKG_RATIO` cho entry > 64 KiB mà lớn hơn 100 lần
/// kích thước nén. Tổng cộng dồn là việc của người gọi.
pub fn entry_limit_error(
    path: &str,
    size: u64,
    compressed: u64,
    manifest: bool,
) -> Option<PackageError> {
    if !manifest && path.ends_with(".json") && size > MAX_JSON_BYTES {
        return Some(PackageError::at(
            "E_PKG_SIZE",
            path,
            "File JSON lớn hơn 1 MiB sau giải nén",
        ));
    }
    if !manifest && path.ends_with(".svg") && size > MAX_SVG_BYTES {
        return Some(PackageError::at(
            "E_PKG_SIZE",
            path,
            "File SVG lớn hơn 5 MiB sau giải nén",
        ));
    }
    if size > RATIO_MIN_BYTES && size > compressed.saturating_mul(MAX_RATIO) {
        return Some(PackageError::at(
            "E_PKG_RATIO",
            path,
            "Tỉ lệ nén lớn hơn 100 (nghi ZIP bomb)",
        ));
    }
    None
}

/// Tên entry như báo cáo hiện: byte không phải UTF-8 thành U+FFFD; quá 128 byte thì cắt ở ranh giới
/// ký tự và thêm "…".
pub fn display_name(name: &[u8]) -> String {
    let s = String::from_utf8_lossy(name);
    if s.len() <= MAX_PATH_BYTES {
        return s.into_owned();
    }
    let mut cut = MAX_PATH_BYTES;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &s[..cut])
}

// ---- Bí mật ----

fn key_looks_secret(key: &str) -> bool {
    const WORDS: [&str; 7] = [
        "password", "passwd", "pwd", "secret", "token", "apikey", "api_key",
    ];
    let lower = key.to_ascii_lowercase();
    WORDS.iter().any(|w| lower.contains(w))
}

/// `-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----` ở đâu đó trong các byte.
fn has_pem_private_key(s: &[u8]) -> bool {
    const BEGIN: &[u8] = b"-----BEGIN ";
    const KEY: &[u8] = b"PRIVATE KEY";
    let mut from = 0;
    while let Some(rel) = s[from..].windows(BEGIN.len()).position(|w| w == BEGIN) {
        let at = from + rel;
        let start = at + BEGIN.len();
        let mut end = start;
        while end < s.len()
            && (s[end].is_ascii_uppercase() || s[end].is_ascii_digit() || s[end] == b' ')
        {
            end += 1;
        }
        if s[start..end].ends_with(KEY) && s[end..].starts_with(b"-----") {
            return true;
        }
        from = at + 1;
    }
    false
}

/// Phần authority của URL (`user:pass@host:port`) có tài khoản: cùng luật với `E_LOG_SECRET`.
fn url_has_account(url: &str) -> bool {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    authority.contains('@')
}

#[derive(Default)]
struct Identity {
    project_id: Option<String>,
    project_name: Option<String>,
    project_version: Option<String>,
    min_runtime_version: Option<String>,
}

#[derive(Default)]
struct Scan {
    secret_key: Option<String>,
    url_account: bool,
    root_is_object: bool,
    identity: Identity,
}

/// Vị trí của giá trị đang đi qua: gốc, giá trị của một khóa ở gốc, mảng `connections` ở gốc, phần
/// tử của nó, trường của phần tử, hay chỗ khác.
#[derive(Clone)]
enum Pos {
    Root,
    RootField(String),
    Conns,
    ConnItem,
    ConnField(String),
    Other,
}

/// Một lượt đi qua tài liệu JSON mà không dựng cây (bộ nhớ không tăng theo kích thước tài liệu): ghi
/// khóa đầu tiên giống bí mật, `connections[i].url` đầu tiên có tài khoản, và bốn chuỗi định danh của
/// đối tượng gốc. Như bản C++ (SAX của nlohmann).
struct Walk<'a> {
    scan: &'a RefCell<Scan>,
    pos: Pos,
}

impl Walk<'_> {
    fn field_of_identity<'b>(scan: &'b mut Scan, key: &str) -> Option<&'b mut Option<String>> {
        match key {
            "projectId" => Some(&mut scan.identity.project_id),
            "projectName" => Some(&mut scan.identity.project_name),
            "projectVersion" => Some(&mut scan.identity.project_version),
            "minRuntimeVersion" => Some(&mut scan.identity.min_runtime_version),
            _ => None,
        }
    }

    /// Giá trị không phải chuỗi: xóa trường định danh nếu đang ở giá trị của khóa gốc.
    fn non_string(&self) {
        if let Pos::RootField(k) = &self.pos {
            let mut scan = self.scan.borrow_mut();
            if let Some(f) = Self::field_of_identity(&mut scan, k) {
                *f = None;
            }
        }
    }
}

impl<'de> DeserializeSeed<'de> for Walk<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Walk<'_> {
    type Value = ();

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("JSON")
    }

    fn visit_bool<E>(self, _: bool) -> Result<(), E> {
        self.non_string();
        Ok(())
    }
    fn visit_i64<E>(self, _: i64) -> Result<(), E> {
        self.non_string();
        Ok(())
    }
    fn visit_u64<E>(self, _: u64) -> Result<(), E> {
        self.non_string();
        Ok(())
    }
    fn visit_f64<E>(self, _: f64) -> Result<(), E> {
        self.non_string();
        Ok(())
    }
    fn visit_unit<E>(self) -> Result<(), E> {
        self.non_string();
        Ok(())
    }

    fn visit_str<E>(self, s: &str) -> Result<(), E> {
        match &self.pos {
            Pos::RootField(k) => {
                let mut scan = self.scan.borrow_mut();
                if let Some(f) = Self::field_of_identity(&mut scan, k) {
                    *f = Some(s.to_string());
                }
            }
            Pos::ConnField(k) if k == "url" && url_has_account(s) => {
                self.scan.borrow_mut().url_account = true;
            }
            _ => {}
        }
        Ok(())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        self.non_string();
        let child = if matches!(self.pos, Pos::Conns) {
            Pos::ConnItem
        } else {
            Pos::Other
        };
        while seq
            .next_element_seed(Walk {
                scan: self.scan,
                pos: child.clone(),
            })?
            .is_some()
        {}
        Ok(())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        self.non_string();
        let at_root = matches!(self.pos, Pos::Root);
        if at_root {
            self.scan.borrow_mut().root_is_object = true;
        }
        while let Some(key) = map.next_key::<String>()? {
            {
                let mut scan = self.scan.borrow_mut();
                if scan.secret_key.is_none() && key_looks_secret(&key) {
                    scan.secret_key = Some(key.clone());
                }
            }
            let child = match &self.pos {
                Pos::Root if key == "connections" => Pos::Conns,
                Pos::Root => Pos::RootField(key),
                Pos::ConnItem => Pos::ConnField(key),
                _ => Pos::Other,
            };
            map.next_value_seed(Walk {
                scan: self.scan,
                pos: child,
            })?;
        }
        Ok(())
    }
}

fn scan_json(bytes: &[u8]) -> Option<Scan> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let scan = RefCell::new(Scan::default());
    let mut de = serde_json::Deserializer::from_slice(bytes);
    Walk {
        scan: &scan,
        pos: Pos::Root,
    }
    .deserialize(&mut de)
    .ok()?;
    de.end().ok()?;
    Some(scan.into_inner())
}

/// Bí mật trong một file (`E_PKG_SECRET`): khối khóa riêng PEM trong file bất kỳ; trong file `.json`
/// đọc được như JSON: khóa chứa `password`, `passwd`, `pwd`, `secret`, `token`, `apikey`, `api_key`
/// ở độ sâu bất kỳ, và URL kết nối có tài khoản (`connections[i].url` của đối tượng gốc). `None` khi
/// không có, không thì mô tả cái tìm thấy.
pub fn find_secret(path: &str, content: &[u8]) -> Option<String> {
    if has_pem_private_key(content) {
        return Some("khối khóa riêng PEM (PRIVATE KEY)".into());
    }
    if !path.ends_with(".json") {
        return None;
    }
    let scan = scan_json(content)?;
    if let Some(k) = scan.secret_key {
        return Some(format!("khóa JSON giống bí mật '{k}'"));
    }
    if scan.url_account {
        return Some("URL kết nối có tài khoản (connections[].url)".into());
    }
    None
}

/// Bốn trường của `project.json` mà manifest lặp lại (`E_PKG_IDENTITY`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectIdentity {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub project_version: Option<String>,
    pub min_runtime_version: Option<String>,
}

/// `None` khi không phải đối tượng JSON; trường thiếu hoặc không phải chuỗi thì `None`; khóa lặp
/// giữ giá trị cuối.
pub fn read_project_identity(project_json: &[u8]) -> Option<ProjectIdentity> {
    let scan = scan_json(project_json)?;
    if !scan.root_is_object {
        return None;
    }
    Some(ProjectIdentity {
        project_id: scan.identity.project_id,
        project_name: scan.identity.project_name,
        project_version: scan.identity.project_version,
        min_runtime_version: scan.identity.min_runtime_version,
    })
}
