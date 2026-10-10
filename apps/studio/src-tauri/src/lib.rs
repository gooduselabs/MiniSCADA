mod project_fs;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    tauri: &'static str,
}

/// Thư mục project do người dùng chọn bằng hộp thoại phía Rust. Giao diện không truyền được
/// đường dẫn gốc nên không đọc/ghi được ngoài thư mục này (FR-037).
#[derive(Default)]
struct ProjectRoot(Mutex<Option<PathBuf>>);

fn root_of(state: &State<'_, ProjectRoot>) -> Result<PathBuf, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "chưa mở project".to_string())
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

/// Hộp thoại chọn thư mục project; trả về đường dẫn để hiển thị (None nếu hủy).
#[tauri::command]
async fn project_pick(app: tauri::AppHandle, state: State<'_, ProjectRoot>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Mở thư mục project mAT SCADA").blocking_pick_folder();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let display = path.display().to_string();
    *state.0.lock().unwrap() = Some(path);
    Ok(Some(display))
}

#[tauri::command]
fn project_read(rel: String, state: State<'_, ProjectRoot>) -> Result<Option<String>, String> {
    project_fs::read_text(&root_of(&state)?, &rel)
}

#[tauri::command]
fn project_write(rel: String, content: String, state: State<'_, ProjectRoot>) -> Result<(), String> {
    project_fs::write_text_atomic(&root_of(&state)?, &rel, &content)
}

/// Mở trang runtime của thiết bị trong trình duyệt mặc định; chỉ nhận http(s).
#[tauri::command]
fn open_device_web(url: String) -> Result<(), String> {
    let ok = (url.starts_with("http://") || url.starts_with("https://"))
        && url.len() <= 256
        && !url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"');
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
        .invoke_handler(tauri::generate_handler![
            app_info,
            project_pick,
            project_read,
            project_write,
            open_device_web
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
