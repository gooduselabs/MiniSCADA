// Editor Điều hướng của project 0.3 (feature 007, T117, FR-066; research R4): cây mục menu (lá trỏ tới màn hình, nhóm một cấp,
// tối đa 32 lá), kéo sắp xếp bằng chuột hoặc Alt+mũi tên, tạo nhóm, nhãn, màn hình đích (chỉ màn hình thường, không popup), biểu
// tượng trong bộ 16, vị trí menu và xem trước menu. Mọi sửa là một sửa đổi `navigation` của project.json (một bước hoàn tác;
// gõ nhãn gộp theo `mergeKey`). Thao tác thuần ở model/navigation-doc.ts.
import type { Navigation, NavigationItem } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import {
  NAV_ICONS,
  NAV_LABEL_MAX,
  NAV_MAX_LEAVES,
  addGroup,
  addLeaf,
  countLeaves,
  defaultNavigation,
  groupItems,
  moveNode,
  removeAt,
  renameAt,
  setIconAt,
  setPositionOf,
  setScreenAt,
  type NavPath,
  type NavResult,
  type ScreenRef,
} from '../../model/navigation-doc.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './navigation-editor.css';

/** Biểu tượng Studio cho từng tên trong bộ 16 của định dạng. */
const ICON_OF: Readonly<Record<string, IconName>> = {
  home: 'home',
  tank: 'tank',
  pump: 'pump',
  chart: 'line',
  table: 'table',
  gear: 'gear',
  bell: 'bell',
  bolt: 'pulse',
  thermo: 'gauge',
  drop: 'tank',
  valve: 'valve',
  motor: 'motor',
  list: 'list',
  map: 'screen',
  doc: 'report',
  user: 'users',
};

interface Row {
  path: NavPath;
  node: NavigationItem;
  level: 1 | 2;
  isGroup: boolean;
}

const key = (p: NavPath): string => p.join('.');

function rowsOf(nav: Navigation): Row[] {
  const out: Row[] = [];
  nav.items.forEach((it, i) => {
    const isGroup = it.items !== undefined;
    out.push({ path: [i], node: it, level: 1, isGroup });
    (it.items ?? []).forEach((c, j) =>
      out.push({ path: [i, j], node: c, level: 2, isGroup: false }),
    );
  });
  return out;
}

const nodeAt = (nav: Navigation, p: NavPath): NavigationItem | undefined =>
  p.length === 1 ? nav.items[p[0]!] : nav.items[p[0]!]?.items?.[p[1]!];

export class MatNavigationEditor extends AppElement {
  static override properties = {
    selected: { state: true },
    drag: { state: true },
    notice: { state: true },
  };
  declare selected: NavPath | null;
  declare drag: { from: NavPath; target: string; zone: 'before' | 'after' | 'into' } | null;
  declare notice: MessageKey | null;

  private dragStart: { path: NavPath; y: number; active: boolean } | null = null;

  constructor() {
    super();
    this.selected = null;
    this.drag = null;
    this.notice = null;
  }

  // ---------- Dữ liệu ----------

  private get nav(): Navigation | null {
    return this.app.store.state.outline.navigation;
  }

  private screens(): ScreenRef[] {
    return this.app.store.state.outline.screens.flatMap((s) =>
      // `kind` vắng nghĩa là màn hình thường.
      s.model
        ? [
            {
              id: s.id,
              kind: s.model.kind === 'popup' ? ('popup' as const) : ('screen' as const),
              name: s.model.name,
            },
          ]
        : [],
    );
  }

  private get editable(): boolean {
    return !this.app.store.state.readOnly;
  }

  private commit(r: NavResult, mergeKey?: string): boolean {
    if (r.rejected) {
      this.notice = `nav.err.${r.rejected}` as MessageKey;
      return false;
    }
    this.notice = null;
    if (r.nav !== this.nav) this.app.store.edit([{ kind: 'navigation', value: r.nav }], mergeKey);
    return true;
  }

  // ---------- Lệnh ----------

  private createDefault(): void {
    this.app.store.edit([{ kind: 'navigation', value: defaultNavigation(this.screens()) }]);
    this.selected = null;
  }

