// Mặt Modbus TCP server của cầu nối (spec 021 US2, US3, FR-005). Codec PDU thuần (`handle_pdu`, `handle_adu`) tách
// khỏi socket để test bằng vector; dữ liệu không tin cậy: mọi độ dài/số lượng được kiểm trước khi đọc.
use crate::allow::AllowList;
use crate::engine::{Shared, WriteReq};
use crate::image::decode;
use crate::log;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const ILLEGAL_FUNCTION: u8 = 0x01;
pub const ILLEGAL_ADDRESS: u8 = 0x02;
pub const ILLEGAL_VALUE: u8 = 0x03;
pub const DEVICE_FAILURE: u8 = 0x04;
pub const GATEWAY_TARGET_FAILED: u8 = 0x0B;

pub trait Backend {
    /// `coils`: FC01 (true) hay FC02 (false).
    fn read_bits(&self, coils: bool, start: u16, count: u16) -> Result<Vec<bool>, u8>;
    /// `holding`: FC03 (true) hay FC04 (false).
    fn read_regs(&self, holding: bool, start: u16, count: u16) -> Result<Vec<u16>, u8>;
    fn write_bits(&self, start: u16, vals: &[bool]) -> Result<(), u8>;
    fn write_regs(&self, start: u16, vals: &[u16]) -> Result<(), u8>;
}

fn be(b: &[u8], i: usize) -> u16 {
    u16::from_be_bytes([b[i], b[i + 1]])
}

fn exception(fc: u8, code: u8) -> Vec<u8> {
    vec![fc | 0x80, code]
}

fn pack_bits(bits: &[bool]) -> Vec<u8> {
    let mut out = vec![0u8; bits.len().div_ceil(8)];
    for (i, b) in bits.iter().enumerate() {
        if *b {
            out[i / 8] |= 1 << (i % 8);
        }
    }
    out
}

/// PDU yêu cầu → PDU trả lời (bình thường hoặc ngoại lệ).
pub fn handle_pdu(pdu: &[u8], b: &dyn Backend) -> Vec<u8> {
    let Some(&fc) = pdu.first() else {
        return exception(0, ILLEGAL_FUNCTION);
    };
    let r = (|| -> Result<Vec<u8>, u8> {
        match fc {
            1..=4 => {
                if pdu.len() != 5 {
                    return Err(ILLEGAL_VALUE);
                }
                let (start, count) = (be(pdu, 1), be(pdu, 3));
                let max = if fc <= 2 { 2000 } else { 125 };
                if count == 0 || count > max {
                    return Err(ILLEGAL_VALUE);
                }
                if start as u32 + count as u32 > 0x10000 {
                    return Err(ILLEGAL_ADDRESS);
                }
                let data = if fc <= 2 {
                    pack_bits(&b.read_bits(fc == 1, start, count)?)
                } else {
                    b.read_regs(fc == 3, start, count)?
                        .iter()
                        .flat_map(|r| r.to_be_bytes())
                        .collect()
                };
                let mut out = vec![fc, data.len() as u8];
                out.extend(data);
                Ok(out)
            }
            5 => {
                if pdu.len() != 5 {
                    return Err(ILLEGAL_VALUE);
                }
                let v = match be(pdu, 3) {
                    0xFF00 => true,
                    0x0000 => false,
                    _ => return Err(ILLEGAL_VALUE),
                };
                b.write_bits(be(pdu, 1), &[v])?;
                Ok(pdu.to_vec())
            }
            6 => {
                if pdu.len() != 5 {
                    return Err(ILLEGAL_VALUE);
                }
                b.write_regs(be(pdu, 1), &[be(pdu, 3)])?;
                Ok(pdu.to_vec())
            }
            15 | 16 => {
                if pdu.len() < 6 {
                    return Err(ILLEGAL_VALUE);
                }
                let (start, count, bytes) = (be(pdu, 1), be(pdu, 3), pdu[5] as usize);
                let (max, need) = if fc == 15 {
                    (1968, (count as usize).div_ceil(8))
                } else {
                    (123, count as usize * 2)
                };
                if count == 0 || count > max || bytes != need || pdu.len() != 6 + bytes {
                    return Err(ILLEGAL_VALUE);
                }
                if start as u32 + count as u32 > 0x10000 {
                    return Err(ILLEGAL_ADDRESS);
                }
                let data = &pdu[6..];
                if fc == 15 {
                    let bits: Vec<bool> = (0..count as usize)
                        .map(|i| data[i / 8] & (1 << (i % 8)) != 0)
                        .collect();
                    b.write_bits(start, &bits)?;
                } else {
                    let regs: Vec<u16> = (0..count as usize).map(|i| be(data, i * 2)).collect();
                    b.write_regs(start, &regs)?;
                }
                Ok(pdu[..5].to_vec())
            }
            _ => Err(ILLEGAL_FUNCTION),
        }
    })();
    r.unwrap_or_else(|code| exception(fc, code))
}

