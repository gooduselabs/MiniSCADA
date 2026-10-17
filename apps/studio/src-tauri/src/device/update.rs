//! Cập nhật runtime qua mạng (OTA, feature 011, T119; FR-068; contracts/device-api-011.md §3):
//! - `update_pick`: hộp thoại chọn file `.matupdate`; Rust đọc (≤ 128 MiB) và giữ byte trong bộ nhớ, giao diện chỉ nhận
//!   `{ fileId, name, size }` (không có đường dẫn, không có byte);
//! - `device_update_upload`: `POST /api/v1/system/update` (thân là gói, `application/octet-stream`, `Content-Length`,
//!   không chunked), sự kiện `send` theo tiến trình gửi như nạp xuống; 201 trả `{ updateId, state, plan }`;
//! - `device_update_status`: `GET /api/v1/system/update`;
//! - `device_update_apply`: `POST /api/v1/system/update/apply {"updateId", "password"}` (202);
//! - `device_update_cancel`: `POST /api/v1/system/update/cancel {"updateId"}`;
//! - `device_update_rollback`: `POST /api/v1/system/update/rollback {"password"}` (202).
//!
//! Đi qua phiên có sẵn (token chỉ ở Rust, Bearer; thiết bị không nhận cookie ở các endpoint này) và HTTPS có ghim của
//! `DeviceManager`. Chưa đăng nhập thì không gửi gì (`auth-required`). Mật khẩu xác thực lại chỉ đi vào ở `apply` và
//! `rollback`, nằm trong bộ đệm `Zeroizing` tới khi reqwest gửi xong. Không tự gửi lại khi lỗi mạng: giao diện theo dõi
//! bằng `device_update_status` (thiết bị chạy lại sau `apply`).

use super::deploy::{DeployEvent, Sink, failure as deploy_failure, progress_body};
use super::http::{self, ApiResult, device_url, error_code};
use super::session;
use super::{DeviceError, DeviceManager};
use reqwest::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, RETRY_AFTER};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio_tungstenite::tungstenite::Bytes;
use zeroize::Zeroizing;

pub const UPDATE_PATH: &str = "/api/v1/system/update";
pub const UPDATE_APPLY_PATH: &str = "/api/v1/system/update/apply";
pub const UPDATE_CANCEL_PATH: &str = "/api/v1/system/update/cancel";
pub const UPDATE_ROLLBACK_PATH: &str = "/api/v1/system/update/rollback";
/// File `.matupdate` lớn nhất Studio đọc (thiết bị: `update.maxPackageMiB`, mặc định 64; trần của Studio rộng hơn để
/// thiết bị tự trả 413 theo cấu hình của nó).
pub const MAX_UPDATE_FILE: u64 = 128 * 1024 * 1024;
/// Thiết bị nhận gói tối đa 120 s; Studio chờ thêm một chút để đọc phản hồi kiểm gói.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(150);
/// `apply`, `rollback` kiểm mật khẩu (Argon2id) và ghi audit bền trước khi trả lời.
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(30);
/// Mật khẩu dài nhất (như đăng nhập, device-api §3).
const MAX_PASSWORD_BYTES: usize = 512;
/// Thân phản hồi lỗi đọc vào bộ nhớ.
const MAX_ERROR_BODY: usize = 64 * 1024;

/// Mã gói do thiết bị cấp: `upd_` + 16 hex chữ thường.
pub fn valid_update_id(s: &str) -> bool {
    s.strip_prefix("upd_").is_some_and(|h| {
        h.len() == 16
            && h.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

/// File đã chọn, gửi giao diện (không có đường dẫn, không có byte).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFileInfo {
    pub file_id: String,
    pub name: String,
    pub size: u64,
}

struct Picked {
    info: UpdateFileInfo,
    bytes: Arc<Vec<u8>>,
}

/// File `.matupdate` đang chọn (một file mỗi lúc; chọn file khác thì file cũ bị bỏ).
#[derive(Default)]
pub struct UpdateFiles(Mutex<Option<Picked>>);

impl UpdateFiles {
    fn slot(&self) -> std::sync::MutexGuard<'_, Option<Picked>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Giữ file vừa chọn (bỏ file cũ), cấp mã mới.
    pub fn put(&self, name: String, bytes: Vec<u8>) -> UpdateFileInfo {
        let info = UpdateFileInfo {
            file_id: uuid::Uuid::new_v4().to_string(),
            name,
            size: bytes.len() as u64,
        };
        *self.slot() = Some(Picked {
            info: info.clone(),
            bytes: Arc::new(bytes),
        });
        info
    }

    /// Byte của file `file_id` nếu đó vẫn là file đang chọn.
    pub fn get(&self, file_id: &str) -> Option<Arc<Vec<u8>>> {
        self.slot()
            .as_ref()
            .filter(|p| p.info.file_id == file_id)
            .map(|p| p.bytes.clone())
    }

    pub fn clear(&self) {
        *self.slot() = None;
    }
}

fn has_update_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("matupdate"))
}