  private addLeafCmd(): void {
    const nav = this.nav;
    if (!nav) return;
    const used = new Set<string>();
    for (const r of rowsOf(nav)) if (r.node.screen) used.add(r.node.screen);
    const screens = this.screens();
    const pick =
      screens.find((s) => s.kind === 'screen' && !used.has(s.id)) ??
      screens.find((s) => s.kind === 'screen');
    if (!pick) {
      this.notice = 'nav.err.noScreen';
      return;
    }
    // Vào nhóm đang chọn nếu có, không thì cuối gốc.
    const sel = this.selected;
    const parent: NavPath | undefined =
      sel && sel.length >= 1 && nav.items[sel[0]!]?.items ? [sel[0]!] : undefined;
    const r = addLeaf(
      nav,
      { label: pick.name?.trim() || pick.id, screen: pick.id },
      screens,
      parent ? { parent } : {},
    );
    if (this.commit(r)) {
      const list = parent ? r.nav.items[parent[0]!]!.items! : r.nav.items;
      this.selected = parent ? [parent[0]!, list.length - 1] : [list.length - 1];
    }
  }

  private addGroupCmd(): void {
    const nav = this.nav;
    if (!nav) return;
    const r = addGroup(nav, t('nav.newGroup'));
    // Nhóm rỗng chưa hợp lệ: thêm ngay một lá vào nhóm để project không báo lỗi.
    if (r.rejected) return void this.commit(r);
    const gi = r.nav.items.length - 1;
    const screens = this.screens();
    const pick = screens.find((s) => s.kind === 'screen');
    if (!pick) return void this.commit(r);
    const r2 = addLeaf(r.nav, { label: pick.name?.trim() || pick.id, screen: pick.id }, screens, {
      parent: [gi],
    });
    if (this.commit(r2.rejected ? r : r2)) this.selected = [gi];
  }

  private removeCmd(): void {
    const nav = this.nav;
    const sel = this.selected;
    if (!nav || !sel) return;
    if (this.commit(removeAt(nav, sel))) this.selected = null;
  }

  private groupCmd(): void {
    const nav = this.nav;
    const sel = this.selected;
    if (!nav || !sel || sel.length !== 1 || nav.items[sel[0]!]?.items) return;
    if (this.commit(groupItems(nav, [sel], t('nav.newGroup')))) this.selected = [sel[0]!];
  }

  private moveBy(dir: -1 | 1): void {
    const nav = this.nav;
    const sel = this.selected;
    if (!nav || !sel) return;
    const parent = sel.length === 2 ? [sel[0]!] : [];
    const idx = sel[sel.length - 1]!;
    const to = idx + dir;
    const list = parent.length ? nav.items[parent[0]!]!.items! : nav.items;
    if (to < 0 || to >= list.length) return;
    if (this.commit(moveNode(nav, sel, parent, to)))
      this.selected = parent.length ? [parent[0]!, to] : [to];
  }

  // ---------- Kéo sắp xếp ----------

