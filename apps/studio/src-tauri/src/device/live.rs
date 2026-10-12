//! Dữ liệu sống `/api/v1/live` qua Rust (contracts/tauri-commands.md §7, research R6).
//!
//! - `{ id }`: `wss://host:httpsPort/api/v1/live` trên luồng `tokio-rustls` dùng `PinnedVerifier`.
//!   Không gửi token (endpoint công khai, FR-033; hỏi định kỳ không được làm mới hạn phiên).
//! - `{ address }`: `ws://host:port/api/v1/live` (chế độ theo dõi chỉ đọc của 004).
//! - Không gửi header `Origin` (tungstenite không tự thêm).
//! - Sự kiện `open`, `message`, `close` đẩy qua `tauri::ipc::Channel` đúng thứ tự (một tác vụ mỗi
//!   kết nối). Bắt tay lỗi: `close` mã 1006, `reason` là mã lỗi (`cert-mismatch`, `unreachable`…).

use super::tls::{self, TlsFailure, TlsTimeouts};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

/// Frame text lớn nhất giao diện gửi được (giới hạn của máy chủ).
pub const MAX_SEND: usize = 96 * 1024;
/// Bản tin lớn nhất nhận từ thiết bị.
pub const MAX_INCOMING: usize = 4 * 1024 * 1024;
/// Chờ máy chủ trả frame đóng sau khi `live_close`.
pub const CLOSE_WAIT: Duration = Duration::from_secs(3);
/// Lý do đóng dài nhất (frame điều khiển ≤ 125 byte, gồm 2 byte mã).
const MAX_REASON_BYTES: usize = 123;

/// Đích của `live_open` sau khi tra thiết bị.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveEndpoint {
    /// `wss` có ghim; `pin = None` (chưa ghim) thì đóng ngay với `cert-unpinned`.
    Wss {
        host: String,
        port: u16,
        pin: Option<String>,
    },
    /// `ws` của chế độ theo dõi.
    Ws { host: String, port: u16 },
}

/// Tham số `target` của `live_open`: `{ id }` hoặc `{ address }`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum LiveTarget {
    Id { id: String },
    Address { address: String },
}

/// Sự kiện của một kết nối live.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LiveEvent {
    Open,
    Message { data: String },
    Close { code: u16, reason: String },
}

/// Lỗi của `live_send`: `"too-large"` (> 96 KiB), `"closed"` (kết nối không còn).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LiveError {
    TooLarge,
    Closed,
}

/// Kết quả `live_open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveOpened {
    pub live_id: u32,
}

/// Lệnh từ giao diện tới tác vụ của kết nối.
#[derive(Debug)]
enum Command {
    Send(String),
    Close(u16, String),
}

type Connections = Arc<Mutex<HashMap<u32, mpsc::UnboundedSender<Command>>>>;

/// Khóa chỉ bảo vệ dữ liệu trong bộ nhớ: bỏ qua trạng thái "poisoned".
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// State của Tauri: các kết nối live đang mở.
pub struct LiveHub {
    next: AtomicU32,
    conns: Connections,
    timeouts: TlsTimeouts,
}

impl Default for LiveHub {
    fn default() -> Self {
        Self::with_timeouts(TlsTimeouts::default())
    }
}

impl LiveHub {
    pub fn with_timeouts(timeouts: TlsTimeouts) -> Self {
        LiveHub {
            next: AtomicU32::new(1),
            conns: Arc::new(Mutex::new(HashMap::new())),
            timeouts,
        }
    }

    /// Mở kết nối trong một tác vụ riêng (cần runtime tokio); trả `liveId` ngay, sự kiện đi qua
    /// `sink`. Kết nối kết thúc thì rời bảng.
    pub fn open(
        &self,
        endpoint: LiveEndpoint,
        sink: impl Fn(LiveEvent) + Send + Sync + 'static,
    ) -> u32 {
        let live_id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::unbounded_channel();
        lock(&self.conns).insert(live_id, tx);
        let conns = self.conns.clone();
        let timeouts = self.timeouts;
        tokio::spawn(async move {
            run(endpoint, timeouts, &sink, rx).await;
            lock(&conns).remove(&live_id);
        });
        live_id
    }

    /// Gửi frame text; > 96 KiB → `too-large`; kết nối không còn → `closed`. Gửi trước khi mở xong
    /// thì xếp hàng, gửi ngay sau `open`.
    pub fn send(&self, live_id: u32, text: String) -> Result<(), LiveError> {
        if text.len() > MAX_SEND {
            return Err(LiveError::TooLarge);
        }
        lock(&self.conns)
            .get(&live_id)
            .ok_or(LiveError::Closed)?
            .send(Command::Send(text))
            .map_err(|_| LiveError::Closed)
    }

