// Mảnh giao diện dùng chung của Logic (feature 011, T144; mockup studio-logic.html cảnh 4, T007 quyết định 1, 2): chip trạng
// thái khối (màu luôn kèm biểu tượng và chữ: OK xanh lá, SUSPENDED hổ phách, THROTTLED xanh dương thông tin, DISABLED xám),
// chip Ghi PLC (tắt, bật, dừng, chưa hỗ trợ), chữ của hành động, giá trị cho phép, tần suất. Dữ liệu chỉ qua binding của Lit.
import type { LogicAction, LogicDoc, LogicWrite } from '@mat/project-schema';
import { html, type TemplateResult } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import type { LogicDeviceWrites } from '../../model/deploy-preview.ts';
import { isExprValue, type LogicKind } from '../../model/logic-doc.ts';
import { icon } from '../base.ts';

export const KIND_ICON: Readonly<Record<LogicKind, IconName>> = {
  rule: 'rule',
  timer: 'timer',
  counter: 'counter',
  totalizer: 'sum',
  runhours: 'hours',
  schedule: 'cal',
  writes: 'plc',
};

export const kindLabel = (k: LogicKind): string => t(`logic.kind.${k}` as MessageKey);

const STATE_ICON: Readonly<Record<string, IconName>> = {
  OK: 'ok',
  SUSPENDED: 'susp',
  THROTTLED: 'throt',
  DISABLED: 'ban',
  UNKNOWN: 'info',
};

/** Chip trạng thái của khối: lớp `st-<STATE>`, biểu tượng, mã (như API), lý do; tooltip tiếng Việt. */
export function stateChip(state: string, reason?: string | null): TemplateResult {
  const known = state in STATE_ICON ? state : 'UNKNOWN';
  return html`<span
    class="chip st-${known}"
    title=${t(`logic.st.${known}` as MessageKey)}
    data-state=${state}
    >${icon(STATE_ICON[known]!)}${state}${reason ? ` · ${reason}` : ''}</span
  >`;
}

const WS: Readonly<Record<LogicDeviceWrites, { cls: string; ic: IconName; key: MessageKey }>> = {
  off: { cls: '', ic: 'plc-off', key: 'logic.ws.off' },
  on: { cls: 'ok', ic: 'plc', key: 'logic.ws.on' },
  stopped: { cls: 'err', ic: 'stop', key: 'logic.ws.stopped' },
  unsupported: { cls: 'dash', ic: 'plc-off', key: 'logic.ws.unsupported' },
  unknown: { cls: 'dash', ic: 'info', key: 'logic.ws.unknown' },
};

export const wsClass = (s: LogicDeviceWrites): string => WS[s].cls;
export const wsIcon = (s: LogicDeviceWrites): IconName => WS[s].ic;
export const wsText = (s: LogicDeviceWrites): string => t(WS[s].key);

/** Chip "Ghi PLC: …" (chỉ hiển thị). */
export function wsChip(s: LogicDeviceWrites): TemplateResult {
  return html`<span class="chip big ${WS[s].cls}" data-ws=${s}
    >${icon(WS[s].ic)}${wsText(s)}</span
  >`;
}

const fmtScalar = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
export const num = (n: number): string => nf.format(n);

export function allowedText(a: LogicWrite['allowed'] | undefined): string {
  if (!a) return '';
  if ('values' in a) return a.values.map(fmtScalar).join(', ');
  return t('logic.allowed.range', { min: num(a.min), max: num(a.max) });
}

/** "1 lệnh / 30 s · 20 / giờ". */
export function rateText(
  minIntervalMs: number | null | undefined,
  maxPerHour: number | null | undefined,
): string {
  const parts: string[] = [];
  if (typeof minIntervalMs === 'number')
    parts.push(t('logic.rate.interval', { s: num(minIntervalMs / 1000) }));
  if (typeof maxPerHour === 'number') parts.push(t('logic.rate.hour', { n: maxPerHour }));
  return parts.join(' · ');
}

export const ACTION_ICON: Readonly<Record<string, IconName>> = {
  setTag: 'set-tag',
  toggle: 'toggle-tag',
  write: 'plc',
  pulse: 'square',
};

export const actionLabel = (d: string): string =>
  d in ACTION_ICON ? t(`logic.act.${d}` as MessageKey) : d;

const valueText = (v: LogicAction['value']): string =>
  v === undefined ? '' : isExprValue(v) ? `{expr: ${v.expr}}` : fmtScalar(v);

/** Chữ ngắn của một hành động: `w_pump_run → PUMP01.RUN_CMD = true`. */
export function actionText(a: LogicAction, doc: LogicDoc | null): string {
  if (a.do === 'write' || a.do === 'pulse') {
    const tag = doc?.writes?.find((w) => w.id === a.write)?.tag ?? '?';
    const ms = a.do === 'pulse' && a.ms !== undefined ? `, ${a.ms} ms` : '';
    return `${a.write ?? '?'} → ${tag} = ${valueText(a.value)}${ms}`;
  }
  if (a.do === 'toggle') return a.tag ?? '?';
  return `${a.tag ?? '?'} = ${valueText(a.value)}`;
}

export function actionsShort(list: readonly LogicAction[] | undefined, doc: LogicDoc | null) {
  if (!list?.length) return html`<span class="muted">—</span>`;
  return list.map(
    (a, i) =>
      html`${i ? ' ; ' : ''}<span class="act-s"
          >${icon(ACTION_ICON[a.do] ?? 'info', 'sm')}${actionText(a, doc)}</span
        >`,
  );
}
