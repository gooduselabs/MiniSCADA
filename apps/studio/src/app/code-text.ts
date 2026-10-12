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
export function issueText(issue: { code: string; message: string }): string {
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
  const key = lookup('issue', code);
  return key ? t(key) : message;
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
const plainNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6, useGrouping: false });

/** Mã kết quả ghi (mã REJECTED theo bước, mã cuối FAILED, TIMEOUT, CONFIRMED). `NOT_SENT_*` chưa gửi. */
export function writeCodeText(code: string, extra: WriteCodeExtra = {}): string {
  if (code === 'OUT_OF_LIMITS') {
    const { min, max } = extra;
    if (min !== undefined && max !== undefined)
      return t('writeCode.OUT_OF_LIMITS.range', {
        min: plainNumber.format(min),
        max: plainNumber.format(max),
      });
    if (min !== undefined) return t('writeCode.OUT_OF_LIMITS.min', { min: plainNumber.format(min) });
    if (max !== undefined) return t('writeCode.OUT_OF_LIMITS.max', { max: plainNumber.format(max) });
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
