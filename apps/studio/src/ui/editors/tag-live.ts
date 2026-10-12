// Giá trị sống của Tag khi theo dõi hoặc Online (feature 004, FR-028; feature 006): định dạng giá trị, quality, lý do, dùng
// chung cho Bảng Tag (lưới), Inspector của Tag và Bảng theo dõi.
import type { Quality, TagValue } from '@mat/live-client';
import type { StudioApp } from '../../app/app.ts';
import { reasonText } from '../../app/code-text.ts';
import { t } from '../../i18n/index.ts';
import { isLive } from '../../model/device-session.ts';

export const DASH = '—';

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 3,
  useGrouping: false,
});

/** Giá trị sống để hiện: số theo cách viết Việt Nam (dấu phẩy thập phân) kèm đơn vị; BOOL là TRUE/FALSE. */
export function formatLive(value: TagValue, unit?: unknown): string {
  if (value === null) return DASH;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    const n = NUMBER_FORMAT.format(value);
    return typeof unit === 'string' && unit.trim() !== '' ? `${n} ${unit}` : n;
  }
  return String(value);
}

export interface LiveView {
  /** `none`: thiết bị không có Tag; `wait`: chưa nhận giá trị; `value`: có giá trị. */
  kind: 'none' | 'wait' | 'value';
  text: string;
  /** STALE khi giá trị không còn tốt (mất kết nối, thiết bị đầy, đang kết nối lại). */
  quality: Quality | null;
  /** Mã lý do (live 1.2.0) khi quality khác GOOD. */
  reason?: string;
}

export function liveOf(app: StudioApp, id: string, unit: unknown): LiveView {
  const s = app.session;
  if (id !== '' && s.unknown.has(id))
    return { kind: 'none', text: t('tagGrid.live.none'), quality: null };
  const v = s.values.get(id);
  if (!v) return { kind: 'wait', text: DASH, quality: null };
  // Rời trạng thái theo dõi thì không giữ giá trị cũ như còn tốt (FR-028).
  const good = v.quality !== 'STALE' && isLive(s.state);
  return {
    kind: 'value',
    text: formatLive(v.value, unit),
    quality: good ? v.quality : 'STALE',
    ...(v.reason !== undefined ? { reason: v.reason } : {}),
  };
}

export const QUALITY_CHIP: Readonly<Record<Exclude<Quality, 'STALE'>, string>> = {
  GOOD: 'ok',
  BAD: 'err',
  UNCERTAIN: 'warn',
};

export const qualityText = (q: Quality): string => (q === 'STALE' ? t('tagGrid.live.stale') : q);

/** Lý do bằng tiếng Việt cho quality không tốt (trống khi GOOD); STALE nói rõ do mất kết nối. */
export function liveReasonText(v: LiveView): string {
  if (v.kind !== 'value') return '';
  if (v.quality === 'STALE') return t('tagGrid.live.stale');
  return v.reason ? reasonText(v.reason) : '';
}
