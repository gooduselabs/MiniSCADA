//! Gói `.matscada`: đóng gói, kiểm, đọc và giải nén (feature 005, research R12; contract
//! `contracts/matscada-package.md`). Cùng bộ luật và bộ vector `tests/package-vectors/` với bản C++ của
//! thiết bị (`core/package/`): mã lỗi giống 100 %.
//!
//! - `check_package`: kiểm một gói đúng như thiết bị (T093), thứ tự §8a;
//! - `build_package`: đóng gói tất định, deflate mức 6 (§7), tự kiểm lại bằng bộ đọc;
//! - `PackageStore`: gói tạm trong thư mục cache của ứng dụng, tối đa 4, giao diện chỉ thấy `packageId`;
//! - lệnh Tauri `package_build`, `package_read`, `package_discard` (tauri-commands §8).

pub mod extract;
pub mod manifest;
pub mod rules;
pub mod zip;

use crate::project_fs::{self, FileText, ReadError};
use crate::{ProjectRoot, recent};
use manifest::{
    Manifest, PackageFile, format_major_supported, manifest_text, package_digest, parse_manifest,
    sha256_hex,
};
pub use rules::PackageError;
use rules::{
    MANIFEST_NAME, MAX_JSON_BYTES, MAX_MANIFEST_BYTES, MAX_SVG_BYTES, MAX_TOTAL_BYTES,
    entry_limit_error, excluded_path, extra_file_error, find_secret, path_key, path_rule_error,
    path_type_error, read_project_identity,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::State;
use zip::{WriteItem, ZipEntry, read_directory, read_entry, write_zip};

const PROJECT_JSON: &str = "project.json";

/// Kết quả kiểm một gói hợp lệ.
#[derive(Debug, Clone)]
pub struct Checked {
    pub manifest: Manifest,
}

struct Facts {
    crc32: u32,
    sha256: String,
    secret: Option<String>,
}

fn facts_of(path: &str, bytes: &[u8]) -> Facts {
    Facts {
        crc32: zip::crc32(bytes),
        sha256: sha256_hex(bytes),
        secret: find_secret(path, bytes),
    }
}

fn same_identity(m: &Manifest, id: &rules::ProjectIdentity) -> bool {
    id.project_id.as_deref() == Some(m.project.project_id.as_str())
        && id.project_name.as_deref() == Some(m.project.project_name.as_str())
        && id.project_version.as_deref() == Some(m.project.project_version.as_str())
        && id.min_runtime_version.as_deref() == Some(m.project.min_runtime_version.as_str())
}

/// Kiểm gói đúng như thiết bị (T093, thứ tự §8a; lỗi đầu tiên thắng): kích thước, EOCD và entry,
/// manifest, kích thước khai báo của mọi entry, giải nén từng entry đếm byte thật, CRC, tập file,
/// digest, định danh, `formatVersion`, bí mật. `expected_digest` khác digest của manifest thì
/// `E_PKG_DIGEST` (header `X-Mat-Digest` khi đọc lên).
pub fn check_package(bytes: &[u8], expected_digest: Option<&str>) -> Result<Checked, PackageError> {
    // 1–3. Kích thước, bản ghi kết thúc, các entry.
    let entries = read_directory(bytes)?;

    // 4. Manifest.
    let first = &entries[0];
    if first.name != MANIFEST_NAME {
        return Err(PackageError::whole(
            "E_PKG_MANIFEST",
            "Entry đầu không phải manifest matscada.json",
        ));
    }
    if first.method != 0 {
        return Err(PackageError::whole(
            "E_PKG_MANIFEST",
            "Manifest phải ở dạng stored (không nén)",
        ));
    }
    if u64::from(first.size) > MAX_MANIFEST_BYTES {
        return Err(PackageError::whole(
            "E_PKG_MANIFEST",
            "Manifest lớn hơn 256 KiB",
        ));
    }
    let text = read_entry(bytes, first)?;
    let mut facts: Vec<Option<Facts>> = (0..entries.len()).map(|_| None).collect();
    facts[0] = Some(facts_of(&first.name, &text));
    let manifest = parse_manifest(&text)?;

    // 5a. Kích thước khai báo và tỉ lệ của mọi entry, trước khi giải nén byte nào.
    let mut total = 0u64;
    for (i, e) in entries.iter().enumerate() {
        if let Some(err) = entry_limit_error(
            &e.name,
            u64::from(e.size),
            u64::from(e.compressed_size),
            i == 0,
        ) {
            return Err(err);
        }
        total += u64::from(e.size);
        if total > MAX_TOTAL_BYTES {
            return Err(PackageError::at(
                "E_PKG_SIZE",
                &e.name,
                "Tổng sau giải nén lớn hơn 200 MiB",
            ));
        }
    }

    // 5b. Từng file của project, một lần một file, đếm byte thật.
    let mut identity = None;
    for (i, e) in entries.iter().enumerate().skip(1) {
        let data = read_entry(bytes, e)?;
        facts[i] = Some(facts_of(&e.name, &data));
        if e.name == PROJECT_JSON {
            identity = read_project_identity(&data);
        }
    }
    let facts: Vec<Facts> = facts.into_iter().map(|f| f.expect("đã tính")).collect();

    // 6. Checksum: CRC-32 mọi entry, rồi kích thước và SHA-256 so với files[].
    let listed: HashMap<&str, &PackageFile> = manifest
        .files
        .iter()
        .map(|f| (f.path.as_str(), f))
        .collect();
    for (i, e) in entries.iter().enumerate() {
        if facts[i].crc32 != e.crc32 {
            return Err(PackageError::at(
                "E_PKG_CHECKSUM",
                &e.name,
                "CRC-32 không khớp",
            ));
        }
        if i == 0 {
            continue;
        }
        let Some(f) = listed.get(e.name.as_str()) else {
            continue; // giai đoạn 7
        };
        if f.size != u64::from(e.size) {
            return Err(PackageError::at(
                "E_PKG_CHECKSUM",
                &e.name,
                "Kích thước khác manifest",
            ));
        }
        if f.sha256 != facts[i].sha256 {
            return Err(PackageError::at(
                "E_PKG_CHECKSUM",
                &e.name,
                "SHA-256 khác manifest",
            ));
        }
    }

    // 7. Tập file: tệp bị loại (feature 011, `E_PACKAGE_EXTRA_FILE`), rồi tệp không liệt kê, rồi tệp thiếu.
    let present: HashSet<&str> = entries.iter().skip(1).map(|e| e.name.as_str()).collect();
    if let Some(e) = entries.iter().skip(1).find(|e| excluded_path(&e.name)) {
        return Err(extra_file_error(&e.name));
    }
    for e in entries.iter().skip(1) {
        if !listed.contains_key(e.name.as_str()) {
            return Err(PackageError::at(
                "E_PKG_UNLISTED",
                &e.name,
                "File không có trong manifest",
            ));
        }
    }
    for f in &manifest.files {
        if !present.contains(f.path.as_str()) {
            return Err(PackageError::at(
                "E_PKG_MISSING",
                &f.path,
                "Manifest liệt kê file không có trong gói",
            ));
        }
    }

    // 8. Digest, định danh, formatVersion.
    if package_digest(&manifest.files) != manifest.digest {
        return Err(PackageError::whole(
            "E_PKG_DIGEST",
            "Digest của manifest khác giá trị tính lại",
        ));
    }
    if let Some(expected) = expected_digest
        && expected != manifest.digest
    {
        return Err(PackageError::whole(
            "E_PKG_DIGEST",
            "Digest của gói khác digest mong đợi",
        ));
    }
    if !identity
        .as_ref()
        .is_some_and(|id| same_identity(&manifest, id))
    {
        return Err(PackageError::whole(
            "E_PKG_IDENTITY",
            "Mã, tên, phiên bản hoặc runtime tối thiểu của manifest khác project.json",
        ));
    }
    if !format_major_supported(&manifest.format_version) {
        return Err(PackageError::whole(
            "E_PKG_FORMAT_VERSION",
            format!(
                "Định dạng gói {} không hỗ trợ (cần 1.x)",
                manifest.format_version
            ),
        ));
    }

    // 9. Bí mật: manifest trước, rồi từng entry.
    for (i, e) in entries.iter().enumerate() {
        if let Some(what) = &facts[i].secret {
            return Err(PackageError::at(
                "E_PKG_SECRET",
                &e.name,
                format!("Gói chứa thứ giống bí mật: {what}"),
            ));
        }
    }

    Ok(Checked { manifest })
}

/// Thông tin cố định lúc đóng gói: giờ tạo và phiên bản công cụ (vào manifest, không vào digest).
pub struct BuildMeta<'a> {
    pub created_at: &'a str,
    pub generator_version: &'a str,
}

