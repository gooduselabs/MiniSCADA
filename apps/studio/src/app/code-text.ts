// Câu tiếng Việt cho mã của feature 006 (T075, T076): lý do của quality, exception Modbus, lỗi và cảnh báo của
// project 0.2, kết quả ghi Tag, kết quả Thử kết nối. Mã lạ: "không rõ" kèm mã (không ném lỗi: thiết bị mới hơn
// Studio có thể gửi mã Studio chưa biết). Chuỗi nằm ở i18n/vi-tags2.ts.
import { hasKey, t, type MessageKey } from '../i18n/index.ts';

const lookup = (prefix: string, code: string): MessageKey | null => {
  const key = `${prefix}.${code}`;
  return hasKey(key) ? key : null;
};

const unknownText = (code: string): string => t('reason.unknown', { code });

/** Lý do của quality (live 1.2.0). Không có lý do thì chuỗi rỗng; mã lạ thì "không rõ (MÃ)". */
export function reasonText(code: string | undefined): string {
  if (code === undefined || code === '') return '';
  const key = lookup('tagReason', code);
  return key ? t(key) : unknownText(code);
}

/** Exception Modbus: "02: địa chỉ không hợp lệ"; mã lạ: "7F: mã lạ của thiết bị trường". */
export function exceptionText(code: string): string {
  const up = code.toUpperCase();
  const key = lookup('modbusEx', up);
  return t('modbusEx.line', { code: up, meaning: t(key ?? 'modbusEx.other') });
}

const number = (s: string): number => Number(s);

/**
 * Câu cho một lỗi hay cảnh báo của bộ kiểm tra. Mã của project 0.2 có câu tiếng Việt riêng (cảnh báo thời gian quét
 * lấy số từ `message`); mã của 0.1 và mã lạ giữ `message` của bộ kiểm tra.
 */
export function issueText(issue: { code: string; message: string; path?: string }): string {
  const { code, message } = issue;
  if (code === 'W_RTU_SCAN_TIME') {
    const m = /estimated (\d+) ms for one (\w+) scan round, longer than the (\d+) ms period/.exec(
      message,
    );
    return m
      ? t('issue.W_RTU_SCAN_TIME', { total: number(m[1]), group: m[2], period: number(m[3]) })
      : t('issue.W_RTU_SCAN_TIME.plain');
  }
  if (code === 'W_DETECT_SLOW') {
    const m = /= (\d+) ms exceeds the (\w+) scan period \((\d+) ms\)/.exec(message);
    return m
      ? t('issue.W_DETECT_SLOW', { total: number(m[1]), group: m[2], period: number(m[3]) })
      : t('issue.W_DETECT_SLOW.plain');
  }
  const s7 = s7IssueKey(code, message);
  if (s7) return t(s7);
  const ua = opcuaIssueKey(code, message);
  if (ua) return t(ua);
  const mq = mqttIssueKey(code, message);
  if (mq) return t(mq);
  if (code === 'E_SCHEMA') return schemaText(message, issue.path);
  const key = lookup('issue', code);
  return key ? t(key) : message;
}

/**
 * Lỗi của Tag S7 dùng chung mã với Modbus (E_ADDR_*, E_SCHEMA): nhận ra theo câu tiếng Anh của bộ kiểm tra
 * (packages/project-schema/src/rules-s7.ts) để câu tiếng Việt nói S7 thay vì Modbus.
 */
function s7IssueKey(code: string, message: string): MessageKey | null {
  if (/^E_ADDR_(SYNTAX|AREA|RANGE)$/.test(code) && message.startsWith('S7 address'))
    return lookup('issue', `${code}.s7`);
  if ((code === 'E_ADDR_READ_LIMIT' || code === 'E_ADDR_WRITE_LIMIT') && /\bPDU\b/.test(message))
    return lookup('issue', `${code}.s7`);
  if (code === 'E_SCHEMA' && /does not apply to S7 tags/.test(message))
    return 'issue.E_SCHEMA.s7ByteOrder';
  return null;
}

/**
 * Lỗi của Tag OPC UA dùng chung mã với Modbus (E_ADDR_*, E_SCHEMA): nhận ra theo câu tiếng Anh của bộ kiểm tra
 * (packages/project-schema/src/rules-opcua.ts) để câu tiếng Việt nói NodeId thay vì địa chỉ Modbus.
 */
function opcuaIssueKey(code: string, message: string): MessageKey | null {
  if ((code === 'E_ADDR_SYNTAX' || code === 'E_ADDR_RANGE') && message.startsWith('OPC UA NodeId'))
    return lookup('issue', `${code}.opcua`);
  if (code === 'E_SCHEMA' && /does not apply to OPC UA tags/.test(message))
    return 'issue.E_SCHEMA.opcuaByteOrder';
  return null;
}

/**
 * Lỗi của Tag MQTT dùng chung mã với Modbus (E_ADDR_*, E_SCHEMA): nhận ra theo câu tiếng Anh của bộ kiểm tra
 * (packages/project-schema/src/rules-mqtt.ts) để câu tiếng Việt nói topic thay vì địa chỉ Modbus (feature 022).
 */
function mqttIssueKey(code: string, message: string): MessageKey | null {
  if ((code === 'E_ADDR_SYNTAX' || code === 'E_ADDR_RANGE') && message.startsWith('MQTT address'))
    return lookup('issue', `${code}.mqtt`);
  if (code === 'E_SCHEMA' && /does not apply to MQTT tags/.test(message))
    return 'issue.E_SCHEMA.mqttByteOrder';
  return null;
}

