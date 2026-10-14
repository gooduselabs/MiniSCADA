// Panel Thử alarm (feature 009, T080, FR-080; SC-017; contract studio-alarm-editor §7; mockup studio-alarms.html cảnh 3): chạy bản TS
// của động cơ alarm (`@mat/alarm-engine` qua `AlarmSim`) với Tag mô phỏng của 006 trên đồng hồ ảo (1×, 5×, 20×; mỗi tick ảo 250 ms),
// bảng Nguồn (Mô phỏng hoặc Nhập tay, quality), bảng alarm đang có dùng chung `<mat-alarm-table>` với trang vận hành (ack và tạm ẩn
// thử), bật/tắt từng alarm, nhật ký chuyển trạng thái (lọc, sao chép TSV chống công thức). Không dùng thời gian thật cho trễ,
// không gọi thiết bị, không audit. Phím chỉ có hiệu lực khi panel có focus.
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { registerAlarmTable, type ActionHost } from '@mat/ui-components';
import { t, type MessageKey } from '../../i18n/index.ts';
import { alarmDocOf, type AlarmDoc } from '../../model/alarm-doc.ts';
import { invalidAlarmIds } from '../../model/alarm-preview.ts';
import {
  ALARM_SIM_SPEEDS,
  ALARM_SIM_TICK_MS,
  AlarmSim,
  type AlarmLogEntry,
  type AlarmSimSpeed,
} from '../../model/alarm-sim.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './alarm-editors.css';

