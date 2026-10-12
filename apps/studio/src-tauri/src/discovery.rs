//! Tìm thiết bị trong LAN bằng UDP broadcast trên từng card mạng (feature 005, research R1–R3,
//! contracts/discovery.md §3, §5, §5a; contracts/tauri-commands.md §2).
//!
//! - Gói hỏi đúng 1024 byte có nonce 16 byte; gói trả lời được kiểm theo phía Studio của contract.
//! - Mỗi card một socket UDP bind vào địa chỉ của card, cổng ngẫu nhiên, `SO_BROADCAST`; gửi tới
//!   broadcast có hướng của card lúc 0, 600, 1200 ms, nhận tới 2500 ms.
//! - Kết quả đẩy dần qua `tauri::ipc::Channel`, gộp theo (`deviceId`, IP nguồn UDP).
//! - Fingerprint của gói tìm gần nhất chỉ giữ trong bộ nhớ (cho `device_probe.discovered`), không
//!   ghi đĩa và không bao giờ dùng để ghim (R6).

use crate::device::registry::{is_mac, is_uuid};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Gói hỏi dài đúng 1024 byte; gói trả lời không dài hơn (chống khuếch đại, R2).
pub const QUERY_SIZE: usize = 1024;
/// Phần đầu chung: `MATD`, version, type, cờ, nonce.
pub const HEADER_SIZE: usize = 24;
pub const MAGIC: &[u8; 4] = b"MATD";
pub const VERSION: u8 = 1;
pub const TYPE_QUERY: u8 = 1;
pub const TYPE_REPLY: u8 = 2;
/// Bit 0 của cờ trong gói trả lời: thiết bị đã cắt bớt JSON.
pub const FLAG_TRUNCATED: u16 = 1;
/// Cổng UDP của thiết bị (`discoveryPort` mặc định).
pub const DISCOVERY_PORT: u16 = 8446;
/// Lịch gửi của một lượt quét (ms tính từ lúc bắt đầu) và lúc kết thúc nhận.
pub const SEND_AT_MS: [u64; 3] = [0, 600, 1200];
pub const SCAN_END_MS: u64 = 2500;
/// Bộ đệm nhận: lớn hơn gói hợp lệ lớn nhất, để gói > 1024 byte vẫn đọc được rồi bị bỏ.
const RECV_BUFFER: usize = 2048;
/// Số mục fingerprint của gói tìm giữ trong bộ nhớ.
const MAX_SEEN: usize = 256;

/// Gói hỏi (contract §2).
pub fn build_query(nonce: &[u8; 16]) -> [u8; QUERY_SIZE] {
    let mut q = [0u8; QUERY_SIZE];
    q[..4].copy_from_slice(MAGIC);
    q[4] = VERSION;
    q[5] = TYPE_QUERY;
    // Byte 6–7 (cờ) và 1000 byte đệm giữ 0.
    q[8..HEADER_SIZE].copy_from_slice(nonce);
    q
}

/// Project đang chạy trên thiết bị, theo gói trả lời. `name` có thể bị bỏ khi thiết bị thiếu chỗ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectSummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub version: String,
    pub digest: String,
}

/// Bản ghi tìm thấy (data-model §1). Khóa tùy chọn không có hoặc sai kiểu thì `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    /// Chỉ số card (`NetInterface.index`) đã nhận gói trả lời.
    pub iface: u32,
    /// Địa chỉ nguồn UDP của gói trả lời (không lấy khóa `ip` của JSON).
    pub ip: String,
    pub device_id: String,
    pub name: String,
    pub model: Option<String>,
    pub mac: Option<String>,
    pub prefix: Option<u8>,
    pub runtime: String,
    pub api: Option<String>,
    /// Giữ nguyên chuỗi thiết bị gửi; giá trị lạ giao diện hiện "không rõ" (contract §5a).
    pub status: String,
    pub project: Option<ProjectSummary>,
    pub https_port: u16,
    pub http_port: Option<u16>,
    /// Chỉ để tham khảo: không dùng để ghim (R6).
    pub fingerprint: Option<String>,
    /// ms UTC lúc nhận.
    pub received_at: u64,
}

/// Gói trả lời đã kiểm: cờ `truncated` và bản ghi (chưa có `iface`, `receivedAt`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub truncated: bool,
    pub device: DiscoveredDevice,
}

/// Cổng 0–65535 (số nguyên JSON).
fn port_of(v: &Value) -> Option<u16> {
    u16::try_from(v.as_u64()?).ok()
}

fn string_of(obj: &Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key)?.as_str().map(str::to_string)
}

/// 64 hex (chữ hoa hay thường) → chữ thường.
fn fingerprint_of(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    (s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())).then(|| s.to_ascii_lowercase())
}

/// Khối `project`: `id`, `version`, `digest` là chuỗi; `name` tùy chọn. Sai thì coi như không có.
fn project_of(v: &Value) -> Option<ProjectSummary> {
    let p = v.as_object()?;
    Some(ProjectSummary {
        id: string_of(p, "id")?,
        name: string_of(p, "name"),
        version: string_of(p, "version")?,
        digest: string_of(p, "digest")?,
    })
}

