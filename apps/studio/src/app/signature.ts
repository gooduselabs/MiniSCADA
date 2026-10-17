// Trạng thái chữ ký số Authenticode của chính Studio, hiện ở hộp "Giới thiệu" (feature 011, T101; FR-056).
// Đọc qua lệnh Tauri chỉ-đọc `app_signature` (src-tauri/src/signature.rs); Studio không tự cập nhật (D34).
import { t } from '../i18n/index.ts';
import type { AppSignature } from '../platform/types.ts';

/** Một dòng mô tả cho hộp "Giới thiệu"; `null` là đang đọc. */
export function signatureText(sig: AppSignature | null): string {
  if (!sig) return t('dlg.about.sigLoading');
  const who = () =>
    t('dlg.about.sigSigner', { signer: sig.signer ?? '?', thumbprint: sig.thumbprint ?? '?' });
  switch (sig.status) {
    case 'valid':
      return who();
    case 'notTrusted':
      return t('dlg.about.sigNotTrusted', { who: who() });
    case 'unsigned':
      return t('dlg.about.sigUnsigned');
    case 'unsupported':
      return t('dlg.about.sigUnsupported');
    case 'invalid':
      return t('dlg.about.sigInvalid', { detail: sig.detail ?? '?' });
    default:
      return t('dlg.about.sigError', { detail: sig.detail ?? '?' });
  }
}