/** Giờ ảo `mm:ss.sss`. */
export function clockText(ms: number, decimals = 3): string {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = String(total % 1000)
    .padStart(3, '0')
    .slice(0, decimals);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${decimals > 0 ? `.${frac}` : ''}`;
}

/** Chi tiết thô của nhật ký (`85 / 80 · 1000 ms · #2`) thành câu tiếng Việt. */
export function detailText(raw: string): string {
  const m = /^(\S+) \/ (\S+) · (\d+) ms · #\d+$/.exec(raw);
  if (m)
    return t('alarm.test.detail.value', {
      value: m[1]!,
      limit: m[2]!,
      delay: String(Math.round(Number(m[3]) / 100) / 10),
    });
  const d = /^(\S+) · (\d+) ms · #\d+$/.exec(raw);
  if (d)
    return t('alarm.test.detail.valueDelay', {
      value: d[1]!,
      delay: String(Math.round(Number(d[2]) / 100) / 10),
    });
  const v = /^(\S+) \/ (\S+)/.exec(raw);
  return v ? t('alarm.test.detail.valueOnly', { value: v[1]! }) : raw;
}

/** Ô chữ chống công thức khi sao chép nhật ký (TSV): thêm nháy đơn trước ký tự công thức. */
const safeCell = (s: string): string =>
  (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/[\t\r\n]+/g, ' ');

interface Note {
  t: number;
  text: string;
}

export class AlarmTestPanel extends AppElement {
  static override properties = {
    running: { state: true },
    tick: { state: true },
    instanceFilter: { state: true },
    search: { state: true },
    selected: { state: true },
  };

  declare running: boolean;
  declare tick: number;
  declare instanceFilter: string;
  declare search: string;
  declare selected: string;

  private sim: AlarmSim | null = null;
  private offSim: (() => void) | null = null;
  private simKey: unknown[] | null = null;
  private timer: unknown = null;
  private notes: Note[] = [];
  private skipped: Array<{ id: string; code: string; row: number }> = [];
  private disabled = new Set<string>();

  constructor() {
    super();
    this.running = false;
    this.tick = 0;
    this.instanceFilter = '';
    this.search = '';
    this.selected = '';
    registerAlarmTable();
  }

  // ---------- Dữ liệu và động cơ ----------

  private doc(): AlarmDoc {
    const o = this.app.store.state.outline;
    return alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
  }

  /** Dựng lại động cơ khi định nghĩa, Tag hoặc lỗi đổi (giữ tốc độ và trạng thái chạy). */
  private ensureSim(): AlarmSim | null {
    const s = this.app.store.state;
    const o = s.outline;
    const key = [o.alarms, o.alarmClasses, o.tags, o.valueTables, s.issues];
    if (this.simKey && this.simKey.every((k, i) => k === key[i]) && this.sim) return this.sim;
    const speed = this.sim?.speed ?? 1;
    this.offSim?.();
    this.offSim = null;
    this.simKey = key;
    this.notes = [];
    this.disabled = new Set();
    if (!o.alarms || o.alarms.alarms.length === 0) {
      this.sim = null;
      this.skipped = [];
      return null;
    }
    const doc = this.doc();
    this.skipped = invalidAlarmIds(s.issues, o.alarmFile, doc);
    try {
      this.sim = new AlarmSim({
        project: { alarms: doc.alarms, classes: doc.classes, areas: doc.areas },
        tags: (o.tags?.tags ?? []) as never,
        tables: o.valueTables.flatMap((v) => (v.doc ? [v.doc as never] : [])),
        skip: this.skipped.map((x) => x.id),
        user: t('alarm.test.user'),
      });
      this.sim.speed = speed;
      this.sim.run(1);
      // Ack, tạm ẩn, bật/tắt từ bảng alarm đổi trạng thái ngoài nhịp đồng hồ: vẽ lại theo nguồn.
      this.offSim = this.sim.source().subscribe(() => this.tick++);
    } catch {
      this.sim = null;
    }
    return this.sim;
  }

  private host(sim: AlarmSim): ActionHost {
    return {
      session: () => ({ user: t('alarm.test.user'), role: 'operator' }),
      writeBlocked: () => null,
      write: () => Promise.resolve({ status: 'REJECTED' }),
      navigate: () => undefined,
      openPopup: () => undefined,
      closePopup: () => undefined,
      requestLogin: () => undefined,
      ...sim.alarmActions(),
    } as ActionHost;
  }

  // ---------- Vòng đời ----------

  protected override attached(): void {
    const app = this.app;
    const set = (id: Parameters<typeof app.setCommandHandler>[0], fn: () => void) =>
      app.setCommandHandler(id, fn);
    set('alarm.test.run', () => this.toggleRun());
    set('alarm.test.step', () => this.step());
    set('alarm.test.reset', () => this.reset());
    set('alarm.test.speed1', () => this.setSpeed(1));
    set('alarm.test.speed5', () => this.setSpeed(5));
    set('alarm.test.speed20', () => this.setSpeed(20));
    this.requestUpdate();
  }

  protected override detached(): void {
    this.stop();
    this.offSim?.();
    this.offSim = null;
    this.simKey = null;
    for (const id of [
      'alarm.test.run',
      'alarm.test.step',
      'alarm.test.reset',
      'alarm.test.speed1',
      'alarm.test.speed5',
      'alarm.test.speed20',
    ] as const)
      this.app.setCommandHandler(id, null);
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  private start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.sim?.advanceRealMs(ALARM_SIM_TICK_MS);
      this.tick++;
    }, ALARM_SIM_TICK_MS);
    this.running = true;
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer as ReturnType<typeof setInterval>);
    this.timer = null;
    if (this.running) this.running = false;
  }

  private toggleRun(): void {
    if (this.running) this.stop();
    else this.start();
  }

  private step(): void {
    this.stop();
    this.sim?.step();
    this.tick++;
  }

  private reset(): void {
    this.stop();
    this.sim?.reset();
    this.notes = [];
    this.disabled = new Set();
    this.tick++;
  }

  private restart(): void {
    this.sim?.restart();
    this.tick++;
  }

  private setSpeed(s: AlarmSimSpeed): void {
    if (this.sim) this.sim.speed = s;
    this.tick++;
  }

  private onKey = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement;
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (
      tgt instanceof HTMLInputElement ||
      tgt instanceof HTMLTextAreaElement ||
      tgt instanceof HTMLSelectElement
    )
      return;
    if (tgt instanceof HTMLButtonElement && e.key === ' ') return;
    const k = e.key;
    if (k === ' ') this.toggleRun();
    else if (k === '.') this.step();
    else if (k === 'r' || k === 'R') this.reset();
    else if (k === '1') this.setSpeed(1);
    else if (k === '2') this.setSpeed(5);
    else if (k === '3') this.setSpeed(20);
    else return;
    e.preventDefault();
  };

  // ---------- Nguồn Tag ----------

  private noteManual(tag: string, value: number | string): void {
    const shown = typeof value === 'number' ? String(Math.round(value * 100) / 100) : value;
    this.notes.push({
      t: this.sim?.virtualNowMs ?? 0,
      text: t('alarm.test.manualSet', { tag, value: shown }),
    });
  }

  private setMode(tag: string, manual: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    if (manual) {
      const cur = sim.sampleOf(tag);
      sim.setManual(tag, { value: cur.value, quality: 'GOOD' });
    } else sim.clearManual(tag);
    this.tick++;
  }

  private setValue(tag: string, value: number): void {
    const sim = this.sim;
    if (!sim || !Number.isFinite(value)) return;
    const cur = sim.manualOf(tag) ?? { value: 0, quality: 'GOOD' as const };
    sim.setManual(tag, { ...cur, value });
    this.noteManual(tag, value);
    this.tick++;
  }

  private setQuality(tag: string, quality: 'GOOD' | 'UNCERTAIN' | 'BAD', reason?: string): void {
    const sim = this.sim;
    if (!sim) return;
    const cur = sim.manualOf(tag) ?? { value: sim.sampleOf(tag).value, quality: 'GOOD' as const };
    const next = {
      ...cur,
      quality,
      ...(quality === 'GOOD' ? {} : { reason: reason ?? cur.reason ?? 'TIMEOUT' }),
    };
    if (quality === 'GOOD') delete (next as { reason?: string }).reason;
    sim.setManual(tag, next);
    this.noteManual(tag, quality);
    this.tick++;
  }

  private tagInfo(tag: string) {
    const x = (this.app.store.state.outline.tags?.tags ?? []).find(
      (y) => (y as { id?: string }).id === tag,
    ) as
      | {
          type?: string;
          min?: number;
          max?: number;
          unit?: string;
          limits?: { min?: number; max?: number };
        }
      | undefined;
    return {
      bool: x?.type === 'BOOL',
      min: x?.min ?? x?.limits?.min,
      max: x?.max ?? x?.limits?.max,
      unit: x?.unit ?? '',
    };
  }

  /** "Vượt ngưỡng H" và "Về bình thường" cho alarm ngưỡng đang chọn. */
  private quickPush(
    def: { tag?: string; limits?: Record<string, { value: number }>; deadband?: number },
    over: boolean,
  ): void {
    if (!def.tag || !def.limits) return;
    const h = def.limits.H?.value ?? def.limits.HH?.value;
    const l = def.limits.L?.value ?? def.limits.LL?.value;
    const db = def.deadband ?? 0;
    let v: number;
    if (over) v = (h ?? l ?? 0) + (db > 0 ? db / 2 + 0.5 : 1);
    else if (h !== undefined && l !== undefined) v = (h + l) / 2;
    else if (h !== undefined) v = h - Math.max(db * 2, 1);
    else v = (l ?? 0) + Math.max(db * 2, 1);
    this.setValue(def.tag, Math.round(v * 100) / 100);
  }

  private async toggleEnabled(defId: string, on: boolean): Promise<void> {
    const sim = this.sim;
    if (!sim) return;
    const ids = sim
      .snapshot()
      .instances.filter((i) => i.alarmId === defId)
      .map((i) => i.id);
    for (const id of ids) await sim.setEnabled(id, on);
    if (on) this.disabled.delete(defId);
    else this.disabled.add(defId);
    this.tick++;
  }

  // ---------- Nhật ký ----------

  private logRows() {
    const sim = this.sim;
    if (!sim) return [];
    const q = this.search.trim().toLowerCase();
    type Row = { t: number; instance: string; change: string; reason: string; detail: string };
    const rows: Row[] = sim.log.map((l: AlarmLogEntry) => ({
      t: l.t,
      instance: l.instance,
      change: l.from === l.to ? '' : `${l.from} → ${l.to}`,
      reason: t(`alarm.test.reason.${l.reason}` as MessageKey),
      detail: detailText(l.detail),
    }));
    for (const n of this.notes)
      rows.push({ t: n.t, instance: '', change: '', reason: n.text, detail: '' });
    rows.sort((a, b) => a.t - b.t);
    return rows.filter(
      (r) =>
        (this.instanceFilter === '' || r.instance === this.instanceFilter) &&
        (q === '' || `${r.instance} ${r.change} ${r.reason} ${r.detail}`.toLowerCase().includes(q)),
    );
  }

  private async copyLog(): Promise<void> {
    const rows = this.logRows();
    const text = rows
      .map((r) =>
        [clockText(r.t), r.instance, r.change, r.reason, r.detail].map(safeCell).join('\t'),
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* không có quyền clipboard: bỏ qua */
    }
    this.app.toast(t('alarm.test.copied', { n: rows.length }));
  }

  private clearLog(): void {
    this.sim?.clearLog();
    this.notes = [];
    this.tick++;
  }

  // ---------- Vẽ ----------

  private sourcesCard(sim: AlarmSim) {
    const tags = sim.watchedTags();
    return html`<section class="al-card" data-role="sources">
      <h3>${icon('list', 'sm')}${t('alarm.test.sources')}</h3>
      <table class="al-t">
        <thead>
          <tr>
            <th>${t('alarm.test.col.tag')}</th>
            <th>${t('alarm.test.col.mode')}</th>
            <th>${t('alarm.test.col.value')}</th>
            <th>${t('alarm.test.quality')}</th>
          </tr>
        </thead>
        <tbody>
          ${tags.map((tag) => {
            const man = sim.manualOf(tag);
            const info = this.tagInfo(tag);
            const sample = sim.sampleOf(tag);
            return html`<tr data-tag=${tag}>
              <td class="mono">${tag}</td>
              <td>
                <select
                  class="select sm"
                  data-role="mode"
                  aria-label=${`${tag}: ${t('alarm.test.col.mode')}`}
                  @change=${(e: Event) => this.setMode(tag, (e.target as HTMLSelectElement).value === 'manual')}
                >
                  <option value="sim" ?selected=${!man}>${t('alarm.test.mode.sim')}</option>
                  <option value="manual" ?selected=${!!man}>${t('alarm.test.mode.manual')}</option>
                </select>
              </td>
              <td>
                ${
                  man
                    ? info.bool
                      ? html`<input
                          type="checkbox"
                          data-role="value"
                          aria-label=${`${tag}: ${t('alarm.test.col.value')}`}
                          .checked=${man.value !== 0}
                          @change=${(e: Event) => this.setValue(tag, (e.target as HTMLInputElement).checked ? 1 : 0)}
                        />`
                      : html`<input
                            class="input sm"
                            type="number"
                            data-role="value"
                            step="any"
                            aria-label=${`${tag}: ${t('alarm.test.col.value')}`}
                            .value=${live(String(man.value))}
                            @change=${(e: Event) => this.setValue(tag, Number((e.target as HTMLInputElement).value))}
                          />${
                            info.min !== undefined && info.max !== undefined
                              ? html`<input
                                  type="range"
                                  data-role="slider"
                                  min=${info.min}
                                  max=${info.max}
                                  step="any"
                                  aria-label=${`${tag}: ${t('alarm.test.col.value')}`}
                                  .value=${String(man.value)}
                                  @input=${(e: Event) => this.setValue(tag, Number((e.target as HTMLInputElement).value))}
                                />`
                              : nothing
                          }`
                    : html`<span class="mono"
                        >${sample.known === false ? '—' : String(Math.round(sample.value * 100) / 100)}${info.unit ? ` ${info.unit}` : ''}</span
                      >`
                }
              </td>
              <td>
                ${
                  man
                    ? html`<select
                          class="select sm"
                          data-role="quality"
                          aria-label=${`${tag}: ${t('alarm.test.quality')}`}
                          @change=${(e: Event) => this.setQuality(tag, (e.target as HTMLSelectElement).value as 'GOOD' | 'UNCERTAIN' | 'BAD')}
                        >
                          ${(['GOOD', 'UNCERTAIN', 'BAD'] as const).map((q) => html`<option value=${q} ?selected=${man.quality === q}>${q}</option>`)}
                        </select>
                        ${
                          man.quality !== 'GOOD'
                            ? html`<input
                                class="input sm"
                                type="text"
                                data-role="reason"
                                aria-label=${`${tag}: ${t('alarm.test.reason')}`}
                                .value=${live(man.reason ?? 'TIMEOUT')}
                                @change=${(e: Event) => this.setQuality(tag, man.quality as 'UNCERTAIN' | 'BAD', (e.target as HTMLInputElement).value)}
                              />`
                            : nothing
                        }`
                    : html`<span class="chip ${sample.quality === 'GOOD' ? 'ok' : 'warn'}"
                        >${sample.quality}</span
                      >`
                }
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </section>`;
  }

  private listCard() {
    const doc = this.doc();
    const skippedIds = new Set(this.skipped.map((s) => s.id));
    return html`<section class="al-card" data-role="list">
      <h3>${icon('bell', 'sm')}${t('alarm.test.list')}</h3>
      ${
        this.skipped.length
          ? html`<div class="banner warn al-skipped" role="status" data-role="skipped">
              ${icon('warn', 'warn')}
              <div>
                <b>${t('alarm.test.skipped', { n: this.skipped.length })}</b>
                <ul>
                  ${this.skipped.map(
                    (s) =>
                      html`<li>
                        <button
                          class="tg-xref"
                          type="button"
                          @click=${() => this.app.revealLocation({ editor: 'alarms', row: s.row, column: 'id' })}
                        >
                          ${t('alarm.test.skippedOne', { id: s.id, code: s.code })}
                        </button>
                      </li>`,
                  )}
                </ul>
              </div>
            </div>`
          : nothing
      }
      <table class="al-t">
        <thead>
          <tr>
            <th>${t('alarm.grid.col.id')}</th>
            <th>${t('alarm.grid.col.type')}</th>
            <th>${t('alarm.test.enabled')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${doc.alarms
            .filter((a) => !skippedIds.has((a as unknown as { id: string }).id))
            .map((a) => {
              const d = a as unknown as {
                id: string;
                type: string;
                tag?: string;
                limits?: Record<string, { value: number }>;
                deadband?: number;
              };
              const on = !this.disabled.has(d.id);
              return html`<tr data-def=${d.id} class=${this.selected === d.id ? 'on' : ''}>
                <td>
                  <button class="tg-xref mono" type="button" @click=${() => (this.selected = d.id)}>
                    ${d.id}
                  </button>
                </td>
                <td>${t(`alarm.type.${d.type}` as MessageKey)}</td>
                <td>
                  <input
                    type="checkbox"
                    data-role="enabled"
                    aria-label=${`${d.id}: ${t('alarm.test.enabled')}`}
                    .checked=${on}
                    @change=${(e: Event) => void this.toggleEnabled(d.id, (e.target as HTMLInputElement).checked)}
                  />
                </td>
                <td>
                  ${
                    d.type === 'limit'
                      ? html`<button
                            class="btn sm"
                            type="button"
                            data-act="over"
                            @click=${() => this.quickPush(d, true)}
                          >
                            ${t('alarm.test.overH')}
                          </button>
                          <button
                            class="btn sm"
                            type="button"
                            data-act="back"
                            @click=${() => this.quickPush(d, false)}
                          >
                            ${t('alarm.test.backNormal')}
                          </button>`
                      : nothing
                  }
                </td>
              </tr>`;
            })}
        </tbody>
      </table>
    </section>`;
  }

  private logCard() {
    const rows = this.logRows();
    return html`<section class="al-card" data-role="log">
      <h3>
        ${icon('report', 'sm')}${t('alarm.test.log')} <span class="cnt">${rows.length}</span>
        <span class="grow"></span>
        <input
          class="input sm"
          type="search"
          data-role="log-search"
          placeholder=${t('alarm.test.findLog')}
          aria-label=${t('alarm.test.findLog')}
          .value=${live(this.search)}
          @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
        />
        <button
          class="btn sm"
          type="button"
          data-act="copy-log"
          @click=${() => void this.copyLog()}
        >
          ${t('alarm.test.copyLog')}
        </button>
        <button class="btn sm" type="button" data-act="clear-log" @click=${() => this.clearLog()}>
          ${t('alarm.test.clearLog')}
        </button>
      </h3>
      ${
        this.instanceFilter
          ? html`<p class="help">
              ${t('alarm.test.filterInstance', { id: this.instanceFilter })}
              <button class="btn sm" type="button" @click=${() => (this.instanceFilter = '')}>
                ${t('alarm.quick.cancel')}
              </button>
            </p>`
          : nothing
      }
      <table class="al-t al-log">
        <thead>
          <tr>
            <th>${t('alarm.test.col.time')}</th>
            <th>${t('alarm.test.col.instance')}</th>
            <th>${t('alarm.test.col.transition')}</th>
            <th>${t('alarm.test.col.reason')}</th>
            <th>${t('alarm.test.col.detail')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice(-300)
            .reverse()
            .map(
              (r) =>
                html`<tr
                  class=${this.instanceFilter && this.instanceFilter === r.instance ? 'on' : ''}
                >
                  <td class="t">${clockText(r.t)}</td>
                  <td>
                    ${
                      r.instance
                        ? html`<button
                            class="tg-xref mono"
                            type="button"
                            @click=${() => (this.instanceFilter = this.instanceFilter === r.instance ? '' : r.instance)}
                          >
                            ${r.instance}
                          </button>`
                        : nothing
                    }
                  </td>
                  <td>${r.change}</td>
                  <td>${r.reason}</td>
                  <td>${r.detail}</td>
                </tr>`,
            )}
        </tbody>
      </table>
    </section>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const sim = this.ensureSim();
    const title = app.editorTitle('alarmTest');
    if (!s.outline.v05 || !sim)
      return html`<div class="ed ed-fill al-ed">
        <div class="ed-head"><h2>${title}</h2></div>
        <div class="empty" data-role="empty">
          ${icon('bell', 'lg')}<b>${t('alarm.test.noAlarms')}</b>
          <button class="btn" type="button" @click=${() => void app.run('alarm.open')}>
            ${t('cmd.alarm.open')}
          </button>
        </div>
      </div>`;
    void this.tick;
    return html`<div
      class="ed ed-fill al-ed"
      tabindex="0"
      data-role="panel"
      @keydown=${this.onKey}
      aria-label=${title}
    >
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="grow"></span>
        <span class="help">${t('alarm.test.help')}</span>
      </div>
      <div class="ed-tools al-tools" role="group" aria-label=${t('alarm.test.title')}>
        <button
          class="tbtn"
          type="button"
          data-act="run"
          aria-pressed=${this.running ? 'true' : 'false'}
          @click=${() => this.toggleRun()}
        >
          ${icon('play')}<span>${this.running ? t('alarm.test.pause') : t('alarm.test.run')}</span>
        </button>
        <button class="tbtn" type="button" data-act="step" @click=${() => this.step()}>
          ${icon('forward')}<span>${t('alarm.test.step')}</span>
        </button>
        <button class="tbtn" type="button" data-act="reset" @click=${() => this.reset()}>
          ${icon('refresh')}<span>${t('alarm.test.reset')}</span>
        </button>
        <button class="tbtn" type="button" data-act="restart" @click=${() => this.restart()}>
          ${icon('restore')}<span>${t('alarm.test.restart')}</span>
        </button>
        <span class="tsep" aria-hidden="true"></span>
        <span class="muted">${t('alarm.test.speed')}</span>
        <span class="al-seg" role="group" aria-label=${t('alarm.test.speed')}>
          ${ALARM_SIM_SPEEDS.map(
            (v) =>
              html`<button
                class="tbtn"
                type="button"
                data-speed=${v}
                aria-pressed=${sim.speed === v ? 'true' : 'false'}
                @click=${() => this.setSpeed(v)}
              >
                ${t('alarm.test.speedLabel', { n: v })}
              </button>`,
          )}
        </span>
        <span class="grow"></span>
        <span class="muted">${t('alarm.test.clock')}</span>
        <span class="al-clock" data-role="clock" role="timer" aria-live="off"
          >${clockText(sim.virtualNowMs, 1)}</span
        >
      </div>
      <div class="al-tbody">
        ${this.sourcesCard(sim)}
        <section class="al-card" data-role="alarms">
          <h3>${icon('bell', 'sm')}${t('alarm.test.alarms')}</h3>
          <mat-alarm-table
            .alarms=${sim.source()}
            .host=${this.host(sim)}
            .mode=${'run'}
            .showAck=${true}
            .showShelve=${true}
            .selectable=${true}
          ></mat-alarm-table>
        </section>
        ${this.listCard()} ${this.logCard()}
      </div>
    </div>`;
  }
}

customElements.define('mat-alarm-test', AlarmTestPanel);

registerEditor({
  match: (id) => id === 'alarmTest',
  render: (app) => html`<mat-alarm-test .app=${app}></mat-alarm-test>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-test': AlarmTestPanel;
  }
}
