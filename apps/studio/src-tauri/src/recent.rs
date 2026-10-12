//! Danh sách project gần đây (data-model §2, research R7). Rust giữ đường dẫn trong `recent.json` ở
//! thư mục cấu hình của ứng dụng; giao diện chỉ thấy chỉ số, tên, đường dẫn hiển thị và chỉ yêu cầu
//! "mở mục thứ N", nên không tự đưa được đường dẫn nào để đọc/ghi (FR-016). Đường dẫn trong danh
//! sách đều do người dùng chọn qua hộp thoại.

use crate::project_fs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

/// Số mục tối đa, mới nhất trước.
pub const MAX_ENTRIES: usize = 10;
/// Trần `recent.json`: 10 mục chỉ vài KB, file lớn hơn coi như hỏng.
const MAX_FILE_BYTES: u64 = 256 * 1024;
/// Tên dài nhất giữ lại, bằng `maxLength` của `projectName` trong schema project.
const MAX_NAME_CHARS: usize = 80;

/// Một mục của `recent.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    /// Thư mục người dùng đã chọn qua hộp thoại (tuyệt đối).
    pub path: PathBuf,
    /// `projectName` đọc được lúc mở, hoặc tên thư mục.
    pub name: String,
    /// Lần mở gần nhất, ISO 8601 UTC (`2026-10-11T08:30:00Z`).
    pub opened_at: String,
}

/// Mục gửi giao diện (`project_recent`): đường dẫn chỉ để hiển thị.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub index: usize,
    pub display: String,
    pub name: String,
    pub opened_at: String,
    /// Thư mục còn tồn tại; `false` thì giao diện cho bỏ mục khỏi danh sách.
    pub exists: bool,
}

/// Lỗi gửi giao diện: `"no-such-entry"`, `"missing"`, hoặc `{ "io": "chi tiết" }` như lệnh ghi file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecentError {
    /// `index` ngoài danh sách.
    NoSuchEntry,
    /// Thư mục của mục không còn tồn tại.
    Missing,
    /// Không ghi được `recent.json`.
    Io(String),
}

/// Danh sách gần đây lưu trong một file JSON. Đường dẫn file truyền vào, nên test không cần Tauri.
pub struct RecentStore {
    file: PathBuf,
    /// Giữ trọn một lượt đọc-sửa-ghi: lệnh async và lệnh trên luồng chính có thể chạy cùng lúc.
    lock: Mutex<()>,
}

impl RecentStore {
    pub fn new(file: PathBuf) -> Self {
        RecentStore {
            file,
            lock: Mutex::new(()),
        }
    }

    /// Danh sách cho giao diện, mới nhất trước. Kiểm thư mục ngoài khóa (ổ mạng đã mất có thể chậm).
    pub fn list(&self) -> Vec<RecentEntry> {
        let entries = {
            let _guard = self.guard();
            self.load()
        };
        entries
            .into_iter()
            .enumerate()
            .map(|(index, p)| RecentEntry {
                index,
                display: p.path.display().to_string(),
                exists: p.path.is_dir(),
                name: p.name,
                opened_at: p.opened_at,
            })
            .collect()
    }

    /// Ghi nhận thư mục vừa mở: thêm lên đầu, đã có thì chuyển lên đầu với tên và thời điểm mới;
    /// giữ tối đa 10 mục.
    pub fn record(&self, path: &Path, name: &str, opened_at: &str) -> Result<(), RecentError> {
        let _guard = self.guard();
        let mut list = self.load();
        list.retain(|p| p.path != path);
        list.insert(
            0,
            RecentProject {
                path: path.to_path_buf(),
                name: name.to_string(),
                opened_at: opened_at.to_string(),
            },
        );
        list.truncate(MAX_ENTRIES);
        self.save(&list)
    }

