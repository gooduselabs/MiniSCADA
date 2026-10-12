//! Hạ tầng test của `device/*` (chỉ biên dịch khi test):
//! - chứng chỉ ECDSA P-256 tự ký sinh lúc chạy bằng `rcgen` (không commit khóa);
//! - máy chủ HTTPS/HTTP/WebSocket thử viết tay trên `tokio-rustls` và `tokio-tungstenite`, chỉ nghe
//!   127.0.0.1 (không thêm crate máy chủ);
//! - thiết bị giả theo contracts/device-api.md §3, §6: định danh, đăng nhập, phiên, chẩn đoán.
//!
//! Mật khẩu và token thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo (quy ước "Mật khẩu thử").

use crate::project_fs::sha256_hex;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use rcgen::{CertificateParams, KeyPair};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::sign::{CertifiedKey, SingleCertAndKey};
use rustls::{ServerConfig, SupportedProtocolVersion};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

pub const TLS12: &[&SupportedProtocolVersion] = &[&rustls::version::TLS12];
pub const TLS13: &[&SupportedProtocolVersion] = &[&rustls::version::TLS13];
pub const TLS_ALL: &[&SupportedProtocolVersion] =
    &[&rustls::version::TLS13, &rustls::version::TLS12];

/// `deviceId` của thiết bị giả.
pub const DEVICE_ID: &str = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";

/// Thư mục tạm riêng cho từng test (các test chạy song song), xóa khi drop.
pub struct TempDir(pub std::path::PathBuf);

impl TempDir {
    pub fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let p = std::env::temp_dir().join(format!(
            "mat-dev-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }

    pub fn file(&self, rel: &str) -> std::path::PathBuf {
        self.0.join(rel)
    }

    /// Mọi byte của mọi file trong thư mục (để tìm chuỗi bí mật).
    pub fn all_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut stack = vec![self.0.clone()];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if let Ok(b) = std::fs::read(&p) {
                    out.extend_from_slice(&b);
                }
            }
        }
        out
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `true` nếu `needle` xuất hiện trong `haystack`.
pub fn contains(haystack: &[u8], needle: &str) -> bool {
    !needle.is_empty() && find(haystack, needle.as_bytes()).is_some()
}

/// Thiết bị giả trên HTTPS đã lưu, đã dò và đã ghim trong một `DeviceManager` mới.
pub struct Online {
    pub manager: crate::device::DeviceManager,
    pub server: Server,
    pub state: Arc<Mutex<FakeDevice>>,
    pub cert: TestCert,
    pub id: String,
    pub dir: TempDir,
}

pub async fn online(name: &str) -> Online {
    let dir = TempDir::new(name);
    let manager = crate::device::DeviceManager::new(dir.file("devices.json"));
    let cert = TestCert::new();
    let state = FakeDevice::shared();
    let server = http_server(
        Some(cert.server_config(TLS_ALL)),
        fake_device(state.clone()),
    )
    .await;
    let dev = manager
        .add(crate::device::registry::NewDevice {
            host: "127.0.0.1".into(),
            https_port: Some(i64::from(server.port)),
            ..Default::default()
        })
        .unwrap();
    let probed = manager.probe(&dev.id, |_| None).await.unwrap();
    manager.pin(&dev.id, &probed.fingerprint).unwrap();
    Online {
        manager,
        server,
        state,
        cert,
        id: dev.id,
        dir,
    }
}

/// Như `online`, nhưng `extra` xử lý trước (trả `None` thì thiết bị giả mặc định trả lời): để thử các
/// route `/api/v1/project/*`.
pub async fn online_with(
    name: &str,
    extra: impl Fn(&Req) -> Option<Resp> + Send + Sync + 'static,
) -> Online {
    let dir = TempDir::new(name);
    // Nhịp theo dõi ngắn để test không phải chờ 500 ms mỗi lần hỏi.
    let manager = crate::device::DeviceManager::new(dir.file("devices.json")).with_deploy_timings(
        crate::device::deploy::DeployTimings {
            poll: Duration::from_millis(20),
            lost: Duration::from_millis(600),
        },
    );
    let cert = TestCert::new();
    let state = FakeDevice::shared();
    let base = fake_device(state.clone());
    let server = http_server(Some(cert.server_config(TLS_ALL)), move |req| {
        extra(req).unwrap_or_else(|| base(req))
    })
    .await;
    let dev = manager
        .add(crate::device::registry::NewDevice {
            host: "127.0.0.1".into(),
            https_port: Some(i64::from(server.port)),
            ..Default::default()
        })
        .unwrap();
    let probed = manager.probe(&dev.id, |_| None).await.unwrap();
    manager.pin(&dev.id, &probed.fingerprint).unwrap();
    Online {
        manager,
        server,
        state,
        cert,
        id: dev.id,
        dir,
    }
}

impl Online {
    pub fn password(&self) -> String {
        self.state.lock().unwrap().password.clone()
    }