/** Trạng thái của một lệnh ghi: ACCEPTED, CONFIRMED, FAILED, TIMEOUT, REJECTED, UNKNOWN. */
export function writeStatusText(status: string): string {
  const key = lookup('writeStatus', status);
  return key ? t(key) : unknownText(status);
}

export interface WriteCodeExtra {
  min?: number;
  max?: number;
  retryAfterMs?: number;
}

const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1, useGrouping: false });
const plainNumber = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 6,
  useGrouping: false,
});

/** Mã kết quả ghi (mã REJECTED theo bước, mã cuối FAILED, TIMEOUT, CONFIRMED). `NOT_SENT_*` chưa gửi. */
export function writeCodeText(code: string, extra: WriteCodeExtra = {}): string {
  if (code === 'OUT_OF_LIMITS') {
    const { min, max } = extra;
    if (min !== undefined && max !== undefined)
      return t('writeCode.OUT_OF_LIMITS.range', {
        min: plainNumber.format(min),
        max: plainNumber.format(max),
      });
    if (min !== undefined)
      return t('writeCode.OUT_OF_LIMITS.min', { min: plainNumber.format(min) });
    if (max !== undefined)
      return t('writeCode.OUT_OF_LIMITS.max', { max: plainNumber.format(max) });
  }
  if (code === 'RATE_LIMITED' && extra.retryAfterMs !== undefined)
    return t('writeCode.RATE_LIMITED.after', {
      time: t('writeCode.seconds', { n: decimal.format(extra.retryAfterMs / 1000) }),
    });
  if (code.startsWith('NOT_SENT_')) return t('writeCode.NOT_SENT', { code });
  const key = lookup('writeCode', code);
  return key ? t(key) : unknownText(code);
}

/** Mã kết quả của Thử kết nối. */
export function probeCodeText(code: string): string {
  const key = lookup('probeCode', code);
  return key ? t(key) : unknownText(code);
}

/**
 * Câu tiếng Việt cho lỗi E_SCHEMA (sửa lỗi 039): bộ kiểm tra schema (@cfworker/json-schema) trả câu tiếng Anh thô như
 * "Array has too few items (0 < 1)"; ở đây dịch các dạng hay gặp, kèm tên trường lấy từ đường dẫn. Dạng lạ: câu chung
 * kèm câu gốc.
 */
export function schemaText(message: string, path = ''): string {
  const segs = path.split('/').filter(Boolean);
  const lastName = [...segs].reverse().find((s) => !/^\d+$/.test(s));
  const field = lastName ?? t('schema.root');
  let m: RegExpExecArray | null;
  if ((m = /^Array has too few items \((\d+) < (\d+)\)/.exec(message)))
    return Number(m[1]) === 0
      ? t('schema.emptyList', { field, min: Number(m[2]) })
      : t('schema.fewItems', { field, n: Number(m[1]), min: Number(m[2]) });
  if ((m = /^Array has too many items \((\d+) > (\d+)\)/.exec(message)))
    return t('schema.manyItems', { field, n: Number(m[1]), max: Number(m[2]) });
  if ((m = /^Instance does not have required property "([^"]+)"/.exec(message)))
    return t('schema.required', { field, prop: m[1]! });
  if (
    (m =
      /^Property "([^"]+)" does not match (additional properties |unevaluated properties )?schema/.exec(
        message,
      ))
  )
    return t('schema.property', { prop: m[1]! });
  if ((m = /^Instance type "([^"]+)" is invalid\. Expected "(.+)"/.exec(message)))
    return t('schema.type', { field, want: m[2]!.replace(/", "/g, ', ') });
  if ((m = /^String is too long \((\d+) > (\d+)\)/.exec(message)))
    return t('schema.tooLong', { field, max: Number(m[2]) });
  if ((m = /^String is too short \((\d+) < (\d+)\)/.exec(message)))
    return t('schema.tooShort', { field, min: Number(m[2]) });
  if (/^String does not match (pattern|format)/.test(message))
    return t('schema.pattern', { field });
  if ((m = /^(-?[\d.e+]+) is (greater|less) than (or equal to )?\s*(-?[\d.e+]+)/.exec(message)))
    return t(m[2] === 'greater' ? 'schema.max' : 'schema.min', { field, limit: m[4]! });
  if (/^Instance does not match any of /.test(message)) return t('schema.enum', { field });
  if (/^Duplicate items/.test(message)) return t('schema.duplicate', { field });
  if (/[À-ỹ]/.test(message)) return message; // câu đã là tiếng Việt (vd. chuỗi quá dài theo byte)
  return t('schema.other', { field, message });
}

/**
 * Câu cho lỗi của logging.json kèm tên nhóm (sửa lỗi 042): nhóm 0 Tag nói rõ cách thêm Tag; lỗi khác của trường con
 * của nhóm có tiền tố "Bảng lưu trữ 'X':" để người dùng biết nhóm nào.
 */
export function loggingIssueText(
  issue: { code: string; message: string; path?: string },
  cfg: { groups?: readonly { id?: string; name?: string }[] } | null | undefined,
): string {
  const m = /^\/groups\/(\d+)(\/.*)?$/.exec(issue.path ?? '');
  if (!m) return issueText(issue);
  const g = cfg?.groups?.[Number(m[1])];
  const name = g?.name || g?.id || String(Number(m[1]) + 1);
  if (
    issue.code === 'E_SCHEMA' &&
    m[2] === '/tags' &&
    /^Array has too few items \(0 < /.test(issue.message)
  )
    return t('hist.issue.noTags', { name });
  return t('hist.issue.inGroup', { name, text: issueText(issue) });
}