/// Kết quả xử lý một ADU: trả lời, hoặc đóng kết nối (khung sai).
#[derive(Debug, PartialEq)]
pub enum Adu {
    Reply(Vec<u8>),
    Close(&'static str),
}

/// `adu` là trọn khung MBAP (7 byte đầu + PDU).
pub fn handle_adu(adu: &[u8], unit: u8, b: &dyn Backend) -> Adu {
    if adu.len() < 8 || adu.len() > 260 {
        return Adu::Close("bad frame length");
    }
    if be(adu, 2) != 0 {
        return Adu::Close("bad protocol id");
    }
    if be(adu, 4) as usize != adu.len() - 6 {
        return Adu::Close("bad MBAP length");
    }
    let u = adu[6];
    let pdu = &adu[7..];
    let resp = if u == unit || u == 0 || u == 255 {
        handle_pdu(pdu, b)
    } else {
        exception(pdu[0], GATEWAY_TARGET_FAILED)
    };
    let mut out = Vec::with_capacity(7 + resp.len());
    out.extend_from_slice(&adu[0..4]);
    out.extend_from_slice(&((resp.len() + 1) as u16).to_be_bytes());
    out.push(u);
    out.extend(resp);
    Adu::Reply(out)
}

// ---------------------------------------------------------------- backend thật: bảng thanh ghi + ghi qua engine

pub struct BridgeBackend {
    pub shared: Arc<Shared>,
    pub writes: Mutex<Sender<WriteReq>>,
    pub write_timeout: Duration,
}

impl BridgeBackend {
    fn range(len: usize, start: u16, count: u16) -> Result<std::ops::Range<usize>, u8> {
        let (s, e) = (start as usize, start as usize + count as usize);
        if e > len {
            Err(ILLEGAL_ADDRESS)
        } else {
            Ok(s..e)
        }
    }

    fn submit(&self, jobs: Vec<(usize, crate::opc::Value)>) -> Result<(), u8> {
        let mut waits = vec![];
        {
            let tx = self.writes.lock().unwrap();
            for (index, value) in jobs {
                let (rt, rr) = mpsc::channel();
                tx.send(WriteReq {
                    index,
                    value,
                    reply: rt,
                })
                .map_err(|_| DEVICE_FAILURE)?;
                waits.push(rr);
            }
        }
        let mut code = None;
        for w in waits {
            match w.recv_timeout(self.write_timeout) {
                Ok(Ok(())) => {}
                Ok(Err(e)) if e == "E_READ_ONLY" => code = code.or(Some(ILLEGAL_ADDRESS)),
                Ok(Err(e)) if e == "E_OPC_DISCONNECTED" => {
                    code = code.or(Some(GATEWAY_TARGET_FAILED))
                }
                _ => code = code.or(Some(DEVICE_FAILURE)),
            }
        }
        code.map_or(Ok(()), Err)
    }
}

impl Backend for BridgeBackend {
    fn read_bits(&self, _coils: bool, start: u16, count: u16) -> Result<Vec<bool>, u8> {
        let img = self.shared.image.lock().unwrap();
        if !img.connected {
            return Err(GATEWAY_TARGET_FAILED);
        }
        Ok(img.coils[Self::range(img.coils.len(), start, count)?].to_vec())
    }

    fn read_regs(&self, holding: bool, start: u16, count: u16) -> Result<Vec<u16>, u8> {
        let img = self.shared.image.lock().unwrap();
        if !holding {
            // Quality và trạng thái: luôn đọc được, để runtime thấy BRIDGE_OK = 0.
            return Ok(img.input[Self::range(img.input.len(), start, count)?].to_vec());
        }
        if !img.connected {
            return Err(GATEWAY_TARGET_FAILED);
        }
        Ok(img.holding[Self::range(img.holding.len(), start, count)?].to_vec())
    }

    fn write_bits(&self, start: u16, vals: &[bool]) -> Result<(), u8> {
        let map = &self.shared.map;
        Self::range(map.coils as usize, start, vals.len() as u16)?;
        let mut jobs = vec![];
        for (k, v) in vals.iter().enumerate() {
            let off = start + k as u16;
            let i = map
                .slots
                .iter()
                .position(|s| s.coil && s.offset == off)
                .ok_or(ILLEGAL_ADDRESS)?;
            jobs.push((i, crate::opc::Value::Bool(*v)));
        }
        self.submit(jobs)
    }