    pub fn device_token(&self) -> Option<String> {
        self.state.lock().unwrap().token.clone()
    }

    /// Đăng nhập `kysu1` bằng mật khẩu đúng.
    pub async fn login(&self) -> crate::device::session::SessionInfo {
        self.manager
            .login(&self.id, "kysu1", zeroize::Zeroizing::new(self.password()))
            .await
            .unwrap()
    }
}

/// Chuỗi ngẫu nhiên mỗi lần chạy: mật khẩu thử, token thử.
pub fn random_secret(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).unwrap();
    format!(
        "{prefix}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

/// Chứng chỉ thử và khóa riêng của nó (PKCS#8, chỉ trong bộ nhớ).
pub struct TestCert {
    pub der: CertificateDer<'static>,
    key: Vec<u8>,
    /// SHA-256 của DER, 64 hex chữ thường (tính độc lập với mã đang test).
    pub fingerprint: String,
}

impl TestCert {
    pub fn new() -> Self {
        Self::with_params(|_| {})
    }

    /// Sửa tham số chứng chỉ trước khi ký (tên máy, hạn…).
    pub fn with_params(edit: impl FnOnce(&mut CertificateParams)) -> Self {
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::new(vec!["mat-test.invalid".to_string()]).unwrap();
        edit(&mut params);
        let cert = params.self_signed(&key).unwrap();
        let der = cert.der().clone();
        let fingerprint = sha256_hex(&der);
        TestCert {
            der,
            key: key.serialize_der(),
            fingerprint,
        }
    }

    fn key_der(&self) -> PrivateKeyDer<'static> {
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.key.clone()))
    }

    /// Cấu hình máy chủ rustls (provider `ring` mặc định) chỉ với các phiên bản TLS đã cho.
    pub fn server_config(
        &self,
        versions: &[&'static SupportedProtocolVersion],
    ) -> Arc<ServerConfig> {
        Arc::new(
            ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_protocol_versions(versions)
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(vec![self.der.clone()], self.key_der())
                .unwrap(),
        )
    }

    /// Máy chủ gửi đúng chứng chỉ này (fingerprint khớp ghim) nhưng ký bắt tay bằng một khóa khác:
    /// kẻ giả mạo chép được chứng chỉ công khai của thiết bị mà không có khóa riêng.
    pub fn server_config_wrong_key(
        &self,
        versions: &[&'static SupportedProtocolVersion],
    ) -> Arc<ServerConfig> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let other = KeyPair::generate().unwrap();
        let signing = provider
            .key_provider
            .load_private_key(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
                other.serialize_der(),
            )))
            .unwrap();
        // `CertifiedKey::new` không kiểm khóa có khớp chứng chỉ không (`from_der` thì có).
        let certified = CertifiedKey::new(vec![self.der.clone()], signing);
        Arc::new(
            ServerConfig::builder_with_provider(provider)
                .with_protocol_versions(versions)
                .unwrap()
                .with_no_client_auth()
                .with_cert_resolver(Arc::new(SingleCertAndKey::from(certified))),
        )
    }
}

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// Nghe trên 127.0.0.1, cổng ngẫu nhiên.
pub async fn listen() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

/// Cổng vừa được cấp rồi đóng: kết nối tới sẽ bị từ chối.
pub async fn closed_port() -> u16 {
    let (listener, port) = listen().await;
    drop(listener);
    port
}

/// Bắt tay TLS (nếu có cấu hình) trên kết nối vừa nhận.
async fn accept_io(
    tcp: tokio::net::TcpStream,
    tls: Option<Arc<ServerConfig>>,
) -> Option<Box<dyn Io>> {
    match tls {
        Some(cfg) => TlsAcceptor::from(cfg)
            .accept(tcp)
            .await
            .ok()
            .map(|s| Box::new(s) as Box<dyn Io>),
        None => Some(Box::new(tcp)),
    }
}

