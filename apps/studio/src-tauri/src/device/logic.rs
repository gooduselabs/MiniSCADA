//! Logic v2 của thiết bị (feature 011, T145; FR-083, FR-096; contracts/device-api-011.md §4):
//! - `logic_get`: `GET /api/v1/logic` (viewer): trạng thái từng khối, ghi PLC, vòng quét;
//! - `logic_writes_stop`: `POST /api/v1/logic/writes {"enabled": false}` (administrator): dừng ngay mọi ghi PLC
//!   của logic, giữ qua khởi động lại. Thân CỐ ĐỊNH: không có lệnh nào của Studio gửi `{"enabled": true}` (bật lại
//!   chỉ bằng `runtime.json` của root; API trả 403 `LOGIC_ENABLE_ROOT_ONLY`);
//! - `logic_reset`: `POST /api/v1/logic/reset {"id", "value"}` (engineer): đặt lại counter, totalizer, giờ chạy.
//!
//! Đi qua phiên có sẵn (token chỉ ở Rust) và HTTPS có ghim của `DeviceManager`. Không tự gửi lại khi lỗi mạng
//! (lệnh có thể đã được nhận). 401 `SESSION_*` bỏ token như `device_get`/`device_post`.

use super::http::{self, ApiResult, device_url};
use super::session;
use super::{DeviceError, DeviceManager};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};
use std::time::Duration;
use tauri::State;

pub const LOGIC_PATH: &str = "/api/v1/logic";
pub const LOGIC_WRITES_PATH: &str = "/api/v1/logic/writes";
pub const LOGIC_RESET_PATH: &str = "/api/v1/logic/reset";
/// Hạn của một lệnh logic (thiết bị ghi audit bền trước khi trả lời).
const LOGIC_TIMEOUT: Duration = Duration::from_secs(10);
/// Id khối của logic.json (contracts/logic-engine.md §1).
fn valid_block_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 48
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

impl DeviceManager {
    /// `GET /api/v1/logic` kèm token.
    pub async fn logic_get(&self, id: &str) -> Result<ApiResult, DeviceError> {
        let device = self.registry.get(id)?;
        let (status, body) = self.send_get(&device, LOGIC_PATH, None, true).await?;
        if (200..300).contains(&status) {
            let body = if body.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&body).map_err(|_| DeviceError::BadResponse)?
            };
            return Ok(ApiResult { status, body });
        }
        let (error, drop_token) = session::api_failure(status, &body);
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }

    /// "Dừng ghi của logic": thân luôn là `{"enabled": false}`.
    pub async fn logic_writes_stop(&self, id: &str) -> Result<ApiResult, DeviceError> {
        self.logic_post(id, LOGIC_WRITES_PATH, &json!({ "enabled": false }))
            .await
    }

    /// Đặt lại giá trị giữ của một khối (counter, totalizer, giờ chạy): id đúng dạng, giá trị hữu hạn ≥ 0.
    pub async fn logic_reset(
        &self,
        id: &str,
        block: &str,
        value: f64,
    ) -> Result<ApiResult, DeviceError> {
        if !valid_block_id(block) || !value.is_finite() || value < 0.0 {
            return Err(DeviceError::BadArgs);
        }
        let v = if value.fract() == 0.0 && value <= 9_007_199_254_740_991.0 {
            json!(value as u64)
        } else {
            json!(value)
        };
        self.logic_post(id, LOGIC_RESET_PATH, &json!({ "id": block, "value": v }))
            .await
    }

    async fn logic_post(
        &self,
        id: &str,
        path: &str,
        body: &Value,
    ) -> Result<ApiResult, DeviceError> {
        let bytes = serde_json::to_vec(body).map_err(|_| DeviceError::BadResponse)?;
        let device = self.registry.get(id)?;
        let client = self.client_for(&device)?;
        let url = device_url("https", &device.host, device.https_port, path, None)?;
        let timeout = if self.http_timeouts == http::HttpTimeouts::default() {
            LOGIC_TIMEOUT
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
        let raw = http::read_body(resp, http::MAX_BODY, Some(&client.verifier)).await?;
        if (200..300).contains(&status) {
            let body = if raw.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&raw).map_err(|_| DeviceError::BadResponse)?
            };
            return Ok(ApiResult { status, body });
        }
        if status == 403 && http::error_code(&raw).as_deref() == Some("LOGIC_ENABLE_ROOT_ONLY") {
            return Err(DeviceError::LogicEnableRootOnly);
        }
        let (error, drop_token) = session::api_failure(status, &raw);
        if drop_token {
            self.sessions.remove(id);
        }
        Err(error)
    }
}

