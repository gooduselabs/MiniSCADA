//! Project mới (lệnh Project → Project mới…, 2026-10-20). Giao diện dựng nội dung các file (hàm thuần
//! `buildNewProject` của Studio) rồi gửi kèm mã project; Rust tạo thư mục con `<mã>` trong thư mục cha người dùng
//! đã chọn qua hộp thoại (hoặc thư mục mặc định Documents\mAT SCADA) và ghi các file vào đó.
//!
//! Như `project_read`/`project_write` (research R7): giao diện không gửi đường dẫn tuyệt đối nào. Thư mục cha do Rust
//! giữ; mã project phải khớp `projectId` của schema (`^[a-z0-9][a-z0-9-]{1,47}$`, không phải tên thiết bị của
//! Windows) nên chỉ là một đoạn đường dẫn; mỗi file qua `check_rel` và ghi bằng `write_text_if_unchanged` (không ra
//! ngoài thư mục project kể cả qua symlink/junction). Thư mục đích phải chưa có hoặc trống; đã có project hay có file
//! khác thì từ chối, không ghi gì. Lỗi giữa chừng thì xóa thư mục vừa tạo.

use crate::project_fs::{self, WriteError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Số file tối đa của một project mới (mẫu lớn nhất có khoảng 20 file).
pub const MAX_FILES: usize = 256;
/// Tổng cỡ tối đa các file của project mới.
pub const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

/// Một file của project mới: đường dẫn tương đối (`/`) và nội dung UTF-8.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct NewFile {
    pub rel: String,
    pub content: String,
}

/// Thư mục đích `<cha>/<mã>` hiện thế nào. Giao diện nhận `"free"`, `"empty"`, `"exists-project"`,
/// `"not-empty"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetState {
    /// Chưa có: sẽ được tạo.
    Free,
    /// Thư mục trống: dùng được.
    Empty,
    /// Đã có `project.json`.
    ExistsProject,
    /// Có file khác, hoặc là một file chứ không phải thư mục.
    NotEmpty,
}

/// Lỗi gửi giao diện: chuỗi kebab-case, hoặc `{ "io": "chi tiết" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CreateError {
    /// Chưa chọn thư mục cha.
    NoParent,
    /// Mã project không hợp lệ.
    BadId,
    /// Thư mục đích đã có project.
    ExistsProject,
    /// Thư mục đích có file khác.
    NotEmpty,
    /// Đường dẫn file không an toàn, thiếu `project.json`, quá nhiều file hay quá lớn.
    BadPath,
    /// Lỗi hệ điều hành.
    Io(String),
}

fn io_err(e: io::Error) -> CreateError {
    CreateError::Io(e.to_string())
}

/// Mã project hợp lệ: `^[a-z0-9][a-z0-9-]{1,47}$` như `projectId` của schema, và không phải tên thiết bị của
/// Windows (`con`, `nul`, `com1`…), vì mã là tên thư mục.
pub fn valid_project_id(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=48).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && !project_fs::is_windows_device_name(id)
}

/// Trạng thái của thư mục đích `<parent>/<id>`.
pub fn target_state(parent: &Path, id: &str) -> Result<TargetState, CreateError> {
    if !valid_project_id(id) {
        return Err(CreateError::BadId);
    }
    state_of(&parent.join(id))
}

fn state_of(dir: &Path) -> Result<TargetState, CreateError> {
    let meta = match fs::symlink_metadata(dir) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(TargetState::Free),
        Err(e) => return Err(io_err(e)),
    };
    // Symlink/junction hay file: không dùng làm thư mục project mới.
    if !meta.is_dir() {
        return Ok(TargetState::NotEmpty);
    }
    let mut entries = fs::read_dir(dir).map_err(io_err)?;
    if entries.next().is_none() {
        return Ok(TargetState::Empty);
    }
    if dir.join("project.json").exists() {
        Ok(TargetState::ExistsProject)
    } else {
        Ok(TargetState::NotEmpty)
    }
}

/// Kiểm danh sách file trước khi ghi bất cứ gì: có `project.json`, không trùng, mọi đường dẫn an toàn, không
/// quá nhiều hay quá lớn.
fn check_files(files: &[NewFile]) -> Result<(), CreateError> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err(CreateError::BadPath);
    }
    if !files.iter().any(|f| f.rel == "project.json") {
        return Err(CreateError::BadPath);
    }
    let total: usize = files.iter().map(|f| f.content.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err(CreateError::BadPath);
    }
    let mut seen = std::collections::HashSet::new();
    for f in files {
        project_fs::check_rel(&f.rel).map_err(|_| CreateError::BadPath)?;
        // Thư mục bắt đầu bằng dấu chấm (`.mat-backup`, `.mat-editor`) không phải nội dung project.
        if f.rel.starts_with('.') || f.rel.contains("/.") {
            return Err(CreateError::BadPath);
        }
        if !seen.insert(f.rel.to_ascii_lowercase()) {
            return Err(CreateError::BadPath);
        }
    }
    Ok(())
}