/// Gói vừa đóng.
#[derive(Debug, Clone)]
pub struct Built {
    pub bytes: Vec<u8>,
    pub manifest: Manifest,
}

/// Đóng gói các file của project (`(đường dẫn, nội dung)`) theo §7: manifest đứng đầu và stored, file
/// sắp theo byte UTF-8 của đường dẫn, deflate mức 6 (stored khi bản nén không nhỏ hơn), giờ DOS cố
/// định, `generator` = `mAT Studio <phiên bản>`. Từ chối mọi đầu vào mà bộ đọc sẽ từ chối (gói vừa
/// ghi được kiểm lại bằng `check_package`), kể cả bí mật.
pub fn build_package(
    files: &[(String, Vec<u8>)],
    meta: &BuildMeta<'_>,
) -> Result<Built, PackageError> {
    if files.is_empty() || files.len() > 1023 {
        return Err(PackageError::whole(
            "E_PKG_ENTRIES",
            "Gói phải có 1–1023 file của project",
        ));
    }
    let mut sorted: Vec<&(String, Vec<u8>)> = files.iter().collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut keys = HashSet::new();
    let mut total = 0u64;
    for (path, data) in &sorted {
        if let Some(e) = path_rule_error(path) {
            return Err(e);
        }
        if path == MANIFEST_NAME || !keys.insert(path_key(path)) {
            return Err(PackageError::at(
                "E_PKG_PATH",
                path,
                "Tên trùng hoặc trùng tên manifest khi không phân biệt hoa thường",
            ));
        }
        if let Some(e) = path_type_error(path) {
            return Err(e);
        }
        // Feature 011: giao diện chỉ đưa tập file của project (`projectFiles`); project tham chiếu tệp bị
        // loại (`.mat-editor/`, tệp ẩn, `~*`…) thì thiết bị sẽ từ chối: báo ngay.
        if excluded_path(path) {
            return Err(extra_file_error(path));
        }
        let size = data.len() as u64;
        if let Some(e) = entry_limit_error(path, size, size, false) {
            return Err(e);
        }
        total += size;
        if total > MAX_TOTAL_BYTES {
            return Err(PackageError::at(
                "E_PKG_SIZE",
                path,
                "Tổng sau giải nén lớn hơn 200 MiB",
            ));
        }
    }
    let identity = sorted
        .iter()
        .find(|(p, _)| p == PROJECT_JSON)
        .and_then(|(_, d)| read_project_identity(d))
        .and_then(|id| {
            Some(manifest::ProjectMeta {
                project_id: id.project_id?,
                project_name: id.project_name?,
                project_version: id.project_version?,
                min_runtime_version: id.min_runtime_version?,
            })
        })
        .ok_or_else(|| {
            PackageError::at(
                "E_PKG_IDENTITY",
                PROJECT_JSON,
                "project.json thiếu hoặc không có đủ mã, tên, phiên bản, runtime tối thiểu",
            )
        })?;
    let listed: Vec<PackageFile> = sorted
        .iter()
        .map(|(p, d)| PackageFile {
            path: p.clone(),
            size: d.len() as u64,
            sha256: sha256_hex(d),
        })
        .collect();
    let manifest = Manifest {
        format: "matscada-package".into(),
        format_version: "1.0.0".into(),
        project: identity,
        created_at: meta.created_at.to_string(),
        generator: manifest::Generator {
            name: "mAT Studio".into(),
            version: meta.generator_version.to_string(),
        },
        digest: package_digest(&listed),
        files: listed,
    };
    let text = manifest_text(&manifest);
    let mut items = vec![WriteItem {
        path: MANIFEST_NAME,
        data: text.as_bytes(),
        deflate: false,
    }];
    items.extend(sorted.iter().map(|(p, d)| WriteItem {
        path: p,
        data: d,
        deflate: true,
    }));
    let bytes = write_zip(&items)?;
    check_package(&bytes, None)?;
    Ok(Built { bytes, manifest })
}

