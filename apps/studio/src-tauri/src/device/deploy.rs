//! Nạp xuống, khôi phục, đọc lên gói (feature 005, US2; contracts/tauri-commands.md §8,
//! device-api.md §4, data-model.md §10).
//!
//! - `deploy`: `POST /api/v1/project/deployments` (thân là gói, `Content-Length`, `X-Mat-Digest`,
//!   `X-Mat-Base-Digest`), sự kiện `send` theo tiến trình gửi, rồi hỏi tiến trình mỗi 500 ms;
//! - `restore`: `POST /api/v1/project/restore`, theo dõi như trên;
//! - lúc thiết bị chạy lại (kích hoạt project bằng `execv`, 1–3 s) kết nối bị từ chối: sự kiện
//!   `restarting` một lần, thử lại tới 60 s, quá thì `lost` (thao tác vẫn có thể đã xong: giao diện
//!   hỏi lại bằng `device_get /api/v1/project/operation`);
//! - `fetch_package`: `GET /api/v1/project/package`, kiểm gói đúng luật như thiết bị, digest phải bằng
//!   `X-Mat-Digest`.
//!
//! Token phiên chỉ ở phía Rust; mọi request qua HTTPS có ghim của `DeviceManager`.

use super::http::{PinnedClient, device_url, error_code, read_body};
use super::registry::{KnownDevice, is_uuid};
use super::session;
use super::{DeviceError, DeviceManager};
use crate::package::manifest::is_lower_hex64;
use crate::package::{Checked, Origin, PackageError, PackageInfo, PackageStore, check_package};
use reqwest::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, HeaderValue};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tauri::ipc::Channel;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Bytes;

/// Hạn của cả request gửi gói hay đọc gói (thiết bị hủy `receive` sau 10 phút): hạn 10 s của client
/// chỉ hợp cho request nhỏ.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Kích thước mỗi mẩu của thân gửi đi.
const CHUNK: usize = 64 * 1024;
/// Báo tiến trình gửi mỗi ngần này byte (và khi gửi xong).
const PROGRESS_STEP: u64 = 256 * 1024;
/// Thân phản hồi lỗi đọc vào bộ nhớ.
const MAX_ERROR_BODY: usize = 64 * 1024;
/// Gói lớn nhất (contract §2).
const MAX_PACKAGE: usize = crate::package::rules::MAX_PACKAGE_BYTES as usize;

/// Nhịp theo dõi và hạn chờ thiết bị chạy lại.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeployTimings {
    /// Hỏi tiến trình mỗi `poll`.
    pub poll: Duration,
    /// Không theo dõi được quá `lost` kể từ lần mất kết nối đầu thì bỏ cuộc (`lost`).
    pub lost: Duration,
}

impl Default for DeployTimings {
    fn default() -> Self {
        DeployTimings {
            poll: Duration::from_millis(500),
            lost: Duration::from_secs(60),
        }
    }
}

/// Sự kiện của `device_deploy`, `device_restore` (qua `Channel`, đúng thứ tự gửi).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DeployEvent {
    /// Tiến trình gửi gói của Studio.
    Send { sent: u64, total: u64 },
    /// `DeployOperation` mỗi khi trạng thái đổi.
    Operation { op: Value },
    /// Thiết bị đang chạy lại (một lần mỗi lần mất kết nối).
    Restarting,
}

pub type Sink = Arc<dyn Fn(DeployEvent) + Send + Sync>;

fn valid_digest(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(is_lower_hex64)
}

/// `X-Mat-Base-Digest`: digest đang chạy mà người dùng đã xem, hoặc `none`.
fn valid_base(s: &str) -> bool {
    s == "none" || valid_digest(s)
}

fn package_error(e: PackageError) -> DeviceError {
    match e.path {
        Some(path) => DeviceError::PackageAt {
            code: e.code.to_string(),
            path,
        },
        None => DeviceError::Package(e.code.to_string()),
    }
}

/// Lỗi của thiết bị theo mã HTTP và thân lỗi, và có phải bỏ token phiên không.
pub(super) fn failure(status: u16, body: &[u8]) -> (DeviceError, bool) {
    let code = error_code(body);
    let known = match (status, code.as_deref()) {
        (409, Some("DEVICE_BUSY")) => {
            let mut busy = Map::new();
            if let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(body) {
                for key in ["opId", "kind", "user", "source", "since"] {
                    if let Some(v) = o.get(key) {
                        busy.insert(key.to_string(), v.clone());
                    }
                }
            }
            Some(DeviceError::Busy(busy))
        }
        (409, Some("BASE_CHANGED")) => Some(DeviceError::BaseChanged),
        (409, Some("NO_BASE_PROJECT")) => Some(DeviceError::NoBaseProject),
        (409, Some("ALREADY_ACTIVE")) => Some(DeviceError::AlreadyActive),
        (404, Some("NO_SUCH_VERSION")) => Some(DeviceError::NoSuchVersion),
        (404, Some("NO_PROJECT_PACKAGE")) => Some(DeviceError::NoProjectPackage),
        (507, _) => Some(DeviceError::NoSpace),
        (413, _) => Some(DeviceError::TooLarge),
        (503, Some("AUDIT_UNAVAILABLE")) => Some(DeviceError::AuditUnavailable),
        _ => None,
    };
    match known {
        Some(e) => (e, false),
        None => session::api_failure(status, body),
    }
}

