//! Chữ ký Authenticode của chính `mat-studio.exe` (feature 011, T101; FR-056).
//!
//! Lệnh chỉ đọc `app_signature`: trên Windows chạy cố định (đường dẫn tuyệt đối
//! `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, T062)
//! `powershell.exe -NoProfile -NonInteractive -Command <script cố định>`; đường dẫn tệp thực thi lấy từ
//! `std::env::current_exe()` và truyền qua biến môi trường `MAT_SELF_EXE` (không ghép vào chuỗi lệnh, không nhận gì
//! từ giao diện). Kết quả đọc một lần rồi giữ trong bộ nhớ (PowerShell khởi động mất khoảng 1 s).
//! Ngoài Windows trả `unsupported`: không có Authenticode để kiểm, nói thật là chưa ký.
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSignature {
    /// valid | notTrusted | unsigned | invalid | unsupported | error
    pub status: &'static str,
    pub signer: Option<String>,
    pub thumbprint: Option<String>,
    pub not_after: Option<String>,
    pub timestamped: Option<bool>,
    pub detail: Option<String>,
}

impl AppSignature {
    fn bare(status: &'static str, detail: Option<String>) -> Self {
        AppSignature {
            status,
            signer: None,
            thumbprint: None,
            not_after: None,
            timestamped: None,
            detail,
        }
    }
}

/// Đầu ra JSON của script PowerShell (một dòng, `ConvertTo-Json -Compress`).
#[derive(Deserialize)]
struct PsOutput {
    status: String,
    subject: Option<String>,
    thumbprint: Option<String>,
    #[serde(rename = "notAfter")]
    not_after: Option<String>,
    timestamped: Option<bool>,
    message: Option<String>,
}

/// Script cố định. `Status` đổi sang chuỗi (Windows PowerShell 5.1 xuất enum thành số).
#[cfg_attr(not(windows), allow(dead_code))]
const PS_SCRIPT: &str = "$ErrorActionPreference='Stop';\
$s=Get-AuthenticodeSignature -LiteralPath $env:MAT_SELF_EXE;\
$c=$s.SignerCertificate;\
[pscustomobject]@{status=$s.Status.ToString();\
subject=$(if($c){$c.Subject}else{$null});\
thumbprint=$(if($c){$c.Thumbprint}else{$null});\
notAfter=$(if($c){$c.NotAfter.ToUniversalTime().ToString('o')}else{$null});\
timestamped=($null -ne $s.TimeStamperCertificate);\
message=$s.StatusMessage}|ConvertTo-Json -Compress";

/// Tên hiển thị của người ký: giá trị CN trong chủ thể X.500 (không có CN thì cả chủ thể).
fn common_name(subject: &str) -> String {
    for part in subject.split(',') {
        let p = part.trim();
        if let Some(v) = p.strip_prefix("CN=") {
            return v.trim_matches('"').to_string();
        }
    }
    subject.to_string()
}

/// Đọc đầu ra của script. `Valid` → valid; `NotTrusted`, hoặc `UnknownError` do gốc chưa tin cậy (chứng chỉ thử
/// trên Windows PowerShell 5.1) → notTrusted; `NotSigned` → unsigned; còn lại (HashMismatch, NotSupportedFileFormat…)
/// → invalid.
pub fn parse_ps_output(stdout: &str) -> AppSignature {
    let line = stdout.trim().trim_start_matches('\u{feff}');
    let o: PsOutput = match serde_json::from_str(line) {
        Ok(o) => o,
        Err(e) => return AppSignature::bare("error", Some(format!("đầu ra PowerShell lạ: {e}"))),
    };
    let message = o.message.unwrap_or_default();
    let status: &'static str = match o.status.as_str() {
        "Valid" => "valid",
        "NotTrusted" => "notTrusted",
        "UnknownError" if message.to_lowercase().contains("root") => "notTrusted",
        "NotSigned" => "unsigned",
        _ => "invalid",
    };
    if status == "unsigned" {
        return AppSignature::bare("unsigned", None);
    }
    AppSignature {
        status,
        signer: o.subject.as_deref().map(common_name),
        thumbprint: o.thumbprint,
        not_after: o.not_after,
        timestamped: o.timestamped,
        detail: if status == "invalid" {
            Some(format!("{}: {}", o.status, message))
        } else {
            None
        },
    }
}

/// Đường dẫn tuyệt đối của Windows PowerShell 5.1 dưới `%SystemRoot%` (T062): không tìm `powershell.exe` theo PATH
/// hay thư mục hiện tại. `%SystemRoot%` không phải dạng `X:\...` thì dùng `C:\Windows`.
#[cfg_attr(not(windows), allow(dead_code))]
fn powershell_path(system_root: Option<std::ffi::OsString>) -> String {
    let root = system_root
        .and_then(|r| r.into_string().ok())
        .map(|r| r.trim_end_matches('\\').to_string())
        .filter(|r| {
            let b = r.as_bytes();
            b.len() >= 3
                && b[0].is_ascii_alphabetic()
                && b[1] == b':'
                && b[2] == b'\\'
                && !r.split('\\').any(|p| p == "..")
        })
        .unwrap_or_else(|| r"C:\Windows".to_string());
    format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe")
}