/// Tạo `<parent>/<id>` (tạo cả `parent` nếu chưa có) và ghi `files` vào đó. Trả thư mục project.
pub fn create_project(parent: &Path, id: &str, files: &[NewFile]) -> Result<PathBuf, CreateError> {
    if !valid_project_id(id) {
        return Err(CreateError::BadId);
    }
    check_files(files)?;
    let target = parent.join(id);
    match state_of(&target)? {
        TargetState::ExistsProject => return Err(CreateError::ExistsProject),
        TargetState::NotEmpty => return Err(CreateError::NotEmpty),
        TargetState::Free | TargetState::Empty => {}
    }
    fs::create_dir_all(parent).map_err(io_err)?;
    let created = match fs::create_dir(&target) {
        Ok(()) => true,
        // Thư mục trống có sẵn (đã kiểm ở trên), hoặc vừa được tạo giữa chừng: kiểm lại.
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            if state_of(&target)? != TargetState::Empty {
                return Err(CreateError::NotEmpty);
            }
            false
        }
        Err(e) => return Err(io_err(e)),
    };
    let result = write_all(parent, &target, files);
    if result.is_err() {
        // Không để lại project dở dang: xóa thư mục vừa tạo, hoặc các file đã ghi vào thư mục trống có sẵn.
        if created {
            let _ = fs::remove_dir_all(&target);
        } else if let Ok(entries) = fs::read_dir(&target) {
            for e in entries.flatten() {
                let p = e.path();
                let _ = if p.is_dir() {
                    fs::remove_dir_all(&p)
                } else {
                    fs::remove_file(&p)
                };
            }
        }
    }
    result.map(|()| target)
}

