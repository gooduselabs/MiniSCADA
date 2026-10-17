// Trạng thái chữ ký số của Studio ở hộp "Giới thiệu" (feature 011, T101; FR-056).
import { describe, expect, it } from 'vitest';
import { setStrictKeys } from '../i18n/index.ts';
import type { AppSignature } from '../platform/types.ts';
import { signatureText } from './signature.ts';

setStrictKeys(true);

const base: AppSignature = {
  status: 'valid',
  signer: 'ATPro JSC',
  thumbprint: 'AB12CD34EF56AB12CD34EF56AB12CD34EF56AB12',
  notAfter: '2027-10-01T00:00:00Z',
  timestamped: true,
  detail: null,
};

describe('signatureText', () => {
  it('chưa đọc xong', () => {
    expect(signatureText(null)).toBe('đang kiểm…');
  });
  it('đã ký, tin cậy: người ký và dấu vân tay', () => {
    expect(signatureText(base)).toBe(
      'ATPro JSC, dấu vân tay AB12CD34EF56AB12CD34EF56AB12CD34EF56AB12',
    );
  });
  it('chứng chỉ thử: ký đúng nhưng chưa tin cậy', () => {
    expect(signatureText({ ...base, status: 'notTrusted', signer: 'mAT SCADA TEST' })).toBe(
      'mAT SCADA TEST, dấu vân tay AB12CD34EF56AB12CD34EF56AB12CD34EF56AB12 (chưa tin cậy: chứng chỉ thử)',
    );
  });
  it('bản dựng nội bộ chưa ký', () => {
    expect(signatureText({ ...base, status: 'unsigned', signer: null, thumbprint: null })).toBe(
      'chưa ký (bản dựng nội bộ)',
    );
  });
  it('ngoài Windows: nói thật là không kiểm được', () => {
    expect(
      signatureText({
        ...base,
        status: 'unsupported',
        signer: null,
        thumbprint: null,
        detail: null,
      }),
    ).toBe('chưa ký (chỉ kiểm được trên Windows)');
  });
  it('chữ ký hỏng hoặc lỗi đọc: kèm chi tiết', () => {
    expect(signatureText({ ...base, status: 'invalid', detail: 'HashMismatch' })).toBe(
      'chữ ký không hợp lệ (HashMismatch)',
    );
    expect(signatureText({ ...base, status: 'error', detail: 'không chạy được PowerShell' })).toBe(
      'không đọc được chữ ký (không chạy được PowerShell)',
    );
  });
});
