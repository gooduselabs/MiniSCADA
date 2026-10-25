// Cây project (feature 004, T047, FR-004, FR-011, data-model §7): mẫu ARIA tree với focus ở vùng cây và
// aria-activedescendant trỏ mục đang chọn. ↑ ↓ di chuyển, → mở hoặc vào con, ← đóng hoặc lên cha,
// Home/End, Enter mở editor (contracts/commands.md). Mục của giai đoạn sau có nhãn giai đoạn (tắt được).
import { html, nothing, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { DiffStatus } from '@mat/project-schema';
import { commandById, type CommandId } from '../app/commands.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { deviceStateLabel, flattenTree, phaseLabel, type TreeRow } from '../model/tree.ts';
import { AppElement, icon } from './base.ts';

const itemId = (nodeId: string) => `ti-${nodeId}`;
const commandShortcut = (id: CommandId): string => commandById(id)?.shortcut ?? '';

/** Ký hiệu so với thiết bị (FR-029): lớp màu và câu đọc cho trình đọc màn hình (màu không là tín hiệu duy nhất). */
const DIFF_CLASS: Readonly<Record<DiffStatus, string>> = {
  '=': 'eq',
  '≠': 'ne',
  '+': 'add',
  '-': 'del',
};
const DIFF_TEXT: Readonly<Record<DiffStatus, MessageKey>> = {
  '=': 'compare.treeMark.=',
  '≠': 'compare.treeMark.≠',
  '+': 'compare.treeMark.+',
  '-': 'compare.treeMark.-',
};

/** Lệnh trên menu chuột phải của một nút (FR-043), theo thứ tự hiện. */
const MENU_COMMANDS: readonly CommandId[] = [
  'tree.add',
  'tree.rename',
  'tree.duplicate',
  'tree.remove',
];

/** Project 0.5 (alarm): menu thêm "Tạo alarm cho Tag…" (feature 009, FR-075). */
const ALARM_MENU: readonly CommandId[] = ['alarm.quickCreate'];

export class MatTree extends AppElement {
  private menuCommands(): readonly CommandId[] {
    const base = this.app.commandContext().version05
      ? [...MENU_COMMANDS, ...ALARM_MENU]
      : MENU_COMMANDS;
    // feature 015: Báo cáo và mẫu báo cáo có lệnh Thêm báo cáo (thư viện mẫu)
    const sel = this.menu?.nodeId ?? this.app.ui.treeSel ?? '';
    // feature 017: Kết nối và kênh có lệnh Thêm kênh Mitsubishi MC
    if (sel === 'connections' || sel.startsWith('channel:')) return [...base, 'connections.addMc'];
    if (sel === 'recipes' || sel.startsWith('recipe:')) return ['recipe.add', ...base];
    return sel === 'reports' || sel.startsWith('report:') ? ['report.add', ...base] : base;
  }

  static override properties = { menu: { state: true } };

  /** Menu chuột phải đang mở: nút, vị trí và mục đang chọn. */
  declare menu: { nodeId: string; x: number; y: number; hi: number } | null;

  constructor() {
    super();
    this.menu = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', t('shell.tree'));
    this.tabIndex = 0;
    this.addEventListener('keydown', this.onKey);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey);
    this.menuHost?.remove();
    this.menuHost = null;
    super.disconnectedCallback();
  }

  private rows(): TreeRow[] {
    if (!this.app.store.state.project) return [];
    return flattenTree(this.app.tree(), this.app.ui.expanded);
  }

  /** Menu chuột phải vẽ ở cuối document (không nằm trong role=tree: aria-required-children). */
  private menuHost: HTMLElement | null = null;

  protected override updated(): void {
    if (!this.menu) {
      this.menuHost?.remove();
      this.menuHost = null;
      return;
    }
    if (!this.menuHost) {
      this.menuHost = document.createElement('div');
      this.menuHost.className = 'tree-ctx';
      document.body.append(this.menuHost);
    }
    render(this.renderMenu(this.rows()), this.menuHost);
  }

  /** Mở menu chuột phải của nút (chuột phải, Shift+F10, phím Menu). */
  private openMenu(nodeId: string, x: number, y: number): void {
    this.app.selectNode(nodeId, false);
    this.menu = { nodeId, x, y, hi: 0 };
    void this.updateComplete.then(() =>
      this.menuHost?.querySelector<HTMLElement>('.ctx-menu')?.focus(),
    );
  }

  private closeMenu(refocus = true): void {
    this.menu = null;
    if (refocus) this.focus();
  }

  private runMenu(id: CommandId): void {
    this.closeMenu();
    void this.app.run(id);
  }

  private readonly onMenuKey = (e: KeyboardEvent): void => {
    const m = this.menu;
    if (!m) return;
    const commands = this.menuCommands();
    const n = commands.length;
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      this.closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.menu = { ...m, hi: (m.hi + (e.key === 'ArrowDown' ? 1 : n - 1)) % n };
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      this.menu = { ...m, hi: e.key === 'Home' ? 0 : n - 1 };
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.runMenu(commands[m.hi]!);
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.target === this && !e.altKey && !e.metaKey) {
      // Phím lệnh của cây (FR-043): chạy theo nút đang chọn; lệnh bị khóa thì báo lý do.
      const cmd: CommandId | null =
        e.key === 'Insert' && !e.ctrlKey && !e.shiftKey
          ? 'tree.add'
          : e.key === 'F2' && !e.ctrlKey && !e.shiftKey
            ? 'tree.rename'
            : e.key === 'Delete' && !e.ctrlKey && !e.shiftKey
              ? 'tree.remove'
              : e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd'
                ? 'tree.duplicate'
                : null;
      if (cmd) {
        e.preventDefault();
        void this.app.run(cmd);
        return;
      }
      if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
        const sel = this.app.ui.treeSel;
        const el = sel ? this.querySelector<HTMLElement>(`[id="${itemId(sel)}"]`) : null;
        if (sel && el) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          this.openMenu(sel, r.left + 24, r.bottom);
        }
        return;
      }
    }
    if (e.target !== this || e.ctrlKey || e.altKey || e.metaKey) return;
    const rows = this.rows();
    if (!rows.length) return;
    const app = this.app;
    let i = rows.findIndex((r) => r.node.id === app.ui.treeSel);
    const cur = i >= 0 ? rows[i] : null;
    const hasKids = (r: TreeRow | null) => !!r?.node.children?.length;
    switch (e.key) {
      case 'ArrowDown':
        i = cur ? Math.min(rows.length - 1, i + 1) : 0;
        break;
      case 'ArrowUp':
        i = cur ? Math.max(0, i - 1) : 0;
        break;
      case 'Home':
        i = 0;
        break;
      case 'End':
        i = rows.length - 1;
        break;
      case 'ArrowRight':
        if (!cur) i = 0;
        else if (hasKids(cur) && !app.ui.expanded.has(cur.node.id)) {
          e.preventDefault();
          app.toggleNode(cur.node.id);
          return;
        } else if (hasKids(cur)) i = i + 1;
        break;
      case 'ArrowLeft':
        if (!cur) i = 0;
        else if (hasKids(cur) && app.ui.expanded.has(cur.node.id)) {
          e.preventDefault();
          app.toggleNode(cur.node.id);
          return;
        } else if (cur.parentId) i = rows.findIndex((r) => r.node.id === cur.parentId);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (cur?.node.editor) app.selectNode(cur.node.id, true);
        else if (cur && hasKids(cur)) app.toggleNode(cur.node.id);
        return;
      default:
        return;
    }
    e.preventDefault();
    const next = rows[i];
    if (next && next.node.id !== app.ui.treeSel) app.selectNode(next.node.id, false);
    void this.updateComplete.then(() =>
      this.querySelector(`[id="${itemId(next.node.id)}"]`)?.scrollIntoView?.({
        block: 'nearest',
      }),
    );
  };

  private renderRow(row: TreeRow) {
    const app = this.app;
    const { node, level } = row;
    const hasKids = !!node.children?.length;
    const open = hasKids && app.ui.expanded.has(node.id);
    const selected = app.ui.treeSel === node.id;
    const showPhase = node.phase && app.workspace.showPhases;
    const title = node.phase
      ? t('tree.withPhase', { label: node.label, phase: phaseLabel(node.phase) })
      : node.label;
    return html`<div
      class="ti"
      id=${itemId(node.id)}
      role="treeitem"
      aria-level=${level}
      aria-selected=${selected ? 'true' : 'false'}
      aria-expanded=${hasKids ? (open ? 'true' : 'false') : nothing}
      title=${title}
      style=${styleMap({ paddingLeft: `${(level - 1) * 14 + 4}px` })}
      @click=${() => app.selectNode(node.id, true)}
      @dblclick=${() => hasKids && app.toggleNode(node.id)}
      @contextmenu=${(e: MouseEvent) => {
        e.preventDefault();
        this.openMenu(node.id, e.clientX, e.clientY);
      }}
    >
      <span
        class="tw"
        @click=${(e: Event) => {
          if (!hasKids) return;
          e.stopPropagation();
          app.toggleNode(node.id);
        }}
        >${hasKids ? icon(open ? 'chev-d' : 'chev-r', 'sm') : nothing}</span
      >
      ${
        node.deviceState
          ? html`<span
              class="sdot ${node.deviceState}"
              title=${deviceStateLabel(node.deviceState)}
            ></span>`
          : nothing
      }
      ${icon(node.icon)}
      <span class="lbl">${node.label}</span>
      ${node.sub ? html`<span class="sub">${node.sub}</span>` : nothing}
      <span class="end">
        ${
          node.diff
            ? html`<span class="cmp-sym ${DIFF_CLASS[node.diff]}" aria-hidden="true"
                  >${node.diff}</span
                ><span class="visually-hidden">${t(DIFF_TEXT[node.diff])}</span>`
            : nothing
        }
        ${node.status ? html`<span class="sdot ${node.status}" title=${node.status}></span><span class="visually-hidden">${node.status}</span>` : nothing}
        ${node.count !== undefined ? html`<span class="cnt">${node.count}</span>` : nothing}
        ${showPhase ? html`<span class="phase">${phaseLabel(node.phase!)}</span>` : nothing}
        ${
          node.deviceState && node.deviceState !== 'offline'
            ? html`<span class="visually-hidden">${deviceStateLabel(node.deviceState)}</span>`
            : nothing
        }
      </span>
    </div>`;
  }

  protected override render() {
    const rows = this.rows();
    // role=tree chỉ khi có mục: cây rỗng mà mang role=tree là lỗi ARIA (tree phải chứa treeitem).
    if (rows.length) this.setAttribute('role', 'tree');
    else this.removeAttribute('role');
    const sel = this.app.ui.treeSel;
    if (sel && rows.some((r) => r.node.id === sel))
      this.setAttribute('aria-activedescendant', itemId(sel));
    else this.removeAttribute('aria-activedescendant');
    if (!rows.length)
      return html`<div class="empty tree-empty">
        ${icon('project', 'lg')}
        <b>${t('tree.noProject')}</b>
        <p>${t('tree.noProjectHint')}</p>
      </div>`;
    return html`${repeat(
      rows,
      (r) => r.node.id,
      (r) => this.renderRow(r),
    )}`;
  }

  private renderMenu(rows: TreeRow[]) {
    const m = this.menu;
    if (!m) return nothing;
    const label = rows.find((r) => r.node.id === m.nodeId)?.node.label ?? '';
    return html`<div
      class="ctx-menu"
      role="menu"
      tabindex="-1"
      aria-label=${t('tree.menu', { label })}
      style=${styleMap({ left: `${m.x}px`, top: `${m.y}px` })}
      @keydown=${this.onMenuKey}
      @focusout=${(e: FocusEvent) => {
        if (!this.menuHost?.querySelector('.ctx-menu')?.contains(e.relatedTarget as Node | null))
          this.closeMenu(false);
      }}
    >
      ${this.menuCommands().map((id, i) => {
        const why = this.app.enabled(id);
        const on = why === true;
        return html`<button
          class="ctx-item${m.hi === i ? ' hi' : ''}"
          type="button"
          role="menuitem"
          data-cmd=${id}
          aria-disabled=${on ? 'false' : 'true'}
          title=${on ? '' : t(why as MessageKey)}
          @click=${() => on && this.runMenu(id)}
        >
          <span class="lbl">${t(`cmd.${id}` as MessageKey)}</span>
          <span class="sc">${commandShortcut(id)}</span>
        </button>`;
      })}
    </div>`;
  }
}

customElements.define('mat-tree', MatTree);

declare global {
  interface HTMLElementTagNameMap {
    'mat-tree': MatTree;
  }
}