/// Giới hạn của một file theo loại, như `project_read` của 004.
fn read_limit(rel: &str) -> u64 {
    if rel.ends_with(".svg") {
        MAX_SVG_BYTES
    } else {
        MAX_JSON_BYTES
    }
}

/// Nội dung một file của project trong gói đã kiểm: cùng định dạng và mã lỗi với `project_read` của
/// 004 (`Missing`, `BadPath`, `TooLarge`, `BadUtf8`). Manifest không phải file của project.
pub fn read_package_file(package: &[u8], rel: &str) -> Result<FileText, ReadError> {
    project_fs::check_rel(rel).map_err(|_| ReadError::BadPath)?;
    let entries = read_directory(package).map_err(|_| ReadError::Missing)?;
    let entry: &ZipEntry = entries
        .iter()
        .skip(1)
        .find(|e| e.name == rel)
        .ok_or(ReadError::Missing)?;
    if u64::from(entry.size) > read_limit(rel) {
        return Err(ReadError::TooLarge);
    }
    let data = read_entry(package, entry).map_err(|_| ReadError::Missing)?;
    let hash = sha256_hex(&data);
    let text = String::from_utf8(data).map_err(|_| ReadError::BadUtf8)?;
    Ok(FileText { text, hash })
}

// ---- Dựng gói từ project đang mở (`package_build`) ----

/// Một file của project kèm SHA-256 lúc giao diện đọc.
#[derive(Debug, Clone, Deserialize)]
pub struct FileRef {
    pub rel: String,
    pub hash: String,
}

/// Lỗi của `package_build` (tauri-commands §8): chuỗi kebab-case, hoặc đối tượng một khóa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildError {
    NoProject,
    BadPath,
    /// File trên đĩa khác lúc giao diện đọc.
    Changed(String),
    TooLarge(String),
    Package(String),
    Io(String),
}

/// Đọc lại từng file trong `root`, so SHA-256 với lần đọc của giao diện, rồi đóng gói.
pub fn build_from_project(
    root: &std::path::Path,
    files: &[FileRef],
    meta: &BuildMeta<'_>,
) -> Result<Built, BuildError> {
    let mut read = Vec::with_capacity(files.len());
    for f in files {
        let text = match project_fs::read_text(root, &f.rel) {
            Ok(t) => t,
            Err(ReadError::BadPath) => return Err(BuildError::BadPath),
            Err(ReadError::Missing) => return Err(BuildError::Changed(f.rel.clone())),
            Err(ReadError::TooLarge) => return Err(BuildError::TooLarge(f.rel.clone())),
            Err(ReadError::BadUtf8) => {
                return Err(BuildError::Io(format!("{}: không phải UTF-8", f.rel)));
            }
        };
        if text.hash != f.hash {
            return Err(BuildError::Changed(f.rel.clone()));
        }
        read.push((f.rel.clone(), text.text.into_bytes()));
    }
    build_package(&read, meta).map_err(|e| match (e.code, e.path) {
        ("E_PKG_SIZE", Some(path)) if e.message.starts_with("File ") => BuildError::TooLarge(path),
        (code, _) => BuildError::Package(code.to_string()),
    })
}

// ---- Gói tạm ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Built,
    Fetched,
}

/// Gói tạm như giao diện thấy (`PackageInfo`, data-model §8): chỉ có `packageId`, không có đường dẫn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub package_id: String,
    pub origin: Origin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u32>,
    pub digest: String,
    pub size: u64,
    pub manifest: Manifest,
}