/// Một request HTTP/1.1 máy chủ thử nhận được.
#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    /// Đường dẫn kèm query, đúng như trên dòng request.
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Req {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }

    pub fn query(&self) -> Option<&str> {
        self.target.split_once('?').map(|(_, q)| q)
    }

    pub fn bearer(&self) -> Option<&str> {
        self.header("authorization")?.strip_prefix("Bearer ")
    }
}

/// Phản hồi của máy chủ thử.
pub struct Resp {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Resp {
    pub fn json(status: u16, value: Value) -> Self {
        Resp {
            status,
            headers: vec![(
                "Content-Type".into(),
                "application/json; charset=utf-8".into(),
            )],
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    pub fn raw(status: u16, body: &str) -> Self {
        Resp {
            status,
            headers: Vec::new(),
            body: body.as_bytes().to_vec(),
        }
    }

    pub fn error(status: u16, code: &str) -> Self {
        Resp::json(status, json!({ "error": code, "message": "lỗi thử" }))
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

async fn read_request(io: &mut Box<dyn Io>) -> Option<Req> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = find(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
        let n = io.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = std::str::from_utf8(&buf[..head_end]).ok()?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = io.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Some(Req {
        method,
        target,
        headers,
        body,
    })
}

async fn write_response(io: &mut Box<dyn Io>, r: &Resp) {
    let mut head = format!(
        "HTTP/1.1 {} Test\r\nContent-Length: {}\r\nConnection: close\r\n",
        r.status,
        r.body.len()
    );
    for (k, v) in &r.headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = io.write_all(head.as_bytes()).await;
    let _ = io.write_all(&r.body).await;
    let _ = io.flush().await;
}

/// Máy chủ HTTP/1.1 thử (HTTPS khi có `tls`): mỗi kết nối một request, trả lời rồi đóng.
pub struct Server {
    pub port: u16,
    requests: Arc<Mutex<Vec<Req>>>,
    task: JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Server {
    pub fn requests(&self) -> Vec<Req> {
        self.requests.lock().unwrap().clone()
    }
}

pub async fn http_server(
    tls: Option<Arc<ServerConfig>>,
    handler: impl Fn(&Req) -> Resp + Send + Sync + 'static,
) -> Server {
    http_server_at(None, tls, handler).await
}

/// Như `http_server`, nhưng nghe lại đúng cổng `port` (thiết bị chạy lại sau khi kích hoạt project:
/// cổng cũ vừa được nhả, nên thử bind lại tới 3 s).
pub async fn http_server_at(
    port: Option<u16>,
    tls: Option<Arc<ServerConfig>>,
    handler: impl Fn(&Req) -> Resp + Send + Sync + 'static,
) -> Server {
    let (listener, port) = match port {
        None => listen().await,
        Some(p) => {
            let mut tries = 0;
            loop {
                match TcpListener::bind(("127.0.0.1", p)).await {
                    Ok(l) => break (l, p),
                    Err(e) if tries < 60 => {
                        let _ = e;
                        tries += 1;
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                    Err(e) => panic!("không bind lại được cổng {p}: {e}"),
                }
            }
        }
    };
    let requests = Arc::new(Mutex::new(Vec::new()));
    let handler = Arc::new(handler);
    let log = requests.clone();
    let task = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (tls, handler, log) = (tls.clone(), handler.clone(), log.clone());
            tokio::spawn(async move {
                let Some(mut io) = accept_io(tcp, tls).await else {
                    return;
                };
                if let Some(req) = read_request(&mut io).await {
                    let resp = handler(&req);
                    log.lock().unwrap().push(req);
                    write_response(&mut io, &resp).await;
                }
                let _ = io.shutdown().await;
            });
        }
    });
    Server {
        port,
        requests,
        task,
    }
}

/// Nhận kết nối TCP rồi im lặng (không bắt tay, không trả lời): thử timeout.
pub async fn silent_server() -> Server {
    let (listener, port) = listen().await;
    let task = tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((tcp, _)) = listener.accept().await {
            held.push(tcp);
        }
    });
    Server {
        port,
        requests: Arc::new(Mutex::new(Vec::new())),
        task,
    }
}

/// Bắt tay TLS xong rồi im lặng: thử timeout của request HTTPS.
pub async fn silent_tls_server(tls: Arc<ServerConfig>) -> Server {
    let (listener, port) = listen().await;
    let task = tokio::spawn(async move {
        let held = Arc::new(Mutex::new(Vec::new()));
        while let Ok((tcp, _)) = listener.accept().await {
            let (tls, held) = (tls.clone(), held.clone());
            tokio::spawn(async move {
                if let Some(io) = accept_io(tcp, Some(tls)).await {
                    held.lock().unwrap().push(io);
                }
            });
        }
    });
    Server {
        port,
        requests: Arc::new(Mutex::new(Vec::new())),
        task,
    }
}

/// Cổng HTTP thường (như cổng 8080 của CivetWeb) nhận gói ClientHello: trả 400 rồi đóng.
pub async fn plain_http_port() -> Server {
    let (listener, port) = listen().await;
    let task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let _ = tcp.read(&mut buf).await;
                let _ = tcp
                    .write_all(
                        b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad request",
                    )
                    .await;
                let _ = tcp.shutdown().await;
            });
        }
    });
    Server {
        port,
        requests: Arc::new(Mutex::new(Vec::new())),
        task,
    }
}

