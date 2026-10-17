mod csv;
mod device;
mod discovery;
mod editor_fs;
mod package;
mod project_fs;
mod recent;
mod svg;

use device::DeviceManager;
use device::live::LiveHub;
use discovery::Discovery;
use editor_fs::{EditorError, EditorFile};
use package::PackageStore;
use project_fs::{
    BackupDone, BackupError, BackupFile, FileText, Fingerprint, ReadError, RemoveError, WriteError,
};
use recent::{RecentEntry, RecentError, RecentStore};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    tauri: &'static str,
}

/// Kết quả mở project (hộp thoại hoặc danh sách gần đây): đường dẫn để hiển thị.
#[derive(Serialize)]
struct PickResult {
    display: String,
}

/// Kết quả ghi: hash của nội dung mới, giao diện giữ để lần ghi sau so lại.
#[derive(Serialize)]
struct WriteResult {
    hash: String,
}

/// Thư mục project do người dùng chọn bằng hộp thoại phía Rust, hoặc mục trong danh sách gần đây
/// (cũng do hộp thoại mà có). Giao diện không truyền được đường dẫn gốc nên không đọc/ghi được ngoài
/// thư mục này (FR-037, research R7).
#[derive(Default)]
struct ProjectRoot(Mutex<Option<PathBuf>>);

fn root_of(state: &State<'_, ProjectRoot>) -> Option<PathBuf> {
    state.0.lock().unwrap().clone()
}

/// Đặt `path` làm thư mục project của phiên và đưa lên đầu danh sách gần đây.
fn open_folder(app: &AppHandle, path: PathBuf) -> PickResult {
    let name = recent::project_name(&path);
    if let Err(e) = app
        .state::<RecentStore>()
        .record(&path, &name, &recent::now_utc())
    {
        // Danh sách gần đây chỉ là tiện ích: không ghi được thì vẫn mở project.
        eprintln!("recent.json: {e:?}");
    }
    let display = path.display().to_string();
    *app.state::<ProjectRoot>().0.lock().unwrap() = Some(path);
    PickResult { display }
}

/// IPC smoke test: lets the frontend confirm the Rust side is alive.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "mAT Studio",
        version: env!("CARGO_PKG_VERSION"),
        tauri: tauri::VERSION,
    }
}

/// Hộp thoại chọn thư mục project; trả `{ display }` (null nếu hủy) và ghi vào danh sách gần đây.
#[tauri::command]
async fn project_pick(app: AppHandle) -> Result<Option<PickResult>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Mở thư mục project mAT SCADA")
        .blocking_pick_folder();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    Ok(Some(open_folder(&app, path)))
}

/// Project gần đây, mới nhất trước. Async để việc kiểm thư mục (ổ mạng đã mất có thể chậm) không
/// chặn luồng giao diện.
#[tauri::command]
async fn project_recent(app: AppHandle) -> Vec<RecentEntry> {
    app.state::<RecentStore>().list()
}

/// Mở lại mục `index` của danh sách gần đây: lỗi `"no-such-entry"` hoặc `"missing"`.
#[tauri::command]
async fn project_open_recent(app: AppHandle, index: usize) -> Result<PickResult, RecentError> {
    let path = app.state::<RecentStore>().path_of(index)?;
    Ok(open_folder(&app, path))
}

/// Bỏ mục `index` khỏi danh sách gần đây.
#[tauri::command]
fn project_forget_recent(index: usize, recent: State<'_, RecentStore>) -> Result<(), RecentError> {
    recent.forget(index).inspect_err(|e| {
        if let RecentError::Io(detail) = e {
            eprintln!("project_forget_recent: {detail}");
        }
    })
}

/// Nội dung file kèm SHA-256 (`{ text, hash }`), hoặc lỗi đã phân loại (`"missing"`,
/// `"too-large"`…) để bộ kiểm tra TS báo cùng mã lỗi với runtime (audit FR-032). Chưa mở project
/// thì `"missing"`.
#[tauri::command]
fn project_read(rel: String, state: State<'_, ProjectRoot>) -> Result<FileText, ReadError> {
    let root = root_of(&state).ok_or(ReadError::Missing)?;
    project_fs::read_text(&root, &rel)
}

/// Ghi file nếu trên đĩa vẫn như lúc đọc (`expectedHash` của lần đọc, `null` khi tạo file mới);
/// khác thì lỗi `"changed"`, trừ khi `force` (Ghi đè). Trả `{ hash }` của nội dung mới.
#[tauri::command]
fn project_write(
    rel: String,
    content: String,
    expected_hash: Option<String>,
    force: bool,
    state: State<'_, ProjectRoot>,
) -> Result<WriteResult, WriteError> {
    let root = root_of(&state).ok_or(WriteError::NoProject)?;
    project_fs::write_text_if_unchanged(&root, &rel, &content, expected_hash.as_deref(), force)
        .map(|hash| WriteResult { hash })
        .inspect_err(|e| {
            // Chi tiết đã tới giao diện (`{ "io": … }`); in thêm ra stderr khi chạy `tauri dev`.
            if let WriteError::Io(detail) = e {
                eprintln!("project_write {rel}: {detail}");
            }
        })
}

/// Feature 006 (tauri-commands-006 §5): sao lưu tập file project 0.1 vào `.mat-backup/<label>-<UTC>/`
/// trước khi nâng cấp; trả `{ dir, abs }`.
#[tauri::command]
fn project_backup(
    files: Vec<BackupFile>,
    label: String,
    state: State<'_, ProjectRoot>,
) -> Result<BackupDone, BackupError> {
    let root = root_of(&state).ok_or(BackupError::NoProject)?;
    project_fs::backup_files(
        &root,
        &files,
        &label,
        &project_fs::stamp_now(),
        concat!("mAT Studio ", env!("CARGO_PKG_VERSION")),
    )
}

