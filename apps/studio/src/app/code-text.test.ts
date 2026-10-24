// Câu tiếng Việt cho mọi mã của feature 006 (T075; tasks "Nền Studio"): mã lý do của Tag (data-model §6, mã lạ
// thì "không rõ" kèm mã), exception Modbus 01–0B (modbus-driver §4), mã lỗi và cảnh báo 0.2 (project-format-0.2
// §7), lỗi biểu thức (expression-language §6), mã kết quả ghi (data-model §8, §9) và mã Thử kết nối
// (modbus-driver §10).
import { describe, expect, it } from 'vitest';
import {
  exceptionText,
  issueText,
  probeCodeText,
  reasonText,
  writeCodeText,
  writeStatusText,
} from './code-text.ts';

const REASONS = [
  'NO_VALUE',
  'DISABLED',
  'DISCONNECTED',
  'TIMEOUT',
  'REFUSED',
  'PORT_BUSY',
  'PORT_NOT_ALLOWED',
  'DEVICE_SUSPENDED',
  'EXCEPTION_01',
  'EXCEPTION_02',
  'EXCEPTION_03',
  'EXCEPTION_04',
  'EXCEPTION_05',
  'EXCEPTION_06',
  'EXCEPTION_07',
  'EXCEPTION_08',
  'EXCEPTION_09',
  'EXCEPTION_0A',
  'EXCEPTION_0B',
  'EXCEPTION_OTHER',
  'BAD_FRAME',
  'INVALID_VALUE',
  'CLAMPED',
  'INPUT_BAD',
  'DIV_ZERO',
  'MOD_ZERO',
  'OVERFLOW',
  'NOT_A_NUMBER',
  'OUT_OF_RANGE',
  'CLAMP_RANGE',
  'RETAIN_LOST',
  'NO_SIGNAL',
];

const EXCEPTIONS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B'];

const ISSUES = [
  'E_MIN_RUNTIME',
  'E_LIMIT',
  'E_DUP_ID',
  'E_REF_DEVICE',
  'E_REF_TABLE',
  'E_ADDR_SYNTAX',
  'E_ADDR_AREA',
  'E_ADDR_RANGE',
  'E_ADDR_READ_LIMIT',
  'E_ADDR_WRITE_LIMIT',
  'E_BIT_WRITE',
  'E_SCALING',
  'E_DEADBAND',
  'E_LIMITS',
  'E_TAG_ACCESS',
  'E_SIM',
  'E_INITIAL',
  'E_RETAIN',
  'E_EXPR_SYNTAX',
  'E_EXPR_UNKNOWN_TAG',
  'E_EXPR_UNKNOWN_TABLE',
  'E_EXPR_UNKNOWN_FUNC',
  'E_EXPR_ARITY',
  'E_EXPR_TYPE',
  'E_EXPR_CYCLE',
  'E_EXPR_DEPTH',
  'E_EXPR_LIMIT',
  'E_VT_OVERLAP',
  'E_VT_RANGE',
  'E_VT_TEXT',
  'E_SERIAL_PORT',
  'E_SERIAL_SHARED',
  'E_SERIAL_NOT_ALLOWED',
  'W_WRITE_NO_LIMITS',
  'W_DETECT_SLOW',
  'W_RTU_SCAN_TIME',
  'W_BIT_RMW',
  'W_EXPR_INT64',
  'W_WATCH_REF',
  'W_ADDR_MODICON_BASE0',
];

const WRITE_CODES = [
  'CONFIRMED',
  'NO_READBACK',
  'APPLIED',
  'ACCEPTED',
  'WRITE_TIMEOUT',
  'READBACK_TIMEOUT',
  'DEVICE_EXCEPTION',
  'READBACK_MISMATCH',
  'READBACK_ERROR',
  'UNKNOWN_OUTCOME',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'FORBIDDEN',
  'HTTPS_REQUIRED',
  'NO_SUCH_TAG',
  'READ_ONLY',
  'BAD_TYPE',
  'NOT_FINITE',
  'OUT_OF_LIMITS',
  'OUT_OF_TYPE_RANGE',
  'OUT_OF_RAW_RANGE',
  'STRING_TOO_LONG',
  'CONNECTION_BAD',
  'DEVICE_NOT_ACTIVE',
  'DISABLED',
  'RATE_LIMITED',
  'QUEUE_FULL',
  'PROJECT_CHANGING',
  'AUDIT_UNAVAILABLE',
  'REQUEST_ID_CONFLICT',
  'LIVE_WRITE_NOT_ALLOWED',
];

