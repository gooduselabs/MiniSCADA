// Bảng theo dõi, phần xem (feature 006, T132, FR-050 phần xem, data-model §4, mockup studio-tags.html v-watch): mỗi bảng một
// editor trên lưới dùng chung (cùng chọn ô, gõ thẳng qua bộ gõ, sao chép, dán, hoàn tác như Bảng Tag, FR-046). Thêm Tag bằng gõ
// tên có gợi ý, dán danh sách tên, kéo từ Details hoặc Bảng Tag. Online: giá trị sống, chữ và màu theo bảng giá trị, quality, lý do,
// thời điểm; chỉ đăng ký dữ liệu sống cho Tag của bảng (ưu tiên 3). Lệnh Ghi nằm ở US2 (write-flow).
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import type { ValueTableDoc } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { PRIORITY } from '../../model/live-subscriptions.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import {
  WATCH_MAX_ROWS,
  addNames,
  parseNameList,
  suggestTags,
  watchAdapter,
  watchTags,
  type LiveCell,
  type WatchAdapter,
  type WatchTagInfo,
} from '../../model/watch-table.ts';
import { pulseStuckTags, warningChips } from '../../model/device.ts';
import { AppElement, icon } from '../base.ts';
import { chipAction, chipLabel } from '../device-warnings.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import type { DeviceTagDef, WriteRowInput } from '../../model/write-flow.ts';
import { QUALITY_CHIP, formatLive } from './tag-live.ts';
import { writeResultView } from './watch-write.ts';
import './watch-table-editor.css';