/// Đọc file `.matupdate` ≤ `max` byte: đuôi đúng, không rỗng. Trả tên file (không đường dẫn) và byte.
pub fn read_update_file(path: &Path, max: u64) -> Result<(String, Vec<u8>), DeviceError> {
    if !has_update_extension(path) {
        return Err(DeviceError::BadArgs);
    }
    let io = |e: std::io::Error| DeviceError::Io(e.to_string());
    let file = std::fs::File::open(path).map_err(io)?;
    let mut bytes = Vec::new();
    file.take(max + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() as u64 > max {
        return Err(DeviceError::TooLarge);
    }
    if bytes.is_empty() {
        return Err(DeviceError::BadArgs);
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((name, bytes))
}

/// Mã của thiết bị thuộc OTA: trả nguyên mã và `detail` cho giao diện.
fn is_update_code(code: &str) -> bool {
    code.starts_with("UPDATE_")
        || matches!(
            code,
            "UPDATER_MANUAL_ONLY" | "INSUFFICIENT_SPACE" | "REAUTH_FAILED"
        )
}

/// Lỗi của các endpoint OTA và có phải bỏ token phiên không. `DEVICE_BUSY` và lỗi phiên như nạp xuống; 429 của xác thực
/// lại (`AUTH_LOCKED`, `LOGIN_BUSY`) như đăng nhập.
fn update_failure(status: u16, body: &[u8], retry_after: Option<&str>) -> (DeviceError, bool) {
    match error_code(body) {
        Some(code) if is_update_code(&code) => {
            let detail = serde_json::from_slice::<Value>(body)
                .ok()
                .and_then(|v| v.get("detail").cloned())
                .unwrap_or(Value::Null);
            (DeviceError::Update { code, detail }, false)
        }
        Some(code) if status == 429 && matches!(code.as_str(), "AUTH_LOCKED" | "LOGIN_BUSY") => {
            (session::login_failure(status, body, retry_after), false)
        }
        _ => deploy_failure(status, body),
    }
}

/// Thân JSON có mật khẩu trong bộ đệm tự xóa (như `login_body`). Cấp sẵn đủ chỗ cho trường hợp thoát ký tự dài nhất để
/// `Vec` không cấp lại giữa chừng và để lại bản sao.
fn secret_body<T: Serialize>(value: &T, secret_len: usize) -> Zeroizing<Vec<u8>> {
    let mut body = Zeroizing::new(Vec::with_capacity(64 + 6 * secret_len));
    serde_json::to_writer(&mut *body, value).expect("ghi JSON vào Vec không lỗi");
    body
}

fn check_password(password: &str) -> Result<(), DeviceError> {
    if password.is_empty() || password.len() > MAX_PASSWORD_BYTES {
        return Err(DeviceError::BadArgs);
    }
    Ok(())
}

impl DeviceManager {
    /// `POST` một endpoint OTA kèm token (chưa đăng nhập thì không gửi gì).
    async fn update_send(
        &self,
        id: &str,
        path: &str,
        content_type: &str,
        body: reqwest::Body,
        length: u64,
        timeout: Duration,
    ) -> Result<ApiResult, DeviceError> {
        let device = self.registry.get(id)?;
        let auth = self.sessions.header(id).ok_or(DeviceError::AuthRequired)?;
        let client = self.client_for(&device)?;
        let url = device_url("https", &device.host, device.https_port, path, None)?;
        let resp = client
            .client
            .post(url)
            .timeout(timeout)
            .header(AUTHORIZATION, auth)
            .header(CONTENT_TYPE, content_type)
            .header(CONTENT_LENGTH, length)
            .body(body)
            .send()
            .await
            .map_err(|e| http::classify(&e, Some(&client.verifier)))?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get(RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let raw = http::read_body(resp, MAX_ERROR_BODY, Some(&client.verifier)).await?;
        if (200..300).contains(&status) {
            let body = if raw.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&raw).map_err(|_| DeviceError::BadResponse)?
            };
            return Ok(ApiResult { status, body });
        }
        let (error, drop_token) = update_failure(status, &raw, retry_after.as_deref());
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }

    /// Tải gói lên (contract §3): `application/octet-stream`, `Content-Length` bằng cỡ gói, không chunked; sự kiện
    /// `send` theo tiến trình gửi. 201 trả `{ updateId, state, plan }`.
    pub async fn update_upload(
        &self,
        id: &str,
        package: Arc<Vec<u8>>,
        on_event: Sink,
    ) -> Result<ApiResult, DeviceError> {
        if package.is_empty() {
            return Err(DeviceError::BadArgs);
        }
        let total = package.len() as u64;
        self.update_send(
            id,
            UPDATE_PATH,
            "application/octet-stream",
            progress_body(package, on_event),
            total,
            UPLOAD_TIMEOUT,
        )
        .await
    }

    /// `GET /api/v1/system/update` kèm token (chưa đăng nhập thì không gửi). Lỗi mạng khi thiết bị đang chạy lại giữ
    /// nguyên (`unreachable`, `timeout`) để giao diện hỏi lại; phiên không bị bỏ.
    pub async fn update_status(&self, id: &str) -> Result<ApiResult, DeviceError> {
        let device = self.registry.get(id)?;
        if self.sessions.header(id).is_none() {
            return Err(DeviceError::AuthRequired);
        }
        let (status, body) = self.send_get(&device, UPDATE_PATH, None, true).await?;
        if (200..300).contains(&status) {
            let body = if body.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&body).map_err(|_| DeviceError::BadResponse)?
            };
            return Ok(ApiResult { status, body });
        }
        let (error, drop_token) = update_failure(status, &body, None);
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }

    /// Áp dụng gói `update_id` (xác thực lại bằng mật khẩu). 202 `{ "state": "applying" }`: thiết bị trả lời trước khi
    /// dịch vụ dừng.
    pub async fn update_apply(
        &self,
        id: &str,
        update_id: &str,
        password: Zeroizing<String>,
    ) -> Result<ApiResult, DeviceError> {
        if !valid_update_id(update_id) {
            return Err(DeviceError::BadArgs);
        }
        check_password(&password)?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Apply<'a> {
            update_id: &'a str,
            password: &'a str,
        }
        let body = secret_body(
            &Apply {
                update_id,
                password: &password,
            },
            password.len(),
        );
        drop(password);
        let n = body.len() as u64;
        // Bộ đệm `Zeroizing` đi vào `Bytes`: bị xóa khi reqwest bỏ thân request sau khi gửi.
        self.update_send(
            id,
            UPDATE_APPLY_PATH,
            "application/json",
            reqwest::Body::from(Bytes::from_owner(body)),
            n,
            CONFIRM_TIMEOUT,
        )
        .await
    }

    /// Hủy gói đang chờ (chưa áp dụng).
    pub async fn update_cancel(&self, id: &str, update_id: &str) -> Result<ApiResult, DeviceError> {
        if !valid_update_id(update_id) {
            return Err(DeviceError::BadArgs);
        }
        let body = serde_json::to_vec(&serde_json::json!({ "updateId": update_id }))
            .map_err(|_| DeviceError::BadResponse)?;
        let n = body.len() as u64;
        self.update_send(
            id,
            UPDATE_CANCEL_PATH,
            "application/json",
            reqwest::Body::from(body),
            n,
            http::REQUEST_TIMEOUT,
        )
        .await
    }

    /// Quay về bản `.prev` (xác thực lại bằng mật khẩu).
    pub async fn update_rollback(
        &self,
        id: &str,
        password: Zeroizing<String>,
    ) -> Result<ApiResult, DeviceError> {
        check_password(&password)?;
        #[derive(Serialize)]
        struct Rollback<'a> {
            password: &'a str,
        }
        let body = secret_body(
            &Rollback {
                password: &password,
            },
            password.len(),
        );
        drop(password);
        let n = body.len() as u64;
        self.update_send(
            id,
            UPDATE_ROLLBACK_PATH,
            "application/json",
            reqwest::Body::from(Bytes::from_owner(body)),
            n,
            CONFIRM_TIMEOUT,
        )
        .await
    }
}