const PROBE_CODES = [
  'OK',
  'REFUSED',
  'TIMEOUT',
  'UNREACHABLE',
  'DNS',
  'PORT_BUSY',
  'PORT_CONSOLE',
  'PORT_NOT_ALLOWED',
  'PORT_ERROR',
  'EXCEPTION',
  'BAD_FRAME',
];

const viet = /[ạàáảãăâđêôơưẹèéẻẽệềếểễịìíỉĩọòóỏõộồốổỗợờớởỡụùúủũựừứửữ]/i;

describe('mã lý do của Tag (live 1.2.0)', () => {
  it('mỗi mã trong data-model §6 có câu tiếng Việt riêng', () => {
    const generic = reasonText('MA_LA');
    const texts = REASONS.map((c) => reasonText(c));
    for (const [i, text] of texts.entries()) {
      expect(text, REASONS[i]).not.toBe(generic);
      expect(text, REASONS[i]).toMatch(viet);
    }
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('mã lạ giữ nguyên để hiện "không rõ" kèm mã; không có lý do thì chuỗi rỗng', () => {
    expect(reasonText('MA_LA')).toBe('không rõ (MA_LA)');
    expect(reasonText('toString')).toBe('không rõ (toString)');
    expect(reasonText(undefined)).toBe('');
    expect(reasonText('')).toBe('');
  });

  it('exception trong lý do kèm nghĩa của mã', () => {
    expect(reasonText('EXCEPTION_02')).toContain('địa chỉ không hợp lệ');
  });
});

describe('exception Modbus 01–0B', () => {
  it('mỗi mã có nghĩa riêng, dạng "02: địa chỉ không hợp lệ"', () => {
    expect(exceptionText('02')).toBe('02: địa chỉ không hợp lệ');
    const texts = EXCEPTIONS.map((c) => exceptionText(c));
    expect(new Set(texts).size).toBe(EXCEPTIONS.length);
    for (const [i, text] of texts.entries()) expect(text, EXCEPTIONS[i]).toMatch(viet);
  });

  it('mã lạ: mã lạ của thiết bị trường; nhận chữ thường', () => {
    expect(exceptionText('7F')).toBe('7F: mã lạ của thiết bị trường');
    expect(exceptionText('0a')).toBe(exceptionText('0A'));
  });
});

describe('mã lỗi và cảnh báo của project 0.2, lỗi biểu thức', () => {
  it('mỗi mã có câu tiếng Việt riêng, không phải câu của validator', () => {
    const texts = ISSUES.map((code) => issueText({ code, message: 'english message' }));
    for (const [i, text] of texts.entries()) {
      expect(text, ISSUES[i]).toMatch(viet);
      expect(text, ISSUES[i]).not.toBe('english message');
    }
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('mã của 0.1 hoặc mã lạ: giữ message của bộ kiểm tra', () => {
    expect(issueText({ code: 'E_TAG_RANGE', message: 'min must be less than max' })).toBe(
      'min must be less than max',
    );
    expect(issueText({ code: 'E_MA_LA', message: 'x' })).toBe('x');
  });

  it('cảnh báo ước tính vòng quét RTU và phát hiện chậm lấy số từ message', () => {
    expect(
      issueText({
        code: 'W_RTU_SCAN_TIME',
        message: 'estimated 524 ms for one fast scan round, longer than the 250 ms period',
      }),
    ).toBe('ước tính 524 ms cho một vòng quét nhóm fast, dài hơn chu kỳ 250 ms');
    expect(
      issueText({
        code: 'W_DETECT_SLOW',
        message: 'timeoutMs x (retries + 1) = 2000 ms exceeds the fast scan period (250 ms)',
      }),
    ).toBe('thời gian chờ x (số lần thử + 1) = 2000 ms lớn hơn chu kỳ nhóm fast (250 ms)');
  });
});

describe('mã kết quả ghi Tag', () => {
  it('mỗi mã REJECTED, FAILED, TIMEOUT, CONFIRMED có câu riêng', () => {
    const texts = WRITE_CODES.map((c) => writeCodeText(c));
    for (const [i, text] of texts.entries()) expect(text, WRITE_CODES[i]).toMatch(viet);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('NO_READBACK là "thiết bị xác nhận, không đọc lại"; TIMEOUT là "không chắc đã ghi"', () => {
    expect(writeCodeText('NO_READBACK')).toBe('thiết bị xác nhận, không đọc lại');
    expect(writeCodeText('WRITE_TIMEOUT')).toContain('không chắc đã ghi');
  });

  it('NOT_SENT_* chưa gửi tới thiết bị trường, kèm mã', () => {
    expect(writeCodeText('NOT_SENT_DEADLINE')).toBe(
      'chưa gửi tới thiết bị trường (NOT_SENT_DEADLINE)',
    );
  });

  it('mã lạ giữ mã; OUT_OF_LIMITS kèm giới hạn nếu có', () => {
    expect(writeCodeText('MA_LA')).toBe('không rõ (MA_LA)');
    expect(writeCodeText('OUT_OF_LIMITS', { min: 0, max: 90 })).toBe(
      'ngoài giới hạn ghi (0 đến 90)',
    );
    expect(writeCodeText('RATE_LIMITED', { retryAfterMs: 2400 })).toBe(
      'ghi quá nhanh, thử lại sau 2,4 giây',
    );
  });

  it('trạng thái', () => {
    for (const s of ['ACCEPTED', 'CONFIRMED', 'FAILED', 'TIMEOUT', 'REJECTED', 'UNKNOWN']) {
      expect(writeStatusText(s)).toMatch(viet);
    }
    expect(writeStatusText('X')).toBe('không rõ (X)');
  });
});

describe('mã Thử kết nối', () => {
  it('mỗi mã có câu riêng; REFUSED nói PLC từ chối kết nối', () => {
    const texts = PROBE_CODES.map((c) => probeCodeText(c));
    for (const [i, text] of texts.entries()) expect(text, PROBE_CODES[i]).toMatch(viet);
    expect(new Set(texts).size).toBe(texts.length);
    expect(probeCodeText('REFUSED')).toBe('PLC từ chối kết nối (có thể đã đủ số kết nối)');
    expect(probeCodeText('MA_LA')).toBe('không rõ (MA_LA)');
  });
});

describe('mã của driver Siemens S7 (feature 016)', () => {
  it('lý do quality và lỗi kênh S7 có câu tiếng Việt (schemas/error-codes.json)', () => {
    for (const code of [
      'S7_ACCESS_DENIED',
      'S7_ADDRESS_OUT_OF_RANGE',
      'S7_HARDWARE_FAULT',
      'S7_ITEM_ERROR',
      'S7_OBJECT_NOT_FOUND',
      'S7_PDU_TOO_SMALL',
      'S7_REQUEST_ERROR',
      'S7_TYPE_INCONSISTENT',
      'S7_TYPE_NOT_SUPPORTED',
      'S7_FUNCTION_NOT_AVAILABLE',
      'S7_CONNECT_REJECTED',
      'S7_SETUP_FAILED',
    ])
      expect(reasonText(code)).not.toMatch(/không rõ/);
    expect(reasonText('S7_FUNCTION_NOT_AVAILABLE')).toContain('PUT/GET');
    expect(reasonText('S7_OBJECT_NOT_FOUND')).toContain('DB không có');
  });

  it('lỗi của bộ kiểm tra: E_DRIVER_VERSION, E_S7_TSAP; lỗi địa chỉ của Tag S7 nói S7, không nói Modbus', () => {
    expect(issueText({ code: 'E_DRIVER_VERSION', message: 'x' })).toContain('định dạng 1.1');
    expect(issueText({ code: 'E_S7_TSAP', message: 'x' })).toContain('rack và slot');
    const s7 = issueText({ code: 'E_ADDR_SYNTAX', message: "S7 address 'DB1.X': E_ADDR_SYNTAX" });
    expect(s7).toContain('DB1.DBX0.0');
    expect(s7).not.toContain('Modbus');
    expect(issueText({ code: 'E_ADDR_SYNTAX', message: 'bad address' })).toContain('Modbus');
    expect(
      issueText({ code: 'E_ADDR_RANGE', message: "S7 address 'DB0.DBW0': E_ADDR_RANGE" }),
    ).toContain('DB 1–65535');
    expect(
      issueText({
        code: 'E_ADDR_READ_LIMIT',
        message: 'the tag takes 300 bytes, more than one read of PDU 240 allows (222)',
      }),
    ).toContain('PDU');
    expect(
      issueText({
        code: 'E_ADDR_WRITE_LIMIT',
        message: 'a write of the tag takes 300 bytes, more than PDU 240 allows (212)',
      }),
    ).toContain('PDU');
    expect(
      issueText({
        code: 'E_SCHEMA',
        message: 'byteOrder does not apply to S7 tags (always big-endian)',
      }),
    ).toContain('big-endian');
  });
});
