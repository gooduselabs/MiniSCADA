//! HTTP tới thiết bị (research R6; contracts/tauri-commands.md §6).
//!
//! - HTTPS có ghim: `reqwest` với cấu hình rustls dựng sẵn (`tls_backend_preconfigured`, provider và
//!   `PinnedVerifier` của `tls.rs`), `http1_only`, một client mỗi thiết bị; kết nối 3 s, request
//!   10 s, giữ kết nối rảnh 10 s (thiết bị giữ 15 s, nên Studio đóng trước); không proxy, không
//!   chuyển hướng.
//! - Chế độ theo dõi chỉ đọc (như 004): HTTP thường, chỉ `GET /api/v1/system/info`, hạn 3 s, lỗi
//!   giữ mã của `checkDevice` (`timeout`, `network`, `http`, `bad-response`).
//! - Tham số query mã hóa bằng `Url::query_pairs_mut` (feature `query` của reqwest không bật).

use super::DeviceError;
use super::registry::{is_uuid, valid_host};
use super::tls::{self, PinnedVerifier};
use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::error::Error as StdError;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Giữ kết nối rảnh tối đa 10 s: thiết bị đóng sau 15 s (ADR-010, chốt 2026-10-12), Studio phải
/// đóng trước để không gửi vào socket thiết bị vừa đóng (analyze C7).
pub const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(10);
pub const MONITOR_TIMEOUT: Duration = Duration::from_secs(3);
/// Trần thân phản hồi đọc vào bộ nhớ.
pub const MAX_BODY: usize = 4 * 1024 * 1024;
pub const MAX_MONITOR_BODY: usize = 1024 * 1024;

/// Hạn của client HTTPS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpTimeouts {
    pub connect: Duration,
    pub request: Duration,
}

impl Default for HttpTimeouts {
    fn default() -> Self {
        HttpTimeouts {
            connect: CONNECT_TIMEOUT,
            request: REQUEST_TIMEOUT,
        }
    }
}

/// Kết quả `device_get`, `monitor_get`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApiResult {
    pub status: u16,
    pub body: Value,
}

/// Đường dẫn `device_get` được gọi (contract §6): so đúng từng chuỗi, riêng `deployments/<uuid>`.
pub fn allowed_path(path: &str) -> bool {
    const FIXED: &[&str] = &[
        "/api/v1/system/info",
        "/api/v1/device/identity",
        "/api/v1/auth/session",
        "/api/v1/diagnostics",
        "/api/v1/project/versions",
        "/api/v1/project/manifest",
        "/api/v1/project/operation",
        "/api/v1/audit",
    ];
    FIXED.contains(&path)
        || path
            .strip_prefix("/api/v1/project/deployments/")
            .is_some_and(is_uuid)
}

/// URL tới thiết bị; `query` mã hóa dạng form (`application/x-www-form-urlencoded`).
pub fn device_url(
    scheme: &str,
    host: &str,
    port: u16,
    path: &str,
    query: Option<&BTreeMap<String, String>>,
) -> Result<Url, DeviceError> {
    let mut url = Url::parse(&format!("{scheme}://{host}:{port}{path}"))
        .map_err(|_| DeviceError::BadAddress)?;
    if let Some(query) = query.filter(|q| !q.is_empty()) {
        let mut pairs = url.query_pairs_mut();
        for (k, v) in query {
            pairs.append_pair(k, v);
        }
    }
    Ok(url)
}

/// Client HTTPS của một thiết bị và verifier của nó (để báo fingerprint khi không khớp ghim).
pub struct PinnedClient {
    pub client: reqwest::Client,
    pub verifier: Arc<PinnedVerifier>,
}

/// Phần chung của mọi client: HTTP/1.1, giữ kết nối rảnh 30 s, không proxy (thiết bị ở LAN/VPN;
/// proxy của hệ thống không được thấy request), không tự chuyển hướng.
fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .http1_only()
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .user_agent(concat!("mAT-Studio/", env!("CARGO_PKG_VERSION")))
}