fn write_all(parent: &Path, target: &Path, files: &[NewFile]) -> Result<(), CreateError> {
    // Thư mục đích phải nằm ngay trong thư mục cha thật (không phải junction trỏ đi nơi khác).
    let real_parent = fs::canonicalize(parent).map_err(io_err)?;
    let real_target = fs::canonicalize(target).map_err(io_err)?;
    if real_target.parent() != Some(real_parent.as_path()) {
        return Err(CreateError::BadPath);
    }
    for f in files {
        project_fs::write_text_if_unchanged(target, &f.rel, &f.content, None, false).map_err(
            |e| match e {
                WriteError::BadPath | WriteError::NoProject => CreateError::BadPath,
                WriteError::Changed => CreateError::NotEmpty,
                WriteError::Io(d) => CreateError::Io(d),
            },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Thư mục tạm riêng cho từng test (các test chạy song song).
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("mat-newproj-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn file(rel: &str, content: &str) -> NewFile {
        NewFile {
            rel: rel.into(),
            content: content.into(),
        }
    }

    fn sample() -> Vec<NewFile> {
        vec![
            file("project.json", "{\"projectId\":\"tram-bom\"}"),
            file("tags.json", "{\"tags\":[]}"),
            file("screens/tong-quan.screen.json", "{}"),
            file("screens/tong-quan.svg", "<svg/>"),
        ]
    }

    #[test]
    fn project_id_follows_the_schema_and_windows_names() {
        for ok in ["tram-bom", "ab", "a1", "1-tram", &"a".repeat(48)] {
            assert!(valid_project_id(ok), "{ok}");
        }
        for bad in [
            "",
            "a",
            "-ab",
            "Tram",
            "tram bom",
            "tram_bom",
            "trạm",
            "../x",
            "a/b",
            "a\\b",
            "con",
            "nul",
            "com1",
            "lpt9",
            &"a".repeat(49),
        ] {
            assert!(!valid_project_id(bad), "{bad}");
        }
    }

    #[test]
    fn creates_subfolder_with_all_files_and_parents() {
        let t = Tmp::new("ok");
        // Thư mục cha mặc định (Documents\mAT SCADA) có thể chưa có.
        let parent = t.0.join("mAT SCADA");
        assert_eq!(target_state(&parent, "tram-bom"), Ok(TargetState::Free));
        let dir = create_project(&parent, "tram-bom", &sample()).unwrap();
        assert_eq!(dir, parent.join("tram-bom"));
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"projectId\":\"tram-bom\"}"
        );
        assert_eq!(
            fs::read_to_string(dir.join("screens/tong-quan.svg")).unwrap(),
            "<svg/>"
        );
        assert_eq!(
            target_state(&parent, "tram-bom"),
            Ok(TargetState::ExistsProject)
        );
    }

    #[test]
    fn empty_existing_folder_is_used() {
        let t = Tmp::new("empty");
        fs::create_dir_all(t.0.join("tram-bom")).unwrap();
        assert_eq!(target_state(&t.0, "tram-bom"), Ok(TargetState::Empty));
        create_project(&t.0, "tram-bom", &sample()).unwrap();
        assert!(t.0.join("tram-bom/tags.json").is_file());
    }

    #[test]
    fn refuses_existing_project_or_non_empty_folder_without_writing() {
        let t = Tmp::new("refuse");
        let p = t.0.join("cu");
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("project.json"), "giữ nguyên").unwrap();
        assert_eq!(
            create_project(&t.0, "cu", &sample()),
            Err(CreateError::ExistsProject)
        );
        assert_eq!(
            fs::read_to_string(p.join("project.json")).unwrap(),
            "giữ nguyên"
        );
        assert!(!p.join("tags.json").exists());

        let q = t.0.join("khac");
        fs::create_dir_all(&q).unwrap();
        fs::write(q.join("ghi-chu.txt"), "x").unwrap();
        assert_eq!(target_state(&t.0, "khac"), Ok(TargetState::NotEmpty));
        assert_eq!(
            create_project(&t.0, "khac", &sample()),
            Err(CreateError::NotEmpty)
        );
        assert!(!q.join("project.json").exists());

        // Một file (không phải thư mục) trùng tên.
        fs::write(t.0.join("tep"), "x").unwrap();
        assert_eq!(
            create_project(&t.0, "tep", &sample()),
            Err(CreateError::NotEmpty)
        );
    }

    #[test]
    fn refuses_bad_id_and_unsafe_paths_before_creating_anything() {
        let t = Tmp::new("unsafe");
        assert_eq!(
            create_project(&t.0, "..", &sample()),
            Err(CreateError::BadId)
        );
        assert_eq!(target_state(&t.0, "con"), Err(CreateError::BadId));
        for bad in [
            "../ngoai.json",
            "/tuyet-doi.json",
            "C:/x.json",
            "a\\b.json",
            "screens/../../x.json",
            "chay.exe",
            ".mat-backup/x.json",
            "screens/.an/x.json",
            "nul.json",
        ] {
            let mut files = sample();
            files.push(file(bad, "{}"));
            assert_eq!(
                create_project(&t.0, "p1", &files),
                Err(CreateError::BadPath),
                "{bad}"
            );
            assert!(!t.0.join("p1").exists(), "{bad}");
        }
        // Thiếu project.json, rỗng, trùng tên (khác hoa thường).
        assert_eq!(
            create_project(&t.0, "p1", &[file("tags.json", "{}")]),
            Err(CreateError::BadPath)
        );
        assert_eq!(create_project(&t.0, "p1", &[]), Err(CreateError::BadPath));
        let mut dup = sample();
        dup.push(file("Tags.json", "{}"));
        assert_eq!(create_project(&t.0, "p1", &dup), Err(CreateError::BadPath));
        assert!(fs::read_dir(&t.0).unwrap().next().is_none());
    }

    #[test]
    fn too_many_or_too_large_files_are_refused() {
        let t = Tmp::new("big");
        let mut many = sample();
        for i in 0..MAX_FILES {
            many.push(file(&format!("screens/s{i}.screen.json"), "{}"));
        }
        assert_eq!(create_project(&t.0, "p2", &many), Err(CreateError::BadPath));
        let mut big = sample();
        big.push(file("big.json", &" ".repeat(MAX_TOTAL_BYTES)));
        assert_eq!(create_project(&t.0, "p2", &big), Err(CreateError::BadPath));
        assert!(!t.0.join("p2").exists());
    }

    #[test]
    fn failure_midway_removes_the_new_folder() {
        let t = Tmp::new("rollback");
        let mut files = sample();
        // project_write từ chối file JSON > 1 MB: lỗi sau khi đã ghi vài file.
        files.push(file(
            "zz.json",
            &" ".repeat(project_fs::MAX_FILE_BYTES as usize + 1),
        ));
        assert!(matches!(
            create_project(&t.0, "p3", &files),
            Err(CreateError::Io(_))
        ));
        assert!(!t.0.join("p3").exists());
    }

    #[test]
    fn ipc_shapes() {
        let s: Vec<String> = [
            TargetState::Free,
            TargetState::Empty,
            TargetState::ExistsProject,
            TargetState::NotEmpty,
        ]
        .iter()
        .map(|v| serde_json::to_string(v).unwrap())
        .collect();
        assert_eq!(
            s,
            [
                "\"free\"",
                "\"empty\"",
                "\"exists-project\"",
                "\"not-empty\""
            ]
        );
        let e: Vec<String> = [
            CreateError::NoParent,
            CreateError::BadId,
            CreateError::ExistsProject,
            CreateError::NotEmpty,
            CreateError::BadPath,
            CreateError::Io("x".into()),
        ]
        .iter()
        .map(|v| serde_json::to_string(v).unwrap())
        .collect();
        assert_eq!(
            e,
            [
                "\"no-parent\"",
                "\"bad-id\"",
                "\"exists-project\"",
                "\"not-empty\"",
                "\"bad-path\"",
                "{\"io\":\"x\"}"
            ]
        );
        let f: NewFile =
            serde_json::from_str("{\"rel\":\"project.json\",\"content\":\"{}\"}").unwrap();
        assert_eq!(f, file("project.json", "{}"));
    }
}
