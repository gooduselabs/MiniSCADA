// mAT OPC DA Bridge (spec 021, ADR-049): OPC DA client qua COM cục bộ, phục vụ runtime mAT qua Modbus TCP.
pub mod allow;
#[cfg(windows)]
pub mod com;
pub mod config;
pub mod engine;
pub mod image;
pub mod log;
pub mod map;
pub mod modbus;
pub mod opc;
pub mod quality;
#[cfg(windows)]
pub mod service;

use config::{Backend, Config};
use engine::{Engine, Shared};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub struct Running {
    pub shared: Arc<Shared>,
    pub addr: SocketAddr,
    engine: Option<JoinHandle<()>>,
    server: Option<JoinHandle<()>>,
}

impl Running {
    pub fn stop(mut self) {
        self.shared.stop.store(true, Ordering::Relaxed);
        // Đánh thức vòng accept.
        let mut wake = self.addr;
        if wake.ip().is_unspecified() {
            wake.set_ip([127, 0, 0, 1].into());
        }
        let _ = TcpStream::connect_timeout(&wake, Duration::from_secs(1));
        if let Some(h) = self.engine.take() {
            let _ = h.join();
        }
        if let Some(h) = self.server.take() {
            let _ = h.join();
        }
    }

    pub fn wait(mut self) {
        if let Some(h) = self.engine.take() {
            let _ = h.join();
        }
    }
}

/// Khởi chạy engine OPC và server Modbus. `mock`: OPC giả (dùng cho test tích hợp).
pub fn start(cfg: &Config, mock: Option<opc::MockClient>) -> Result<Running, String> {
    let shared = Arc::new(Shared::new(cfg));
    let allow = allow::AllowList::parse(&cfg.modbus.allow)?;
    let bind = format!("{}:{}", cfg.modbus.bind, cfg.modbus.port);
    let listener = TcpListener::bind(&bind).map_err(|e| format!("E_BIND: {bind}: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    let backend = Arc::new(modbus::BridgeBackend {
        shared: shared.clone(),
        writes: Mutex::new(tx),
        write_timeout: Duration::from_millis(cfg.modbus.write_timeout_ms),
    });
    let opts = modbus::ServerOpts {
        unit: cfg.modbus.unit_id,
        max_connections: cfg.modbus.max_connections,
        idle: Duration::from_secs(cfg.modbus.idle_timeout_s),
    };
    let server = std::thread::spawn(move || modbus::serve(listener, allow, opts, backend));

    let opc = cfg.opc.clone();
    let sh = shared.clone();
    let engine = std::thread::spawn(move || {
        let mut client: Box<dyn opc::OpcClient> = match (opc.backend.clone(), mock) {
            (_, Some(m)) => Box::new(m),
            (Backend::Mock, None) => Box::new(opc::MockClient::demo()),
            (Backend::Com, None) => make_com(&opc),
        };
        Engine::new(
            client.as_mut(),
            &sh,
            opc.update_rate_ms,
            opc.reconnect_max_s,
        )
        .run(&rx);
    });
    log::info(&format!(
        "BRIDGE_START: modbus on {addr}, {} items",
        cfg.items.len()
    ));
    Ok(Running {
        shared,
        addr,
        engine: Some(engine),
        server: Some(server),
    })
}

#[cfg(windows)]
fn make_com(opc: &config::OpcConfig) -> Box<dyn opc::OpcClient> {
    if let Err(e) = com::com_init() {
        log::error(&format!("COM_INIT: {e}"));
    }
    Box::new(com::ComClient::new(
        &opc.prog_id,
        &opc.group_name,
        opc.update_rate_ms,
        opc.deadband_percent,
        opc.subscription,
    ))
}

#[cfg(not(windows))]
fn make_com(_opc: &config::OpcConfig) -> Box<dyn opc::OpcClient> {
    log::error("COM backend is only available on Windows; using mock");
    Box::new(opc::MockClient::demo())
}