/// Thân gửi đi theo từng mẩu 64 KiB, báo `send` khi đủ mỗi 256 KiB và khi gửi xong. `Content-Length`
/// đặt riêng trên request: thiết bị không nhận chunked.
pub(super) fn progress_body(package: Arc<Vec<u8>>, on_event: Sink) -> reqwest::Body {
    let total = package.len() as u64;
    let stream = futures_util::stream::unfold((package, 0usize, 0u64), move |(pkg, pos, last)| {
        let sink = on_event.clone();
        async move {
            if pos >= pkg.len() {
                return None;
            }
            let end = (pos + CHUNK).min(pkg.len());
            let chunk = Bytes::copy_from_slice(&pkg[pos..end]);
            let sent = end as u64;
            let mut last = last;
            if sent == total || sent - last >= PROGRESS_STEP {
                sink(DeployEvent::Send { sent, total });
                last = sent;
            }
            Some((Ok::<Bytes, std::io::Error>(chunk), (pkg, end, last)))
        }
    });
    reqwest::Body::wrap_stream(stream)
}

impl DeviceManager {
    /// Thiết bị, client có ghim và header phiên; chưa đăng nhập thì `session-expired`, không gửi gì.
    fn transfer_target(
        &self,
        id: &str,
    ) -> Result<(KnownDevice, Arc<PinnedClient>, HeaderValue), DeviceError> {
        let device = self.registry.get(id)?;
        let auth = self
            .sessions
            .header(id)
            .ok_or(DeviceError::SessionExpired)?;
        let client = self.client_for(&device)?;
        Ok((device, client, auth))
    }

    /// Phản hồi của `POST`: 202 thì lấy `opId`; còn lại ánh xạ lỗi (và bỏ token khi phiên hết hạn).
    async fn accepted(
        &self,
        id: &str,
        client: &PinnedClient,
        resp: reqwest::Response,
    ) -> Result<String, DeviceError> {
        let status = resp.status().as_u16();
        let body = read_body(resp, MAX_ERROR_BODY, Some(&client.verifier)).await?;
        if status == 202 {
            return serde_json::from_slice::<Value>(&body)
                .ok()
                .and_then(|v| v.get("opId").and_then(Value::as_str).map(str::to_string))
                .filter(|op| is_uuid(op))
                .ok_or(DeviceError::BadResponse);
        }
        let (error, drop_token) = failure(status, &body);
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }

    /// Nạp xuống (contract §8). `package` là byte của gói đã kiểm, `digest` là digest của nó.
    pub async fn deploy(
        &self,
        id: &str,
        package: Arc<Vec<u8>>,
        digest: &str,
        base_digest: &str,
        on_event: Sink,
    ) -> Result<Value, DeviceError> {
        if !valid_digest(digest) || !valid_base(base_digest) {
            // Thiết bị cũng trả 400; không gửi chuỗi sai dạng (và không để chúng vào header).
            return Err(DeviceError::Http(400));
        }
        let (device, client, auth) = self.transfer_target(id)?;
        let url = device_url(
            "https",
            &device.host,
            device.https_port,
            "/api/v1/project/deployments",
            None,
        )?;
        let total = package.len() as u64;
        let resp = client
            .client
            .post(url)
            .timeout(TRANSFER_TIMEOUT)
            .header(AUTHORIZATION, auth)
            .header(CONTENT_TYPE, "application/zip")
            .header(CONTENT_LENGTH, total)
            .header("X-Mat-Digest", digest)
            .header("X-Mat-Base-Digest", base_digest)
            .body(progress_body(package, on_event.clone()))
            .send()
            .await
            .map_err(|e| super::http::classify(&e, Some(&client.verifier)))?;
        let op_id = self.accepted(id, &client, resp).await?;
        self.follow(&device, &op_id, &on_event).await
    }

