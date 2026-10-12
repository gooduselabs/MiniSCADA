// Câu tiếng Việt cho mã lỗi của lệnh Rust (feature 005, contracts/tauri-commands.md §1–7, §10; phiên chính
// đối chiếu 2026-10-11): mỗi mã có câu riêng (kèm dữ liệu của mã dạng đối tượng); mã lạ thì câu chung kèm mã.
import { describe, expect, it } from 'vitest';
import { deviceErrorText, duration } from './device-errors.ts';

const CODES = [
  'bad-address',
  'closed',
  'too-large',
  'not-tls',
  'bad-response',
  'no-such-device',
  'pin-mismatch',
  'not-observed',
  'setup-required',
  'cert-unpinned',
  'timeout',
  'unreachable',
  'busy',
  'auth-failed',
  'auth-busy',
  'audit-unavailable',
  'auth-required',
  'session-expired',
  'session-invalid',
  'forbidden',
  'bad-path',
  'too-many',
  'ipc',
];

describe('câu cho mã lỗi của Rust', () => {
  it('mỗi mã dạng chuỗi có câu tiếng Việt riêng (không phải câu chung)', () => {
    const generic = deviceErrorText({ error: 'ma-la' });
    const texts = CODES.map((code) => deviceErrorText({ error: code }));
    for (const [i, text] of texts.entries()) {
      expect(text, CODES[i]).not.toBe(generic);
      expect(text, CODES[i]).toMatch(/[ạàáảãăâđêôơư]/i);
    }
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('mã dạng đối tượng: kèm dữ liệu (thông báo TLS, mã HTTP, lỗi mạng của hệ điều hành, thời gian khóa)', () => {
    expect(deviceErrorText({ error: 'tls', detail: 'bad handshake' })).toBe(
      'bắt tay TLS với thiết bị không được (bad handshake)',
    );
    expect(deviceErrorText({ error: 'http', detail: 503 })).toBe('thiết bị trả lỗi HTTP 503');
    expect(
      deviceErrorText({ error: 'network', detail: 'connection refused (os error 10061)' }),
    ).toBe('lỗi mạng: connection refused (os error 10061)');
    expect(deviceErrorText({ error: 'locked', detail: 287 })).toBe(
      'tài khoản tạm khóa, thử lại sau 4 phút 47 giây',
    );
    expect(
      deviceErrorText({
        error: 'cert-mismatch',
        detail: { pinned: 'a'.repeat(64), seen: 'b'.repeat(64) },
      }),
    ).toBe('chứng chỉ của thiết bị khác chứng chỉ đã ghim, Studio đã chặn kết nối');
    // Thiếu dữ liệu kèm: vẫn có câu.
    expect(deviceErrorText({ error: 'tls' })).toBe('bắt tay TLS với thiết bị không được');
    expect(deviceErrorText({ error: 'http' })).toBe('thiết bị trả lỗi HTTP');
  });

  it('mã lạ: câu chung kèm mã', () => {
    expect(deviceErrorText({ error: 'ma-la' })).toBe(
      'lỗi không rõ của thiết bị hoặc Studio (ma-la)',
    );
    expect(deviceErrorText({ error: 'toString' })).toBe(
      'lỗi không rõ của thiết bị hoặc Studio (toString)',
    );
  });

  it('thời lượng: phút và giây', () => {
    expect(duration(300)).toBe('5 phút 0 giây');
    expect(duration(59)).toBe('59 giây');
  });
});
