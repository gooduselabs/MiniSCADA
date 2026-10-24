// Test tích hợp (spec 021 SC-002): client Modbus TCP thật ↔ cầu nối chạy OPC giả, qua socket loopback.
use mat_opcda_bridge::config::Config;
use mat_opcda_bridge::opc::{MockClient, MockState, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn cfg(allow: &str) -> Config {
    Config::parse(
        &serde_json::json!({
            "opc": { "backend": "mock", "updateRateMs": 20, "reconnectMaxS": 1 },
            "modbus": { "bind": "127.0.0.1", "port": 1, "allow": [allow], "writeTimeoutMs": 2000 },
            "items": [
                { "id": "T.LEVEL", "item": "Dev.Level", "type": "FLOAT32" },
                { "id": "T.RUN", "item": "Dev.Run", "type": "BOOL", "access": "RW" },
                { "id": "T.SP", "item": "Dev.Sp", "type": "INT32", "access": "RW" }
            ]
        })
        .to_string(),
    )
    .map(|mut c| {
        c.modbus.port = 0; // cổng ngẫu nhiên; validate đã qua với 1
        c
    })
    .unwrap()
}

struct Client {
    s: TcpStream,
    tid: u16,
}

impl Client {
    fn connect(addr: std::net::SocketAddr) -> Client {
        let s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        Client { s, tid: 0 }
    }
    fn call(&mut self, pdu: &[u8]) -> Vec<u8> {
        self.tid += 1;
        let mut f = self.tid.to_be_bytes().to_vec();
        f.extend([0, 0]);
        f.extend(((pdu.len() + 1) as u16).to_be_bytes());
        f.push(1);
        f.extend(pdu);
        self.s.write_all(&f).unwrap();
        let mut h = [0u8; 7];
        self.s.read_exact(&mut h).unwrap();
        assert_eq!(&h[0..2], &self.tid.to_be_bytes());
        let n = u16::from_be_bytes([h[4], h[5]]) as usize - 1;
        let mut p = vec![0u8; n];
        self.s.read_exact(&mut p).unwrap();
        p
    }
}

fn wait_until(mut f: impl FnMut() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(t.elapsed() < Duration::from_secs(5), "timeout");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn read_write_quality_and_reconnect() {
    let st = Arc::new(Mutex::new(MockState {
        up: true,
        ..Default::default()
    }));
    {
        let mut s = st.lock().unwrap();
        s.set("Dev.Level", Value::Num(1.5), 0xC0);
        s.set("Dev.Run", Value::Bool(true), 0xC0);
        s.set("Dev.Sp", Value::Num(-2.0), 0x40);
    }
    let r = mat_opcda_bridge::start(&cfg("127.0.0.1"), Some(MockClient::new(st.clone()))).unwrap();
    let mut c = Client::connect(r.addr);
    wait_until(|| c.call(&[4, 0, 3, 0, 1]) == [4, 2, 0, 1]);

    assert_eq!(
        c.call(&[3, 0, 0, 0, 4]),
        [3, 8, 0x3F, 0xC0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFE]
    );
    assert_eq!(c.call(&[1, 0, 0, 0, 1]), [1, 1, 1]);
    assert_eq!(
        c.call(&[4, 0, 0, 0, 3]),
        [4, 6, 0, 0, 0, 0, 0, 1],
        "quality good, good, uncertain"
    );

    // Ghi INT32 bằng FC16 → IOPCSyncIO::Write
    assert_eq!(c.call(&[16, 0, 2, 0, 2, 4, 0, 1, 0, 0]), [16, 0, 2, 0, 2]);
    assert_eq!(
        st.lock().unwrap().writes.last().unwrap(),
        &("Dev.Sp".to_string(), Value::Num(65536.0))
    );
    // Ghi coil FC05
    assert_eq!(c.call(&[5, 0, 0, 0, 0]), [5, 0, 0, 0, 0]);
    // Item chỉ đọc → 0x02; ghi nửa giá trị 32 bit → 0x02; ngoài tầm → 0x02
    assert_eq!(c.call(&[16, 0, 0, 0, 2, 4, 0, 0, 0, 0]), [0x90, 2]);
    assert_eq!(c.call(&[6, 0, 3, 0, 1]), [0x86, 2]);
    assert_eq!(c.call(&[3, 0, 3, 0, 2]), [0x83, 2]);
    // Lỗi ghi của OPC server → 0x04
    st.lock().unwrap().fail_write.push("Dev.Run".into());
    assert_eq!(c.call(&[5, 0, 0, 0xFF, 0]), [0x85, 4]);

    // Mất server: dữ liệu → 0x0B, IR vẫn đọc được với trạng thái 0 và quality bad
    st.lock().unwrap().up = false;
    wait_until(|| c.call(&[3, 0, 0, 0, 2]) == [0x83, 0x0B]);
    assert_eq!(c.call(&[4, 0, 0, 0, 4]), [4, 8, 0, 2, 0, 2, 0, 2, 0, 0]);
    // Server chạy lại → tự kết nối lại
    st.lock().unwrap().up = true;
    wait_until(|| c.call(&[4, 0, 3, 0, 1]) == [4, 2, 0, 1]);
    assert_eq!(c.call(&[3, 0, 0, 0, 2]), [3, 4, 0x3F, 0xC0, 0, 0]);
    drop(c);
    r.stop();
}

#[test]
fn denied_ip_is_closed_without_reply() {
    let r = mat_opcda_bridge::start(&cfg("10.9.9.9"), Some(MockClient::demo())).unwrap();
    let mut s = TcpStream::connect(r.addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let _ = s.write_all(&[0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 1]);
    let mut b = [0u8; 16];
    let n = s.read(&mut b).unwrap_or(0);
    assert_eq!(n, 0, "connection closed by bridge");
    r.stop();
}
