//! Studio ↔ thiết bị: danh sách thiết bị, TLS ghim fingerprint, HTTP, phiên đăng nhập, dữ liệu sống
//! (feature 005, research R6, contracts/tauri-commands.md §3–7).
//!
//! Giao diện chỉ gọi thiết bị theo `id` của thiết bị đã lưu; riêng chế độ theo dõi chỉ đọc (như 004)
//! gọi theo địa chỉ và chỉ được `GET /api/v1/system/info` và `/api/v1/live`. Token phiên và mật khẩu
//! không bao giờ quay lại giao diện.
//!
//! Nạp xuống, khôi phục, đọc lên gói (feature 005, US2): `deploy.rs`, chỉ có sau Checkpoint "Mốc bảo mật"
//! (Constitution V: HTTPS có ghim, đăng nhập, role, audit đã có ở thiết bị).

pub mod deploy;
pub mod http;
pub mod live;
pub mod logic;
pub mod registry;
pub mod session;
pub mod tls;

#[cfg(test)]
pub(crate) mod test_support;

use crate::recent::now_utc;
use http::{ApiResult, HttpTimeouts, PinnedClient, device_url};
use live::{LiveEndpoint, LiveError, LiveEvent, LiveHub, LiveOpened, LiveTarget};
use registry::{
    DevicePatch, FromDiscovery, KnownDevice, NewDevice, Pin, Registry, RegistryError, is_uuid,
};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use serde::Serialize;
use serde_json::Value;
use session::{SessionInfo, Sessions};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tauri::State;
use tauri::ipc::Channel;
use tls::{TlsFailure, TlsTimeouts};
// `Bytes` của chính crate `bytes` mà reqwest dùng (tungstenite tái xuất), để thân đăng nhập nằm
// trong bộ đệm tự xóa tới khi reqwest gửi xong, không thêm phụ thuộc trực tiếp.
use tokio_tungstenite::tungstenite::Bytes;
use zeroize::Zeroizing;

/// Giới hạn của `POST /api/v1/auth/login` (device-api §3): `user` ≤ 64 byte, `password` ≤ 512 byte.
const MAX_USER_BYTES: usize = 64;
const MAX_PASSWORD_BYTES: usize = 512;
/// Thân phản hồi đăng nhập và định danh lớn nhất.
const MAX_SMALL_BODY: usize = 64 * 1024;
/// Đăng xuất không chờ thiết bị quá lâu: token phía Rust đã bị bỏ trước khi gửi.
const LOGOUT_TIMEOUT: Duration = Duration::from_secs(3);

/// Lỗi của các lệnh thiết bị: chuỗi kebab-case, hoặc đối tượng một khóa khi có dữ liệu kèm
/// (`{ "locked": 287 }`, `{ "cert-mismatch": { "pinned", "seen" } }`), như contract §1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceError {
    NoSuchDevice,
    BadAddress,
    TooMany,
    Io(String),
    Unreachable,
    Timeout,
    NotTls,
    Tls(String),
    CertUnpinned,
    CertMismatch {
        pinned: String,
        seen: String,
    },
    NotObserved,
    PinMismatch,
    AuthFailed,
    Locked(u64),
    AuthBusy,
    AuditUnavailable,
    SetupRequired,
    BadPath,
    AuthRequired,
    SessionExpired,
    SessionInvalid,
    Forbidden,
    Http(u16),
    BadResponse,
    Network(String),
    // --- US2 (tauri-commands §8) ---
    /// 409 `DEVICE_BUSY`: `{ opId, kind, user, source, since }` của thao tác đang chạy.
    Busy(serde_json::Map<String, Value>),
    /// 409 `BASE_CHANGED`: có người vừa nạp xuống; xem trước lại.
    BaseChanged,
    /// 409 `NO_BASE_PROJECT`: project cài theo cách cũ chưa vào kho; nạp xuống sẽ làm mất nó.
    NoBaseProject,
    /// 507 `NO_SPACE`.
    NoSpace,
    /// 413 `PACKAGE_TOO_LARGE`.
    TooLarge,
    /// Không theo dõi được 60 s sau khi thiết bị chạy lại; thao tác vẫn có thể đã xong.
    Lost,
    /// 404 `NO_SUCH_VERSION`.
    NoSuchVersion,
    /// 409 `ALREADY_ACTIVE`.
    AlreadyActive,
    /// 404 `NO_PROJECT_PACKAGE`.
    NoProjectPackage,
    /// Gói không đạt luật (`E_PKG_*`) mà không có đường dẫn: `{ "package": "E_PKG_DIGEST" }`.
    Package(String),
    /// Như `Package`, kèm entry gây lỗi: `{ "package-at": { "code", "path" } }`.
    PackageAt {
        code: String,
        path: String,
    },
    /// `packageId` không còn trong kho gói tạm (đã bị đẩy ra hoặc đã xóa).
    NoSuchPackage,
    // --- Feature 006 (tauri-commands-006 §2, §4) ---
    /// 404 `NO_SUCH_REQUEST`: mã yêu cầu ghi không còn (quá 15 phút, hoặc của tài khoản khác).
    NoSuchRequest,
    /// 403 `SOURCE_NOT_ALLOWED`: trang xem chỉ phục vụ mạng riêng (lọc nguồn, ADR-018).
    ViewerPrivate,
    /// 403 `VIEWER_OFF`: trang xem đã tắt.
    ViewerOff,
    // --- Feature 011 (T145, device-api-011 §4) ---
    /// Tham số của lệnh logic sai (id khối sai dạng, giá trị không hữu hạn hoặc âm): không gửi gì.
    BadArgs,
    /// 403 `LOGIC_ENABLE_ROOT_ONLY`: bật lại ghi PLC của logic chỉ bằng runtime.json (root).
    LogicEnableRootOnly,
}

impl From<RegistryError> for DeviceError {
    fn from(e: RegistryError) -> Self {
        match e {
            RegistryError::NoSuchDevice => DeviceError::NoSuchDevice,
            RegistryError::BadAddress => DeviceError::BadAddress,
            RegistryError::TooMany => DeviceError::TooMany,
            RegistryError::Io(d) => DeviceError::Io(d),
        }
    }
}

impl From<TlsFailure> for DeviceError {
    fn from(e: TlsFailure) -> Self {
        match e {
            TlsFailure::Unreachable => DeviceError::Unreachable,
            TlsFailure::Timeout => DeviceError::Timeout,
            TlsFailure::NotTls => DeviceError::NotTls,
            TlsFailure::CertMismatch { pinned, seen } => DeviceError::CertMismatch { pinned, seen },
            TlsFailure::Tls(d) => DeviceError::Tls(d),
        }
    }
}

/// Trạng thái ghim so với chứng chỉ vừa dò.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PinState {
    Unpinned,
    Match,
    Mismatch,
}