/// Kiểm gói trả lời theo phía Studio của contract §3 và §5a; `None` là bỏ gói.
pub fn parse_reply(packet: &[u8], nonce: &[u8; 16], source: Ipv4Addr) -> Option<Reply> {
    if packet.len() < HEADER_SIZE || packet.len() > QUERY_SIZE {
        return None;
    }
    if &packet[..4] != MAGIC || packet[4] != VERSION || packet[5] != TYPE_REPLY {
        return None;
    }
    if &packet[8..HEADER_SIZE] != nonce {
        return None;
    }
    let flags = u16::from_be_bytes([packet[6], packet[7]]);
    let json: Value = serde_json::from_slice(&packet[HEADER_SIZE..]).ok()?;
    let obj = json.as_object()?;
    // Khóa bắt buộc: thiếu hoặc sai kiểu thì bỏ gói.
    if obj.get("v")?.as_u64()? != 1 {
        return None;
    }
    let device_id = obj.get("id")?.as_str().filter(|s| is_uuid(s))?.to_string();
    let name = string_of(obj, "name")?;
    let runtime = string_of(obj, "runtime")?;
    let status = string_of(obj, "status")?;
    let https_port = port_of(obj.get("https")?)?;
    // Khóa tùy chọn: sai kiểu coi như không có; khóa lạ bỏ qua.
    Some(Reply {
        truncated: flags & FLAG_TRUNCATED != 0,
        device: DiscoveredDevice {
            iface: 0,
            ip: source.to_string(),
            device_id,
            name,
            model: string_of(obj, "model"),
            mac: string_of(obj, "mac").filter(|m| is_mac(m)),
            prefix: obj
                .get("prefix")
                .and_then(Value::as_u64)
                .and_then(|p| u8::try_from(p).ok())
                .filter(|p| *p <= 32),
            runtime,
            api: string_of(obj, "api"),
            status,
            project: obj.get("project").and_then(project_of),
            https_port,
            http_port: obj.get("http").and_then(port_of),
            fingerprint: obj.get("fp").and_then(fingerprint_of),
            received_at: 0,
        },
    })
}

/// Card mạng IPv4 đang bật (contracts/tauri-commands.md §2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetInterface {
    pub index: u32,
    pub name: String,
    pub address: String,
    pub prefix: u8,
    pub broadcast: Option<String>,
    pub can_broadcast: bool,
    pub hint: Option<&'static str>,
}

/// Phân loại một địa chỉ IPv4 của card. Broadcast tính lại từ địa chỉ và prefix (bảng prefix của
/// Windows có thể cho broadcast của một prefix khác); không có broadcast khi prefix ≥ 31 hoặc hệ
/// điều hành báo card không broadcast.
pub fn classify_interface(
    index: u32,
    name: &str,
    ip: Ipv4Addr,
    prefix: u8,
    os_broadcast: Option<Ipv4Addr>,
    point_to_point: bool,
) -> NetInterface {
    let broadcast = (prefix <= 30 && os_broadcast.is_some()).then(|| {
        let host_bits = u32::MAX.checked_shr(u32::from(prefix)).unwrap_or(0);
        Ipv4Addr::from(u32::from(ip) | host_bits)
    });
    NetInterface {
        index,
        name: name.to_string(),
        address: ip.to_string(),
        prefix,
        broadcast: broadcast.map(|b| b.to_string()),
        can_broadcast: broadcast.is_some(),
        hint: (point_to_point || is_vpn_name(name)).then_some("vpn"),
    }
}

/// Tên card có dạng VPN thường gặp. Chỉ để hiện gợi ý "Thêm theo địa chỉ".
pub fn is_vpn_name(name: &str) -> bool {
    const PARTS: &[&str] = &[
        "wireguard",
        "openvpn",
        "tailscale",
        "zerotier",
        "vpn",
        "tap-windows",
        "tap-win32",
        "wintun",
        "anyconnect",
        "globalprotect",
        "pangp",
        "forti",
        "nordlynx",
        "mullvad",
        "hamachi",
        "softether",
        "netbird",
        "radmin",
    ];
    /// Tên card kiểu Unix: `tun0`, `wg1`, `ppp0`…
    const PREFIXES: &[&str] = &["tap", "tun", "utun", "wg", "ppp", "ipsec", "l2tp", "pptp"];
    let lower = name.to_lowercase();
    PARTS.iter().any(|p| lower.contains(p))
        || lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|token| {
                PREFIXES.iter().any(|p| {
                    token
                        .strip_prefix(p)
                        .is_some_and(|rest| rest.bytes().all(|b| b.is_ascii_digit()))
                })
            })
}

/// Card IPv4 đang bật của máy (trừ loopback), thứ tự cố định theo (chỉ số OS, địa chỉ); `index` là
/// thứ tự trong danh sách này. Một card có nhiều địa chỉ IPv4 thành nhiều mục.
pub fn list_interfaces() -> Vec<NetInterface> {
    let Ok(all) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut rows: Vec<(u32, Ipv4Addr, String, u8, Option<Ipv4Addr>, bool)> = all
        .into_iter()
        .filter_map(|i| {
            let if_addrs::IfAddr::V4(v4) = &i.addr else {
                return None;
            };
            if v4.ip.is_loopback() || !i.is_oper_up() {
                return None;
            }
            Some((
                i.index.unwrap_or(u32::MAX),
                v4.ip,
                i.name.clone(),
                v4.prefixlen,
                v4.broadcast,
                i.is_p2p(),
            ))
        })
        .collect();
    rows.sort_by_key(|r| (r.0, r.1));
    rows.dedup_by_key(|r| (r.0, r.1));
    rows.into_iter()
        .zip(0u32..)
        .map(|((_, ip, name, prefix, broadcast, p2p), index)| {
            classify_interface(index, &name, ip, prefix, broadcast, p2p)
        })
        .collect()
}

/// Lý do một card không quét được: `bind` (không mở được socket trên địa chỉ của card, hoặc card
/// không còn), `send` (không gửi được gói hỏi nào, kể cả khi card không có broadcast).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FailReason {
    Bind,
    Send,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FailedIface {
    pub index: u32,
    pub reason: FailReason,
}

/// Kết quả một lượt quét.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiscoverSummary {
    /// Số card đã gửi được gói hỏi.
    pub scanned: u32,
    /// Số thiết bị (theo `deviceId`, IP) đã đẩy lên giao diện.
    pub found: u32,
    pub failed: Vec<FailedIface>,
}

/// Sự kiện của `discover_run`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DiscoverEvent {
    Found { device: DiscoveredDevice },
}

/// Lỗi của `discover_run`: `"busy"` khi một lượt quét khác đang chạy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoverError {
    Busy,
}

/// Một gói UDP nhận được trên socket thứ `sock`.
pub(crate) struct Datagram {
    pub sock: usize,
    pub from: SocketAddr,
    pub data: Vec<u8>,
}

