// Cấu hình JSON của cầu nối (spec 021 FR-002). Kiểm chặt: lỗi trả chuỗi có mã để log và CLI `check` in ra.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_ITEMS: usize = 5000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ItemType {
    Bool,
    Int16,
    Uint16,
    Int32,
    Uint32,
    Float32,
}

impl ItemType {
    /// Số thanh ghi 16 bit (BOOL nằm ở coil: 0 thanh ghi).
    pub fn registers(self) -> u16 {
        match self {
            ItemType::Bool => 0,
            ItemType::Int16 | ItemType::Uint16 => 1,
            ItemType::Int32 | ItemType::Uint32 | ItemType::Float32 => 2,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            ItemType::Bool => "BOOL",
            ItemType::Int16 => "INT16",
            ItemType::Uint16 => "UINT16",
            ItemType::Int32 => "INT32",
            ItemType::Uint32 => "UINT32",
            ItemType::Float32 => "FLOAT32",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Access {
    #[default]
    R,
    RW,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    #[default]
    Com,
    /// OPC giả trong bộ nhớ: chạy thử và test tích hợp không cần OPC server.
    Mock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpcConfig {
    #[serde(default)]
    pub prog_id: String,
    #[serde(default)]
    pub backend: Backend,
    #[serde(default = "d_update")]
    pub update_rate_ms: u32,
    #[serde(default)]
    pub deadband_percent: f32,
    #[serde(default = "d_reconnect")]
    pub reconnect_max_s: u32,
    #[serde(default = "d_group")]
    pub group_name: String,
    /// `false`: không dùng IOPCDataCallback, chỉ đọc cache theo chu kỳ.
    #[serde(default = "d_true")]
    pub subscription: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModbusConfig {
    #[serde(default = "d_bind")]
    pub bind: String,
    #[serde(default = "d_port")]
    pub port: u16,
    #[serde(default = "d_unit")]
    pub unit_id: u8,
    #[serde(default = "d_allow")]
    pub allow: Vec<String>,
    #[serde(default = "d_maxconn")]
    pub max_connections: usize,
    #[serde(default = "d_idle")]
    pub idle_timeout_s: u64,
    /// Thời gian chờ tối đa một lệnh ghi OPC trước khi trả ngoại lệ 0x04.
    #[serde(default = "d_wdeadline")]
    pub write_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogConfig {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub debug: bool,
    #[serde(default = "d_logmax")]
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemConfig {
    /// Tên Tag trong mAT.
    pub id: String,
    /// ItemID của OPC DA.
    pub item: String,
    #[serde(rename = "type")]
    pub ty: ItemType,
    #[serde(default)]
    pub access: Access,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub opc: OpcConfig,
    pub modbus: ModbusConfig,
    #[serde(default)]
    pub log: LogConfig,
    pub items: Vec<ItemConfig>,
}

fn d_update() -> u32 {
    500
}
fn d_reconnect() -> u32 {
    30
}
fn d_group() -> String {
    "mAT".into()
}
fn d_true() -> bool {
    true
}
fn d_bind() -> String {
    "0.0.0.0".into()
}
fn d_port() -> u16 {
    502
}
fn d_unit() -> u8 {
    1
}
fn d_allow() -> Vec<String> {
    vec!["127.0.0.1".into()]
}
fn d_maxconn() -> usize {
    8
}
fn d_idle() -> u64 {
    60
}
fn d_wdeadline() -> u64 {
    3000
}
fn d_logmax() -> u64 {
    5_000_000
}

/// Luật tên Tag của mAT (schemas/tag.schema.json): `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$`.
pub fn valid_tag_id(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 {
        return false;
    }
    let mut parts = s.split('.');
    let first = parts.next().unwrap_or("");
    let word = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if !word(first) || !first.as_bytes()[0].is_ascii_alphabetic() {
        return false;
    }
    parts.all(word)
}

impl Config {
    pub fn parse(text: &str) -> Result<Config, String> {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let c: Config = serde_json::from_str(text).map_err(|e| format!("E_CONFIG_JSON: {e}"))?;
        c.validate()?;
        Ok(c)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.opc.backend == Backend::Com && self.opc.prog_id.trim().is_empty() {
            return Err("E_CONFIG_PROGID: opc.progId is required".into());
        }
        if !(10..=3_600_000).contains(&self.opc.update_rate_ms) {
            return Err("E_CONFIG_RANGE: opc.updateRateMs must be 10..3600000".into());
        }
        if !(0.0..=100.0).contains(&self.opc.deadband_percent) {
            return Err("E_CONFIG_RANGE: opc.deadbandPercent must be 0..100".into());
        }
        if !(1..=3600).contains(&self.opc.reconnect_max_s) {
            return Err("E_CONFIG_RANGE: opc.reconnectMaxS must be 1..3600".into());
        }
        if self.modbus.port == 0 {
            return Err("E_CONFIG_RANGE: modbus.port must be 1..65535".into());
        }
        if self.modbus.bind.parse::<std::net::IpAddr>().is_err() {
            return Err("E_CONFIG_BIND: modbus.bind must be an IP address".into());
        }
        if self.modbus.allow.is_empty() {
            return Err("E_CONFIG_ALLOW: modbus.allow must not be empty".into());
        }
        for a in &self.modbus.allow {
            crate::allow::Rule::parse(a).map_err(|e| format!("E_CONFIG_ALLOW: {e}"))?;
        }
        if !(1..=64).contains(&self.modbus.max_connections) {
            return Err("E_CONFIG_RANGE: modbus.maxConnections must be 1..64".into());
        }
        if self.items.is_empty() {
            return Err("E_CONFIG_ITEMS: items must not be empty".into());
        }
        if self.items.len() > MAX_ITEMS {
            return Err(format!("E_CONFIG_ITEMS: at most {MAX_ITEMS} items"));
        }
        let mut seen = HashSet::new();
        for (i, it) in self.items.iter().enumerate() {
            if !valid_tag_id(&it.id) {
                return Err(format!(
                    "E_CONFIG_ITEM_ID: items[{i}].id '{}' is not a valid mAT Tag name",
                    it.id
                ));
            }
            if !seen.insert(it.id.to_ascii_lowercase()) {
                return Err(format!(
                    "E_CONFIG_ITEM_DUP: items[{i}].id '{}' is duplicated",
                    it.id
                ));
            }
            if it.item.trim().is_empty() || it.item.len() > 512 {
                return Err(format!(
                    "E_CONFIG_ITEM: items[{i}].item must be 1..512 characters"
                ));
            }
        }
        let regs: u32 = self.items.iter().map(|i| i.ty.registers() as u32).sum();
        if regs > 60000 {
            return Err("E_CONFIG_ITEMS: register map exceeds 60000 registers".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> serde_json::Value {
        serde_json::json!({
            "opc": { "progId": "Matrikon.OPC.Simulation.1" },
            "modbus": { "port": 1502, "allow": ["192.168.1.0/24"] },
            "items": [
                { "id": "TANK1.LEVEL", "item": "Random.Real4", "type": "FLOAT32" },
                { "id": "PUMP1.RUN", "item": "Bucket Brigade.Boolean", "type": "BOOL", "access": "RW" }
            ]
        })
    }

    fn parse(v: &serde_json::Value) -> Result<Config, String> {
        Config::parse(&v.to_string())
    }

    #[test]
    fn defaults_applied() {
        let c = parse(&base()).unwrap();
        assert_eq!(c.opc.update_rate_ms, 500);
        assert_eq!(c.modbus.unit_id, 1);
        assert_eq!(c.modbus.bind, "0.0.0.0");
        assert_eq!(c.items[0].access, Access::R);
        assert_eq!(c.items[1].access, Access::RW);
        assert!(c.opc.subscription);
    }

    #[test]
    fn bom_accepted() {
        let t = format!("\u{feff}{}", base());
        assert!(Config::parse(&t).is_ok());
    }

    #[test]
    fn rejects_bad_values() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            ("E_CONFIG_PROGID", serde_json::json!("")),
            ("E_CONFIG_ITEM_ID", serde_json::json!("1BAD")),
            ("E_CONFIG_ITEM_DUP", serde_json::json!("dup")),
            ("E_CONFIG_ALLOW", serde_json::json!("allow")),
            ("E_CONFIG_JSON", serde_json::json!("unknown")),
            ("E_CONFIG_JSON", serde_json::json!("type")),
        ];
        for (code, what) in cases {
            let mut v = base();
            match what.as_str().unwrap() {
                "" => v["opc"]["progId"] = serde_json::json!(""),
                "1BAD" => v["items"][0]["id"] = serde_json::json!("1BAD"),
                "dup" => v["items"][1]["id"] = serde_json::json!("tank1.level"),
                "allow" => v["modbus"]["allow"] = serde_json::json!(["300.1.1.1"]),
                "unknown" => v["modbus"]["extra"] = serde_json::json!(1),
                "type" => v["items"][0]["type"] = serde_json::json!("STRING"),
                _ => unreachable!(),
            }
            let e = parse(&v).unwrap_err();
            assert!(e.starts_with(code), "{code}: {e}");
        }
    }

    #[test]
    fn mock_backend_needs_no_progid() {
        let mut v = base();
        v["opc"] = serde_json::json!({ "backend": "mock" });
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn tag_id_rules() {
        for ok in ["A", "TANK1.LEVEL", "a_b.0x", "X.Y.Z"] {
            assert!(valid_tag_id(ok), "{ok}");
        }
        for bad in ["", "1A", "A.", ".A", "A..B", "A-B", "Á"] {
            assert!(!valid_tag_id(bad), "{bad}");
        }
    }
}