/// Kết quả `device_probe`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProbeResult {
    pub fingerprint: String,
    pub pinned: Option<String>,
    pub state: PinState,
    /// Fingerprint của gói tìm thiết bị gần nhất (chỉ tham khảo).
    pub discovered: Option<String>,
}

/// Khóa chỉ bảo vệ dữ liệu trong bộ nhớ: bỏ qua trạng thái "poisoned".
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Cùng một đích mạng: tên máy không phân biệt hoa thường, cùng cổng HTTPS.
fn same_target(a: &KnownDevice, b: &KnownDevice) -> bool {
    a.host.eq_ignore_ascii_case(&b.host) && a.https_port == b.https_port
}

const IDENTITY_PATH: &str = "/api/v1/device/identity";

/// Định danh đọc qua kết nối đã ghim (`device/identity`, device-api §3): cập nhật `deviceId`,
/// `lastRuntime`; tên còn là tên mặc định (`host`, thiết bị thêm theo địa chỉ) thành tên thiết bị báo
/// (T085a). `device_probe` chỉ bắt tay TLS, không gửi request nào (contract §4), nên không đặt tên.
fn apply_identity(d: &mut KnownDevice, identity: &Value) {
    if let Some(id) = identity
        .get("deviceId")
        .and_then(Value::as_str)
        .filter(|s| is_uuid(s))
    {
        d.device_id = Some(id.to_string());
    }
    if let Some(runtime) = identity.get("runtimeVersion").and_then(Value::as_str) {
        d.last_runtime = Some(runtime.to_string());
    }
    if let Some(name) = identity.get("name").and_then(Value::as_str) {
        d.adopt_reported_name(name);
    }
}

/// Runtime đầu tiên có HTTPS và đăng nhập (feature 005), như `ONLINE_RUNTIME` của `device-session.ts`.
const ONLINE_RUNTIME: (u64, u64, u64) = (0, 4, 0);

/// Runtime cũ hơn 0.4.0 (T085b): so phần `MAJOR.MINOR.PATCH` như `compareSemver` của Studio, bỏ hậu tố pre-release
/// (`-…`) và build (`+…`). Chuỗi không đúng dạng ba số thì không coi là cũ (chặt hơn `compareSemver`).
fn runtime_before_online(version: &str) -> bool {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let mut parts = core.split('.').map(|p| {
        (!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            .then(|| p.parse::<u64>().ok())
            .flatten()
    });
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(Some(major)), Some(Some(minor)), Some(Some(patch)), None) => {
            (major, minor, patch) < ONLINE_RUNTIME
        }
        _ => false,
    }
}

/// Client HTTPS đã dựng cho một thiết bị và đích, ghim lúc dựng.
struct CachedClient {
    host: String,
    port: u16,
    client: Arc<PinnedClient>,
}

/// State của Tauri cho thiết bị: kho `devices.json`, phiên (token chỉ trong bộ nhớ), fingerprint của
/// lần dò gần nhất, một client HTTP mỗi thiết bị.
/// Feature 011 (FR-026, L-04 của 005): `open_device_web` chỉ mở trang `https://` của một thiết bị
/// đã lưu (đúng tên máy và cổng HTTPS đã lưu, đường dẫn `/`), không mở URL tùy ý. Trả URL dựng lại
/// từ bản ghi đã lưu.
pub fn device_web_url(url: &str, devices: &[KnownDevice]) -> Result<String, String> {
    let refuse = || format!("Chỉ mở được trang https của thiết bị đã lưu: {url}");
    if url.len() > 256
        || url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"')
    {
        return Err(refuse());
    }
    let rest = url.strip_prefix("https://").ok_or_else(refuse)?;
    // host[:port] then "/" or nothing; no user info, query, fragment or other path
    let (authority, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    if !(path.is_empty() || path == "/") || authority.contains('@') {
        return Err(refuse());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| refuse())?),
        None => (authority, 443),
    };
    let host = registry::valid_host(host).ok_or_else(refuse)?;
    devices
        .iter()
        .find(|d| d.https_port == port && d.host.eq_ignore_ascii_case(&host))
        .map(|d| format!("https://{}:{}/", d.host, d.https_port))
        .ok_or_else(refuse)
}

pub struct DeviceManager {
    registry: Registry,
    sessions: Sessions,
    /// Fingerprint thấy ở lần `device_probe` gần nhất của mỗi thiết bị (cho `device_pin`).
    observed: Mutex<HashMap<String, String>>,
    clients: Mutex<HashMap<String, CachedClient>>,
    tls_timeouts: TlsTimeouts,
    http_timeouts: HttpTimeouts,
    /// Nhịp theo dõi và hạn chờ khi nạp xuống (T117).
    deploy_timings: deploy::DeployTimings,
}

impl DeviceManager {
    /// Kho trên `file` (`devices.json` trong thư mục cấu hình), hạn mặc định.
    pub fn new(file: PathBuf) -> Self {
        Self::with_timeouts(file, TlsTimeouts::default(), HttpTimeouts::default())
    }

    pub(crate) fn with_timeouts(file: PathBuf, tls: TlsTimeouts, http: HttpTimeouts) -> Self {
        DeviceManager {
            registry: Registry::new(file),
            sessions: Sessions::default(),
            observed: Mutex::new(HashMap::new()),
            clients: Mutex::new(HashMap::new()),
            tls_timeouts: tls,
            http_timeouts: http,
            deploy_timings: deploy::DeployTimings::default(),
        }
    }

    /// Đổi nhịp theo dõi nạp xuống (test dùng nhịp ngắn).
    #[cfg(test)]
    pub(crate) fn with_deploy_timings(mut self, t: deploy::DeployTimings) -> Self {
        self.deploy_timings = t;
        self
    }

    pub fn list(&self) -> Vec<KnownDevice> {
        self.registry.list()
    }

    pub fn add(&self, input: NewDevice) -> Result<KnownDevice, DeviceError> {
        Ok(self.registry.add(input)?)
    }

    /// Đổi địa chỉ hoặc cổng HTTPS thì bỏ phiên, client và kết quả dò cũ (có thể là thiết bị khác).
    pub fn update(&self, id: &str, patch: DevicePatch) -> Result<KnownDevice, DeviceError> {
        let before = self.registry.get(id)?;
        let after = self.registry.update(id, patch)?;
        if !same_target(&before, &after) {
            self.drop_connection_state(id);
        }
        Ok(after)
    }

    pub fn forget(&self, id: &str) -> Result<(), DeviceError> {
        self.registry.forget(id)?;
        self.drop_connection_state(id);
        Ok(())
    }

    /// Bỏ phiên (token bị xóa), client và kết quả dò của thiết bị.
    fn drop_connection_state(&self, id: &str) {
        self.sessions.remove(id);
        lock(&self.observed).remove(id);
        lock(&self.clients).remove(id);
    }