/// Mạng của một lượt quét: socket thật (`UdpNet`) hoặc giả trong test (đồng hồ giả). Thời gian
/// tính bằng ms từ lúc bắt đầu lượt quét, do bản cài giữ.
pub(crate) trait ScanNet {
    /// Mở socket bind vào địa chỉ của card, cổng ngẫu nhiên, `SO_BROADCAST`; trả số hiệu socket.
    fn bind(&mut self, local: Ipv4Addr) -> io::Result<usize>;
    async fn send(&mut self, sock: usize, data: &[u8], to: SocketAddrV4) -> io::Result<()>;
    /// Gói kế tiếp nhận được trước mốc `deadline_ms`, hoặc `None` khi tới mốc.
    async fn recv_until(&mut self, deadline_ms: u64) -> Option<Datagram>;
}

/// Một card sẽ quét.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScanTarget {
    pub index: u32,
    pub address: Ipv4Addr,
    pub broadcast: Option<Ipv4Addr>,
}

/// ms UTC hiện tại.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Trạng thái nhận của một lượt quét.
struct Receiver<'a, F> {
    nonce: [u8; 16],
    /// (số hiệu socket, chỉ số card)
    sockets: Vec<(usize, u32)>,
    seen: HashSet<(String, Ipv4Addr)>,
    found: u32,
    on_found: &'a mut F,
}

impl<F: FnMut(DiscoveredDevice)> Receiver<'_, F> {
    /// Nhận tới mốc `until_ms`; mỗi thiết bị mới (theo `deviceId`, IP nguồn) đẩy ngay.
    async fn drain<N: ScanNet>(&mut self, net: &mut N, until_ms: u64) {
        while let Some(d) = net.recv_until(until_ms).await {
            let IpAddr::V4(ip) = d.from.ip() else {
                continue;
            };
            let Some(&(_, iface)) = self.sockets.iter().find(|(s, _)| *s == d.sock) else {
                continue;
            };
            let Some(reply) = parse_reply(&d.data, &self.nonce, ip) else {
                continue;
            };
            let mut device = reply.device;
            if !self.seen.insert((device.device_id.clone(), ip)) {
                continue;
            }
            device.iface = iface;
            device.received_at = now_ms();
            self.found += 1;
            (self.on_found)(device);
        }
    }
}

/// Một lượt quét (contract §5): gửi lúc 0, 600, 1200 ms tới `broadcast:port` của mỗi card, nhận tới
/// 2500 ms, đẩy mỗi thiết bị mới (theo `deviceId`, IP) qua `on_found`.
pub(crate) async fn scan<N: ScanNet>(
    net: &mut N,
    targets: &[ScanTarget],
    nonce: [u8; 16],
    port: u16,
    mut on_found: impl FnMut(DiscoveredDevice),
) -> DiscoverSummary {
    let query = build_query(&nonce);
    let mut failed = Vec::new();
    // (socket, chỉ số card, đích, đã gửi được ít nhất một lần)
    let mut open: Vec<(usize, u32, SocketAddrV4, bool)> = Vec::new();
    for t in targets {
        let Some(broadcast) = t.broadcast else {
            failed.push(FailedIface {
                index: t.index,
                reason: FailReason::Send,
            });
            continue;
        };
        match net.bind(t.address) {
            Ok(sock) => open.push((sock, t.index, SocketAddrV4::new(broadcast, port), false)),
            Err(_) => failed.push(FailedIface {
                index: t.index,
                reason: FailReason::Bind,
            }),
        }
    }
    if open.is_empty() {
        // Không card nào gửi được: không có gì để chờ.
        failed.sort_by_key(|f| f.index);
        return DiscoverSummary {
            scanned: 0,
            found: 0,
            failed,
        };
    }
    let mut rx = Receiver {
        nonce,
        sockets: open.iter().map(|o| (o.0, o.1)).collect(),
        seen: HashSet::new(),
        found: 0,
        on_found: &mut on_found,
    };
    for at in SEND_AT_MS {
        rx.drain(net, at).await;
        for (sock, _, to, sent) in &mut open {
            if net.send(*sock, &query, *to).await.is_ok() {
                *sent = true;
            }
        }
    }
    rx.drain(net, SCAN_END_MS).await;
    let found = rx.found;
    for (_, index, _, sent) in &open {
        if !sent {
            failed.push(FailedIface {
                index: *index,
                reason: FailReason::Send,
            });
        }
    }
    failed.sort_by_key(|f| f.index);
    DiscoverSummary {
        scanned: u32::try_from(open.iter().filter(|o| o.3).count()).unwrap_or(u32::MAX),
        found,
        failed,
    }
}

/// Socket UDP thật trên tokio: mỗi socket một tác vụ nhận, gói nhận được đi qua một hàng đợi chung.
pub(crate) struct UdpNet {
    start: tokio::time::Instant,
    sockets: Vec<Arc<tokio::net::UdpSocket>>,
    tx: mpsc::Sender<Datagram>,
    rx: mpsc::Receiver<Datagram>,
    tasks: Vec<JoinHandle<()>>,
}

impl UdpNet {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(256);
        UdpNet {
            start: tokio::time::Instant::now(),
            sockets: Vec::new(),
            tx,
            rx,
            tasks: Vec::new(),
        }
    }
}

impl Drop for UdpNet {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

impl ScanNet for UdpNet {
    fn bind(&mut self, local: Ipv4Addr) -> io::Result<usize> {
        let socket = std::net::UdpSocket::bind(SocketAddrV4::new(local, 0))?;
        socket.set_broadcast(true)?;
        socket.set_nonblocking(true)?;
        let socket = Arc::new(tokio::net::UdpSocket::from_std(socket)?);
        let sock = self.sockets.len();
        let (reader, tx) = (socket.clone(), self.tx.clone());
        self.tasks.push(tokio::spawn(async move {
            let mut buf = vec![0u8; RECV_BUFFER];
            loop {
                match reader.recv_from(&mut buf).await {
                    Ok((len, from)) => {
                        // Hàng đợi đầy (bị dội gói): bỏ gói, lượt quét vẫn chạy đúng hạn.
                        let _ = tx.try_send(Datagram {
                            sock,
                            from,
                            data: buf[..len].to_vec(),
                        });
                    }
                    // Windows báo lỗi ở lần nhận sau khi một gói trước bị ICMP "port unreachable"
                    // (WSAECONNRESET), hoặc gói quá bộ đệm: bỏ qua, nhận tiếp.
                    Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
                }
            }
        }));
        self.sockets.push(socket);
        Ok(sock)
    }

