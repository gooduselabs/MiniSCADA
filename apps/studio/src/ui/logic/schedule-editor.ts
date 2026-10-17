// Inspector của khối Lịch (feature 011, T144; contracts/logic-engine.md §7; mockup studio-logic.html cảnh 1): Chung (id, đầu
// ra, múi giờ theo thiết bị hoặc đặt riêng `tzOffsetMin`), khung hằng tuần (ngày T2…CN, từ, đến; nửa mở [từ, đến), từ > đến
// là qua nửa đêm) kèm thanh tuần, ngoại lệ theo ngày (bật hoặc tắt cả ngày). Giới hạn 16 khung, 64 ngoại lệ.
import { LOGIC_LIMITS, type LogicSchedule } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { t } from '../../i18n/index.ts';
import { icon } from '../base.ts';
import {
  frow,
  group,
  idInput,
  liveRows,
  parseNumber,
  patch,
  textInput,
  type FieldCtx,
} from './fields.ts';
import { KIND_ICON } from './logic-parts.ts';

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const toMin = (s: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

type Window = LogicSchedule['weekly'][number];

/** Đoạn [trái %, rộng %] của các khung trên thanh của ngày `d` (1 là thứ Hai). */
function segments(weekly: readonly Window[], d: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const prev = d === 1 ? 7 : d - 1;
  for (const w of weekly) {
    const a = toMin(w.from);
    const b = toMin(w.to);
    if (a === null || b === null || a === b) continue;
    if (a < b) {
      if (w.days.includes(d)) out.push([a, b - a]);
    } else {
      if (w.days.includes(d)) out.push([a, 1440 - a]);
      if (w.days.includes(prev) && b > 0) out.push([0, b]);
    }
  }
  return out.map(([l, w]) => [(l / 1440) * 100, Math.max(0.6, (w / 1440) * 100)]);
}

export function scheduleInspector(c: FieldCtx): TemplateResult {
  const s = c.b as unknown as LogicSchedule;
  const weekly = s.weekly ?? [];
  const exc = s.exceptions ?? [];
  const setWeekly = (next: Window[]) => patch(c, { weekly: next });
  const setExc = (next: Array<{ date: string; mode: string }>) => patch(c, { exceptions: next });
  const custom = typeof s.tzOffsetMin === 'number';
  const windowRow = (w: Window, i: number) =>
    html`<div class="win-row" data-w=${i}>
      <span class="days" role="group" aria-label=${t('logic.sch.days', { n: i + 1 })}>
        ${DAYS.map(
          (d, k) =>
            html`<label class="day"
              ><input
                type="checkbox"
                data-day="${i}:${k + 1}"
                ?disabled=${c.ro}
                .checked=${w.days.includes(k + 1)}
                @change=${(e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const days = on
                    ? [...new Set([...w.days, k + 1])].sort((a, b) => a - b)
                    : w.days.filter((x) => x !== k + 1);
                  setWeekly(weekly.map((x, j) => (j === i ? { ...x, days } : x)));
                }}
              />${d}</label
            >`,
        )}
      </span>
      <span class="row">
        ${t('logic.sch.from')}
        <input
          class="input sm mono hhmm"
          data-window="${i}:from"
          aria-label=${t('logic.sch.fromN', { n: i + 1 })}
          ?readonly=${c.ro}
          .value=${w.from}
          @change=${(e: Event) =>
            setWeekly(
              weekly.map((x, j) =>
                j === i ? { ...x, from: (e.target as HTMLInputElement).value.trim() } : x,
              ),
            )}
        />
        ${t('logic.sch.to')}
        <input
          class="input sm mono hhmm"
          data-window="${i}:to"
          aria-label=${t('logic.sch.toN', { n: i + 1 })}
          ?readonly=${c.ro}
          .value=${w.to}
          @change=${(e: Event) =>
            setWeekly(
              weekly.map((x, j) =>
                j === i ? { ...x, to: (e.target as HTMLInputElement).value.trim() } : x,
              ),
            )}
        />
        <button
          type="button"
          class="ibtn sm"
          ?disabled=${c.ro}
          aria-label=${t('logic.sch.delWindow', { n: i + 1 })}
          @click=${() => setWeekly(weekly.filter((_, j) => j !== i))}
        >
          ${icon('x')}
        </button>
      </span>
    </div>`;
  const general = group(
    KIND_ICON.schedule,
    t('logic.g.general'),
    html`${idInput(c)}
      ${textInput(c, 'out', t('logic.f.out'), { mono: true, title: t('logic.f.outTip') })}
      ${frow(
        t('logic.sch.tz'),
        html`<select
          class="select sm"
          data-field="tzMode"
          aria-label=${t('logic.sch.tz')}
          ?disabled=${c.ro}
          @change=${(e: Event) =>
            patch(c, {
              tzOffsetMin: (e.target as HTMLSelectElement).value === 'custom' ? 420 : undefined,
            })}
        >
          <option value="device" ?selected=${!custom}>${t('logic.sch.tzDevice')}</option>
          <option value="custom" ?selected=${custom}>${t('logic.sch.tzCustom')}</option>
        </select>`,
      )}
      ${
        custom
          ? frow(
              t('logic.sch.tzMin'),
              html`<input
                class="input sm num"
                data-field="tzOffsetMin"
                aria-label=${t('logic.sch.tzMin')}
                inputmode="numeric"
                ?readonly=${c.ro}
                .value=${String(s.tzOffsetMin)}
                @change=${(e: Event) => {
                  const n = parseNumber((e.target as HTMLInputElement).value, true);
                  if (n !== null) patch(c, { tzOffsetMin: n });
                }}
              />`,
            )
          : nothing
      }
      ${liveRows(c)}
      <p class="help">${t('logic.sch.help')}</p>`,
  );
  const frames = group(
    'cal',
    t('logic.sch.weekly'),
    html`${weekly.map(windowRow)}
      <button
        type="button"
        class="addact"
        data-act="add-window"
        ?disabled=${c.ro || weekly.length >= LOGIC_LIMITS.windows}
        @click=${() => setWeekly([...weekly, { days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }])}
      >
        ${icon('plus', 'sm')}${t('logic.sch.addWindow')}
      </button>
      <div class="week" aria-hidden="true">
        ${DAYS.map(
          (d, k) =>
            html`<span>${d}</span>
              <div class="bar">
                ${segments(weekly, k + 1).map(
                  ([l, w]) =>
                    html`<i
                      style=${styleMap({ left: `${l.toFixed(2)}%`, width: `${w.toFixed(2)}%` })}
                    ></i>`,
                )}
              </div>`,
        )}
        <span></span>
        <div class="ax">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
      <p class="help">${t('logic.sch.windowHelp')}</p>`,
    `${weekly.length} / ${LOGIC_LIMITS.windows}`,
  );
  const exceptions = group(
    'cal',
    t('logic.sch.exceptions'),
    html`<div data-role="exceptions" class="acts">
        ${
          exc.length === 0
            ? html`<p class="help">${t('logic.sch.noExc')}</p>`
            : exc.map(
                (x, i) =>
                  html`<div class="act exc">
                    <span class="n">${i + 1}</span>
                    <input
                      class="input sm mono"
                      data-exc="${i}:date"
                      aria-label=${t('logic.sch.excDate', { n: i + 1 })}
                      placeholder="YYYY-MM-DD"
                      ?readonly=${c.ro}
                      .value=${x.date}
                      @change=${(e: Event) =>
                        setExc(
                          exc.map((y, j) =>
                            j === i
                              ? { ...y, date: (e.target as HTMLInputElement).value.trim() }
                              : y,
                          ),
                        )}
                    />
                    <select
                      class="select sm"
                      data-exc="${i}:mode"
                      aria-label=${t('logic.sch.excMode', { n: i + 1 })}
                      ?disabled=${c.ro}
                      @change=${(e: Event) =>
                        setExc(
                          exc.map((y, j) =>
                            j === i ? { ...y, mode: (e.target as HTMLSelectElement).value } : y,
                          ),
                        )}
                    >
                      <option value="off" ?selected=${x.mode === 'off'}>
                        ${t('logic.exc.off')}
                      </option>
                      <option value="on" ?selected=${x.mode === 'on'}>${t('logic.exc.on')}</option>
                    </select>
                    <button
                      type="button"
                      class="ibtn sm"
                      ?disabled=${c.ro}
                      aria-label=${t('logic.sch.delExc', { n: i + 1 })}
                      @click=${() => setExc(exc.filter((_, j) => j !== i))}
                    >
                      ${icon('x')}
                    </button>
                  </div>`,
              )
        }
      </div>
      <button
        type="button"
        class="addact"
        data-act="add-exception"
        ?disabled=${c.ro || exc.length >= LOGIC_LIMITS.exceptions}
        @click=${() => setExc([...exc, { date: '2026-12-31', mode: 'off' }])}
      >
        ${icon('plus', 'sm')}${t('logic.sch.addExc')}
      </button>`,
    `${exc.length} / ${LOGIC_LIMITS.exceptions}`,
  );
  return html`<div class="insp3">${general}${frames}${exceptions}</div>`;
}
