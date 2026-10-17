// Chip cảnh báo của feature 011 (T052, FR-036, FR-013; device-api-011 §5): chữ ngắn, icon, màu theo mức và
// hướng dẫn hành động; dùng ở thanh trạng thái, trang Thiết bị và Bảng theo dõi (PULSE_STUCK).
import { html } from 'lit';
import { t, type MessageKey } from '../i18n/index.ts';
import type { WarningChip } from '../model/device.ts';
import { icon } from './base.ts';

/** Chữ ngắn của chip. */
export const chipLabel = (c: WarningChip): string => t(`devwarn.${c.key}` as MessageKey);

/** Hướng dẫn hành động (kèm thông điệp của thiết bị khi có, và Tag của PULSE_STUCK). */
export function chipAction(c: WarningChip): string {
  const d = c.detail as { tags?: unknown } | null;
  const tags = Array.isArray(d?.tags)
    ? d.tags.filter((x): x is string => typeof x === 'string').join(', ')
    : '';
  const act = t(`devwarn.${c.key}.act` as MessageKey, { tags: tags || '?' });
  return c.message ? `${c.message}. ${act}` : act;
}

/** Một chip (`data-role="devwarn"`, `data-code`): màu và icon theo mức, title là hướng dẫn. */
export function chipView(c: WarningChip) {
  return html`<span
    class="chip ${c.tone}"
    data-role="devwarn"
    data-code=${c.code}
    title=${chipAction(c)}
    >${icon(c.tone === 'err' ? 'err' : 'warn', c.tone)}${chipLabel(c)}</span
  >`;
}
