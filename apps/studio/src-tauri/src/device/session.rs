//! Phiên đăng nhập vào thiết bị (contracts/tauri-commands.md §5, device-api.md §3; Q3: token phiên
//! trong header `Authorization: Bearer`).
//!
//! - Token chỉ nằm trong bộ nhớ Rust: kiểu giữ token (`SessionToken`) không `Serialize`, không
//!   `Clone`, `Debug` che giá trị, bị xóa (`zeroize`) khi bỏ. `SessionInfo` gửi giao diện không có
//!   trường token.
//! - Mật khẩu chỉ đi vào ở `device_login`; Rust giữ nó và thân request JSON trong bộ đệm `Zeroizing`,
//!   xóa ngay sau khi gửi. (Bản sao nằm trong bộ đệm của hyper/rustls và của WebView nằm ngoài tầm
//!   với của Rust.)

use super::DeviceError;
use super::http::error_code;
use reqwest::header::HeaderValue;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, MutexGuard, PoisonError};
use zeroize::Zeroizing;

/// Thời gian khóa mặc định khi thiết bị không báo (FR-013: 5 phút) và trần nhận từ thiết bị.
const DEFAULT_LOCK_S: u64 = 300;
const MAX_LOCK_S: u64 = 24 * 3600;
/// Token dài nhất nhận từ thiết bị (API 1.0.0: `mats_` + 43 ký tự).
const MAX_TOKEN_BYTES: usize = 256;

/// Token phiên (`mats_…`). Không `Serialize`, không `Clone`: không thể vô tình gửi lên giao diện
/// hay ghi ra file.
pub struct SessionToken(Zeroizing<String>);

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken(***)")
    }
}

impl SessionToken {
    /// Nhận token của thiết bị: `mats_` + ký tự base64url, tối đa 256 byte (an toàn để đặt vào
    /// header).
    pub fn parse(token: &str) -> Option<Self> {
        let rest = token.strip_prefix("mats_")?;
        let ok = !rest.is_empty()
            && token.len() <= MAX_TOKEN_BYTES
            && rest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        ok.then(|| SessionToken(Zeroizing::new(token.to_string())))
    }

    /// Header `Authorization: Bearer …`, đánh dấu nhạy cảm (không in trong `Debug` của reqwest).
    pub fn header(&self) -> HeaderValue {
        let value = Zeroizing::new(format!("Bearer {}", self.0.as_str()));
        let mut header =
            HeaderValue::from_str(&value).expect("token chỉ có ký tự base64url (đã kiểm ở parse)");
        header.set_sensitive(true);
        header
    }
}

/// Phiên gửi giao diện: không có token.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub user: String,
    pub role: String,
    pub idle_timeout_s: u64,
    pub max_lifetime_s: u64,
    /// Kết quả `GET /api/v1/device/identity` lúc đăng nhập.
    pub identity: Value,
}

/// Phiên của một thiết bị trong bộ nhớ.
pub struct Session {
    pub token: SessionToken,
    pub info: SessionInfo,
}

/// Các phiên theo `id` của thiết bị đã lưu.
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Session>>);

impl Sessions {
    fn map(&self) -> MutexGuard<'_, HashMap<String, Session>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Đặt phiên (phiên cũ của thiết bị bị bỏ, token cũ bị xóa).
    pub fn put(&self, id: &str, session: Session) {
        self.map().insert(id.to_string(), session);
    }

    pub fn remove(&self, id: &str) -> Option<Session> {
        self.map().remove(id)
    }

    pub fn info(&self, id: &str) -> Option<SessionInfo> {
        self.map().get(id).map(|s| s.info.clone())
    }

    pub fn header(&self, id: &str) -> Option<HeaderValue> {
        self.map().get(id).map(|s| s.token.header())
    }
}

/// Thân `POST /api/v1/auth/login` trong bộ đệm tự xóa. Cấp sẵn đủ chỗ cho trường hợp thoát ký tự
/// dài nhất (`\u00XX`, 6 byte mỗi byte) để `Vec` không cấp lại giữa chừng và để lại bản sao.
pub fn login_body(user: &str, password: &str) -> Zeroizing<Vec<u8>> {
    #[derive(Serialize)]
    struct Login<'a> {
        user: &'a str,
        password: &'a str,
    }
    let mut body = Zeroizing::new(Vec::with_capacity(32 + 6 * (user.len() + password.len())));
    serde_json::to_writer(&mut *body, &Login { user, password })
        .expect("ghi JSON vào Vec không lỗi");
    body
}

