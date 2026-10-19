//! TLS tới thiết bị với ghim fingerprint (research R6, data-model §2–3, ADR-010).
//!
//! - `PinnedVerifier` (API `dangerous()` của rustls): so SHA-256 của DER chứng chỉ lá với ghim; không
//!   xét tên máy, hạn hay chuỗi CA (chứng chỉ tự ký, IP đổi, đồng hồ thiết bị không tin được). VẪN
//!   kiểm chữ ký bắt tay TLS 1.2/1.3 bằng thuật toán của provider: thiếu bước này, kẻ giả mạo chỉ
//!   cần chép chứng chỉ công khai của thiết bị.
//! - Chế độ dò (`device_probe`): verifier chỉ ghi lại fingerprint; bắt tay xong thì đóng ngay, không
//!   gửi byte ứng dụng nào.
//! - Provider `ring`, bộ mã ChaCha20-Poly1305 xếp đầu (ADR-010: Cortex-A7 của BL335 không có lệnh
//!   AES). Từ 2026-10-19 runtime tự chọn ChaCha20 cả với TLS 1.3 (mAT patch 1 của Mbed TLS); thứ
//!   tự ở đây vẫn giữ để máy chủ nào theo thứ tự của client cũng chọn ChaCha20.
//! - Không nối lại phiên TLS: mỗi kết nối đều kiểm ghim và chữ ký bắt tay.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, InvalidMessage, SignatureScheme,
};
use std::io;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;

/// Hạn kết nối TCP và hạn bắt tay TLS (contracts/tauri-commands.md §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TlsTimeouts {
    pub connect: Duration,
    pub handshake: Duration,
}

impl Default for TlsTimeouts {
    fn default() -> Self {
        TlsTimeouts {
            connect: Duration::from_secs(3),
            handshake: Duration::from_secs(5),
        }
    }
}

/// SHA-256 của DER chứng chỉ, 64 hex chữ thường.
pub fn fingerprint(der: &[u8]) -> String {
    crate::project_fs::sha256_hex(der)
}

/// Provider dùng chung cho reqwest và tokio-rustls: `ring`, ChaCha20-Poly1305 xếp đầu (ADR-010).
/// Thứ tự trong từng phiên bản: ChaCha20, AES-256-GCM, AES-128-GCM; TLS 1.2 chỉ ECDHE-ECDSA (thiết
/// bị dùng khóa ECDSA P-256). Hai bộ ChaCha20 đứng đầu danh sách chung; rustls gửi bộ mã theo đúng
/// thứ tự này, máy chủ chỉ xét các bộ của phiên bản đã chọn. Nhóm trao đổi khóa giữ mặc định.
pub fn provider() -> Arc<CryptoProvider> {
    static PROVIDER: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    PROVIDER
        .get_or_init(|| {
            use rustls::crypto::ring::{cipher_suite as cs, default_provider};
            Arc::new(CryptoProvider {
                cipher_suites: vec![
                    cs::TLS13_CHACHA20_POLY1305_SHA256,
                    cs::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
                    cs::TLS13_AES_256_GCM_SHA384,
                    cs::TLS13_AES_128_GCM_SHA256,
                    cs::TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
                    cs::TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
                ],
                ..default_provider()
            })
        })
        .clone()
}

/// Khóa chỉ bảo vệ dữ liệu trong bộ nhớ: bỏ qua trạng thái "poisoned".
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Verifier theo ghim (hoặc chế độ dò khi không có ghim).
#[derive(Debug)]
pub struct PinnedVerifier {
    pin: Option<String>,
    provider: Arc<CryptoProvider>,
    /// Fingerprint của chứng chỉ thấy ở lần bắt tay gần nhất.
    seen: Mutex<Option<String>>,
    /// Fingerprint khác ghim thấy gần nhất (để báo `cert-mismatch` kèm fingerprint mới).
    mismatch: Mutex<Option<String>>,
}

impl PinnedVerifier {
    fn with_pin(pin: Option<String>) -> Self {
        PinnedVerifier {
            pin,
            provider: provider(),
            seen: Mutex::new(None),
            mismatch: Mutex::new(None),
        }
    }

    /// Chế độ dò: nhận mọi chứng chỉ, ghi lại fingerprint (vẫn kiểm chữ ký bắt tay).
    pub fn probe() -> Self {
        Self::with_pin(None)
    }

