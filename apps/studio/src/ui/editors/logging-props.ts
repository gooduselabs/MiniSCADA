// Inspector › Thuộc tính của nhóm lưu trữ đang chọn (feature 010, T120, contracts/studio-010.md §1.1): năm nhóm Chung, Chế độ,
// Lưu trữ, Đích, Tổng hợp; trường theo chế độ (chu kỳ / khoảng tối thiểu và tối đa / Tag kích hoạt, cạnh, ngưỡng). Chữ gõ xong
// (sự kiện `change`) mới áp: mỗi lần là MỘT sửa đổi `{ kind: 'logging' }`. Chỉ đọc khi chưa phải định dạng 0.6.
import { html, nothing, type TemplateResult } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { bucketLoggingIssues } from '../../model/logging-issues.ts';
import { formatMs, parseDuration } from '../../model/logging-grid.ts';
import { toggleDestination } from '../../model/logging-conn.ts';
import {
  applicable,
  displayModeOf,
  mapGroup,
  setAggregates,
  setDisplayMode,
  setGroupField,
  setTrigger,
  tagTypesOf,
  type DisplayMode,
} from '../../model/logging-doc.ts';
import type { LoggingConfig, LoggingGroup } from '@mat/project-schema';
import { registerProps } from '../registry.ts';

const MODES: readonly DisplayMode[] = ['cyclic', 'onChange', 'combined', 'trigger'];
const EDGES = ['rising', 'falling', 'both', 'active'] as const;

const parseCount = (s: string): number | null => {
  const x = s.trim();
  return /^\d+$/.test(x) ? Number(x) : null;
};

/** Ô nhập chữ: áp khi `change` (rời ô hoặc Enter), bỏ qua phím khi bộ gõ đang ghép chữ. */
function input(
  name: string,
  value: string,
  o: { mono?: boolean; disabled?: boolean; list?: string; placeholder?: string },
  commit: (text: string) => void,
) {
  return html`<input
    class="lgp-in ${o.mono ? 'mono' : ''}"
    type="text"
    data-field=${name}
    autocomplete="off"
    spellcheck="false"
    list=${o.list ?? nothing}
    placeholder=${o.placeholder ?? ''}
    ?disabled=${o.disabled}
    .value=${value}
    @change=${(e: Event) => commit((e.target as HTMLInputElement).value)}
    @keydown=${(e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
    }}
  />`;
}

function select(
  name: string,
  value: string,
  options: ReadonlyArray<[string, string]>,
  disabled: boolean,
  commit: (v: string) => void,
) {
  return html`<select
    class="lgp-in"
    data-field=${name}
    ?disabled=${disabled}
    @change=${(e: Event) => commit((e.target as HTMLSelectElement).value)}
  >
    ${options.map(([v, label]) => html`<option value=${v} ?selected=${v === value}>${label}</option>`)}
  </select>`;
}

function row(label: string, name: string, control: unknown, help?: string): TemplateResult {
  return html`<div class="lgp-row">
    <label class="lgp-l" for=${`lgp-${name}`}>${label}</label>
    <div class="lgp-v" id=${`lgp-${name}`}>${control}</div>
    ${help ? html`<div class="lgp-help">${help}</div>` : nothing}
  </div>`;
}

const section = (title: string, ...rows: unknown[]) =>
  html`<section class="lgp-sec"><h4>${title}</h4>${rows}</section>`;

