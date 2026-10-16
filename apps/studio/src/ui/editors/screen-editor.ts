// Editor Màn hình 0.3 (feature 007, T112, FR-058, FR-067, FR-071): thanh công cụ + canvas, gắn lệnh của bảng lệnh vào hành
// động trên tài liệu màn hình (model/screen-doc.ts), nhận widget kéo từ Toolbox và Tag kéo từ Details, báo cho thanh trạng
// thái và ngữ cảnh lệnh. Màn hình 0.1 và 0.2 vẫn dùng `screen-preview.ts` (xem, kiểm tra, xem trước, nạp xuống nguyên trạng).
import { catalogWidget } from '@mat/project-schema';
import { html, nothing } from 'lit';
import type { CommandId } from '../../app/commands.ts';
import { bindTag } from '../../app/screen-bind.ts';
import { selectedInstances } from '../../app/template-actions.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  addWidget,
  alignItems,
  distributeItems,
  duplicate,
  matchSize,
  paste,
  remove,
  reorder,
  setHidden,
  setLocked,
} from '../../model/screen-doc.ts';
import type { AlignKind } from '../../model/screen-edit/align.ts';
import { copyItems } from '../../model/screen-edit/clipboard.ts';
import { inspectorModelOf } from '../../model/screen-catalog.ts';
import type { ReorderOp } from '../../model/screen-edit/layers.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import type { MatScreenCanvas } from '../screen/mat-screen-canvas.ts';
import '../screen/mat-screen-canvas.ts';
import '../screen/mat-screen-toolbar.ts';
import './screen-editor.css';

const ALIGN: Readonly<Partial<Record<CommandId, AlignKind>>> = {
  'screen.alignLeft': 'left',
  'screen.alignCenter': 'hcenter',
  'screen.alignRight': 'right',
  'screen.alignTop': 'top',
  'screen.alignMiddle': 'vmiddle',
  'screen.alignBottom': 'bottom',
};
const ORDER: Readonly<Partial<Record<CommandId, ReorderOp>>> = {
  'screen.toFront': 'front',
  'screen.toBack': 'back',
  'screen.forward': 'forward',
  'screen.backward': 'backward',
};

/** Mọi lệnh editor xử lý (bảng lệnh gọi `app.run(id)` rồi chạy handler này). */
const EDITOR_COMMANDS: readonly CommandId[] = [
  'screen.selectAll',
  'screen.copy',
  'screen.paste',
  'screen.duplicate',
  'screen.delete',
  ...(Object.keys(ALIGN) as CommandId[]),
  'screen.distributeH',
  'screen.distributeV',
  'screen.sameWidth',
  'screen.sameHeight',
  ...(Object.keys(ORDER) as CommandId[]),
  'screen.lock',
  'screen.hide',
  'screen.toggleGrid',
  'screen.toggleSnap',
  'screen.zoomIn',
  'screen.zoomOut',
  'screen.zoomFit',
  'screen.zoom100',
  'screen.previewOff',
  'screen.previewSim',
  'screen.previewDevice',
  'screen.toolSelect',
  'screen.toolHand',
];

/** Editor đang hiện (chỉ một): các handler đăng ký một lần ở app gọi vào đây. */
let current: MatScreenEditor | null = null;
const setCurrent = (e: MatScreenEditor | null): void => {
  current = e;
};

/** Menu ngữ cảnh của vùng chọn trên canvas (feature 011, FR-126): template và faceplate. */
const CTX_COMMANDS: readonly CommandId[] = [
  'screen.createTemplate',
  'screen.updateInstances',
  'screen.explodeInstance',
  'screen.faceplate',
];

export class MatScreenEditor extends AppElement {
  static override properties = { screenId: { attribute: false }, menu: { state: true } };
  declare screenId: string;
  declare menu: { x: number; y: number } | null;

  constructor() {
    super();
    this.screenId = '';
    this.menu = null;
  }