  private onGripDown(e: PointerEvent, path: NavPath): void {
    if (e.button !== 0 || !this.editable) return;
    e.preventDefault();
    this.dragStart = { path, y: e.clientY, active: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private onGripMove(e: PointerEvent): void {
    const s = this.dragStart;
    if (!s) return;
    if (!s.active && Math.abs(e.clientY - s.y) < 4) return;
    s.active = true;
    for (const r of this.querySelectorAll<HTMLElement>('.ne-row')) {
      const b = r.getBoundingClientRect();
      if (e.clientY < b.top || e.clientY >= b.bottom) continue;
      const frac = (e.clientY - b.top) / b.height;
      const grp = r.dataset.group === 'true';
      const zone = grp && frac > 0.3 && frac < 0.7 ? 'into' : frac < 0.5 ? 'before' : 'after';
      this.drag = { from: s.path, target: r.dataset.path!, zone };
    }
  }

  private onGripUp(e: PointerEvent): void {
    const s = this.dragStart;
    this.dragStart = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const d = this.drag;
    this.drag = null;
    const nav = this.nav;
    if (!s?.active || !d || !nav) return;
    const target = d.target.split('.').map(Number);
    const parent = target.length === 2 ? [target[0]!] : [];
    let toParent: NavPath;
    let index: number;
    if (d.zone === 'into') {
      toParent = target;
      index = nav.items[target[0]!]?.items?.length ?? 0;
    } else {
      toParent = parent;
      index = target[target.length - 1]! + (d.zone === 'after' ? 1 : 0);
      // Cùng danh sách và đi xuống: chỉ số đích tính sau khi rút nút nguồn ra.
      const same = key(parent) === key(s.path.length === 2 ? [s.path[0]!] : []);
      if (same && s.path[s.path.length - 1]! < index) index -= 1;
    }
    if (this.commit(moveNode(nav, s.path, toParent, index))) {
      this.selected = null;
    }
  }

  // ---------- Bàn phím ----------

  private onKey(e: KeyboardEvent, rows: Row[]): void {
    if (e.target !== e.currentTarget) return;
    const i = Math.max(
      0,
      rows.findIndex((r) => this.selected && key(r.path) === key(this.selected)),
    );
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.moveBy(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const go = (j: number) => {
      const to = rows[Math.min(rows.length - 1, Math.max(0, j))];
      if (to) this.selected = to.path;
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return go(this.selected ? i + 1 : 0);
      case 'ArrowUp':
        e.preventDefault();
        return go(this.selected ? i - 1 : 0);
      case 'Home':
        e.preventDefault();
        return go(0);
      case 'End':
        e.preventDefault();
        return go(rows.length - 1);
      case 'Delete':
        e.preventDefault();
        return this.removeCmd();
      case 'Enter':
        e.preventDefault();
        this.querySelector<HTMLElement>('#ne-label')?.focus();
        return;
      case 'Insert':
        e.preventDefault();
        return this.addLeafCmd();
    }
  }

  // ---------- Vẽ ----------

  private toolbar(nav: Navigation): TemplateResult {
    const ed = this.editable;
    const sel = this.selected;
    const node = sel ? nodeAt(nav, sel) : undefined;
    const canGroup = ed && !!node && sel!.length === 1 && node.items === undefined;
    return html`<div class="ed-tools ne-tools" role="toolbar" aria-label=${t('nav.toolbar')}>
      <button
        class="tbtn"
        type="button"
        data-act="add-leaf"
        ?disabled=${!ed || countLeaves(nav) >= NAV_MAX_LEAVES}
        @click=${() => this.addLeafCmd()}
      >
        ${icon('plus')}<span>${t('nav.addLeaf')}</span>
      </button>
      <button
        class="tbtn"
        type="button"
        data-act="add-group"
        ?disabled=${!ed || countLeaves(nav) >= NAV_MAX_LEAVES}
        @click=${() => this.addGroupCmd()}
      >
        ${icon('group')}<span>${t('nav.addGroup')}</span>
      </button>
      <button
        class="tbtn"
        type="button"
        data-act="group"
        ?disabled=${!canGroup}
        title=${t('nav.groupTip')}
        @click=${() => this.groupCmd()}
      >
        <span>${t('nav.group')}</span>
      </button>
      <span class="tsep"></span>
      <button
        class="ibtn"
        type="button"
        data-act="up"
        ?disabled=${!ed || !sel}
        aria-label=${t('nav.up')}
        title=${t('nav.up')}
        @click=${() => this.moveBy(-1)}
      >
        ${icon('forward')}
      </button>
      <button
        class="ibtn"
        type="button"
        data-act="down"
        ?disabled=${!ed || !sel}
        aria-label=${t('nav.down')}
        title=${t('nav.down')}
        @click=${() => this.moveBy(1)}
      >
        ${icon('backward')}
      </button>
      <button
        class="ibtn"
        type="button"
        data-act="remove"
        ?disabled=${!ed || !sel}
        aria-label=${t('nav.remove')}
        title=${t('nav.remove')}
        @click=${() => this.removeCmd()}
      >
        ${icon('x')}
      </button>
      <span class="grow"></span>
      <span class="muted">${t('nav.leaves', { n: countLeaves(nav), max: NAV_MAX_LEAVES })}</span>
    </div>`;
  }

  private rowView(r: Row, nav: Navigation): TemplateResult {
    const sel = this.selected && key(this.selected) === key(r.path);
    const d = this.drag;
    const over = d?.target === key(r.path) ? `over-${d.zone}` : '';
    const screen = r.node.screen ? this.app.screenModel(r.node.screen) : null;
    const broken = !r.isGroup && (!screen || screen.kind === 'popup');
    void nav;
    return html`<div
      class="ne-row lvl${r.level} ${sel ? 'sel' : ''} ${over} ${broken ? 'bad' : ''}"
      role="treeitem"
      id="ne-${key(r.path).replace('.', '-')}"
      aria-level=${r.level}
      aria-selected=${sel ? 'true' : 'false'}
      aria-expanded=${r.isGroup ? 'true' : nothing}
      data-path=${key(r.path)}
      data-group=${r.isGroup ? 'true' : 'false'}
      @click=${() => {
        this.selected = r.path;
      }}
    >
      <span
        class="grip"
        aria-hidden="true"
        title=${t('nav.dragTip')}
        @pointerdown=${(e: PointerEvent) => this.onGripDown(e, r.path)}
        @pointermove=${(e: PointerEvent) => this.onGripMove(e)}
        @pointerup=${(e: PointerEvent) => this.onGripUp(e)}
        >${icon('grip', 'sm')}</span
      >
      ${icon(r.isGroup ? 'group' : (ICON_OF[r.node.icon ?? ''] ?? 'screen'))}
      <span class="nm">${r.node.label}</span>
      ${
        r.isGroup
          ? html`<span class="sub">${t('nav.groupCount', { n: r.node.items?.length ?? 0 })}</span>`
          : html`<span class="sub mono">${screen ? screen.name : (r.node.screen ?? '')}</span>${
                broken
                  ? html`<span class="visually-hidden">${t('nav.brokenTarget')}</span>`
                  : nothing
              }`
      }
    </div>`;
  }

  private form(nav: Navigation): TemplateResult {
    const sel = this.selected;
    const node = sel ? nodeAt(nav, sel) : undefined;
    const ed = this.editable;
    if (!sel || !node) return html`<p class="help pad">${t('nav.selectHint')}</p>`;
    const isGroup = node.items !== undefined;
    const screens = this.screens().filter((s) => s.kind === 'screen');
    const bad = !isGroup && node.screen !== undefined && !screens.some((s) => s.id === node.screen);
    return html`<div class="ne-form">
      <div class="pf-row">
        <label class="pf-l" for="ne-label">${t('nav.label')}</label>
        <div class="pf-v">
          <input
            id="ne-label"
            class="pf-in"
            type="text"
            maxlength=${NAV_LABEL_MAX}
            autocomplete="off"
            ?disabled=${!ed}
            .value=${node.label}
            @input=${(e: Event) => {
              if ((e as InputEvent).isComposing) return;
              const v = (e.target as HTMLInputElement).value;
              if (v.trim() !== '') this.commit(renameAt(nav, sel, v), `nav-label:${key(sel)}`);
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      </div>
      ${
        isGroup
          ? nothing
          : html`<div class="pf-row ${bad ? 'bad' : ''}">
                <label class="pf-l" for="ne-screen">${t('nav.screen')}</label>
                <div class="pf-v">
                  <select
                    id="ne-screen"
                    class="pf-in"
                    ?disabled=${!ed}
                    @change=${(e: Event) =>
                      this.commit(
                        setScreenAt(
                          nav,
                          sel,
                          (e.target as HTMLSelectElement).value,
                          this.screens(),
                        ),
                      )}
                  >
                    ${bad ? html`<option value=${node.screen ?? ''} selected>${node.screen}</option>` : nothing}
                    ${screens.map(
                      (s) =>
                        html`<option value=${s.id} ?selected=${node.screen === s.id}>
                          ${s.name ?? s.id}
                        </option>`,
                    )}
                  </select>
                </div>
                ${bad ? html`<div class="pf-err" role="alert">${t('nav.brokenTarget')}</div>` : nothing}
              </div>
              <div class="pf-row">
                <label class="pf-l" for="ne-icon">${t('nav.icon')}</label>
                <div class="pf-v">
                  <select
                    id="ne-icon"
                    class="pf-in"
                    ?disabled=${!ed}
                    @change=${(e: Event) => {
                      const v = (e.target as HTMLSelectElement).value;
                      this.commit(setIconAt(nav, sel, v === '' ? null : v));
                    }}
                  >
                    <option value="" ?selected=${node.icon === undefined}>
                      ${t('nav.icon.none')}
                    </option>
                    ${NAV_ICONS.map(
                      (n) =>
                        html`<option value=${n} ?selected=${node.icon === n}>
                          ${t(`nav.icon.${n}` as MessageKey)}
                        </option>`,
                    )}
                  </select>
                </div>
              </div>`
      }
    </div>`;
  }

  private position(nav: Navigation): TemplateResult {
    const pos = nav.position ?? 'left';
    return html`<div class="pf-row ne-pos">
      <label class="pf-l" for="ne-pos">${t('nav.position')}</label>
      <div class="pf-v">
        <select
          id="ne-pos"
          class="pf-in"
          ?disabled=${!this.editable}
          @change=${(e: Event) =>
            this.commit(
              setPositionOf(
                nav,
                (e.target as HTMLSelectElement).value as 'left' | 'top' | 'hidden',
              ),
            )}
        >
          ${(['left', 'top', 'hidden'] as const).map(
            (p) =>
              html`<option value=${p} ?selected=${pos === p}>
                ${t(`nav.pos.${p}` as MessageKey)}
              </option>`,
          )}
        </select>
      </div>
    </div>`;
  }

  /** Xem trước menu: cùng thứ tự và biểu tượng như trang vận hành. */
  private previewMenu(nav: Navigation): TemplateResult {
    const pos = nav.position ?? 'left';
    if (pos === 'hidden') return html`<p class="help pad">${t('nav.pos.hiddenNote')}</p>`;
    return html`<nav class="ne-menu ${pos}" aria-label=${t('nav.preview')}>
      ${nav.items.map((it) =>
        it.items
          ? html`<div class="g">
              <span class="gh">${icon('group', 'sm')}${it.label}</span
              >${it.items.map((c) => this.menuLeaf(c))}
            </div>`
          : this.menuLeaf(it),
      )}
    </nav>`;
  }

  private menuLeaf(it: NavigationItem): TemplateResult {
    return html`<span class="mi"
      >${icon(ICON_OF[it.icon ?? ''] ?? 'screen', 'sm')}${it.label}</span
    >`;
  }

  protected override render() {
    const nav = this.nav;
    if (!nav)
      return html`<div class="ed ed-fill ne">
        <div class="empty">
          ${icon('menu', 'lg')}<b>${t('nav.none.title')}</b>
          <p>${t('nav.none.text')}</p>
          <button
            class="btn primary"
            type="button"
            data-act="create-default"
            ?disabled=${!this.editable}
            @click=${() => this.createDefault()}
          >
            ${icon('plus')}${t('nav.createDefault')}
          </button>
        </div>
      </div>`;
    const rows = rowsOf(nav);
    const active = this.selected ? `ne-${key(this.selected).replace('.', '-')}` : null;
    return html`<div class="ed ed-fill ne">
      ${this.toolbar(nav)}
      ${
        this.notice
          ? html`<div class="banner warn ne-note" role="alert">
              ${icon('warn', 'warn')}
              <div>${t(this.notice)}</div>
            </div>`
          : nothing
      }
      <div class="ne-body">
        <div class="ne-left">
          <div
            class="ne-tree"
            role="tree"
            tabindex="0"
            aria-label=${t('nav.tree')}
            aria-activedescendant=${active ?? nothing}
            @keydown=${(e: KeyboardEvent) => this.onKey(e, rows)}
          >
            ${rows.length ? rows.map((r) => this.rowView(r, nav)) : html`<p class="help pad">${t('nav.emptyTree')}</p>`}
          </div>
        </div>
        <div class="ne-right">
          ${this.position(nav)} ${this.form(nav)}
          <h3 class="wi-sub">${t('nav.preview')}</h3>
          ${this.previewMenu(nav)}
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-navigation-editor', MatNavigationEditor);

registerEditor({
  match: (id) => id === 'navigation',
  render: (app) => html`<mat-navigation-editor .app=${app}></mat-navigation-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-navigation-editor': MatNavigationEditor;
  }
}
