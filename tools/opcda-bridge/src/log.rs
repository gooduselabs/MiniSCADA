// Log tối giản: dòng `thời-điểm-UTC MỨC thông-điệp` ra stderr và (tùy chọn) file, xoay vòng một bản `.1` khi quá cỡ.
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct Sink {
    path: Option<String>,
    file: Option<File>,
    max: u64,
}

static SINK: Mutex<Sink> = Mutex::new(Sink {
    path: None,
    file: None,
    max: 5_000_000,
});
static DEBUG: AtomicBool = AtomicBool::new(false);

pub fn init(path: Option<&str>, debug: bool, max: u64) -> Result<(), String> {
    DEBUG.store(debug, Ordering::Relaxed);
    let mut s = SINK.lock().unwrap();
    s.max = max.max(10_000);
    if let Some(p) = path {
        if let Some(dir) = std::path::Path::new(p).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .map_err(|e| format!("E_LOG_OPEN: {p}: {e}"))?;
        s.file = Some(f);
        s.path = Some(p.to_string());
    }
    Ok(())
}

fn stamp() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let (days, rem) = (secs / 86400, secs % 86400);
    // Ngày dương lịch từ số ngày kể từ 1970 (Howard Hinnant, civil_from_days).
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + (month <= 2) as i64;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        d.subsec_millis()
    )
}

fn write(level: &str, msg: &str) {
    let line = format!("{} {level} {msg}\n", stamp());
    let _ = std::io::stderr().write_all(line.as_bytes());
    let mut s = SINK.lock().unwrap();
    let too_big = s
        .file
        .as_ref()
        .and_then(|f| f.metadata().ok())
        .map(|m| m.len() > s.max)
        .unwrap_or(false);
    if too_big {
        if let Some(p) = s.path.clone() {
            s.file = None;
            let _ = std::fs::rename(&p, format!("{p}.1"));
            s.file = OpenOptions::new().create(true).append(true).open(&p).ok();
        }
    }
    if let Some(f) = s.file.as_mut() {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn info(msg: &str) {
    write("INFO", msg)
}
pub fn warn(msg: &str) {
    write("WARN", msg)
}
pub fn error(msg: &str) {
    write("ERROR", msg)
}
pub fn debug(msg: &str) {
    if DEBUG.load(Ordering::Relaxed) {
        write("DEBUG", msg)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn stamp_format() {
        let s = super::stamp();
        assert_eq!(s.len(), 24, "{s}");
        assert!(s.starts_with("20") && s.ends_with('Z'));
    }
}