    /// Chỉ nhận chứng chỉ có fingerprint bằng `pin`.
    pub fn pinned(pin: &str) -> Self {
        Self::with_pin(Some(pin.to_string()))
    }

    pub fn pin(&self) -> Option<&str> {
        self.pin.as_deref()
    }

    /// Fingerprint của chứng chỉ thấy ở lần bắt tay gần nhất.
    pub fn seen(&self) -> Option<String> {
        lock(&self.seen).clone()
    }

    /// Fingerprint khác ghim thấy gần nhất.
    pub fn last_mismatch(&self) -> Option<String> {
        lock(&self.mismatch).clone()
    }
}

impl ServerCertVerifier for PinnedVerifier {
    /// So SHA-256 của chứng chỉ lá với ghim. Không xét chứng chỉ trung gian, tên máy, hạn, OCSP.
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let seen = fingerprint(end_entity.as_ref());
        *lock(&self.seen) = Some(seen.clone());
        match &self.pin {
            Some(pin) if *pin != seen => {
                *lock(&self.mismatch) = Some(seen);
                Err(rustls::Error::InvalidCertificate(
                    CertificateError::ApplicationVerificationFailure,
                ))
            }
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    /// Chữ ký bắt tay TLS 1.2 (ServerKeyExchange) bằng khóa công khai của chứng chỉ vừa nhận.
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    /// Chữ ký bắt tay TLS 1.3 (CertificateVerify).
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Cấu hình client rustls với verifier đã cho; không nối lại phiên (mỗi kết nối đều kiểm ghim và
/// chữ ký bắt tay).
pub fn client_config(verifier: Arc<PinnedVerifier>) -> ClientConfig {
    let mut config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .expect("provider ring có bộ mã cho TLS 1.2 và 1.3")
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.resumption = rustls::client::Resumption::disabled();
    config
}

/// Lý do không bắt tay được.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsFailure {
    /// Không kết nối TCP được (từ chối, không có đường, tên máy không phân giải được).
    Unreachable,
    /// Quá hạn kết nối (3 s) hoặc bắt tay (5 s).
    Timeout,
    /// Cổng trả lời HTTP thường: runtime cũ hoặc sai cổng.
    NotTls,
    /// Chứng chỉ khác ghim.
    CertMismatch { pinned: String, seen: String },
    /// Lỗi TLS khác (chữ ký bắt tay sai, không có bộ mã chung…).
    Tls(String),
}

/// Phân loại lỗi rustls của một lần bắt tay với `verifier`.
pub(crate) fn classify_rustls(err: &rustls::Error, verifier: &PinnedVerifier) -> TlsFailure {
    match err {
        rustls::Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure) => {
            match (verifier.pin(), verifier.last_mismatch()) {
                (Some(pin), Some(seen)) => TlsFailure::CertMismatch {
                    pinned: pin.to_string(),
                    seen,
                },
                _ => TlsFailure::Tls(err.to_string()),
            }
        }
        // Byte đầu tiên máy chủ gửi không phải bản ghi TLS (ví dụ `HTTP/1.1 400`).
        rustls::Error::InvalidMessage(
            InvalidMessage::InvalidContentType
            | InvalidMessage::UnknownProtocolVersion
            | InvalidMessage::MessageTooLarge,
        ) => TlsFailure::NotTls,
        _ => TlsFailure::Tls(err.to_string()),
    }
}

/// Phân loại lỗi I/O của bắt tay (tokio-rustls bọc lỗi rustls trong `io::Error`).
pub(crate) fn classify_io(err: &io::Error, verifier: &PinnedVerifier) -> TlsFailure {
    match err
        .get_ref()
        .and_then(|e| e.downcast_ref::<rustls::Error>())
    {
        Some(tls) => classify_rustls(tls, verifier),
        None => TlsFailure::Tls(err.to_string()),
    }
}

/// Kết nối TCP trong hạn `timeout`. Thử địa chỉ IPv4 trước (thiết bị chỉ nghe IPv4; trên Windows
/// một địa chỉ bị từ chối mất khoảng 2 s mới báo lỗi).
pub(crate) async fn connect_tcp(
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<TcpStream, TlsFailure> {
    let attempt = async {
        let mut addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| TlsFailure::Unreachable)?
            .collect();
        addrs.sort_by_key(|a| !a.is_ipv4());
        for addr in addrs {
            if let Ok(tcp) = TcpStream::connect(addr).await {
                return Ok(tcp);
            }
        }
        Err(TlsFailure::Unreachable)
    };
    tokio::time::timeout(timeout, attempt)
        .await
        .unwrap_or(Err(TlsFailure::Timeout))
}

/// Kết nối và bắt tay với `verifier`.
async fn handshake(
    host: &str,
    port: u16,
    verifier: Arc<PinnedVerifier>,
    timeouts: TlsTimeouts,
) -> Result<TlsStream<TcpStream>, TlsFailure> {
    let name = ServerName::try_from(host)
        .map(|n| n.to_owned())
        .map_err(|_| TlsFailure::Tls(format!("tên máy không hợp lệ: {host}")))?;
    let tcp = connect_tcp(host, port, timeouts.connect).await?;
    let _ = tcp.set_nodelay(true);
    let connector = TlsConnector::from(Arc::new(client_config(verifier.clone())));
    match tokio::time::timeout(timeouts.handshake, connector.connect(name, tcp)).await {
        Err(_) => Err(TlsFailure::Timeout),
        Ok(Err(e)) => Err(classify_io(&e, &verifier)),
        Ok(Ok(stream)) => Ok(stream),
    }
}

/// Dò chứng chỉ: bắt tay (kiểm cả chữ ký), lấy fingerprint, đóng ngay; không gửi byte ứng dụng.
pub async fn probe(host: &str, port: u16, timeouts: TlsTimeouts) -> Result<String, TlsFailure> {
    let verifier = Arc::new(PinnedVerifier::probe());
    let mut stream = handshake(host, port, verifier.clone(), timeouts).await?;
    // close_notify rồi đóng TCP; thiết bị không nhận request nào.
    let _ = tokio::time::timeout(Duration::from_secs(1), stream.shutdown()).await;
    verifier
        .seen()
        .ok_or_else(|| TlsFailure::Tls("không nhận được chứng chỉ".into()))
}

/// Kết nối TLS có ghim (WebSocket `wss`).
pub async fn connect_pinned(
    host: &str,
    port: u16,
    pin: &str,
    timeouts: TlsTimeouts,
) -> Result<TlsStream<TcpStream>, TlsFailure> {
    handshake(host, port, Arc::new(PinnedVerifier::pinned(pin)), timeouts).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::test_support::{
        TLS_ALL, TLS12, TLS13, TestCert, closed_port, plain_http_port, silent_server, tls_observer,
    };
    use rustls::CipherSuite;
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const LOCAL: &str = "127.0.0.1";

    fn quick() -> TlsTimeouts {
        TlsTimeouts {
            connect: Duration::from_secs(3),
            handshake: Duration::from_millis(400),
        }
    }

    /// T066: hạn mặc định: kết nối 3 s, bắt tay 5 s.
    #[test]
    fn default_timeouts() {
        assert_eq!(
            TlsTimeouts::default(),
            TlsTimeouts {
                connect: Duration::from_secs(3),
                handshake: Duration::from_secs(5)
            }
        );
    }

    /// T066 (ADR-010, quyết định 2026-10-11): provider `ring`, bộ mã bắt đầu bằng hai bộ
    /// ChaCha20-Poly1305 (một của TLS 1.3, một của TLS 1.2); trong mỗi phiên bản thứ tự là ChaCha20,
    /// AES-256-GCM, AES-128-GCM; chỉ ECDHE-ECDSA cho TLS 1.2; nhóm trao đổi khóa giữ mặc định.
    #[test]
    fn provider_prefers_chacha20() {
        let p = provider();
        let suites: Vec<CipherSuite> = p.cipher_suites.iter().map(|s| s.suite()).collect();
        assert_eq!(
            &suites[..2],
            &[
                CipherSuite::TLS13_CHACHA20_POLY1305_SHA256,
                CipherSuite::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256
            ]
        );
        let tls13: Vec<CipherSuite> = p
            .cipher_suites
            .iter()
            .filter(|s| s.version() == &rustls::version::TLS13)
            .map(|s| s.suite())
            .collect();
        assert_eq!(
            tls13,
            [
                CipherSuite::TLS13_CHACHA20_POLY1305_SHA256,
                CipherSuite::TLS13_AES_256_GCM_SHA384,
                CipherSuite::TLS13_AES_128_GCM_SHA256
            ]
        );
        let tls12: Vec<CipherSuite> = p
            .cipher_suites
            .iter()
            .filter(|s| s.version() == &rustls::version::TLS12)
            .map(|s| s.suite())
            .collect();
        assert_eq!(
            tls12,
            [
                CipherSuite::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
                CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
                CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
            ]
        );
        let default_groups: Vec<_> = rustls::crypto::ring::default_provider()
            .kx_groups
            .iter()
            .map(|g| g.name())
            .collect();
        let groups: Vec<_> = p.kx_groups.iter().map(|g| g.name()).collect();
        assert_eq!(groups, default_groups);
        assert!(Arc::ptr_eq(&p, &provider()), "một provider dùng chung");
    }

    /// T066: ghim khớp → bắt tay đạt với TLS 1.3 và TLS 1.2; luồng dùng được; bộ mã thương lượng là
    /// ChaCha20 (máy chủ rustls theo thứ tự của client).
    #[tokio::test]
    async fn pinned_match_connects_with_tls13_and_tls12() {
        let cert = TestCert::new();
        for (versions, suite) in [
            (TLS13, CipherSuite::TLS13_CHACHA20_POLY1305_SHA256),
            (
                TLS12,
                CipherSuite::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
            ),
        ] {
            let srv = tls_observer(cert.server_config(versions)).await;
            let mut s = connect_pinned(LOCAL, srv.port, &cert.fingerprint, quick())
                .await
                .unwrap_or_else(|e| panic!("{suite:?}: {e:?}"));
            assert_eq!(
                s.get_ref().1.negotiated_cipher_suite().map(|c| c.suite()),
                Some(suite)
            );
            s.write_all(b"ping").await.unwrap();
            let mut buf = [0u8; 4];
            s.read_exact(&mut buf).await.unwrap();
            assert_eq!(&buf, b"ping");
            assert_eq!(srv.handshakes(), 1);
        }
    }

    /// T066: chứng chỉ khác ghim → `cert-mismatch` kèm fingerprint thấy được.
    #[tokio::test]
    async fn other_certificate_is_a_mismatch() {
        let pinned = TestCert::new();
        let other = TestCert::new();
        let srv = tls_observer(other.server_config(TLS_ALL)).await;
        let err = connect_pinned(LOCAL, srv.port, &pinned.fingerprint, quick())
            .await
            .unwrap_err();
        assert_eq!(
            err,
            TlsFailure::CertMismatch {
                pinned: pinned.fingerprint.clone(),
                seen: other.fingerprint.clone()
            }
        );
        assert_eq!(srv.handshakes(), 0);
    }

    /// T066: cùng chứng chỉ (fingerprint khớp ghim) nhưng khóa ký bắt tay khác → thất bại với cả TLS
    /// 1.2 và 1.3, ở cả chế độ ghim lẫn chế độ dò: verifier vẫn kiểm chữ ký bắt tay.
    #[tokio::test]
    async fn same_certificate_with_another_signing_key_fails() {
        let cert = TestCert::new();
        for versions in [TLS13, TLS12] {
            let srv = tls_observer(cert.server_config_wrong_key(versions)).await;
            let pinned = connect_pinned(LOCAL, srv.port, &cert.fingerprint, quick()).await;
            assert!(
                matches!(pinned, Err(TlsFailure::Tls(_))),
                "{versions:?}: {:?}",
                pinned.map(|_| ())
            );
            let probed = probe(LOCAL, srv.port, quick()).await;
            assert!(
                matches!(probed, Err(TlsFailure::Tls(_))),
                "{versions:?}: {probed:?}"
            );
            assert_eq!(srv.handshakes(), 0);
        }
    }

    /// T066: không xét tên máy, hạn, chuỗi CA: chứng chỉ sai SAN và đã hết hạn vẫn đạt khi khớp
    /// ghim, kể cả khi kết nối bằng tên máy (có SNI).
    #[tokio::test]
    async fn name_expiry_and_ca_are_not_checked() {
        let cert = TestCert::with_params(|p| {
            p.subject_alt_names = vec![rcgen::SanType::DnsName(
                "khac-hoan-toan.example".try_into().unwrap(),
            )];
            p.not_before = rcgen::date_time_ymd(2001, 1, 1);
            p.not_after = rcgen::date_time_ymd(2002, 1, 1);
        });
        let srv = tls_observer(cert.server_config(TLS_ALL)).await;
        for host in [LOCAL, "localhost"] {
            let r = connect_pinned(host, srv.port, &cert.fingerprint, quick()).await;
            assert!(r.is_ok(), "{host}: {:?}", r.map(|_| ()));
        }
        assert_eq!(
            probe(LOCAL, srv.port, quick()).await,
            Ok(cert.fingerprint.clone())
        );
    }

    /// T066: chế độ dò ghi lại fingerprint, không gửi byte ứng dụng nào, đóng ngay.
    #[tokio::test]
    async fn probe_records_the_fingerprint_and_sends_nothing() {
        let cert = TestCert::new();
        for versions in [TLS13, TLS12] {
            let srv = tls_observer(cert.server_config(versions)).await;
            let fp = probe(LOCAL, srv.port, quick()).await.unwrap();
            assert_eq!(fp, cert.fingerprint);
            assert_eq!(fp.len(), 64);
            assert_eq!(srv.closed_connections(1).await, vec![0], "{versions:?}");
            assert_eq!(srv.handshakes(), 1);
        }
    }

    /// T066: cổng HTTP thường → `not-tls`; cổng đóng → `unreachable`.
    #[tokio::test]
    async fn plain_http_and_closed_ports() {
        let http = plain_http_port().await;
        assert_eq!(
            probe(LOCAL, http.port, quick()).await,
            Err(TlsFailure::NotTls)
        );
        let fp = "0".repeat(64);
        let pinned = connect_pinned(LOCAL, http.port, &fp, quick()).await;
        assert!(matches!(pinned, Err(TlsFailure::NotTls)));
        let port = closed_port().await;
        assert_eq!(
            probe(LOCAL, port, TlsTimeouts::default()).await,
            Err(TlsFailure::Unreachable)
        );
    }

    /// T066: máy chủ nhận TCP rồi im lặng → `timeout` sau hạn bắt tay (thu ngắn trong test).
    #[tokio::test]
    async fn silent_server_times_out() {
        let srv = silent_server().await;
        let started = Instant::now();
        assert_eq!(
            probe(LOCAL, srv.port, quick()).await,
            Err(TlsFailure::Timeout)
        );
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(350) && elapsed < Duration::from_secs(2),
            "{elapsed:?}"
        );
        let fp = "0".repeat(64);
        let pinned = connect_pinned(LOCAL, srv.port, &fp, quick()).await;
        assert!(matches!(pinned, Err(TlsFailure::Timeout)));
    }

