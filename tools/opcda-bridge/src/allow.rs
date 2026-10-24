// Danh sách IP được phép kết nối mặt Modbus (spec 021 FR-002, threat-model). Kiểm trước khi đọc byte nào.
use std::net::IpAddr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    net: IpAddr,
    prefix: u8,
}

fn to_bits(ip: IpAddr) -> (u128, u8) {
    match ip {
        IpAddr::V4(v) => (u32::from(v) as u128, 32),
        IpAddr::V6(v) => match v.to_ipv4_mapped() {
            Some(m) => (u32::from(m) as u128, 32),
            None => (u128::from(v), 128),
        },
    }
}

impl Rule {
    /// `a.b.c.d`, `a.b.c.d/n`, IPv6 và `/n` của IPv6.
    pub fn parse(s: &str) -> Result<Rule, String> {
        let s = s.trim();
        let (ip, prefix) = match s.split_once('/') {
            Some((a, p)) => (
                a,
                Some(
                    p.parse::<u8>()
                        .map_err(|_| format!("bad prefix in '{s}'"))?,
                ),
            ),
            None => (s, None),
        };
        let ip: IpAddr = ip.parse().map_err(|_| format!("bad IP address '{s}'"))?;
        let width = match ip {
            IpAddr::V4(_) => 32,
            IpAddr::V6(_) => 128,
        };
        let prefix = prefix.unwrap_or(width);
        if prefix > width {
            return Err(format!("prefix too long in '{s}'"));
        }
        Ok(Rule { net: ip, prefix })
    }

    pub fn matches(&self, ip: IpAddr) -> bool {
        let (n, nw) = to_bits(self.net);
        let (a, aw) = to_bits(ip);
        if nw != aw {
            return false;
        }
        let prefix = if nw == 32 && self.prefix > 32 {
            32
        } else {
            self.prefix
        } as u32;
        if prefix == 0 {
            return true;
        }
        let shift = nw as u32 - prefix;
        (n >> shift) == (a >> shift)
    }
}

pub struct AllowList(Vec<Rule>);

impl AllowList {
    pub fn parse(items: &[String]) -> Result<AllowList, String> {
        items
            .iter()
            .map(|s| Rule::parse(s))
            .collect::<Result<Vec<_>, _>>()
            .map(AllowList)
    }
    pub fn permits(&self, ip: IpAddr) -> bool {
        self.0.iter().any(|r| r.matches(ip))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn exact_and_cidr() {
        let l = AllowList::parse(&["192.0.2.10".into(), "10.0.0.0/8".into()]).unwrap();
        assert!(l.permits(ip("192.0.2.10")));
        assert!(!l.permits(ip("192.168.1.111")));
        assert!(l.permits(ip("10.200.3.4")));
        assert!(!l.permits(ip("11.0.0.1")));
        assert!(l.permits(ip("::ffff:192.0.2.10")), "IPv4-mapped IPv6");
        assert!(!l.permits(ip("::1")));
    }

    #[test]
    fn any_and_v6() {
        let l = AllowList::parse(&["0.0.0.0/0".into(), "fe80::/10".into()]).unwrap();
        assert!(l.permits(ip("8.8.8.8")));
        assert!(l.permits(ip("fe80::1")));
        assert!(!l.permits(ip("2001:db8::1")));
    }

    #[test]
    fn rejects_garbage() {
        for bad in [
            "",
            "1.2.3",
            "1.2.3.4/33",
            "1.2.3.4/x",
            "host.local",
            "::/129",
        ] {
            assert!(Rule::parse(bad).is_err(), "{bad}");
        }
    }
}