    /// Thư mục của mục `index` để mở lại; chỉ trả khi thư mục còn tồn tại.
    pub fn path_of(&self, index: usize) -> Result<PathBuf, RecentError> {
        let entry = {
            let _guard = self.guard();
            self.load().into_iter().nth(index)
        };
        let path = entry.ok_or(RecentError::NoSuchEntry)?.path;
        if path.is_dir() {
            Ok(path)
        } else {
            Err(RecentError::Missing)
        }
    }

    /// Bỏ mục `index` khỏi danh sách.
    pub fn forget(&self, index: usize) -> Result<(), RecentError> {
        let _guard = self.guard();
        let mut list = self.load();
        if index >= list.len() {
            return Err(RecentError::NoSuchEntry);
        }
        list.remove(index);
        self.save(&list)
    }

    /// Khóa chỉ bảo vệ thứ tự đọc-sửa-ghi, không có dữ liệu: bỏ qua trạng thái "poisoned".
    fn guard(&self) -> MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Các mục trong file. Chưa có file, file hỏng hoặc quá lớn: danh sách rỗng, lần ghi sau đè lên.
    /// Mục có đường dẫn tương đối (file bị sửa tay) bị bỏ.
    fn load(&self) -> Vec<RecentProject> {
        let Ok(meta) = fs::metadata(&self.file) else {
            return Vec::new();
        };
        if meta.len() > MAX_FILE_BYTES {
            return Vec::new();
        }
        let mut list: Vec<RecentProject> = fs::read(&self.file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        list.retain(|p| p.path.is_absolute());
        list.truncate(MAX_ENTRIES);
        list
    }

    /// Ghi atomic, tạo thư mục cấu hình nếu chưa có (lần chạy đầu).
    fn save(&self, list: &[RecentProject]) -> Result<(), RecentError> {
        let io = |e: std::io::Error| RecentError::Io(format!("{}: {e}", self.file.display()));
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }
        let json = serde_json::to_vec_pretty(list).map_err(|e| RecentError::Io(e.to_string()))?;
        project_fs::write_atomic(&self.file, &json).map_err(io)
    }
}

/// Tên hiện trong danh sách: `projectName` của `project.json` nếu đọc được, không thì tên thư mục.
pub fn project_name(dir: &Path) -> String {
    let from_project = project_fs::read_text(dir, "project.json")
        .ok()
        .and_then(|f| {
            // Một BOM đầu file hợp lệ như ở bộ kiểm tra (contracts/project-format.md).
            let text = f.text.strip_prefix('\u{feff}').unwrap_or(&f.text);
            let project: serde_json::Value = serde_json::from_str(text).ok()?;
            let name = project.get("projectName")?.as_str()?.trim();
            (!name.is_empty()).then(|| name.chars().take(MAX_NAME_CHARS).collect())
        });
    from_project.unwrap_or_else(|| {
        dir.file_name().map_or_else(
            || dir.display().to_string(),
            |n| n.to_string_lossy().into_owned(),
        )
    })
}

/// Thời điểm hiện tại, ISO 8601 UTC đến giây.
pub fn now_utc() -> String {
    iso_utc(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs()),
    )
}