    fn write_regs(&self, start: u16, vals: &[u16]) -> Result<(), u8> {
        let map = &self.shared.map;
        let r = Self::range(map.holding as usize, start, vals.len() as u16)?;
        let mut jobs = vec![];
        for (i, s) in map.slots.iter().enumerate() {
            if s.coil {
                continue;
            }
            let ty = self.shared.items[i].ty;
            let (a, e) = (
                s.offset as usize,
                s.offset as usize + ty.registers() as usize,
            );
            let inside = a >= r.start && e <= r.end;
            let overlap = a < r.end && e > r.start;
            if inside {
                jobs.push((i, decode(ty, &vals[a - r.start..e - r.start])));
            } else if overlap {
                return Err(ILLEGAL_ADDRESS); // ghi một nửa giá trị 32 bit
            }
        }
        self.submit(jobs)
    }
}

// ---------------------------------------------------------------- socket

fn serve_conn(mut s: TcpStream, unit: u8, b: &dyn Backend, idle: Duration) {
    let _ = s.set_read_timeout(Some(idle));
    let _ = s.set_write_timeout(Some(Duration::from_secs(5)));
    let _ = s.set_nodelay(true);
    let mut buf = [0u8; 260];
    loop {
        if s.read_exact(&mut buf[..7]).is_err() {
            return;
        }
        let len = be(&buf, 4) as usize;
        if !(2..=254).contains(&len) {
            log::warn("MODBUS_FRAME: bad MBAP length, closing");
            return;
        }
        if s.read_exact(&mut buf[7..6 + len]).is_err() {
            return;
        }
        match handle_adu(&buf[..6 + len], unit, b) {
            Adu::Reply(r) => {
                if s.write_all(&r).is_err() {
                    return;
                }
            }
            Adu::Close(why) => {
                log::warn(&format!("MODBUS_FRAME: {why}, closing"));
                return;
            }
        }
    }
}

pub struct ServerOpts {
    pub unit: u8,
    pub max_connections: usize,
    pub idle: Duration,
}

/// Chạy vòng accept (chặn). Kết nối từ IP ngoài allowlist bị đóng ngay, không đọc byte nào.
pub fn serve(
    listener: TcpListener,
    allow: AllowList,
    opts: ServerOpts,
    backend: Arc<BridgeBackend>,
) {
    let active = Arc::new(AtomicUsize::new(0));
    let allow = Arc::new(allow);
    for conn in listener.incoming() {
        if backend.shared.stop.load(Ordering::Relaxed) {
            break;
        }
        let Ok(s) = conn else { continue };
        let peer: SocketAddr = match s.peer_addr() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let ip: IpAddr = peer.ip();
        if !allow.permits(ip) {
            log::warn(&format!("MODBUS_DENIED: {ip} not in modbus.allow"));
            drop(s);
            continue;
        }
        if active.load(Ordering::SeqCst) >= opts.max_connections {
            log::warn(&format!(
                "MODBUS_LIMIT: {ip} refused, {} connections open",
                opts.max_connections
            ));
            drop(s);
            continue;
        }
        active.fetch_add(1, Ordering::SeqCst);
        log::info(&format!("MODBUS_CONNECT: {peer}"));
        let (b, a, unit, idle) = (backend.clone(), active.clone(), opts.unit, opts.idle);
        std::thread::spawn(move || {
            serve_conn(s, unit, &*b, idle);
            a.fetch_sub(1, Ordering::SeqCst);
            log::info(&format!("MODBUS_CLOSE: {peer}"));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        coils: RefCell<Vec<bool>>,
        regs: RefCell<Vec<u16>>,
    }

    impl Backend for Fake {
        fn read_bits(&self, _c: bool, start: u16, count: u16) -> Result<Vec<bool>, u8> {
            let c = self.coils.borrow();
            c.get(start as usize..start as usize + count as usize)
                .map(|s| s.to_vec())
                .ok_or(ILLEGAL_ADDRESS)
        }
        fn read_regs(&self, _h: bool, start: u16, count: u16) -> Result<Vec<u16>, u8> {
            let r = self.regs.borrow();
            r.get(start as usize..start as usize + count as usize)
                .map(|s| s.to_vec())
                .ok_or(ILLEGAL_ADDRESS)
        }
        fn write_bits(&self, start: u16, v: &[bool]) -> Result<(), u8> {
            let mut c = self.coils.borrow_mut();
            c.get_mut(start as usize..start as usize + v.len())
                .ok_or(ILLEGAL_ADDRESS)?
                .copy_from_slice(v);
            Ok(())
        }
        fn write_regs(&self, start: u16, v: &[u16]) -> Result<(), u8> {
            let mut r = self.regs.borrow_mut();
            r.get_mut(start as usize..start as usize + v.len())
                .ok_or(ILLEGAL_ADDRESS)?
                .copy_from_slice(v);
            Ok(())
        }
    }

    fn fake() -> Fake {
        let f = Fake::default();
        *f.coils.borrow_mut() = vec![true, false, true, true, false, false, false, false, true];
        *f.regs.borrow_mut() = vec![0x1234, 0xABCD, 7];
        f
    }

    #[test]
    fn pdu_vectors() {
        let f = fake();
        let cases: &[(&[u8], &[u8])] = &[
            (&[1, 0, 0, 0, 9], &[1, 2, 0x0D, 0x01]),
            (&[3, 0, 1, 0, 2], &[3, 4, 0xAB, 0xCD, 0, 7]),
            (&[4, 0, 2, 0, 2], &[0x84, ILLEGAL_ADDRESS]),
            (&[3, 0, 0, 0, 0], &[0x83, ILLEGAL_VALUE]),
            (&[3, 0, 0, 0, 126], &[0x83, ILLEGAL_VALUE]),
            (&[3, 0xFF, 0xFF, 0, 2], &[0x83, ILLEGAL_ADDRESS]),
            (&[3, 0, 0], &[0x83, ILLEGAL_VALUE]),
            (&[8, 0, 0, 0, 0], &[0x88, ILLEGAL_FUNCTION]),
            (&[5, 0, 1, 0x12, 0x34], &[0x85, ILLEGAL_VALUE]),
            (&[15, 0, 0, 0, 3, 2, 0, 0], &[0x8F, ILLEGAL_VALUE]),
            (&[16, 0, 0, 0, 1, 3, 0, 0, 0], &[0x90, ILLEGAL_VALUE]),
        ];
        for (req, want) in cases {
            assert_eq!(handle_pdu(req, &f), want.to_vec(), "{req:?}");
        }
    }

    #[test]
    fn writes() {
        let f = fake();
        assert_eq!(handle_pdu(&[5, 0, 1, 0xFF, 0], &f), vec![5, 0, 1, 0xFF, 0]);
        assert!(f.coils.borrow()[1]);
        assert_eq!(handle_pdu(&[6, 0, 2, 0, 9], &f), vec![6, 0, 2, 0, 9]);
        assert_eq!(
            handle_pdu(&[16, 0, 0, 0, 2, 4, 0, 1, 0, 2], &f),
            vec![16, 0, 0, 0, 2]
        );
        assert_eq!(*f.regs.borrow(), vec![1, 2, 9]);
        assert_eq!(
            handle_pdu(&[15, 0, 0, 0, 3, 1, 0b010], &f),
            vec![15, 0, 0, 0, 3]
        );
        assert_eq!(&f.coils.borrow()[..3], &[false, true, false]);
    }

    #[test]
    fn adu_framing() {
        let f = fake();
        let req = [0, 7, 0, 0, 0, 6, 1, 3, 0, 2, 0, 1];
        assert_eq!(
            handle_adu(&req, 1, &f),
            Adu::Reply(vec![0, 7, 0, 0, 0, 5, 1, 3, 2, 0, 7])
        );
        let other_unit = [0, 7, 0, 0, 0, 6, 9, 3, 0, 2, 0, 1];
        assert_eq!(
            handle_adu(&other_unit, 1, &f),
            Adu::Reply(vec![0, 7, 0, 0, 0, 3, 9, 0x83, 0x0B])
        );
        assert!(matches!(
            handle_adu(&[0, 7, 0, 1, 0, 6, 1, 3, 0, 2, 0, 1], 1, &f),
            Adu::Close(_)
        ));
        assert!(matches!(
            handle_adu(&[0, 7, 0, 0, 0, 9, 1, 3, 0, 2, 0, 1], 1, &f),
            Adu::Close(_)
        ));
        assert!(matches!(
            handle_adu(&[0, 7, 0, 0, 0, 1, 1], 1, &f),
            Adu::Close(_)
        ));
    }

    #[test]
    fn fuzz_never_panics() {
        let f = fake();
        let mut x: u32 = 0x1234_5678;
        for _ in 0..20000 {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let n = (x % 20) as usize;
            let pdu: Vec<u8> = (0..n)
                .map(|i| {
                    let y = x.rotate_left(i as u32 * 3);
                    if i == 0 {
                        (y % 18) as u8
                    } else {
                        y as u8
                    }
                })
                .collect();
            let _ = handle_pdu(&pdu, &f);
        }
    }
}