    /// T067: verifier ghi lại fingerprint thấy được và lần không khớp gần nhất; danh sách thuật toán
    /// chữ ký lấy từ provider.
    #[test]
    fn verifier_records_what_it_saw() {
        let a = TestCert::new();
        let b = TestCert::new();
        let name = ServerName::try_from("127.0.0.1").unwrap();
        let v = PinnedVerifier::pinned(&a.fingerprint);
        assert_eq!(v.pin(), Some(a.fingerprint.as_str()));
        assert!(
            v.verify_server_cert(&a.der, &[], &name, &[], UnixTime::now())
                .is_ok()
        );
        assert_eq!(v.seen(), Some(a.fingerprint.clone()));
        assert_eq!(v.last_mismatch(), None);
        assert!(
            v.verify_server_cert(&b.der, &[], &name, &[], UnixTime::now())
                .is_err()
        );
        assert_eq!(v.last_mismatch(), Some(b.fingerprint.clone()));
        let p = PinnedVerifier::probe();
        assert_eq!(p.pin(), None);
        assert!(
            p.verify_server_cert(&b.der, &[], &name, &[], UnixTime::now())
                .is_ok()
        );
        assert_eq!(p.seen(), Some(b.fingerprint.clone()));
        assert!(
            p.supported_verify_schemes()
                .contains(&SignatureScheme::ECDSA_NISTP256_SHA256)
        );
        assert_eq!(
            fingerprint(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
