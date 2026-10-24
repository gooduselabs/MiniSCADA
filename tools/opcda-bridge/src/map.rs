// Bản đồ item → địa chỉ Modbus và CSV ánh xạ (spec 021 FR-003, US7). Địa chỉ theo cú pháp mAT `C`/`HR`/`IR` cơ sở 1.
use crate::config::{Access, Config, ItemType};

#[derive(Debug, Clone, PartialEq)]
pub struct Slot {
    /// Coil (BOOL) hoặc thanh ghi HR đầu tiên, tính từ 0.
    pub offset: u16,
    pub coil: bool,
    /// Thanh ghi IR chứa quality, tính từ 0.
    pub quality: u16,
}

#[derive(Debug, Clone)]
pub struct Map {
    pub slots: Vec<Slot>,
    pub coils: u16,
    pub holding: u16,
    /// IR của trạng thái cầu nối (1 = đã kết nối OPC), tính từ 0.
    pub status: u16,
}

impl Map {
    pub fn build(cfg: &Config) -> Map {
        let (mut c, mut h) = (0u16, 0u16);
        let mut slots = Vec::with_capacity(cfg.items.len());
        for (i, it) in cfg.items.iter().enumerate() {
            let s = if it.ty == ItemType::Bool {
                c += 1;
                Slot {
                    offset: c - 1,
                    coil: true,
                    quality: i as u16,
                }
            } else {
                h += it.ty.registers();
                Slot {
                    offset: h - it.ty.registers(),
                    coil: false,
                    quality: i as u16,
                }
            };
            slots.push(s);
        }
        Map {
            slots,
            coils: c,
            holding: h,
            status: cfg.items.len() as u16,
        }
    }

    pub fn address(&self, i: usize) -> String {
        let s = &self.slots[i];
        if s.coil {
            format!("C{}", s.offset as u32 + 1)
        } else {
            format!("HR{}", s.offset as u32 + 1)
        }
    }

    pub fn quality_address(&self, i: usize) -> String {
        format!("IR{}", self.slots[i].quality as u32 + 1)
    }

    pub fn status_address(&self) -> String {
        format!("IR{}", self.status as u32 + 1)
    }
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) || s.starts_with([' ']) || s.ends_with([' ']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Cột: id, type, address, access, qualityAddress, description, unit, opcItem. Dòng cuối là Tag trạng thái cầu nối
/// `<prefix>BRIDGE_OK`. UTF-8 có BOM để Excel mở đúng tiếng Việt.
pub const CSV_HEADER: &str = "id,type,address,access,qualityAddress,description,unit,opcItem";

pub fn to_csv(cfg: &Config, map: &Map) -> String {
    let mut out = String::from("\u{feff}");
    out.push_str(CSV_HEADER);
    out.push_str("\r\n");
    for (i, it) in cfg.items.iter().enumerate() {
        let acc = if it.access == Access::RW { "RW" } else { "R" };
        let row = [
            csv_field(&it.id),
            it.ty.name().to_string(),
            map.address(i),
            acc.to_string(),
            map.quality_address(i),
            csv_field(&it.description),
            csv_field(&it.unit),
            csv_field(&it.item),
        ];
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out.push_str(&format!(
        "BRIDGE_OK,UINT16,{},R,,Trạng thái cầu nối OPC DA (1 = đã kết nối),,\r\n",
        map.status_address()
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config::parse(
            &serde_json::json!({
                "opc": { "backend": "mock" },
                "modbus": {},
                "items": [
                    { "id": "A.F", "item": "x.f", "type": "FLOAT32", "description": "Mức, bồn \"1\"" },
                    { "id": "A.B", "item": "x.b", "type": "BOOL", "access": "RW" },
                    { "id": "A.I", "item": "x.i", "type": "INT16", "unit": "rpm" },
                    { "id": "A.D", "item": "x.d", "type": "UINT32", "access": "RW" },
                    { "id": "A.B2", "item": "x.b2", "type": "BOOL" }
                ]
            })
            .to_string(),
        )
        .unwrap()
    }

    #[test]
    fn assigns_consecutive_addresses() {
        let c = cfg();
        let m = Map::build(&c);
        let addrs: Vec<String> = (0..5).map(|i| m.address(i)).collect();
        assert_eq!(addrs, ["HR1", "C1", "HR3", "HR4", "C2"]);
        assert_eq!(m.holding, 5);
        assert_eq!(m.coils, 2);
        assert_eq!(m.quality_address(3), "IR4");
        assert_eq!(m.status_address(), "IR6");
    }

    #[test]
    fn csv_export() {
        let c = cfg();
        let csv = to_csv(&c, &Map::build(&c));
        let lines: Vec<&str> = csv.trim_start_matches('\u{feff}').split("\r\n").collect();
        assert_eq!(lines[0], CSV_HEADER);
        assert_eq!(
            lines[1],
            "A.F,FLOAT32,HR1,R,IR1,\"Mức, bồn \"\"1\"\"\",,x.f"
        );
        assert_eq!(lines[2], "A.B,BOOL,C1,RW,IR2,,,x.b");
        assert_eq!(lines[3], "A.I,INT16,HR3,R,IR3,,rpm,x.i");
        assert!(lines[6].starts_with("BRIDGE_OK,UINT16,IR6,R,"));
        assert!(csv.starts_with('\u{feff}'));
    }
}