/// Cổng HTTP thường của runtime cũ (CivetWeb, chưa có HTTPS), T085b: request HTTP được trả lời bằng `handler` (và ghi
/// lại); byte đầu không phải dòng request HTTP (gói ClientHello của TLS) thì trả 400 rồi đóng, như CivetWeb.
pub async fn plain_http_server(handler: impl Fn(&Req) -> Resp + Send + Sync + 'static) -> Server {
    let (listener, port) = listen().await;
    let requests = Arc::new(Mutex::new(Vec::new()));
    let handler = Arc::new(handler);
    let log = requests.clone();
    let task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let (handler, log) = (handler.clone(), log.clone());
            tokio::spawn(async move {
                let mut first = [0u8; 1];
                let http =
                    matches!(tcp.peek(&mut first).await, Ok(1) if first[0].is_ascii_uppercase());
                if !http {
                    let mut buf = [0u8; 2048];
                    let _ = tcp.read(&mut buf).await;
                    let _ = tcp
                        .write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\nConnection: close\r\n\r\nBad request",
                        )
                        .await;
                    let _ = tcp.shutdown().await;
                    return;
                }
                let mut io: Box<dyn Io> = Box::new(tcp);
                if let Some(req) = read_request(&mut io).await {
                    let resp = handler(&req);
                    log.lock().unwrap().push(req);
                    write_response(&mut io, &resp).await;
                }
                let _ = io.shutdown().await;
            });
        }
    });
    Server {
        port,
        requests,
        task,
    }
}

/// Runtime cũ ở cổng HTTP thường: `GET /api/v1/system/info` trả `runtimeVersion` đã cho (T085b).
pub async fn old_runtime(version: &str) -> Server {
    let info = json!({ "runtimeVersion": version, "protocolVersion": "1.0.0", "clients": 0,
                       "maxClients": 10, "project": { "status": "active", "projectId": "tank-demo" } });
    plain_http_server(move |req| match (req.method.as_str(), req.path()) {
        ("GET", "/api/v1/system/info") => Resp::json(200, info.clone()),
        _ => Resp::error(404, "NOT_FOUND"),
    })
    .await
}

/// Máy chủ TLS ghi lại mỗi kết nối: bắt tay xong chưa, nhận bao nhiêu byte ứng dụng (trả lại đúng
/// các byte đó), tới khi client đóng.
pub struct TlsObserver {
    pub port: u16,
    handshakes: Arc<AtomicUsize>,
    app_bytes: Arc<Mutex<Vec<usize>>>,
    task: JoinHandle<()>,
}

impl Drop for TlsObserver {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TlsObserver {
    pub fn handshakes(&self) -> usize {
        self.handshakes.load(Ordering::SeqCst)
    }

