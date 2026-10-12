//! Giải nén gói `.matscada` thành project mới trên máy kỹ sư (contract `matscada-package.md` §8, phần
//! Studio; `tauri-commands.md` §8 `package_extract`).
//!
//! - chỉ vào thư mục rỗng do người dùng chọn bằng hộp thoại (`not-empty`);
//! - mỗi file mở bằng `create_new`: lỗi nếu đã có, nên cũng bắt trùng tên không phân biệt hoa thường
//!   của NTFS (`Tags.json` và `tags.json` trong cùng gói);
//! - sau khi ghi, đọc lại và so SHA-256 với manifest;
//! - xong thì đặt làm thư mục project và thêm vào danh sách gần đây (như `project_pick`).

use super::manifest::{PackageFile, sha256_hex};
use super::zip::{ZipEntry, read_directory, read_entry};
use super::{PackageStore, check_package};
use crate::{PickResult, project_fs};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// Lỗi của `package_extract` (tauri-commands §8): chuỗi kebab-case, hoặc đối tượng một khóa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtractError {
    /// Gói tạm không còn (đã bị đẩy ra hoặc đã xóa).
    NoPackage,
    /// Thư mục đích không rỗng.
    NotEmpty,
    Package(String),
    Io(String),
}

fn io(e: impl std::fmt::Display) -> ExtractError {
    ExtractError::Io(e.to_string())
}

/// Giải nén `bytes` vào `dir` (phải rỗng); trả số file đã ghi. Lỗi giữa chừng thì xóa các file đã ghi
/// để thư mục lại rỗng (người dùng chọn lại thư mục đó được).
pub fn extract_package(bytes: &[u8], dir: &Path) -> Result<usize, ExtractError> {
    if fs::read_dir(dir).map_err(io)?.next().is_some() {
        return Err(ExtractError::NotEmpty);
    }
    let checked =
        check_package(bytes, None).map_err(|e| ExtractError::Package(e.code.to_string()))?;
    let entries = read_directory(bytes).map_err(|e| ExtractError::Package(e.code.to_string()))?;
    let mut written: Vec<PathBuf> = Vec::new();
    let result = write_all(bytes, dir, &entries, &checked.manifest.files, &mut written);
    if result.is_err() {
        cleanup(dir, &written);
    }
    result
}

