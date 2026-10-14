// Nội dung alarm có chèn giá trị (feature 009, T079, FR-005, FR-079; contract studio-alarm-editor §3.1): Xem trước nội dung
// bằng `formatAlarmText` của @mat/alarm-engine (cùng bộ định dạng với runtime), kiểm thẻ lạ, gợi ý thẻ khi gõ `{`. Hàm thuần.
import { alarmTextTokensValid, ALARM_LIMITS, type AlarmDef } from '@mat/project-schema';
import { defaultTemplate, formatAlarmText } from '@mat/alarm-engine';
import { t, type MessageKey } from '../i18n/index.ts';
import { tagRange, type AlarmDoc, type TagLite } from './alarm-doc.ts';

/** Thẻ gợi ý theo thứ tự hiện: khóa chèn, nhãn tiếng Việt. */
export const TEXT_TOKENS: ReadonlyArray<{ token: string; label: MessageKey }> = [
  { token: 'name', label: 'alarm.text.token.name' },
  { token: 'tag', label: 'alarm.text.token.tag' },
  { token: 'value', label: 'alarm.text.token.value' },
  { token: 'value:1', label: 'alarm.text.token.value1' },
  { token: 'unit', label: 'alarm.text.token.unit' },
  { token: 'limit', label: 'alarm.text.token.limit' },
  { token: 'limitName', label: 'alarm.text.token.limitName' },
  { token: 'area', label: 'alarm.text.token.area' },
  { token: 'reason', label: 'alarm.text.token.reason' },
];

export interface TokenQuery {
  /** Vị trí dấu `{` chưa đóng ngay trước con trỏ. */
  start: number;
  /** Chữ đã gõ sau dấu `{`. */
  prefix: string;
}

/** Đang gõ dở một thẻ (`{` chưa có `}` trước con trỏ): trả vị trí và chữ đã gõ; không thì `null`. */
export function tokenQuery(text: string, caret: number): TokenQuery | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('{');
  if (open < 0 || before.indexOf('}', open) >= 0) return null;
  const prefix = before.slice(open + 1);
  return /^[A-Za-z:0-9]*$/.test(prefix) ? { start: open, prefix } : null;
}

/** Gợi ý thẻ khớp phần đã gõ. */
export function tokenSuggestions(q: TokenQuery): typeof TEXT_TOKENS {
  const p = q.prefix.toLowerCase();
  return TEXT_TOKENS.filter((x) => x.token.toLowerCase().startsWith(p));
}

/** Chèn thẻ đã chọn thay phần đang gõ: trả chữ mới và vị trí con trỏ (sau `}`). */
export function insertToken(
  text: string,
  caret: number,
  q: TokenQuery,
  token: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, q.start)}{${token}}${text.slice(caret)}`;
  return { text: next, caret: q.start + token.length + 2 };
}

export type TextCheck = 'ok' | 'token' | 'length';

/** Kiểm nội dung như bộ kiểm tra: thẻ lạ hoặc thiếu ngoặc, dài hơn 200 ký tự. */
export function checkText(template: string): TextCheck {
  if ([...template].length > ALARM_LIMITS.textChars) return 'length';
  return alarmTextTokensValid(template) ? 'ok' : 'token';
}

export interface PreviewSample {
  name: string;
  tag: string;
  unit: string;
  value: number;
  limit: number | null;
  limitName: string;
  area: string;
  reason: string;
  isBool: boolean;
}

/** Ví dụ cho một alarm: giá trị giữa khoảng của Tag, ngưỡng đang xét (H nếu có, không thì ngưỡng đầu tiên). */
export function sampleFor(
  def: AlarmDef,
  doc: AlarmDoc,
  tags: ReadonlyMap<string, TagLite>,
  limitName?: string,
): PreviewSample {
  const d = def as unknown as {
    id: string;
    name: string;
    tag?: string;
    device?: string;
    area?: string;
    limits?: Record<string, { value: number }>;
  };
  const tag = d.tag ? tags.get(d.tag) : undefined;
  const names = Object.keys(d.limits ?? {});
  const ln =
    limitName && d.limits?.[limitName] ? limitName : names.includes('H') ? 'H' : (names[0] ?? '');
  const limit = ln ? (d.limits?.[ln]?.value ?? null) : null;
  const range = tag ? tagRange(tag) : null;
  const value =
    typeof limit === 'number'
      ? Math.round(
          (limit + (ln === 'L' || ln === 'LL' ? -1 : 1) * Math.max(1, Math.abs(limit) * 0.05)) * 10,
        ) / 10
      : range
        ? (range.min + range.max) / 2
        : 1;
  return {
    name: d.name || d.id,
    tag: d.tag ?? d.device ?? '',
    unit: tag?.unit ?? '',
    value,
    limit: typeof limit === 'number' ? limit : null,
    limitName: ln,
    area: d.area
      ? (doc.areas.find((a) => a.id === d.area)?.name ?? d.area)
      : t('alarm.area.common'),
    reason: 'TIMEOUT',
    isBool: tag?.type === 'BOOL',
  };
}

/** Xem trước: nội dung đã chèn mẫu (trống thì mẫu mặc định theo loại và ngưỡng, D9). */
export function previewText(template: string, def: AlarmDef, sample: PreviewSample): string {
  const kind = (def as unknown as { type: 'digital' | 'limit' | 'quality' }).type;
  const tpl =
    template.trim() === ''
      ? defaultTemplate({ kind, limitName: sample.limitName as never })
      : template;
  return formatAlarmText(tpl, {
    name: sample.name,
    tag: sample.tag,
    value: sample.value,
    unit: sample.unit,
    limit: sample.limit,
    limitName: sample.limitName,
    area: sample.area,
    reason: sample.reason,
    isBool: sample.isBool,
  });
}
