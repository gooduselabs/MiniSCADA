// Lớp trừu tượng OPC DA client (plan 021): engine chỉ nói chuyện qua trait này; `com.rs` là cài đặt COM thật (Windows),
// `MockClient` là OPC giả trong bộ nhớ cho test và backend "mock".
use crate::config::ItemType;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Value {
    Bool(bool),
    Num(f64),
}

impl Value {
    pub fn as_f64(self) -> f64 {
        match self {
            Value::Bool(b) => b as u8 as f64,
            Value::Num(n) => n,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ItemSpec {
    pub item: String,
    pub ty: ItemType,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Update {
    /// Chỉ số item trong cấu hình (client handle).
    pub index: usize,
    /// `None`: OPC trả lỗi hoặc VARIANT không đổi được sang số.
    pub value: Option<Value>,
    pub quality: u16,
    /// FILETIME (100 ns từ 1601) của OPC server; 0 nếu không có.
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrowseEntry {
    pub name: String,
    pub item_id: String,
    pub branch: bool,
}

pub trait OpcClient {
    fn connect(&mut self) -> Result<(), String>;
    /// Lỗi chung → Err; lỗi từng item → phần tử Err.
    fn add_items(&mut self, items: &[ItemSpec]) -> Result<Vec<Result<(), String>>, String>;
    /// Chờ tối đa `wait` để có cập nhật. Err: mất server.
    fn poll(&mut self, wait: Duration) -> Result<Vec<Update>, String>;
    fn write(&mut self, index: usize, value: Value) -> Result<(), String>;
    fn disconnect(&mut self);
    fn browse(&mut self, path: &str) -> Result<Vec<BrowseEntry>, String>;
}

// ---------------------------------------------------------------- OPC giả

#[derive(Debug, Default)]
pub struct MockState {
    pub up: bool,
    /// ItemID → (giá trị, quality OPC).
    pub values: HashMap<String, (Value, u16)>,
    pub read_only: Vec<String>,
    pub fail_write: Vec<String>,
    pub writes: Vec<(String, Value)>,
    pub connects: u32,
    pub changed: Vec<String>,
}

impl MockState {
    pub fn set(&mut self, item: &str, v: Value, q: u16) {
        self.values.insert(item.to_string(), (v, q));
        self.changed.push(item.to_string());
    }
}

#[derive(Clone)]
pub struct MockClient {
    pub state: Arc<Mutex<MockState>>,
    items: Vec<ItemSpec>,
    connected: bool,
    first: bool,
}

impl MockClient {
    pub fn new(state: Arc<Mutex<MockState>>) -> MockClient {
        MockClient {
            state,
            items: vec![],
            connected: false,
            first: true,
        }
    }

    /// Backend "mock" của CLI: mọi item tồn tại, giá trị 0, server luôn chạy; giá trị số tăng dần để thấy dữ liệu sống.
    pub fn demo() -> MockClient {
        let st = MockState {
            up: true,
            ..Default::default()
        };
        MockClient::new(Arc::new(Mutex::new(st)))
    }
}

impl OpcClient for MockClient {
    fn connect(&mut self) -> Result<(), String> {
        let mut s = self.state.lock().unwrap();
        if !s.up {
            return Err("0x800401F3 server not running".into());
        }
        s.connects += 1;
        self.connected = true;
        self.first = true;
        Ok(())
    }

    fn add_items(&mut self, items: &[ItemSpec]) -> Result<Vec<Result<(), String>>, String> {
        let s = self.state.lock().unwrap();
        if !s.up {
            return Err("server gone".into());
        }
        self.items = items.to_vec();
        Ok(items
            .iter()
            .map(|it| {
                if it.item.starts_with("missing") {
                    Err("0xC0040007 OPC_E_UNKNOWNITEMID".into())
                } else {
                    Ok(())
                }
            })
            .collect())
    }

    fn poll(&mut self, wait: Duration) -> Result<Vec<Update>, String> {
        let mut s = self.state.lock().unwrap();
        if !s.up || !self.connected {
            self.connected = false;
            return Err("0x800706BA RPC server unavailable".into());
        }
        let first = std::mem::replace(&mut self.first, false);
        let changed = std::mem::take(&mut s.changed);
        let mut out = vec![];
        for (i, it) in self.items.iter().enumerate() {
            if it.item.starts_with("missing") {
                continue;
            }
            if first || changed.contains(&it.item) {
                let (v, q) = s
                    .values
                    .get(&it.item)
                    .copied()
                    .unwrap_or((Value::Num(0.0), 0xC0));
                out.push(Update {
                    index: i,
                    value: Some(v),
                    quality: q,
                    timestamp: 0,
                });
            }
        }
        drop(s);
        if out.is_empty() && !wait.is_zero() {
            std::thread::sleep(wait.min(Duration::from_millis(50)));
        }
        Ok(out)
    }

    fn write(&mut self, index: usize, value: Value) -> Result<(), String> {
        let item = self.items.get(index).ok_or("bad handle")?.item.clone();
        let mut s = self.state.lock().unwrap();
        if !s.up {
            return Err("server gone".into());
        }
        if s.read_only.contains(&item) {
            return Err("0xC0040008 OPC_E_BADRIGHTS".into());
        }
        if s.fail_write.contains(&item) {
            return Err("0x80004005 E_FAIL".into());
        }
        s.writes.push((item.clone(), value));
        s.set(&item, value, 0xC0);
        Ok(())
    }

    fn disconnect(&mut self) {
        self.connected = false;
    }

    fn browse(&mut self, path: &str) -> Result<Vec<BrowseEntry>, String> {
        let s = self.state.lock().unwrap();
        let prefix = if path.is_empty() {
            String::new()
        } else {
            format!("{path}.")
        };
        let mut out: Vec<BrowseEntry> = vec![];
        for k in s.values.keys() {
            if let Some(rest) = k.strip_prefix(&prefix) {
                let (name, branch) = match rest.split_once('.') {
                    Some((b, _)) => (b.to_string(), true),
                    None => (rest.to_string(), false),
                };
                if !out.iter().any(|e| e.name == name) {
                    out.push(BrowseEntry {
                        item_id: format!("{prefix}{name}"),
                        name,
                        branch,
                    });
                }
            }
        }
        out.sort_by(|a, b| (!a.branch, &a.name).cmp(&(!b.branch, &b.name)));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_browse_tree() {
        let mut c = MockClient::demo();
        {
            let mut s = c.state.lock().unwrap();
            s.set("Ch1.Dev1.Level", Value::Num(1.0), 0xC0);
            s.set("Ch1.Dev1.Run", Value::Bool(true), 0xC0);
            s.set("Ch1.Status", Value::Num(1.0), 0xC0);
        }
        let root = c.browse("").unwrap();
        assert_eq!(
            root,
            vec![BrowseEntry {
                name: "Ch1".into(),
                item_id: "Ch1".into(),
                branch: true
            }]
        );
        let ch = c.browse("Ch1").unwrap();
        assert_eq!(
            ch.iter()
                .map(|e| (e.name.as_str(), e.branch))
                .collect::<Vec<_>>(),
            [("Dev1", true), ("Status", false)]
        );
        assert_eq!(c.browse("Ch1.Dev1").unwrap()[0].item_id, "Ch1.Dev1.Level");
    }
}
