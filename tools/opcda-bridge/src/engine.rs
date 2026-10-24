// Engine: giữ kết nối OPC (một luồng, vì COM gắn với luồng), cập nhật bảng thanh ghi, thực hiện lệnh ghi, tự kết nối lại
// với backoff (spec 021 US1, US3, US4).
use crate::config::{Access, Config, ItemConfig};
use crate::image::Image;
use crate::log;
use crate::map::Map;
use crate::opc::{ItemSpec, OpcClient, Value};
use crate::quality::{self, MatQuality};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct WriteReq {
    pub index: usize,
    pub value: Value,
    pub reply: Sender<Result<(), String>>,
}

pub struct Shared {
    pub image: Mutex<Image>,
    pub map: Map,
    pub items: Vec<ItemConfig>,
    pub stop: AtomicBool,
}

impl Shared {
    pub fn new(cfg: &Config) -> Shared {
        let map = Map::build(cfg);
        Shared {
            image: Mutex::new(Image::new(&map)),
            map,
            items: cfg.items.clone(),
            stop: AtomicBool::new(false),
        }
    }
}

pub struct Engine<'a> {
    client: &'a mut dyn OpcClient,
    shared: &'a Shared,
    update: Duration,
    reconnect_max: Duration,
    connected: bool,
    backoff: Duration,
    next_try: Instant,
    item_ok: Vec<bool>,
}

impl<'a> Engine<'a> {
    pub fn new(
        client: &'a mut dyn OpcClient,
        shared: &'a Shared,
        update_ms: u32,
        reconnect_max_s: u32,
    ) -> Self {
        Engine {
            client,
            shared,
            update: Duration::from_millis(update_ms as u64),
            reconnect_max: Duration::from_secs(reconnect_max_s as u64),
            connected: false,
            backoff: Duration::from_secs(1),
            next_try: Instant::now(),
            item_ok: vec![false; shared.items.len()],
        }
    }

    pub fn connected(&self) -> bool {
        self.connected
    }

    fn lost(&mut self, why: &str) {
        if self.connected {
            log::warn(&format!("OPC_DISCONNECTED: {why}"));
        }
        self.client.disconnect();
        self.connected = false;
        self.shared
            .image
            .lock()
            .unwrap()
            .set_connected(&self.shared.map, false);
        self.next_try = Instant::now() + self.backoff;
        self.backoff = (self.backoff * 2).min(self.reconnect_max);
    }

    fn try_connect(&mut self) {
        if Instant::now() < self.next_try {
            return;
        }
        let specs: Vec<ItemSpec> = self
            .shared
            .items
            .iter()
            .map(|i| ItemSpec {
                item: i.item.clone(),
                ty: i.ty,
            })
            .collect();
        let res = self
            .client
            .connect()
            .and_then(|_| self.client.add_items(&specs));
        match res {
            Ok(per_item) => {
                let mut img = self.shared.image.lock().unwrap();
                img.set_connected(&self.shared.map, true);
                for (i, r) in per_item.iter().enumerate() {
                    self.item_ok[i] = r.is_ok();
                    let q = if r.is_ok() {
                        MatQuality::NoData
                    } else {
                        MatQuality::Bad
                    };
                    img.set_quality(&self.shared.map, i, q);
                    if let Err(e) = r {
                        log::warn(&format!(
                            "OPC_ITEM_ADD: {} ({}): {e}",
                            self.shared.items[i].id, self.shared.items[i].item
                        ));
                    }
                }
                drop(img);
                let ok = per_item.iter().filter(|r| r.is_ok()).count();
                log::info(&format!(
                    "OPC_CONNECTED: {ok}/{} items added",
                    per_item.len()
                ));
                self.connected = true;
                self.backoff = Duration::from_secs(1);
            }
            Err(e) => {
                let first = self.backoff == Duration::from_secs(1);
                if first {
                    log::warn(&format!("OPC_CONNECT: {e}"));
                }
                self.client.disconnect();
                self.shared
                    .image
                    .lock()
                    .unwrap()
                    .set_connected(&self.shared.map, false);
                self.next_try = Instant::now() + self.backoff;
                self.backoff = (self.backoff * 2).min(self.reconnect_max);
            }
        }
    }