  protected override attached(): void {
    setCurrent(this);
    const app = this.app;
    for (const id of EDITOR_COMMANDS) app.setCommandHandler(id, () => current?.exec(id));
    app.hooks.addWidget = (type) => current?.addAtCenter(type);
    app.hooks.focusInspector = () => focusInspector();
  }

  protected override detached(): void {
    if (current === this) current = null;
  }

  private canvas(): MatScreenCanvas | null {
    return this.querySelector<MatScreenCanvas>('mat-screen-canvas');
  }

  private sel(): readonly string[] {
    return this.app.selectedItems(this.screenId);
  }

  /** Thêm widget vào tâm vùng nhìn (nhấp đúp Toolbox). */
  addAtCenter(type: string): void {
    const app = this.app;
    if (app.screens.previewMode !== 'off') {
      app.toast(t('reason.screenPreviewLocked'));
      return;
    }
    const spec = catalogWidget(type);
    const c = this.canvas()?.viewCenter() ?? { x: 0, y: 0 };
    const [w, h] = spec?.defaultSize ?? [0, 0];
    const at = { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
    const grid = app.screens.snap ? app.screens.gridSize : 0;
    const snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
    app.editScreen(this.screenId, (d) => addWidget(d, type, { x: snap(at.x), y: snap(at.y) }));
  }

  /** Thi hành lệnh của bảng lệnh trên màn hình đang mở. */
  exec(id: CommandId): void {
    const app = this.app;
    const sel = [...this.sel()];
    const sid = this.screenId;
    const edit = (fn: Parameters<typeof app.editScreen>[1], key?: string) =>
      app.editScreen(sid, fn, key);
    const ws = app.screens;
    const align = ALIGN[id];
    const order = ORDER[id];
    if (align) return void edit((d) => alignItems(d, sel, align));
    if (order !== undefined) return void edit((d) => reorder(d, sel, order));
    switch (id) {
      case 'screen.selectAll': {
        const doc = app.screenModel(sid);
        app.selectItems(
          sid,
          (doc?.items ?? []).filter((i) => i.locked !== true && i.hidden !== true).map((i) => i.id),
        );
        return;
      }
      case 'screen.copy': {
        const doc = app.screenModel(sid);
        const data = doc ? copyItems(doc, sel) : null;
        if (!data) return;
        ws.clipboard.set(data);
        app.toast(t('scr.copied', { n: data.items.length }));
        app.requestRender();
        return;
      }
      case 'screen.paste': {
        const clip = ws.clipboard.get();
        if (!clip) return;
        const known = app.store.state.outline.screens.map((s) => s.id);
        const r = edit((d) => paste(d, clip, undefined, known));
        if (r && 'missingTargets' in r && (r as { missingTargets: string[] }).missingTargets.length)
          app.toast(
            t('scr.pasteMissing', {
              list: (r as { missingTargets: string[] }).missingTargets.join(', '),
            }),
          );
        return;
      }
      case 'screen.duplicate':
        return void edit((d) => duplicate(d, sel));
      case 'screen.delete': {
        const n = sel.length;
        edit((d) => remove(d, sel));
        if (n) app.toast(t('scr.deleted', { n }));
        return;
      }
      case 'screen.distributeH':
        return void edit((d) => distributeItems(d, sel, 'x'));
      case 'screen.distributeV':
        return void edit((d) => distributeItems(d, sel, 'y'));
      case 'screen.sameWidth':
        return void edit((d) => matchSize(d, sel, 'width'));
      case 'screen.sameHeight':
        return void edit((d) => matchSize(d, sel, 'height'));
      case 'screen.lock':
      case 'screen.hide': {
        const items = (app.screenModel(sid)?.items ?? []).filter((i) => sel.includes(i.id));
        const key = id === 'screen.lock' ? 'locked' : 'hidden';
        const all = items.length > 0 && items.every((i) => i[key] === true);
        return void edit((d) =>
          id === 'screen.lock' ? setLocked(d, sel, !all) : setHidden(d, sel, !all),
        );
      }
      case 'screen.toggleGrid':
        ws.grid = !ws.grid;
        return app.requestRender();
      case 'screen.toggleSnap':
        ws.snap = !ws.snap;
        return app.requestRender();
      case 'screen.zoomIn':
        return this.canvas()?.zoomBy(1);
      case 'screen.zoomOut':
        return this.canvas()?.zoomBy(-1);
      case 'screen.zoomFit':
        return this.canvas()?.fit();
      case 'screen.zoom100':
        return this.canvas()?.zoomActual();
      case 'screen.toolSelect':
        ws.tool = 'select';
        return app.requestRender();
      case 'screen.toolHand':
        ws.tool = 'hand';
        return app.requestRender();
      case 'screen.previewOff':
      case 'screen.previewSim':
      case 'screen.previewDevice': {
        const mode =
          id === 'screen.previewOff' ? 'off' : id === 'screen.previewSim' ? 'sim' : 'device';
        const r = ws.setPreview(mode);
        if (!r.ok)
          app.toast(t('reason.locked', { label: t('preview.mode.device'), reason: r.reason }));
        return app.requestRender();
      }
      default:
        return;
    }
  }

  private readonly onTagDrop = (e: Event): void => {
    const { itemId, tagId } = (e as CustomEvent<{ itemId: string; tagId: string }>).detail;
    bindTag(this.app, this.screenId, itemId, tagId);
  };

  /** Lỗi hay "Dùng ở đâu" trỏ tới item: chọn, cuộn tới, mở nhóm inspector có ô đó và đưa focus vào ô. */
  private revealItem(): void {
    const app = this.app;
    const loc = app.takeReveal('screen');
    if (!loc || !('item' in loc) || loc.screen !== this.screenId) return;
    const doc = app.screenModel(this.screenId);
    const item = doc?.items.find((i) => i.id === loc.item);
    if (!doc || !item) return;
    app.selectItems(this.screenId, [item.id]);
    this.canvas()?.reveal(item.id);
    app.setInspectorTab('props');
    const field = loc.field ?? 'rect';
    let tab = 'general';
    if (field.startsWith('tag:')) tab = 'tags';
    else if (field === 'event') tab = 'events';
    else if (field === 'security') tab = 'security';
    else if (field.startsWith('prop:') && item.type === 'widget') {
      const g = inspectorModelOf(item.widget);
      const name = field.slice(5);
      if (g?.groups.security.some((f) => f.name === name)) tab = 'events';
      else if (g?.groups.display.some((f) => f.name === name)) tab = 'display';
    }
    app.screens.inspTab = tab;
    app.requestRender();
    // Sau khi inspector vẽ xong nhóm mới thì focus vào ô lỗi (thử lại tới ~0,5 s: nhóm vừa đổi nên vẽ chậm một nhịp).
    let tries = 0;
    const focusField = (): void => {
      const el = document.querySelector<HTMLElement>(
        `mat-widget-props [data-field="${field}"] :is(input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]))`,
      );
      if (el) el.focus();
      else if (++tries < 12) setTimeout(focusField, 40);
    };
    setTimeout(focusField, 40);
  }

  protected override updated(): void {
    this.revealItem();
    // Báo ngữ cảnh lệnh (số item chọn, clipboard, xem trước, loại màn hình): bảng lệnh và nút khóa theo đó.
    const app = this.app;
    const doc = app.screenModel(this.screenId);
    app.setUiContext({
      screenSel: this.sel().length,
      screenClip: app.screens.clipboard.get() !== null,
      screenPreview: app.screens.previewMode,
      screenIsPopup: doc?.kind === 'popup',
      screenTplSel: selectedInstances(app, this.screenId).length > 0,
    });
  }

  protected override render() {
    const doc = this.app.screenModel(this.screenId);
    if (!doc)
      return html`<div class="ed">
        <div class="empty">
          ${icon('screen', 'lg')}
          <p>${t('preview.noScreen', { id: this.screenId })}</p>
        </div>
      </div>`;
    return html`<div
      class="ed ed-fill se"
      @canvas-tag-drop=${this.onTagDrop}
      @contextmenu=${(e: MouseEvent) => this.onContextMenu(e)}
    >
      <mat-screen-toolbar .app=${this.app} .screenId=${this.screenId}></mat-screen-toolbar>
      ${this.readOnlyBanner()}
      <mat-screen-canvas .app=${this.app} .screenId=${this.screenId}></mat-screen-canvas>
      ${this.menuView()}
    </div>`;
  }

  /** Nhấp phải trên canvas: chọn item dưới con trỏ nếu chưa chọn, rồi hiện menu template của vùng chọn. */
  private onContextMenu(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target?.closest('mat-screen-canvas')) return;
    const hit = target.closest<HTMLElement>('[data-item]')?.dataset.item;
    if (hit && !this.sel().includes(hit)) this.app.selectItems(this.screenId, [hit]);
    e.preventDefault();
    this.openMenu(e.clientX, e.clientY);
  }