/// Tối đa 4 gói tạm cùng lúc; gói thứ 5 đẩy gói cũ nhất ra.
pub const MAX_STORED_PACKAGES: usize = 4;

struct Stored {
    id: String,
    file: PathBuf,
    digest: String,
}

/// Gói tạm trong thư mục cache của ứng dụng. Xóa hết khi mở (rác của lần chạy trước) và khi đóng
/// Studio.
pub struct PackageStore {
    dir: PathBuf,
    items: Mutex<Vec<Stored>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl PackageStore {
    pub fn new(dir: PathBuf) -> Self {
        let store = PackageStore {
            dir,
            items: Mutex::new(Vec::new()),
        };
        store.remove_stale();
        store
    }

    /// File `*.matscada` còn sót lại của lần chạy trước (Studio bị tắt đột ngột).
    fn remove_stale(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "matscada") {
                let _ = fs::remove_file(p);
            }
        }
    }

    /// Lưu gói đã kiểm; trả thông tin cho giao diện.
    pub fn put(
        &self,
        bytes: &[u8],
        manifest: Manifest,
        origin: Origin,
        device_id: Option<String>,
        seq: Option<u32>,
    ) -> Result<PackageInfo, String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let file = self.dir.join(format!("{id}.matscada"));
        project_fs::write_atomic(&file, bytes).map_err(|e| e.to_string())?;
        let mut items = lock(&self.items);
        items.push(Stored {
            id: id.clone(),
            file,
            digest: manifest.digest.clone(),
        });
        while items.len() > MAX_STORED_PACKAGES {
            let old = items.remove(0);
            let _ = fs::remove_file(old.file);
        }
        Ok(PackageInfo {
            package_id: id,
            origin,
            device_id,
            seq,
            digest: manifest.digest.clone(),
            size: bytes.len() as u64,
            manifest,
        })
    }

    /// Byte của gói; `None` khi không có (đã bị đẩy ra hoặc đã xóa).
    pub fn bytes(&self, id: &str) -> Option<Vec<u8>> {
        let file = lock(&self.items)
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.file.clone())?;
        fs::read(file).ok()
    }

    /// Byte và digest của gói (để nạp xuống); `None` khi không có.
    pub fn get(&self, id: &str) -> Option<(Vec<u8>, String)> {
        let (file, digest) = lock(&self.items)
            .iter()
            .find(|s| s.id == id)
            .map(|s| (s.file.clone(), s.digest.clone()))?;
        Some((fs::read(file).ok()?, digest))
    }

    /// Xóa một gói; `id` lạ thì bỏ qua.
    pub fn discard(&self, id: &str) {
        let mut items = lock(&self.items);
        if let Some(i) = items.iter().position(|s| s.id == id) {
            let _ = fs::remove_file(items.remove(i).file);
        }
    }

    /// Xóa hết (đóng Studio).
    pub fn clear(&self) {
        for s in lock(&self.items).drain(..) {
            let _ = fs::remove_file(s.file);
        }
        self.remove_stale();
    }

    #[cfg(test)]
    pub fn count(&self) -> usize {
        lock(&self.items).len()
    }
}

// ---- Lệnh Tauri (contracts/tauri-commands.md §8) ----

/// `package_build({ files: [{ rel, hash }] }) → PackageInfo`. Đóng gói là việc nặng (tới 50 MiB): chạy
/// ngoài luồng giao diện.
#[tauri::command]
pub async fn package_build(
    files: Vec<FileRef>,
    root: State<'_, ProjectRoot>,
    store: State<'_, PackageStore>,
) -> Result<PackageInfo, BuildError> {
    let root = crate::root_of(&root).ok_or(BuildError::NoProject)?;
    let built = tauri::async_runtime::spawn_blocking(move || {
        build_from_project(
            &root,
            &files,
            &BuildMeta {
                created_at: &recent::now_utc(),
                generator_version: env!("CARGO_PKG_VERSION"),
            },
        )
    })
    .await
    .map_err(|e| BuildError::Io(e.to_string()))??;
    store
        .put(&built.bytes, built.manifest, Origin::Built, None, None)
        .map_err(BuildError::Io)
}

/// `package_read({ packageId, rel }) → { text, hash }`: cùng định dạng và mã lỗi với `project_read`.
#[tauri::command]
pub async fn package_read(
    package_id: String,
    rel: String,
    store: State<'_, PackageStore>,
) -> Result<FileText, ReadError> {
    let bytes = store.bytes(&package_id).ok_or(ReadError::Missing)?;
    tauri::async_runtime::spawn_blocking(move || read_package_file(&bytes, &rel))
        .await
        .map_err(|_| ReadError::Missing)?
}

/// `package_discard({ packageId }) → null`
#[tauri::command]
pub fn package_discard(package_id: String, store: State<'_, PackageStore>) {
    store.discard(&package_id);
}

#[cfg(test)]
mod tests {
    use super::manifest::package_digest;
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn repo() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    fn vectors_dir() -> PathBuf {
        repo().join("tests/package-vectors")
    }

