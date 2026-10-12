//! Thiết bị đã dùng (`KnownDevice`, data-model §2; contracts/tauri-commands.md §3).
//!
//! Rust giữ `devices.json` trong thư mục cấu hình của ứng dụng (như `recent.json` của 004); giao
//! diện chỉ thấy bản sao. File không có khóa nào cho mật khẩu hay token. Tối đa 64 thiết bị. File
//! hỏng thì coi như rỗng và bị ghi đè ở lần lưu sau (ghim mất thì lần sau phải xác nhận lại: an
//! toàn). Ghi atomic: file tạm, `fsync`, `rename`.

use crate::project_fs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

pub const MAX_DEVICES: usize = 64;
pub const MAX_NAME_CHARS: usize = 64;
pub const DEFAULT_HTTPS_PORT: u16 = 8443;
pub const DEFAULT_HTTP_PORT: u16 = 8080;
/// Trần `devices.json`: 64 mục chỉ khoảng 30 KB, file lớn hơn coi như hỏng.
const MAX_FILE_BYTES: u64 = 256 * 1024;

/// Ghim: fingerprint SHA-256 (64 hex chữ thường) của chứng chỉ người dùng đã xác nhận.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub fingerprint: String,
    /// ISO 8601 UTC.
    pub pinned_at: String,
}

/// Một thiết bị đã lưu. Không có mật khẩu, không có token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownDevice {
    pub id: String,
    pub name: String,
    pub host: String,
    pub https_port: u16,
    pub http_port: u16,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub mac: Option<String>,
    #[serde(default)]
    pub pin: Option<Pin>,
    #[serde(default)]
    pub last_user: Option<String>,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub last_runtime: Option<String>,
}

impl KnownDevice {
    /// Tên mặc định: thiết bị thêm theo địa chỉ mang tên là `host` tới khi biết tên thiết bị báo.
    pub fn has_default_name(&self) -> bool {
        self.name == self.host
    }

    /// Tên thiết bị báo (`device/identity.name`) thay tên mặc định (T085a). Tên người dùng đã đặt (khác
    /// `host`) thì giữ. Tên báo về được làm sạch như tên nhập tay; rỗng thì bỏ qua. Trả `true` nếu đổi.
    pub fn adopt_reported_name(&mut self, reported: &str) -> bool {
        if !self.has_default_name() {
            return false;
        }
        let name = clean_name(reported);
        if name.is_empty() || name == self.name {
            return false;
        }
        self.name = name;
        true
    }
}

/// `fromDiscovery` của `device_add`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FromDiscovery {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub mac: Option<String>,
    /// Nhận theo contract nhưng cố ý không dùng: fingerprint của gói tìm chỉ để tham khảo, không
    /// được lưu và không được ghim (R6). `device_probe.discovered` lấy từ bộ nhớ của lượt quét.
    #[serde(default)]
    #[allow(dead_code)]
    pub fingerprint: Option<String>,
}

/// Tham số của `device_add`.
#[derive(Debug, Clone, Default)]
pub struct NewDevice {
    pub host: String,
    pub https_port: Option<i64>,
    pub http_port: Option<i64>,
    pub name: Option<String>,
    pub from_discovery: Option<FromDiscovery>,
}

/// Tham số của `device_update` (trường `None` giữ nguyên).
#[derive(Debug, Clone, Default)]
pub struct DevicePatch {
    pub name: Option<String>,
    pub host: Option<String>,
    pub https_port: Option<i64>,
    pub http_port: Option<i64>,
}

/// Lỗi của kho thiết bị.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RegistryError {
    NoSuchDevice,
    BadAddress,
    TooMany,
    Io(String),
}