    fn do_write(&mut self, w: WriteReq) {
        let it = &self.shared.items[w.index];
        let r = if it.access != Access::RW {
            Err("E_READ_ONLY".to_string())
        } else if !self.connected {
            Err("E_OPC_DISCONNECTED".to_string())
        } else if !self.item_ok[w.index] {
            Err("E_ITEM_UNAVAILABLE".to_string())
        } else {
            self.client.write(w.index, w.value)
        };
        match &r {
            Ok(()) => {
                log::debug(&format!("OPC_WRITE: {} = {:?}", it.id, w.value));
                let ty = it.ty;
                self.shared
                    .image
                    .lock()
                    .unwrap()
                    .store(&self.shared.map, w.index, ty, w.value);
            }
            Err(e) => log::warn(&format!("OPC_WRITE_FAILED: {}: {e}", it.id)),
        }
        let _ = w.reply.send(r);
    }

    /// Một vòng: kết nối nếu cần, nhận cập nhật (chờ tối đa một chu kỳ update), làm các lệnh ghi đang chờ.
    pub fn tick(&mut self, writes: &Receiver<WriteReq>) {
        if !self.connected {
            self.try_connect();
        }
        if self.connected {
            match self
                .client
                .poll(self.update.min(Duration::from_millis(100)))
            {
                Ok(ups) => {
                    let mut img = self.shared.image.lock().unwrap();
                    for u in ups {
                        let Some(it) = self.shared.items.get(u.index) else {
                            continue;
                        };
                        let mut q = quality::from_opc(u.quality);
                        match u.value {
                            Some(v) if q != MatQuality::Bad => {
                                img.store(&self.shared.map, u.index, it.ty, v)
                            }
                            Some(_) => {}
                            None => q = MatQuality::Bad,
                        }
                        img.set_quality(&self.shared.map, u.index, q);
                        img.timestamps[u.index] = u.timestamp;
                        if q != MatQuality::Good {
                            log::debug(&format!(
                                "OPC_QUALITY: {} {}",
                                it.id,
                                quality::describe(u.quality)
                            ));
                        }
                    }
                }
                Err(e) => self.lost(&e),
            }
        } else {
            std::thread::sleep(Duration::from_millis(20));
        }
        while let Ok(w) = writes.try_recv() {
            self.do_write(w);
        }
    }

    pub fn run(&mut self, writes: &Receiver<WriteReq>) {
        while !self.shared.stop.load(Ordering::Relaxed) {
            self.tick(writes);
        }
        self.client.disconnect();
    }