    async fn send(&mut self, sock: usize, data: &[u8], to: SocketAddrV4) -> io::Result<()> {
        self.sockets[sock].send_to(data, to).await.map(|_| ())
    }

    async fn recv_until(&mut self, deadline_ms: u64) -> Option<Datagram> {
        let deadline = self.start + Duration::from_millis(deadline_ms);
        tokio::time::timeout_at(deadline, self.rx.recv())
            .await
            .ok()
            .flatten()
    }
}

/// State của Tauri: một lượt quét mỗi lúc, danh sách card giao diện đã thấy, fingerprint của gói
/// tìm gần nhất (chỉ trong bộ nhớ).
#[derive(Default)]
pub struct Discovery {
    running: AtomicBool,
    /// Danh sách card lần `net_interfaces` gần nhất: `discover_run` quét đúng các card giao diện
    /// đã hiện, theo `index`.
    interfaces: Mutex<Option<Vec<NetInterface>>>,
    /// (`deviceId`, IP, fingerprint), mới nhất trước.
    seen: Mutex<Vec<(String, String, Option<String>)>>,
}

/// Giữ cờ "đang quét" tới khi bị drop (kể cả khi lệnh bị hủy giữa chừng).
pub struct ScanGuard<'a>(&'a AtomicBool);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Khóa chỉ bảo vệ dữ liệu trong bộ nhớ: bỏ qua trạng thái "poisoned".
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Discovery {
    pub fn try_begin(&self) -> Result<ScanGuard<'_>, DiscoverError> {
        if self.running.swap(true, Ordering::AcqRel) {
            Err(DiscoverError::Busy)
        } else {
            Ok(ScanGuard(&self.running))
        }
    }

    /// Ghi nhớ fingerprint của gói trả lời vừa nhận.
    pub fn remember(&self, device: &DiscoveredDevice) {
        let mut seen = lock(&self.seen);
        seen.retain(|(id, ip, _)| !(id == &device.device_id && ip == &device.ip));
        seen.insert(
            0,
            (
                device.device_id.clone(),
                device.ip.clone(),
                device.fingerprint.clone(),
            ),
        );
        seen.truncate(MAX_SEEN);
    }

    /// Fingerprint của gói tìm gần nhất cho thiết bị đã lưu: theo `deviceId` (ưu tiên mục cùng IP),
    /// không có `deviceId` thì theo IP.
    pub fn fingerprint_for(&self, device_id: Option<&str>, host: &str) -> Option<String> {
        let seen = lock(&self.seen);
        let hit = match device_id {
            Some(id) => seen
                .iter()
                .find(|(i, ip, _)| i == id && ip == host)
                .or_else(|| seen.iter().find(|(i, _, _)| i == id)),
            None => seen.iter().find(|(_, ip, _)| ip == host),
        };
        hit.and_then(|(_, _, fp)| fp.clone())
    }

    /// Danh sách card: liệt kê lại khi `refresh` hoặc chưa có.
    fn interfaces(&self, refresh: bool) -> Vec<NetInterface> {
        let mut cache = lock(&self.interfaces);
        if refresh || cache.is_none() {
            *cache = Some(list_interfaces());
        }
        cache.clone().unwrap_or_default()
    }
}

/// Card sẽ quét: `wanted = None` → mọi card có broadcast. Chỉ số không có trong danh sách (card
/// đã mất) → lỗi `bind`; card không có broadcast vẫn vào danh sách để `scan` báo lỗi `send`.
fn select_targets(
    all: &[NetInterface],
    wanted: Option<&[u32]>,
) -> (Vec<ScanTarget>, Vec<FailedIface>) {
    let target = |i: &NetInterface| {
        Some(ScanTarget {
            index: i.index,
            address: i.address.parse().ok()?,
            broadcast: i.broadcast.as_deref().and_then(|b| b.parse().ok()),
        })
    };
    let Some(wanted) = wanted else {
        let targets = all
            .iter()
            .filter(|i| i.can_broadcast)
            .filter_map(target)
            .collect();
        return (targets, Vec::new());
    };
    let mut targets = Vec::new();
    let mut missing = Vec::new();
    let mut indices = wanted.to_vec();
    indices.sort_unstable();
    indices.dedup();
    for index in indices {
        match all.iter().find(|i| i.index == index).and_then(target) {
            Some(t) => targets.push(t),
            None => missing.push(FailedIface {
                index,
                reason: FailReason::Bind,
            }),
        }
    }
    (targets, missing)
}

/// Nonce 16 byte ngẫu nhiên. Nonce chỉ để bỏ trả lời cũ hoặc không do mình hỏi (không phải bí
/// mật); nguồn ngẫu nhiên của hệ điều hành lỗi thì dùng đồng hồ.
fn new_nonce() -> [u8; 16] {
    let mut nonce = [0u8; 16];
    if getrandom::fill(&mut nonce).is_err() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        nonce = nanos.to_le_bytes();
    }
    nonce
}

/// `net_interfaces() → NetInterface[]`
#[tauri::command]
pub async fn net_interfaces(app: AppHandle) -> Vec<NetInterface> {
    app.state::<Discovery>().interfaces(true)
}

