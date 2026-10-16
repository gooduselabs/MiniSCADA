// Bảng khối của editor Logic (feature 011, T144; mockup studio-logic.html cảnh 1): mỗi nhóm một bộ cột như mockup (Luật: Id,
// Tên, Bật, Khi, Giữ, Khi lên, Khi xuống, Lặp, Bắn khi khởi động…), lỗi và cảnh báo theo ô (viền đỏ/hổ phách kèm biểu
// tượng, chi tiết ở tab Thông tin), dòng tắt mờ, cột trạng thái sống khi Online (viền cam, chip trạng thái có chữ).
import type { LogicAction, LogicDoc, TagV1 } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { LogicBlockStatus } from '../../model/device.ts';
import {
  blocksOf,
  updateBlock,
  writesUsage,
  type Block,
  type LogicKind,
} from '../../model/logic-doc.ts';
import { icon } from '../base.ts';
import { actionsShort, allowedText, num, stateChip } from './logic-parts.ts';
import {
  cellMarks,
  editLogic,
  logicDoc,
  logicUi,
  projectTags,
  select,
  selectedId,
} from './logic-state.ts';

type Cls = 'mono' | 'ex' | 'rt' | 'bool' | 'acts' | '';

interface Col {
  key: string;
  label: MessageKey;
  /** Tên khóa JSON nhỏ cạnh nhãn (`when`, `ms`). */
  sub?: string;
  cls: Cls;
}

const C = (key: string, label: MessageKey, cls: Cls = '', sub?: string): Col =>
  sub === undefined ? { key, label, cls } : { key, label, cls, sub };

export const COLUMNS: Readonly<Record<LogicKind, readonly Col[]>> = {
  rule: [
    C('id', 'logic.col.id', 'mono'),
    C('name', 'logic.col.name'),
    C('enabled', 'logic.col.enabled', 'bool'),
    C('when', 'logic.col.when', 'ex', 'when'),
    C('hold', 'logic.col.hold', 'rt', 'ms'),
    C('onRise', 'logic.col.onRise', 'acts', 'onRise'),
    C('onFall', 'logic.col.onFall', 'acts', 'onFall'),
    C('repeatMs', 'logic.col.repeat', 'rt', 'repeatMs'),
    C('fireOnStart', 'logic.col.fireOnStart', 'bool', 'fireOnStart'),
  ],
  timer: [
    C('id', 'logic.col.id', 'mono'),
    C('kind', 'logic.col.timerKind', 'mono'),
    C('in', 'logic.col.in', 'ex', 'in'),
    C('pt', 'logic.col.pt', 'rt', 'ms'),
    C('q', 'logic.col.outQ', 'mono'),
    C('et', 'logic.col.outEt', 'mono'),
  ],
  counter: [
    C('id', 'logic.col.id', 'mono'),
    C('up', 'logic.col.up', 'ex', 'up'),
    C('down', 'logic.col.down', 'ex', 'down'),
    C('reset', 'logic.col.reset', 'ex', 'reset'),
    C('preset', 'logic.col.preset', 'rt'),
    C('value', 'logic.col.outValue', 'mono'),
    C('reached', 'logic.col.outReached', 'mono'),
    C('retain', 'logic.col.retain', 'bool'),
  ],
  totalizer: [
    C('id', 'logic.col.id', 'mono'),
    C('source', 'logic.col.source', 'ex', 'source'),
    C('rateUnit', 'logic.col.rateUnit', 'mono'),
    C('factor', 'logic.col.factor', 'rt'),
    C('cutoff', 'logic.col.cutoff', 'rt'),
    C('maxGapMs', 'logic.col.maxGap', 'rt', 'ms'),
    C('reset', 'logic.col.reset', 'ex', 'reset'),
    C('rolloverAt', 'logic.col.rollover', 'rt'),
    C('total', 'logic.col.outTotal', 'mono'),
    C('gapSeconds', 'logic.col.outGap', 'mono'),
    C('retain', 'logic.col.retain', 'bool'),
  ],
  runhours: [
    C('id', 'logic.col.id', 'mono'),
    C('run', 'logic.col.run', 'ex', 'run'),
    C('reset', 'logic.col.reset', 'ex', 'reset'),
    C('serviceEveryHours', 'logic.col.service', 'rt'),
    C('hours', 'logic.col.outHours', 'mono'),
    C('starts', 'logic.col.outStarts', 'mono'),
    C('due', 'logic.col.outDue', 'mono'),
    C('retain', 'logic.col.retain', 'bool'),
  ],
  schedule: [
    C('id', 'logic.col.id', 'mono'),
    C('weekly', 'logic.col.weekly'),
    C('exceptions', 'logic.col.exceptions'),
    C('tzOffsetMin', 'logic.col.tz', 'mono'),
    C('out', 'logic.col.out', 'mono'),
  ],
  writes: [
    C('id', 'logic.col.id', 'mono'),
    C('tag', 'logic.col.writeTag', 'mono'),
    C('type', 'logic.col.type', 'mono'),
    C('allowed', 'logic.col.allowed', 'mono'),
    C('minIntervalMs', 'logic.col.minInterval', 'rt', 'ms'),
    C('maxPerHour', 'logic.col.maxPerHour', 'rt'),
    C('used', 'logic.col.used', 'mono'),
  ],
};

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** "T2–T7 06:00–18:00": ngày liền nhau gộp thành khoảng. */
export function windowText(w: { days: number[]; from: string; to: string }): string {
  const d = [...new Set(w.days)].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j]! + 1) j++;
    parts.push(
      j - i >= 2
        ? `${DAYS[d[i]! - 1]}–${DAYS[d[j]! - 1]}`
        : d
            .slice(i, j + 1)
            .map((x) => DAYS[x - 1])
            .join(', '),
    );
    i = j + 1;
  }
  return `${parts.join(', ')} ${w.from}–${w.to}`;
}

