// Editor Lớp alarm (feature 009, T078, FR-076; contract studio-alarm-editor §4; mockup studio-alarms.html cảnh 2): lưới lớp
// (Id, Tên, Ưu tiên, Màu từ tám ô, Nhấp nháy, Cần xác nhận, Xác nhận khi hết, Âm thanh, Chập chờn, Đang dùng) và panel Xem
// trước bên phải: ba hàng mẫu của bảng alarm dùng chung với trang (`<mat-alarm-table>`) ở hai theme, nghe thử âm thanh theo
// `SOUND_PATTERNS`, giảm chuyển động theo hệ điều hành. Xóa lớp đang dùng liệt kê chỗ dùng và hỏi; chỗ dùng thành
// E_ALARM_CLASS_REF (không tự đổi sang lớp khác). Mỗi thao tác là MỘT bước hoàn tác.
import { html, nothing, type PropertyValues } from 'lit';
import { ALARM_COLORS, ALARM_LIMITS, type AlarmColor } from '@mat/project-schema';
import {
  MemoryAlarmSource,
  registerAlarmTable,
  type AlarmClassInfo,
  type AlarmInstance,
} from '@mat/ui-components';
import type { StudioApp } from '../../app/app.ts';
import { issueText } from '../../app/code-text.ts';
import { t } from '../../i18n/index.ts';
import {
  alarmDocOf,
  colorLabel,
  defaultClasses,
  issuesByClass,
  priorityLabel,
  usageOfClass,
  type AlarmDoc,
} from '../../model/alarm-doc.ts';
import { alarmClassesGrid, type AlarmClassesGrid } from '../../model/alarm-classes-grid.ts';
import { playSoundPreview, type SoundPreview } from '../../model/alarm-sound-preview.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import { AppElement, icon } from '../base.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import { COLOR_VAR, PRIORITY_NUM } from './alarm-shared.ts';
import './alarm-editors.css';

interface Memo {
  project: object | null;
  grid: GridState;
}
const memory = new WeakMap<StudioApp, Memo>();

const CLASS_FIELDS = new Set([
  'id',
  'name',
  'priority',
  'color',
  'blink',
  'requiresAck',
  'ackReturn',
  'sound',
  'chatterLimit',
]);

export class AlarmClassesEditor extends AppElement {
  static override properties = { confirm: { state: true }, listening: { state: true } };

  declare confirm: string | null;
  declare listening: boolean;

  private cache: { key: unknown[]; adapter: AlarmClassesGrid } | null = null;
  private pending: { row: number; col: string } | null = null;
  private sound: SoundPreview | null = null;
  private tables: { key: string; light: MemoryAlarmSource; dark: MemoryAlarmSource } | null = null;

  constructor() {
    super();
    this.confirm = null;
    this.listening = false;
    registerAlarmTable();
  }

  private memo(): Memo {
    const project = this.app.store.state.project;
    let m = memory.get(this.app);
    if (!m || m.project !== project) {
      m = { project, grid: initialGrid };
      memory.set(this.app, m);
    }
    return m;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.outline.v05 || !s.docs['project.json']?.editable;
  }

  private doc(): AlarmDoc {
    const o = this.app.store.state.outline;
    return alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
  }

  private adapter(): AlarmClassesGrid {
    const s = this.app.store.state;
    const o = s.outline;
    const key = [o.alarms, o.alarmClasses, this.readOnly()];
    const c = this.cache;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.adapter;
    const adapter = alarmClassesGrid({
      doc: this.doc(),
      version: String(
        (s.docs['project.json']?.value as { schemaVersion?: string } | null)?.schemaVersion ??
          '0.5.0',
      ),
      hadFiles: { alarms: !!o.alarms, classes: !!o.alarmClasses },
      readOnly: this.readOnly(),
    });
    this.cache = { key, adapter };
    return adapter;
  }

