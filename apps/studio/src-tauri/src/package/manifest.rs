//! Manifest `matscada.json` và digest nội dung của gói (contracts/matscada-package.md §3, §4, §8a).
//! Schema kiểm bằng tay trên `serde_json::Value` (bản C++ dùng valijson với
//! `schemas/package-manifest.schema.json`): khóa lạ ở cấp đầu, trong `project` và trong `generator`
//! được bỏ qua; mỗi mục của `files[]` có đúng ba khóa.

use super::rules::{
    MANIFEST_NAME, PackageError, display_name, path_key, path_rule_error, path_type_error,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const MAX_DEPTH: usize = 64;
/// `formatVersion` dài tối đa 64 ký tự (schema).
const MAX_SEMVER_LEN: usize = 64;

/// Một mục của `files[]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PackageFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub project_id: String,
    pub project_name: String,
    pub project_version: String,
    pub min_runtime_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Generator {
    pub name: String,
    pub version: String,
}

/// `matscada.json`; thứ tự trường là thứ tự ghi ra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: String,
    pub project: ProjectMeta,
    pub created_at: String,
    pub generator: Generator,
    pub files: Vec<PackageFile>,
    pub digest: String,
}

fn manifest_error(message: impl Into<String>) -> PackageError {
    PackageError::whole("E_PKG_MANIFEST", message)
}

/// SHA-256 dạng hex chữ thường.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn is_lower_hex64(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Digest nội dung (§4): `sha256:` + SHA-256 của các dòng `sha256 size path\n` sắp theo byte UTF-8
/// của `path`. Manifest không nằm trong digest.
pub fn package_digest(files: &[PackageFile]) -> String {
    let mut sorted: Vec<&PackageFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    let mut text = String::new();
    for f in sorted {
        text.push_str(&format!("{} {} {}\n", f.sha256, f.size, f.path));
    }
    format!("sha256:{}", sha256_hex(text.as_bytes()))
}

/// Độ sâu lồng của `[`/`{` ngoài chuỗi.
fn nesting_depth(text: &[u8]) -> usize {
    let (mut depth, mut max) = (0usize, 0usize);
    let (mut in_string, mut escaped) = (false, false);
    for &c in text {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == b'\\' {
                escaped = true;
            } else if c == b'"' {
                in_string = false;
            }
            continue;
        }
        match c {
            b'"' => in_string = true,
            b'[' | b'{' => {
                depth += 1;
                max = max.max(depth);
            }
            b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    max
}

/// `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$`
fn is_semver(s: &str) -> bool {
    if s.len() > MAX_SEMVER_LEN {
        return false;
    }
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (s, None),
    };
    if let Some(p) = pre
        && (p.is_empty()
            || !p
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-'))
    {
        return false;
    }
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.bytes().all(|c| c.is_ascii_digit())
                && (*p == "0" || !p.starts_with('0'))
        })
}

fn str_of<'a>(obj: &'a Value, key: &str, at: &str) -> Result<&'a str, PackageError> {
    obj.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| manifest_error(format!("Manifest sai schema tại {at}/{key}")))
}

fn object_of<'a>(obj: &'a Value, key: &str) -> Result<&'a Value, PackageError> {
    obj.get(key)
        .filter(|v| v.is_object())
        .ok_or_else(|| manifest_error(format!("Manifest sai schema tại /{key}")))
}

