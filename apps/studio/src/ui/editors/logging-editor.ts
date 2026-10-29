// Editor Lưu trữ (feature 010, US7, T120, FR-046…FR-054; contracts/studio-010.md §1; thay `logging-view.ts` chỉ đọc của 004).
// Kiểu IDE như mockup studio-history: lưới nhóm và lưới Tag trên `mat-grid` dùng chung (chọn ô, bộ gõ, dán, điền xuống, hoàn
// tác như Bảng Tag), khung Ước tính ghi bên phải (cập nhật theo mỗi sửa đổi), form Kết nối DB ngoài (không mật khẩu) bên dưới,
// inspector theo nhóm đang chọn (logging-props.ts). Lỗi và cảnh báo của bộ kiểm tra hiện NGAY tại ô; lưu được khi còn lỗi.
// Chỉ đọc (kèm băng Nâng cấp) khi project chưa phải định dạng 0.6. Dữ liệu project chỉ đi vào giao diện qua binding của Lit.
import { issueText as issueMsg } from '../../app/code-text.ts';
import type { Connection, Issue, LoggingConfig } from '@mat/project-schema';
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { estimateView, type EstimateView } from '../../model/estimate-view.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import type { GridAdapter } from '../../model/grid/types.ts';
import { maskAddress } from '../../model/address-mask.ts';
import { severityOf, type Location } from '../../model/issue-map.ts';
import {
  CONNECTION_TYPES,
  FIELDS_OF,
  TLS_MODES,
  addConnection,
  setConnectionField,
  type ConnField,
} from '../../model/logging-conn.ts';
import { addTags, duplicateGroup, removeConnection, tagTypesOf } from '../../model/logging-doc.ts';
import { MAX_GROUPS, groupAdapter, tagAdapter } from '../../model/logging-grid.ts';
import { bucketLoggingIssues, type LoggingIssueBuckets } from '../../model/logging-issues.ts';
import { applyMeasure, measureOf } from '../../model/logging-online.ts';
import { addGroup, removeGroup, MAX_TAGS_PER_GROUP } from '../../model/logging-doc.ts';
import { parseNameList, suggestTags } from '../../model/watch-table.ts';
import { AppElement, icon } from '../base.ts';
import '../estimate-panel.ts';
import type { EstimateOnline } from '../estimate-panel.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import './logging-props.ts';
import './logging-editor.css';