/// Tên máy hoặc IPv4 theo luật `normalizeDevice` của 004 (chữ, số, `.`, `-`; đầu và cuối là chữ
/// hoặc số; tối đa 253 ký tự), bỏ khoảng trắng hai đầu. Bộ phân tích URL (WHATWG) hiểu khác một số
/// dạng (số 0 đầu là bát phân, IPv4 thiếu octet, nhãn cuối là số): chỉ nhận khi URL giữ đúng tên
/// đã nhập, để địa chỉ người dùng thấy là địa chỉ được gọi.
pub fn valid_host(host: &str) -> Option<String> {
    let host = host.trim();
    let b = host.as_bytes();
    let (first, last) = (*b.first()?, *b.last()?);
    if b.len() > 253
        || !first.is_ascii_alphanumeric()
        || !last.is_ascii_alphanumeric()
        || !b
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
    {
        return None;
    }
    let url = reqwest::Url::parse(&format!("https://{host}/")).ok()?;
    (url.host_str()? == host.to_ascii_lowercase()).then(|| host.to_string())
}

/// Cổng 1–65535; thiếu thì cổng mặc định.
pub fn valid_port(port: Option<i64>, default: u16) -> Option<u16> {
    match port {
        None => Some(default),
        Some(p) => u16::try_from(p).ok().filter(|p| *p != 0),
    }
}

