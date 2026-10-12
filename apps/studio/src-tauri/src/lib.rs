mod device;
mod discovery;
mod package;
mod project_fs;
mod recent;

use device::DeviceManager;
use device::live::LiveHub;
use discovery::Discovery;
use package::PackageStore;
use project_fs::{FileText, ReadError, WriteError};
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

/// Mở trang runtime của thiết bị trong trình duyệt mặc định; chỉ nhận http(s).
#[tauri::command]
fn open_device_web(url: String) -> Result<(), String> {
    let ok = (url.starts_with("http://") || url.starts_with("https://"))
        && url.len() <= 256
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"');
    if !ok {
        return Err(format!("URL không hợp lệ: {url}"));
    }
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
            device::deploy::device_deploy,
            device::deploy::device_restore,
            device::deploy::device_fetch_package
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<PackageStore>().clear();
            }
        });
}