    /// Đóng (mặc định 1000; mã không được phép gửi, như 1006, thành 1000; lý do tối đa 123 byte).
    /// Kết nối không còn thì bỏ qua.
    pub fn close(&self, live_id: u32, code: Option<u16>, reason: Option<String>) {
        let code = code
            .filter(|c| *c == 1000 || (3000..=4999).contains(c))
            .unwrap_or(1000);
        let mut reason = reason.unwrap_or_default();
        while reason.len() > MAX_REASON_BYTES {
            reason.pop();
        }
        if let Some(tx) = lock(&self.conns).get(&live_id) {
            let _ = tx.send(Command::Close(code, reason));
        }
    }

    /// Kết nối còn trong bảng.
    #[cfg(test)]
    pub fn is_open(&self, live_id: u32) -> bool {
        lock(&self.conns).contains_key(&live_id)
    }
}

fn closed(code: u16, reason: &str) -> LiveEvent {
    LiveEvent::Close {
        code,
        reason: reason.to_string(),
    }
}

/// Mã lỗi đặt vào `reason` khi bắt tay TLS lỗi (cùng mã với `DeviceError`).
fn failure_code(e: &TlsFailure) -> &'static str {
    match e {
        TlsFailure::Unreachable => "unreachable",
        TlsFailure::Timeout => "timeout",
        TlsFailure::NotTls => "not-tls",
        TlsFailure::CertMismatch { .. } => "cert-mismatch",
        TlsFailure::Tls(_) => "tls",
    }
}

/// Mã lỗi khi bắt tay WebSocket lỗi: máy chủ từ chối nâng cấp (`http`), mất kết nối
/// (`unreachable`), trả lời sai giao thức (`bad-response`).
fn ws_failure_code(e: &WsError) -> &'static str {
    match e {
        WsError::Http(_) => "http",
        WsError::Io(_) | WsError::ConnectionClosed | WsError::AlreadyClosed => "unreachable",
        _ => "bad-response",
    }
}

/// Một kết nối từ đầu tới cuối; sự kiện cuối luôn là `close`.
async fn run(
    endpoint: LiveEndpoint,
    timeouts: TlsTimeouts,
    sink: &(impl Fn(LiveEvent) + Send + Sync),
    commands: mpsc::UnboundedReceiver<Command>,
) {
    match endpoint {
        LiveEndpoint::Wss { host, port, pin } => {
            let Some(pin) = pin else {
                return sink(closed(1006, "cert-unpinned"));
            };
            match tls::connect_pinned(&host, port, &pin, timeouts).await {
                Ok(stream) => {
                    let url = format!("wss://{host}:{port}/api/v1/live");
                    talk(url, stream, timeouts, sink, commands).await;
                }
                Err(e) => sink(closed(1006, failure_code(&e))),
            }
        }
        LiveEndpoint::Ws { host, port } => {
            match tls::connect_tcp(&host, port, timeouts.connect).await {
                Ok(tcp) => {
                    let _ = tcp.set_nodelay(true);
                    let url = format!("ws://{host}:{port}/api/v1/live");
                    talk(url, tcp, timeouts, sink, commands).await;
                }
                Err(e) => sink(closed(1006, failure_code(&e))),
            }
        }
    }
}

