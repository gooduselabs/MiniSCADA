// Bảng thanh ghi dùng chung giữa engine OPC và server Modbus (spec 021 FR-003). Số nhiều thanh ghi: thứ tự ABCD (word
// cao trước, byte cao trước) — mặc định `byteOrder` của thiết bị Modbus trong mAT.
use crate::config::ItemType;
use crate::map::Map;
use crate::opc::Value;
use crate::quality::MatQuality;

pub struct Image {
    pub coils: Vec<bool>,
    pub holding: Vec<u16>,
    /// Quality của từng item, rồi thanh ghi trạng thái cầu nối.
    pub input: Vec<u16>,
    pub connected: bool,
    pub timestamps: Vec<u64>,
}

impl Image {
    pub fn new(map: &Map) -> Image {
        let mut input = vec![MatQuality::NoData as u16; map.slots.len()];
        input.push(0);
        Image {
            coils: vec![false; map.coils as usize],
            holding: vec![0; map.holding as usize],
            input,
            connected: false,
            timestamps: vec![0; map.slots.len()],
        }
    }

    pub fn set_connected(&mut self, map: &Map, up: bool) {
        self.connected = up;
        self.input[map.status as usize] = up as u16;
        if !up {
            for q in &mut self.input[..map.slots.len()] {
                *q = MatQuality::Bad as u16;
            }
        }
    }

    pub fn set_quality(&mut self, map: &Map, i: usize, q: MatQuality) {
        self.input[map.slots[i].quality as usize] = q as u16;
    }

    pub fn store(&mut self, map: &Map, i: usize, ty: ItemType, v: Value) {
        let s = &map.slots[i];
        if s.coil {
            self.coils[s.offset as usize] = v.as_f64() != 0.0;
            return;
        }
        let regs = encode(ty, v);
        let o = s.offset as usize;
        self.holding[o..o + regs.len()].copy_from_slice(&regs);
    }
}

/// Giá trị → thanh ghi. Số ngoài tầm của kiểu bị kẹp (OPC server có thể trả kiểu rộng hơn).
pub fn encode(ty: ItemType, v: Value) -> Vec<u16> {
    let x = v.as_f64();
    let sat = |lo: f64, hi: f64| {
        if x.is_nan() {
            0.0
        } else {
            x.round().clamp(lo, hi)
        }
    };
    match ty {
        ItemType::Bool => vec![(x != 0.0) as u16],
        ItemType::Int16 => vec![sat(i16::MIN as f64, i16::MAX as f64) as i16 as u16],
        ItemType::Uint16 => vec![sat(0.0, u16::MAX as f64) as u16],
        ItemType::Int32 => split(sat(i32::MIN as f64, i32::MAX as f64) as i32 as u32),
        ItemType::Uint32 => split(sat(0.0, u32::MAX as f64) as u32),
        ItemType::Float32 => split((x as f32).to_bits()),
    }
}

fn split(u: u32) -> Vec<u16> {
    vec![(u >> 16) as u16, u as u16]
}

/// Thanh ghi → giá trị (lệnh ghi từ runtime).
pub fn decode(ty: ItemType, regs: &[u16]) -> Value {
    let join = || ((regs[0] as u32) << 16) | regs[1] as u32;
    match ty {
        ItemType::Bool => Value::Bool(regs[0] != 0),
        ItemType::Int16 => Value::Num(regs[0] as i16 as f64),
        ItemType::Uint16 => Value::Num(regs[0] as f64),
        ItemType::Int32 => Value::Num(join() as i32 as f64),
        ItemType::Uint32 => Value::Num(join() as f64),
        ItemType::Float32 => Value::Num(f32::from_bits(join()) as f64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_vectors() {
        assert_eq!(encode(ItemType::Float32, Value::Num(1.5)), [0x3FC0, 0x0000]);
        assert_eq!(encode(ItemType::Int16, Value::Num(-2.0)), [0xFFFE]);
        assert_eq!(
            encode(ItemType::Int16, Value::Num(40000.0)),
            [0x7FFF],
            "clamped"
        );
        assert_eq!(encode(ItemType::Uint16, Value::Num(-5.0)), [0]);
        assert_eq!(encode(ItemType::Int32, Value::Num(-1.0)), [0xFFFF, 0xFFFF]);
        assert_eq!(encode(ItemType::Uint32, Value::Num(65536.0)), [1, 0]);
        assert_eq!(encode(ItemType::Int16, Value::Bool(true)), [1]);
        assert_eq!(encode(ItemType::Int32, Value::Num(f64::NAN)), [0, 0]);
    }

    #[test]
    fn round_trip() {
        for (ty, v) in [
            (ItemType::Float32, 123.25),
            (ItemType::Int16, -300.0),
            (ItemType::Uint16, 65535.0),
            (ItemType::Int32, -100000.0),
            (ItemType::Uint32, 4000000000.0),
        ] {
            assert_eq!(
                decode(ty, &encode(ty, Value::Num(v))),
                Value::Num(v),
                "{ty:?}"
            );
        }
    }
}