/// Số giây từ 1970-01-01 UTC → `YYYY-MM-DDTHH:MM:SSZ`. Đổi số ngày ra ngày tháng theo thuật toán
/// `civil_from_days` của Howard Hinnant (lịch Gregory, chu kỳ 400 năm = 146 097 ngày, năm tính từ
/// tháng 3); không thêm crate thời gian chỉ để định dạng.
fn iso_utc(secs: u64) -> String {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days + 719_468; // số ngày tính từ 0000-03-01
    let era = z / 146_097;
    let doe = z - era * 146_097; // ngày trong chu kỳ 400 năm
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // ngày trong năm (từ tháng 3)
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = era * 400 + yoe + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Thư mục tạm riêng cho từng test (các test chạy song song).
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("mat-recent-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        /// Thư mục project `name`, có sẵn trên đĩa.
        fn project(&self, name: &str) -> PathBuf {
            let p = self.0.join(name);
            fs::create_dir_all(&p).unwrap();
            p
        }
        /// Kho trên file `config/recent.json` (thư mục cấu hình chưa có cho tới lần ghi đầu).
        fn store(&self) -> RecentStore {
            RecentStore::new(self.file())
        }
        fn file(&self) -> PathBuf {
            self.0.join("config/recent.json")
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const T1: &str = "2026-10-11T01:00:00Z";
    const T2: &str = "2026-10-11T02:00:00Z";

    fn names(store: &RecentStore) -> Vec<String> {
        store.list().into_iter().map(|e| e.name).collect()
    }

    /// T019: thêm mới lên đầu; mở lại đưa lên đầu (không trùng, tên và thời điểm mới); tối đa 10.
    #[test]
    fn newest_first_reopen_moves_to_top_max_10() {
        let t = Tmp::new("order");
        let s = t.store();
        assert!(s.list().is_empty());
        for i in 0..12 {
            s.record(&t.project(&format!("p{i}")), &format!("P{i}"), T1)
                .unwrap();
        }
        assert_eq!(
            names(&s),
            ["P11", "P10", "P9", "P8", "P7", "P6", "P5", "P4", "P3", "P2"]
        );
        let list = s.list();
        assert!(
            list.iter()
                .enumerate()
                .all(|(i, e)| e.index == i && e.exists)
        );
        s.record(&t.project("p5"), "Trạm 5", T2).unwrap();
        assert_eq!(
            names(&s),
            [
                "Trạm 5", "P11", "P10", "P9", "P8", "P7", "P6", "P4", "P3", "P2"
            ]
        );
        let top = &s.list()[0];
        assert_eq!(top.display, t.0.join("p5").display().to_string());
        assert_eq!(top.opened_at, T2);
    }

    /// T019: lần chạy sau đọc lại đúng danh sách; file là mảng `{path, name, openedAt}`.
    #[test]
    fn saves_and_reloads_json() {
        let t = Tmp::new("reload");
        let (a, b) = (t.project("a"), t.project("b"));
        let s = t.store();
        s.record(&a, "A", T1).unwrap();
        s.record(&b, "B", T2).unwrap();
        let again = t.store();
        assert_eq!(again.list(), s.list());
        assert_eq!(names(&again), ["B", "A"]);
        let json: serde_json::Value = serde_json::from_slice(&fs::read(t.file()).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!([
                { "path": b, "name": "B", "openedAt": T2 },
                { "path": a, "name": "A", "openedAt": T1 },
            ])
        );
    }

    /// T019: file hỏng (hoặc quá lớn, hoặc có đường dẫn tương đối) → danh sách rỗng; lần mở sau ghi
    /// đè.
    #[test]
    fn corrupt_file_reads_as_empty_and_is_overwritten() {
        let t = Tmp::new("corrupt");
        let s = t.store();
        fs::create_dir_all(t.file().parent().unwrap()).unwrap();
        for bad in [
            "",
            "không phải JSON",
            "{\"path\":1}",
            "[{\"path\":\"D:/x\"}]",
            "[{\"path\":\"rel/dir\",\"name\":\"R\",\"openedAt\":\"2026-10-11T01:00:00Z\"}]",
        ] {
            fs::write(t.file(), bad).unwrap();
            assert!(s.list().is_empty(), "{bad:?}");
        }
        let entry = serde_json::to_string(&RecentProject {
            path: t.project("big"),
            name: "Big".into(),
            opened_at: T1.into(),
        })
        .unwrap();
        fs::write(t.file(), format!("[{entry}{}]", " ".repeat(300 * 1024))).unwrap();
        assert!(s.list().is_empty(), "file > 256 KB");
        s.record(&t.project("a"), "A", T1).unwrap();
        assert_eq!(names(&t.store()), ["A"]);
    }

    /// T019: `index` ngoài danh sách → `NoSuchEntry`; thư mục mất → `Missing`, vẫn liệt kê với
    /// `exists: false` cho tới khi người dùng bỏ.
    #[test]
    fn bad_index_and_missing_folder() {
        let t = Tmp::new("missing");
        let (a, b) = (t.project("a"), t.project("b"));
        let s = t.store();
        s.record(&a, "A", T1).unwrap();
        s.record(&b, "B", T2).unwrap();
        assert_eq!(s.path_of(2), Err(RecentError::NoSuchEntry));
        assert_eq!(s.forget(2), Err(RecentError::NoSuchEntry));
        assert_eq!(s.path_of(1), Ok(a));
        fs::remove_dir_all(&b).unwrap();
        assert_eq!(s.path_of(0), Err(RecentError::Missing));
        let exists: Vec<bool> = s.list().iter().map(|e| e.exists).collect();
        assert_eq!(exists, [false, true]);
    }

    /// T019: `forget` bỏ đúng mục và lưu lại.
    #[test]
    fn forget_removes_the_right_entry() {
        let t = Tmp::new("forget");
        let s = t.store();
        for n in ["a", "b", "c"] {
            s.record(&t.project(n), &n.to_uppercase(), T1).unwrap();
        }
        assert_eq!(names(&s), ["C", "B", "A"]);
        s.forget(1).unwrap();
        assert_eq!(names(&s), ["C", "A"]);
        assert_eq!(names(&t.store()), ["C", "A"]);
        assert_eq!(s.path_of(1), Ok(t.0.join("a")));
    }

    /// T035: tên là `projectName` (bỏ khoảng trắng hai đầu, tối đa 80 ký tự như schema), không đọc
    /// được thì tên thư mục.
    #[test]
    fn name_comes_from_project_json_or_folder() {
        let t = Tmp::new("name");
        let p = t.project("tram-bom");
        assert_eq!(project_name(&p), "tram-bom");
        fs::write(
            p.join("project.json"),
            "{\"projectName\": \"  Trạm bơm  \"}",
        )
        .unwrap();
        assert_eq!(project_name(&p), "Trạm bơm");
        fs::write(
            p.join("project.json"),
            "\u{feff}{\"projectName\": \"Trạm bơm\"}",
        )
        .unwrap();
        assert_eq!(project_name(&p), "Trạm bơm");
        for bad in [
            "{",
            "[]",
            "{\"projectName\": \" \"}",
            "{\"projectName\": 5}",
        ] {
            fs::write(p.join("project.json"), bad).unwrap();
            assert_eq!(project_name(&p), "tram-bom", "{bad:?}");
        }
        fs::write(
            p.join("project.json"),
            format!("{{\"projectName\": \"{}\"}}", "ạ".repeat(200)),
        )
        .unwrap();
        assert_eq!(project_name(&p), "ạ".repeat(80));
    }

    /// T035: `openedAt` là ISO 8601 UTC đến giây.
    #[test]
    fn utc_time_is_iso_8601() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso_utc(1_791_763_199), "2026-10-11T23:59:59Z");
        assert_eq!(iso_utc(4_102_444_799), "2099-12-31T23:59:59Z");
        let now = now_utc();
        assert!(
            now.len() == 20 && now.ends_with('Z') && now.as_str() > "2026",
            "{now}"
        );
    }

    /// T035: hình dạng gửi qua IPC theo contracts/tauri-commands.md; lỗi `io` kèm chi tiết như lệnh
    /// ghi.
    #[test]
    fn ipc_shapes_follow_the_contract() {
        let e = RecentEntry {
            index: 0,
            display: "D:\\p".into(),
            name: "P".into(),
            opened_at: T1.into(),
            exists: false,
        };
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({
                "index": 0, "display": "D:\\p", "name": "P", "openedAt": T1, "exists": false
            })
        );
        let names: Vec<String> = [
            RecentError::NoSuchEntry,
            RecentError::Missing,
            RecentError::Io("Access is denied. (os error 5)".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"no-such-entry\"",
                "\"missing\"",
                "{\"io\":\"Access is denied. (os error 5)\"}"
            ]
        );
    }
}