fn write_all(
    bytes: &[u8],
    dir: &Path,
    entries: &[ZipEntry],
    files: &[PackageFile],
    written: &mut Vec<PathBuf>,
) -> Result<usize, ExtractError> {
    // Entry đầu là manifest: không phải file của project.
    for entry in entries.iter().skip(1) {
        project_fs::check_rel(&entry.name)
            .map_err(|_| ExtractError::Package("E_PKG_PATH".into()))?;
        let data =
            read_entry(bytes, entry).map_err(|e| ExtractError::Package(e.code.to_string()))?;
        let expected = files
            .iter()
            .find(|f| f.path == entry.name)
            .map(|f| f.sha256.as_str())
            .ok_or_else(|| ExtractError::Package("E_PKG_MANIFEST".into()))?;
        let target = dir.join(&entry.name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(io)?;
        written.push(target.clone());
        file.write_all(&data).map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        if sha256_hex(&fs::read(&target).map_err(io)?) != expected {
            return Err(ExtractError::Io(format!(
                "{}: đọc lại không khớp SHA-256",
                entry.name
            )));
        }
    }
    Ok(written.len())
}

/// Xóa file đã ghi và thư mục con đã tạo (chỉ khi rỗng).
fn cleanup(dir: &Path, written: &[PathBuf]) {
    for f in written {
        let _ = fs::remove_file(f);
    }
    for f in written {
        let mut p = f.parent();
        while let Some(d) = p {
            if d == dir {
                break;
            }
            let _ = fs::remove_dir(d);
            p = d.parent();
        }
    }
}

/// `package_extract({ packageId }) → PickResult | null`: hộp thoại chọn thư mục rỗng, giải nén, rồi đặt
/// làm project đang mở. Hủy hộp thoại thì `null` (gói tạm vẫn còn).
#[tauri::command]
pub async fn package_extract(
    package_id: String,
    app: AppHandle,
    store: State<'_, PackageStore>,
) -> Result<Option<PickResult>, ExtractError> {
    if store.bytes(&package_id).is_none() {
        return Err(ExtractError::NoPackage);
    }
    let picked = app
        .dialog()
        .file()
        .set_title("Chọn thư mục rỗng cho project đọc lên từ thiết bị")
        .blocking_pick_folder();
    let Some(path) = picked else { return Ok(None) };
    let dir = path.into_path().map_err(io)?;
    let bytes = store.bytes(&package_id).ok_or(ExtractError::NoPackage)?;
    let target = dir.clone();
    tauri::async_runtime::spawn_blocking(move || extract_package(&bytes, &target))
        .await
        .map_err(io)??;
    Ok(Some(crate::open_folder(&app, dir)))
}

/// Lấy gói tạm trong kho rồi giải nén (phần của lệnh không cần cửa sổ, để test được).
#[cfg(test)]
pub fn extract_from_store(
    store: &PackageStore,
    package_id: &str,
    dir: &Path,
) -> Result<usize, ExtractError> {
    let bytes = store.bytes(package_id).ok_or(ExtractError::NoPackage)?;
    extract_package(&bytes, dir)
}

#[cfg(test)]
mod tests {
    use super::super::{BuildMeta, Origin, build_package};
    use super::*;
    use std::fs::{self, OpenOptions};
    use std::path::PathBuf;

    const META: BuildMeta<'static> = BuildMeta {
        created_at: "2026-10-12T00:00:00Z",
        generator_version: "0.2.0",
    };

    fn repo() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    struct Dir(PathBuf);
    impl Dir {
        fn new(name: &str) -> Dir {
            let p = std::env::temp_dir().join(format!("mat-extract-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn tank_demo() -> Vec<(String, Vec<u8>)> {
        let root = repo().join("projects/tank-demo");
        let mut out = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(d) = stack.pop() {
            for e in fs::read_dir(d).unwrap().flatten() {
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

    fn package() -> Vec<u8> {
        build_package(&tank_demo(), &META).unwrap().bytes
    }

    #[test]
    fn extracts_every_file_byte_for_byte_into_an_empty_folder() {
        let dir = Dir::new("ok");
        let files = tank_demo();
        let n = extract_package(&package(), &dir.0).unwrap();
        assert_eq!(n, files.len());
        for (rel, data) in files {
            assert_eq!(fs::read(dir.0.join(&rel)).unwrap(), data, "{rel}");
        }
        assert!(
            !dir.0.join("matscada.json").exists(),
            "manifest không phải file của project"
        );
    }

    #[test]
    fn refuses_a_folder_that_is_not_empty_and_leaves_it_alone() {
        let dir = Dir::new("not-empty");
        fs::write(dir.0.join("note.txt"), b"x").unwrap();
        assert_eq!(
            extract_package(&package(), &dir.0).unwrap_err(),
            ExtractError::NotEmpty
        );
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn a_bad_package_gives_its_code_and_writes_nothing() {
        let dir = Dir::new("bad");
        let mut bytes = package();
        let at = bytes.len() / 2;
        bytes[at] ^= 0xFF;
        let err = extract_package(&bytes, &dir.0).unwrap_err();
        assert!(
            matches!(&err, ExtractError::Package(c) if c.starts_with("E_PKG_")),
            "{err:?}"
        );
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn serialises_like_the_contract() {
        assert_eq!(
            serde_json::to_string(&ExtractError::NotEmpty).unwrap(),
            "\"not-empty\""
        );
        assert_eq!(
            serde_json::to_string(&ExtractError::Package("E_PKG_FORMAT".into())).unwrap(),
            "{\"package\":\"E_PKG_FORMAT\"}"
        );
        assert_eq!(
            serde_json::to_string(&ExtractError::Io("x".into())).unwrap(),
            "{\"io\":\"x\"}"
        );
    }

    /// File đã có thì `create_new` báo lỗi: cách bắt trùng tên hoa/thường của NTFS.
    #[test]
    fn create_new_refuses_to_overwrite_an_existing_file() {
        let dir = Dir::new("exists");
        let target = dir.0.join("tags.json");
        fs::write(&target, b"old").unwrap();
        let r = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target);
        assert!(r.is_err());
        assert_eq!(
            extract_package(&package(), &dir.0).unwrap_err(),
            ExtractError::NotEmpty
        );
    }

    #[test]
    fn extracts_from_the_store_and_a_missing_package_is_reported() {
        let store_dir = Dir::new("store");
        let store = PackageStore::new(store_dir.0.clone());
        let built = build_package(&tank_demo(), &META).unwrap();
        let info = store
            .put(
                &built.bytes,
                built.manifest,
                Origin::Fetched,
                Some("dev".into()),
                Some(1),
            )
            .unwrap();
        let dest = Dir::new("from-store");
        assert!(extract_from_store(&store, &info.package_id, &dest.0).unwrap() > 0);
        let dest2 = Dir::new("from-store2");
        assert_eq!(
            extract_from_store(&store, "khong-co", &dest2.0).unwrap_err(),
            ExtractError::NoPackage
        );
    }
}