    /// Bytes của gói trong thư mục vector: `package.matscada`, hoặc `generated` (gói lớn không commit).
    fn package_of(dir: &Path, expected: &Value) -> Vec<u8> {
        let file = match expected.get("generated").and_then(Value::as_str) {
            Some(rel) => vectors_dir().join(rel),
            None => dir.join("package.matscada"),
        };
        fs::read(&file).unwrap_or_else(|e| {
            panic!(
                "thiếu {}: {e}. Chạy `node tests/package-vectors/generate.mjs --out` trước",
                file.display()
            )
        })
    }

    struct Vector {
        name: String,
        expected: Value,
        bytes: Vec<u8>,
    }

    /// Mọi vector có gói và `ok` hoặc `code` (bỏ vector digest, không có gói).
    fn vectors() -> Vec<Vector> {
        let mut out = Vec::new();
        let mut dirs: Vec<_> = fs::read_dir(vectors_dir())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.join("expected.json").is_file())
            .collect();
        dirs.sort();
        for dir in dirs {
            let expected: Value =
                serde_json::from_slice(&fs::read(dir.join("expected.json")).unwrap()).unwrap();
            if expected.get("ok").is_none() && expected.get("code").is_none() {
                continue;
            }
            let bytes = package_of(&dir, &expected);
            out.push(Vector {
                name: dir.file_name().unwrap().to_string_lossy().into_owned(),
                expected,
                bytes,
            });
        }
        out
    }

    /// T114: mọi vector của bộ chung cho cùng mã lỗi (và `path` khi có) như bản C++.
    #[test]
    fn every_shared_vector_gives_the_expected_result() {
        let all = vectors();
        assert!(all.len() >= 72, "chỉ thấy {} vector", all.len());
        for v in &all {
            let got = check_package(&v.bytes, None);
            // Feature 011: tệp thừa tầng project (`stage: project`) là gói hợp lệ; bước kiểm project sau
            // khi giải nén (C++ `projectExtraFiles`, TS `extraProjectFiles`) mới từ chối.
            let project_stage = v.expected.get("stage").and_then(Value::as_str) == Some("project");
            if project_stage || v.expected.get("ok").and_then(Value::as_bool) == Some(true) {
                let ok = got.unwrap_or_else(|e| panic!("{}: mong đợi hợp lệ, nhận {e}", v.name));
                assert_eq!(
                    Some(ok.manifest.digest.as_str()),
                    v.expected["digest"].as_str(),
                    "{}: digest",
                    v.name
                );
                if let Some(files) = v.expected.get("files") {
                    assert_eq!(
                        serde_json::to_value(&ok.manifest.files).unwrap(),
                        *files,
                        "{}: files",
                        v.name
                    );
                }
            } else {
                let e = got.expect_err(&format!("{}: mong đợi lỗi", v.name));
                assert_eq!(Some(e.code), v.expected["code"].as_str(), "{}: {e}", v.name);
                if let Some(path) = v.expected.get("path").and_then(Value::as_str) {
                    assert_eq!(e.path.as_deref(), Some(path), "{}: path ({e})", v.name);
                }
            }
        }
    }

    /// Vector digest không có gói: `text` đem băm, `files` không theo thứ tự (§4, §9).
    #[test]
    fn digest_vectors_match() {
        for name in ["digest-basic", "digest-order"] {
            let expected: Value = serde_json::from_slice(
                &fs::read(vectors_dir().join(name).join("expected.json")).unwrap(),
            )
            .unwrap();
            let files: Vec<manifest::PackageFile> = expected["files"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| manifest::PackageFile {
                    path: f["path"].as_str().unwrap().into(),
                    size: f["size"].as_u64().unwrap(),
                    sha256: f["sha256"].as_str().unwrap().into(),
                })
                .collect();
            assert_eq!(
                package_digest(&files),
                expected["digest"].as_str().unwrap(),
                "{name}"
            );
        }
    }

    // ---- Đóng gói ----

    const CREATED_AT: &str = "2026-10-12T00:00:00Z";
    const GENERATOR_VERSION: &str = "0.2.0";
    const META: BuildMeta<'static> = BuildMeta {
        created_at: CREATED_AT,
        generator_version: GENERATOR_VERSION,
    };

    /// File của `projects/tank-demo` (tập `projectFiles`).
    fn tank_demo() -> Vec<(String, Vec<u8>)> {
        let root = repo().join("projects/tank-demo");
        let mut out = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    let rel = p
                        .strip_prefix(&root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.push((rel, fs::read(&p).unwrap()));
                }
            }
        }
        out
    }

    /// Các byte của entry `name` theo thứ tự trong gói (để kiểm bố cục).
    fn entries(bytes: &[u8]) -> Vec<zip::ZipEntry> {
        zip::read_directory(bytes).unwrap()
    }

    /// T114: hai lần đóng cho cùng byte; manifest đứng đầu và stored; file sắp theo đường dẫn; deflate
    /// khi nhỏ hơn; `generator` = `mAT Studio <phiên bản>`; digest bằng của bộ ghi C++.
    #[test]
    fn building_is_deterministic_and_follows_the_layout() {
        let files = tank_demo();
        let a = build_package(&files, &META).unwrap();
        let mut reversed = files.clone();
        reversed.reverse();
        let b = build_package(&reversed, &META).unwrap();
        assert_eq!(a.bytes, b.bytes, "thứ tự đầu vào không đổi kết quả");
        assert_eq!(a.bytes, build_package(&files, &META).unwrap().bytes);

        let list = entries(&a.bytes);
        assert_eq!(list[0].name, "matscada.json");
        assert_eq!(list[0].method, 0, "manifest stored");
        let names: Vec<&str> = list.iter().skip(1).map(|e| e.name.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_by(|x, y| x.as_bytes().cmp(y.as_bytes()));
        assert_eq!(names, sorted);
        assert!(
            list.iter().skip(1).any(|e| e.method == 8),
            "ít nhất một file được nén"
        );
        for e in list.iter().skip(1) {
            if e.method == 8 {
                assert!(e.compressed_size < e.size, "{}: nén phải nhỏ hơn", e.name);
            }
        }
        assert_eq!(a.manifest.generator.name, "mAT Studio");
        assert_eq!(a.manifest.generator.version, GENERATOR_VERSION);
        assert_eq!(a.manifest.created_at, CREATED_AT);
        // Digest không phụ thuộc công cụ hay mức nén: bằng digest của bộ ghi C++ cho cùng project.
        assert_eq!(
            a.manifest.digest,
            "sha256:9ba112c6ddbd961f0336f8b246ff172826d544130a7fe1168cb10b2b2861edb7"
        );
        assert!(check_package(&a.bytes, Some(&a.manifest.digest)).is_ok());
    }

    /// T114: file không nén được (bản nén không nhỏ hơn) thì stored.
    #[test]
    fn incompressible_and_tiny_files_are_stored() {
        let mut files = tank_demo();
        // 64 byte "ngẫu nhiên" tất định (không phải JSON): deflate không nhỏ hơn.
        let mut x = 0x9e37_79b9_7f4a_7c15u64;
        let noise: Vec<u8> = (0..64)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x >> 24) as u8
            })
            .collect();
        files.push(("noise.json".into(), noise));
        files.push(("empty.json".into(), Vec::new()));
        let built = build_package(&files, &META).unwrap();
        let list = entries(&built.bytes);
        for name in ["noise.json", "empty.json"] {
            let e = list.iter().find(|e| e.name == name).unwrap();
            assert_eq!(e.method, 0, "{name} phải stored");
        }
    }

    /// T115: gói do bộ ghi Rust đóng từ `projects/tank-demo` khớp từng byte vector golden
    /// `valid-studio-tank-demo`. Đổi bộ ghi hoặc project thì sinh lại bằng `MAT_WRITE_GOLDEN=1`.
    #[test]
    fn golden_studio_tank_demo_matches_byte_for_byte() {
        let dir = vectors_dir().join("valid-studio-tank-demo");
        let built = build_package(&tank_demo(), &META).unwrap();
        if std::env::var_os("MAT_WRITE_GOLDEN").is_some() {
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("package.matscada"), &built.bytes).unwrap();
            let expected = serde_json::json!({
                "ok": true,
                "digest": built.manifest.digest,
                "files": built.manifest.files,
            });
            fs::write(
                dir.join("expected.json"),
                serde_json::to_string_pretty(&expected).unwrap() + "\n",
            )
            .unwrap();
        }
        let golden = fs::read(dir.join("package.matscada")).unwrap_or_else(|_| {
            panic!("thiếu vector golden: chạy test này với MAT_WRITE_GOLDEN=1")
        });
        assert_eq!(
            built.bytes, golden,
            "bộ ghi hoặc projects/tank-demo đã đổi: sinh lại bằng MAT_WRITE_GOLDEN=1"
        );
    }

    /// T114: bộ ghi từ chối mọi đầu vào mà bộ đọc sẽ từ chối.
    #[test]
    fn building_refuses_what_the_reader_refuses() {
        let with = |name: &str, body: &str| {
            let mut f = tank_demo();
            f.push((name.into(), body.as_bytes().to_vec()));
            build_package(&f, &META)
        };
        let code = |r: Result<Built, PackageError>| r.unwrap_err().code;
        assert_eq!(code(with("a.json", r#"{"apiKey":"x"}"#)), "E_PKG_SECRET");
        assert_eq!(code(with("../x.json", "{}")), "E_PKG_PATH");
        assert_eq!(code(with("CON.json", "{}")), "E_PKG_PATH");
        assert_eq!(code(with("x.js", "{}")), "E_PKG_TYPE");
        assert_eq!(code(with("matscada.json", "{}")), "E_PKG_PATH");
        // Feature 011 (T024): tệp bị loại không bao giờ vào gói.
        for p in [
            ".mat-editor/state.json",
            ".mat-backup/1/tags.json",
            "~x.json",
            "s/.h.svg",
        ] {
            assert_eq!(code(with(p, "{}")), "E_PACKAGE_EXTRA_FILE", "{p}");
        }
        assert_eq!(
            code(with("TAGS.json", "{}")),
            "E_PKG_PATH",
            "trùng tags.json"
        );
        // PEM trong SVG.
        assert_eq!(
            code(with(
                "screens/k.svg",
                "<svg>-----BEGIN RSA PRIVATE KEY-----</svg>"
            )),
            "E_PKG_SECRET"
        );
        // Thiếu project.json hoặc thiếu trường định danh.
        let no_project: Vec<_> = tank_demo()
            .into_iter()
            .filter(|(p, _)| p != "project.json")
            .collect();
        assert_eq!(
            build_package(&no_project, &META).unwrap_err().code,
            "E_PKG_IDENTITY"
        );
        assert_eq!(build_package(&[], &META).unwrap_err().code, "E_PKG_ENTRIES");
        let big = vec![b' '; 1024 * 1024 + 1];
        let mut f = tank_demo();
        f.push(("big.json".into(), big));
        let e = build_package(&f, &META).unwrap_err();
        assert_eq!(
            (e.code, e.path.as_deref()),
            ("E_PKG_SIZE", Some("big.json"))
        );
    }

    // ---- package_build: đọc lại file trên đĩa ----

    struct Dir(PathBuf);
    impl Dir {
        fn new(name: &str) -> Dir {
            let p = std::env::temp_dir()
                .join(format!("mat-pkg-{name}-{}", uuid::Uuid::new_v4().simple()));
            fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Chép `projects/tank-demo` vào thư mục tạm; trả danh sách `FileRef` như giao diện gửi.
    fn project_copy(name: &str) -> (Dir, Vec<FileRef>) {
        let dir = Dir::new(name);
        let mut refs = Vec::new();
        for (rel, data) in tank_demo() {
            let path = dir.0.join(&rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, &data).unwrap();
            refs.push(FileRef {
                rel,
                hash: sha256_hex(&data),
            });
        }
        (dir, refs)
    }

    #[test]
    fn build_from_project_packs_the_files_on_disk() {
        let (dir, refs) = project_copy("build-ok");
        let built = build_from_project(&dir.0, &refs, &META).unwrap();
        assert_eq!(
            built.bytes,
            build_package(&tank_demo(), &META).unwrap().bytes
        );
    }

    #[test]
    fn build_from_project_reports_a_file_changed_since_the_ui_read_it() {
        let (dir, refs) = project_copy("build-changed");
        fs::write(dir.0.join("tags.json"), b"{}").unwrap();
        assert_eq!(
            build_from_project(&dir.0, &refs, &META).unwrap_err(),
            BuildError::Changed("tags.json".into())
        );
        fs::remove_file(dir.0.join("tags.json")).unwrap();
        assert_eq!(
            build_from_project(&dir.0, &refs, &META).unwrap_err(),
            BuildError::Changed("tags.json".into()),
            "file bị xóa cũng là đã đổi"
        );
    }

    #[test]
    fn build_from_project_maps_the_other_errors() {
        let (dir, mut refs) = project_copy("build-errors");
        // Bí mật: gói bị từ chối, không có đường dẫn trong lỗi (contract §8).
        let secret = br#"{"schemaVersion":"0.1.0","tags":[],"password":"x"}"#;
        fs::write(dir.0.join("tags.json"), secret).unwrap();
        refs.iter_mut().find(|r| r.rel == "tags.json").unwrap().hash = sha256_hex(secret);
        assert_eq!(
            build_from_project(&dir.0, &refs, &META).unwrap_err(),
            BuildError::Package("E_PKG_SECRET".into())
        );
        // Đường dẫn xấu.
        let bad = vec![FileRef {
            rel: "../x.json".into(),
            hash: String::new(),
        }];
        assert_eq!(
            build_from_project(&dir.0, &bad, &META).unwrap_err(),
            BuildError::BadPath
        );
        // File quá giới hạn.
        let (dir, mut refs) = project_copy("build-big");
        let big = vec![b' '; 1024 * 1024 + 1];
        fs::write(dir.0.join("tags.json"), &big).unwrap();
        refs.iter_mut().find(|r| r.rel == "tags.json").unwrap().hash = sha256_hex(&big);
        assert_eq!(
            build_from_project(&dir.0, &refs, &META).unwrap_err(),
            BuildError::TooLarge("tags.json".into())
        );
    }

    #[test]
    fn build_errors_serialize_as_the_contract_says() {
        let j = |e: BuildError| serde_json::to_value(e).unwrap();
        assert_eq!(j(BuildError::NoProject), serde_json::json!("no-project"));
        assert_eq!(j(BuildError::BadPath), serde_json::json!("bad-path"));
        assert_eq!(
            j(BuildError::Changed("a.json".into())),
            serde_json::json!({ "changed": "a.json" })
        );
        assert_eq!(
            j(BuildError::TooLarge("a.json".into())),
            serde_json::json!({ "too-large": "a.json" })
        );
        assert_eq!(
            j(BuildError::Package("E_PKG_SECRET".into())),
            serde_json::json!({ "package": "E_PKG_SECRET" })
        );
        assert_eq!(
            j(BuildError::Io("x".into())),
            serde_json::json!({ "io": "x" })
        );
    }

    // ---- Gói tạm, đọc file trong gói ----

    #[test]
    fn the_store_keeps_four_packages_and_hides_paths() {
        let dir = Dir::new("store");
        let store = PackageStore::new(dir.0.join("packages"));
        let built = build_package(&tank_demo(), &META).unwrap();
        let mut ids = Vec::new();
        for _ in 0..5 {
            let info = store
                .put(
                    &built.bytes,
                    built.manifest.clone(),
                    Origin::Built,
                    None,
                    None,
                )
                .unwrap();
            assert_eq!(info.digest, built.manifest.digest);
            assert_eq!(info.size, built.bytes.len() as u64);
            let json = serde_json::to_string(&info).unwrap();
            assert!(!json.contains(".matscada"), "không lộ đường dẫn: {json}");
            assert!(!json.contains("packages"), "không lộ đường dẫn: {json}");
            ids.push(info.package_id);
        }
        assert_eq!(store.count(), 4);
        assert!(store.bytes(&ids[0]).is_none(), "gói cũ nhất bị đẩy ra");
        assert_eq!(store.bytes(&ids[4]).unwrap(), built.bytes);
        let on_disk = |d: &Path| fs::read_dir(d).unwrap().flatten().count();
        assert_eq!(
            on_disk(&dir.0.join("packages")),
            4,
            "file của gói bị đẩy ra đã xóa"
        );
        store.discard(&ids[4]);
        store.discard("khong-co");
        assert_eq!(store.count(), 3);
        assert!(store.bytes(&ids[4]).is_none());
        store.clear();
        assert_eq!(store.count(), 0);
        assert_eq!(on_disk(&dir.0.join("packages")), 0);
    }

    #[test]
    fn a_new_store_removes_leftovers_of_a_previous_run() {
        let dir = Dir::new("stale");
        let packages = dir.0.join("packages");
        fs::create_dir_all(&packages).unwrap();
        fs::write(packages.join("old.matscada"), b"x").unwrap();
        let _ = PackageStore::new(packages.clone());
        assert!(!packages.join("old.matscada").exists());
    }

    #[test]
    fn reading_a_file_of_a_package_follows_project_read() {
        let built = build_package(&tank_demo(), &META).unwrap();
        let tags = read_package_file(&built.bytes, "tags.json").unwrap();
        let original = tank_demo()
            .into_iter()
            .find(|(p, _)| p == "tags.json")
            .unwrap()
            .1;
        assert_eq!(tags.text.as_bytes(), original.as_slice());
        assert_eq!(tags.hash, sha256_hex(&original));
        assert_eq!(
            read_package_file(&built.bytes, "khong-co.json"),
            Err(ReadError::Missing)
        );
        assert_eq!(
            read_package_file(&built.bytes, "../tags.json"),
            Err(ReadError::BadPath)
        );
        assert_eq!(
            read_package_file(&built.bytes, "matscada.json"),
            Err(ReadError::Missing),
            "manifest không phải file của project"
        );
        // bad-utf8: file có byte không phải UTF-8 (gói tự dựng, bộ ghi cho phép vì không phải bí mật).
        let mut files = tank_demo();
        files.push(("bin.json".into(), vec![0xff, 0xfe, 0x41]));
        let packed = build_package(&files, &META).unwrap();
        assert_eq!(
            read_package_file(&packed.bytes, "bin.json"),
            Err(ReadError::BadUtf8)
        );
    }

    // ---- Đột biến (như T092) ----

    struct SplitMix(u64);
    impl SplitMix {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    /// T114: 10.000 biến thể (hạt giống cố định) của các gói hợp lệ: không panic, luôn trả `E_PKG_*`
    /// hoặc hợp lệ; gói hợp lệ vẫn đọc ra đúng.
    #[test]
    fn ten_thousand_mutations_never_panic_and_give_package_codes() {
        let seeds: Vec<Vec<u8>> = vectors()
            .into_iter()
            .filter(|v| {
                v.expected.get("ok").and_then(Value::as_bool) == Some(true)
                    && v.bytes.len() < 100_000
            })
            .map(|v| v.bytes)
            .collect();
        assert!(seeds.len() >= 5, "chỉ có {} gói hợp lệ nhỏ", seeds.len());
        let mut rng = SplitMix(0x5eed_0005);
        let mut codes = std::collections::BTreeMap::new();
        for _ in 0..10_000 {
            let mut b = seeds[rng.below(seeds.len())].clone();
            match rng.below(7) {
                0 => {
                    let i = rng.below(b.len());
                    b[i] ^= 1 << rng.below(8);
                }
                1 => b.truncate(rng.below(b.len())),
                2 => {
                    // Đổi trường độ dài/offset trong EOCD hoặc một header.
                    let n = b.len();
                    let base = if rng.below(2) == 0 {
                        n - 22
                    } else {
                        rng.below(n.saturating_sub(46))
                    };
                    let at = (base + rng.below(20)).min(n - 4);
                    let v = [0u32, 1, 0xffff, 0xffff_ffff, rng.next() as u32][rng.below(5)];
                    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
                }
                3 => {
                    let at = rng.below(b.len());
                    let extra = rng.below(16) + 1;
                    let fill = rng.next() as u8;
                    b.splice(at..at, std::iter::repeat_n(fill, extra));
                }
                4 => {
                    let at = rng.below(b.len());
                    let end = (at + rng.below(32) + 1).min(b.len());
                    b.drain(at..end);
                    if b.is_empty() {
                        b.push(0);
                    }
                }
                5 => {
                    let n = b.len();
                    let at = rng.below(n);
                    b[at] = rng.next() as u8;
                    let at = rng.below(n);
                    b[at] = rng.next() as u8;
                }
                _ => {
                    // Đổi một cặp byte lân cận (đổi chỗ).
                    let at = rng.below(b.len() - 1);
                    b.swap(at, at + 1);
                }
            }
            let key = match check_package(&b, None) {
                Ok(_) => "ok".to_string(),
                Err(e) => {
                    assert!(
                        e.code.starts_with("E_PKG_"),
                        "mã ngoài E_PKG_*: {e} (gói {} byte)",
                        b.len()
                    );
                    e.code.to_string()
                }
            };
            *codes.entry(key).or_insert(0u32) += 1;
        }
        assert!(codes.len() >= 4, "đột biến quá đơn điệu: {codes:?}");
    }
}