/// Dựng client HTTPS với ghim `pin`. `tls_backend_preconfigured` không cam kết SemVer: kiểu
/// `rustls::ClientConfig` phải cùng phiên bản với reqwest, sai thì `build()` lỗi (có test).
pub fn pinned_client(pin: &str, timeouts: HttpTimeouts) -> Result<PinnedClient, DeviceError> {
    let verifier = Arc::new(PinnedVerifier::pinned(pin));
    let client = builder()
        .tls_backend_preconfigured(tls::client_config(verifier.clone()))
        .connect_timeout(timeouts.connect)
        .timeout(timeouts.request)
        .build()
        .map_err(|e| DeviceError::Tls(e.to_string()))?;
    Ok(PinnedClient { client, verifier })
}

/// Client HTTP thường của chế độ theo dõi. reqwest vẫn cần một cấu hình TLS (không cài provider
/// mặc định cho cả tiến trình): dùng verifier ghim rỗng, không chứng chỉ nào khớp, nên client này
/// không bao giờ nói chuyện qua HTTPS.
fn plain_client(timeout: Duration) -> Result<reqwest::Client, DeviceError> {
    builder()
        .tls_backend_preconfigured(tls::client_config(Arc::new(PinnedVerifier::pinned(""))))
        .connect_timeout(timeout)
        .timeout(timeout)
        .build()
        .map_err(|e| DeviceError::Network(e.to_string()))
}

/// Client của chế độ theo dõi, dùng lại giữa các lần gọi với hạn mặc định.
fn monitor_client(timeout: Duration) -> Result<reqwest::Client, DeviceError> {
    static SHARED: OnceLock<reqwest::Client> = OnceLock::new();
    if timeout != MONITOR_TIMEOUT {
        return plain_client(timeout);
    }
    if let Some(c) = SHARED.get() {
        return Ok(c.clone());
    }
    let c = plain_client(timeout)?;
    Ok(SHARED.get_or_init(|| c).clone())
}