/// Phân tích và kiểm manifest. Thứ tự (như C++): BOM, UTF-8, độ sâu, JSON, schema, `files` tăng
/// dần, không có `matscada.json`, rồi luật đường dẫn từng mục (`E_PKG_PATH`, `E_PKG_TYPE`).
pub fn parse_manifest(text: &[u8]) -> Result<Manifest, PackageError> {
    if text.starts_with(b"\xEF\xBB\xBF") {
        return Err(manifest_error("Manifest có BOM (phải là UTF-8 không BOM)"));
    }
    if std::str::from_utf8(text).is_err() {
        return Err(manifest_error("Manifest không phải UTF-8 hợp lệ"));
    }
    if nesting_depth(text) > MAX_DEPTH {
        return Err(manifest_error("Manifest lồng quá sâu"));
    }
    let doc: Value = serde_json::from_slice(text)
        .map_err(|_| manifest_error("Manifest không phải JSON hợp lệ"))?;
    if !doc.is_object() {
        return Err(manifest_error("Manifest phải là một object JSON"));
    }

    if doc.get("format").and_then(Value::as_str) != Some("matscada-package") {
        return Err(manifest_error("Manifest sai schema tại /format"));
    }
    let format_version = str_of(&doc, "formatVersion", "")?;
    if !is_semver(format_version) {
        return Err(manifest_error("Manifest sai schema tại /formatVersion"));
    }
    let project = object_of(&doc, "project")?;
    let project = ProjectMeta {
        project_id: str_of(project, "projectId", "/project")?.to_string(),
        project_name: str_of(project, "projectName", "/project")?.to_string(),
        project_version: str_of(project, "projectVersion", "/project")?.to_string(),
        min_runtime_version: str_of(project, "minRuntimeVersion", "/project")?.to_string(),
    };
    let created_at = str_of(&doc, "createdAt", "")?.to_string();
    let generator = object_of(&doc, "generator")?;
    let generator = Generator {
        name: str_of(generator, "name", "/generator")?.to_string(),
        version: str_of(generator, "version", "/generator")?.to_string(),
    };
    let digest = str_of(&doc, "digest", "")?;
    if digest.len() != 71 || !digest.starts_with("sha256:") || !is_lower_hex64(&digest[7..]) {
        return Err(manifest_error("Manifest sai schema tại /digest"));
    }
    let list = doc
        .get("files")
        .and_then(Value::as_array)
        .filter(|a| (1..=1023).contains(&a.len()))
        .ok_or_else(|| manifest_error("Manifest sai schema tại /files"))?;
    let mut files = Vec::with_capacity(list.len());
    for (i, item) in list.iter().enumerate() {
        let bad = || manifest_error(format!("Manifest sai schema tại /files/{i}"));
        let obj = item.as_object().ok_or_else(bad)?;
        if obj.len() != 3 {
            return Err(bad());
        }
        let path = obj.get("path").and_then(Value::as_str).ok_or_else(bad)?;
        let size = obj.get("size").and_then(Value::as_u64).ok_or_else(bad)?;
        let sha256 = obj.get("sha256").and_then(Value::as_str).ok_or_else(bad)?;
        if !is_lower_hex64(sha256) {
            return Err(bad());
        }
        files.push(PackageFile {
            path: path.to_string(),
            size,
            sha256: sha256.to_string(),
        });
    }

    // files[]: tăng dần chặt theo byte UTF-8 (đã sắp, không trùng).
    for pair in files.windows(2) {
        if pair[0].path.as_bytes() >= pair[1].path.as_bytes() {
            return Err(manifest_error(
                "files của manifest trùng hoặc chưa sắp theo byte UTF-8 của path",
            ));
        }
    }
    if files.iter().any(|f| f.path == MANIFEST_NAME) {
        return Err(manifest_error(
            "files của manifest không được có matscada.json",
        ));
    }
    // Mỗi files[].path: luật 1–5 và 7 (`E_PKG_PATH`), rồi 6 (`E_PKG_TYPE`) (§5, §8a).
    let mut keys = HashSet::new();
    for f in &files {
        if let Some(e) = path_rule_error(&f.path) {
            return Err(e);
        }
        if !keys.insert(path_key(&f.path)) {
            return Err(PackageError::at(
                "E_PKG_PATH",
                &display_name(f.path.as_bytes()),
                "Trùng tên với file khác của manifest khi không phân biệt hoa thường",
            ));
        }
        if let Some(e) = path_type_error(&f.path) {
            return Err(e);
        }
    }
    Ok(Manifest {
        format: "matscada-package".into(),
        format_version: format_version.to_string(),
        project,
        created_at,
        generator,
        files,
        digest: digest.to_string(),
    })
}

/// MAJOR của `formatVersion` phải là 1.
pub fn format_major_supported(format_version: &str) -> bool {
    format_version.starts_with("1.")
}

/// Văn bản `matscada.json` do bộ ghi sinh: thụt 2 dấu cách, có `\n` cuối.
pub fn manifest_text(m: &Manifest) -> String {
    let mut s = serde_json::to_string_pretty(m).expect("manifest luôn tuần tự hóa được");
    s.push('\n');
    s
}