const dash = html`<span class="muted">—</span>`;

function cellValue(
  app: StudioApp,
  doc: LogicDoc,
  kind: LogicKind,
  b: Block,
  col: Col,
  tags: Map<string, TagV1>,
) {
  const v = b[col.key];
  if (col.cls === 'bool') {
    const on = col.key === 'enabled' || col.key === 'retain' ? v !== false : v === true;
    return html`<input
      type="checkbox"
      .checked=${on}
      ?disabled=${app.store.state.readOnly}
      aria-label=${`${t(col.label)} ${b.id}`}
      @click=${(e: Event) => e.stopPropagation()}
      @change=${(e: Event) =>
        editLogic(
          app,
          updateBlock(doc, kind, b.id, { [col.key]: (e.target as HTMLInputElement).checked }),
        )}
    />`;
  }
  if (col.cls === 'acts') return actionsShort(v as LogicAction[] | undefined, doc);
  if (kind === 'schedule' && col.key === 'weekly') {
    const list = (v as Array<{ days: number[]; from: string; to: string }> | undefined) ?? [];
    return list.length ? list.map(windowText).join('; ') : dash;
  }
  if (kind === 'schedule' && col.key === 'exceptions') {
    const list = (v as Array<{ date: string; mode: string }> | undefined) ?? [];
    return list.length
      ? list
          .map((x) => `${x.date} ${x.mode === 'on' ? t('logic.exc.on') : t('logic.exc.off')}`)
          .join('; ')
      : dash;
  }
  if (kind === 'schedule' && col.key === 'tzOffsetMin')
    return typeof v === 'number' ? String(v) : t('logic.tz.device');
  if (kind === 'writes' && col.key === 'type') return tags.get(String(b.tag))?.type ?? dash;
  if (kind === 'writes' && col.key === 'allowed')
    return allowedText(b.allowed as Parameters<typeof allowedText>[0]);
  if (kind === 'writes' && col.key === 'used') {
    const used = writesUsage(doc).get(b.id) ?? [];
    return used.length ? used.join(', ') : html`<span class="muted">${t('logic.unused')}</span>`;
  }
  if (v === undefined || v === null || v === '') return dash;
  if (typeof v === 'number') return num(v);
  return String(v);
}

function liveCells(kind: LogicKind, st: LogicBlockStatus | undefined): TemplateResult {
  if (kind === 'writes') return html``;
  const state = st ? stateChip(st.state, st.reason) : dash;
  if (kind === 'rule')
    return html`<td class="live-col">${state}</td>
      <td class="live-col mono">${st?.lastFired ?? '—'}</td>
      <td class="live-col rt">${st?.fired ?? '—'}</td>`;
  const outs = st?.outputs
    ? Object.entries(st.outputs)
        .map(([k, v]) => `${k.split('.').pop()} = ${typeof v === 'number' ? num(v) : String(v)}`)
        .join(' · ')
    : '—';
  return html`<td class="live-col">${state}</td>
    <td class="live-col mono">${outs}</td>`;
}