/// Lỗi rustls trong chuỗi nguyên nhân. tokio-rustls bọc nó trong `io::Error`, hyper-rustls bọc thêm
/// một `io::Error` nữa; `io::Error::source()` bỏ qua lớp bọc, nên phải đi xuống cả `get_ref()`.
fn rustls_error(err: &(dyn StdError + 'static)) -> Option<rustls::Error> {
    let mut pending: Vec<&(dyn StdError + 'static)> = vec![err];
    let mut steps = 0;
    while let Some(e) = pending.pop() {
        steps += 1;
        if steps > 64 {
            break;
        }
        if let Some(t) = e.downcast_ref::<rustls::Error>() {
            return Some(t.clone());
        }
        if let Some(inner) = e
            .downcast_ref::<std::io::Error>()
            .and_then(|io| io.get_ref())
        {
            pending.push(inner);
        }
        if let Some(source) = e.source() {
            pending.push(source);
        }
    }
    None
}

/// Thông báo của nguyên nhân sâu nhất (lỗi hệ điều hành), để hiện cho người dùng.
fn root_message(err: &(dyn StdError + 'static)) -> String {
    let mut cur = err;
    while let Some(next) = cur.source() {
        cur = next;
    }
    cur.to_string()
}

/// Phân loại lỗi của reqwest: hết hạn, chứng chỉ khác ghim, lỗi TLS, không tới được.
pub fn classify(err: &reqwest::Error, verifier: Option<&PinnedVerifier>) -> DeviceError {
    if err.is_timeout() {
        return DeviceError::Timeout;
    }
    if let (Some(v), Some(tls_err)) = (verifier, rustls_error(err)) {
        return tls::classify_rustls(&tls_err, v).into();
    }
    if err.is_body() || err.is_decode() {
        return DeviceError::BadResponse;
    }
    DeviceError::Unreachable
}

/// Đọc thân phản hồi tối đa `max` byte; vượt thì `bad-response`.
pub async fn read_body(
    mut resp: reqwest::Response,
    max: usize,
    verifier: Option<&PinnedVerifier>,
) -> Result<Vec<u8>, DeviceError> {
    if resp
        .content_length()
        .is_some_and(|n| n > u64::try_from(max).unwrap_or(u64::MAX))
    {
        return Err(DeviceError::BadResponse);
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| classify(&e, verifier))? {
        if body.len() + chunk.len() > max {
            return Err(DeviceError::BadResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Khóa `error` của thân lỗi JSON (`{ "error": "<MÃ>", … }`).
pub fn error_code(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(body).ok()?;
    v.get("error")?.as_str().map(str::to_string)
}

/// Địa chỉ của chế độ theo dõi: `host`, `host:port` hoặc `http://host:port` (dạng `normalizeDevice`
/// của 004), cổng mặc định 8080. Chỉ HTTP: `https://` bị từ chối (chế độ này không có ghim).
pub fn parse_monitor_address(address: &str) -> Option<(String, u16)> {
    let mut s = address.trim();
    if let Some(i) = s.find("://") {
        if !s[..i].eq_ignore_ascii_case("http") {
            return None;
        }
        s = &s[i + 3..];
    }
    let s = s.strip_suffix('/').unwrap_or(s);
    let (host, port) = match s.rsplit_once(':') {
        Some((host, port)) => {
            if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            (host, port.parse::<u16>().ok().filter(|p| *p != 0)?)
        }
        None => (s, 8080),
    };
    Some((valid_host(host)?, port))
}

/// `monitor_get`: HTTP thường, chỉ `GET /api/v1/system/info`; thân phải là JSON object.
pub async fn monitor_get(address: &str, timeout: Duration) -> Result<ApiResult, DeviceError> {
    let (host, port) = parse_monitor_address(address).ok_or(DeviceError::BadAddress)?;
    let url = device_url("http", &host, port, "/api/v1/system/info", None)?;
    let failure = |e: reqwest::Error| {
        if e.is_timeout() {
            DeviceError::Timeout
        } else {
            DeviceError::Network(root_message(&e))
        }
    };
    let mut resp = monitor_client(timeout)?
        .get(url)
        .send()
        .await
        .map_err(failure)?;
    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        return Err(DeviceError::Http(status));
    }
    let mut body = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() <= MAX_MONITOR_BODY => {
                body.extend_from_slice(&chunk);
            }
            Ok(Some(_)) => return Err(DeviceError::BadResponse),
            Ok(None) => break,
            Err(e) if e.is_timeout() => return Err(DeviceError::Timeout),
            Err(_) => return Err(DeviceError::BadResponse),
        }
    }
    match serde_json::from_slice::<Value>(&body) {
        Ok(v) if v.is_object() => Ok(ApiResult { status, body: v }),
        _ => Err(DeviceError::BadResponse),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::test_support::{
        Resp, TLS_ALL, TestCert, closed_port, http_server, online, silent_server, silent_tls_server,
    };
    use serde_json::json;
    use std::time::Instant;

    /// T068: hạn và giữ kết nối theo R6 và analyze C7.
    #[test]
    fn timeouts_follow_the_research() {
        assert_eq!(
            HttpTimeouts::default(),
            HttpTimeouts {
                connect: Duration::from_secs(3),
                request: Duration::from_secs(10)
            }
        );
        // Thiết bị đóng kết nối rảnh sau 15 s (ADR-010, chốt 2026-10-12): Studio đóng trước.
        assert_eq!(POOL_IDLE_TIMEOUT, Duration::from_secs(10));
        assert_eq!(MONITOR_TIMEOUT, Duration::from_secs(3));
    }

    /// T068: `device_get` chỉ được các đường dẫn của contract §6.
    #[test]
    fn only_the_paths_of_the_contract() {
        for ok in [
            "/api/v1/system/info",
            "/api/v1/device/identity",
            "/api/v1/auth/session",
            "/api/v1/diagnostics",
            "/api/v1/project/versions",
            "/api/v1/project/manifest",
            "/api/v1/project/operation",
            "/api/v1/project/deployments/0b2f1d6c-8a10-4c3a-9e57-4f9c2a8e6d1b",
            "/api/v1/project/deployments/0B2F1D6C-8A10-4C3A-9E57-4F9C2A8E6D1B",
            "/api/v1/audit",
        ] {
            assert!(allowed_path(ok), "{ok}");
        }
        for bad in [
            "",
            "/",
            "/api/v1/live",
            "/api/v1/projects/active",
            "/api/v1/project/package",
            "/api/v1/project/deployments",
            "/api/v1/project/deployments/",
            "/api/v1/project/deployments/xyz",
            "/api/v1/project/deployments/0b2f1d6c-8a10-4c3a-9e57-4f9c2a8e6d1b/x",
            "/api/v1/project/deployments/../../auth/login",
            "/api/v1/audit/",
            "/api/v1/audit?limit=1",
            "/api/v1/system/info#x",
            "/API/V1/SYSTEM/INFO",
            "api/v1/system/info",
            "//api/v1/system/info",
            "https://evil.example/api/v1/system/info",
        ] {
            assert!(!allowed_path(bad), "{bad}");
        }
    }

    /// T068: `query` được mã hóa (Rust mã hóa, không ghép chuỗi).
    #[test]
    fn query_is_form_encoded() {
        let q = BTreeMap::from([
            ("action".to_string(), "project.".to_string()),
            ("user".to_string(), "kỹ sư&x=1".to_string()),
            ("limit".to_string(), "200".to_string()),
        ]);
        let url = device_url("https", "192.168.1.110", 8443, "/api/v1/audit", Some(&q)).unwrap();
        assert_eq!(
            url.as_str(),
            "https://192.168.1.110:8443/api/v1/audit?action=project.&limit=200&user=k%E1%BB%B9+s%C6%B0%26x%3D1"
        );
        let plain = device_url("http", "bl335.local", 8080, "/api/v1/system/info", None).unwrap();
        assert_eq!(plain.as_str(), "http://bl335.local:8080/api/v1/system/info");
        let empty = BTreeMap::new();
        let none = device_url("https", "10.0.0.1", 8443, "/api/v1/audit", Some(&empty)).unwrap();
        assert_eq!(none.as_str(), "https://10.0.0.1:8443/api/v1/audit");
    }

    /// T068: `reqwest` dựng được với `tls_backend_preconfigured` (API không cam kết SemVer) và thật sự
    /// dùng cấu hình của mình: ghim khớp thì gọi được, ghim khác → `cert-mismatch`.
    #[tokio::test]
    async fn reqwest_uses_the_preconfigured_rustls_config() {
        let cert = TestCert::new();
        let srv = http_server(Some(cert.server_config(TLS_ALL)), |_| {
            Resp::json(200, json!({ "ok": true }))
        })
        .await;
        let url = device_url("https", "127.0.0.1", srv.port, "/api/v1/system/info", None).unwrap();
        let good = pinned_client(&cert.fingerprint, HttpTimeouts::default()).unwrap();
        let resp = good.client.get(url.clone()).send().await.unwrap();
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.version(), reqwest::Version::HTTP_11);
        let wrong_pin = "0".repeat(64);
        let bad = pinned_client(&wrong_pin, HttpTimeouts::default()).unwrap();
        let err = bad.client.get(url).send().await.unwrap_err();
        assert_eq!(
            classify(&err, Some(&bad.verifier)),
            DeviceError::CertMismatch {
                pinned: wrong_pin,
                seen: cert.fingerprint.clone()
            }
        );
        assert_eq!(srv.requests().len(), 1);
    }

    /// T068: ngoài danh sách → `bad-path`, không gửi request nào; thiết bị lạ → `no-such-device`.
    #[tokio::test]
    async fn device_get_rejects_other_paths() {
        let o = online("get-path").await;
        for bad in ["/api/v1/auth/login", "/api/v1/project/package", "/x"] {
            assert_eq!(
                o.manager.get(&o.id, bad, None).await,
                Err(DeviceError::BadPath),
                "{bad}"
            );
        }
        assert!(o.server.requests().iter().all(|r| r.path() != "/x"));
        assert_eq!(
            o.manager.get("không-có", "/api/v1/system/info", None).await,
            Err(DeviceError::NoSuchDevice)
        );
    }

    /// T068: đường dẫn công khai gọi được khi chưa đăng nhập; đã đăng nhập thì token đi trong header
    /// `Authorization: Bearer`; `query` tới thiết bị đã mã hóa; thân JSON `null` hợp lệ.
    #[tokio::test]
    async fn device_get_sends_the_token_and_the_encoded_query() {
        let o = online("get-token").await;
        let info = o
            .manager
            .get(&o.id, "/api/v1/system/info", None)
            .await
            .unwrap();
        assert_eq!(info.status, 200);
        assert_eq!(info.body["runtimeVersion"], "0.4.0");
        assert!(o.server.requests().last().unwrap().bearer().is_none());
        o.login().await;
        let token = o.device_token().unwrap();
        let q = BTreeMap::from([("user".to_string(), "kỹ sư&x".to_string())]);
        let audit = o
            .manager
            .get(&o.id, "/api/v1/audit", Some(&q))
            .await
            .unwrap();
        assert_eq!(audit.body["query"], "user=k%E1%BB%B9+s%C6%B0%26x");
        let last = o.server.requests().last().unwrap().clone();
        assert_eq!(last.bearer(), Some(token.as_str()));
        let op = o
            .manager
            .get(&o.id, "/api/v1/project/operation", None)
            .await
            .unwrap();
        assert_eq!(
            op,
            ApiResult {
                status: 200,
                body: Value::Null
            }
        );
    }

    /// T068: ánh xạ lỗi: 401 `AUTH_REQUIRED` → `auth-required`; 401 `SESSION_EXPIRED` →
    /// `session-expired` và bỏ token; 401 `SESSION_INVALID` → `session-invalid` và bỏ token; 403
    /// `FORBIDDEN` → `forbidden`; mã khác → `{ http: status }`; thân không phải JSON → `bad-response`.
    #[tokio::test]
    async fn device_get_maps_errors() {
        let o = online("get-errors").await;
        let diag = "/api/v1/diagnostics";
        assert_eq!(
            o.manager.get(&o.id, diag, None).await,
            Err(DeviceError::AuthRequired)
        );
        o.login().await;
        assert_eq!(o.manager.get(&o.id, diag, None).await.unwrap().status, 200);
        o.state.lock().unwrap().forced = Some((403, "FORBIDDEN"));
        assert_eq!(
            o.manager.get(&o.id, diag, None).await,
            Err(DeviceError::Forbidden)
        );
        assert!(o.manager.sessions().info(&o.id).is_some(), "403 giữ phiên");
        o.state.lock().unwrap().forced = Some((401, "SESSION_INVALID"));
        assert_eq!(
            o.manager.get(&o.id, diag, None).await,
            Err(DeviceError::SessionInvalid)
        );
        assert!(
            o.manager.sessions().info(&o.id).is_none(),
            "401 SESSION_* bỏ token"
        );
        assert_eq!(
            o.manager.get(&o.id, diag, None).await,
            Err(DeviceError::AuthRequired),
            "token đã bỏ: không gửi nữa"
        );
        o.state.lock().unwrap().forced = None;
        o.login().await;
        o.state.lock().unwrap().token = Some("mats_token-khac".into());
        assert_eq!(
            o.manager.get(&o.id, diag, None).await,
            Err(DeviceError::SessionExpired)
        );
        assert!(o.manager.sessions().info(&o.id).is_none());
        assert_eq!(
            o.manager.get(&o.id, "/api/v1/project/manifest", None).await,
            Err(DeviceError::Http(404))
        );
        assert_eq!(
            o.manager.get(&o.id, "/api/v1/project/versions", None).await,
            Err(DeviceError::BadResponse)
        );
    }

    /// T068: lỗi mạng của `device_get`: chứng chỉ đổi → `cert-mismatch`; thiết bị tắt →
    /// `unreachable` (hạn thật: Windows mất khoảng 2 s mới báo cổng đóng); không trả lời → `timeout`
    /// (hạn request thu ngắn trong test); chưa ghim → `cert-unpinned`.
    #[tokio::test]
    async fn device_get_network_errors() {
        let mut o = online("get-net").await;
        let info = "/api/v1/system/info";
        let other = TestCert::new();
        let impostor = http_server(Some(other.server_config(TLS_ALL)), |_| {
            Resp::json(200, json!({}))
        })
        .await;
        let move_to = |port: u16| super::super::registry::DevicePatch {
            https_port: Some(i64::from(port)),
            ..Default::default()
        };
        o.manager.update(&o.id, move_to(impostor.port)).unwrap();
        assert_eq!(
            o.manager.get(&o.id, info, None).await,
            Err(DeviceError::CertMismatch {
                pinned: o.cert.fingerprint.clone(),
                seen: other.fingerprint.clone()
            })
        );
        assert!(
            impostor.requests().is_empty(),
            "không gửi request khi chứng chỉ khác ghim"
        );
        o.manager
            .update(&o.id, move_to(closed_port().await))
            .unwrap();
        assert_eq!(
            o.manager.get(&o.id, info, None).await,
            Err(DeviceError::Unreachable)
        );
        o.manager.http_timeouts.request = Duration::from_millis(500);
        let silent = silent_tls_server(o.cert.server_config(TLS_ALL)).await;
        o.manager.update(&o.id, move_to(silent.port)).unwrap();
        let started = Instant::now();
        assert_eq!(
            o.manager.get(&o.id, info, None).await,
            Err(DeviceError::Timeout)
        );
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "{:?}",
            started.elapsed()
        );
        let pin = o.cert.fingerprint.clone();
        o.manager.unpin(&o.id, &pin).unwrap();
        assert_eq!(
            o.manager.get(&o.id, info, None).await,
            Err(DeviceError::CertUnpinned)
        );
    }

    /// T068: một client mỗi thiết bị: gọi lại dùng đúng client cũ; đổi cổng thì dựng client mới.
    #[tokio::test]
    async fn one_client_per_device() {
        let o = online("client").await;
        let dev = o.manager.list().remove(0);
        let a = o.manager.client_for(&dev).unwrap();
        let b = o.manager.client_for(&dev).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(a.verifier.pin(), Some(o.cert.fingerprint.as_str()));
        let moved = o
            .manager
            .update(
                &o.id,
                super::super::registry::DevicePatch {
                    https_port: Some(9443),
                    ..Default::default()
                },
            )
            .unwrap();
        let c = o.manager.client_for(&moved).unwrap();
        assert!(!Arc::ptr_eq(&a, &c));
    }

    /// T068: địa chỉ của chế độ theo dõi theo `normalizeDevice` của 004 (chỉ http, cổng mặc định
    /// 8080).
    #[test]
    fn monitor_addresses() {
        for (input, host, port) in [
            ("192.168.1.110", "192.168.1.110", 8080),
            ("192.168.1.110:9080", "192.168.1.110", 9080),
            ("http://192.168.1.110:8080", "192.168.1.110", 8080),
            ("HTTP://bl335.local:8080/", "bl335.local", 8080),
            ("  bl335  ", "bl335", 8080),
        ] {
            assert_eq!(
                parse_monitor_address(input),
                Some((host.to_string(), port)),
                "{input}"
            );
        }
        for bad in [
            "",
            "https://192.168.1.110:8443",
            "ws://192.168.1.110",
            "192.168.1.110:0",
            "192.168.1.110:65536",
            "192.168.1.110/api",
            "a b",
            "192.168.001.010",
            "http://user@host",
        ] {
            assert_eq!(parse_monitor_address(bad), None, "{bad}");
        }
    }

    /// T068: `monitor_get`: HTTP thường, đúng `GET /api/v1/system/info`, không token; lỗi giữ mã của
    /// `checkDevice`.
    #[tokio::test]
    async fn monitor_get_uses_plain_http() {
        let ok = http_server(None, |_| {
            Resp::json(200, json!({ "runtimeVersion": "0.3.0" }))
        })
        .await;
        let r = monitor_get(&format!("http://127.0.0.1:{}", ok.port), MONITOR_TIMEOUT)
            .await
            .unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body["runtimeVersion"], "0.3.0");
        let req = ok.requests().remove(0);
        assert_eq!(
            (req.method.as_str(), req.target.as_str()),
            ("GET", "/api/v1/system/info")
        );
        assert!(req.header("authorization").is_none());

        let failing = http_server(None, |_| Resp::error(500, "INTERNAL")).await;
        let addr = |port: u16| format!("127.0.0.1:{port}");
        assert_eq!(
            monitor_get(&addr(failing.port), MONITOR_TIMEOUT).await,
            Err(DeviceError::Http(500))
        );
        for body in ["[]", "không phải JSON", "null", "5"] {
            let srv = http_server(None, move |_| Resp::raw(200, body)).await;
            assert_eq!(
                monitor_get(&addr(srv.port), MONITOR_TIMEOUT).await,
                Err(DeviceError::BadResponse),
                "{body}"
            );
        }
        let refused = monitor_get(&addr(closed_port().await), MONITOR_TIMEOUT).await;
        assert!(
            matches!(&refused, Err(DeviceError::Network(d)) if !d.is_empty()),
            "{refused:?}"
        );
        let silent = silent_server().await;
        let started = Instant::now();
        assert_eq!(
            monitor_get(&addr(silent.port), Duration::from_millis(300)).await,
            Err(DeviceError::Timeout)
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            monitor_get("https://127.0.0.1:8443", MONITOR_TIMEOUT).await,
            Err(DeviceError::BadAddress)
        );
    }
}