/// Lỗi đăng nhập theo mã HTTP và thân lỗi (contract §5).
pub fn login_failure(status: u16, body: &[u8], retry_after: Option<&str>) -> DeviceError {
    match status {
        401 => DeviceError::AuthFailed,
        429 => {
            let json: Option<Value> = serde_json::from_slice(body).ok();
            match json
                .as_ref()
                .and_then(|v| v.get("error"))
                .and_then(Value::as_str)
            {
                Some("AUTH_BUSY") => DeviceError::AuthBusy,
                Some("AUTH_LOCKED") => {
                    let secs = json
                        .as_ref()
                        .and_then(|v| v.get("retryAfterS"))
                        .and_then(Value::as_u64)
                        .or_else(|| retry_after.and_then(|s| s.trim().parse().ok()))
                        .unwrap_or(DEFAULT_LOCK_S);
                    DeviceError::Locked(secs.min(MAX_LOCK_S))
                }
                _ => DeviceError::Http(429),
            }
        }
        503 => DeviceError::AuditUnavailable,
        s => DeviceError::Http(s),
    }
}

/// Phiên từ phản hồi 200 của đăng nhập; `None` nếu thiếu khóa hoặc token sai dạng.
pub fn parse_login(body: &[u8], identity: Value) -> Option<Session> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LoginOk {
        token: String,
        user: String,
        role: String,
        idle_timeout_s: u64,
        max_lifetime_s: u64,
    }
    let ok: LoginOk = serde_json::from_slice(body).ok()?;
    let raw = Zeroizing::new(ok.token);
    Some(Session {
        token: SessionToken::parse(&raw)?,
        info: SessionInfo {
            user: ok.user,
            role: ok.role,
            idle_timeout_s: ok.idle_timeout_s,
            max_lifetime_s: ok.max_lifetime_s,
            identity,
        },
    })
}

/// Lỗi của `device_get` theo mã HTTP (contract §6) và có phải bỏ token không: 401 `SESSION_*` (và
/// 401 không rõ mã) bỏ token; 401 `AUTH_REQUIRED` (request không có token) thì không.
pub fn api_failure(status: u16, body: &[u8]) -> (DeviceError, bool) {
    match (status, error_code(body).as_deref()) {
        (401, Some("AUTH_REQUIRED")) => (DeviceError::AuthRequired, false),
        (401, Some("SESSION_INVALID")) => (DeviceError::SessionInvalid, true),
        (401, _) => (DeviceError::SessionExpired, true),
        (403, Some("FORBIDDEN")) => (DeviceError::Forbidden, false),
        (403, Some("SOURCE_NOT_ALLOWED")) => (DeviceError::ViewerPrivate, false),
        (403, Some("VIEWER_OFF")) => (DeviceError::ViewerOff, false),
        (404, Some("NO_SUCH_REQUEST")) => (DeviceError::NoSuchRequest, false),
        (s, _) => (DeviceError::Http(s), false),
    }
}