  private issues() {
    const s = this.app.store.state;
    return issuesByClass(s.issues, s.outline.alarmClassFile ?? 'alarm-classes.json', (i) =>
      issueText(i),
    );
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    app.setCommandHandler('alarm.classes.add', () => this.addRow());
    app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.gridEl()?.commitPending();
    this.stopSound();
    app.setCommandHandler('alarm.classes.add', null);
    app.setCommandHandler('edit.fillDown', null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const loc = this.app.takeReveal('alarmClasses');
    if (loc?.editor === 'alarmClasses' && loc.row !== undefined)
      this.pending = {
        row: loc.row,
        col: loc.column && CLASS_FIELDS.has(loc.column) ? loc.column : 'id',
      };
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const p = this.pending;
    const grid = this.gridEl();
    if (!p || !grid) return;
    this.pending = null;
    void grid.updateComplete.then(() => {
      if (this.isConnected) grid.reveal({ row: p.row, col: p.col }, { edit: true });
    });
  }

  private onGridState = (e: Event): void => {
    this.memo().grid = (e as CustomEvent<{ state: GridState }>).detail.state;
    this.stopSound();
    this.requestUpdate();
  };

  private onGridEdit = (e: Event): void => {
    this.app.store.edit(
      (e as CustomEvent<{ edits: Parameters<StudioApp['store']['edit']>[0] }>).detail.edits,
    );
  };

  private onGridNotice = (e: Event): void => {
    this.app.toast((e as CustomEvent<{ text: string }>).detail.text);
  };

  // ---------- Lệnh ----------

  private addRow(): void {
    if (this.readOnly()) return;
    const add = this.adapter().append();
    if (!add.edits.length) {
      this.app.toast(t('alarm.classes.err.max'));
      return;
    }
    this.gridEl()?.commitPending();
    this.app.store.edit(add.edits);
    this.app.toast(
      t('alarm.classes.added', {
        id: this.adapter().doc.classes.length ? `class_${add.row + 1}` : '',
      }),
    );
    this.pending = { row: add.row, col: 'name' };
    this.requestUpdate();
  }

  private addDefaults(): void {
    if (this.readOnly()) return;
    const adapter = this.adapter();
    this.app.store.edit(adapter.edits({ ...adapter.doc, classes: defaultClasses() }));
  }

  private selectedRow(): number | null {
    const c = this.memo().grid.cell;
    return c ? c.row : null;
  }

  private askDelete(): void {
    const row = this.selectedRow();
    const grid = this.gridEl();
    const rows = grid?.selectedRows() ?? (row === null ? [] : [row]);
    if (!rows.length || this.readOnly()) {
      this.app.toast(t('alarm.classes.noSelection'));
      return;
    }
    const doc = this.adapter().doc;
    const inUse = rows.some((r) => usageOfClass(doc, doc.classes[r]?.id ?? '').length > 0);
    if (inUse) this.confirm = doc.classes[rows[0]!]?.id ?? null;
    else this.deleteNow(rows);
  }

  private deleteNow(rows: readonly number[]): void {
    const adapter = this.adapter();
    this.app.store.edit(adapter.remove(rows));
    this.confirm = null;
    this.app.toast(
      t('alarm.classes.removed', { id: rows.map((r) => adapter.doc.classes[r]?.id).join(', ') }),
    );
  }

  // ---------- Xem trước ----------

  private sampleSources(c: AlarmClassInfo) {
    const key = JSON.stringify(c);
    if (this.tables?.key === key) return this.tables;
    const base = (state: AlarmInstance['state'], n: number): AlarmInstance => ({
      id: `SAMPLE_${n}`,
      alarmId: `SAMPLE_${n}`,
      name: t('alarm.classes.sampleText'),
      type: 'limit',
      limit: 'H',
      occurrence: n,
      rev: n,
      state,
      class: c.id,
      priority: c.priority,
      area: null,
      text: t('alarm.classes.sampleText'),
      valueActive: 85,
      qualityActive: 'GOOD',
      tsActive: 1_000_000,
      clockOk: true,
      ...(state !== 'ACTIVE_UNACK' ? { tsAck: 1_000_500, ackUser: t('alarm.test.user') } : {}),
      ...(state === 'RTN_UNACK' ? { tsReturn: 1_001_000 } : {}),
      disabled: false,
      inputBad: false,
      startup: false,
    });
    const instances = [base('ACTIVE_UNACK', 1), base('ACTIVE_ACK', 2), base('RTN_UNACK', 3)];
    const mk = () => new MemoryAlarmSource({ instances, classes: [c], areas: [], now: 1_002_000 });
    this.tables = { key, light: mk(), dark: mk() };
    return this.tables;
  }

  private toggleSound(kind: AlarmClassInfo['sound']): void {
    if (this.sound?.playing) {
      this.stopSound();
      return;
    }
    // Phát trong thao tác bấm (chính sách tự phát của trình duyệt).
    this.sound = playSoundPreview(kind);
    this.listening = !!this.sound;
    if (!this.sound) this.app.toast(t('alarm.classes.noSound'));
  }

  private stopSound(): void {
    this.sound?.stop();
    this.sound = null;
    if (this.listening) this.listening = false;
  }

  private setColor(row: number, color: AlarmColor): void {
    if (this.readOnly()) return;
    const r = this.adapter().apply([{ row, col: 'color', text: colorLabel(color) }]);
    if (r.edits.length) this.app.store.edit(r.edits);
  }

  private previewPanel(adapter: AlarmClassesGrid) {
    const row = this.selectedRow();
    const c = row === null ? undefined : adapter.doc.classes[row];
    if (!c)
      return html`<aside class="al-side">
        <section class="al-card" data-role="preview">
          <h3>${icon('bell', 'sm')}${t('alarm.classes.preview')}</h3>
          <p class="help">${t('alarm.classes.noSelection')}</p>
        </section>
      </aside>`;
    const info: AlarmClassInfo = {
      id: c.id,
      name: c.name,
      priority: c.priority,
      color: c.color,
      blink: c.blink === true,
      requiresAck: c.requiresAck !== false,
      ackReturn: c.ackReturn === true,
      sound: c.sound ?? 'none',
      chatterLimit: c.chatterLimit ?? 5,
    };
    const src = this.sampleSources(info);
    const ro = this.readOnly();
    const inUse = usageOfClass(adapter.doc, c.id);
    const confirm = this.confirm === c.id;
    const themeBox = (theme: 'light' | 'dark', source: MemoryAlarmSource) =>
      html`<div class="al-theme" data-theme=${theme}>
        <b class="muted"
          >${t(theme === 'light' ? 'alarm.classes.themeLight' : 'alarm.classes.themeDark')}</b
        >
        <mat-alarm-table
          .alarms=${source}
          .mode=${'run'}
          .host=${undefined}
          .showAck=${false}
          .showShelve=${false}
          .columns=${['priority', 'text', 'state']}
          aria-label=${`${t('alarm.classes.preview')}: ${theme}`}
        ></mat-alarm-table>
      </div>`;
    return html`<aside class="al-side" aria-label=${t('alarm.classes.preview')}>
      <section class="al-card" data-role="preview">
        <h3>
          ${icon('bell', 'sm')}${t('alarm.classes.preview')}: <span class="mono">${c.id}</span>
          <span class="grow"></span>
          <span
            class="chip info"
            title=${t('alarm.priority.tooltip', { n: PRIORITY_NUM[c.priority], label: priorityLabel(c.priority) })}
          >
            ${PRIORITY_NUM[c.priority]} · ${priorityLabel(c.priority)}
          </span>
        </h3>
        <p class="help">${t('alarm.classes.previewHint')}</p>
        <div class="al-swatches" role="group" aria-label=${t('alarm.classes.col.color')}>
          ${ALARM_COLORS.map(
            (k) =>
              html`<button
                class="al-swatch"
                type="button"
                data-color=${k}
                aria-pressed=${c.color === k ? 'true' : 'false'}
                ?disabled=${ro}
                @click=${() => this.setColor(row!, k)}
              >
                <span class="al-dot" style=${`background:${COLOR_VAR[k]}`}></span>${colorLabel(k)}
              </button>`,
          )}
        </div>
        <div class="al-themes">${themeBox('light', src.light)} ${themeBox('dark', src.dark)}</div>
        <div class="row" style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button
            class="btn"
            type="button"
            data-act="listen"
            aria-pressed=${this.listening ? 'true' : 'false'}
            @click=${() => this.toggleSound(info.sound)}
          >
            ${this.listening ? t('alarm.classes.stop') : t('alarm.classes.listen')}
          </button>
          <span class="help"
            >${info.sound === 'none' ? t('alarm.classes.noSound') : t(`alarm.sound.${info.sound}`)}</span
          >
        </div>
        <p class="help">${t('alarm.classes.reducedMotion')}</p>
      </section>
      <section class="al-card" data-role="inuse">
        <h3>
          ${icon('list', 'sm')}${t('alarm.classes.inUseList', { id: c.id })}
          <span class="cnt">${inUse.length}</span>
        </h3>
        ${
          inUse.length
            ? html`<ul class="xref">
                ${inUse.map(
                  (u) =>
                    html`<li>
                      <button
                        class="tg-xref"
                        type="button"
                        @click=${() => this.app.revealLocation({ editor: 'alarms', row: u.row, column: 'class' })}
                      >
                        ${u.id}${u.threshold ? ` · ${u.threshold}` : ''}
                      </button>
                    </li>`,
                )}
              </ul>`
            : html`<p class="help">${t('alarm.classes.inUse', { n: 0 })}</p>`
        }
        ${
          confirm
            ? html`<div class="banner warn al-confirm" role="alertdialog" data-role="class-confirm">
                ${icon('warn', 'warn')}
                <div>
                  ${t('alarm.classes.removeConfirm', {
                    name: c.name,
                    n: inUse.length,
                    ids: inUse
                      .slice(0, 5)
                      .map((u) => u.id)
                      .join(', '),
                  })}
                  <div class="row">
                    <button
                      class="btn sm primary"
                      type="button"
                      data-act="class-confirm"
                      @click=${() => this.deleteNow([row!])}
                    >
                      ${t('alarm.classes.delete')}
                    </button>
                    <button class="btn sm" type="button" @click=${() => (this.confirm = null)}>
                      ${t('alarm.quick.cancel')}
                    </button>
                  </div>
                </div>
              </div>`
            : nothing
        }
      </section>
    </aside>`;
  }

  private tool(
    act: string,
    ic: Parameters<typeof icon>[0],
    label: string,
    reason: string | null,
    run: () => void,
  ) {
    const locked = reason === null ? null : t('reason.locked', { label, reason });
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${locked ? 'true' : nothing}
      title=${locked ?? label}
      @click=${() => (locked ? this.app.toast(locked) : run())}
    >
      ${icon(ic)}<span>${label}</span>
    </button>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    if (!s.outline.v05) return html`<mat-alarm-upgrade .app=${app}></mat-alarm-upgrade>`;
    const adapter = this.adapter();
    const ro = this.readOnly();
    const iss = this.issues();
    const title = app.editorTitle('alarmClasses');
    const roReason = ro ? t('reason.readOnly') : null;
    const row = this.selectedRow();
    const n = adapter.rowCount();
    return html`<div class="ed ed-fill al-ed">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="path">${s.outline.alarmClassFile ?? 'alarm-classes.json'}</span>
        <span class="grow"></span>
        <span class="help">${t('alarm.classes.help')}</span>
      </div>
      <div class="ed-tools" role="group" aria-label=${t('alarm.classes.title')}>
        ${this.tool('add', 'plus', t('alarm.classes.add'), roReason ?? (n >= ALARM_LIMITS.classes ? t('alarm.classes.err.max') : null), () => this.addRow())}
        ${this.tool('delete', 'x', t('alarm.classes.delete'), roReason ?? (row === null ? t('alarm.classes.noSelection') : null), () => this.askDelete())}
        ${n === 0 ? this.tool('defaults', 'plus', t('alarm.classes.addDefaults'), roReason, () => this.addDefaults()) : nothing}
        <span class="grow"></span>
        <span class="muted num" data-role="count" role="status"
          >${t('alarm.classes.count', { n, max: ALARM_LIMITS.classes })}</span
        >
      </div>
      <div class="al-cbody">
        <div class="al-cgrid">
          <mat-grid
            .adapter=${adapter}
            .state=${this.memo().grid}
            .label=${title}
            .issues=${iss.errors}
            .warns=${iss.warns}
            .showFilters=${false}
            @grid-state=${this.onGridState}
            @grid-edit=${this.onGridEdit}
            @grid-notice=${this.onGridNotice}
          ></mat-grid>
          ${
            n === 0
              ? html`<div class="empty" data-role="empty">
                  ${icon('list', 'lg')}<b>${t('alarm.classes.title')}</b>
                  <p>${t('alarm.classes.addDefaults')}</p>
                </div>`
              : nothing
          }
        </div>
        ${this.previewPanel(adapter)}
      </div>
      <div class="al-statusbar" role="status">
        ${t('alarm.classes.count', { n, max: ALARM_LIMITS.classes })}
      </div>
    </div>`;
  }
}

customElements.define('mat-alarm-classes', AlarmClassesEditor);

registerEditor({
  match: (id) => id === 'alarmClasses',
  render: (app) => html`<mat-alarm-classes .app=${app}></mat-alarm-classes>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-classes': AlarmClassesEditor;
  }
}