/// Bắt tay WebSocket rồi chuyển tin hai chiều tới khi đóng.
async fn talk<S: AsyncRead + AsyncWrite + Unpin>(
    url: String,
    stream: S,
    timeouts: TlsTimeouts,
    sink: &(impl Fn(LiveEvent) + Send + Sync),
    mut commands: mpsc::UnboundedReceiver<Command>,
) {
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_INCOMING))
        .max_frame_size(Some(MAX_INCOMING));
    let handshake = tokio_tungstenite::client_async_with_config(url, stream, Some(config));
    let mut ws = match tokio::time::timeout(timeouts.handshake, handshake).await {
        Err(_) => return sink(closed(1006, "timeout")),
        Ok(Err(e)) => return sink(closed(1006, ws_failure_code(&e))),
        Ok(Ok((ws, _response))) => ws,
    };
    sink(LiveEvent::Open);
    // Sau `live_close`: hạn chờ frame đóng của máy chủ, mã và lý do đã gửi.
    let mut closing: Option<(tokio::time::Instant, u16, String)> = None;
    loop {
        let close_deadline = closing.as_ref().map(|c| c.0);
        tokio::select! {
            incoming = ws.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    // Đang đóng (như trình duyệt ở trạng thái CLOSING): không đẩy tin nữa.
                    if closing.is_none() {
                        sink(LiveEvent::Message { data: text.to_string() });
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    let (code, reason) = frame.map_or((1005, String::new()), |f| {
                        (u16::from(f.code), f.reason.to_string())
                    });
                    // Gửi nốt frame đóng trả lời (máy chủ đóng trước) rồi kết thúc.
                    let _ = tokio::time::timeout(Duration::from_secs(1), ws.close(None)).await;
                    return sink(closed(code, &reason));
                }
                // Binary, ping (tungstenite tự trả pong), pong: bỏ qua.
                Some(Ok(_)) => {}
                Some(Err(_)) | None => {
                    return match closing {
                        Some((_, code, reason)) => sink(closed(code, &reason)),
                        None => sink(closed(1006, "")),
                    };
                }
            },
            command = commands.recv(), if closing.is_none() => match command {
                Some(Command::Send(text)) => {
                    if ws.send(Message::text(text)).await.is_err() {
                        return sink(closed(1006, ""));
                    }
                }
                Some(Command::Close(code, reason)) => {
                    let frame = CloseFrame {
                        code: CloseCode::from(code),
                        reason: reason.clone().into(),
                    };
                    let _ = ws.send(Message::Close(Some(frame))).await;
                    closing = Some((tokio::time::Instant::now() + CLOSE_WAIT, code, reason));
                }
                // Bảng kết nối bị bỏ (đóng Studio): đóng, không còn ai nhận sự kiện.
                None => {
                    let _ = tokio::time::timeout(Duration::from_secs(1), ws.close(None)).await;
                    return;
                }
            },
            () = async {
                match close_deadline {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                // Máy chủ không trả frame đóng trong hạn: báo đóng với mã đã gửi.
                if let Some((_, code, reason)) = closing.take() {
                    return sink(closed(code, &reason));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::DeviceError;
    use crate::device::registry::NewDevice;
    use crate::device::test_support::{
        TLS_ALL, TempDir, TestCert, closed_port, plain_http_port, ws_server,
    };
    use crate::device::{DeviceManager, session};
    use serde_json::json;

    type Events = Arc<Mutex<Vec<LiveEvent>>>;

    fn collector() -> (Events, impl Fn(LiveEvent) + Send + Sync + 'static) {
        let events: Events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        (events, move |e| sink.lock().unwrap().push(e))
    }

    /// Chờ tối đa 5 s tới khi có ít nhất `n` sự kiện.
    async fn wait_for(events: &Events, n: usize) -> Vec<LiveEvent> {
        for _ in 0..500 {
            let got = events.lock().unwrap().clone();
            if got.len() >= n {
                return got;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        events.lock().unwrap().clone()
    }

    fn msg(s: &str) -> LiveEvent {
        LiveEvent::Message { data: s.into() }
    }

    /// T070: `{ id }` mở `wss://…/api/v1/live` có ghim; không gửi token (kể cả khi đã đăng nhập),
    /// không gửi `Origin`; sự kiện `open`, `message`, `close` đúng thứ tự; `live_send` tới máy chủ;
    /// máy chủ đóng thì `close` mang mã và lý do của máy chủ.
    #[tokio::test]
    async fn wss_by_id_with_pin_without_token_or_origin() {
        let dir = TempDir::new("live-wss");
        let m = DeviceManager::new(dir.file("devices.json"));
        let cert = TestCert::new();
        let srv = ws_server(Some(cert.server_config(TLS_ALL))).await;
        let dev = m
            .add(NewDevice {
                host: "127.0.0.1".into(),
                https_port: Some(i64::from(srv.port)),
                ..NewDevice::default()
            })
            .unwrap();
        assert_eq!(
            m.probe(&dev.id, |_| None).await.unwrap().fingerprint,
            cert.fingerprint
        );
        m.pin(&dev.id, &cert.fingerprint).unwrap();
        m.sessions().put(&dev.id, session::test_session("kysu1"));
        let endpoint = m
            .live_endpoint(&LiveTarget::Id { id: dev.id.clone() })
            .unwrap();
        assert_eq!(
            endpoint,
            LiveEndpoint::Wss {
                host: "127.0.0.1".into(),
                port: srv.port,
                pin: Some(cert.fingerprint.clone())
            }
        );
        let hub = LiveHub::default();
        let (events, sink) = collector();
        let id = hub.open(endpoint, sink);
        assert_eq!(wait_for(&events, 2).await, [LiveEvent::Open, msg("hello")]);
        assert!(hub.is_open(id));
        hub.send(id, "ping".into()).unwrap();
        assert_eq!(wait_for(&events, 3).await[2], msg("echo:ping"));
        hub.send(id, "bye-please".into()).unwrap();
        let all = wait_for(&events, 4).await;
        assert_eq!(
            all,
            [
                LiveEvent::Open,
                msg("hello"),
                msg("echo:ping"),
                LiveEvent::Close {
                    code: 4000,
                    reason: "bye".into()
                }
            ]
        );
        let (path, headers) = srv.upgrades.lock().unwrap()[0].clone();
        assert_eq!(path, "/api/v1/live");
        let names: Vec<String> = headers
            .iter()
            .map(|(k, _)| k.to_ascii_lowercase())
            .collect();
        assert!(!names.contains(&"origin".to_string()), "{names:?}");
        assert!(!names.contains(&"authorization".to_string()), "{names:?}");
        assert!(!names.contains(&"cookie".to_string()), "{names:?}");
        assert_eq!(
            srv.received.lock().unwrap().clone(),
            ["ping".to_string(), "bye-please".to_string()]
        );
        for _ in 0..100 {
            if !hub.is_open(id) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!hub.is_open(id), "kết nối đã đóng phải rời bảng");
        assert_eq!(hub.send(id, "x".into()), Err(LiveError::Closed));
    }

    /// T070: bắt tay lỗi → chỉ một sự kiện `close` mã 1006, `reason` là mã lỗi: chứng chỉ khác ghim
    /// (`cert-mismatch`), chưa ghim (`cert-unpinned`), cổng đóng (`unreachable`), cổng HTTP thường
    /// (`not-tls`).
    #[tokio::test]
    async fn handshake_failures_close_with_1006() {
        let cert = TestCert::new();
        let srv = ws_server(Some(cert.server_config(TLS_ALL))).await;
        let http = plain_http_port().await;
        let closed = closed_port().await;
        let hub = LiveHub::default();
        let host = "127.0.0.1".to_string();
        for (endpoint, reason) in [
            (
                LiveEndpoint::Wss {
                    host: host.clone(),
                    port: srv.port,
                    pin: Some("0".repeat(64)),
                },
                "cert-mismatch",
            ),
            (
                LiveEndpoint::Wss {
                    host: host.clone(),
                    port: srv.port,
                    pin: None,
                },
                "cert-unpinned",
            ),
            (
                LiveEndpoint::Wss {
                    host: host.clone(),
                    port: closed,
                    pin: Some(cert.fingerprint.clone()),
                },
                "unreachable",
            ),
            (
                LiveEndpoint::Wss {
                    host: host.clone(),
                    port: http.port,
                    pin: Some(cert.fingerprint.clone()),
                },
                "not-tls",
            ),
        ] {
            let (events, sink) = collector();
            hub.open(endpoint, sink);
            let got = wait_for(&events, 1).await;
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert_eq!(
                events.lock().unwrap().clone(),
                [LiveEvent::Close {
                    code: 1006,
                    reason: reason.into()
                }],
                "{reason}: {got:?}"
            );
        }
        assert!(srv.upgrades.lock().unwrap().is_empty());
    }

    /// T070: `{ address }` mở `ws://…/api/v1/live` (chế độ theo dõi), không TLS, không token.
    #[tokio::test]
    async fn ws_by_address_for_monitor_mode() {
        let dir = TempDir::new("live-ws");
        let m = DeviceManager::new(dir.file("devices.json"));
        let srv = ws_server(None).await;
        let endpoint = m
            .live_endpoint(&LiveTarget::Address {
                address: format!("http://127.0.0.1:{}", srv.port),
            })
            .unwrap();
        assert_eq!(
            endpoint,
            LiveEndpoint::Ws {
                host: "127.0.0.1".into(),
                port: srv.port
            }
        );
        let hub = LiveHub::default();
        let (events, sink) = collector();
        let id = hub.open(endpoint, sink);
        assert_eq!(wait_for(&events, 2).await, [LiveEvent::Open, msg("hello")]);
        hub.send(id, "x".into()).unwrap();
        assert_eq!(wait_for(&events, 3).await[2], msg("echo:x"));
        let (path, headers) = srv.upgrades.lock().unwrap()[0].clone();
        assert_eq!(path, "/api/v1/live");
        assert!(
            headers
                .iter()
                .all(|(k, _)| !k.eq_ignore_ascii_case("origin"))
        );
        assert_eq!(
            m.live_endpoint(&LiveTarget::Address {
                address: "https://127.0.0.1:8443".into()
            }),
            Err(DeviceError::BadAddress)
        );
        assert_eq!(
            m.live_endpoint(&LiveTarget::Id {
                id: "không-có".into()
            }),
            Err(DeviceError::NoSuchDevice)
        );
    }

    /// T070: `live_send` > 96 KiB → `too-large` (96 KiB vừa đủ thì gửi được); `live_close` mặc định
    /// mã 1000, máy chủ nhận đúng mã; mã ngoài 1000, 3000–4999 thành 1000.
    #[tokio::test]
    async fn send_limit_and_close_codes() {
        let srv = ws_server(None).await;
        let hub = LiveHub::default();
        let endpoint = LiveEndpoint::Ws {
            host: "127.0.0.1".into(),
            port: srv.port,
        };
        let (events, sink) = collector();
        let id = hub.open(endpoint.clone(), sink);
        wait_for(&events, 2).await;
        assert_eq!(
            hub.send(id, "a".repeat(MAX_SEND + 1)),
            Err(LiveError::TooLarge)
        );
        hub.send(id, "a".repeat(MAX_SEND)).unwrap();
        let got = wait_for(&events, 3).await;
        assert!(matches!(&got[2], LiveEvent::Message { data } if data.len() == MAX_SEND + 5));
        hub.close(id, None, None);
        let got = wait_for(&events, 4).await;
        assert_eq!(
            got[3],
            LiveEvent::Close {
                code: 1000,
                reason: String::new()
            }
        );
        assert_eq!(srv.wait_closes(1).await, [(1000, String::new())]);

        let (events, sink) = collector();
        let id = hub.open(endpoint.clone(), sink);
        wait_for(&events, 2).await;
        hub.close(id, Some(4001), Some("rời trang".into()));
        assert_eq!(
            wait_for(&events, 3).await[2],
            LiveEvent::Close {
                code: 4001,
                reason: "rời trang".into()
            }
        );
        let (events, sink) = collector();
        let id = hub.open(endpoint, sink);
        wait_for(&events, 2).await;
        hub.close(id, Some(1006), None);
        assert!(matches!(
            wait_for(&events, 3).await[2],
            LiveEvent::Close { code: 1000, .. }
        ));
        assert_eq!(
            srv.wait_closes(3).await,
            [
                (1000, String::new()),
                (4001, "rời trang".to_string()),
                (1000, String::new())
            ]
        );
        hub.close(id, None, None);
        hub.close(424_242, None, None);
    }

    /// T070: hình dạng IPC: `target` `{ id }` hoặc `{ address }`; sự kiện `{ kind: … }`; `{ liveId }`;
    /// lỗi kebab-case.
    #[test]
    fn ipc_shapes() {
        let id: LiveTarget = serde_json::from_value(json!({ "id": "abc" })).unwrap();
        assert_eq!(id, LiveTarget::Id { id: "abc".into() });
        let addr: LiveTarget =
            serde_json::from_value(json!({ "address": "http://10.0.0.1:8080" })).unwrap();
        assert_eq!(
            addr,
            LiveTarget::Address {
                address: "http://10.0.0.1:8080".into()
            }
        );
        assert!(serde_json::from_value::<LiveTarget>(json!({ "url": "x" })).is_err());
        assert_eq!(
            serde_json::to_value(LiveEvent::Open).unwrap(),
            json!({ "kind": "open" })
        );
        assert_eq!(
            serde_json::to_value(msg("{}")).unwrap(),
            json!({ "kind": "message", "data": "{}" })
        );
        assert_eq!(
            serde_json::to_value(LiveEvent::Close {
                code: 1006,
                reason: "unreachable".into()
            })
            .unwrap(),
            json!({ "kind": "close", "code": 1006, "reason": "unreachable" })
        );
        assert_eq!(
            serde_json::to_value(LiveOpened { live_id: 7 }).unwrap(),
            json!({ "liveId": 7 })
        );
        assert_eq!(
            serde_json::to_value(LiveError::TooLarge).unwrap(),
            json!("too-large")
        );
        assert_eq!(
            serde_json::to_value(LiveError::Closed).unwrap(),
            json!("closed")
        );
        assert_eq!(MAX_SEND, 96 * 1024);
    }
}