/// Phiên giả cho test của module khác.
#[cfg(test)]
pub(crate) fn test_session(user: &str) -> Session {
    Session {
        token: SessionToken::parse(&super::test_support::random_secret("mats_")).unwrap(),
        info: SessionInfo {
            user: user.into(),
            role: "engineer".into(),
            idle_timeout_s: 1800,
            max_lifetime_s: 43200,
            identity: serde_json::json!({}),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::DeviceError as E;
    use crate::device::http::HttpTimeouts;
    use crate::device::test_support::{
        Resp, TLS_ALL, TestCert, closed_port, contains, http_server, online, silent_tls_server,
    };
    use serde_json::json;
    use std::time::Duration;

    /// Bảo đảm lúc biên dịch: `SessionToken` không `Serialize` (thêm `Serialize` thì kiểu `_` dưới
    /// đây thành mơ hồ và test không biên dịch được).
    trait AmbiguousIfSerialize<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfSerialize<()> for T {}
    #[allow(dead_code)]
    struct Invalid;
    impl<T: ?Sized + serde::Serialize> AmbiguousIfSerialize<Invalid> for T {}
    const _: fn() = || {
        let _ = <SessionToken as AmbiguousIfSerialize<_>>::some_item;
    };

    /// Bộ đệm mật khẩu là `Zeroizing` (xóa khi drop): kiểm lúc biên dịch.
    const _: fn(&str, &str) -> Zeroizing<Vec<u8>> = login_body;

    /// T068: token chỉ nằm trong bộ nhớ Rust: `SessionInfo` không có token; `Debug` che token; token
    /// sai dạng bị từ chối.
    #[test]
    fn the_token_never_leaves_rust() {
        let token = format!("mats_{}", "A".repeat(43));
        let t = SessionToken::parse(&token).unwrap();
        assert!(!format!("{t:?}").contains(&token));
        let h = t.header();
        assert!(h.is_sensitive());
        assert_eq!(h.to_str().unwrap(), format!("Bearer {token}"));
        for bad in [
            "",
            "mats_",
            "Bearer mats_x",
            "mats_a b",
            "mats_a\r\nX-Evil: 1",
            "xyz_abc",
        ] {
            assert!(SessionToken::parse(bad).is_none(), "{bad:?}");
        }
        assert!(SessionToken::parse(&format!("mats_{}", "a".repeat(300))).is_none());
        let s = test_session("kysu1");
        let v = serde_json::to_value(&s.info).unwrap();
        assert_eq!(
            v,
            json!({ "user": "kysu1", "role": "engineer", "idleTimeoutS": 1800,
                    "maxLifetimeS": 43200, "identity": {} })
        );
    }

    /// T068: thân đăng nhập đúng JSON, thoát ký tự đặc biệt, không cấp lại bộ đệm giữa chừng.
    #[test]
    fn login_body_is_json_in_a_zeroizing_buffer() {
        let body = login_body("kysu1", "mật \"khẩu\"\n\u{1}");
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            v,
            json!({ "user": "kysu1", "password": "mật \"khẩu\"\n\u{1}" })
        );
        let long = "\u{1}".repeat(512);
        let body = login_body(&"u".repeat(64), &long);
        assert!(body.capacity() >= body.len());
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["password"], long);
    }

    /// T068: ánh xạ lỗi của `device_login` theo bảng §5 và lỗi của `device_get` theo §6.
    #[test]
    fn status_mapping_tables() {
        let err =
            |code: &str| serde_json::to_vec(&json!({ "error": code, "message": "x" })).unwrap();
        assert_eq!(login_failure(401, &err("AUTH_FAILED"), None), E::AuthFailed);
        assert_eq!(login_failure(401, b"", None), E::AuthFailed);
        let locked =
            serde_json::to_vec(&json!({ "error": "AUTH_LOCKED", "retryAfterS": 287 })).unwrap();
        assert_eq!(login_failure(429, &locked, Some("287")), E::Locked(287));
        assert_eq!(
            login_failure(429, &err("AUTH_LOCKED"), Some("120")),
            E::Locked(120)
        );
        assert_eq!(
            login_failure(429, &err("AUTH_BUSY"), Some("2")),
            E::AuthBusy
        );
        assert_eq!(
            login_failure(503, &err("AUDIT_UNAVAILABLE"), None),
            E::AuditUnavailable
        );
        assert_eq!(login_failure(500, b"", None), E::Http(500));

        assert_eq!(
            api_failure(401, &err("AUTH_REQUIRED")),
            (E::AuthRequired, false)
        );
        assert_eq!(
            api_failure(401, &err("SESSION_EXPIRED")),
            (E::SessionExpired, true)
        );
        assert_eq!(
            api_failure(401, &err("SESSION_INVALID")),
            (E::SessionInvalid, true)
        );
        assert_eq!(api_failure(401, b"???"), (E::SessionExpired, true));
        assert_eq!(api_failure(403, &err("FORBIDDEN")), (E::Forbidden, false));
        assert_eq!(
            api_failure(403, &err("HTTPS_REQUIRED")),
            (E::Http(403), false)
        );
        assert_eq!(
            api_failure(404, &err("NO_SUCH_OPERATION")),
            (E::Http(404), false)
        );
        assert_eq!(api_failure(503, b""), (E::Http(503), false));
    }

    /// T068: đăng nhập đúng: `SessionInfo { user, role, idleTimeoutS, maxLifetimeS, identity }`
    /// không có token; token đi trong header `Authorization` ở request sau; mật khẩu và token không
    /// có trong `devices.json`; `lastUser` được lưu.
    #[tokio::test]
    async fn login_keeps_the_token_in_rust_memory() {
        let o = online("login-ok").await;
        let info = o.login().await;
        let token = o.device_token().unwrap();
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["user"], "kysu1");
        assert_eq!(v["role"], "engineer");
        assert_eq!(v["idleTimeoutS"], 1800);
        assert_eq!(v["maxLifetimeS"], 43200);
        assert_eq!(
            v["identity"]["deviceId"],
            crate::device::test_support::DEVICE_ID
        );
        assert!(!v.to_string().contains(&token));
        assert!(!v.as_object().unwrap().contains_key("token"));
        let login = o
            .server
            .requests()
            .into_iter()
            .find(|r| r.path() == "/api/v1/auth/login")
            .unwrap();
        assert_eq!(login.method, "POST");
        assert!(
            login
                .header("content-type")
                .unwrap()
                .starts_with("application/json")
        );
        assert!(login.bearer().is_none());
        assert_eq!(o.manager.session(&o.id).await.unwrap(), Some(info.clone()));
        let check = o.server.requests().last().unwrap().clone();
        assert_eq!(check.path(), "/api/v1/auth/session");
        assert_eq!(check.bearer(), Some(token.as_str()));
        let saved = o.manager.list().remove(0);
        assert_eq!(saved.last_user.as_deref(), Some("kysu1"));
        assert_eq!(
            saved.device_id.as_deref(),
            Some(crate::device::test_support::DEVICE_ID)
        );
        assert_eq!(saved.last_runtime.as_deref(), Some("0.4.0"));
        let disk = o.dir.all_bytes();
        assert!(!contains(&disk, &o.password()), "mật khẩu trong file");
        assert!(!contains(&disk, &token), "token trong file");
    }

    /// T068: lỗi của `device_login` theo bảng §5; `setup-required` trước khi gửi mật khẩu.
    #[tokio::test]
    async fn login_error_mapping() {
        let o = online("login-errors").await;
        let login = |user: &'static str, pw: String| {
            let m = &o.manager;
            let id = o.id.clone();
            async move { m.login(&id, user, Zeroizing::new(pw)).await }
        };
        assert_eq!(login("kysu1", "sai".into()).await, Err(E::AuthFailed));
        assert_eq!(login("khong-co", o.password()).await, Err(E::AuthFailed));
        assert_eq!(login("khoa", o.password()).await, Err(E::Locked(287)));
        assert_eq!(login("ban", o.password()).await, Err(E::AuthBusy));
        assert_eq!(login("audit", o.password()).await, Err(E::AuditUnavailable));
        assert!(o.manager.sessions().info(&o.id).is_none());
        o.state.lock().unwrap().setup_required = true;
        let before = o.server.requests().len();
        assert_eq!(login("kysu1", o.password()).await, Err(E::SetupRequired));
        let after: Vec<String> = o.server.requests()[before..]
            .iter()
            .map(|r| r.path().to_string())
            .collect();
        assert_eq!(
            after,
            ["/api/v1/device/identity"],
            "không gửi mật khẩu khi chưa có tài khoản"
        );
        assert_eq!(
            o.manager
                .login("không-có", "kysu1", Zeroizing::new(o.password()))
                .await,
            Err(E::NoSuchDevice)
        );
    }

    /// T068: chưa ghim → `cert-unpinned` (không kết nối); chứng chỉ đổi → `{ cert-mismatch:
    /// { pinned, seen } }`; thiết bị tắt → `unreachable` (hạn thật); không trả lời → `timeout` (hạn
    /// request thu ngắn trong test).
    #[tokio::test]
    async fn login_needs_a_matching_pin_and_a_reachable_device() {
        let mut o = online("login-net").await;
        let pin = o.cert.fingerprint.clone();
        let before = o.server.requests().len();
        o.manager.unpin(&o.id, &pin).unwrap();
        assert_eq!(
            o.manager
                .login(&o.id, "kysu1", Zeroizing::new(o.password()))
                .await,
            Err(E::CertUnpinned)
        );
        assert_eq!(o.server.requests().len(), before);
        o.manager.probe(&o.id, |_| None).await.unwrap();
        o.manager.pin(&o.id, &pin).unwrap();

        let other = TestCert::new();
        let impostor = http_server(Some(other.server_config(TLS_ALL)), |_| {
            Resp::json(200, json!({ "setupRequired": false }))
        })
        .await;
        let move_to = |port: u16| crate::device::registry::DevicePatch {
            https_port: Some(i64::from(port)),
            ..Default::default()
        };
        o.manager.update(&o.id, move_to(impostor.port)).unwrap();
        assert_eq!(
            o.manager
                .login(&o.id, "kysu1", Zeroizing::new(o.password()))
                .await,
            Err(E::CertMismatch {
                pinned: pin.clone(),
                seen: other.fingerprint.clone()
            })
        );
        assert!(
            impostor.requests().is_empty(),
            "mật khẩu không tới máy giả mạo"
        );
        o.manager
            .update(&o.id, move_to(closed_port().await))
            .unwrap();
        assert_eq!(
            o.manager
                .login(&o.id, "kysu1", Zeroizing::new(o.password()))
                .await,
            Err(E::Unreachable)
        );
        o.manager.http_timeouts = HttpTimeouts {
            connect: Duration::from_secs(3),
            request: Duration::from_millis(500),
        };
        let silent = silent_tls_server(o.cert.server_config(TLS_ALL)).await;
        o.manager.update(&o.id, move_to(silent.port)).unwrap();
        assert_eq!(
            o.manager
                .login(&o.id, "kysu1", Zeroizing::new(o.password()))
                .await,
            Err(E::Timeout)
        );
    }

    /// T068: `device_logout` luôn bỏ token phía Rust: thiết bị trả lời thì nhận `POST
    /// /api/v1/auth/logout` có token; thiết bị không trả lời vẫn bỏ.
    #[tokio::test]
    async fn logout_always_drops_the_token() {
        let o = online("logout").await;
        o.login().await;
        let token = o.device_token().unwrap();
        o.manager.logout(&o.id).await;
        assert!(o.manager.sessions().info(&o.id).is_none());
        let req = o.server.requests().last().unwrap().clone();
        assert_eq!(
            (req.method.as_str(), req.path()),
            ("POST", "/api/v1/auth/logout")
        );
        assert_eq!(req.bearer(), Some(token.as_str()));
        assert_eq!(o.device_token(), None);
        assert_eq!(o.manager.session(&o.id).await, Ok(None));

        o.login().await;
        o.manager
            .update(
                &o.id,
                crate::device::registry::DevicePatch {
                    name: Some("Trạm 1".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(o.manager.sessions().info(&o.id).is_some());
        let silent = silent_tls_server(o.cert.server_config(TLS_ALL)).await;
        // Đổi cổng tự bỏ phiên; dựng lại phiên để thử đăng xuất khi thiết bị im lặng.
        o.manager
            .update(
                &o.id,
                crate::device::registry::DevicePatch {
                    https_port: Some(i64::from(silent.port)),
                    ..Default::default()
                },
            )
            .unwrap();
        o.manager.sessions().put(&o.id, test_session("kysu1"));
        let started = std::time::Instant::now();
        o.manager.logout(&o.id).await;
        assert!(o.manager.sessions().info(&o.id).is_none());
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        o.manager.logout("không-có").await;
    }

    /// T068: `device_session`: không có token → `null`; thiết bị báo phiên hết hạn → bỏ token,
    /// `null`.
    #[tokio::test]
    async fn session_is_checked_on_the_device() {
        let o = online("session").await;
        assert_eq!(o.manager.session(&o.id).await, Ok(None));
        let info = o.login().await;
        assert_eq!(o.manager.session(&o.id).await, Ok(Some(info)));
        o.state.lock().unwrap().token = None;
        assert_eq!(o.manager.session(&o.id).await, Ok(None));
        assert!(o.manager.sessions().info(&o.id).is_none());
    }
}
