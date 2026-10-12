// Cây project (feature 004, T047, FR-004, FR-011, data-model §7): mẫu ARIA tree với focus ở vùng cây và
// aria-activedescendant trỏ mục đang chọn. ↑ ↓ di chuyển, → mở hoặc vào con, ← đóng hoặc lên cha,
// Home/End, Enter mở editor (contracts/commands.md). Mục của giai đoạn sau có nhãn giai đoạn (tắt được).
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { t } from '../i18n/index.ts';
import { deviceStateLabel, flattenTree, phaseLabel, type TreeRow } from '../model/tree.ts';
import { AppElement, icon } from './base.ts';

const itemId = (nodeId: string) => `ti-${nodeId}`;

export class MatTree extends AppElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', t('shell.tree'));
    this.tabIndex = 0;
    this.addEventListener('keydown', this.onKey);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey);
    super.disconnectedCallback();
  }

  private rows(): TreeRow[] {
    if (!this.app.store.state.project) return [];
    return flattenTree(this.app.tree(), this.app.ui.expanded);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
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
    return repeat(
      rows,
      (r) => r.node.id,
      (r) => this.renderRow(r),
    );
  }
}

customElements.define('mat-tree', MatTree);

declare global {
  interface HTMLElementTagNameMap {
    'mat-tree': MatTree;
  }
}