function liveHeads(kind: LogicKind): TemplateResult {
  if (kind === 'writes') return html``;
  if (kind === 'rule')
    return html`<th class="live-col" scope="col">${t('logic.live.state')}</th>
      <th class="live-col" scope="col">${t('logic.live.lastFired')}</th>
      <th class="live-col" scope="col">${t('logic.live.fired')}</th>`;
  return html`<th class="live-col" scope="col">${t('logic.live.state')}</th>
    <th class="live-col" scope="col">${t('logic.live.value')}</th>`;
}

const matches = (b: Block, q: string): boolean => {
  if (!q) return true;
  const s = q.toLowerCase();
  return JSON.stringify(b).toLowerCase().includes(s);
};

/** Bảng khối của nhóm `kind`. */
export function rulesTable(app: StudioApp, kind: LogicKind): TemplateResult {
  const doc = logicDoc(app)!;
  const ui = logicUi(app);
  const marks = cellMarks(app);
  const tags = new Map(projectTags(app).map((x) => [x.id, x]));
  const sel = selectedId(app, kind);
  const cols = COLUMNS[kind];
  const live = ui.live;
  const all = blocksOf(doc, kind);
  const shown = all.filter(
    (b) =>
      matches(b, ui.search) &&
      (!ui.onlyErr || cols.some((c) => marks.has(`${b.id}|${c.key}`)) || marks.has(`${b.id}|id`)),
  );
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = shown[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    select(app, kind, next.id);
    void Promise.resolve().then(() =>
      (e.currentTarget as HTMLElement | null)?.parentElement
        ?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(next.id)}"]`)
        ?.focus(),
    );
  };
  return html`<table
    class="grid lg-grid"
    aria-label=${t('logic.table', { kind: t(`logic.kind.${kind}` as MessageKey) })}
  >
    <thead>
      <tr>
        <th scope="col" class="rn">#</th>
        ${cols.map(
          (c) =>
            html`<th scope="col">
              ${t(c.label)}${c.sub ? html` <small>${c.sub}</small>` : nothing}
            </th>`,
        )}
        ${live ? liveHeads(kind) : nothing}
      </tr>
    </thead>
    <tbody>
      ${shown.map((b, i) => {
        const isSel = b.id === sel;
        return html`<tr
          data-id=${b.id}
          class="${isSel ? 'sel' : ''} ${b.enabled === false ? 'dis' : ''}"
          tabindex=${isSel ? 0 : -1}
          aria-selected=${isSel ? 'true' : 'false'}
          @click=${() => select(app, kind, b.id)}
          @keydown=${(e: KeyboardEvent) => onKey(e, i)}
        >
          <td class="rn">${all.indexOf(b) + 1}</td>
          ${cols.map((c) => {
            const m =
              marks.get(`${b.id}|${c.key}`) ??
              (c.key === 'id' ? marks.get(`${b.id}|id`) : undefined);
            const cls = `${m === 'e' ? 'cerr' : m === 'w' ? 'cwarn' : ''} ${c.cls === 'ex' ? 'ex' : c.cls === 'mono' ? 'mono' : c.cls === 'rt' ? 'rt' : ''}`;
            return html`<td
              data-f=${c.key}
              class=${cls}
              title=${m ? t(m === 'e' ? 'logic.cell.err' : 'logic.cell.warn') : nothing}
            >
              ${m ? icon(m === 'e' ? 'err' : 'warn', 'sm') : nothing}${cellValue(app, doc, kind, b, c, tags)}
            </td>`;
          })}
          ${live ? liveCells(kind, live.blocks.get(b.id)) : nothing}
        </tr>`;
      })}
      ${
        shown.length === 0
          ? html`<tr>
              <td class="muted empty-row" colspan=${cols.length + 1}>
                ${all.length ? t('logic.table.noMatch') : t('logic.table.empty')}
              </td>
            </tr>`
          : nothing
      }
    </tbody>
  </table>`;
}