#[cfg(windows)]
fn read_signature() -> AppSignature {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return AppSignature::bare("error", Some(e.to_string())),
    };
    let out = std::process::Command::new(powershell_path(std::env::var_os("SystemRoot")))
        .args(["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT])
        .env("MAT_SELF_EXE", exe)
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o) if o.status.success() => parse_ps_output(&String::from_utf8_lossy(&o.stdout)),
        Ok(o) => AppSignature::bare(
            "error",
            Some(
                String::from_utf8_lossy(&o.stderr)
                    .trim()
                    .chars()
                    .take(300)
                    .collect(),
            ),
        ),
        Err(e) => AppSignature::bare("error", Some(e.to_string())),
    }
}

#[cfg(not(windows))]
fn read_signature() -> AppSignature {
    AppSignature::bare("unsupported", None)
}

static CACHE: OnceLock<AppSignature> = OnceLock::new();

/// Lệnh Tauri chỉ đọc: chữ ký của tệp thực thi đang chạy.
#[tauri::command]
pub async fn app_signature() -> AppSignature {
    if let Some(s) = CACHE.get() {
        return s.clone();
    }
    let s = tauri::async_runtime::spawn_blocking(read_signature)
        .await
        .unwrap_or_else(|e| AppSignature::bare("error", Some(e.to_string())));
    CACHE.get_or_init(|| s).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_signature_gives_signer_cn_and_thumbprint() {
        let s = parse_ps_output(
            r#"{"status":"Valid","subject":"CN=ATPro JSC, O=ATPro JSC, L=Ha Noi, C=VN","thumbprint":"AB12CD","notAfter":"2027-10-01T00:00:00.0000000Z","timestamped":true,"message":"Signature verified."}"#,
        );
        assert_eq!(s.status, "valid");
        assert_eq!(s.signer.as_deref(), Some("ATPro JSC"));
        assert_eq!(s.thumbprint.as_deref(), Some("AB12CD"));
        assert_eq!(s.timestamped, Some(true));
        assert_eq!(s.detail, None);
    }

    #[test]
    fn test_certificate_is_not_trusted_on_both_powershell_versions() {
        let a = parse_ps_output(
            r#"{"status":"NotTrusted","subject":"CN=mAT SCADA TEST - NOT FOR RELEASE","thumbprint":"FF","notAfter":null,"timestamped":false,"message":"A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider."}"#,
        );
        assert_eq!(a.status, "notTrusted");
        assert_eq!(
            a.signer.as_deref(),
            Some("mAT SCADA TEST - NOT FOR RELEASE")
        );
        let b = parse_ps_output(
            "\u{feff}{\"status\":\"UnknownError\",\"subject\":\"CN=x\",\"thumbprint\":\"FF\",\"notAfter\":null,\"timestamped\":false,\"message\":\"... terminated in a root certificate which is not trusted ...\"}\r\n",
        );
        assert_eq!(b.status, "notTrusted");
    }

    #[test]
    fn unsigned_dev_build() {
        let s = parse_ps_output(
            r#"{"status":"NotSigned","subject":null,"thumbprint":null,"notAfter":null,"timestamped":false,"message":"The file is not digitally signed."}"#,
        );
        assert_eq!(s, AppSignature::bare("unsigned", None));
    }

    #[test]
    fn tampered_file_is_invalid_with_detail() {
        let s = parse_ps_output(
            r#"{"status":"HashMismatch","subject":"CN=ATPro","thumbprint":"AA","notAfter":null,"timestamped":true,"message":"The contents of the file may have been tampered with."}"#,
        );
        assert_eq!(s.status, "invalid");
        assert!(s.detail.unwrap().starts_with("HashMismatch"));
    }

    #[test]
    fn garbage_output_is_error_not_panic() {
        assert_eq!(parse_ps_output("").status, "error");
        assert_eq!(
            parse_ps_output("Get-AuthenticodeSignature : lỗi").status,
            "error"
        );
    }

    #[test]
    fn subject_without_cn_is_shown_whole() {
        assert_eq!(common_name("O=ATPro, C=VN"), "O=ATPro, C=VN");
        assert_eq!(common_name("C=VN, CN=ATPro JSC"), "ATPro JSC");
    }

    #[test]
    fn script_is_fixed_and_reads_path_from_env_only() {
        assert!(PS_SCRIPT.contains("$env:MAT_SELF_EXE"));
        assert!(!PS_SCRIPT.contains("{0}") && !PS_SCRIPT.contains("%1"));
    }

    /// T062 (S5): powershell.exe gọi bằng đường dẫn tuyệt đối dưới %SystemRoot%, không tìm theo PATH
    /// hay thư mục hiện tại; %SystemRoot% lạ thì dùng `C:\Windows`.
    #[test]
    fn powershell_is_invoked_by_absolute_path() {
        let want = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        assert_eq!(powershell_path(Some(r"C:\Windows".into())), want);
        assert_eq!(powershell_path(Some(r"C:\Windows\".into())), want);
        assert_eq!(
            powershell_path(Some(r"D:\WINNT".into())),
            r"D:\WINNT\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        for odd in [
            None,
            Some(""),
            Some("Windows"),
            Some(r"\\srv\share"),
            Some(".."),
        ] {
            assert_eq!(powershell_path(odd.map(Into::into)), want, "{odd:?}");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_is_unsupported() {
        assert_eq!(read_signature().status, "unsupported");
    }
}