/// Feature 006 (tauri-commands-006 §5): xóa một file `.json` của project khi hash trên đĩa khớp.
#[tauri::command]
fn project_remove(
    rel: String,
    hash: String,
    state: State<'_, ProjectRoot>,
) -> Result<(), RemoveError> {
    let root = root_of(&state).ok_or(RemoveError::Missing)?;
    project_fs::remove_file(&root, &rel, &hash)
}

/// Feature 011 (contracts/svg-editor.md §6, FR-113): mtime, cỡ và SHA-256 của một file project (phát hiện
/// file SVG đổi trên đĩa khi đang sửa).
#[tauri::command]
fn project_fingerprint(
    rel: String,
    state: State<'_, ProjectRoot>,
) -> Result<Fingerprint, ReadError> {
    let root = root_of(&state).ok_or(ReadError::Missing)?;
    project_fs::file_fingerprint(&root, &rel)
}

/// Feature 011 (FR-097): mọi file `.svg` của project (cây "Đồ họa SVG"), bỏ thư mục bắt đầu bằng dấu chấm.
#[tauri::command]
fn project_list_svg(state: State<'_, ProjectRoot>) -> Vec<String> {
    root_of(&state)
        .map(|root| editor_fs::list_svg(&root))
        .unwrap_or_default()
}

/// Feature 011 (FR-112): bản tự lưu trong `.mat-editor/autosave/`.
#[tauri::command]
fn editor_list(dir: String, state: State<'_, ProjectRoot>) -> Result<Vec<EditorFile>, EditorError> {
    let root = root_of(&state).ok_or(EditorError::Missing)?;
    editor_fs::editor_list(&root, &dir)
}

/// Feature 011 (FR-112): xóa một bản tự lưu (giữ tối đa 3 bản, xóa sau khi lưu thật).
#[tauri::command]
fn editor_remove(rel: String, state: State<'_, ProjectRoot>) -> Result<(), EditorError> {
    let root = root_of(&state).ok_or(EditorError::Missing)?;
    editor_fs::editor_remove(&root, &rel)
}

/// Mở trang runtime của thiết bị trong trình duyệt mặc định. Feature 011 (L-04 của 005): chỉ
/// `https://<tên máy>:<cổng HTTPS>/` của một thiết bị đã lưu, URL dựng lại từ bản ghi.
#[tauri::command]
fn open_device_web(url: String, devices: State<'_, DeviceManager>) -> Result<(), String> {
    let url = device::device_web_url(&url, &devices.list())?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProjectRoot::default())
        // Feature 005: lượt quét tìm thiết bị và các kết nối live (chỉ trong bộ nhớ).
        .manage(Discovery::default())
        .manage(LiveHub::default())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            // %APPDATA%\vn.com.atpro.matstudio\recent.json (data-model §2)
            app.manage(RecentStore::new(config_dir.join("recent.json")));
            // %APPDATA%\vn.com.atpro.matstudio\devices.json (feature 005, data-model §2): thiết bị đã
            // dùng và ghim; token phiên chỉ nằm trong bộ nhớ của DeviceManager.
            app.manage(DeviceManager::new(config_dir.join("devices.json")));
            // Gói .matscada tạm (feature 005, data-model §8): thư mục cache của ứng dụng, tối đa 4 gói,
            // xóa khi đóng Studio (RunEvent::Exit bên dưới) và khi mở lần sau (rác của lần bị tắt đột ngột).
            app.manage(PackageStore::new(
                app.path().app_cache_dir()?.join("packages"),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            project_pick,
            project_recent,
            project_open_recent,
            project_forget_recent,
            project_read,
            project_write,
            open_device_web,
            // Feature 005, US1 (specs/005-device-online/contracts/tauri-commands.md §2–7).
            discovery::net_interfaces,
            discovery::discover_run,
            device::devices_list,
            device::device_add,
            device::device_update,
            device::device_forget,
            device::device_probe,
            device::device_pin,
            device::device_unpin,
            device::device_login,
            device::device_logout,
            device::device_session,
            device::device_get,
            device::monitor_get,
            device::live_open,
            device::live_send,
            device::live_close,
            // Feature 005, US2 (tauri-commands §8): gói, nạp xuống, khôi phục, đọc lên.
            package::package_build,
            package::package_read,
            package::package_discard,
            package::extract::package_extract,
            device::deploy::device_deploy,
            device::deploy::device_restore,
            device::deploy::device_fetch_package,
            // Feature 006 (tauri-commands-006): ghi Tag và Thử kết nối, sao lưu khi nâng cấp, CSV.
            device::device_post,
            device::logic::logic_get,
            device::logic::logic_writes_stop,
            device::logic::logic_reset,
            project_backup,
            project_remove,
            csv::csv_open,
            csv::csv_save,
            // Feature 008: hộp thoại nhập SVG (đọc byte thô ≤ 5 MiB + 64 B).
            svg::svg_open,
            // Feature 010 (studio-010 §2): lưu báo cáo xuất thử (CSV, XLSX, PDF) qua hộp thoại.
            csv::report_save,
            // Feature 011 (svg-editor §6): trình vẽ SVG: đổi trên đĩa, danh sách SVG, bản tự lưu.
            project_fingerprint,
            project_list_svg,
            editor_list,
            editor_remove
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<PackageStore>().clear();
            }
        });
}