/// 64 hex chữ thường.
pub fn is_fingerprint(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// UUID dạng `8-4-4-4-12` hex (chữ hoa hay thường).
pub fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// MAC dạng `AA:BB:CC:DD:EE:FF` (chữ hoa hay thường).
pub fn is_mac(s: &str) -> bool {
    s.len() == 17
        && s.bytes().enumerate().all(|(i, b)| match i % 3 {
            2 => b == b':',
            _ => b.is_ascii_hexdigit(),
        })
}

/// Tên hiển thị: bỏ ký tự điều khiển và khoảng trắng hai đầu, tối đa 64 ký tự.
fn clean_name(name: &str) -> String {
    let visible: String = name.chars().filter(|c| !c.is_control()).collect();
    let cut: String = visible.trim().chars().take(MAX_NAME_CHARS).collect();
    cut.trim_end().to_string()
}

/// Kho `devices.json`. Đường dẫn file truyền vào, nên test không cần Tauri.
pub struct Registry {
    file: PathBuf,
    /// Giữ trọn một lượt đọc-sửa-ghi: các lệnh async có thể chạy cùng lúc.
    lock: Mutex<()>,
}

impl Registry {
    pub fn new(file: PathBuf) -> Self {
        Registry {
            file,
            lock: Mutex::new(()),
        }
    }

    pub fn list(&self) -> Vec<KnownDevice> {
        let _guard = self.guard();
        self.load()
    }

    pub fn get(&self, id: &str) -> Result<KnownDevice, RegistryError> {
        self.list()
            .into_iter()
            .find(|d| d.id == id)
            .ok_or(RegistryError::NoSuchDevice)
    }

    /// Thêm thiết bị; đã có `host:httpsPort` (tên máy không phân biệt hoa thường) thì trả mục cũ.
    pub fn add(&self, input: NewDevice) -> Result<KnownDevice, RegistryError> {
        let host = valid_host(&input.host).ok_or(RegistryError::BadAddress)?;
        let https_port =
            valid_port(input.https_port, DEFAULT_HTTPS_PORT).ok_or(RegistryError::BadAddress)?;
        let http_port =
            valid_port(input.http_port, DEFAULT_HTTP_PORT).ok_or(RegistryError::BadAddress)?;
        let _guard = self.guard();
        let mut list = self.load();
        if let Some(existing) = list
            .iter()
            .find(|d| d.https_port == https_port && d.host.eq_ignore_ascii_case(&host))
        {
            return Ok(existing.clone());
        }
        if list.len() >= MAX_DEVICES {
            return Err(RegistryError::TooMany);
        }
        let from = input.from_discovery.unwrap_or_default();
        let name = input
            .name
            .as_deref()
            .map(clean_name)
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| host.clone());
        let device = KnownDevice {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            host,
            https_port,
            http_port,
            device_id: from.device_id.filter(|s| is_uuid(s)),
            mac: from.mac.filter(|s| is_mac(s)),
            pin: None,
            last_user: None,
            last_seen_at: None,
            last_runtime: None,
        };
        list.push(device.clone());
        self.save(&list)?;
        Ok(device)
    }

    /// Sửa tên, địa chỉ, cổng. Đổi `host` không xóa ghim (ghim gắn với chứng chỉ); tên còn là tên mặc
    /// định thì theo `host` mới. Kiểm hết tham số trước khi ghi: sai thì không đổi gì.
    pub fn update(&self, id: &str, patch: DevicePatch) -> Result<KnownDevice, RegistryError> {
        let bad = || RegistryError::BadAddress;
        let host = patch
            .host
            .as_deref()
            .map(|h| valid_host(h).ok_or_else(bad))
            .transpose()?;
        let https_port = patch
            .https_port
            .map(|p| valid_port(Some(p), DEFAULT_HTTPS_PORT).ok_or_else(bad))
            .transpose()?;
        let http_port = patch
            .http_port
            .map(|p| valid_port(Some(p), DEFAULT_HTTP_PORT).ok_or_else(bad))
            .transpose()?;
        self.modify(id, |d| {
            let default_name = d.has_default_name();
            if let Some(h) = host {
                d.host = h;
            }
            if let Some(p) = https_port {
                d.https_port = p;
            }
            if let Some(p) = http_port {
                d.http_port = p;
            }
            match patch.name.as_deref() {
                Some(name) => {
                    let name = clean_name(name);
                    d.name = if name.is_empty() {
                        d.host.clone()
                    } else {
                        name
                    };
                }
                // Tên mặc định đi theo `host` mới: lần đọc định danh sau còn đặt được tên thiết bị.
                None if default_name => d.name = d.host.clone(),
                None => {}
            }
        })
    }

    pub fn forget(&self, id: &str) -> Result<(), RegistryError> {
        let _guard = self.guard();
        let mut list = self.load();
        let before = list.len();
        list.retain(|d| d.id != id);
        if list.len() == before {
            return Err(RegistryError::NoSuchDevice);
        }
        self.save(&list)
    }

    /// Đọc-sửa-ghi một mục dưới khóa.
    pub fn modify(
        &self,
        id: &str,
        edit: impl FnOnce(&mut KnownDevice),
    ) -> Result<KnownDevice, RegistryError> {
        let _guard = self.guard();
        let mut list = self.load();
        let device = list
            .iter_mut()
            .find(|d| d.id == id)
            .ok_or(RegistryError::NoSuchDevice)?;
        edit(device);
        let updated = device.clone();
        self.save(&list)?;
        Ok(updated)
    }

    /// Khóa chỉ bảo vệ thứ tự đọc-sửa-ghi, không có dữ liệu: bỏ qua trạng thái "poisoned".
    fn guard(&self) -> MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Các mục trong file. Chưa có file, file hỏng hoặc quá lớn: rỗng. Mục sai (id không phải UUID,
    /// trùng id, địa chỉ hay cổng sai) bị bỏ; ghim sai dạng thành `null`; khóa lạ bị bỏ ở lần ghi
    /// sau.
    fn load(&self) -> Vec<KnownDevice> {
        let Ok(meta) = fs::metadata(&self.file) else {
            return Vec::new();
        };
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            return Vec::new();
        }
        let Some(Value::Array(items)) = fs::read(&self.file)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        else {
            return Vec::new();
        };
        let mut out: Vec<KnownDevice> = Vec::new();
        for item in items {
            let Ok(mut d) = serde_json::from_value::<KnownDevice>(item) else {
                continue;
            };
            if !is_uuid(&d.id) || out.iter().any(|o| o.id == d.id) {
                continue;
            }
            let Some(host) = valid_host(&d.host) else {
                continue;
            };
            if d.https_port == 0 || d.http_port == 0 {
                continue;
            }
            d.host = host;
            d.name = clean_name(&d.name);
            if d.name.is_empty() {
                d.name = d.host.clone();
            }
            if d.pin
                .as_ref()
                .is_some_and(|p| !is_fingerprint(&p.fingerprint))
            {
                d.pin = None;
            }
            d.device_id = d.device_id.filter(|s| is_uuid(s));
            d.mac = d.mac.filter(|s| is_mac(s));
            out.push(d);
            if out.len() == MAX_DEVICES {
                break;
            }
        }
        out
    }

    /// Ghi atomic, tạo thư mục cấu hình nếu chưa có (lần chạy đầu).
    fn save(&self, list: &[KnownDevice]) -> Result<(), RegistryError> {
        let io = |e: std::io::Error| RegistryError::Io(format!("{}: {e}", self.file.display()));
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }
        let json = serde_json::to_vec_pretty(list).map_err(|e| RegistryError::Io(e.to_string()))?;
        project_fs::write_atomic(&self.file, &json).map_err(io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::fs;

    /// Thư mục tạm riêng cho từng test (các test chạy song song).
    struct Tmp(PathBuf);
    impl Tmp {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir().join(format!("mat-devices-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        /// Kho trên `config/devices.json` (thư mục cấu hình chưa có tới lần ghi đầu).
        fn registry(&self) -> Registry {
            Registry::new(self.file())
        }
        fn file(&self) -> PathBuf {
            self.0.join("config/devices.json")
        }
        fn json(&self) -> Value {
            serde_json::from_slice(&fs::read(self.file()).unwrap()).unwrap()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const FP: &str = "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b";
    const DEV_ID: &str = "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10";

    fn add(host: &str) -> NewDevice {
        NewDevice {
            host: host.into(),
            ..NewDevice::default()
        }
    }

    fn is_uuid_v4(s: &str) -> bool {
        let b = s.as_bytes();
        s.len() == 36
            && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-')
            && b[14] == b'4'
            && s.chars()
                .enumerate()
                .all(|(i, c)| [8, 13, 18, 23].contains(&i) || c.is_ascii_hexdigit())
    }

    /// T064: `id` UUID, cổng mặc định 8443/8080, tên mặc định là địa chỉ; tham số và `fromDiscovery`
    /// được lưu (trừ fingerprint của gói tìm); hình dạng JSON gửi giao diện.
    #[test]
    fn add_sets_defaults_and_fields() {
        let t = Tmp::new("add");
        let r = t.registry();
        assert!(r.list().is_empty());
        let a = r.add(add("192.168.1.110")).unwrap();
        assert!(is_uuid_v4(&a.id), "{}", a.id);
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            json!({ "id": a.id, "name": "192.168.1.110", "host": "192.168.1.110",
                    "httpsPort": 8443, "httpPort": 8080, "deviceId": null, "mac": null,
                    "pin": null, "lastUser": null, "lastSeenAt": null, "lastRuntime": null })
        );
        let b = r
            .add(NewDevice {
                host: " bl335-02.local ".into(),
                https_port: Some(9443),
                http_port: Some(9080),
                name: Some(format!("  Trạm\u{7} bơm {} ", "x".repeat(80))),
                from_discovery: Some(FromDiscovery {
                    device_id: Some(DEV_ID.into()),
                    mac: Some("C2:D9:CC:52:33:70".into()),
                    fingerprint: Some(FP.into()),
                }),
            })
            .unwrap();
        assert_eq!(b.host, "bl335-02.local");
        assert_eq!((b.https_port, b.http_port), (9443, 9080));
        assert_eq!(b.name.chars().count(), MAX_NAME_CHARS);
        assert!(b.name.starts_with("Trạm bơm x"), "{}", b.name);
        assert_eq!(b.device_id.as_deref(), Some(DEV_ID));
        assert_eq!(b.mac.as_deref(), Some("C2:D9:CC:52:33:70"));
        assert_eq!(b.pin, None, "fingerprint của gói tìm không được ghim");
        assert!(!fs::read_to_string(t.file()).unwrap().contains(FP));
        // `deviceId`, `mac` sai dạng thì bỏ (để trống), không làm hỏng lệnh.
        let c = r
            .add(NewDevice {
                host: "10.0.0.7".into(),
                from_discovery: Some(FromDiscovery {
                    device_id: Some("abc".into()),
                    mac: Some("zz".into()),
                    fingerprint: None,
                }),
                ..NewDevice::default()
            })
            .unwrap();
        assert_eq!((c.device_id, c.mac), (None, None));
        assert_eq!(r.list().len(), 3);
        assert_eq!(t.registry().list(), r.list(), "lần chạy sau đọc lại đúng");
    }

    /// T064: địa chỉ theo luật `normalizeDevice` của 004 (chỉ phần tên máy/IPv4), cổng 1–65535;
    /// địa chỉ mà bộ phân tích URL hiểu khác (số 0 đầu, IPv4 thiếu octet, nhãn cuối là số) cũng bị
    /// từ chối.
    #[test]
    fn bad_addresses_are_rejected() {
        let t = Tmp::new("bad");
        let r = t.registry();
        for bad in [
            "",
            "   ",
            "http://192.168.1.110",
            "192.168.1.110:8443",
            "host/path",
            "a b",
            "-bl335",
            "bl335-",
            "bl_335",
            "bl335.",
            "ä.local",
            "192.168.001.010",
            "1.2.3",
            "999.1.1.1",
            "abc.123",
            "0x7f.1",
            &"a".repeat(254),
        ] {
            assert_eq!(r.add(add(bad)), Err(RegistryError::BadAddress), "{bad:?}");
        }
        for port in [0, -1, 65536, 1 << 40] {
            let https = r.add(NewDevice {
                https_port: Some(port),
                ..add("10.0.0.1")
            });
            assert_eq!(https, Err(RegistryError::BadAddress), "https {port}");
            let http = r.add(NewDevice {
                http_port: Some(port),
                ..add("10.0.0.1")
            });
            assert_eq!(http, Err(RegistryError::BadAddress), "http {port}");
        }
        assert!(r.list().is_empty());
        for good in [
            "192.168.1.110",
            "10.0.0.1",
            "a",
            "bl335-01",
            "BL335.local",
            "x1.example.com",
        ] {
            assert!(r.add(add(good)).is_ok(), "{good:?}");
        }
        assert_eq!(valid_port(None, 8443), Some(8443));
        assert_eq!(valid_port(Some(65535), 8443), Some(65535));
        assert!(is_fingerprint(FP));
        assert!(!is_fingerprint(&FP.to_uppercase()));
        assert!(!is_fingerprint(&FP[1..]));
    }

    /// T064: trùng `host:httpsPort` (tên máy không phân biệt hoa thường) → trả mục cũ, không thêm.
    #[test]
    fn duplicate_host_and_port_returns_the_existing_entry() {
        let t = Tmp::new("dup");
        let r = t.registry();
        let a = r.add(add("BL335.local")).unwrap();
        let again = r
            .add(NewDevice {
                name: Some("Tên khác".into()),
                ..add("bl335.LOCAL")
            })
            .unwrap();
        assert_eq!(again, a);
        let other_port = r
            .add(NewDevice {
                https_port: Some(9443),
                ..add("bl335.local")
            })
            .unwrap();
        assert_ne!(other_port.id, a.id);
        assert_eq!(r.list().len(), 2);
    }

    /// T064: tối đa 64 thiết bị → `too-many`; mục trùng vẫn trả về khi đầy.
    #[test]
    fn at_most_64_devices() {
        let t = Tmp::new("many");
        let r = t.registry();
        let first = r.add(add("10.0.0.1")).unwrap();
        for i in 2..=MAX_DEVICES {
            r.add(add(&format!("10.0.0.{i}"))).unwrap();
        }
        assert_eq!(r.list().len(), MAX_DEVICES);
        assert_eq!(r.add(add("10.0.1.1")), Err(RegistryError::TooMany));
        assert_eq!(r.add(add("10.0.0.1")).unwrap(), first);
        assert_eq!(r.list().len(), MAX_DEVICES);
    }

    /// T064: `device_update` sửa tên/địa chỉ/cổng, đổi `host` giữ ghim; địa chỉ sai → `bad-address`
    /// và không đổi gì; `device_forget`; id lạ → `no-such-device`.
    #[test]
    fn update_keeps_the_pin_and_forget_removes() {
        let t = Tmp::new("update");
        let r = t.registry();
        let a = r.add(add("192.168.1.110")).unwrap();
        let pinned = r
            .modify(&a.id, |d| {
                d.pin = Some(Pin {
                    fingerprint: FP.into(),
                    pinned_at: "2026-10-11T01:00:00Z".into(),
                })
            })
            .unwrap();
        let moved = r
            .update(
                &a.id,
                DevicePatch {
                    host: Some("192.168.1.120".into()),
                    name: Some("Trạm 2".into()),
                    https_port: Some(9443),
                    http_port: Some(9080),
                },
            )
            .unwrap();
        assert_eq!(
            moved.pin, pinned.pin,
            "ghim gắn với chứng chỉ, không gắn với địa chỉ"
        );
        assert_eq!(
            (
                moved.host.as_str(),
                moved.name.as_str(),
                moved.https_port,
                moved.http_port
            ),
            ("192.168.1.120", "Trạm 2", 9443, 9080)
        );
        let before = t.json();
        assert_eq!(
            r.update(
                &a.id,
                DevicePatch {
                    host: Some("x y".into()),
                    ..DevicePatch::default()
                }
            ),
            Err(RegistryError::BadAddress)
        );
        assert_eq!(
            r.update(
                &a.id,
                DevicePatch {
                    https_port: Some(0),
                    ..DevicePatch::default()
                }
            ),
            Err(RegistryError::BadAddress)
        );
        assert_eq!(t.json(), before);
        assert_eq!(
            r.update("không-có", DevicePatch::default()),
            Err(RegistryError::NoSuchDevice)
        );
        assert_eq!(r.get(&a.id).unwrap(), moved);
        assert_eq!(r.get("không-có"), Err(RegistryError::NoSuchDevice));
        assert_eq!(
            r.modify("không-có", |_| {}),
            Err(RegistryError::NoSuchDevice)
        );
        r.forget(&a.id).unwrap();
        assert!(r.list().is_empty());
        assert_eq!(r.forget(&a.id), Err(RegistryError::NoSuchDevice));
    }

    /// T085a: thiết bị thêm theo địa chỉ mang tên mặc định là `host`. Tên thiết bị báo
    /// (`device/identity.name`) thay tên mặc định một lần; tên người dùng đã đặt (khác `host`) thì giữ;
    /// tên báo về được làm sạch như tên nhập tay, rỗng thì bỏ qua.
    #[test]
    fn reported_name_replaces_only_the_default_name() {
        let t = Tmp::new("adopt");
        let r = t.registry();
        let a = r.add(add("192.168.1.110")).unwrap();
        assert!(a.has_default_name());
        let renamed = r
            .modify(&a.id, |d| assert!(d.adopt_reported_name("BL335-01")))
            .unwrap();
        assert_eq!(renamed.name, "BL335-01");
        assert!(!renamed.has_default_name());
        // Đã có tên: lần báo sau (thiết bị đổi tên, máy khác ở cùng địa chỉ) không đổi nữa.
        let kept = r
            .modify(&a.id, |d| assert!(!d.adopt_reported_name("BL335-99")))
            .unwrap();
        assert_eq!(kept.name, "BL335-01");
        assert_eq!(t.registry().get(&a.id).unwrap().name, "BL335-01", "đã lưu");

        let b = r
            .add(NewDevice {
                name: Some("Trạm bơm".into()),
                ..add("10.0.0.2")
            })
            .unwrap();
        let b = r
            .modify(&b.id, |d| assert!(!d.adopt_reported_name("BL335-02")))
            .unwrap();
        assert_eq!(b.name, "Trạm bơm", "tên người dùng đặt");

        let c = r.add(add("10.0.0.3")).unwrap();
        let c = r
            .modify(&c.id, |d| assert!(!d.adopt_reported_name(" \u{7} ")))
            .unwrap();
        assert_eq!(c.name, "10.0.0.3", "tên báo về rỗng: giữ host");
        let long = format!(" Trạm\u{1b} {} ", "x".repeat(80));
        let c = r
            .modify(&c.id, |d| assert!(d.adopt_reported_name(&long)))
            .unwrap();
        assert_eq!(c.name.chars().count(), MAX_NAME_CHARS);
        assert!(c.name.starts_with("Trạm x"), "{}", c.name);
    }

    /// T085a: đổi `host` khi tên còn là tên mặc định thì tên theo `host` mới (vẫn là tên mặc định, lần
    /// đăng nhập sau còn đặt tên được); tên người dùng đặt thì giữ; tên truyền cùng lần sửa thì thắng.
    #[test]
    fn default_name_follows_the_host() {
        let t = Tmp::new("follow");
        let r = t.registry();
        let a = r.add(add("192.168.1.110")).unwrap();
        let moved = r
            .update(
                &a.id,
                DevicePatch {
                    host: Some("192.168.1.120".into()),
                    ..DevicePatch::default()
                },
            )
            .unwrap();
        assert_eq!(moved.name, "192.168.1.120");
        assert!(moved.has_default_name());
        let named = r
            .update(
                &a.id,
                DevicePatch {
                    host: Some("192.168.1.130".into()),
                    name: Some("Trạm 2".into()),
                    ..DevicePatch::default()
                },
            )
            .unwrap();
        assert_eq!(named.name, "Trạm 2");
        let kept = r
            .update(
                &a.id,
                DevicePatch {
                    host: Some("192.168.1.140".into()),
                    ..DevicePatch::default()
                },
            )
            .unwrap();
        assert_eq!(
            (kept.host.as_str(), kept.name.as_str()),
            ("192.168.1.140", "Trạm 2")
        );
    }

    /// Mọi khóa của một giá trị JSON, đệ quy.
    fn keys(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Object(m) => {
                for (k, v) in m {
                    out.push(k.to_ascii_lowercase());
                    keys(v, out);
                }
            }
            Value::Array(a) => a.iter().for_each(|v| keys(v, out)),
            _ => {}
        }
    }

    /// T064: `devices.json` không có khóa nào cho mật khẩu hay token; khóa lạ trong file (kể cả
    /// `token`) bị bỏ ở lần ghi sau.
    #[test]
    fn file_has_no_secret_keys() {
        let t = Tmp::new("secret");
        let r = t.registry();
        let a = r.add(add("192.168.1.110")).unwrap();
        r.modify(&a.id, |d| {
            d.pin = Some(Pin {
                fingerprint: FP.into(),
                pinned_at: "2026-10-11T01:00:00Z".into(),
            });
            d.last_user = Some("kysu1".into());
            d.last_seen_at = Some("2026-10-11T01:00:00Z".into());
            d.last_runtime = Some("0.4.0".into());
        })
        .unwrap();
        let mut seen = Vec::new();
        keys(&t.json(), &mut seen);
        for k in &seen {
            for bad in [
                "password",
                "passwd",
                "token",
                "secret",
                "session",
                "hash",
                "credential",
            ] {
                assert!(!k.contains(bad), "khóa {k} trong devices.json");
            }
        }
        let mut doc = t.json();
        doc[0]["token"] = json!("mats_khong-duoc-luu");
        doc[0]["password"] = json!("khong-duoc-luu");
        fs::write(t.file(), serde_json::to_vec(&doc).unwrap()).unwrap();
        assert_eq!(r.list().len(), 1, "khóa lạ không làm hỏng file");
        r.add(add("10.0.0.2")).unwrap();
        let text = fs::read_to_string(t.file()).unwrap();
        assert!(!text.contains("khong-duoc-luu"), "{text}");
    }

    /// T064: file hỏng → `[]`, ghi đè ở lần lưu sau; mục sai (id, địa chỉ, cổng) bị bỏ; ghim sai dạng
    /// thành `null` (phải xác nhận lại); file > 256 KB coi như hỏng.
    #[test]
    fn corrupt_file_reads_as_empty_and_is_overwritten() {
        let t = Tmp::new("corrupt");
        let r = t.registry();
        fs::create_dir_all(t.file().parent().unwrap()).unwrap();
        for bad in ["", "không phải JSON", "{}", "[{\"id\":1}]", "[1,2]"] {
            fs::write(t.file(), bad).unwrap();
            assert!(r.list().is_empty(), "{bad:?}");
        }
        let entry = |id: &str, host: &str, port: i64, fp: &str| {
            json!({ "id": id, "name": "X", "host": host, "httpsPort": port, "httpPort": 8080,
                    "pin": { "fingerprint": fp, "pinnedAt": "2026-10-11T01:00:00Z" } })
        };
        let id1 = "11111111-1111-4111-8111-111111111111";
        let id2 = "22222222-2222-4222-8222-222222222222";
        let doc = json!([
            entry(id1, "10.0.0.1", 8443, FP),
            entry(id2, "10.0.0.2", 8443, "KHÔNG-PHẢI-FINGERPRINT"),
            entry("không-phải-uuid", "10.0.0.3", 8443, FP),
            entry("33333333-3333-4333-8333-333333333333", "x y", 8443, FP),
            entry("44444444-4444-4444-8444-444444444444", "10.0.0.4", 0, FP),
            entry(id1, "10.0.0.5", 8443, FP),
        ]);
        fs::write(t.file(), serde_json::to_vec(&doc).unwrap()).unwrap();
        let list = r.list();
        let got: Vec<(&str, bool)> = list
            .iter()
            .map(|d| (d.host.as_str(), d.pin.is_some()))
            .collect();
        assert_eq!(got, [("10.0.0.1", true), ("10.0.0.2", false)]);
        fs::write(t.file(), format!("[{}]", " ".repeat(300 * 1024))).unwrap();
        assert!(r.list().is_empty(), "file > 256 KB");
        fs::write(t.file(), "hỏng").unwrap();
        let a = r.add(add("10.0.0.9")).unwrap();
        assert_eq!(t.registry().list(), vec![a]);
    }

    /// T064: ghi atomic: lỗi đổi tên (đích là thư mục) → `{ "io": … }`, không còn file tạm, nội
    /// dung cũ còn nguyên; hình dạng lỗi gửi giao diện.
    #[test]
    fn atomic_write_and_error_shapes() {
        let t = Tmp::new("atomic");
        let r = Registry::new(t.0.join("devices.json"));
        let a = r.add(add("10.0.0.1")).unwrap();
        let blocked = Registry::new(t.0.join("dir.json"));
        fs::create_dir_all(t.0.join("dir.json/sub")).unwrap();
        let err = blocked.add(add("10.0.0.2")).unwrap_err();
        assert!(
            matches!(&err, RegistryError::Io(d) if !d.is_empty()),
            "{err:?}"
        );
        assert!(t.0.join("dir.json/sub").is_dir());
        let leftovers: Vec<String> = fs::read_dir(&t.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        assert_eq!(r.list(), vec![a]);
        let names: Vec<String> = [
            RegistryError::NoSuchDevice,
            RegistryError::BadAddress,
            RegistryError::TooMany,
            RegistryError::Io("Access is denied. (os error 5)".into()),
        ]
        .iter()
        .map(|e| serde_json::to_string(e).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"no-such-device\"",
                "\"bad-address\"",
                "\"too-many\"",
                "{\"io\":\"Access is denied. (os error 5)\"}"
            ]
        );
    }
}