    /// Số byte ứng dụng của từng kết nối đã đóng; chờ tối đa 3 s tới khi có ít nhất `n` kết nối.
    pub async fn closed_connections(&self, n: usize) -> Vec<usize> {
        for _ in 0..300 {
            let got = self.app_bytes.lock().unwrap().clone();
            if got.len() >= n {
                return got;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.app_bytes.lock().unwrap().clone()
    }
}

pub async fn tls_observer(tls: Arc<ServerConfig>) -> TlsObserver {
    let (listener, port) = listen().await;
    let handshakes = Arc::new(AtomicUsize::new(0));
    let app_bytes = Arc::new(Mutex::new(Vec::new()));
    let (hs, ab) = (handshakes.clone(), app_bytes.clone());
    let task = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (tls, hs, ab) = (tls.clone(), hs.clone(), ab.clone());
            tokio::spawn(async move {
                let Ok(mut s) = TlsAcceptor::from(tls).accept(tcp).await else {
                    return;
                };
                hs.fetch_add(1, Ordering::SeqCst);
                let mut total = 0;
                let mut buf = [0u8; 1024];
                loop {
                    match s.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            total += n;
                            if s.write_all(&buf[..n]).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                ab.lock().unwrap().push(total);
            });
        }
    });
    TlsObserver {
        port,
        handshakes,
        app_bytes,
        task,
    }
}

/// Request nâng cấp WebSocket máy chủ thử nhận được: đường dẫn và các header.
pub type Upgrades = Arc<Mutex<Vec<(String, Vec<(String, String)>)>>>;

/// Máy chủ WebSocket thử (`wss` khi có `tls`), kịch bản:
/// - ghi lại đường dẫn và header của request nâng cấp;
/// - gửi `"hello"` ngay sau khi mở;
/// - nhận text `t`: ghi lại; `t == "bye-please"` thì đóng với mã 4000 `"bye"`, không thì trả `"echo:t"`;
/// - nhận frame đóng: ghi lại mã và lý do (tungstenite tự trả frame đóng).
pub struct WsServer {
    pub port: u16,
    pub upgrades: Upgrades,
    pub received: Arc<Mutex<Vec<String>>>,
    pub closes: Arc<Mutex<Vec<(u16, String)>>>,
    task: JoinHandle<()>,
}

impl Drop for WsServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl WsServer {
    /// Chờ tối đa 3 s tới khi máy chủ nhận được `n` frame đóng.
    pub async fn wait_closes(&self, n: usize) -> Vec<(u16, String)> {
        for _ in 0..300 {
            let got = self.closes.lock().unwrap().clone();
            if got.len() >= n {
                return got;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.closes.lock().unwrap().clone()
    }
}

pub async fn ws_server(tls: Option<Arc<ServerConfig>>) -> WsServer {
    let (listener, port) = listen().await;
    let upgrades = Arc::new(Mutex::new(Vec::new()));
    let received = Arc::new(Mutex::new(Vec::new()));
    let closes = Arc::new(Mutex::new(Vec::new()));
    let (up, rx, cl) = (upgrades.clone(), received.clone(), closes.clone());
    let task = tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (tls, up, rx, cl) = (tls.clone(), up.clone(), rx.clone(), cl.clone());
            tokio::spawn(async move {
                let Some(io) = accept_io(tcp, tls).await else {
                    return;
                };
                let record = up.clone();
                // Chữ ký do `tungstenite::handshake::server::Callback` áp đặt.
                #[allow(clippy::result_large_err)]
                let callback =
                    move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                        let headers = req
                            .headers()
                            .iter()
                            .map(|(k, v)| {
                                (k.as_str().to_string(), v.to_str().unwrap_or("").to_string())
                            })
                            .collect();
                        record
                            .lock()
                            .unwrap()
                            .push((req.uri().path().to_string(), headers));
                        Ok(resp)
                    };
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(io, callback).await else {
                    return;
                };
                if ws.send(Message::text("hello")).await.is_err() {
                    return;
                }
                while let Some(Ok(msg)) = ws.next().await {
                    match msg {
                        Message::Text(t) => {
                            let t = t.to_string();
                            rx.lock().unwrap().push(t.clone());
                            let reply = if t == "bye-please" {
                                Message::Close(Some(CloseFrame {
                                    code: CloseCode::from(4000),
                                    reason: "bye".into(),
                                }))
                            } else {
                                Message::text(format!("echo:{t}"))
                            };
                            if ws.send(reply).await.is_err() {
                                break;
                            }
                        }
                        Message::Close(frame) => {
                            let (code, reason) = frame.map_or((1005, String::new()), |f| {
                                (u16::from(f.code), f.reason.to_string())
                            });
                            cl.lock().unwrap().push((code, reason));
                        }
                        _ => {}
                    }
                }
            });
        }
    });
    WsServer {
        port,
        upgrades,
        received,
        closes,
        task,
    }
}