    /// Khôi phục bản `seq` trong kho của thiết bị (contract §8).
    pub async fn restore(
        &self,
        id: &str,
        seq: u32,
        base_digest: &str,
        on_event: Sink,
    ) -> Result<Value, DeviceError> {
        if !valid_base(base_digest) {
            return Err(DeviceError::Http(400));
        }
        let (device, client, auth) = self.transfer_target(id)?;
        let url = device_url(
            "https",
            &device.host,
            device.https_port,
            "/api/v1/project/restore",
            None,
        )?;
        let body = serde_json::to_vec(&json!({ "seq": seq, "baseDigest": base_digest }))
            .map_err(|_| DeviceError::BadResponse)?;
        let resp = client
            .client
            .post(url)
            .header(AUTHORIZATION, auth)
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| super::http::classify(&e, Some(&client.verifier)))?;
        let op_id = self.accepted(id, &client, resp).await?;
        self.follow(&device, &op_id, &on_event).await
    }

    /// Hỏi `GET /api/v1/project/deployments/{opId}` mỗi nhịp tới khi thao tác kết thúc. Kết nối bị từ
    /// chối (thiết bị chạy lại) thì thử lại tới `lost`.
    async fn follow(
        &self,
        device: &KnownDevice,
        op_id: &str,
        on_event: &Sink,
    ) -> Result<Value, DeviceError> {
        let path = format!("/api/v1/project/deployments/{op_id}");
        let timings = self.deploy_timings;
        let mut last: Option<Value> = None;
        let mut down_since: Option<Instant> = None;
        loop {
            let outage = match self.send_get(device, &path, None, true).await {
                Ok((200, body)) => {
                    let op: Value = serde_json::from_slice(&body)
                        .ok()
                        .filter(Value::is_object)
                        .ok_or(DeviceError::BadResponse)?;
                    down_since = None;
                    if last.as_ref() != Some(&op) {
                        on_event(DeployEvent::Operation { op: op.clone() });
                        last = Some(op.clone());
                    }
                    match op.get("result").and_then(Value::as_str) {
                        Some("running") => false,
                        Some(_) => return Ok(op),
                        None => return Err(DeviceError::BadResponse),
                    }
                }
                Ok((status, _)) if status >= 500 => true,
                Ok((status, body)) => {
                    let (error, drop_token) = failure(status, &body);
                    if drop_token {
                        self.sessions.remove(&device.id);
                    }
                    return Err(error);
                }
                Err(DeviceError::Unreachable | DeviceError::Timeout | DeviceError::BadResponse) => {
                    true
                }
                Err(e) => return Err(e),
            };
            if outage {
                let since = *down_since.get_or_insert_with(|| {
                    on_event(DeployEvent::Restarting);
                    Instant::now()
                });
                if since.elapsed() >= timings.lost {
                    return Err(DeviceError::Lost);
                }
            }
            tokio::time::sleep(timings.poll).await;
        }
    }

    /// Đọc lên (`GET /api/v1/project/package`, thiếu `seq` thì bản đang chạy): kiểm gói đúng luật như
    /// thiết bị, digest phải bằng `X-Mat-Digest`. Trả byte của gói và kết quả kiểm.
    pub async fn fetch_package(
        &self,
        id: &str,
        seq: Option<u32>,
    ) -> Result<(Vec<u8>, Checked), DeviceError> {
        let (device, client, auth) = self.transfer_target(id)?;
        let mut query = BTreeMap::new();
        if let Some(seq) = seq {
            query.insert("seq".to_string(), seq.to_string());
        }
        let url = device_url(
            "https",
            &device.host,
            device.https_port,
            "/api/v1/project/package",
            Some(&query),
        )?;
        let resp = client
            .client
            .get(url)
            .timeout(TRANSFER_TIMEOUT)
            .header(AUTHORIZATION, auth)
            .send()
            .await
            .map_err(|e| super::http::classify(&e, Some(&client.verifier)))?;
        let status = resp.status().as_u16();
        let digest = resp
            .headers()
            .get("x-mat-digest")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        if status != 200 {
            let body = read_body(resp, MAX_ERROR_BODY, Some(&client.verifier)).await?;
            let (error, drop_token) = failure(status, &body);
            if drop_token {
                self.sessions.remove(id);
            }
            return Err(error);
        }
        let bytes = read_body(resp, MAX_PACKAGE, Some(&client.verifier)).await?;
        let digest = digest
            .filter(|d| valid_digest(d))
            .ok_or(DeviceError::BadResponse)?;
        tauri::async_runtime::spawn_blocking(move || {
            check_package(&bytes, Some(&digest)).map(|checked| (bytes, checked))
        })
        .await
        .map_err(|_| DeviceError::BadResponse)?
        .map_err(package_error)
    }
}

/// Đọc lên rồi cất vào kho gói tạm; giao diện chỉ nhận `PackageInfo` (không có đường dẫn).
pub async fn fetch_and_store(
    devices: &DeviceManager,
    store: &PackageStore,
    id: &str,
    seq: Option<u32>,
) -> Result<PackageInfo, DeviceError> {
    let (bytes, checked) = devices.fetch_package(id, seq).await?;
    store
        .put(
            &bytes,
            checked.manifest,
            Origin::Fetched,
            Some(id.to_string()),
            seq,
        )
        .map_err(DeviceError::Io)
}

/// Nạp xuống gói tạm `package_id` (đóng từ project hoặc đọc lên).
pub async fn deploy_stored(
    devices: &DeviceManager,
    store: &PackageStore,
    id: &str,
    package_id: &str,
    base_digest: &str,
    on_event: Sink,
) -> Result<Value, DeviceError> {
    let (bytes, digest) = store.get(package_id).ok_or(DeviceError::NoSuchPackage)?;
    devices
        .deploy(id, Arc::new(bytes), &digest, base_digest, on_event)
        .await
}

fn sink_of(channel: Channel<DeployEvent>) -> Sink {
    // Giao diện đã đóng (cửa sổ đóng): không còn ai nhận, bỏ qua.
    Arc::new(move |e| {
        let _ = channel.send(e);
    })
}

/// `device_deploy({ id, packageId, baseDigest, onEvent }) → DeployOperation`
#[tauri::command]
pub async fn device_deploy(
    id: String,
    package_id: String,
    base_digest: String,
    on_event: Channel<DeployEvent>,
    devices: State<'_, DeviceManager>,
    packages: State<'_, PackageStore>,
) -> Result<Value, DeviceError> {
    deploy_stored(
        &devices,
        &packages,
        &id,
        &package_id,
        &base_digest,
        sink_of(on_event),
    )
    .await
}

/// `device_restore({ id, seq, baseDigest, onEvent }) → DeployOperation`
#[tauri::command]
pub async fn device_restore(
    id: String,
    seq: u32,
    base_digest: String,
    on_event: Channel<DeployEvent>,
    devices: State<'_, DeviceManager>,
) -> Result<Value, DeviceError> {
    devices
        .restore(&id, seq, &base_digest, sink_of(on_event))
        .await
}