/** Ô chọn theo StudioApp và bảng: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, Map<string, GridState>>();

export class WatchTableEditor extends AppElement {
  static override properties = {
    tableId: { type: String },
    ticks: { state: true },
    query: { state: true },
    hi: { state: true },
    open: { state: true },
  };

  declare tableId: string;
  declare ticks: number;
  declare query: string;
  declare hi: number;
  declare open: boolean;

  private offValues: (() => void) | null = null;
  private offWrites: (() => void) | null = null;
  private offInfo: (() => void) | null = null;
  private stuckKey = '';
  private cache: { key: unknown[]; adapter: WatchAdapter } | null = null;
  private declared = '';

  constructor() {
    super();
    this.tableId = '';
    this.ticks = 0;
    this.query = '';
    this.hi = -1;
    this.open = false;
  }

  // ---------- Dữ liệu ----------

  private doc() {
    return this.app.store.state.outline.watchTables.find((w) => w.id === this.tableId)?.doc ?? null;
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || s.outline.version !== '0.2';
  }

  private projectTags(): Map<string, WatchTagInfo> {
    const out = new Map<string, WatchTagInfo>();
    for (const tag of (this.app.store.state.outline.tags?.tags ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      if (typeof tag.id !== 'string') continue;
      out.set(tag.id, {
        id: tag.id,
        type: String(tag.type ?? ''),
        ...(typeof tag.unit === 'string' ? { unit: tag.unit } : {}),
        ...(typeof tag.valueTable === 'string' ? { valueTable: tag.valueTable } : {}),
      });
    }
    return out;
  }

  private adapter(): WatchAdapter | null {
    const doc = this.doc();
    if (!doc) return null;
    const app = this.app;
    const o = app.store.state.outline;
    const online = app.valuesLive();
    const sim = app.simulating() && !app.online();
    const readOnly = this.readOnly();
    const key = [doc, o.tags, o.valueTables, online, sim, readOnly];
    const c = this.cache;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.adapter;
    const tables: Record<string, ValueTableDoc> = {};
    for (const v of o.valueTables) if (v.doc) tables[v.name] = v.doc;
    const adapter = watchAdapter({
      table: doc,
      tags: this.projectTags(),
      valueTables: tables,
      online,
      readOnly,
      live: (id): LiveCell | null => {
        const v = app.readValue(id);
        if (!v) return null;
        const good = v.quality !== 'STALE' && app.valuesLive();
        return {
          value: v.value,
          quality: good ? v.quality : 'STALE',
          ts: v.ts,
          ...(v.reason !== undefined ? { reason: v.reason } : {}),
        };
      },
      unknownOnDevice: app.session.unknown,
      ...(online
        ? {
            writes: (row: number) => {
              const tag = doc.rows[row]?.tag ?? '';
              const limits = (app.writes.defs?.get(tag)?.limits ?? undefined) as
                { min?: number; max?: number } | undefined;
              return writeResultView(
                app.writes.flow.row(this.writeKey(row)),
                limits ? { limits } : {},
              );
            },
          }
        : {}),
    });
    this.cache = { key, adapter };
    return adapter;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  private gridState(): GridState {
    return memory.get(this.app)?.get(this.tableId) ?? initialGrid;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    app.setCommandHandler('watch.write', () => void this.startWrite(false));
    app.setCommandHandler('watch.writeAll', () => void this.startWrite(true));
    this.offValues = app.subscribeValues(() => {
      if (app.valuesLive()) this.ticks++;
    });
    this.offWrites = app.writes.flow.subscribe(() => this.ticks++);
    // Feature 011 (T052): Tag có xung kẹt (PULSE_STUCK của system/info) đổi thì vẽ lại ô Tag.
    this.offInfo = app.session.subscribe((e) => {
      if (e.type !== 'info') return;
      const key = pulseStuckTags(app.session.info).join('\n');
      if (key === this.stuckKey) return;
      this.stuckKey = key;
      this.ticks++;
    });
    this.addEventListener('focusin', this.onFocus);
    this.addEventListener('focusout', this.onFocus);
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.gridEl()?.commitPending();
    app.setCommandHandler('edit.fillDown', null);
    app.setCommandHandler('watch.write', null);
    app.setCommandHandler('watch.writeAll', null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
    this.offValues?.();
    this.offValues = null;
    this.offWrites?.();
    this.offWrites = null;
    this.offInfo?.();
    this.offInfo = null;
    this.removeEventListener('focusin', this.onFocus);
    this.removeEventListener('focusout', this.onFocus);
    this.releaseLive();
    app.setUiContext({ tagGridFocused: false, cellRow: null });
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.syncSubscription();
  }

  /** Đăng ký dữ liệu sống cho Tag của bảng (ưu tiên 3) khi Online; bỏ khi Offline. */
  private syncSubscription(): void {
    const app = this.app;
    const doc = this.doc();
    const tags = doc && app.online() ? watchTags(doc) : [];
    const key = tags.join('\n');
    if (key === this.declared) return;
    this.declared = key;
    if (tags.length) app.live.declare(`watch:${this.tableId}`, tags, PRIORITY.watch);
    else app.live.release(`watch:${this.tableId}`);
  }

  private releaseLive(): void {
    this.declared = '';
    this.app.live.release(`watch:${this.tableId}`);
  }

  private readonly onFocus = (): void => {
    const grid = this.gridEl();
    const inGrid = !!grid && grid.contains(document.activeElement);
    this.app.setUiContext({
      tagGridFocused: inGrid && !grid.state.editing,
      cellRow: inGrid ? (grid.currentPosition() ?? null) : null,
    });
  };

  // ---------- Sự kiện của lưới ----------

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    let m = memory.get(this.app);
    if (!m) memory.set(this.app, (m = new Map()));
    m.set(this.tableId, state);
    this.onFocus();
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

  // ---------- Ghi (US2) ----------

  /** Khóa dòng trong WriteFlow: bảng, vị trí và Tag (đổi dòng thì kết quả cũ không dán nhầm sang dòng khác). */
  private writeKey(row: number): string {
    return `${this.tableId}:${row}:${this.doc()?.rows[row]?.tag ?? ''}`;
  }

  /** Dòng cần ghi: các dòng đang chọn, hoặc mọi dòng có giá trị ghi (Ghi tất cả). */
  private writeRows(all: boolean): WriteRowInput[] {
    const doc = this.doc();
    if (!doc) return [];
    const picked = all
      ? doc.rows.map((_, i) => i).filter((i) => (doc.rows[i].writeValue ?? '').trim() !== '')
      : (this.gridEl()?.selectedRows() ?? []);
    return picked.map((i) => ({
      key: this.writeKey(i),
      tag: doc.rows[i].tag,
      text: doc.rows[i].writeValue ?? '',
    }));
  }

  /** Lệnh Ghi: dựng bản xem trước rồi mở hộp thoại Xác nhận ghi; không gửi gì cho tới khi người dùng xác nhận. */
  private async startWrite(all: boolean): Promise<void> {
    const app = this.app;
    const rows = this.writeRows(all);
    if (!rows.length) {
      app.toast(t(all ? 'wt.noWriteValues' : 'wt.noSelection'));
      return;
    }
    // Mô phỏng: ghi tay áp ngay, không hộp xác nhận (không có gì gửi tới thiết bị), mỗi dòng ghi rõ "mô phỏng".
    if (app.simulating() && !app.online()) {
      const r = app.simWrite(rows);
      app.toast(t('wt.simWritten', { n: r.written, blocked: r.blocked }));
      return;
    }
    if (app.online() && app.writes.state === 'idle') await app.writes.loadDefs();
    const ctx = app.commandContext();
    const local = new Map<string, DeviceTagDef>();
    for (const tag of (app.store.state.outline.tags?.tags ?? []) as unknown as DeviceTagDef[])
      local.set(tag.id, tag);
    app.writes.prepare(rows, {
      online: ctx.onlineAuth,
      role: ctx.onlineAuth ? (app.session.auth?.role ?? null) : null,
      local,
      live: (tag) => {
        const v = app.session.values.get(tag);
        if (!v) return null;
        const unit = (local.get(tag) as { unit?: unknown } | undefined)?.unit;
        return {
          text: formatLive(v.value, unit),
          quality: v.quality,
          ...(v.reason !== undefined ? { reason: v.reason } : {}),
        };
      },
    });
    app.openDialog({ kind: 'writeConfirm' });
  }

  // ---------- Thêm Tag ----------

  private add(names: readonly string[]): void {
    const doc = this.doc();
    if (!doc || this.readOnly() || !names.length) return;
    const r = addNames(doc, names);
    if (r.added) this.app.store.edit([r.edit]);
    if (r.dropped) this.app.toast(t('wt.dropped', { n: r.dropped, max: WATCH_MAX_ROWS }));
    this.query = '';
    this.open = false;
    this.hi = -1;
  }

  private suggestions(): string[] {
    const ids = [...this.projectTags().keys()];
    return this.query.trim() ? suggestTags(ids, this.query, 8) : [];
  }

  private onAddKey = (e: KeyboardEvent): void => {
    const list = this.suggestions();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      this.open = true;
      this.hi =
        e.key === 'ArrowDown' ? Math.min(list.length - 1, this.hi + 1) : Math.max(0, this.hi - 1);
    } else if (e.key === 'Escape') {
      if (this.open) {
        e.preventDefault();
        e.stopPropagation();
        this.open = false;
        this.hi = -1;
      }
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const pick = this.hi >= 0 ? list[this.hi] : this.query.trim();
      if (pick) this.add([pick]);
    }
  };

  private onAddPaste = (e: ClipboardEvent): void => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const names = parseNameList(text);
    if (names.length > 1) {
      e.preventDefault();
      this.add(names);
    }
  };

  private onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types?.includes('application/x-mat-tag')) e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    if (!name) return;
    e.preventDefault();
    this.add([name]);
  };

  // ---------- Vẽ ----------

  private renderCell = (row: number, col: { key: string }, text: string) => {
    const a = this.adapter();
    if (!a) return undefined;
    if (col.key === 'quality' && text) {
      const cls = QUALITY_CHIP[text as keyof typeof QUALITY_CHIP];
      return cls
        ? html`<span class="chip ${cls}">${text}</span>`
        : html`<span class="ww-stale">${t('tagGrid.live.stale')}</span>`;
    }
    if (col.key === 'text' && text) {
      const color = a.color(row);
      // Màu của bảng giá trị chỉ là chấm màu cạnh chữ: chữ giữ màu của theme để đủ tương phản ở cả hai theme.
      return html`${color ? html`<span class="ww-sw" aria-hidden="true" style=${`background:${color}`}></span>` : nothing}<span
          class="ww-text"
          >${text}</span
        >`;
    }
    if (col.key === 'tag' && text) {
      // Feature 011 (T052, FR-019): lệnh nhả của một xung chưa gửi được sau khi runtime khởi động lại.
      const chip = warningChips(this.app.session.info).find((c) => c.code === 'PULSE_STUCK');
      if (chip && pulseStuckTags(this.app.session.info).includes(text))
        return html`${text}
          <span class="chip err" data-chip="pulse-stuck" title=${chipAction(chip)}
            >${icon('err', 'err')}${chipLabel(chip)}</span
          >`;
    }
    if (col.key === 'value' && a.deviceMissing(row))
      return html`<span class="ww-none">${text}</span>`;
    if (col.key === 'result' && text) {
      const tone = a.writeTone(row);
      const cls = tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'info';
      return html`<span class="chip ${cls}">${text}</span>`;
    }
    return undefined;
  };

  private warns(a: WatchAdapter): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (let r = 0; r < a.rowCount(); r++)
      if (a.missingInProject(r)) out.set(`${r}:tag`, [t('wt.warn.ref')]);
    return out;
  }

  private addBox(a: WatchAdapter | null) {
    const list = this.suggestions();
    const ro = this.readOnly();
    const open = this.open && list.length > 0;
    return html`<div class="ww-add">
      <input
        class="input sm mono"
        type="text"
        data-role="add"
        role="combobox"
        aria-label=${t('wt.add')}
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls="ww-suggest"
        aria-autocomplete="list"
        aria-activedescendant=${open && this.hi >= 0 ? `ww-opt-${this.hi}` : nothing}
        placeholder=${t('wt.addPlaceholder')}
        autocomplete="off"
        spellcheck="false"
        ?disabled=${ro || !a}
        .value=${live(this.query)}
        @input=${(e: Event) => {
          this.query = (e.target as HTMLInputElement).value;
          this.open = true;
          this.hi = -1;
        }}
        @keydown=${this.onAddKey}
        @paste=${this.onAddPaste}
        @blur=${() => setTimeout(() => (this.open = false), 120)}
      />
      ${
        open
          ? html`<ul
              id="ww-suggest"
              class="ww-suggest"
              role="listbox"
              aria-label=${t('wt.suggest')}
            >
              ${list.map(
                (id, i) =>
                  html`<li
                    id="ww-opt-${i}"
                    role="option"
                    class=${i === this.hi ? 'hi' : ''}
                    aria-selected=${i === this.hi ? 'true' : 'false'}
                    @mousedown=${(e: Event) => {
                      e.preventDefault();
                      this.add([id]);
                    }}
                  >
                    ${id}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
    </div>`;
  }

  private writeButtons(a: WatchAdapter) {
    const app = this.app;
    const ctx = app.commandContext();
    const lock = app.enabled('watch.write');
    const reason = lock === true ? null : t(lock);
    const pos = this.gridEl()?.currentPosition() ?? null;
    const unknown = app.writes.flow.unknownCount;
    void a;
    const btn = (
      act: string,
      label: MessageKey,
      id: 'watch.write' | 'watch.writeAll',
      extra: string | null,
    ) =>
      html`<button
        class="tbtn ${act === 'writeAll' ? 'primary' : ''}"
        type="button"
        data-act=${act}
        aria-disabled=${reason || extra ? 'true' : nothing}
        title=${reason ?? extra ?? t(label)}
        @click=${() => (reason ? app.toast(reason) : extra ? app.toast(extra) : void app.run(id))}
      >
        ${icon('upload')}<span>${t(label)}</span>
      </button>`;
    void ctx;
    return html`<span class="tsep" aria-hidden="true"></span>
      ${btn('write', 'cmd.watch.write', 'watch.write', pos === null ? t('wt.noSelection') : null)}
      ${btn('writeAll', 'cmd.watch.writeAll', 'watch.writeAll', null)}
      ${
        unknown
          ? html`<button
              class="tbtn"
              type="button"
              data-act="recheck"
              title=${t('wr.recheckTip')}
              @click=${() => void app.writes.flow.recheck()}
            >
              ${icon('refresh')}<span>${t('wr.recheck')}</span>
            </button>`
          : nothing
      }`;
  }

  protected override render() {
    const doc = this.doc();
    if (!doc)
      return html`<div class="ed ed-fill">
        <div class="empty">${icon('table', 'lg')}<b>${t('wt.notFound')}</b></div>
      </div>`;
    const a = this.adapter()!;
    const ro = this.readOnly();
    const grid = this.gridEl();
    const pos = grid?.currentPosition() ?? null;
    return html`<div class="ed ed-fill ww">
      <div class="ed-head">
        <h2>${doc.name}</h2>
        <span class="path">watch-tables/${doc.id}.json</span>
        <span class="grow"></span>
        <span class="help">${t('wt.noAuto')}</span>
      </div>
      ${
        ro
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t('tagTable.readOnlyBanner')}</div>
            </div>`
          : nothing
      }
      <div class="ed-tools" role="group" aria-label=${t('wt.tools')}>
        ${this.addBox(a)}
        <button
          class="tbtn"
          type="button"
          data-act="delete"
          aria-disabled=${ro || pos === null ? 'true' : nothing}
          title=${ro ? t('reason.readOnly') : pos === null ? t('reason.noRow') : t('cmd.tags.delete')}
          @click=${() => this.deleteRows(a)}
        >
          ${icon('x')}<span>${t('cmd.tags.delete')}</span>
        </button>
        ${this.writeButtons(a)}
        <span class="grow"></span>
        <span class="muted num" data-role="count" role="status"
          >${t('wt.count', { n: a.rowCount(), max: WATCH_MAX_ROWS })}</span
        >
      </div>
      <div class="ww-gridwrap" @dragover=${this.onDragOver} @drop=${this.onDrop}>
        <mat-grid
          .adapter=${a}
          .state=${this.gridState()}
          .label=${doc.name}
          .warns=${this.warns(a)}
          .renderCell=${this.renderCell}
          .ticks=${this.ticks}
          .dragColumn=${'tag'}
          @grid-state=${this.onGridState}
          @grid-edit=${this.onGridEdit}
          @grid-notice=${this.onGridNotice}
        ></mat-grid>
        ${
          a.rowCount() === 0
            ? html`<div class="empty">
                ${icon('table', 'lg')}<b>${t('wt.empty.title')}</b>
                <p>${t('wt.empty.text')}</p>
              </div>`
            : nothing
        }
      </div>
      <p class="help ww-foot">${t('wt.foot')}</p>
    </div>`;
  }

  private deleteRows(a: WatchAdapter): void {
    const grid = this.gridEl();
    if (!grid || this.readOnly()) return;
    const rows = grid.selectedRows();
    if (!rows.length) return;
    this.app.store.edit(a.remove(rows));
    this.app.toast(t('tt.deletedMany', { n: rows.length }));
  }
}

customElements.define('mat-watch-table-editor', WatchTableEditor);

registerEditor({
  match: (id) => id.startsWith('watch:'),
  render: (app, id) =>
    html`<mat-watch-table-editor
      .app=${app}
      .tableId=${id.slice('watch:'.length)}
    ></mat-watch-table-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-watch-table-editor': WatchTableEditor;
  }
}