  /** Mở menu ngữ cảnh (cũng từ Shift+F10 của canvas); focus vào mục đầu. */
  openMenu(x: number, y: number): void {
    this.menu = { x, y };
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('.se-ctx .ctx-item')?.focus(),
    );
  }

  private closeMenu(): void {
    this.menu = null;
  }

  private menuView() {
    const m = this.menu;
    if (m === null) return nothing;
    return html`<div class="tree-ctx se-ctx">
      <div
        class="ctx-menu"
        role="menu"
        aria-label=${t('tpl.menu')}
        style=${`left:${m.x}px;top:${m.y}px`}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            this.closeMenu();
            this.querySelector<HTMLElement>('mat-screen-canvas [tabindex="0"]')?.focus();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = [...this.querySelectorAll<HTMLElement>('.se-ctx .ctx-item')];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[j]?.focus();
          }
        }}
        @focusout=${(e: FocusEvent) => {
          if (!this.querySelector('.se-ctx .ctx-menu')?.contains(e.relatedTarget as Node | null))
            this.closeMenu();
        }}
      >
        ${CTX_COMMANDS.map((id) => {
          const why = this.app.enabled(id);
          const on = why === true;
          return html`<button
            class="ctx-item"
            type="button"
            role="menuitem"
            data-cmd=${id}
            aria-disabled=${on ? 'false' : 'true'}
            title=${on ? '' : t(why as MessageKey)}
            @click=${() => {
              if (!on) return;
              this.closeMenu();
              void this.app.run(id);
            }}
          >
            <span class="lbl">${t(`cmd.${id}` as MessageKey)}</span>
          </button>`;
        })}
      </div>
    </div>`;
  }

  private readOnlyBanner() {
    return this.app.store.state.readOnly
      ? html`<div class="banner warn se-banner" role="status">
          ${icon('lock', 'warn')}
          <div>${t('scr.readOnly')}</div>
        </div>`
      : nothing;
  }
}

/** Enter ở canvas: focus vào ô đầu tiên của inspector. */
function focusInspector(): void {
  document
    .querySelector<HTMLElement>(
      'mat-inspector input:not([disabled]), mat-inspector select:not([disabled]), mat-inspector textarea:not([disabled])',
    )
    ?.focus();
}

customElements.define('mat-screen-editor', MatScreenEditor);

registerEditor({
  match: (id, app) =>
    id.startsWith('screen:') && app !== undefined && app.store.state.outline.schema === '0.3',
  render: (app, id) =>
    html`<mat-screen-editor
      .app=${app}
      .screenId=${id.slice('screen:'.length)}
    ></mat-screen-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-editor': MatScreenEditor;
  }
}