// ---- Lệnh Tauri ----

/// `logic_get({ id }) → { status, body }`
#[tauri::command]
pub async fn logic_get(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.logic_get(&id).await
}

/// `logic_writes_stop({ id }) → { status, body }` (administrator; không có lệnh bật lại).
#[tauri::command]
pub async fn logic_writes_stop(
    id: String,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.logic_writes_stop(&id).await
}

/// `logic_reset({ id, block, value }) → { status, body }` (engineer).
#[tauri::command]
pub async fn logic_reset(
    id: String,
    block: String,
    value: f64,
    devices: State<'_, DeviceManager>,
) -> Result<ApiResult, DeviceError> {
    devices.logic_reset(&id, &block, value).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::test_support::{Online, Req, Resp, online_with};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    /// Thiết bị giả theo contract §4: phiên và role theo token đã cấp (đăng nhập `kysu1` là engineer), `role`
    /// đổi được; ghi lại thân các POST logic.
    struct Logic {
        role: &'static str,
        stopped: bool,
        bodies: Vec<(String, Value)>,
        expire_next: bool,
    }

    async fn device(name: &str) -> (Online, Arc<Mutex<Logic>>) {
        let st = Arc::new(Mutex::new(Logic {
            role: "engineer",
            stopped: false,
            bodies: Vec::new(),
            expire_next: false,
        }));
        let s = st.clone();
        let o = online_with(name, move |req: &Req| {
            let path = req.path();
            if !path.starts_with("/api/v1/logic") {
                return None;
            }
            let mut g = s.lock().unwrap();
            if req.bearer().is_none() {
                return Some(Resp::error(401, "AUTH_REQUIRED"));
            }
            if g.expire_next {
                g.expire_next = false;
                return Some(Resp::error(401, "SESSION_EXPIRED"));
            }
            let rank = |r: &str| match r {
                "viewer" => 0,
                "operator" => 1,
                "engineer" => 2,
                _ => 3,
            };
            match (req.method.as_str(), path) {
                ("GET", "/api/v1/logic") => Some(Resp::json(
                    200,
                    json!({
                        "enabled": true,
                        "writes": { "configured": "on", "runtimeEnabled": !g.stopped, "perMinute": 3, "limitPerMinute": 20 },
                        "scan": { "periodMs": 100, "lastMs": 1.8, "p99Ms": 3.1 },
                        "blocks": [ { "id": "pump_low_level", "kind": "rule", "state": "OK", "fired": 14, "reason": null } ]
                    }),
                )),
                ("POST", "/api/v1/logic/writes") => {
                    let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
                    g.bodies.push((path.into(), body.clone()));
                    if body.get("enabled") == Some(&Value::Bool(true)) {
                        return Some(Resp::error(403, "LOGIC_ENABLE_ROOT_ONLY"));
                    }
                    if rank(g.role) < 3 {
                        return Some(Resp::error(403, "FORBIDDEN"));
                    }
                    g.stopped = true;
                    Some(Resp::json(200, json!({ "enabled": false })))
                }
                ("POST", "/api/v1/logic/reset") => {
                    let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
                    g.bodies.push((path.into(), body.clone()));
                    if rank(g.role) < 2 {
                        return Some(Resp::error(403, "FORBIDDEN"));
                    }
                    Some(Resp::json(200, body))
                }
                _ => Some(Resp::error(404, "NOT_FOUND")),
            }
        })
        .await;
        (o, st)
    }

    #[tokio::test]
    async fn get_reads_the_status_with_the_session_token() {
        let (o, _) = device("logic-get").await;
        assert_eq!(
            o.manager.logic_get(&o.id).await,
            Err(DeviceError::AuthRequired),
            "chưa đăng nhập"
        );
        o.login().await;
        let r = o.manager.logic_get(&o.id).await.unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body["writes"]["limitPerMinute"], 20);
        assert_eq!(r.body["blocks"][0]["id"], "pump_low_level");
        let req = o
            .server
            .requests()
            .into_iter()
            .rfind(|r| r.path() == LOGIC_PATH)
            .unwrap();
        assert_eq!(req.method, "GET");
        assert_eq!(req.bearer(), o.device_token().as_deref());
        assert_eq!(
            o.manager.logic_get("không-có").await,
            Err(DeviceError::NoSuchDevice)
        );
    }

    #[tokio::test]
    async fn stop_always_sends_enabled_false_and_needs_administrator() {
        let (o, st) = device("logic-stop").await;
        o.login().await;
        // engineer: 403 FORBIDDEN, giữ phiên.
        assert_eq!(
            o.manager.logic_writes_stop(&o.id).await,
            Err(DeviceError::Forbidden)
        );
        assert!(o.manager.sessions().header(&o.id).is_some());
        st.lock().unwrap().role = "administrator";
        let r = o.manager.logic_writes_stop(&o.id).await.unwrap();
        assert_eq!(r.status, 200);
        assert!(st.lock().unwrap().stopped);
        let bodies = st.lock().unwrap().bodies.clone();
        assert_eq!(bodies.len(), 2);
        for (path, body) in bodies {
            assert_eq!(path, LOGIC_WRITES_PATH);
            assert_eq!(
                body,
                json!({ "enabled": false }),
                "không bao giờ gửi enabled: true"
            );
        }
        let req = o
            .server
            .requests()
            .into_iter()
            .rfind(|r| r.path() == LOGIC_WRITES_PATH)
            .unwrap();
        assert_eq!(req.method, "POST");
        assert!(
            req.header("content-type")
                .is_some_and(|v| v.starts_with("application/json"))
        );
        assert_eq!(req.bearer(), o.device_token().as_deref());
    }

    #[tokio::test]
    async fn reset_sends_the_block_and_value_and_checks_arguments() {
        let (o, st) = device("logic-reset").await;
        o.login().await;
        let r = o.manager.logic_reset(&o.id, "h_pump", 0.0).await.unwrap();
        assert_eq!(r.body, json!({ "id": "h_pump", "value": 0 }));
        let before = st.lock().unwrap().bodies.len();
        for (block, value) in [
            ("Bơm", 0.0),
            ("", 0.0),
            ("1abc", 0.0),
            ("h_pump", -1.0),
            ("h_pump", f64::NAN),
            ("h_pump", f64::INFINITY),
        ] {
            assert_eq!(
                o.manager.logic_reset(&o.id, block, value).await,
                Err(DeviceError::BadArgs),
                "{block} {value}"
            );
        }
        assert_eq!(st.lock().unwrap().bodies.len(), before, "không gửi gì");
        st.lock().unwrap().role = "viewer";
        assert_eq!(
            o.manager.logic_reset(&o.id, "h_pump", 0.0).await,
            Err(DeviceError::Forbidden)
        );
    }

    #[tokio::test]
    async fn expired_session_drops_the_token_and_old_runtime_is_404() {
        let (o, st) = device("logic-expired").await;
        o.login().await;
        st.lock().unwrap().expire_next = true;
        assert_eq!(
            o.manager.logic_writes_stop(&o.id).await,
            Err(DeviceError::SessionExpired)
        );
        assert!(o.manager.sessions().header(&o.id).is_none(), "bỏ token");

        // Runtime cũ không có /api/v1/logic: 404.
        let old = online_with("logic-old", |req: &Req| {
            req.path()
                .starts_with("/api/v1/logic")
                .then(|| Resp::error(404, "NOT_FOUND"))
        })
        .await;
        old.login().await;
        assert_eq!(
            old.manager.logic_get(&old.id).await,
            Err(DeviceError::Http(404))
        );
    }

    #[test]
    fn block_ids_follow_the_contract() {
        for ok in ["a", "h_pump", "pump_low_level", &"a".repeat(48)] {
            assert!(valid_block_id(ok), "{ok}");
        }
        for bad in ["", "A", "_a", "a-b", "a.b", &"a".repeat(49), "bơm"] {
            assert!(!valid_block_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_enable_refusal_has_its_own_error() {
        assert_eq!(
            serde_json::to_value(DeviceError::LogicEnableRootOnly).unwrap(),
            json!("logic-enable-root-only")
        );
        assert_eq!(
            serde_json::to_value(DeviceError::BadArgs).unwrap(),
            json!("bad-args")
        );
    }
}