/// `discover_run({ interfaces, onEvent }) → DiscoverSummary`; lỗi `"busy"`.
#[tauri::command]
pub async fn discover_run(
    interfaces: Option<Vec<u32>>,
    on_event: Channel<DiscoverEvent>,
    state: State<'_, Discovery>,
) -> Result<DiscoverSummary, DiscoverError> {
    let _running = state.try_begin()?;
    let all = state.interfaces(false);
    let (targets, mut missing) = select_targets(&all, interfaces.as_deref());
    let mut net = UdpNet::new();
    let mut summary = scan(&mut net, &targets, new_nonce(), DISCOVERY_PORT, |device| {
        state.remember(&device);
        // Giao diện đã đóng hộp thoại: không còn ai nhận, bỏ qua.
        let _ = on_event.send(DiscoverEvent::Found { device });
    })
    .await;
    summary.failed.append(&mut missing);
    summary.failed.sort_by_key(|f| f.index);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};
    use tauri::ipc::InvokeResponseBody;

    const NONCE: [u8; 16] = [
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
        0xff,
    ];
    const ID_A: &str = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";
    const FP_A: &str = "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b";

    fn vectors_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tests/discovery-vectors")
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    fn vector(name: &str) -> Value {
        let path = vectors_dir().join(format!("{name}.json"));
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
    }

    /// Mọi vector có `kind` cho trước, sắp theo tên file.
    fn vectors(kind: &str) -> Vec<(String, Value)> {
        let mut out: Vec<(String, Value)> = std::fs::read_dir(vectors_dir())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                let stem = name.strip_suffix(".json")?.to_string();
                let v: Value = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
                (v["kind"] == kind).then_some((stem, v))
            })
            .collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    fn reply_packet(obj: &Value, flags: u16) -> Vec<u8> {
        let mut p = Vec::from(&b"MATD\x01\x02"[..]);
        p.extend_from_slice(&flags.to_be_bytes());
        p.extend_from_slice(&NONCE);
        p.extend_from_slice(&serde_json::to_vec(obj).unwrap());
        p
    }

    fn minimal() -> Value {
        json!({ "v": 1, "id": ID_A, "name": "BL335-01", "runtime": "0.4.0",
                "status": "running", "https": 8443 })
    }

    const DEVICE_IP: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 110);

    /// T062: gói hỏi đúng 1024 byte: `MATD`, version 1, type 1, cờ 0, nonce, 1000 byte 0; trùng
    /// byte với vector `query-valid`.
    #[test]
    fn query_packet_is_1024_bytes_with_the_nonce() {
        let q = build_query(&NONCE);
        assert_eq!(q.len(), QUERY_SIZE);
        assert_eq!(&q[..8], b"MATD\x01\x01\x00\x00");
        assert_eq!(&q[8..24], &NONCE);
        assert!(q[24..].iter().all(|&b| b == 0));
        assert_eq!(
            q.to_vec(),
            hex(vector("query-valid")["packet"].as_str().unwrap())
        );
        let other = build_query(&[7; 16]);
        assert_eq!(&other[8..24], &[7; 16]);
        assert_eq!(DISCOVERY_PORT, 8446);
    }

    /// T062: mọi vector `reply-*` của tests/discovery-vectors: bỏ gói < 24 hoặc > 1024 byte, sai
    /// magic/version/type, nonce khác, JSON hỏng hoặc thiếu khóa bắt buộc; bỏ qua khóa lạ; IP theo
    /// địa chỉ nguồn UDP.
    #[test]
    fn reply_vectors() {
        let all = vectors("reply");
        assert!(all.len() >= 19, "chỉ thấy {} vector reply", all.len());
        for (name, v) in all {
            let nonce: [u8; 16] = hex(v["nonce"].as_str().unwrap()).try_into().unwrap();
            let source: Ipv4Addr = v["source"]["ip"].as_str().unwrap().parse().unwrap();
            let got = parse_reply(&hex(v["packet"].as_str().unwrap()), &nonce, source);
            let expect = &v["expect"];
            if expect["accept"] == false {
                assert!(got.is_none(), "{name}: phải bỏ gói, đọc ra {got:?}");
                continue;
            }
            let got = got.unwrap_or_else(|| panic!("{name}: phải nhận gói"));
            assert_eq!(got.truncated, expect["truncated"] == true, "{name}");
            let mut device = serde_json::to_value(&got.device).unwrap();
            let obj = device.as_object_mut().unwrap();
            assert!(obj.remove("iface").is_some(), "{name}: thiếu iface");
            assert!(
                obj.remove("receivedAt").is_some(),
                "{name}: thiếu receivedAt"
            );
            assert_eq!(device, expect["device"], "{name}");
        }
    }

    /// T062 (contract §5a): `v` khác 1 → bỏ; khóa bắt buộc sai kiểu hoặc ngoài khoảng → bỏ; khóa tùy
    /// chọn sai kiểu → coi như không có; `status` lạ → vẫn nhận, giữ nguyên chuỗi; cờ khác bit 0 bỏ
    /// qua.
    #[test]
    fn required_and_optional_keys() {
        let rejected = |edit: &dyn Fn(&mut Value)| {
            let mut o = minimal();
            edit(&mut o);
            parse_reply(&reply_packet(&o, 0), &NONCE, DEVICE_IP).is_none()
        };
        assert!(rejected(&|o| o["v"] = json!(2)));
        assert!(rejected(&|o| o["v"] = json!("1")));
        assert!(rejected(&|o| o["https"] = json!(70000)));
        assert!(rejected(&|o| o["https"] = json!(-1)));
        assert!(rejected(&|o| o["id"] = json!("không-phải-uuid")));
        assert!(rejected(&|o| o["name"] = json!(5)));
        assert!(rejected(&|o| o["status"] = Value::Null));
        assert!(parse_reply(b"MATD\x01\x02\x00\x00", &NONCE, DEVICE_IP).is_none());
        assert!(parse_reply(&reply_packet(&json!([1, 2]), 0), &NONCE, DEVICE_IP).is_none());

        let mut o = minimal();
        o["model"] = json!(5);
        o["mac"] = json!("C2:D9:CC:52:33");
        o["prefix"] = json!(33);
        o["api"] = json!(1);
        o["http"] = json!(70000);
        o["fp"] = json!("xyz");
        o["project"] = json!("tank-demo");
        let r = parse_reply(&reply_packet(&o, 0), &NONCE, DEVICE_IP).unwrap();
        let d = &r.device;
        assert_eq!(
            (
                &d.model,
                &d.mac,
                d.prefix,
                &d.api,
                d.http_port,
                &d.fingerprint,
                &d.project
            ),
            (&None, &None, None, &None, None, &None, &None)
        );
        assert!(!r.truncated);

        let mut o = minimal();
        o["project"] = json!({ "id": "tank-demo", "version": "1.0.0" });
        o["fp"] = json!(FP_A.to_uppercase());
        o["status"] = json!("upgrading");
        o["mac"] = json!("c2:d9:cc:52:33:70");
        let r = parse_reply(&reply_packet(&o, 0x8001), &NONCE, DEVICE_IP).unwrap();
        assert_eq!(r.device.project, None, "project thiếu digest");
        assert_eq!(r.device.fingerprint.as_deref(), Some(FP_A));
        assert_eq!(r.device.status, "upgrading");
        assert_eq!(r.device.mac.as_deref(), Some("c2:d9:cc:52:33:70"));
        assert!(r.truncated);
        assert_eq!(r.device.ip, "192.168.1.110");
    }

    /// T062: phân loại card: broadcast tính theo prefix; `canBroadcast = false` khi prefix ≥ 31 hoặc
    /// không có broadcast; `hint = "vpn"` theo tên (hoặc card điểm-điểm); hình dạng IPC.
    #[test]
    fn interfaces_are_classified() {
        let lan = classify_interface(
            0,
            "Ethernet",
            Ipv4Addr::new(192, 168, 1, 20),
            24,
            Some(Ipv4Addr::new(192, 168, 1, 255)),
            false,
        );
        assert_eq!(
            serde_json::to_value(&lan).unwrap(),
            json!({ "index": 0, "name": "Ethernet", "address": "192.168.1.20", "prefix": 24,
                    "broadcast": "192.168.1.255", "canBroadcast": true, "hint": null })
        );
        let wifi = classify_interface(
            1,
            "Wi-Fi",
            Ipv4Addr::new(10, 1, 2, 3),
            16,
            Some(Ipv4Addr::new(10, 1, 2, 3)),
            false,
        );
        assert_eq!(wifi.broadcast.as_deref(), Some("10.1.255.255"));
        assert!(wifi.can_broadcast);
        for (prefix, os) in [
            (31, Some(Ipv4Addr::new(10, 8, 0, 3))),
            (32, Some(Ipv4Addr::new(10, 8, 0, 2))),
            (24, None),
        ] {
            let c = classify_interface(2, "eth9", Ipv4Addr::new(10, 8, 0, 2), prefix, os, false);
            assert!(!c.can_broadcast, "/{prefix} {os:?}");
            assert_eq!(c.broadcast, None, "/{prefix} {os:?}");
        }
        for name in [
            "WireGuard Tunnel",
            "wg0",
            "OpenVPN TAP-Windows6",
            "TAP-Windows Adapter V9",
            "tun0",
            "utun3",
            "Tailscale",
            "tailscale0",
            "ZeroTier One [8056c2e21c000001]",
            "NordLynx",
            "ProtonVPN",
            "Cisco AnyConnect Secure Mobility Client Connection",
            "PANGP Virtual Ethernet Adapter",
            "FortiClient Virtual Ethernet",
            "ppp0",
        ] {
            assert!(is_vpn_name(name), "{name}");
            let c = classify_interface(3, name, Ipv4Addr::new(10, 9, 0, 2), 24, None, false);
            assert_eq!(c.hint, Some("vpn"), "{name}");
        }
        for name in [
            "Ethernet",
            "Ethernet 2",
            "Wi-Fi",
            "eth0",
            "enp3s0",
            "wlan0",
            "vEthernet (WSL)",
            "Bluetooth Network Connection",
            "Laptop LAN",
            "Desktop Adapter",
        ] {
            assert!(!is_vpn_name(name), "{name}");
        }
        let p2p = classify_interface(4, "Kết nối 3", Ipv4Addr::new(10, 64, 0, 2), 24, None, true);
        assert_eq!(p2p.hint, Some("vpn"));
    }

    /// Mạng giả: đồng hồ ảo, ghi lại các lần gửi, phát các gói đặt sẵn đúng thời điểm.
    struct FakeNet {
        now: u64,
        bind_fail: Vec<Ipv4Addr>,
        send_fail: Vec<Ipv4Addr>,
        bound: Vec<Ipv4Addr>,
        sends: Vec<(u64, Ipv4Addr, SocketAddrV4, Vec<u8>)>,
        inbox: VecDeque<(u64, Ipv4Addr, SocketAddr, Vec<u8>)>,
    }

    impl ScanNet for FakeNet {
        fn bind(&mut self, local: Ipv4Addr) -> io::Result<usize> {
            if self.bind_fail.contains(&local) {
                return Err(io::ErrorKind::AddrNotAvailable.into());
            }
            self.bound.push(local);
            Ok(self.bound.len() - 1)
        }
        async fn send(&mut self, sock: usize, data: &[u8], to: SocketAddrV4) -> io::Result<()> {
            let local = self.bound[sock];
            if self.send_fail.contains(&local) {
                return Err(io::ErrorKind::NetworkUnreachable.into());
            }
            self.sends.push((self.now, local, to, data.to_vec()));
            Ok(())
        }
        async fn recv_until(&mut self, deadline_ms: u64) -> Option<Datagram> {
            match self.inbox.front() {
                Some((at, ..)) if *at <= deadline_ms => {
                    let (at, local, from, data) = self.inbox.pop_front().unwrap();
                    self.now = self.now.max(at);
                    let sock = self.bound.iter().position(|b| *b == local).unwrap();
                    Some(Datagram { sock, from, data })
                }
                _ => {
                    self.now = self.now.max(deadline_ms);
                    None
                }
            }
        }
    }

    /// T062: lịch gửi 0, 600, 1200 ms tới broadcast của card, kết thúc ở 2500 ms (đồng hồ và socket
    /// giả); gộp theo (`deviceId`, IP); nonce khác bị bỏ; card lỗi `bind`, `send` vào tóm tắt.
    #[tokio::test]
    async fn scan_schedule_dedupe_and_failures() {
        let valid = hex(vector("reply-valid")["packet"].as_str().unwrap());
        let mut wrong_nonce = valid.clone();
        wrong_nonce[8] ^= 0xff;
        let lan = Ipv4Addr::new(192, 168, 1, 20);
        let from = |ip: [u8; 4]| SocketAddr::from((ip, 8446));
        let mut net = FakeNet {
            now: 0,
            bind_fail: vec![Ipv4Addr::new(10, 0, 0, 5)],
            send_fail: vec![Ipv4Addr::new(172, 16, 0, 9)],
            bound: Vec::new(),
            sends: Vec::new(),
            inbox: VecDeque::from([
                (100, lan, from([192, 168, 1, 110]), valid.clone()),
                (300, lan, from([192, 168, 1, 112]), wrong_nonce),
                (700, lan, from([192, 168, 1, 110]), valid.clone()),
                (2400, lan, from([192, 168, 1, 111]), valid.clone()),
                (2600, lan, from([192, 168, 1, 113]), valid.clone()),
            ]),
        };
        let targets = [
            ScanTarget {
                index: 0,
                address: lan,
                broadcast: Some(Ipv4Addr::new(192, 168, 1, 255)),
            },
            ScanTarget {
                index: 1,
                address: Ipv4Addr::new(10, 0, 0, 5),
                broadcast: Some(Ipv4Addr::new(10, 0, 0, 255)),
            },
            ScanTarget {
                index: 2,
                address: Ipv4Addr::new(172, 16, 0, 9),
                broadcast: Some(Ipv4Addr::new(172, 16, 255, 255)),
            },
        ];
        let mut found = Vec::new();
        let summary = scan(&mut net, &targets, NONCE, DISCOVERY_PORT, |d| found.push(d)).await;

        let to = SocketAddrV4::new(Ipv4Addr::new(192, 168, 1, 255), 8446);
        let times: Vec<(u64, Ipv4Addr, SocketAddrV4)> =
            net.sends.iter().map(|(t, l, a, _)| (*t, *l, *a)).collect();
        assert_eq!(times, [(0, lan, to), (600, lan, to), (1200, lan, to)]);
        assert!(net.sends.iter().all(|s| s.3 == build_query(&NONCE)));
        assert_eq!(net.now, SCAN_END_MS, "kết thúc đúng mốc 2500 ms");
        assert_eq!(net.inbox.len(), 1, "gói sau 2500 ms không được đọc");

        let got: Vec<(u32, &str, &str)> = found
            .iter()
            .map(|d| (d.iface, d.ip.as_str(), d.device_id.as_str()))
            .collect();
        assert_eq!(
            got,
            [(0, "192.168.1.110", ID_A), (0, "192.168.1.111", ID_A)]
        );
        assert!(found.iter().all(|d| d.received_at > 1_700_000_000_000));
        assert_eq!(
            summary,
            DiscoverSummary {
                scanned: 1,
                found: 2,
                failed: vec![
                    FailedIface {
                        index: 1,
                        reason: FailReason::Bind
                    },
                    FailedIface {
                        index: 2,
                        reason: FailReason::Send
                    },
                ],
            }
        );
        assert_eq!(
            serde_json::to_value(&summary).unwrap(),
            json!({ "scanned": 1, "found": 2,
                    "failed": [{ "index": 1, "reason": "bind" }, { "index": 2, "reason": "send" }] })
        );
    }

    /// T063: chọn card để quét: `null` → mọi card có broadcast; chỉ số không còn → lỗi `bind`; card
    /// không có broadcast vẫn vào danh sách (để `scan` báo `send`); chỉ số trùng chỉ quét một lần.
    #[test]
    fn targets_follow_the_interface_list() {
        let all = [
            classify_interface(
                0,
                "Ethernet",
                Ipv4Addr::new(192, 168, 1, 20),
                24,
                Some(Ipv4Addr::new(192, 168, 1, 255)),
                false,
            ),
            classify_interface(1, "WireGuard", Ipv4Addr::new(10, 8, 0, 2), 32, None, false),
        ];
        let (targets, missing) = select_targets(&all, None);
        assert_eq!(
            targets,
            [ScanTarget {
                index: 0,
                address: Ipv4Addr::new(192, 168, 1, 20),
                broadcast: Some(Ipv4Addr::new(192, 168, 1, 255)),
            }]
        );
        assert!(missing.is_empty());
        let (targets, missing) = select_targets(&all, Some(&[1, 7, 1]));
        assert_eq!(
            targets,
            [ScanTarget {
                index: 1,
                address: Ipv4Addr::new(10, 8, 0, 2),
                broadcast: None,
            }]
        );
        assert_eq!(
            missing,
            [FailedIface {
                index: 7,
                reason: FailReason::Bind
            }]
        );
    }

    /// T063: liệt kê card của máy đang chạy test: chỉ số 0..n liên tiếp, không có loopback, địa chỉ
    /// IPv4 hợp lệ, broadcast khớp prefix (máy không có card mạng thì danh sách rỗng).
    #[test]
    fn lists_the_ipv4_interfaces_of_this_machine() {
        let list = list_interfaces();
        for (i, card) in list.iter().enumerate() {
            assert_eq!(card.index as usize, i, "{card:?}");
            let ip: Ipv4Addr = card.address.parse().unwrap();
            assert!(!ip.is_loopback(), "{card:?}");
            assert!(card.prefix <= 32, "{card:?}");
            assert_eq!(card.can_broadcast, card.broadcast.is_some(), "{card:?}");
            if card.prefix >= 31 {
                assert!(!card.can_broadcast, "{card:?}");
            }
        }
    }

    /// T063: không card nào dùng được (bind lỗi, không có broadcast) → trả kết quả ngay, không chờ
    /// 2,5 s; không gửi gì.
    #[tokio::test]
    async fn scan_without_usable_cards_returns_at_once() {
        let mut net = FakeNet {
            now: 0,
            bind_fail: vec![Ipv4Addr::new(10, 0, 0, 5)],
            send_fail: Vec::new(),
            bound: Vec::new(),
            sends: Vec::new(),
            inbox: VecDeque::new(),
        };
        let targets = [
            ScanTarget {
                index: 4,
                address: Ipv4Addr::new(10, 0, 0, 5),
                broadcast: Some(Ipv4Addr::new(10, 0, 0, 255)),
            },
            ScanTarget {
                index: 2,
                address: Ipv4Addr::new(10, 8, 0, 2),
                broadcast: None,
            },
        ];
        let summary = scan(&mut net, &targets, NONCE, DISCOVERY_PORT, |_| {}).await;
        assert_eq!(net.now, 0, "không chờ");
        assert!(net.sends.is_empty() && net.bound.is_empty());
        assert_eq!(
            summary,
            DiscoverSummary {
                scanned: 0,
                found: 0,
                failed: vec![
                    FailedIface {
                        index: 2,
                        reason: FailReason::Send
                    },
                    FailedIface {
                        index: 4,
                        reason: FailReason::Bind
                    },
                ],
            }
        );
        let none = scan(&mut net, &[], NONCE, DISCOVERY_PORT, |_| {}).await;
        assert_eq!(
            none,
            DiscoverSummary {
                scanned: 0,
                found: 0,
                failed: vec![]
            }
        );
        assert_eq!(net.now, 0);
    }

    /// T062: socket thật trên 127.0.0.1 (thiết bị giả trả lời đúng nonce của gói hỏi): lượt quét
    /// kéo dài khoảng 2,5 s, gửi 3 gói, nhận một thiết bị với IP nguồn UDP.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_udp_sockets_on_loopback() {
        let device = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = device.local_addr().unwrap().port();
        let template = hex(vector("reply-valid")["packet"].as_str().unwrap());
        let queries = Arc::new(AtomicUsize::new(0));
        let counter = queries.clone();
        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 2048];
            while let Ok((n, from)) = device.recv_from(&mut buf).await {
                counter.fetch_add(1, Ordering::SeqCst);
                if n == QUERY_SIZE {
                    let mut reply = template.clone();
                    reply[8..24].copy_from_slice(&buf[8..24]);
                    let _ = device.send_to(&reply, from).await;
                }
            }
        });
        let lo = Ipv4Addr::LOCALHOST;
        let targets = [ScanTarget {
            index: 3,
            address: lo,
            broadcast: Some(lo),
        }];
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let mut net = UdpNet::new();
        let mut found = Vec::new();
        let started = Instant::now();
        let summary = scan(&mut net, &targets, nonce, port, |d| found.push(d)).await;
        let elapsed = started.elapsed();
        responder.abort();
        assert!(
            elapsed >= Duration::from_millis(2400) && elapsed < Duration::from_millis(3000),
            "{elapsed:?}"
        );
        assert_eq!(
            summary,
            DiscoverSummary {
                scanned: 1,
                found: 1,
                failed: vec![]
            }
        );
        assert_eq!((found[0].iface, found[0].ip.as_str()), (3, "127.0.0.1"));
        assert_eq!(queries.load(Ordering::SeqCst), 3);
    }

    /// T062: lượt quét thứ hai khi đang chạy → `busy`; xong lượt trước thì quét lại được.
    #[test]
    fn second_scan_while_running_is_busy() {
        let d = Discovery::default();
        let guard = d.try_begin().unwrap();
        assert!(matches!(d.try_begin(), Err(DiscoverError::Busy)));
        drop(guard);
        assert!(d.try_begin().is_ok());
        assert_eq!(
            serde_json::to_value(DiscoverError::Busy).unwrap(),
            json!("busy")
        );
    }

    fn device(ip: &str, fp: Option<&str>) -> DiscoveredDevice {
        let mut d = parse_reply(&reply_packet(&minimal(), 0), &NONCE, ip.parse().unwrap())
            .unwrap()
            .device;
        d.fingerprint = fp.map(str::to_string);
        d
    }

    /// T063: fingerprint của gói tìm gần nhất chỉ trong bộ nhớ, tra theo `deviceId` (ưu tiên cùng
    /// IP) hoặc theo IP.
    #[test]
    fn remembers_the_latest_fingerprint() {
        let d = Discovery::default();
        let fp_b = "b".repeat(64);
        d.remember(&device("192.168.1.110", Some(FP_A)));
        assert_eq!(
            d.fingerprint_for(Some(ID_A), "192.168.1.110").as_deref(),
            Some(FP_A)
        );
        assert_eq!(
            d.fingerprint_for(Some(ID_A), "bl335.local").as_deref(),
            Some(FP_A)
        );
        assert_eq!(
            d.fingerprint_for(None, "192.168.1.110").as_deref(),
            Some(FP_A)
        );
        assert_eq!(d.fingerprint_for(None, "192.168.1.111"), None);
        assert_eq!(
            d.fingerprint_for(
                Some("00000000-0000-4000-8000-000000000000"),
                "192.168.1.110"
            ),
            None
        );
        d.remember(&device("192.168.1.111", Some(&fp_b)));
        assert_eq!(
            d.fingerprint_for(Some(ID_A), "192.168.1.110").as_deref(),
            Some(FP_A)
        );
        assert_eq!(
            d.fingerprint_for(Some(ID_A), "192.168.1.111").as_deref(),
            Some(fp_b.as_str())
        );
        d.remember(&device("192.168.1.110", None));
        assert_eq!(d.fingerprint_for(Some(ID_A), "192.168.1.110"), None);
    }

    /// T063: sự kiện `found` đi qua `tauri::ipc::Channel` với hình dạng
    /// `{ kind: "found", device: DiscoveredDevice }`.
    #[test]
    fn found_event_goes_through_a_tauri_channel() {
        let got = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = got.clone();
        let channel: Channel<DiscoverEvent> = Channel::new(move |body| {
            if let InvokeResponseBody::Json(s) = body {
                sink.lock().unwrap().push(s);
            }
            Ok(())
        });
        let mut dev = device("192.168.1.110", Some(FP_A));
        dev.received_at = 1_791_601_205_000;
        channel
            .send(DiscoverEvent::Found {
                device: dev.clone(),
            })
            .unwrap();
        let v: Value = serde_json::from_str(&got.lock().unwrap()[0]).unwrap();
        assert_eq!(v["kind"], "found");
        assert_eq!(v["device"]["deviceId"], ID_A);
        assert_eq!(v["device"]["receivedAt"], 1_791_601_205_000u64);
        assert_eq!(v["device"]["fingerprint"], FP_A);
    }
}