// ---- Lệnh Tauri ----

fn sink_of(channel: Channel<DeployEvent>) -> Sink {
    // Giao diện đã đóng: không còn ai nhận, bỏ qua.
    Arc::new(move |e| {
        let _ = channel.send(e);
    })
}

/// `update_pick() → { fileId, name, size } | null` (hủy hộp thoại thì `null`).
#[tauri::command]
pub async fn update_pick(
    app: AppHandle,
    files: State<'_, UpdateFiles>,
) -> Result<Option<UpdateFileInfo>, DeviceError> {
    let picked = app
        .dialog()
        .file()
        .set_title("Chọn gói cập nhật runtime")
        .add_filter("Gói cập nhật mAT", &["matupdate"])
        .blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|e| DeviceError::Io(e.to_string()))?;
    let (name, bytes) =
        tauri::async_runtime::spawn_blocking(move || read_update_file(&path, MAX_UPDATE_FILE))
            .await
            .map_err(|e| DeviceError::Io(e.to_string()))??;
    Ok(Some(files.put(name, bytes)))
}

/// `device_update_upload({ id, fileId, onEvent }) → { status, body }`
#[tauri::command]
pub async fn device_update_upload(
    id: String,
    file_id: String,
    on_event: Channel<DeployEvent>,
    devices: State<'_, DeviceManager>,
    files: State<'_, UpdateFiles>,
) -> Result<ApiResult, DeviceError> {
    let bytes = files.get(&file_id).ok_or(DeviceError::NoSuchPackage)?;
    let r = devices.update_upload(&id, bytes, sink_of(on_event)).await;
    if r.is_ok() {
        // Thiết bị đã nhận và kiểm gói: không giữ byte trong bộ nhớ nữa (tải lại thì chọn lại file).
        files.clear();
    }
    r
}

