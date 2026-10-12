// Vùng Details dưới cây project (feature 004, T047, studio-ux.md §3): danh sách theo editor đang mở —
// phần tử của màn hình đang mở, nhóm lưu trữ khi mở Lưu trữ, còn lại là danh sách Tag (kéo được, để gắn
// vào thuộc tính ở GĐ 3b). Mẫu ARIA listbox: một điểm dừng Tab, ↑ ↓ Home End, Enter mở mục.
import { html, nothing } from 'lit';
import type { StudioApp } from '../app/app.ts';
import { t } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { AppElement, icon } from './base.ts';

interface DetailRow {
  key: string;
  icon: IconName;
  label: string;
  hint: string;
  mono?: boolean;
  selected: boolean;
  drag?: string;
  open: () => void;
}

const optId = (key: string) => `dl-${key}`;

/** Tiêu đề vùng Details theo editor đang mở (khung vẽ ở thanh tiêu đề của vùng). */
export function detailsHeading(app: StudioApp): string {
  const active = app.store.state.active;
  if (active.startsWith('screen:')) {
    const id = active.slice('screen:'.length);
    const screen = app.store.state.outline.screens.find((s) => s.id === id);
    const name = typeof screen?.screen?.name === 'string' ? screen.screen.name : id;
    return t('details.elements', { screen: name });
  }
  if (active === 'logging') return t('details.groups');
  return t('details.tagsDrag');
}

export class MatDetails extends AppElement {
  private cursor: string | null = null;

  private rows(): DetailRow[] {
    const app = this.app;
    const s = app.store.state;
    if (!s.project) return [];
    const sel = s.selection;
    const active = s.active;
    if (active.startsWith('screen:')) {
      const id = active.slice('screen:'.length);
      const screen = s.outline.screens.find((x) => x.id === id);
      const elements = Array.isArray(screen?.screen?.elements) ? screen.screen.elements : [];
      return elements.map((e, i) => {
        const uid = typeof e.elementUid === 'string' ? e.elementUid : `#${i}`;
        const kind: IconName = e.kind === 'group' ? 'group' : e.kind === 'text' ? 'text' : 'shape';
        return {
          key: `el-${uid}`,
          icon: kind,
          label: typeof e.name === 'string' && e.name ? e.name : uid,
          hint: uid,
          mono: false,
          selected: sel?.kind === 'element' && sel.uid === uid,
          open: () => app.select({ kind: 'element', screen: id, uid }),
        };
      });
    }
    if (active === 'logging') {
      const groups = s.outline.logging?.groups ?? [];
      return groups.map((g, i) => ({
        key: `group-${i}`,
        icon: 'db' as const,
        label: typeof g.name === 'string' && g.name ? g.name : String(g.id ?? i),
        hint: t('details.groupTags', { n: Array.isArray(g.tags) ? g.tags.length : 0 }),
        selected: sel?.kind === 'group' && sel.index === i,
        open: () => app.select({ kind: 'group', index: i }),
      }));
    }
    const tags = s.outline.tags?.tags ?? [];
    return tags.map((tag, row) => {
      const id = typeof tag.id === 'string' && tag.id ? tag.id : t('details.unnamed');
      return {
        key: `tag-${row}`,
        icon: 'tag' as const,
        label: id,
        hint: typeof tag.type === 'string' ? tag.type : '',
        mono: true,
        selected: sel?.kind === 'tag' && sel.row === row,
        drag: typeof tag.id === 'string' ? tag.id : undefined,
        open: () => app.revealTag(row),
      };
    });
  }

  private onKey(e: KeyboardEvent, rows: DetailRow[]): void {
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.key === this.cursor);
    if (e.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = rows.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      (rows[i] ?? rows[0]).open();
      return;
    } else return;
    e.preventDefault();
    this.cursor = rows[Math.max(0, i)].key;
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.querySelector(`[id="${optId(this.cursor!)}"]`)?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  protected override render() {
    const rows = this.rows();
    if (!this.app.store.state.project)
      return html`<p class="help pad">${t('details.noProject')}</p>`;
    if (!rows.some((r) => r.key === this.cursor))
      this.cursor = rows.find((r) => r.selected)?.key ?? rows[0]?.key ?? null;
    return html`<div
      class="details-list"
      role="listbox"
      tabindex="0"
      aria-label=${detailsHeading(this.app)}
      aria-activedescendant=${this.cursor ? optId(this.cursor) : nothing}
      @keydown=${(e: KeyboardEvent) => this.onKey(e, rows)}
    >
      ${
        rows.length
          ? rows.map(
              (r) =>
                html`<div
                  class="dl-row ${r.selected ? 'sel' : ''} ${r.key === this.cursor ? 'cursor' : ''}"
                  id=${optId(r.key)}
                  role="option"
                  aria-selected=${r.selected ? 'true' : 'false'}
                  draggable=${r.drag ? 'true' : 'false'}
                  @dragstart=${(e: DragEvent) => {
                    if (!r.drag || !e.dataTransfer) return;
                    e.dataTransfer.setData('text/plain', r.drag);
                    e.dataTransfer.effectAllowed = 'link';
                  }}
                  @click=${() => {
                    this.cursor = r.key;
                    r.open();
                  }}
                >
                  ${icon(r.icon)}<span class=${r.mono ? 'mono' : ''}>${r.label}</span>
                  <span class="t">${r.hint}</span>
                </div>`,
            )
          : html`<p class="help pad" role="presentation">${t('details.empty')}</p>`
      }
    </div>`;
  }
}

customElements.define('mat-details', MatDetails);

declare global {
  interface HTMLElementTagNameMap {
    'mat-details': MatDetails;
  }
}
