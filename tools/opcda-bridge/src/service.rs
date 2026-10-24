// Chạy như Windows Service (spec 021 US6). `service install` tạo dịch vụ tự khởi động dưới NT AUTHORITY\LocalService
// (quyền tối thiểu); `service-run` là điểm vào do SCM gọi.
use crate::config::Config;
use crate::log;
use std::sync::mpsc;
use std::sync::Mutex;
use std::sync::OnceLock;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_SUCCESS, NO_ERROR};
use windows::Win32::System::Services::*;

pub const DEFAULT_NAME: &str = "matOpcDaBridge";

static CONFIG_PATH: OnceLock<String> = OnceLock::new();
static STOP: OnceLock<Mutex<Option<mpsc::Sender<()>>>> = OnceLock::new();
static HANDLE: OnceLock<usize> = OnceLock::new();

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn set_state(state: SERVICE_STATUS_CURRENT_STATE, exit: u32) {
    let Some(&h) = HANDLE.get() else { return };
    let st = SERVICE_STATUS {
        dwServiceType: SERVICE_WIN32_OWN_PROCESS,
        dwCurrentState: state,
        dwControlsAccepted: if state == SERVICE_RUNNING {
            SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
        } else {
            0
        },
        dwWin32ExitCode: exit,
        dwServiceSpecificExitCode: 0,
        dwCheckPoint: 0,
        dwWaitHint: if state == SERVICE_RUNNING || state == SERVICE_STOPPED {
            0
        } else {
            10_000
        },
    };
    unsafe {
        let _ = SetServiceStatus(SERVICE_STATUS_HANDLE(h as *mut _), &st);
    }
}

unsafe extern "system" fn handler(
    ctrl: u32,
    _t: u32,
    _d: *mut core::ffi::c_void,
    _c: *mut core::ffi::c_void,
) -> u32 {
    if ctrl == SERVICE_CONTROL_STOP || ctrl == SERVICE_CONTROL_SHUTDOWN {
        set_state(SERVICE_STOP_PENDING, 0);
        if let Some(m) = STOP.get() {
            if let Some(tx) = m.lock().unwrap().take() {
                let _ = tx.send(());
            }
        }
    }
    NO_ERROR.0
}

unsafe extern "system" fn service_main(_argc: u32, _argv: *mut PWSTR) {
    let name = wide(DEFAULT_NAME);
    let Ok(h) = RegisterServiceCtrlHandlerExW(PCWSTR(name.as_ptr()), Some(handler), None) else {
        return;
    };
    let _ = HANDLE.set(h.0 as usize);
    set_state(SERVICE_START_PENDING, 0);
    let path = CONFIG_PATH.get().cloned().unwrap_or_default();
    let cfg = match std::fs::read_to_string(&path)
        .map_err(|e| format!("E_CONFIG_READ: {path}: {e}"))
        .and_then(|t| Config::parse(&t))
    {
        Ok(c) => c,
        Err(e) => {
            log::error(&e);
            set_state(SERVICE_STOPPED, 1);
            return;
        }
    };
    let _ = log::init(cfg.log.file.as_deref(), cfg.log.debug, cfg.log.max_bytes);
    let running = match crate::start(&cfg, None) {
        Ok(r) => r,
        Err(e) => {
            log::error(&e);
            set_state(SERVICE_STOPPED, 1);
            return;
        }
    };
    let (tx, rx) = mpsc::channel();
    let _ = STOP.set(Mutex::new(Some(tx)));
    set_state(SERVICE_RUNNING, 0);
    let _ = rx.recv();
    log::info("BRIDGE_STOP: service stop requested");
    running.stop();
    set_state(SERVICE_STOPPED, 0);
}

/// Điểm vào khi SCM khởi động tiến trình.
pub fn run_dispatcher(config_path: &str) -> Result<(), String> {
    let _ = CONFIG_PATH.set(config_path.to_string());
    let mut name = wide(DEFAULT_NAME);
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: PWSTR(name.as_mut_ptr()),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW::default(),
    ];
    unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) }
        .map_err(|e| format!("StartServiceCtrlDispatcher: {e}"))
}

pub fn install(config_path: &str) -> Result<(), String> {
    let abs = std::fs::canonicalize(config_path).map_err(|e| format!("{config_path}: {e}"))?;
    let abs = abs
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let cmd = wide(&format!("\"{exe}\" service-run --config \"{abs}\""));
    let name = wide(DEFAULT_NAME);
    let display = wide("mAT OPC DA Bridge");
    let account = wide(r"NT AUTHORITY\LocalService");
    unsafe {
        let scm = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CREATE_SERVICE)
            .map_err(|e| format!("OpenSCManager (run as Administrator): {e}"))?;
        let svc = CreateServiceW(
            scm,
            PCWSTR(name.as_ptr()),
            PCWSTR(display.as_ptr()),
            SERVICE_ALL_ACCESS,
            SERVICE_WIN32_OWN_PROCESS,
            SERVICE_AUTO_START,
            SERVICE_ERROR_NORMAL,
            PCWSTR(cmd.as_ptr()),
            PCWSTR::null(),
            None,
            PCWSTR::null(),
            PCWSTR(account.as_ptr()),
            PCWSTR::null(),
        );
        let r = svc.map(|s| {
            let _ = CloseServiceHandle(s);
        });
        let _ = CloseServiceHandle(scm);
        r.map_err(|e| format!("CreateService: {e}"))
    }
}

pub fn uninstall() -> Result<(), String> {
    let name = wide(DEFAULT_NAME);
    unsafe {
        let scm = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT)
            .map_err(|e| format!("OpenSCManager (run as Administrator): {e}"))?;
        let svc = OpenServiceW(
            scm,
            PCWSTR(name.as_ptr()),
            SERVICE_STOP | SERVICE_QUERY_STATUS | 0x10000, /* DELETE */
        )
        .map_err(|e| format!("OpenService: {e}"))?;
        let mut st = SERVICE_STATUS::default();
        let _ = ControlService(svc, SERVICE_CONTROL_STOP, &mut st);
        let r = DeleteService(svc).map_err(|e| format!("DeleteService: {e}"));
        let _ = CloseServiceHandle(svc);
        let _ = CloseServiceHandle(scm);
        let _ = ERROR_SUCCESS;
        r
    }
}