/// `device_update_status({ id }) → { status, body }`
#[tauri::command]
pub async fn device_update_status(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.update_status(&id).await
}

/// `device_update_apply({ id, updateId, password }) → { status, body }`. Mật khẩu được bọc `Zeroizing` ngay.
#[tauri::command]
pub async fn device_update_apply(
    id: String,
    update_id: String,
    password: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    let password = Zeroizing::new(password);
    devices.update_apply(&id, &update_id, password).await
}

/// `device_update_cancel({ id, updateId }) → { status, body }`
#[tauri::command]
pub async fn device_update_cancel(
    id: String,
    update_id: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.update_cancel(&id, &update_id).await
}

/// `device_update_rollback({ id, password }) → { status, body }`. Mật khẩu được bọc `Zeroizing` ngay.
#[tauri::command]
pub async fn device_update_rollback(
    id: String,
    password: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    let password = Zeroizing::new(password);
    devices.update_rollback(&id, password).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::test_support::{Online, Req, Resp, TempDir, online_with};
    use serde_json::json;

    const UID: &str = "upd_0123456789abcdef";

    fn plan() -> Value {
        json!({
            "from": "1.0.0", "to": "1.0.1", "releaseSeq": 12,
            "signer": { "keyId": "sha256:ab12", "label": "release-primary" },
            "projectCompatible": true, "estimatedDowntimeS": 25, "restartRequired": true,
            "notes": "Sửa lỗi", "kind": "runtime"
        })
    }

    /// Thiết bị giả theo contract §3: Bearer bắt buộc, chỉ administrator; `next` thay phản hồi kế tiếp của các route
    /// cập nhật; ghi lại thân các POST JSON và thân gói.
    struct Ota {
        role: &'static str,
        password: String,
        next: Option<Resp>,
        bodies: Vec<(String, Value)>,
        package: Vec<u8>,
    }

    async fn device(name: &str) -> (Online, Arc<Mutex<Ota>>) {
        let st = Arc::new(Mutex::new(Ota {
            role: "administrator",
            password: "mật-khẩu-đúng-0123".into(),
            next: None,
            bodies: Vec::new(),
            package: Vec::new(),
        }));
        let s = st.clone();
        let o = online_with(name, move |req: &Req| {
            let path = req.path();
            if !path.starts_with(UPDATE_PATH) {
                return None;
            }
            let mut g = s.lock().unwrap();
            if req.bearer().is_none() {
                return Some(Resp::error(401, "AUTH_REQUIRED"));
            }
            if g.role != "administrator" {
                return Some(Resp::error(403, "FORBIDDEN"));
            }
            if req.method == "POST" && path != UPDATE_PATH {
                let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
                g.bodies.push((path.into(), body));
            }
            if req.method == "POST" && path == UPDATE_PATH {
                g.package = req.body.clone();
            }
            if let Some(r) = g.next.take() {
                return Some(r);
            }
            Some(match (req.method.as_str(), path) {
                ("POST", UPDATE_PATH) => Resp::json(
                    201,
                    json!({ "updateId": UID, "state": "verified", "plan": plan() }),
                ),
                ("GET", UPDATE_PATH) => Resp::json(
                    200,
                    json!({
                        "enabled": true, "state": "verified", "updateId": UID, "plan": plan(),
                        "step": null, "startedAt": null, "last": null,
                        "previous": { "version": "0.9.0", "available": true }
                    }),
                ),
                ("POST", UPDATE_APPLY_PATH) | ("POST", UPDATE_ROLLBACK_PATH) => {
                    let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
                    if body.get("password").and_then(Value::as_str) != Some(g.password.as_str()) {
                        Resp::error(403, "REAUTH_FAILED")
                    } else {
                        Resp::json(202, json!({ "state": "applying" }))
                    }
                }
                ("POST", UPDATE_CANCEL_PATH) => Resp::json(200, json!({ "state": "idle" })),
                _ => Resp::error(404, "NOT_FOUND"),
            })
        })
        .await;
        (o, st)
    }

    type Events = Arc<Mutex<Vec<DeployEvent>>>;

    fn events() -> (Events, Sink) {
        let log: Events = Arc::new(Mutex::new(Vec::new()));
        let sink = log.clone();
        (log, Arc::new(move |e| sink.lock().unwrap().push(e)))
    }

    fn pw(o: &Arc<Mutex<Ota>>) -> Zeroizing<String> {
        Zeroizing::new(o.lock().unwrap().password.clone())
    }

    fn update_requests(o: &Online) -> Vec<Req> {
        o.server
            .requests()
            .into_iter()
            .filter(|r| r.path().starts_with(UPDATE_PATH))
            .collect()
    }

    fn refused(code: &str, detail: Value) -> DeviceError {
        DeviceError::Update {
            code: code.into(),
            detail,
        }
    }

    #[tokio::test]
    async fn upload_sends_the_file_with_content_length_and_reports_progress() {
        let (o, st) = device("ota-upload").await;
        o.login().await;
        let bytes: Vec<u8> = (0..(600 * 1024u32)).map(|i| (i % 251) as u8).collect();
        let (log, sink) = events();
        let r = o
            .manager
            .update_upload(&o.id, Arc::new(bytes.clone()), sink)
            .await
            .unwrap();
        assert_eq!(r.status, 201);
        assert_eq!(r.body["updateId"], UID);
        assert_eq!(r.body["plan"]["signer"]["label"], "release-primary");
        assert_eq!(
            st.lock().unwrap().package,
            bytes,
            "thân là đúng byte của file"
        );
        let req = update_requests(&o).pop().unwrap();
        assert_eq!(req.method, "POST");
        assert_eq!(req.path(), UPDATE_PATH);
        assert_eq!(req.header("content-type"), Some("application/octet-stream"));
        assert_eq!(
            req.header("content-length"),
            Some(bytes.len().to_string().as_str())
        );
        assert!(req.header("transfer-encoding").is_none(), "không chunked");
        assert_eq!(req.bearer(), o.device_token().as_deref());
        assert!(req.header("cookie").is_none());
        let sends: Vec<(u64, u64)> = log
            .lock()
            .unwrap()
            .iter()
            .filter_map(|e| match e {
                DeployEvent::Send { sent, total } => Some((*sent, *total)),
                _ => None,
            })
            .collect();
        assert!(sends.len() >= 2, "báo tiến trình nhiều lần: {sends:?}");
        assert!(sends.windows(2).all(|w| w[0].0 < w[1].0), "tăng dần");
        let total = bytes.len() as u64;
        assert_eq!(sends.last(), Some(&(total, total)));
    }

    #[tokio::test]
    async fn upload_maps_the_refusals_of_the_device() {
        let (o, st) = device("ota-refuse").await;
        o.login().await;
        let pkg = Arc::new(vec![1u8; 1024]);
        let cases: Vec<(u16, &str, Value)> = vec![
            (
                400,
                "UPDATE_PACKAGE_INVALID",
                json!({ "code": "E_UPD_HASH" }),
            ),
            (403, "UPDATE_SIGNATURE_INVALID", Value::Null),
            (403, "UPDATE_KEY_UNKNOWN", Value::Null),
            (404, "UPDATE_DISABLED", Value::Null),
            (409, "UPDATE_DOWNGRADE", Value::Null),
            (409, "UPDATE_PROJECT_INCOMPATIBLE", Value::Null),
            (413, "UPDATE_TOO_LARGE", Value::Null),
            (422, "UPDATE_ARCH_MISMATCH", Value::Null),
            (422, "UPDATER_MANUAL_ONLY", Value::Null),
            (507, "INSUFFICIENT_SPACE", Value::Null),
            (408, "UPDATE_RECEIVE_ABORTED", Value::Null),
            (503, "UPDATE_KEYS_MISSING", Value::Null),
        ];
        for (status, code, detail) in cases {
            let mut body = json!({ "error": code, "message": "lỗi thử" });
            if !detail.is_null() {
                body["detail"] = detail.clone();
            }
            st.lock().unwrap().next = Some(Resp::json(status, body));
            let (_, sink) = events();
            assert_eq!(
                o.manager.update_upload(&o.id, pkg.clone(), sink).await,
                Err(refused(code, detail)),
                "{status} {code}"
            );
        }
        // 409 DEVICE_BUSY như nạp xuống (chung khóa thao tác).
        st.lock().unwrap().next = Some(Resp::json(
            409,
            json!({ "error": "DEVICE_BUSY", "message": "bận", "kind": "deploy", "user": "kysu2" }),
        ));
        let (_, sink) = events();
        match o.manager.update_upload(&o.id, pkg.clone(), sink).await {
            Err(DeviceError::Busy(m)) => assert_eq!(m["user"], "kysu2"),
            other => panic!("{other:?}"),
        }
        // Không phải administrator: 403 FORBIDDEN, giữ phiên.
        st.lock().unwrap().role = "engineer";
        let (_, sink) = events();
        assert_eq!(
            o.manager.update_upload(&o.id, pkg.clone(), sink).await,
            Err(DeviceError::Forbidden)
        );
        assert!(o.manager.sessions().header(&o.id).is_some());
        // Phiên hết hạn: bỏ token.
        st.lock().unwrap().role = "administrator";
        st.lock().unwrap().next = Some(Resp::error(401, "SESSION_EXPIRED"));
        let (_, sink) = events();
        assert_eq!(
            o.manager.update_upload(&o.id, pkg, sink).await,
            Err(DeviceError::SessionExpired)
        );
        assert!(o.manager.sessions().header(&o.id).is_none(), "bỏ token");
    }

    #[tokio::test]
    async fn without_a_session_nothing_is_sent() {
        let (o, st) = device("ota-nosession").await;
        let (_, sink) = events();
        assert_eq!(
            o.manager
                .update_upload(&o.id, Arc::new(vec![1, 2, 3]), sink)
                .await,
            Err(DeviceError::AuthRequired)
        );
        assert_eq!(
            o.manager.update_status(&o.id).await,
            Err(DeviceError::AuthRequired)
        );
        assert_eq!(
            o.manager.update_apply(&o.id, UID, pw(&st)).await,
            Err(DeviceError::AuthRequired)
        );
        assert_eq!(
            o.manager.update_cancel(&o.id, UID).await,
            Err(DeviceError::AuthRequired)
        );
        assert_eq!(
            o.manager.update_rollback(&o.id, pw(&st)).await,
            Err(DeviceError::AuthRequired)
        );
        assert!(update_requests(&o).is_empty(), "không gửi gì");
        assert_eq!(
            o.manager.update_status("không-có").await,
            Err(DeviceError::NoSuchDevice)
        );
    }

    #[tokio::test]
    async fn status_reads_the_state_with_the_token() {
        let (o, _) = device("ota-status").await;
        o.login().await;
        let r = o.manager.update_status(&o.id).await.unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body["state"], "verified");
        assert_eq!(r.body["previous"]["version"], "0.9.0");
        let req = update_requests(&o).pop().unwrap();
        assert_eq!(req.method, "GET");
        assert_eq!(req.bearer(), o.device_token().as_deref());
    }

    #[tokio::test]
    async fn apply_sends_the_id_and_password_and_maps_reauth_and_lock() {
        let (o, st) = device("ota-apply").await;
        o.login().await;
        let r = o.manager.update_apply(&o.id, UID, pw(&st)).await.unwrap();
        assert_eq!(r.status, 202);
        assert_eq!(r.body["state"], "applying");
        let (path, body) = st.lock().unwrap().bodies.last().cloned().unwrap();
        assert_eq!(path, UPDATE_APPLY_PATH);
        assert_eq!(
            body,
            json!({ "updateId": UID, "password": st.lock().unwrap().password })
        );
        let req = update_requests(&o).pop().unwrap();
        assert!(
            req.header("content-type")
                .is_some_and(|v| v.starts_with("application/json"))
        );
        // Sai mật khẩu: REAUTH_FAILED, phiên vẫn còn.
        assert_eq!(
            o.manager
                .update_apply(&o.id, UID, Zeroizing::new("sai".into()))
                .await,
            Err(refused("REAUTH_FAILED", Value::Null))
        );
        assert!(o.manager.sessions().header(&o.id).is_some());
        // Khóa cặp (tên, IP) như đăng nhập sai.
        st.lock().unwrap().next = Some(Resp::json(
            429,
            json!({ "error": "AUTH_LOCKED", "message": "khóa", "retryAfterS": 120 }),
        ));
        assert_eq!(
            o.manager.update_apply(&o.id, UID, pw(&st)).await,
            Err(DeviceError::Locked(120))
        );
        st.lock().unwrap().next = Some(Resp::error(429, "LOGIN_BUSY"));
        assert_eq!(
            o.manager.update_apply(&o.id, UID, pw(&st)).await,
            Err(DeviceError::AuthBusy)
        );
        st.lock().unwrap().next = Some(Resp::error(404, "UPDATE_NOT_FOUND"));
        assert_eq!(
            o.manager.update_apply(&o.id, UID, pw(&st)).await,
            Err(refused("UPDATE_NOT_FOUND", Value::Null))
        );
    }

    #[tokio::test]
    async fn apply_and_cancel_check_their_arguments_before_sending() {
        let (o, st) = device("ota-args").await;
        o.login().await;
        for bad in [
            "",
            "upd_123",
            "UPD_0123456789abcdef",
            "upd_0123456789ABCDEF",
            "upd_0123456789abcdeg",
            "upd_0123456789abcdef0",
            "../system/info",
        ] {
            assert_eq!(
                o.manager.update_apply(&o.id, bad, pw(&st)).await,
                Err(DeviceError::BadArgs),
                "{bad}"
            );
            assert_eq!(
                o.manager.update_cancel(&o.id, bad).await,
                Err(DeviceError::BadArgs),
                "{bad}"
            );
        }
        for password in [String::new(), "x".repeat(513)] {
            assert_eq!(
                o.manager
                    .update_apply(&o.id, UID, Zeroizing::new(password.clone()))
                    .await,
                Err(DeviceError::BadArgs)
            );
            assert_eq!(
                o.manager
                    .update_rollback(&o.id, Zeroizing::new(password))
                    .await,
                Err(DeviceError::BadArgs)
            );
        }
        assert!(update_requests(&o).is_empty(), "không gửi gì");
    }

    #[tokio::test]
    async fn cancel_and_rollback_send_their_bodies() {
        let (o, st) = device("ota-cancel").await;
        o.login().await;
        let r = o.manager.update_cancel(&o.id, UID).await.unwrap();
        assert_eq!(r.body, json!({ "state": "idle" }));
        let r = o.manager.update_rollback(&o.id, pw(&st)).await.unwrap();
        assert_eq!(r.status, 202);
        let bodies = st.lock().unwrap().bodies.clone();
        let password = st.lock().unwrap().password.clone();
        assert_eq!(
            bodies,
            vec![
                (UPDATE_CANCEL_PATH.to_string(), json!({ "updateId": UID })),
                (
                    UPDATE_ROLLBACK_PATH.to_string(),
                    json!({ "password": password })
                ),
            ]
        );
        st.lock().unwrap().next = Some(Resp::error(409, "UPDATE_NO_PREVIOUS"));
        assert_eq!(
            o.manager.update_rollback(&o.id, pw(&st)).await,
            Err(refused("UPDATE_NO_PREVIOUS", Value::Null))
        );
    }

    #[tokio::test]
    async fn status_while_the_device_restarts_is_unreachable_and_keeps_the_session() {
        let (o, _) = device("ota-restart").await;
        o.login().await;
        let Online {
            manager,
            server,
            id,
            state: _state,
            dir: _dir,
            cert: _cert,
        } = o;
        drop(server);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let r = manager.update_status(&id).await;
        assert!(
            matches!(r, Err(DeviceError::Unreachable | DeviceError::Timeout)),
            "{r:?}"
        );
        assert!(manager.sessions().header(&id).is_some(), "giữ phiên");
    }

    #[test]
    fn update_ids_follow_the_contract() {
        assert!(valid_update_id(UID));
        assert!(valid_update_id("upd_ffffffffffffffff"));
        for bad in [
            "upd_",
            "upd_0123",
            "x_0123456789abcdef",
            "upd_0123456789abcdeF",
        ] {
            assert!(!valid_update_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_picked_file_is_handed_out_by_its_id_only() {
        let files = UpdateFiles::default();
        let a = files.put("mat-runtime-1.0.1.matupdate".into(), vec![1, 2, 3]);
        assert_eq!(a.name, "mat-runtime-1.0.1.matupdate");
        assert_eq!(a.size, 3);
        assert!(!a.file_id.is_empty());
        assert_eq!(files.get(&a.file_id).as_deref(), Some(&vec![1, 2, 3]));
        assert!(files.get("khác").is_none());
        let b = files.put("b.matupdate".into(), vec![9]);
        assert_ne!(a.file_id, b.file_id);
        assert!(
            files.get(&a.file_id).is_none(),
            "chọn file khác thì bỏ file cũ"
        );
        assert_eq!(files.get(&b.file_id).as_deref(), Some(&vec![9]));
        files.clear();
        assert!(files.get(&b.file_id).is_none());
        // Không có đường dẫn hay byte trong dữ liệu gửi giao diện.
        assert_eq!(
            serde_json::to_value(&b).unwrap(),
            json!({ "fileId": b.file_id, "name": "b.matupdate", "size": 1 })
        );
    }

    #[test]
    fn reading_a_file_checks_its_extension_and_size() {
        let t = TempDir::new("ota-read");
        let ok = t.file("mat-runtime-1.0.1.MATUPDATE");
        std::fs::write(&ok, vec![7u8; 100]).unwrap();
        let (name, bytes) = read_update_file(&ok, 100).unwrap();
        assert_eq!(name, "mat-runtime-1.0.1.MATUPDATE");
        assert_eq!(bytes, vec![7u8; 100]);
        assert_eq!(read_update_file(&ok, 99), Err(DeviceError::TooLarge));
        let other = t.file("goi.zip");
        std::fs::write(&other, b"x").unwrap();
        assert_eq!(read_update_file(&other, 100), Err(DeviceError::BadArgs));
        let empty = t.file("rong.matupdate");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(read_update_file(&empty, 100), Err(DeviceError::BadArgs));
        assert!(matches!(
            read_update_file(&t.file("khong-co.matupdate"), 100),
            Err(DeviceError::Io(_))
        ));
    }

    #[test]
    fn the_refusal_serializes_with_its_code_and_detail() {
        assert_eq!(
            serde_json::to_value(refused(
                "UPDATE_PACKAGE_INVALID",
                json!({ "code": "E_UPD_HASH" })
            ))
            .unwrap(),
            json!({ "update": { "code": "UPDATE_PACKAGE_INVALID", "detail": { "code": "E_UPD_HASH" } } })
        );
        assert_eq!(
            serde_json::to_value(refused("REAUTH_FAILED", Value::Null)).unwrap(),
            json!({ "update": { "code": "REAUTH_FAILED", "detail": null } })
        );
    }
}