export function groupInspector(app: StudioApp, index: number) {
  const s = app.store.state;
  const cfg = s.outline.logging;
  const g: LoggingGroup | undefined = cfg?.groups[index];
  if (!cfg || !g) return null;
  const ro = s.readOnly || !s.outline.format06;
  const mode = displayModeOf(g);
  const types = tagTypesOf(s.outline.tags);
  const apply = (next: LoggingConfig): void => {
    if (next !== cfg) app.store.edit([{ kind: 'logging', value: next }]);
  };
  const dur = (name: string, field: 'periodMs' | 'minIntervalMs' | 'maxIntervalMs', value: number | undefined, help?: string) =>
    row(
      t(`hist.insp.${field}`),
      name,
      input(name, value === undefined ? '' : formatMs(value), { disabled: ro, mono: true }, (txt) => {
        const ms = parseDuration(txt);
        if (ms !== null) apply(setGroupField(cfg, index, field, ms));
        else app.toast(t('hist.err.duration'));
      }),
      help,
    );
  const tr = g.trigger;
  const chung = section(
    t('hist.insp.general'),
    row(t('hist.col.id'), 'id', input('id', g.id, { disabled: ro, mono: true }, (v) => apply(setGroupField(cfg, index, 'id', v.trim())))),
    row(t('hist.col.name'), 'name', input('name', g.name, { disabled: ro }, (v) => apply(setGroupField(cfg, index, 'name', v.trim())))),
    row(
      t('hist.insp.table'),
      'table',
      input('table', g.table ?? '', { disabled: ro, mono: true, placeholder: t('hist.insp.tableAuto') }, (v) =>
        apply(setGroupField(cfg, index, 'table', v.trim() === '' ? undefined : v.trim())),
      ),
      t('hist.insp.tableHelp'),
    ),
  );
  const modeSec = section(
    t('hist.insp.mode'),
    row(
      t('hist.col.mode'),
      'mode',
      select('mode', mode, MODES.map((m) => [m, t(`hist.mode.${m}`)]), ro, (v) =>
        apply(mapGroup(cfg, index, (x) => setDisplayMode(x, v as DisplayMode))),
      ),
      t(`hist.mode.help.${mode}`),
    ),
    mode === 'cyclic' ? dur('periodMs', 'periodMs', g.periodMs) : nothing,
    mode === 'onChange' || mode === 'combined' || mode === 'trigger'
      ? dur('minIntervalMs', 'minIntervalMs', g.minIntervalMs ?? 1000)
      : nothing,
    mode === 'combined' ? dur('maxIntervalMs', 'maxIntervalMs', g.maxIntervalMs) : nothing,
    mode === 'trigger'
      ? html`${row(
          t('hist.insp.triggerTag'),
          'trigger.tagId',
          html`${input('trigger.tagId', tr?.tagId ?? '', { disabled: ro, mono: true, list: 'lgp-tags' }, (v) =>
              apply(mapGroup(cfg, index, (x) => setTrigger(x, { tagId: v.trim() }))),
            )}<datalist id="lgp-tags">${[...types.keys()].map((id) => html`<option value=${id}></option>`)}</datalist>`,
          t('hist.insp.triggerTagHelp'),
        )}
        ${row(
          t('hist.insp.edge'),
          'trigger.edge',
          select('trigger.edge', tr?.edge ?? 'rising', EDGES.map((e) => [e, t(`hist.edge.${e}`)]), ro, (v) =>
            apply(mapGroup(cfg, index, (x) => setTrigger(x, { edge: v as (typeof EDGES)[number] }))),
          ),
        )}
        ${row(
          t('hist.insp.threshold'),
          'trigger.threshold',
          input('trigger.threshold', tr?.threshold === undefined ? '' : String(tr.threshold), { disabled: ro, mono: true }, (v) => {
            const txt = v.trim().replace(',', '.');
            if (txt === '') apply(mapGroup(cfg, index, (x) => setTrigger(x, { threshold: undefined })));
            else if (Number.isFinite(Number(txt)))
              apply(mapGroup(cfg, index, (x) => setTrigger(x, { threshold: Number(txt) })));
            else app.toast(t('hist.err.number'));
          }),
          t('hist.insp.thresholdHelp'),
        )}
        ${tr?.edge === 'active' ? dur('periodMs', 'periodMs', g.periodMs) : nothing}`
      : nothing,
  );
  const store = section(
    t('hist.insp.storage'),
    row(
      t('hist.col.retention'),
      'retentionDays',
      input('retentionDays', String(g.retentionDays ?? ''), { disabled: ro, mono: true }, (v) => {
        const n = parseCount(v);
        if (n === null) app.toast(t('hist.err.int'));
        else apply(setGroupField(cfg, index, 'retentionDays', n));
      }),
    ),
    mode !== 'cyclic'
      ? row(
          t('hist.insp.expected'),
          'expectedRowsPerDay',
          input('expectedRowsPerDay', g.expectedRowsPerDay === undefined ? '' : String(g.expectedRowsPerDay), { disabled: ro, mono: true }, (v) => {
            if (v.trim() === '') return apply(setGroupField(cfg, index, 'expectedRowsPerDay', undefined));
            const n = parseCount(v);
            if (n === null || n < 1) app.toast(t('hist.err.int'));
            else apply(setGroupField(cfg, index, 'expectedRowsPerDay', n));
          }),
          t('hist.insp.expectedHelp'),
        )
      : nothing,
  );
  const conns = cfg.connections ?? [];
  const dest = section(
    t('hist.insp.dest'),
    conns.length === 0
      ? html`<p class="lgp-help">${t('hist.insp.destNone')}</p>`
      : conns.map(
          (c) => html`<label class="lgp-chk">
            <input
              type="checkbox"
              data-dest=${c.id}
              ?disabled=${ro}
              .checked=${(g.destinations ?? []).includes(c.id)}
              @click=${(e: Event) => apply(toggleDestination(cfg, index, c.id, (e.target as HTMLInputElement).checked))}
            />
            <span class="mono">${c.id}</span>
          </label>`,
        ),
    html`<p class="lgp-help">${t('hist.insp.destHelp')}</p>`,
  );
  const aggOn = g.aggregates !== undefined;
  const eligible = g.tags.filter((x) => applicable(types.get(x.tagId), 'aggregate'));
  const aggTags = eligible.filter((x) => x.aggregate !== false).length;
  const agg = section(
    t('hist.insp.agg'),
    html`<label class="lgp-chk">
      <input
        type="checkbox"
        data-field="aggregates"
        ?disabled=${ro}
        .checked=${aggOn}
        @click=${(e: Event) => apply(setAggregates(cfg, index, (e.target as HTMLInputElement).checked))}
      />
      <span>${t('hist.insp.aggOn')}</span>
    </label>`,
    aggOn
      ? html`${(['minuteRetentionDays', 'hourRetentionDays'] as const).map((k) =>
            row(
              t(`hist.insp.${k}`),
              `aggregates.${k}`,
              input(`aggregates.${k}`, g.aggregates?.[k] === undefined ? '' : String(g.aggregates[k]), { disabled: ro, mono: true, placeholder: t(`hist.insp.${k}Default`) }, (v) => {
                if (v.trim() === '') return apply(setAggregates(cfg, index, true, { [k]: undefined }));
                const n = parseCount(v);
                if (n === null || n < 1) app.toast(t('hist.err.int'));
                else apply(setAggregates(cfg, index, true, { [k]: n }));
              }),
            ),
          )}
          <p class="lgp-help" data-role="agg-count">${t('hist.insp.aggCount', { n: aggTags, m: eligible.length })}</p>`
      : html`<p class="lgp-help">${t('hist.insp.aggHelp')}</p>`,
  );
  // Lỗi và cảnh báo của nhóm: chưa biết ô thì liệt kê ở đây để không mất (FR-054).
  const b = bucketLoggingIssues(s.issues, s.outline.loggingFile);
  const mine = [
    ...[...b.groupCells.entries(), ...b.groupWarns.entries()].filter(([k]) => k.startsWith(`${index}:`)).flatMap(([, v]) => v),
    ...[...(b.tagCells.get(index)?.values() ?? []), ...(b.tagWarns.get(index)?.values() ?? [])].flat(),
  ];
  const issues = mine.length
    ? html`<section class="lgp-sec" data-role="group-issues">
        <h4>${t('hist.insp.issues')}</h4>
        <ul class="lgp-issues">
          ${mine.map((i) => html`<li class=${i.code.startsWith('E_') ? 'err' : 'warn'}><span class="mono">${i.code}</span> ${i.message}</li>`)}
        </ul>
      </section>`
    : nothing;
  return html`<div class="lgp">
    ${ro ? html`<p class="lgp-help" role="status">${t('hist.insp.readOnly')}</p>` : nothing}
    ${chung}${modeSec}${store}${dest}${agg}${issues}
  </div>`;
}

registerProps((app: StudioApp) => {
  const s = app.store.state;
  const sel = s.selection;
  if (sel?.kind !== 'group') return null;
  const g = s.outline.logging?.groups[sel.index];
  if (!g) return null;
  const body = groupInspector(app, sel.index);
  if (!body) return null;
  return { ctx: t('hist.insp.ctx', { name: g.name }), body };
});