/// Trạng thái của thiết bị giả (contracts/device-api.md §3, §6).
pub struct FakeDevice {
    /// Mật khẩu đúng của `kysu1`, sinh ngẫu nhiên mỗi lần chạy.
    pub password: String,
    /// Token cấp ở lần đăng nhập đúng gần nhất; `None` sau khi đăng xuất.
    pub token: Option<String>,
    pub setup_required: bool,
    /// Mã lỗi ép cho `/api/v1/diagnostics` (`SESSION_INVALID`, `FORBIDDEN`…).
    pub forced: Option<(u16, &'static str)>,
}

impl FakeDevice {
    pub fn shared() -> Arc<Mutex<FakeDevice>> {
        Arc::new(Mutex::new(FakeDevice {
            password: random_secret("pw-"),
            token: None,
            setup_required: false,
            forced: None,
        }))
    }
}

/// Bộ xử lý request của thiết bị giả.
pub fn fake_device(state: Arc<Mutex<FakeDevice>>) -> impl Fn(&Req) -> Resp + Send + Sync + 'static {
    move |req: &Req| {
        let mut st = state.lock().unwrap();
        let authed = || match req.bearer() {
            None => Err(Resp::error(401, "AUTH_REQUIRED")),
            Some(t) if Some(t) == st.token.as_deref() => Ok(()),
            Some(_) => Err(Resp::error(401, "SESSION_EXPIRED")),
        };
        match (req.method.as_str(), req.path()) {
            ("GET", "/api/v1/system/info") => Resp::json(
                200,
                json!({ "runtimeVersion": "0.4.0", "protocolVersion": "1.1.0" }),
            ),
            ("GET", "/api/v1/device/identity") => Resp::json(
                200,
                json!({
                    "deviceId": DEVICE_ID, "name": "BL335-01", "model": "BL335",
                    "runtimeVersion": "0.4.0", "apiVersion": "1.0.0", "protocolVersion": "1.1.0",
                    "httpPort": 8080, "httpsPort": 8443,
                    "fingerprint": "00".repeat(32),
                    "setupRequired": st.setup_required,
                    "features": ["auth", "deploy", "upload", "restore", "diagnostics", "audit"]
                }),
            ),
            ("POST", "/api/v1/auth/login") => {
                let body: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
                let user = body["user"].as_str().unwrap_or("");
                let password = body["password"].as_str().unwrap_or("");
                match user {
                    "khoa" => Resp::json(
                        429,
                        json!({ "error": "AUTH_LOCKED", "message": "khóa", "retryAfterS": 287 }),
                    )
                    .header("Retry-After", "287"),
                    "ban" => Resp::error(429, "AUTH_BUSY").header("Retry-After", "2"),
                    "audit" => Resp::error(503, "AUDIT_UNAVAILABLE"),
                    "kysu1" if password == st.password => {
                        let token = random_secret("mats_");
                        st.token = Some(token.clone());
                        Resp::json(
                            200,
                            json!({
                                "token": token, "user": "kysu1", "role": "engineer",
                                "idleTimeoutS": 1800, "maxLifetimeS": 43200
                            }),
                        )
                    }
                    _ => Resp::error(401, "AUTH_FAILED"),
                }
            }
            ("POST", "/api/v1/auth/logout") => match authed() {
                Ok(()) => {
                    st.token = None;
                    Resp::raw(204, "")
                }
                Err(r) => r,
            },
            ("GET", "/api/v1/auth/session") => match authed() {
                Ok(()) => Resp::json(
                    200,
                    json!({ "user": "kysu1", "role": "engineer",
                            "idleRemainingS": 1790, "lifetimeRemainingS": 40100 }),
                ),
                Err(r) => r,
            },
            ("GET", "/api/v1/diagnostics") => match (authed(), st.forced) {
                (Err(r), _) => r,
                (Ok(()), Some((status, code))) => Resp::error(status, code),
                (Ok(()), None) => Resp::json(200, json!({ "at": 1791601205000u64 })),
            },
            ("GET", "/api/v1/audit") => match authed() {
                Ok(()) => Resp::json(200, json!({ "query": req.query() })),
                Err(r) => r,
            },
            ("GET", "/api/v1/project/manifest") => Resp::error(404, "NO_PROJECT_PACKAGE"),
            ("GET", "/api/v1/project/operation") => Resp::raw(200, "null"),
            ("GET", "/api/v1/project/versions") => Resp::raw(200, "không phải JSON"),
            _ => Resp::error(404, "NOT_FOUND"),
        }
    }
}