/** Ô chọn theo StudioApp và lưới: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, Map<string, GridState>>();

const messages = (m: ReadonlyMap<string, readonly Issue[]> | undefined): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const [k, v] of m ?? [])
    out.set(
      k,
      v.map((i) => issueMsg(i)),
    );
  return out;
};

export class LoggingEditor extends AppElement {
  static override properties = {
    query: { state: true },
    hi: { state: true },
    open: { state: true },
    revealed: { state: true },
  };

  declare query: string;
  declare hi: number;
  declare open: boolean;
  declare revealed: number | null;

  private cache: { key: unknown[]; est: EstimateView } | null = null;
  private adapterCache: { key: unknown[]; groups: GridAdapter; tags: GridAdapter | null } | null =
    null;

  constructor() {
    super();
    this.query = '';
    this.hi = -1;
    this.open = false;
    this.revealed = null;
  }

  // ---------- Dữ liệu ----------

  private cfg(): LoggingConfig | null {
    return this.app.store.state.outline.logging;
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.outline.format06;
  }

  /** Nhóm đang chọn (luôn có một nhóm đang chọn nếu có nhóm). */
  private groupIndex(): number {
    const sel = this.app.store.state.selection;
    const n = this.cfg()?.groups.length ?? 0;
    if (sel?.kind === 'group' && sel.index >= 0 && sel.index < n) return sel.index;
    return n > 0 ? 0 : -1;
  }

  private types() {
    const o = this.app.store.state.outline;
    return o.tags ? tagTypesOf(o.tags) : null;
  }

  private estimate(): EstimateView {
    const cfg = this.cfg();
    const types = this.types();
    const key = [cfg, types];
    if (this.cache && this.cache.key.every((k, i) => k === key[i])) return this.cache.est;
    const est = estimateView(cfg, types);
    this.cache = { key, est };
    return est;
  }

  private buckets(): LoggingIssueBuckets {
    const s = this.app.store.state;
    return bucketLoggingIssues(s.issues, s.outline.loggingFile);
  }

  private online(): EstimateOnline | null {
    const s = this.app.session;
    if (s.state !== 'monitoring') return null;
    const m = measureOf(s.info);
    return m ? { bytesPerDay: m.bytesPerDay, rows24h: m.rows24h, source: m.source } : null;
  }

  private adapters(): { groups: GridAdapter; tags: GridAdapter | null } | null {
    const cfg = this.cfg();
    if (!cfg) return null;
    const est = this.estimate();
    const types = this.types();
    const ro = this.readOnly();
    const gi = this.groupIndex();
    const key = [cfg, types, est, ro, gi];
    const c = this.adapterCache;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c;
    const base = { cfg, types, estimate: est, readOnly: ro };
    const next = {
      key,
      groups: groupAdapter(base),
      tags: gi >= 0 ? tagAdapter({ ...base, group: gi }) : null,
    };
    this.adapterCache = next;
    return next;
  }

  private gridEl(which: 'groups' | 'tags'): MatGrid | null {
    return this.querySelector<MatGrid>(`[data-grid="${which}"] mat-grid`);
  }

  private gridState(key: string): GridState {
    return memory.get(this.app)?.get(key) ?? initialGrid;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => {
    this.gridEl('groups')?.commitPending();
    this.gridEl('tags')?.commitPending();
  };

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    app.setCommandHandler('edit.fillDown', () => {
      const tags = this.gridEl('tags');
      const groups = this.gridEl('groups');
      const active = document.activeElement;
      (tags?.contains(active) ? tags : groups)?.fillDownSelection();
    });
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.commitHook();
    app.setCommandHandler('edit.fillDown', null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const loc = this.app.takeReveal('logging');
    if (loc) this.reveal(loc);
    // Editor đang mở luôn có một nhóm đang chọn: lưới Tag và inspector theo nhóm đó.
    const s = this.app.store.state;
    if (s.active === 'logging') {
      const gi = this.groupIndex();
      const sel = s.selection;
      if (gi >= 0 && !(sel?.kind === 'group' && sel.index === gi))
        this.app.select({ kind: 'group', index: gi });
    }
  }

  private reveal(loc: Location): void {
    if (loc.editor !== 'logging') return;
    const n = this.cfg()?.groups.length ?? 0;
    if (loc.group !== undefined && loc.group < n) {
      this.revealed = loc.group;
      this.app.select({ kind: 'group', index: loc.group });
    }
  }

  // ---------- Sự kiện của lưới ----------

  private onGridState = (which: 'groups' | 'tags') => (e: Event) => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    const key = which === 'groups' ? 'groups' : `tags:${this.groupIndex()}`;
    let m = memory.get(this.app);
    if (!m) memory.set(this.app, (m = new Map()));
    m.set(key, state);
    if (which === 'groups') {
      const row = this.gridEl('groups')?.currentPosition() ?? null;
      if (row !== null && row !== this.groupIndex() && row < (this.cfg()?.groups.length ?? 0))
        this.app.select({ kind: 'group', index: row });
    }
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

  private edit(next: LoggingConfig | null): void {
    if (next && next !== this.cfg()) this.app.store.edit([{ kind: 'logging', value: next }]);
  }

  private guard(): LoggingConfig | null {
    const cfg = this.cfg();
    if (!cfg) return null;
    if (this.readOnly()) {
      this.app.toast(t('hist.ed.readOnlyToast'));
      return null;
    }
    return cfg;
  }

  private addGroupCmd = (): void => {
    const cfg = this.guard();
    if (!cfg) return;
    if (cfg.groups.length >= MAX_GROUPS)
      return this.app.toast(t('hist.ed.maxGroups', { n: MAX_GROUPS }));
    this.edit(addGroup(cfg));
    this.app.select({ kind: 'group', index: cfg.groups.length });
  };

  private dupGroupCmd = (): void => {
    const cfg = this.guard();
    const gi = this.groupIndex();
    if (!cfg || gi < 0) return;
    if (cfg.groups.length >= MAX_GROUPS)
      return this.app.toast(t('hist.ed.maxGroups', { n: MAX_GROUPS }));
    this.edit(duplicateGroup(cfg, gi));
    this.app.select({ kind: 'group', index: gi + 1 });
  };

  private delGroupCmd = (): void => {
    const cfg = this.guard();
    const gi = this.groupIndex();
    if (!cfg || gi < 0) return;
    this.edit(removeGroup(cfg, gi));
    this.app.select({ kind: 'group', index: Math.max(0, Math.min(gi, cfg.groups.length - 2)) });
  };

  private delTagsCmd = (): void => {
    const g = this.gridEl('tags');
    const a = this.adapters()?.tags;
    if (!g || !a?.remove || this.readOnly()) return;
    const rows = g.selectedRows();
    if (rows.length) this.app.store.edit(a.remove(rows));
  };

  private addTags(names: readonly string[]): void {
    const cfg = this.guard();
    const gi = this.groupIndex();
    if (!cfg || gi < 0 || !names.length) return;
    const types = this.types() ?? new Map();
    const before = cfg.groups[gi]!.tags.length;
    const next = addTags(cfg, gi, names, types);
    this.edit(next);
    const added = next.groups[gi]!.tags.length - before;
    const dropped = names.length - added;
    if (dropped > 0)
      this.app.toast(t('hist.ed.tagsDropped', { n: dropped, max: MAX_TAGS_PER_GROUP }));
    this.query = '';
    this.open = false;
    this.hi = -1;
  }

  private upgrade = async (): Promise<void> => {
    const r = await this.app.store.upgrade('0.6');
    this.app.toast(r.ok ? t('hist.ed.upgraded') : t('hist.ed.upgradeFailed'));
  };

  private useMeasure = (): void => {
    const cfg = this.guard();
    const m = measureOf(this.app.session.info);
    if (!cfg || !m) return;
    const r = applyMeasure(cfg, m);
    if (r.changed === 0) return this.app.toast(t('hist.ed.measureNone'));
    this.edit(r.cfg);
    this.app.toast(t('hist.ed.measureApplied', { n: r.changed }));
  };

  // ---------- Thêm Tag ----------

  private suggestions(): string[] {
    const ids = [...(this.types()?.keys() ?? [])];
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
      if (pick) this.addTags([pick]);
    }
  };

  private onAddPaste = (e: ClipboardEvent): void => {
    const names = parseNameList(e.clipboardData?.getData('text/plain') ?? '');
    if (names.length > 1) {
      e.preventDefault();
      this.addTags(names);
    }
  };

  private onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types?.includes('application/x-mat-tag')) e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    if (!name) return;
    e.preventDefault();
    this.addTags([name]);
  };

  // ---------- Vẽ ----------

  private tbtn(
    act: string,
    label: string,
    onClick: () => void,
    o: { disabled?: boolean; reason?: string; ic?: Parameters<typeof icon>[0] } = {},
  ) {
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${o.disabled ? 'true' : nothing}
      title=${o.disabled && o.reason ? o.reason : label}
      @click=${() => (o.disabled ? o.reason && this.app.toast(o.reason) : onClick())}
    >
      ${icon(o.ic ?? 'plus')}<span>${label}</span>
    </button>`;
  }

  private banner() {
    const s = this.app.store.state;
    if (s.outline.format06) return nothing;
    return html`<div class="banner warn" role="status">
      ${icon('warn', 'warn')}
      <div>${t('hist.ed.upgradeBanner')}</div>
      <button class="btn sm" type="button" data-role="upgrade" @click=${this.upgrade}>
        ${t('hist.ed.upgradeBtn')}
      </button>
    </div>`;
  }

  private issuesBlock(b: LoggingIssueBuckets) {
    if (!b.file.length) return nothing;
    return html`<div class="le-issues" role="status" aria-label=${t('hist.ed.fileIssues')}>
      <b>${t('hist.ed.fileIssues')}</b>
      <ul>
        ${b.file.map(
          (i) =>
            html`<li class=${severityOf(i) === 'warning' ? 'warn' : 'err'}>
              <span class="mono">${i.code}</span> ${issueMsg(i)}
            </li>`,
        )}
      </ul>
    </div>`;
  }

  private connField(c: Connection, ci: number, f: ConnField, ro: boolean) {
    const id = `lec-${ci}-${f}`;
    const raw = (c as unknown as Record<string, unknown>)[f];
    const shown = raw === undefined ? '' : String(raw);
    // Địa chỉ viết tay có thể lỡ chứa tài khoản/mật khẩu/token: che và khóa ô, không bao giờ hiện lại (Constitution V).
    const masked = (f === 'url' || f === 'host') && maskAddress(shown) !== shown;
    const value = masked ? maskAddress(shown) : shown;
    const cfg = this.cfg()!;
    const commit = (v: string): void => {
      if (f === 'port') {
        const n = /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
        if (n === null && v.trim() !== '') return this.app.toast(t('hist.err.int'));
        return this.edit(setConnectionField(cfg, ci, f, n ?? undefined));
      }
      this.edit(setConnectionField(cfg, ci, f, v.trim()));
    };
    if (f === 'tls')
      return html`<div class="le-cf">
        <label for=${id}>${t('hist.conn.tls')}</label>
        <select
          id=${id}
          data-field=${`conn.${ci}.tls`}
          ?disabled=${ro}
          @change=${(e: Event) => commit((e.target as HTMLSelectElement).value)}
        >
          ${TLS_MODES.map((m) => html`<option value=${m} ?selected=${(c.tls ?? 'verify-full') === m}>${t(`hist.conn.tls.${m}`)}</option>`)}
        </select>
      </div>`;
    return html`<div class="le-cf">
      <label for=${id}>${t(`hist.conn.${f}`)}</label>
      <input
        id=${id}
        class=${f === 'timeZone' || f === 'port' ? 'mono num' : 'mono'}
        type="text"
        data-field=${`conn.${ci}.${f}`}
        autocomplete="off"
        spellcheck="false"
        ?disabled=${ro || masked}
        title=${masked ? t('hist.conn.masked') : nothing}
        .value=${live(value)}
        @change=${(e: Event) => commit((e.target as HTMLInputElement).value)}
      />
    </div>`;
  }

  private connections(b: LoggingIssueBuckets) {
    const cfg = this.cfg();
    if (!cfg) return nothing;
    const ro = this.readOnly();
    const conns = cfg.connections ?? [];
    return html`<section class="le-sec" data-role="connections">
      <div class="le-sech">
        <h3>${t('hist.conn.title')}</h3>
        <span class="grow"></span>
        ${this.tbtn(
          'add-conn',
          t('hist.conn.add'),
          () => {
            const c = this.guard();
            if (c) this.edit(addConnection(c));
          },
          { disabled: ro, reason: t('hist.ed.readOnlyToast') },
        )}
      </div>
      ${
        conns.length
          ? conns.map((c, ci) => {
              const msgs = b.conns.get(ci) ?? [];
              const typeId = `lec-${ci}-type`;
              return html`<fieldset class="le-conn" data-conn=${ci}>
                <legend class="mono">${c.id}</legend>
                <div class="le-cf">
                  <label for=${`lec-${ci}-id`}>${t('hist.conn.id')}</label>
                  <input
                    id=${`lec-${ci}-id`}
                    class="mono"
                    type="text"
                    data-field=${`conn.${ci}.id`}
                    autocomplete="off"
                    spellcheck="false"
                    ?disabled=${ro}
                    .value=${live(c.id)}
                    @change=${(e: Event) => this.edit(setConnectionField(cfg, ci, 'id', (e.target as HTMLInputElement).value))}
                  />
                </div>
                <div class="le-cf">
                  <label for=${typeId}>${t('hist.conn.type')}</label>
                  <select
                    id=${typeId}
                    data-field=${`conn.${ci}.type`}
                    ?disabled=${ro}
                    @change=${(e: Event) => this.edit(setConnectionField(cfg, ci, 'type', (e.target as HTMLSelectElement).value))}
                  >
                    ${CONNECTION_TYPES.map((x) => html`<option value=${x} ?selected=${c.type === x}>${t(`hist.conn.type.${x}`)}</option>`)}
                  </select>
                </div>
                ${(FIELDS_OF[c.type] ?? []).map((f) => this.connField(c, ci, f, ro))}
                <button
                  class="tbtn le-conn-del"
                  type="button"
                  data-act="del-conn"
                  aria-label=${t('hist.conn.remove', { id: c.id })}
                  ?disabled=${ro}
                  @click=${() => this.edit(removeConnection(cfg, c.id))}
                >
                  ${icon('x')}<span>${t('hist.conn.removeShort')}</span>
                </button>
                ${
                  msgs.length
                    ? html`<ul class="le-cerr">
                        ${msgs.map((i) => html`<li class=${severityOf(i) === 'warning' ? 'warn' : 'err'}>${issueMsg(i)}</li>`)}
                      </ul>`
                    : nothing
                }
              </fieldset>`;
            })
          : html`<p class="help">${t('hist.conn.none')}</p>`
      }
      <p class="help">${t('hist.conn.secrets')}</p>
    </section>`;
  }

  private addBox(ro: boolean) {
    const list = this.suggestions();
    const open = this.open && list.length > 0;
    return html`<div class="le-add">
      <input
        class="input sm mono"
        type="text"
        data-role="add-tag"
        role="combobox"
        aria-label=${t('hist.ed.addTag')}
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls="le-suggest"
        aria-autocomplete="list"
        aria-activedescendant=${open && this.hi >= 0 ? `le-opt-${this.hi}` : nothing}
        placeholder=${t('hist.ed.addTagPlaceholder')}
        autocomplete="off"
        spellcheck="false"
        ?disabled=${ro}
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
              id="le-suggest"
              class="le-suggest"
              role="listbox"
              aria-label=${t('hist.ed.suggest')}
            >
              ${list.map(
                (id, i) =>
                  html`<li
                    id="le-opt-${i}"
                    role="option"
                    class=${i === this.hi ? 'hi' : ''}
                    aria-selected=${i === this.hi ? 'true' : 'false'}
                    @mousedown=${(e: Event) => {
                      e.preventDefault();
                      this.addTags([id]);
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

  protected override render() {
    const s = this.app.store.state;
    if (!s.project) return nothing;
    const cfg = this.cfg();
    if (!cfg) return this.empty();
    const ro = this.readOnly();
    const a = this.adapters()!;
    const b = this.buckets();
    const gi = this.groupIndex();
    const group = gi >= 0 ? cfg.groups[gi]! : null;
    const readOnlyReason = t('hist.ed.readOnlyToast');
    return html`<div class="ed ed-fill le">
      <div class="ed-head">
        <h2>${t('tree.logging')}</h2>
        <span class="path">${s.outline.loggingFile}</span>
        <span class="grow"></span>
        ${
          b.hasErrors
            ? html`<span class="chip err" role="status">${t('hist.ed.hasErrors')}</span>`
            : nothing
        }
        <span class="help">${t('hist.ed.saveWithErrors')}</span>
      </div>
      ${this.banner()}${this.issuesBlock(b)}
      <div class="le-body">
        <div class="le-main">
          <section class="le-sec">
            <div class="le-sech">
              <h3>${t('hist.ed.groups')}</h3>
              <span class="grow"></span>
              ${this.tbtn('add-group', t('hist.ed.addGroup'), this.addGroupCmd, { disabled: ro, reason: readOnlyReason })}
              ${this.tbtn('dup-group', t('hist.ed.dupGroup'), this.dupGroupCmd, { disabled: ro || gi < 0, reason: ro ? readOnlyReason : t('hist.ed.noGroupSel'), ic: 'paste' })}
              ${this.tbtn('del-group', t('hist.ed.delGroup'), this.delGroupCmd, { disabled: ro || gi < 0, reason: ro ? readOnlyReason : t('hist.ed.noGroupSel'), ic: 'x' })}
              <span class="muted num" role="status"
                >${t('hist.ed.groupCount', { n: cfg.groups.length, max: MAX_GROUPS })}</span
              >
            </div>
            <div class="le-gridbox le-groups" data-grid="groups">
              <mat-grid
                .adapter=${a.groups}
                .state=${this.gridState('groups')}
                .label=${t('hist.ed.groups')}
                .issues=${messages(b.groupCells)}
                .warns=${messages(b.groupWarns)}
                @grid-state=${this.onGridState('groups')}
                @grid-edit=${this.onGridEdit}
                @grid-notice=${this.onGridNotice}
              ></mat-grid>
            </div>
          </section>
          <section class="le-sec">
            <div class="le-sech">
              <h3 data-role="tags-title">
                ${group ? t('hist.ed.tagsOf', { name: group.name || group.id }) : t('hist.ed.tagsNone')}
              </h3>
              <span class="grow"></span>
              ${group ? this.addBox(ro) : nothing}
              ${group ? this.tbtn('del-tags', t('hist.ed.delTags'), this.delTagsCmd, { disabled: ro, reason: readOnlyReason, ic: 'x' }) : nothing}
              ${group ? html`<span class="muted num" role="status">${t('hist.ed.tagCount', { n: group.tags.length, max: MAX_TAGS_PER_GROUP })}</span>` : nothing}
            </div>
            <div
              class="le-gridbox le-tags"
              data-grid="tags"
              @dragover=${this.onDragOver}
              @drop=${this.onDrop}
            >
              ${
                a.tags && group
                  ? html`<mat-grid
                      .adapter=${a.tags}
                      .state=${this.gridState(`tags:${gi}`)}
                      .label=${t('hist.ed.tagsOf', { name: group.name || group.id })}
                      .issues=${messages(b.tagCells.get(gi))}
                      .warns=${messages(b.tagWarns.get(gi))}
                      .dragColumn=${'tag'}
                      @grid-state=${this.onGridState('tags')}
                      @grid-edit=${this.onGridEdit}
                      @grid-notice=${this.onGridNotice}
                    ></mat-grid>`
                  : html`<div class="empty">
                      ${icon('table', 'lg')}<b>${t('hist.ed.noGroup')}</b>
                    </div>`
              }
              ${
                group && group.tags.length === 0
                  ? html`<div class="empty le-empty">
                      ${icon('table', 'lg')}<b>${t('hist.ed.noTags')}</b>
                      <p>${t('hist.ed.noTagsHelp')}</p>
                    </div>`
                  : nothing
              }
            </div>
          </section>
          ${this.connections(b)}
        </div>
        <aside class="le-side" role="region" tabindex="0" aria-label=${t('hist.est.title')}>
          <mat-estimate-panel
            .view=${this.estimate()}
            .online=${this.online()}
            @use-measure=${this.useMeasure}
          ></mat-estimate-panel>
        </aside>
      </div>
    </div>`;
  }

  private empty() {
    const s = this.app.store.state;
    const ro = this.readOnly();
    return html`<div class="ed ed-fill le">
      <div class="ed-head"><h2>${t('tree.logging')}</h2></div>
      ${this.banner()}
      <div class="empty">
        ${icon('db', 'lg')}<b>${t('hist.ed.none.title')}</b>
        <p>${t('hist.ed.none.text')}</p>
        ${
          s.outline.format06
            ? html`<button
                class="btn primary"
                type="button"
                data-act="create"
                ?disabled=${ro}
                @click=${() => this.edit(addGroup({ schemaVersion: '0.6.0', groups: [] }))}
              >
                ${t('hist.ed.create')}
              </button>`
            : nothing
        }
      </div>
    </div>`;
  }
}

customElements.define('mat-logging-editor', LoggingEditor);

registerEditor({
  match: (id) => id === 'logging',
  render: (app) => html`<mat-logging-editor .app=${app}></mat-logging-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-logging-editor': LoggingEditor;
  }
}
