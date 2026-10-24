// Quality OPC DA → mã quality trong thanh ghi IR của cầu nối (spec 021 FR-003, FR-004).
// OPC: bit 7–6 là trạng thái (11 good, 01 uncertain, 00 bad), bit 5–2 là trạng thái con, bit 1–0 là giới hạn.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum MatQuality {
    Good = 0,
    Uncertain = 1,
    Bad = 2,
    /// Chưa nhận giá trị nào kể từ khi (kết nối lại) thêm item.
    NoData = 3,
}

pub fn from_opc(q: u16) -> MatQuality {
    match q & 0xC0 {
        0xC0 => MatQuality::Good,
        0x40 => MatQuality::Uncertain,
        _ => MatQuality::Bad,
    }
}

/// Mô tả ngắn trạng thái con để log (OPC DA 2.05a §6.8).
pub fn describe(q: u16) -> &'static str {
    match q & 0xFC {
        0xC0 => "good",
        0xD8 => "good, local override",
        0x40 => "uncertain",
        0x44 => "uncertain, last usable value",
        0x50 => "uncertain, sensor not accurate",
        0x54 => "uncertain, engineering units exceeded",
        0x58 => "uncertain, sub-normal",
        0x00 => "bad",
        0x04 => "bad, configuration error",
        0x08 => "bad, not connected",
        0x0C => "bad, device failure",
        0x10 => "bad, sensor failure",
        0x14 => "bad, last known value",
        0x18 => "bad, comm failure",
        0x1C => "bad, out of service",
        0x20 => "bad, waiting for initial data",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_major_status() {
        assert_eq!(from_opc(0xC0), MatQuality::Good);
        assert_eq!(from_opc(0xD8), MatQuality::Good);
        assert_eq!(from_opc(0xC3), MatQuality::Good, "limit bits ignored");
        assert_eq!(from_opc(0x40), MatQuality::Uncertain);
        assert_eq!(from_opc(0x54), MatQuality::Uncertain);
        assert_eq!(from_opc(0x00), MatQuality::Bad);
        assert_eq!(from_opc(0x18), MatQuality::Bad);
        assert_eq!(
            from_opc(0x80),
            MatQuality::Bad,
            "reserved major status is bad"
        );
        assert_eq!(MatQuality::NoData as u16, 3);
    }

    #[test]
    fn describes() {
        assert_eq!(describe(0x18), "bad, comm failure");
        assert_eq!(describe(0xC1), "good");
    }
}