/// `device_fetch_package({ id, seq? }) → PackageInfo`
#[tauri::command]
pub async fn device_fetch_package(
    id: String,
    seq: Option<u32>,
    devices: State<'_, DeviceManager>,
    packages: State<'_, PackageStore>,
) -> Result<PackageInfo, DeviceError> {
    fetch_and_store(&devices, &packages, &id, seq).await
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::test_support::{
        Online, Req, Resp, TLS_ALL, TestCert, fake_device, http_server_at, online_with,
    };
    use crate::package::{BuildMeta, build_package};
    use serde_json::json;
    use std::path::Path;
    use std::sync::Mutex;
    use std::time::Instant;

    const OP: &str = "0b2f1d6c-8a10-4c3a-9e57-4f9c2a8e6d1b";
    const BASE: &str = "sha256:0000000000000000000000000000000000000000000000000000000000000001";

    /// Gói thật đóng từ `projects/tank-demo`: byte và digest.
    fn package() -> (Arc<Vec<u8>>, String) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../projects/tank-demo");
        let mut files = Vec::new();
        for rel in [
            "logging.json",
            "project.json",
            "screens/tank-motor.bindings.json",
            "screens/tank-motor.screen.json",
            "screens/tank-motor.svg",
            "tags.json",
        ] {
            files.push((rel.to_string(), std::fs::read(root.join(rel)).unwrap()));
        }
        let built = build_package(
            &files,
            &BuildMeta {
                created_at: "2026-10-12T00:00:00Z",
                generator_version: "0.2.0",
            },
        )
        .unwrap();
        (Arc::new(built.bytes), built.manifest.digest)
    }

    type Events = Arc<Mutex<Vec<DeployEvent>>>;

    fn events() -> (Events, Arc<dyn Fn(DeployEvent) + Send + Sync>) {
        let log: Events = Arc::new(Mutex::new(Vec::new()));
        let sink = log.clone();
        (log, Arc::new(move |e| sink.lock().unwrap().push(e)))
    }

    fn step(id: &str, state: &str) -> Value {
        json!({ "id": id, "state": state })
    }

    /// Thao tác ở các giai đoạn: `n` bước đầu xong, bước kế đang chạy.
    fn op_at(ok: usize, result: &str) -> Value {
        const IDS: [&str; 6] = [
            "receive",
            "verify-package",
            "validate",
            "backup",
            "activate",
            "health",
        ];
        let steps: Vec<Value> = IDS
            .iter()
            .enumerate()
            .map(|(i, id)| {
                let state = if i < ok {
                    "ok"
                } else if i == ok && result == "running" {
                    "running"
                } else {
                    "pending"
                };
                step(id, state)
            })
            .collect();
        json!({
            "opId": OP, "kind": "deploy", "user": "kysu1", "source": "127.0.0.1",
            "startedAt": "2026-10-12T03:11:52Z", "result": result, "steps": steps,
            "from": null, "to": { "digest": BASE, "projectId": "tank-demo", "projectVersion": "1.3.0" },
            "error": null, "clientsNotified": 0
        })
    }

    /// Kịch bản của thiết bị giả: POST nhận bất kỳ phản hồi nào, GET tiến trình trả lần lượt các ảnh
    /// chụp (ảnh cuối lặp lại).
    struct Script {
        post: Option<Resp>,
        snapshots: Vec<Value>,
        polls: usize,
        /// Các lần hỏi (chỉ số) mà thiết bị đang chạy lại và trả 503.
        outage: std::ops::Range<usize>,
    }

    fn script(post: Resp, snapshots: Vec<Value>) -> Arc<Mutex<Script>> {
        Arc::new(Mutex::new(Script {
            post: Some(post),
            snapshots,
            polls: 0,
            outage: 0..0,
        }))
    }

    fn accepted() -> Resp {
        Resp::json(
            202,
            json!({ "opId": OP, "status": format!("/api/v1/project/deployments/{OP}") }),
        )
    }

    fn handler(state: Arc<Mutex<Script>>) -> impl Fn(&Req) -> Option<Resp> + Send + Sync + 'static {
        move |req| {
            let mut s = state.lock().unwrap();
            match (req.method.as_str(), req.path()) {
                ("POST", "/api/v1/project/deployments" | "/api/v1/project/restore") => {
                    let r = s.post.take().unwrap_or_else(|| Resp::error(500, "TWICE"));
                    Some(r)
                }
                ("GET", p) if p == format!("/api/v1/project/deployments/{OP}") => {
                    let at = s.polls;
                    s.polls += 1;
                    if s.outage.contains(&at) {
                        return Some(Resp::error(503, "STARTING"));
                    }
                    let i = at.min(s.snapshots.len() - 1);
                    Some(Resp::json(200, s.snapshots[i].clone()))
                }
                _ => None,
            }
        }
    }

    fn polls(s: &Arc<Mutex<Script>>) -> usize {
        s.lock().unwrap().polls
    }

    /// Đợi tới khi thiết bị giả đã nhận `n` lần hỏi tiến trình (tối đa 5 s: không treo test).
    async fn wait_polls(s: &Arc<Mutex<Script>>, n: usize) {
        let until = Instant::now() + Duration::from_secs(5);
        while polls(s) < n {
            assert!(Instant::now() < until, "chưa thấy {n} lần hỏi tiến trình");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    async fn deploy_with(on: &Online) -> (Result<Value, DeviceError>, Events, usize, String) {
        let (pkg, digest) = package();
        let (log, sink) = events();
        let r = on
            .manager
            .deploy(&on.id, pkg.clone(), &digest, BASE, sink)
            .await;
        (r, log, pkg.len(), digest)
    }

    // ---- T116: nạp xuống ----

    #[test]
    fn default_timings_follow_the_contract() {
        let t = DeployTimings::default();
        assert_eq!(t.poll, Duration::from_millis(500));
        assert_eq!(t.lost, Duration::from_secs(60));
    }

    #[tokio::test]
    async fn deploy_sends_the_package_with_its_headers_and_follows_the_operation() {
        let s = script(
            accepted(),
            vec![
                op_at(0, "running"),
                op_at(1, "running"),
                op_at(1, "running"), // trùng: không thành sự kiện mới
                op_at(5, "running"),
                op_at(6, "committed"),
            ],
        );
        let on = online_with("deploy-ok", handler(s.clone())).await;
        on.login().await;
        let (result, log, len, digest) = deploy_with(&on).await;
        let op = result.expect("nạp xuống xong");
        assert_eq!(op["result"], "committed");
        assert_eq!(polls(&s), 5);

        let reqs = on.server.requests();
        let post = reqs
            .iter()
            .find(|r| r.method == "POST" && r.path() == "/api/v1/project/deployments")
            .expect("có POST");
        assert_eq!(post.header("content-type"), Some("application/zip"));
        assert_eq!(
            post.header("content-length"),
            Some(len.to_string().as_str())
        );
        assert_eq!(post.header("x-mat-digest"), Some(digest.as_str()));
        assert_eq!(post.header("x-mat-base-digest"), Some(BASE));
        assert!(
            post.header("transfer-encoding").is_none(),
            "không gửi chunked"
        );
        let token = on.device_token().unwrap();
        assert_eq!(post.bearer(), Some(token.as_str()));
        assert_eq!(post.body.len(), len, "đủ thân");
        assert_eq!(post.body, *package().0, "đúng byte của gói");

        let log = log.lock().unwrap();
        let sent: Vec<(u64, u64)> = log
            .iter()
            .filter_map(|e| match e {
                DeployEvent::Send { sent, total } => Some((*sent, *total)),
                _ => None,
            })
            .collect();
        assert!(!sent.is_empty(), "có sự kiện send");
        assert!(
            sent.windows(2).all(|w| w[0].0 <= w[1].0),
            "send tăng dần: {sent:?}"
        );
        assert!(sent.iter().all(|(_, t)| *t == len as u64));
        assert_eq!(
            *sent.last().unwrap(),
            (len as u64, len as u64),
            "send cuối = đủ"
        );
        let ops: Vec<&Value> = log
            .iter()
            .filter_map(|e| match e {
                DeployEvent::Operation { op } => Some(op),
                _ => None,
            })
            .collect();
        assert_eq!(ops.len(), 4, "mỗi khi trạng thái đổi, không lặp: {ops:?}");
        assert_eq!(ops.last().unwrap()["result"], "committed");
        assert!(!log.iter().any(|e| matches!(e, DeployEvent::Restarting)));
        // Thứ tự: send xong rồi mới có operation.
        let first_op = log
            .iter()
            .position(|e| matches!(e, DeployEvent::Operation { .. }))
            .unwrap();
        assert!(
            log[..first_op]
                .iter()
                .all(|e| matches!(e, DeployEvent::Send { .. }))
        );
    }

    #[tokio::test]
    async fn deploy_returns_failed_and_rolled_back_operations_as_results() {
        for result in ["failed", "rolled-back", "interrupted"] {
            let s = script(accepted(), vec![op_at(2, result)]);
            let on = online_with("deploy-result", handler(s)).await;
            on.login().await;
            let (r, _, _, _) = deploy_with(&on).await;
            assert_eq!(r.unwrap()["result"], result);
        }
    }

    #[tokio::test]
    async fn deploy_retries_while_the_device_restarts_and_reports_it_once() {
        // Hai lần hỏi đầu: đang chạy; bốn lần sau thiết bị chạy lại (không trả lời đúng); rồi xong.
        // Trên Windows kết nối bị từ chối mất cả giây nên outage dựng bằng 503; kết nối hỏng thật được
        // thử ở test `lost`.
        let s = script(
            accepted(),
            vec![
                op_at(0, "running"),
                op_at(4, "running"),
                op_at(6, "committed"),
            ],
        );
        s.lock().unwrap().outage = 2..6;
        let on = online_with("deploy-restart", handler(s.clone())).await;
        on.login().await;
        let (result, log, _, _) = deploy_with(&on).await;
        assert_eq!(result.unwrap()["result"], "committed");
        assert_eq!(polls(&s), 7, "hai + bốn lần thử lại + một lần xong");
        let log = log.lock().unwrap();
        let restarting = log
            .iter()
            .filter(|e| matches!(e, DeployEvent::Restarting))
            .count();
        assert_eq!(restarting, 1, "một lần mất kết nối, một sự kiện");
        // `restarting` đứng giữa hai trạng thái: sau bản "đang kích hoạt", trước bản "xong".
        let at = log
            .iter()
            .position(|e| matches!(e, DeployEvent::Restarting))
            .unwrap();
        assert!(matches!(&log[at - 1], DeployEvent::Operation { op } if op["result"] == "running"));
        assert!(matches!(
            log.last(),
            Some(DeployEvent::Operation { op }) if op["result"] == "committed"
        ));
    }

    #[tokio::test]
    async fn deploy_does_not_retry_forever_on_server_errors() {
        // 503 mãi mãi: vượt hạn `lost` thì bỏ cuộc.
        let s = script(accepted(), vec![op_at(4, "running")]);
        s.lock().unwrap().outage = 1..usize::MAX;
        let on = online_with("deploy-503", handler(s)).await;
        on.login().await;
        let (result, log, _, _) = deploy_with(&on).await;
        assert_eq!(result, Err(DeviceError::Lost));
        assert_eq!(
            log.lock()
                .unwrap()
                .iter()
                .filter(|e| matches!(e, DeployEvent::Restarting))
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn deploy_gives_up_with_lost_when_the_device_never_comes_back() {
        let s = script(accepted(), vec![op_at(4, "running")]);
        let on = online_with("deploy-lost", handler(s.clone())).await;
        on.login().await;
        let Online {
            manager,
            server,
            id,
            state: _state,
            dir: _dir,
            cert: _cert,
        } = on;
        let (pkg, digest) = package();
        let (log, sink) = events();
        let s2 = s.clone();
        let kill = async move {
            wait_polls(&s2, 1).await;
            drop(server);
        };
        let started = Instant::now();
        let (result, ()) = tokio::join!(manager.deploy(&id, pkg, &digest, BASE, sink), kill);
        assert_eq!(result, Err(DeviceError::Lost));
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "chờ quá hạn lost"
        );
        assert!(
            log.lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, DeployEvent::Restarting))
        );
        // Token còn đó: thao tác có thể đã xong, giao diện hỏi lại bằng device_get.
        assert!(manager.sessions().info(&id).is_some());
    }

    #[tokio::test]
    async fn deploy_maps_the_refusals_of_the_device() {
        let busy = json!({
            "error": "DEVICE_BUSY", "message": "bận",
            "opId": OP, "kind": "deploy", "user": "kysu2", "source": "10.0.0.7",
            "since": "2026-10-12T03:00:00Z"
        });
        let cases: Vec<(Resp, DeviceError)> = vec![
            (
                Resp::json(409, busy),
                DeviceError::Busy(
                    json!({
                        "opId": OP, "kind": "deploy", "user": "kysu2", "source": "10.0.0.7",
                        "since": "2026-10-12T03:00:00Z"
                    })
                    .as_object()
                    .unwrap()
                    .clone(),
                ),
            ),
            (Resp::error(409, "BASE_CHANGED"), DeviceError::BaseChanged),
            (
                Resp::error(409, "NO_BASE_PROJECT"),
                DeviceError::NoBaseProject,
            ),
            (Resp::error(507, "NO_SPACE"), DeviceError::NoSpace),
            (Resp::error(413, "PACKAGE_TOO_LARGE"), DeviceError::TooLarge),
            (
                Resp::error(503, "AUDIT_UNAVAILABLE"),
                DeviceError::AuditUnavailable,
            ),
            (
                Resp::error(401, "SESSION_EXPIRED"),
                DeviceError::SessionExpired,
            ),
            (
                Resp::error(401, "SESSION_INVALID"),
                DeviceError::SessionInvalid,
            ),
            (Resp::error(403, "FORBIDDEN"), DeviceError::Forbidden),
            (
                Resp::error(415, "UNSUPPORTED_MEDIA_TYPE"),
                DeviceError::Http(415),
            ),
            (Resp::raw(202, "không phải JSON"), DeviceError::BadResponse),
        ];
        for (resp, expected) in cases {
            let s = script(resp, vec![op_at(0, "running")]);
            let on = online_with("deploy-refused", handler(s.clone())).await;
            on.login().await;
            let (r, log, _, _) = deploy_with(&on).await;
            assert_eq!(r, Err(expected.clone()), "{expected:?}");
            assert_eq!(polls(&s), 0, "không theo dõi khi bị từ chối");
            assert!(
                !log.lock()
                    .unwrap()
                    .iter()
                    .any(|e| matches!(e, DeployEvent::Operation { .. }))
            );
            // 401 `SESSION_*` bỏ token phía Rust; mã khác giữ.
            let kept = on.manager.sessions().info(&on.id).is_some();
            assert_eq!(
                kept,
                !matches!(
                    expected,
                    DeviceError::SessionExpired | DeviceError::SessionInvalid
                ),
                "{expected:?}"
            );
        }
    }

    #[tokio::test]
    async fn deploy_without_a_session_does_not_send_anything() {
        let s = script(accepted(), vec![op_at(6, "committed")]);
        let on = online_with("deploy-nosession", handler(s)).await;
        let (r, _, _, _) = deploy_with(&on).await;
        assert_eq!(r, Err(DeviceError::SessionExpired));
        assert!(
            on.server
                .requests()
                .iter()
                .all(|r| r.path() != "/api/v1/project/deployments"),
            "không POST"
        );
    }

    #[tokio::test]
    async fn deploy_rejects_a_bad_base_digest_before_sending() {
        let s = script(accepted(), vec![op_at(6, "committed")]);
        let on = online_with("deploy-badbase", handler(s)).await;
        on.login().await;
        let (pkg, digest) = package();
        let (_, sink) = events();
        for bad in ["", "sha256:abc", "none\r\nX: 1", "SHA256:00"] {
            let r = on
                .manager
                .deploy(&on.id, pkg.clone(), &digest, bad, sink.clone())
                .await;
            assert_eq!(r, Err(DeviceError::Http(400)), "{bad:?}");
        }
        // `none` là hợp lệ (thiết bị chưa có project trong kho).
        let r = on.manager.deploy(&on.id, pkg, &digest, "none", sink).await;
        assert_eq!(r.unwrap()["result"], "committed");
    }

    #[tokio::test]
    async fn deploy_reports_a_changed_certificate_and_an_unreachable_device() {
        // Chứng chỉ đổi sau khi ghim.
        let s = script(accepted(), vec![op_at(6, "committed")]);
        let on = online_with("deploy-cert", handler(s.clone())).await;
        on.login().await;
        let Online {
            manager,
            server,
            id,
            state,
            dir: _dir,
            cert: _cert,
        } = on;
        let port = server.port;
        drop(server);
        let other = TestCert::new();
        let h = handler(s.clone());
        let fake = fake_device(state);
        let server = http_server_at(Some(port), Some(other.server_config(TLS_ALL)), move |r| {
            h(r).unwrap_or_else(|| fake(r))
        })
        .await;
        let (pkg, digest) = package();
        let (_, sink) = events();
        let r = manager
            .deploy(&id, pkg.clone(), &digest, BASE, sink.clone())
            .await;
        match r {
            Err(DeviceError::CertMismatch { seen, .. }) => assert_eq!(seen, other.fingerprint),
            other => panic!("mong đợi cert-mismatch, nhận {other:?}"),
        }
        // Thiết bị tắt hẳn.
        drop(server);
        let r = manager.deploy(&id, pkg, &digest, BASE, sink).await;
        assert_eq!(r, Err(DeviceError::Unreachable));
    }

    // ---- T116: khôi phục ----

    #[tokio::test]
    async fn restore_posts_the_version_and_the_base_and_follows_the_operation() {
        let s = script(accepted(), vec![op_at(2, "running"), op_at(6, "committed")]);
        let on = online_with("restore-ok", handler(s)).await;
        on.login().await;
        let (log, sink) = events();
        let op = on.manager.restore(&on.id, 6, BASE, sink).await.unwrap();
        assert_eq!(op["result"], "committed");
        let reqs = on.server.requests();
        let post = reqs
            .iter()
            .find(|r| r.path() == "/api/v1/project/restore")
            .expect("có POST restore");
        assert_eq!(post.method, "POST");
        assert_eq!(post.header("content-type"), Some("application/json"));
        let body: Value = serde_json::from_slice(&post.body).unwrap();
        assert_eq!(body, json!({ "seq": 6, "baseDigest": BASE }));
        assert_eq!(post.bearer(), on.device_token().as_deref());
        let log = log.lock().unwrap();
        assert!(
            !log.iter().any(|e| matches!(e, DeployEvent::Send { .. })),
            "khôi phục không gửi gói"
        );
        assert_eq!(
            log.iter()
                .filter(|e| matches!(e, DeployEvent::Operation { .. }))
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn restore_adds_no_such_version_and_already_active() {
        let cases = [
            (
                Resp::error(404, "NO_SUCH_VERSION"),
                DeviceError::NoSuchVersion,
            ),
            (
                Resp::error(409, "ALREADY_ACTIVE"),
                DeviceError::AlreadyActive,
            ),
            (Resp::error(409, "BASE_CHANGED"), DeviceError::BaseChanged),
            (Resp::error(403, "FORBIDDEN"), DeviceError::Forbidden),
        ];
        for (resp, expected) in cases {
            let s = script(resp, vec![op_at(0, "running")]);
            let on = online_with("restore-refused", handler(s)).await;
            on.login().await;
            let (_, sink) = events();
            let r = on.manager.restore(&on.id, 6, BASE, sink).await;
            assert_eq!(r, Err(expected));
        }
    }

    // ---- T116: đọc lên ----

    fn fetch_server(
        resp: impl Fn(&Req) -> Resp + Send + Sync + 'static,
    ) -> impl Fn(&Req) -> Option<Resp> + Send + Sync + 'static {
        move |req| (req.path() == "/api/v1/project/package").then(|| resp(req))
    }

    fn package_resp(bytes: &[u8], digest: &str) -> Resp {
        let mut r = Resp {
            status: 200,
            headers: vec![
                ("Content-Type".into(), "application/zip".into()),
                ("X-Mat-Digest".into(), digest.into()),
            ],
            body: bytes.to_vec(),
        };
        r.headers.push(("ETag".into(), format!("\"{digest}\"")));
        r
    }

    #[tokio::test]
    async fn fetch_checks_the_package_like_the_device_and_returns_its_bytes() {
        let (pkg, digest) = package();
        let bytes = pkg.to_vec();
        let d = digest.clone();
        let on = online_with("fetch-ok", fetch_server(move |_| package_resp(&bytes, &d))).await;
        on.login().await;
        let (got, checked) = on.manager.fetch_package(&on.id, Some(6)).await.unwrap();
        assert_eq!(got, *pkg);
        assert_eq!(checked.manifest.digest, digest);
        let reqs = on.server.requests();
        let get = reqs
            .iter()
            .find(|r| r.path() == "/api/v1/project/package")
            .unwrap();
        assert_eq!(get.query(), Some("seq=6"));
        assert_eq!(get.bearer(), on.device_token().as_deref());
        // Thiếu `seq`: lấy bản đang chạy, không có query.
        let _ = on.manager.fetch_package(&on.id, None).await.unwrap();
        let reqs = on.server.requests();
        let last = reqs
            .iter()
            .rfind(|r| r.path() == "/api/v1/project/package")
            .unwrap();
        assert_eq!(last.query(), None);
    }

    #[tokio::test]
    async fn fetch_rejects_a_package_with_another_digest_or_broken() {
        let (pkg, digest) = package();
        let other = format!("sha256:{}", "11".repeat(32));

        // Digest của header khác digest của gói.
        let bytes = pkg.to_vec();
        let o = other.clone();
        let on = online_with(
            "fetch-digest",
            fetch_server(move |_| package_resp(&bytes, &o)),
        )
        .await;
        on.login().await;
        assert_eq!(
            on.manager.fetch_package(&on.id, None).await.unwrap_err(),
            DeviceError::Package("E_PKG_DIGEST".into())
        );

        // Thiếu header `X-Mat-Digest`.
        let bytes = pkg.to_vec();
        let on = online_with(
            "fetch-nodigest",
            fetch_server(move |_| Resp {
                status: 200,
                headers: vec![],
                body: bytes.clone(),
            }),
        )
        .await;
        on.login().await;
        assert_eq!(
            on.manager.fetch_package(&on.id, None).await.unwrap_err(),
            DeviceError::BadResponse
        );

        // Gói hỏng, có đường dẫn: vector `content-sha256` của bộ chung.
        let broken = std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/package-vectors/content-sha256/package.matscada"),
        )
        .unwrap();
        let d = digest.clone();
        let on = online_with(
            "fetch-broken",
            fetch_server(move |_| package_resp(&broken, &d)),
        )
        .await;
        on.login().await;
        assert_eq!(
            on.manager.fetch_package(&on.id, None).await.unwrap_err(),
            DeviceError::PackageAt {
                code: "E_PKG_CHECKSUM".into(),
                path: "tags.json".into()
            }
        );

        // Gói cắt cụt: lỗi của cả gói, không có đường dẫn.
        let cut = pkg[..pkg.len() / 2].to_vec();
        let d = digest;
        let on = online_with("fetch-cut", fetch_server(move |_| package_resp(&cut, &d))).await;
        on.login().await;
        assert_eq!(
            on.manager.fetch_package(&on.id, None).await.unwrap_err(),
            DeviceError::Package("E_PKG_FORMAT".into())
        );
    }

    #[tokio::test]
    async fn fetch_maps_the_refusals_of_the_device() {
        let cases = [
            (
                Resp::error(404, "NO_PROJECT_PACKAGE"),
                DeviceError::NoProjectPackage,
            ),
            (
                Resp::error(404, "NO_SUCH_VERSION"),
                DeviceError::NoSuchVersion,
            ),
            (Resp::error(403, "FORBIDDEN"), DeviceError::Forbidden),
            (
                Resp::error(401, "SESSION_EXPIRED"),
                DeviceError::SessionExpired,
            ),
            (
                Resp::error(503, "AUDIT_UNAVAILABLE"),
                DeviceError::AuditUnavailable,
            ),
            (Resp::error(500, "INTERNAL"), DeviceError::Http(500)),
        ];
        for (resp, expected) in cases {
            let status = resp.status;
            let body = resp.body.clone();
            let on = online_with(
                "fetch-refused",
                fetch_server(move |_| Resp {
                    status,
                    headers: vec![("Content-Type".into(), "application/json".into())],
                    body: body.clone(),
                }),
            )
            .await;
            on.login().await;
            assert_eq!(
                on.manager.fetch_package(&on.id, None).await.unwrap_err(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn fetch_without_a_session_or_with_an_unreachable_device() {
        let (pkg, digest) = package();
        let bytes = pkg.to_vec();
        let on = online_with(
            "fetch-nosession",
            fetch_server(move |_| package_resp(&bytes, &digest)),
        )
        .await;
        assert_eq!(
            on.manager.fetch_package(&on.id, None).await.unwrap_err(),
            DeviceError::SessionExpired
        );
        on.login().await;
        let Online {
            manager,
            server,
            id,
            ..
        } = on;
        drop(server);
        assert_eq!(
            manager.fetch_package(&id, None).await.unwrap_err(),
            DeviceError::Unreachable
        );
    }

    // ---- Lệnh: gói tạm và lỗi ra giao diện ----

    #[tokio::test]
    async fn the_commands_keep_fetched_packages_in_the_store_and_deploy_by_package_id() {
        use crate::package::PackageStore;
        let (pkg, digest) = package();
        let bytes = pkg.to_vec();
        let d = digest.clone();
        let s = script(accepted(), vec![op_at(6, "committed")]);
        let h = handler(s);
        let fetch = fetch_server(move |_| package_resp(&bytes, &d));
        let on = online_with("cmd", move |r| h(r).or_else(|| fetch(r))).await;
        on.login().await;
        let store = PackageStore::new(on.dir.file("packages"));

        let info = fetch_and_store(&on.manager, &store, &on.id, Some(6))
            .await
            .unwrap();
        assert_eq!(info.digest, digest);
        assert_eq!(info.origin, crate::package::Origin::Fetched);
        assert_eq!(info.device_id.as_deref(), Some(on.id.as_str()));
        assert_eq!(info.seq, Some(6));
        assert_eq!(store.bytes(&info.package_id).unwrap(), *pkg);

        let (_, sink) = events();
        let op = deploy_stored(
            &on.manager,
            &store,
            &on.id,
            &info.package_id,
            BASE,
            sink.clone(),
        )
        .await
        .unwrap();
        assert_eq!(op["result"], "committed");
        let reqs = on.server.requests();
        let post = reqs
            .iter()
            .find(|r| r.path() == "/api/v1/project/deployments")
            .expect("POST nạp xuống");
        assert_eq!(post.header("x-mat-digest"), Some(digest.as_str()));

        assert_eq!(
            deploy_stored(&on.manager, &store, &on.id, "khong-co", BASE, sink)
                .await
                .unwrap_err(),
            DeviceError::NoSuchPackage
        );
    }

    #[test]
    fn errors_and_events_serialize_as_the_contract_says() {
        let j = |e: DeviceError| serde_json::to_value(e).unwrap();
        assert_eq!(j(DeviceError::BaseChanged), json!("base-changed"));
        assert_eq!(j(DeviceError::NoSpace), json!("no-space"));
        assert_eq!(j(DeviceError::TooLarge), json!("too-large"));
        assert_eq!(j(DeviceError::Lost), json!("lost"));
        assert_eq!(j(DeviceError::NoSuchVersion), json!("no-such-version"));
        assert_eq!(j(DeviceError::AlreadyActive), json!("already-active"));
        assert_eq!(
            j(DeviceError::NoProjectPackage),
            json!("no-project-package")
        );
        assert_eq!(j(DeviceError::NoBaseProject), json!("no-base-project"));
        assert_eq!(j(DeviceError::NoSuchPackage), json!("no-such-package"));
        assert_eq!(
            j(DeviceError::Package("E_PKG_DIGEST".into())),
            json!({ "package": "E_PKG_DIGEST" })
        );
        assert_eq!(
            j(DeviceError::PackageAt {
                code: "E_PKG_SECRET".into(),
                path: "tags.json".into()
            }),
            json!({ "package-at": { "code": "E_PKG_SECRET", "path": "tags.json" } })
        );
        let busy =
            json!({ "opId": OP, "kind": "deploy", "user": "u", "source": "s", "since": "t" });
        assert_eq!(
            j(DeviceError::Busy(busy.as_object().unwrap().clone())),
            json!({ "busy": busy })
        );

        let e = |e: DeployEvent| serde_json::to_value(e).unwrap();
        assert_eq!(
            e(DeployEvent::Send { sent: 1, total: 2 }),
            json!({ "kind": "send", "sent": 1, "total": 2 })
        );
        assert_eq!(
            e(DeployEvent::Operation {
                op: json!({ "result": "running" })
            }),
            json!({ "kind": "operation", "op": { "result": "running" } })
        );
        assert_eq!(e(DeployEvent::Restarting), json!({ "kind": "restarting" }));
    }
}