    /// Dò chứng chỉ (bắt tay, lấy fingerprint, đóng ngay); ghi nhớ fingerprint cho `device_pin`.
    /// Lần dò lỗi xóa kết quả dò cũ: chỉ fingerprint của lần dò gần nhất mới ghim được. Cổng trả lời HTTP
    /// thường (`not-tls`) thì xem có phải cổng HTTP của runtime cũ không (T085b, `adopt_old_http_port`).
    pub async fn probe(
        &self,
        id: &str,
        discovered: impl FnOnce(&KnownDevice) -> Option<String>,
    ) -> Result<ProbeResult, DeviceError> {
        let device = self.registry.get(id)?;
        let discovered = discovered(&device);
        lock(&self.observed).remove(id);
        let fingerprint = match tls::probe(&device.host, device.https_port, self.tls_timeouts).await
        {
            Ok(fp) => fp,
            Err(TlsFailure::NotTls) => {
                self.adopt_old_http_port(&device).await;
                return Err(DeviceError::NotTls);
            }
            Err(e) => return Err(e.into()),
        };
        // Địa chỉ đổi trong lúc dò: kết quả thuộc đích cũ, không ghi nhớ để ghim.
        if self
            .registry
            .get(id)
            .is_ok_and(|now| same_target(&now, &device))
        {
            lock(&self.observed).insert(id.to_string(), fingerprint.clone());
        }
        let pinned = device.pin.map(|p| p.fingerprint);
        let state = match &pinned {
            None => PinState::Unpinned,
            Some(p) if *p == fingerprint => PinState::Match,
            Some(_) => PinState::Mismatch,
        };
        // Chỉ để hiển thị: không ghi được file thì vẫn trả kết quả dò.
        let _ = self
            .registry
            .modify(id, |d| d.last_seen_at = Some(now_utc()));
        Ok(ProbeResult {
            fingerprint,
            pinned,
            state,
            discovered,
        })
    }

    /// T085b: cổng HTTPS đã lưu trả lời HTTP thường. Thiết bị runtime cũ (< 0.4.0, chưa có HTTPS) thêm theo địa
    /// chỉ với cổng HTTP của nó (ví dụ port-forward :9080): hỏi `GET /api/v1/system/info` bằng HTTP trên cùng cổng
    /// (như `monitor_get`: hạn 3 s, không token, không ghim); đúng là runtime cũ thì lưu cổng đó làm `httpPort`, để
    /// luồng Online rơi về theo dõi chỉ đọc (FR-035) và trang xem dùng đúng cổng. Mọi lỗi bỏ qua: `device_probe` vẫn
    /// trả `not-tls`. `httpPort` đã bằng cổng này thì không hỏi lại.
    async fn adopt_old_http_port(&self, device: &KnownDevice) {
        if device.http_port == device.https_port {
            return;
        }
        let address = format!("{}:{}", device.host, device.https_port);
        let Ok(info) = http::monitor_get(&address, http::MONITOR_TIMEOUT).await else {
            return;
        };
        let old = info
            .body
            .get("runtimeVersion")
            .and_then(Value::as_str)
            .is_some_and(runtime_before_online);
        // Địa chỉ đổi trong lúc hỏi: kết quả thuộc đích cũ, không lưu.
        let current = self.registry.get(&device.id);
        if !old || !current.is_ok_and(|d| same_target(&d, device)) {
            return;
        }
        // Chỉ để hiển thị và chế độ theo dõi: không ghi được file thì lần dò sau thử lại.
        let _ = self.registry.modify(&device.id, |d| {
            if same_target(d, device) {
                d.http_port = device.https_port;
            }
        });
    }

    /// Ghim đúng fingerprint của lần dò gần nhất (`not-observed`); đã ghim fingerprint khác thì phải
    /// gỡ ghim trước (`pin-mismatch`, FR-008).
    pub fn pin(&self, id: &str, fingerprint: &str) -> Result<KnownDevice, DeviceError> {
        let device = self.registry.get(id)?;
        if lock(&self.observed).get(id).map(String::as_str) != Some(fingerprint) {
            return Err(DeviceError::NotObserved);
        }
        match &device.pin {
            Some(p) if p.fingerprint == fingerprint => return Ok(device),
            Some(_) => return Err(DeviceError::PinMismatch),
            None => {}
        }
        let pin = Pin {
            fingerprint: fingerprint.to_string(),
            pinned_at: now_utc(),
        };
        let updated = self.registry.modify(id, |d| d.pin = Some(pin))?;
        lock(&self.clients).remove(id);
        Ok(updated)
    }

    /// Gỡ ghim khi `fingerprint` bằng ghim hiện tại (`pin-mismatch`); bỏ phiên của thiết bị.
    pub fn unpin(&self, id: &str, fingerprint: &str) -> Result<KnownDevice, DeviceError> {
        let device = self.registry.get(id)?;
        if device.pin.as_ref().map(|p| p.fingerprint.as_str()) != Some(fingerprint) {
            return Err(DeviceError::PinMismatch);
        }
        let updated = self.registry.modify(id, |d| d.pin = None)?;
        self.sessions.remove(id);
        lock(&self.clients).remove(id);
        Ok(updated)
    }

    /// Client HTTP của thiết bị (một client mỗi thiết bị; dựng lại khi địa chỉ, cổng hay ghim đổi).
    /// Chưa ghim → `cert-unpinned`: không có gì để tin khi bắt tay.
    pub(crate) fn client_for(
        &self,
        device: &KnownDevice,
    ) -> Result<Arc<PinnedClient>, DeviceError> {
        let pin = device.pin.as_ref().ok_or(DeviceError::CertUnpinned)?;
        let mut clients = lock(&self.clients);
        if let Some(c) = clients.get(&device.id)
            && c.host.eq_ignore_ascii_case(&device.host)
            && c.port == device.https_port
            && c.client.verifier.pin() == Some(pin.fingerprint.as_str())
        {
            return Ok(c.client.clone());
        }
        let client = Arc::new(http::pinned_client(&pin.fingerprint, self.http_timeouts)?);
        clients.insert(
            device.id.clone(),
            CachedClient {
                host: device.host.clone(),
                port: device.https_port,
                client: client.clone(),
            },
        );
        Ok(client)
    }

    /// `GET` qua HTTPS có ghim, kèm token nếu có; trả mã HTTP và thân.
    async fn send_get(
        &self,
        device: &KnownDevice,
        path: &str,
        query: Option<&BTreeMap<String, String>>,
        with_token: bool,
    ) -> Result<(u16, Vec<u8>), DeviceError> {
        let client = self.client_for(device)?;
        let url = device_url("https", &device.host, device.https_port, path, query)?;
        let mut request = client.client.get(url);
        if with_token && let Some(h) = self.sessions.header(&device.id) {
            request = request.header(AUTHORIZATION, h);
        }
        let resp = request
            .send()
            .await
            .map_err(|e| http::classify(&e, Some(&client.verifier)))?;
        let status = resp.status().as_u16();
        let body = http::read_body(resp, http::MAX_BODY, Some(&client.verifier)).await?;
        Ok((status, body))
    }