    #[cfg(test)]
    pub fn retry_now(&mut self) {
        self.next_try = Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opc::{MockClient, MockState};
    use std::sync::{mpsc, Arc};

    fn cfg() -> Config {
        Config::parse(
            &serde_json::json!({
                "opc": { "backend": "mock", "updateRateMs": 10 },
                "modbus": {},
                "items": [
                    { "id": "T.LEVEL", "item": "Dev.Level", "type": "FLOAT32" },
                    { "id": "T.RUN", "item": "Dev.Run", "type": "BOOL", "access": "RW" },
                    { "id": "T.SP", "item": "Dev.Sp", "type": "INT16", "access": "RW" },
                    { "id": "T.GONE", "item": "missing.Item", "type": "INT16", "access": "RW" }
                ]
            })
            .to_string(),
        )
        .unwrap()
    }

    fn setup() -> (Arc<Mutex<MockState>>, MockClient, Shared) {
        let st = Arc::new(Mutex::new(MockState {
            up: true,
            ..Default::default()
        }));
        {
            let mut s = st.lock().unwrap();
            s.set("Dev.Level", Value::Num(42.5), 0xC0);
            s.set("Dev.Run", Value::Bool(true), 0x40);
            s.set("Dev.Sp", Value::Num(7.0), 0x18);
        }
        let c = MockClient::new(st.clone());
        (st, c, Shared::new(&cfg()))
    }

    #[test]
    fn group_items_values_quality() {
        let (_st, mut c, sh) = setup();
        let (_tx, rx) = mpsc::channel();
        let mut e = Engine::new(&mut c, &sh, 10, 5);
        e.tick(&rx);
        assert!(e.connected());
        let img = sh.image.lock().unwrap();
        assert_eq!(
            &img.holding[0..2],
            &[0x422A, 0x0000],
            "42.5 as FLOAT32 ABCD"
        );
        assert!(img.coils[0]);
        assert_eq!(img.holding[2], 0, "bad quality keeps old value");
        assert_eq!(
            &img.input,
            &[0, 1, 2, 2, 1],
            "good, uncertain, bad, missing item bad, status 1"
        );
    }

    #[test]
    fn write_paths() {
        let (st, mut c, sh) = setup();
        let (tx, rx) = mpsc::channel();
        let mut e = Engine::new(&mut c, &sh, 10, 5);
        e.tick(&rx);
        let send = |i, v| {
            let (rt, rr) = mpsc::channel();
            tx.send(WriteReq {
                index: i,
                value: v,
                reply: rt,
            })
            .unwrap();
            rr
        };
        let ok = send(2, Value::Num(12.0));
        let ro = send(0, Value::Num(1.0));
        let gone = send(3, Value::Num(1.0));
        st.lock().unwrap().fail_write.push("Dev.Run".into());
        let fail = send(1, Value::Bool(false));
        e.tick(&rx);
        assert_eq!(ok.recv().unwrap(), Ok(()));
        assert_eq!(ro.recv().unwrap(), Err("E_READ_ONLY".into()));
        assert_eq!(gone.recv().unwrap(), Err("E_ITEM_UNAVAILABLE".into()));
        assert!(fail.recv().unwrap().is_err());
        assert_eq!(
            st.lock().unwrap().writes,
            vec![("Dev.Sp".to_string(), Value::Num(12.0))]
        );
        assert_eq!(sh.image.lock().unwrap().holding[2], 12);
    }

    #[test]
    fn data_change_updates() {
        let (st, mut c, sh) = setup();
        let (_tx, rx) = mpsc::channel();
        let mut e = Engine::new(&mut c, &sh, 10, 5);
        e.tick(&rx);
        st.lock().unwrap().set("Dev.Sp", Value::Num(-3.0), 0xC0);
        e.tick(&rx);
        let img = sh.image.lock().unwrap();
        assert_eq!(img.holding[2], 0xFFFD);
        assert_eq!(img.input[2], 0);
    }

    #[test]
    fn reconnects_after_server_restart() {
        let (st, mut c, sh) = setup();
        let (tx, rx) = mpsc::channel();
        let mut e = Engine::new(&mut c, &sh, 10, 5);
        e.tick(&rx);
        st.lock().unwrap().up = false;
        e.tick(&rx);
        assert!(!e.connected());
        {
            let img = sh.image.lock().unwrap();
            assert_eq!(&img.input, &[2, 2, 2, 2, 0], "all bad, status 0");
        }
        let (rt, rr) = mpsc::channel();
        tx.send(WriteReq {
            index: 2,
            value: Value::Num(1.0),
            reply: rt,
        })
        .unwrap();
        e.tick(&rx);
        assert_eq!(rr.recv().unwrap(), Err("E_OPC_DISCONNECTED".into()));
        st.lock().unwrap().up = true;
        e.retry_now();
        e.tick(&rx);
        assert!(e.connected());
        assert_eq!(st.lock().unwrap().connects, 2);
        assert_eq!(sh.image.lock().unwrap().input[4], 1);
        assert_eq!(
            sh.image.lock().unwrap().input[0],
            0,
            "values re-read after reconnect"
        );
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let (st, mut c, sh) = setup();
        st.lock().unwrap().up = false;
        let (_tx, rx) = mpsc::channel();
        let mut e = Engine::new(&mut c, &sh, 10, 3);
        for _ in 0..4 {
            e.retry_now();
            e.tick(&rx);
        }
        assert_eq!(e.backoff, Duration::from_secs(3));
        e.tick(&rx);
        assert_eq!(st.lock().unwrap().connects, 0);
    }
}