    /// Đăng nhập (contract §5): kiểm ghim và định danh (`setup-required` thì không gửi mật khẩu),
    /// rồi gửi mật khẩu; token giữ trong bộ nhớ Rust, mật khẩu và thân request bị xóa sau khi gửi.
    pub async fn login(
        &self,
        id: &str,
        user: &str,
        password: Zeroizing<String>,
    ) -> Result<SessionInfo, DeviceError> {
        let device = self.registry.get(id)?;
        let client = self.client_for(&device)?;
        let (status, body) = self.send_get(&device, IDENTITY_PATH, None, false).await?;
        if status != 200 {
            return Err(DeviceError::Http(status));
        }
        let identity: Value = serde_json::from_slice(&body)
            .ok()
            .filter(Value::is_object)
            .ok_or(DeviceError::BadResponse)?;
        if identity.get("setupRequired").and_then(Value::as_bool) == Some(true) {
            return Err(DeviceError::SetupRequired);
        }
        if user.len() > MAX_USER_BYTES || password.len() > MAX_PASSWORD_BYTES {
            // Thiết bị cũng từ chối; không gửi chuỗi quá dài.
            return Err(DeviceError::AuthFailed);
        }
        let request_body = session::login_body(user, &password);
        drop(password);
        let url = device_url(
            "https",
            &device.host,
            device.https_port,
            "/api/v1/auth/login",
            None,
        )?;
        let resp = client
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            // Bộ đệm `Zeroizing` đi vào `Bytes`: bị xóa khi reqwest bỏ thân request sau khi gửi.
            .body(Bytes::from_owner(request_body))
            .send()
            .await
            .map_err(|e| http::classify(&e, Some(&client.verifier)))?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get(RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body =
            Zeroizing::new(http::read_body(resp, MAX_SMALL_BODY, Some(&client.verifier)).await?);
        if status != 200 {
            return Err(session::login_failure(
                status,
                &body,
                retry_after.as_deref(),
            ));
        }
        let session =
            session::parse_login(&body, identity.clone()).ok_or(DeviceError::BadResponse)?;
        let info = session.info.clone();
        self.sessions.put(id, session);
        let last_user = info.user.clone();
        // Chỉ để hiển thị lần sau: không ghi được file thì vẫn đăng nhập.
        let _ = self.registry.modify(id, |d| {
            d.last_user = Some(last_user);
            d.last_seen_at = Some(now_utc());
            apply_identity(d, &identity);
        });
        Ok(info)
    }

    /// Đăng xuất: bỏ token phía Rust trước, rồi báo thiết bị (tối đa 3 s, bỏ qua lỗi).
    pub async fn logout(&self, id: &str) {
        let Some(session) = self.sessions.remove(id) else {
            return;
        };
        let Ok(device) = self.registry.get(id) else {
            return;
        };
        let Ok(client) = self.client_for(&device) else {
            return;
        };
        let Ok(url) = device_url(
            "https",
            &device.host,
            device.https_port,
            "/api/v1/auth/logout",
            None,
        ) else {
            return;
        };
        let _ = client
            .client
            .post(url)
            .header(AUTHORIZATION, session.token.header())
            .timeout(LOGOUT_TIMEOUT)
            .send()
            .await;
    }

    /// Phiên còn hiệu lực trên thiết bị (`GET /api/v1/auth/session`, không làm mới hạn), hoặc `None`.
    /// Thiết bị báo 401 thì bỏ token.
    pub async fn session(&self, id: &str) -> Result<Option<SessionInfo>, DeviceError> {
        let Some(info) = self.sessions.info(id) else {
            return Ok(None);
        };
        let device = self.registry.get(id)?;
        let (status, body) = self
            .send_get(&device, "/api/v1/auth/session", None, true)
            .await?;
        match status {
            200 => Ok(Some(info)),
            401 => {
                self.sessions.remove(id);
                Ok(None)
            }
            _ => Err(session::api_failure(status, &body).0),
        }
    }

    /// `GET` một đường dẫn của contract §6 qua HTTPS có ghim, kèm token nếu có. 401 `SESSION_*` thì
    /// bỏ token của thiết bị.
    pub async fn get(
        &self,
        id: &str,
        path: &str,
        query: Option<&BTreeMap<String, String>>,
    ) -> Result<ApiResult, DeviceError> {
        if !http::allowed_path(path) {
            return Err(DeviceError::BadPath);
        }
        let device = self.registry.get(id)?;
        let (status, body) = self.send_get(&device, path, query, true).await?;
        if (200..300).contains(&status) {
            let body = if body.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&body).map_err(|_| DeviceError::BadResponse)?
            };
            if path == IDENTITY_PATH && body.is_object() {
                // Chỉ để hiển thị: không ghi được file thì vẫn trả kết quả.
                let _ = self.registry.modify(id, |d| apply_identity(d, &body));
            }
            return Ok(ApiResult { status, body });
        }
        let (error, drop_token) = session::api_failure(status, &body);
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }

    /// `POST` một đường dẫn của tauri-commands-006 §3 (`tags/write`, `drivers/test`) qua HTTPS có ghim,
    /// kèm token. Thân JSON ≤ 16 KiB. **Không tự gửi lại** khi lỗi mạng (`unreachable`, `timeout`): với
    /// `tags/write` lệnh có thể đã được nhận, giao diện hỏi lại kết quả theo mã yêu cầu.
    ///
    /// Trả `{ status, body }` với 2xx và với các mã có thân theo contract (400 kèm `issues`; 401, 403 kèm
    /// `results`; 409 `TEST_BUSY`; 429 `TEST_RATE_LIMITED` kèm `retryAfterS`; 503 `AUDIT_UNAVAILABLE`). 401
    /// `SESSION_*` bỏ token, kể cả khi có `results`.
    pub async fn post(&self, id: &str, path: &str, body: &Value) -> Result<ApiResult, DeviceError> {
        if !http::allowed_post_path(path) {
            return Err(DeviceError::BadPath);
        }
        let bytes = serde_json::to_vec(body).map_err(|_| DeviceError::BadResponse)?;
        if bytes.len() > http::MAX_POST_BODY {
            return Err(DeviceError::TooLarge);
        }
        let device = self.registry.get(id)?;
        let client = self.client_for(&device)?;
        let url = device_url("https", &device.host, device.https_port, path, None)?;
        // Hạn cố định của contract; test thu ngắn bằng `http_timeouts` khác mặc định.
        let timeout = if self.http_timeouts == HttpTimeouts::default() {
            http::post_timeout(path)
        } else {
            self.http_timeouts.request
        };
        let mut request = client
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .timeout(timeout)
            .body(bytes);
        if let Some(h) = self.sessions.header(&device.id) {
            request = request.header(AUTHORIZATION, h);
        }
        let resp = request
            .send()
            .await
            .map_err(|e| http::classify(&e, Some(&client.verifier)))?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get(RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        let raw = http::read_body(resp, http::MAX_BODY, Some(&client.verifier)).await?;
        let json: Option<Value> = if raw.is_empty() {
            Some(Value::Null)
        } else {
            serde_json::from_slice(&raw).ok()
        };
        let code = http::error_code(&raw);
        let (error, drop_token) = session::api_failure(status, &raw);
        if drop_token {
            self.sessions.remove(id);
        }
        let has_results = json
            .as_ref()
            .is_some_and(|v| v.get("results").is_some_and(Value::is_array));
        let carries_body = match status {
            200..=299 => true,
            400 => json.as_ref().is_some_and(Value::is_object),
            409 => code.as_deref() == Some("TEST_BUSY"),
            429 => code.as_deref() == Some("TEST_RATE_LIMITED"),
            503 => code.as_deref() == Some("AUDIT_UNAVAILABLE"),
            401 | 403 => has_results,
            _ => false,
        };
        if !carries_body {
            return Err(if status == 413 {
                DeviceError::TooLarge
            } else {
                error
            });
        }
        let mut json = json.ok_or(DeviceError::BadResponse)?;
        if status == 429
            && let (Some(s), Value::Object(map)) = (retry_after, &mut json)
        {
            map.entry("retryAfterS").or_insert(Value::from(s));
        }
        Ok(ApiResult { status, body: json })
    }

    /// Đích của `live_open`: `{ id }` → `wss` có ghim, kèm `Authorization: Bearer` khi Rust đang giữ phiên
    /// của thiết bị đó (kết nối đang mở giữ token cũ; đăng nhập lại thì lần mở sau dùng token mới);
    /// `{ address }` → `ws` của chế độ theo dõi, không bao giờ có token.
    pub fn live_endpoint(&self, target: &LiveTarget) -> Result<LiveEndpoint, DeviceError> {
        match target {
            LiveTarget::Id { id } => {
                let device = self.registry.get(id)?;
                Ok(LiveEndpoint::Wss {
                    host: device.host,
                    port: device.https_port,
                    pin: device.pin.map(|p| p.fingerprint),
                    token: self.sessions.header(id),
                })
            }
            LiveTarget::Address { address } => {
                let (host, port) =
                    http::parse_monitor_address(address).ok_or(DeviceError::BadAddress)?;
                Ok(LiveEndpoint::Ws { host, port })
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn sessions(&self) -> &Sessions {
        &self.sessions
    }
}

// ---- Lệnh Tauri (contracts/tauri-commands.md §3–7) ----

/// `devices_list() → KnownDevice[]`
#[tauri::command]
pub async fn devices_list(
    devices: State<'_, DeviceManager>,
) -> Result<Vec<KnownDevice>, DeviceError> {
    Ok(devices.list())
}

/// `device_add({ host, httpsPort?, httpPort?, name?, fromDiscovery? }) → KnownDevice`
#[tauri::command]
pub async fn device_add(
    host: String,
    https_port: Option<i64>,
    http_port: Option<i64>,
    name: Option<String>,
    from_discovery: Option<FromDiscovery>,
    devices: State<'_, DeviceManager>,
) -> Result<KnownDevice, DeviceError> {
    devices.add(NewDevice {
        host,
        https_port,
        http_port,
        name,
        from_discovery,
    })
}

/// `device_update({ id, name?, host?, httpsPort?, httpPort? }) → KnownDevice`
#[tauri::command]
pub async fn device_update(
    id: String,
    name: Option<String>,
    host: Option<String>,
    https_port: Option<i64>,
    http_port: Option<i64>,
    devices: State<'_, DeviceManager>,
) -> Result<KnownDevice, DeviceError> {
    devices.update(
        &id,
        DevicePatch {
            name,
            host,
            https_port,
            http_port,
        },
    )
}

/// `device_forget({ id }) → null`
#[tauri::command]
pub async fn device_forget(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<(), DeviceError> {
    devices.forget(&id)
}

/// `device_probe({ id }) → ProbeResult`. Lỗi `not-tls`: cổng trả lời HTTP thường; là runtime < 0.4.0 thì Rust đã lưu
/// cổng đó làm `httpPort` (T085b), giao diện đọc lại danh sách đã lưu rồi theo dõi chỉ đọc.
#[tauri::command]
pub async fn device_probe(
    id: String,
    devices: State<'_, DeviceManager>,
    discovery: State<'_, crate::discovery::Discovery>,
) -> Result<ProbeResult, DeviceError> {
    devices
        .probe(&id, |d| {
            discovery.fingerprint_for(d.device_id.as_deref(), &d.host)
        })
        .await
}

/// `device_pin({ id, fingerprint }) → KnownDevice`
#[tauri::command]
pub async fn device_pin(
    id: String,
    fingerprint: String,
    devices: State<'_, DeviceManager>,
) -> Result<KnownDevice, DeviceError> {
    devices.pin(&id, &fingerprint)
}

/// `device_unpin({ id, fingerprint }) → KnownDevice`
#[tauri::command]
pub async fn device_unpin(
    id: String,
    fingerprint: String,
    devices: State<'_, DeviceManager>,
) -> Result<KnownDevice, DeviceError> {
    devices.unpin(&id, &fingerprint)
}

/// `device_login({ id, user, password }) → SessionInfo`. Mật khẩu chỉ đi vào ở lệnh này và được
/// bọc `Zeroizing` ngay.
#[tauri::command]
pub async fn device_login(
    id: String,
    user: String,
    password: String,
    devices: State<'_, DeviceManager>,
) -> Result<SessionInfo, DeviceError> {
    let password = Zeroizing::new(password);
    devices.login(&id, &user, password).await
}

/// `device_logout({ id }) → null`: luôn bỏ token phía Rust.
#[tauri::command]
pub async fn device_logout(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<(), DeviceError> {
    devices.logout(&id).await;
    Ok(())
}

/// `device_session({ id }) → SessionInfo | null`
#[tauri::command]
pub async fn device_session(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<Option<SessionInfo>, DeviceError> {
    devices.session(&id).await
}

/// `device_get({ id, path, query? }) → { status, body }`
#[tauri::command]
pub async fn device_get(
    id: String,
    path: String,
    query: Option<BTreeMap<String, String>>,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.get(&id, &path, query.as_ref()).await
}

/// `device_post({ id, path, body }) → { status, body }` (feature 006, tauri-commands-006 §3): chỉ
/// `/api/v1/tags/write`, `/api/v1/drivers/test`; không tự gửi lại khi lỗi mạng.
#[tauri::command]
pub async fn device_post(
    id: String,
    path: String,
    body: Value,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.post(&id, &path, &body).await
}

/// `monitor_get({ address }) → { status, body }`: chế độ theo dõi chỉ đọc, HTTP thường.
#[tauri::command]
pub async fn monitor_get(address: String) -> Result<ApiResult, DeviceError> {
    http::monitor_get(&address, http::MONITOR_TIMEOUT).await
}

/// `live_open({ target: { id } | { address }, onEvent }) → { liveId }`
#[tauri::command]
pub async fn live_open(
    target: LiveTarget,
    on_event: Channel<LiveEvent>,
    devices: State<'_, DeviceManager>,
    hub: State<'_, LiveHub>,
) -> Result<LiveOpened, DeviceError> {
    let endpoint = devices.live_endpoint(&target)?;
    let live_id = hub.open(endpoint, move |event| {
        // Giao diện đã đóng (cửa sổ đóng): không còn ai nhận, bỏ qua.
        let _ = on_event.send(event);
    });
    Ok(LiveOpened { live_id })
}

/// `live_send({ liveId, text })`: frame text; > 96 KiB → `"too-large"`.
#[tauri::command]
pub async fn live_send(
    live_id: u32,
    text: String,
    hub: State<'_, LiveHub>,
) -> Result<(), LiveError> {
    hub.send(live_id, text)
}

/// `live_close({ liveId, code?, reason? })`: mặc định mã 1000.
#[tauri::command]
pub async fn live_close(
    live_id: u32,
    code: Option<u16>,
    reason: Option<String>,
    hub: State<'_, LiveHub>,
) -> Result<(), LiveError> {
    hub.close(live_id, code, reason);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::test_support::{
        DEVICE_ID, Resp, TLS_ALL, TempDir, TestCert, old_runtime, online, plain_http_port,
        plain_http_server, tls_observer,
    };
    use super::*;
    use serde_json::json;

    fn manager(dir: &TempDir) -> DeviceManager {
        DeviceManager::with_timeouts(
            dir.file("devices.json"),
            TlsTimeouts::default(),
            HttpTimeouts::default(),
        )
    }

    fn local(port: u16) -> NewDevice {
        NewDevice {
            host: "127.0.0.1".into(),
            https_port: Some(i64::from(port)),
            ..NewDevice::default()
        }
    }

    /// Feature 011 (T041, L-04 của 005): chỉ trang https của thiết bị đã lưu, dựng lại từ bản ghi.
    #[test]
    fn device_web_url_opens_only_https_of_a_saved_device() {
        let dir = TempDir::new("web-url");
        let m = manager(&dir);
        let a = m
            .add(NewDevice {
                host: "192.168.1.110".into(),
                https_port: Some(8443),
                ..NewDevice::default()
            })
            .unwrap();
        m.add(NewDevice {
            host: "BL335-tram2.local".into(),
            https_port: Some(9443),
            ..NewDevice::default()
        })
        .unwrap();
        let saved = m.list();
        assert_eq!(a.https_port, 8443);
        for ok in ["https://192.168.1.110:8443/", "https://192.168.1.110:8443"] {
            assert_eq!(
                device_web_url(ok, &saved).as_deref(),
                Ok("https://192.168.1.110:8443/"),
                "{ok}"
            );
        }
        assert_eq!(
            device_web_url("https://bl335-tram2.local:9443/", &saved).as_deref(),
            Ok("https://BL335-tram2.local:9443/")
        );
        for bad in [
            "http://192.168.1.110:8080/",
            "https://192.168.1.111:8443/",
            "https://192.168.1.110:9443/",
            "https://192.168.1.110/",
            "https://192.168.1.110:8443/api/v1/system/info",
            "https://192.168.1.110:8443/?x=1",
            "https://evil.example@192.168.1.110:8443/",
            "https://192.168.1.110:8443@evil.example/",
            "https://evil.example/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://192.168.1.110:8443/ ",
            "https://192.168.1.110:99999/",
            "",
        ] {
            assert!(device_web_url(bad, &saved).is_err(), "{bad}");
        }
        assert!(device_web_url("https://192.168.1.110:8443/", &[]).is_err());
    }

    /// T068: `device_pin` chỉ nhận đúng fingerprint của lần `device_probe` gần nhất
    /// (`not-observed`); lần dò lỗi xóa kết quả cũ; ghim đè ghim khác → `pin-mismatch`;
    /// `device_unpin` cần fingerprint bằng ghim hiện tại.
    #[tokio::test]
    async fn pin_only_the_latest_probed_fingerprint() {
        let dir = TempDir::new("pin");
        let m = manager(&dir);
        let cert = TestCert::new();
        let srv = tls_observer(cert.server_config(TLS_ALL)).await;
        let dev = m.add(local(srv.port)).unwrap();
        assert_eq!(
            m.pin(&dev.id, &cert.fingerprint),
            Err(DeviceError::NotObserved)
        );
        let probed = m.probe(&dev.id, |_| None).await.unwrap();
        assert_eq!(probed.fingerprint, cert.fingerprint);
        assert_eq!(probed.state, PinState::Unpinned);
        let other = "a".repeat(64);
        assert_eq!(m.pin(&dev.id, &other), Err(DeviceError::NotObserved));
        assert_eq!(
            m.pin(&dev.id, &cert.fingerprint.to_uppercase()),
            Err(DeviceError::NotObserved)
        );
        let pinned = m.pin(&dev.id, &cert.fingerprint).unwrap();
        let pin = pinned.pin.clone().unwrap();
        assert_eq!(pin.fingerprint, cert.fingerprint);
        assert!(
            pin.pinned_at.ends_with('Z') && pin.pinned_at.len() == 20,
            "{}",
            pin.pinned_at
        );
        assert_eq!(m.list()[0].pin, pinned.pin, "ghim được lưu");
        assert_eq!(
            m.pin(&dev.id, &cert.fingerprint).unwrap().pin,
            pinned.pin,
            "ghim lại cùng fingerprint: giữ nguyên"
        );

        // Thiết bị đổi chứng chỉ: dò thấy G ≠ F; không ghim đè được, phải gỡ ghim F trước.
        let new_cert = TestCert::new();
        let srv2 = tls_observer(new_cert.server_config(TLS_ALL)).await;
        m.update(
            &dev.id,
            DevicePatch {
                https_port: Some(i64::from(srv2.port)),
                ..DevicePatch::default()
            },
        )
        .unwrap();
        let probed = m.probe(&dev.id, |_| None).await.unwrap();
        assert_eq!(probed.state, PinState::Mismatch);
        assert_eq!(
            m.pin(&dev.id, &new_cert.fingerprint),
            Err(DeviceError::PinMismatch)
        );
        assert_eq!(
            m.unpin(&dev.id, &new_cert.fingerprint),
            Err(DeviceError::PinMismatch)
        );
        let unpinned = m.unpin(&dev.id, &cert.fingerprint).unwrap();
        assert_eq!(unpinned.pin, None);
        assert_eq!(
            m.unpin(&dev.id, &cert.fingerprint),
            Err(DeviceError::PinMismatch),
            "chưa ghim"
        );
        assert_eq!(
            m.pin(&dev.id, &new_cert.fingerprint)
                .unwrap()
                .pin
                .unwrap()
                .fingerprint,
            new_cert.fingerprint
        );

        // Lần dò gần nhất lỗi (thiết bị tắt, cùng địa chỉ): không còn fingerprint nào để ghim.
        m.unpin(&dev.id, &new_cert.fingerprint).unwrap();
        drop(srv2);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(
            m.probe(&dev.id, |_| None).await,
            Err(DeviceError::Unreachable)
        );
        assert_eq!(
            m.pin(&dev.id, &new_cert.fingerprint),
            Err(DeviceError::NotObserved)
        );
        assert_eq!(
            m.pin("không-có", &cert.fingerprint),
            Err(DeviceError::NoSuchDevice)
        );
        assert_eq!(
            m.unpin("không-có", &cert.fingerprint),
            Err(DeviceError::NoSuchDevice)
        );
    }

    /// T068: `device_probe`: trạng thái `unpinned`/`match`/`mismatch`, `discovered` lấy từ gói tìm
    /// gần nhất; lỗi `no-such-device`, `not-tls`; dò thành công cập nhật `lastSeenAt`.
    #[tokio::test]
    async fn probe_states_discovered_and_errors() {
        let dir = TempDir::new("probe");
        let m = manager(&dir);
        let cert = TestCert::new();
        let srv = tls_observer(cert.server_config(TLS_ALL)).await;
        let dev = m.add(local(srv.port)).unwrap();
        let seen_fp = "d".repeat(64);
        let r = m
            .probe(&dev.id, |d| {
                assert_eq!(d.id, dev.id);
                Some(seen_fp.clone())
            })
            .await
            .unwrap();
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({ "fingerprint": cert.fingerprint, "pinned": null, "state": "unpinned",
                    "discovered": seen_fp })
        );
        assert!(m.list()[0].last_seen_at.is_some());
        m.pin(&dev.id, &cert.fingerprint).unwrap();
        let r = m.probe(&dev.id, |_| None).await.unwrap();
        assert_eq!(
            (r.state, r.pinned.as_deref()),
            (PinState::Match, Some(cert.fingerprint.as_str()))
        );
        assert_eq!(r.discovered, None);
        assert_eq!(
            m.probe("không-có", |_| None).await,
            Err(DeviceError::NoSuchDevice)
        );
        let http = plain_http_port().await;
        let old = m.add(local(http.port)).unwrap();
        assert_eq!(m.probe(&old.id, |_| None).await, Err(DeviceError::NotTls));
    }

    /// T085b: thiết bị runtime cũ (chưa có HTTPS) thêm theo địa chỉ với cổng HTTP của nó (ví dụ port-forward :9080).
    /// Dò thấy `not-tls`, Rust hỏi `GET /api/v1/system/info` bằng HTTP trên cùng cổng (không token); runtime < 0.4.0
    /// thì lưu cổng đó làm `httpPort`. Không có gì để ghim; tên giữ nguyên; đã lưu thì lần dò sau không hỏi lại.
    #[tokio::test]
    async fn probe_adopts_the_http_port_of_an_old_runtime() {
        let dir = TempDir::new("old-port");
        let m = manager(&dir);
        let srv = old_runtime("0.3.0").await;
        let dev = m.add(local(srv.port)).unwrap();
        assert_eq!(dev.http_port, 8080);
        assert_eq!(m.probe(&dev.id, |_| None).await, Err(DeviceError::NotTls));
        let saved = m.list().remove(0);
        assert_eq!((saved.https_port, saved.http_port), (srv.port, srv.port));
        assert_eq!(saved.name, "127.0.0.1");
        assert_eq!(saved.pin, None);
        let reqs = srv.requests();
        assert_eq!(reqs.len(), 1, "{reqs:?}");
        assert_eq!(
            (reqs[0].method.as_str(), reqs[0].target.as_str()),
            ("GET", "/api/v1/system/info")
        );
        assert!(reqs[0].header("authorization").is_none());
        assert_eq!(
            m.pin(&dev.id, &"a".repeat(64)),
            Err(DeviceError::NotObserved)
        );
        assert_eq!(m.probe(&dev.id, |_| None).await, Err(DeviceError::NotTls));
        assert_eq!(m.list()[0].http_port, srv.port);
        assert_eq!(srv.requests().len(), 1, "đã lưu cổng: không hỏi lại");
    }

    /// T085b: cổng trả lời HTTP thường mà không phải runtime cũ (runtime ≥ 0.4.0: ghi nhầm cổng HTTP vào chỗ cổng
    /// HTTPS; phiên bản không đọc được; system/info lỗi, không phải JSON; cổng chỉ trả 400) → `not-tls`, `httpPort`
    /// giữ nguyên.
    #[tokio::test]
    async fn probe_keeps_the_http_port_unless_an_old_runtime_answers() {
        let dir = TempDir::new("keep-port");
        let m = manager(&dir);
        let http_port = |id: &str| m.list().into_iter().find(|d| d.id == id).unwrap().http_port;
        for version in ["0.4.0", "0.4.0-rc.1", "1.0.0", "0.3", "x.y.z", ""] {
            let srv = old_runtime(version).await;
            let dev = m.add(local(srv.port)).unwrap();
            assert_eq!(
                m.probe(&dev.id, |_| None).await,
                Err(DeviceError::NotTls),
                "{version}"
            );
            assert_eq!(http_port(&dev.id), 8080, "{version}");
            assert_eq!(srv.requests().len(), 1, "{version}");
        }
        let answers = [
            Resp::error(500, "INTERNAL"),
            Resp::raw(200, "không phải JSON"),
            Resp::json(200, json!({ "runtimeVersion": 3 })),
            Resp::json(200, json!([])),
        ];
        for resp in answers {
            let body = String::from_utf8_lossy(&resp.body).into_owned();
            let resp = std::sync::Mutex::new(Some(resp));
            let srv = plain_http_server(move |_| {
                resp.lock()
                    .unwrap()
                    .take()
                    .unwrap_or_else(|| Resp::raw(500, ""))
            })
            .await;
            let dev = m.add(local(srv.port)).unwrap();
            assert_eq!(
                m.probe(&dev.id, |_| None).await,
                Err(DeviceError::NotTls),
                "{body}"
            );
            assert_eq!(http_port(&dev.id), 8080, "{body}");
        }
        let only400 = plain_http_port().await;
        let dev = m.add(local(only400.port)).unwrap();
        assert_eq!(m.probe(&dev.id, |_| None).await, Err(DeviceError::NotTls));
        assert_eq!(http_port(&dev.id), 8080);
    }

    /// T085b: runtime cũ hơn 0.4.0 (runtime đầu tiên có HTTPS, đăng nhập), so phần `MAJOR.MINOR.PATCH` như
    /// `compareSemver` của Studio, bỏ hậu tố pre-release và build; chuỗi không đúng dạng ba số thì không coi là cũ.
    #[test]
    fn runtime_versions_before_online() {
        for old in [
            "0.3.0",
            "0.3.9",
            "0.1.0",
            "0.0.1",
            "0.3.0-dev",
            "0.3.12-rc.1",
            "0.3.0+b1",
        ] {
            assert!(runtime_before_online(old), "{old}");
        }
        for new in [
            "0.4.0",
            "0.4.0-rc.1",
            "0.4.1",
            "0.10.0",
            "1.0.0",
            "",
            "0.3",
            "0.3.0.1",
            "x.y.z",
            " 0.3.0",
            "-1.0.0",
        ] {
            assert!(!runtime_before_online(new), "{new}");
        }
    }

    /// T069: đổi địa chỉ hoặc cổng HTTPS bỏ phiên và kết quả dò; đổi tên thì giữ; `device_forget`
    /// bỏ cả phiên.
    #[tokio::test]
    async fn address_change_and_forget_drop_session_state() {
        let dir = TempDir::new("addr");
        let m = manager(&dir);
        let cert = TestCert::new();
        let srv = tls_observer(cert.server_config(TLS_ALL)).await;
        let dev = m.add(local(srv.port)).unwrap();
        m.probe(&dev.id, |_| None).await.unwrap();
        let fake = session::test_session("kysu1");
        m.sessions().put(&dev.id, fake);
        m.update(
            &dev.id,
            DevicePatch {
                name: Some("Trạm 1".into()),
                ..DevicePatch::default()
            },
        )
        .unwrap();
        assert!(m.sessions().info(&dev.id).is_some(), "đổi tên giữ phiên");
        m.update(
            &dev.id,
            DevicePatch {
                host: Some("localhost".into()),
                ..DevicePatch::default()
            },
        )
        .unwrap();
        assert!(m.sessions().info(&dev.id).is_none(), "đổi địa chỉ bỏ phiên");
        assert_eq!(
            m.pin(&dev.id, &cert.fingerprint),
            Err(DeviceError::NotObserved)
        );
        m.sessions().put(&dev.id, session::test_session("kysu1"));
        m.forget(&dev.id).unwrap();
        assert!(m.sessions().info(&dev.id).is_none());
        assert_eq!(m.forget(&dev.id), Err(DeviceError::NoSuchDevice));
    }

    /// T085a: thiết bị thêm theo địa chỉ có tên mặc định là `host`; dò (chỉ bắt tay TLS) không đổi tên;
    /// lần đăng nhập thành công đầu tiên (luôn đọc `device/identity` trước) đặt tên thiết bị báo; đăng
    /// nhập sai không đổi; tên người dùng đã sửa thì giữ ở các lần sau.
    #[tokio::test]
    async fn first_login_names_a_device_added_by_address() {
        let o = online("name-login").await;
        assert_eq!(
            o.manager.list()[0].name,
            "127.0.0.1",
            "đã dò và ghim: tên vẫn là host"
        );
        assert_eq!(
            o.manager
                .login(&o.id, "kysu1", Zeroizing::new("sai".into()))
                .await,
            Err(DeviceError::AuthFailed)
        );
        assert_eq!(o.manager.list()[0].name, "127.0.0.1");
        o.login().await;
        assert_eq!(o.manager.list()[0].name, "BL335-01");
        o.manager
            .update(
                &o.id,
                DevicePatch {
                    name: Some("Trạm 1".into()),
                    ..DevicePatch::default()
                },
            )
            .unwrap();
        o.login().await;
        assert_eq!(o.manager.list()[0].name, "Trạm 1");
    }

    /// T085a: `device_get` đọc `device/identity` qua kết nối đã ghim cũng đặt tên (và `deviceId`,
    /// `lastRuntime`) cho thiết bị còn tên mặc định; đường dẫn khác không đụng tới.
    #[tokio::test]
    async fn identity_read_names_a_device_added_by_address() {
        let o = online("name-identity").await;
        o.manager
            .get(&o.id, "/api/v1/system/info", None)
            .await
            .unwrap();
        assert_eq!(o.manager.list()[0].name, "127.0.0.1");
        let r = o
            .manager
            .get(&o.id, "/api/v1/device/identity", None)
            .await
            .unwrap();
        assert_eq!(r.body["name"], "BL335-01");
        let saved = o.manager.list().remove(0);
        assert_eq!(saved.name, "BL335-01");
        assert_eq!(saved.device_id.as_deref(), Some(DEVICE_ID));
        assert_eq!(saved.last_runtime.as_deref(), Some("0.4.0"));
    }

    /// T068: hình dạng lỗi gửi giao diện (contract §1, §4–6).
    #[test]
    fn error_shapes_follow_the_contract() {
        let cases = [
            (DeviceError::NoSuchDevice, json!("no-such-device")),
            (DeviceError::BadAddress, json!("bad-address")),
            (DeviceError::TooMany, json!("too-many")),
            (DeviceError::Io("x".into()), json!({ "io": "x" })),
            (DeviceError::Unreachable, json!("unreachable")),
            (DeviceError::Timeout, json!("timeout")),
            (DeviceError::NotTls, json!("not-tls")),
            (
                DeviceError::Tls("bad sig".into()),
                json!({ "tls": "bad sig" }),
            ),
            (DeviceError::CertUnpinned, json!("cert-unpinned")),
            (
                DeviceError::CertMismatch {
                    pinned: "a".into(),
                    seen: "b".into(),
                },
                json!({ "cert-mismatch": { "pinned": "a", "seen": "b" } }),
            ),
            (DeviceError::NotObserved, json!("not-observed")),
            (DeviceError::PinMismatch, json!("pin-mismatch")),
            (DeviceError::AuthFailed, json!("auth-failed")),
            (DeviceError::Locked(287), json!({ "locked": 287 })),
            (DeviceError::AuthBusy, json!("auth-busy")),
            (DeviceError::AuditUnavailable, json!("audit-unavailable")),
            (DeviceError::SetupRequired, json!("setup-required")),
            (DeviceError::BadPath, json!("bad-path")),
            (DeviceError::AuthRequired, json!("auth-required")),
            (DeviceError::SessionExpired, json!("session-expired")),
            (DeviceError::SessionInvalid, json!("session-invalid")),
            (DeviceError::Forbidden, json!("forbidden")),
            (DeviceError::Http(404), json!({ "http": 404 })),
            (DeviceError::BadResponse, json!("bad-response")),
            (
                DeviceError::Network("refused".into()),
                json!({ "network": "refused" }),
            ),
        ];
        for (err, expected) in cases {
            assert_eq!(serde_json::to_value(&err).unwrap(), expected, "{err:?}");
        }
    }
}
