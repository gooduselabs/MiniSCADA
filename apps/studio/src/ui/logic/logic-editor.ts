// Editor Logic (feature 011, T144; FR-094, FR-096; mockup studio-logic.html cảnh 1 đã duyệt ở T007; studio-ux.md §5, §7):
// một tab "Logic" cho một logic.json (một lịch sử hoàn tác), thanh công cụ (Kiểm tra F7, Thêm khối ▾ Insert, Thử logic,
// Xóa Delete, Lên/Xuống, chip Ghi PLC khi Online, cảnh báo W_LOGIC_WRITES_OFF), thanh nhóm (Luật, Timer, Counter, Cộng dồn,
// Giờ chạy, Lịch, Ghi PLC), tìm, chỉ dòng lỗi, bảng khối (rules-table.ts), dòng đếm khối/giới hạn và ước tính ghi retain.
// Khung dưới (Inspector trái, Thông tin và Thử logic phải) là `mat-logic-dock` (logic-dock.ts).
import { html, nothing, type PropertyValues } from 'lit';
import { t } from '../../i18n/index.ts';
import { deviceSupport, formatBytes } from '../../model/device.ts';
import {
  KIND_LIMIT,
  LOGIC_KINDS,
  blockCounts,
  blocksOf,
  emptyLogic,
  issueTarget,
  moveBlock,
  retainBytesPerDay,
  type LogicKind,
} from '../../model/logic-doc.ts';
import { AppElement, icon } from '../base.ts';
import { registerDock, registerEditor } from '../registry.ts';
import { LOGIC_BLOCK_MIME, diagramCenter, dropLogicBlock } from './logic-card.ts';
import { KIND_ICON, kindLabel } from './logic-parts.ts';
import {
  addLogicBlock,
  editLogic,
  kindOf,
  logicDoc,
  logicIssues,
  logicUi,
  DOCK_HEIGHT,
  ensureDockHeight,
  removeLogicBlock,
  restoreDockHeight,
  select,
  selectedId,
  setDockTab,
  setKind,
  setView,
  startLive,
  stopLive,
  testDockHeight,
} from './logic-state.ts';
import { rulesTable } from './rules-table.ts';
import './logic-diagram.ts';
import './logic-dock.ts';
import './plc-chip.ts';
import './logic.css';

export class LogicEditor extends AppElement {
  private readonly onDoc = (e: Event): void => {
    const ui = logicUi(this.app);
    if (ui.menu && !this.querySelector('.lg-add')?.contains(e.target as Node)) {
      ui.menu = false;
      this.app.requestRender();
    }
  };

  protected override attached(): void {
    startLive(this.app);
    ensureDockHeight(
      this.app,
      logicUi(this.app).dockTab === 'test' ? testDockHeight(this.app) : DOCK_HEIGHT.info,
    );
    document.addEventListener('pointerdown', this.onDoc, true);
  }

  protected override detached(): void {
    stopLive(this.app);
    restoreDockHeight(this.app);
    document.removeEventListener('pointerdown', this.onDoc, true);
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    // Mở từ danh sách lỗi chung (tab Thông tin của khung, thanh trạng thái): nhảy tới khối và ô.
    const loc = this.app.takeReveal('logic');
    if (loc && loc.editor === 'logic') {
      const tg = issueTarget(logicDoc(this.app), loc.path);
      if (tg) {
        this.app.logicKind = tg.kind;
        if (tg.id) logicUi(this.app).sel[tg.kind] = tg.id;
        logicUi(this.app).focus = tg.id ? { id: tg.id, field: tg.field } : null;
      }
    }
  }

  private add(kind: LogicKind): void {
    addLogicBlock(this.app, kind, diagramCenter(this.app));
  }

  private removeSelected(): void {
    const app = this.app;
    const doc = logicDoc(app);
    const kind = kindOf(app);
    const id = selectedId(app, kind);
    if (!doc || !id) return;
    const list = blocksOf(doc, kind);
    const i = list.findIndex((b) => b.id === id);
    removeLogicBlock(app, kind, id);
    select(app, kind, list[i + 1]?.id ?? list[i - 1]?.id ?? null);
  }

  private move(delta: -1 | 1): void {
    const app = this.app;
    const doc = logicDoc(app);
    const kind = kindOf(app);
    const id = selectedId(app, kind);
    if (doc && id) editLogic(app, moveBlock(doc, kind, id, delta));
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || this.app.store.state.readOnly) return;
    if (e.key === 'Insert') {
      e.preventDefault();
      this.add(kindOf(this.app));
    } else if (e.key === 'Delete') {
      e.preventDefault();
      this.removeSelected();
    } else if (e.key === 'F2') {
      e.preventDefault();
      const id = selectedId(this.app);
      if (id) {
        logicUi(this.app).focus = { id, field: 'id' };
        this.app.requestRender();
      }
    }
  }

  private emptyView() {
    const app = this.app;
    const o = app.store.state.outline;
    if (!o.format10)
      return html`<div class="ed">
        <div class="empty">
          ${icon('logic', 'lg')}<b>${t('logic.empty.old')}</b>
          <p>${t('logic.empty.oldText')}</p>
        </div>
      </div>`;
    return html`<div class="ed">
      <div class="empty">
        ${icon('logic', 'lg')}
        <b>${t('logic.empty.title')}</b>
        <p>${t('logic.empty.text')}</p>
        <button
          type="button"
          class="btn primary"
          data-act="create"
          ?disabled=${app.store.state.readOnly}
          @click=${() => editLogic(app, emptyLogic())}
        >
          ${icon('plus')}${t('logic.empty.create')}
        </button>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const doc = logicDoc(app);
    if (!doc) return this.emptyView();
    const ui = logicUi(app);
    const kind = kindOf(app);
    const counts = blockCounts(doc);
    const ro = app.store.state.readOnly;
    const issues = logicIssues(app);
    const errors = issues.filter((i) => !i.code.startsWith('W_')).length;
    const sel = selectedId(app, kind);
    const online = app.online() && app.session.mode === 'online';
    const support = deviceSupport(app.session.info);
    const writesOff =
      online && support.logic && support.logicWrites === 'off' && (doc.writes ?? []).length > 0;
    const retain = retainBytesPerDay(doc, 60);
    const diagram = ui.view === 'diagram';
    return html`<div
      class="ed ed-fill lg-ed"
      @keydown=${(e: KeyboardEvent) => this.onKey(e)}
      @dragover=${(e: DragEvent) => {
        // Khối kéo từ task card "Khối / Tag": thả vào bảng là thêm khối nhóm đó.
        if (!ro && e.dataTransfer?.types.includes(LOGIC_BLOCK_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      @drop=${(e: DragEvent) => {
        if (!ro) dropLogicBlock(app, e);
      }}
    >
      <div class="ed-tools lg-tools" role="toolbar" aria-label=${t('logic.toolbar')}>
        <span class="seg lg-view" role="group" aria-label=${t('lgd.view')}>
          <button
            type="button"
            data-view="diagram"
            aria-pressed=${diagram ? 'true' : 'false'}
            title=${t('lgd.view.diagramTip')}
            @click=${() => setView(app, 'diagram')}
          >
            ${icon('d-node', 'sm')}${t('lgd.view.diagram')}
          </button>
          <button
            type="button"
            data-view="table"
            aria-pressed=${diagram ? 'false' : 'true'}
            title=${t('lgd.view.tableTip')}
            @click=${() => setView(app, 'table')}
          >
            ${icon('list', 'sm')}${t('lgd.view.table')}
          </button>
        </span>
        <span class="tsep"></span>
        <button
          type="button"
          class="tbtn"
          data-act="check"
          title=${t('logic.tb.checkTip')}
          @click=${() => void app.run('tools.validate')}
        >
          ${icon('check')}${t('logic.tb.check')}
        </button>
        <span class="lg-add">
          <button
            type="button"
            class="tbtn"
            data-act="add"
            aria-haspopup="menu"
            aria-expanded=${ui.menu ? 'true' : 'false'}
            title=${t('logic.tb.addTip')}
            ?disabled=${ro}
            @click=${() => {
              ui.menu = !ui.menu;
              app.requestRender();
              if (ui.menu)
                void this.updateComplete.then(() =>
                  this.querySelector<HTMLElement>('.lg-add [role="menuitem"]')?.focus(),
                );
            }}
          >
            ${icon('plus')}${t('logic.tb.add')}${icon('chev-d', 'sm')}
          </button>
          ${
            ui.menu
              ? html`<div
                  class="menu lg-menu"
                  role="menu"
                  aria-label=${t('logic.tb.add')}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Escape') {
                      ui.menu = false;
                      app.requestRender();
                      return;
                    }
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    const items = [
                      ...this.querySelectorAll<HTMLElement>('.lg-add [role="menuitem"]'),
                    ];
                    const i = items.indexOf(document.activeElement as HTMLElement);
                    items[
                      (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                    ]?.focus();
                  }}
                >
                  ${LOGIC_KINDS.map(
                    (k) =>
                      html`<button
                        type="button"
                        role="menuitem"
                        data-add=${k}
                        aria-disabled=${counts[k] >= KIND_LIMIT[k] ? 'true' : 'false'}
                        @click=${() => {
                          if (counts[k] < KIND_LIMIT[k]) this.add(k);
                        }}
                      >
                        ${icon(KIND_ICON[k])}${kindLabel(k)}<span class="grow"></span
                        ><span class="muted sm-text">${counts[k]}/${KIND_LIMIT[k]}</span>
                      </button>`,
                  )}
                  <div class="note">${t('logic.tb.limits')}</div>
                </div>`
              : nothing
          }
        </span>
        <button
          type="button"
          class="tbtn"
          data-act="test"
          title=${t('logic.tb.testTip')}
          @click=${() => setDockTab(app, 'test')}
        >
          ${icon('play')}${t('logic.dock.test')}
        </button>
        <span class="tsep"></span>
        <button
          type="button"
          class="tbtn"
          data-act="delete"
          title=${t('logic.tb.deleteTip')}
          ?disabled=${ro || !sel}
          @click=${() => this.removeSelected()}
        >
          ${icon('x')}${t('logic.tb.delete')}
        </button>
        ${
          diagram
            ? nothing
            : html`<button
                  type="button"
                  class="ibtn"
                  data-act="up"
                  aria-label=${t('logic.tb.up')}
                  title=${t('logic.tb.up')}
                  ?disabled=${ro || !sel}
                  @click=${() => this.move(-1)}
                >
                  ${icon('forward')}
                </button>
                <button
                  type="button"
                  class="ibtn"
                  data-act="down"
                  aria-label=${t('logic.tb.down')}
                  title=${t('logic.tb.down')}
                  ?disabled=${ro || !sel}
                  @click=${() => this.move(1)}
                >
                  ${icon('backward')}
                </button> `
        }
        <span class="grow"></span>
        ${
          errors
            ? html`<span class="chip err" data-role="dl-lock"
                >${icon('lock')}${t('logic.tb.locked', { n: errors })}</span
              >`
            : nothing
        }
        <mat-logic-chip .app=${app}></mat-logic-chip>
        ${
          writesOff
            ? html`<span class="chip warn" data-role="writes-off" title=${t('logic.writesOffTip')}
                >${icon('warn')}W_LOGIC_WRITES_OFF</span
              >`
            : nothing
        }
      </div>
      ${
        diagram
          ? html`<mat-logic-diagram class="lg-dia" .app=${app}></mat-logic-diagram>`
          : html`<div class="ed-tools lg-sub">
                <span class="seg lg-seg" role="group" aria-label=${t('logic.groups')}>
                  ${LOGIC_KINDS.map(
                    (k) =>
                      html`<button
                        type="button"
                        data-kind=${k}
                        aria-pressed=${k === kind ? 'true' : 'false'}
                        @click=${() => setKind(app, k)}
                      >
                        ${icon(KIND_ICON[k], 'sm')}${kindLabel(k)}
                      </button>`,
                  )}
                </span>
                <input
                  class="input sm"
                  data-role="search"
                  type="search"
                  placeholder=${t('logic.search')}
                  aria-label=${t('logic.search')}
                  .value=${ui.search}
                  @input=${(e: Event) => {
                    ui.search = (e.target as HTMLInputElement).value;
                    app.requestRender();
                  }}
                />
                <label class="row inline sm-text"
                  ><input
                    type="checkbox"
                    data-role="only-err"
                    .checked=${ui.onlyErr}
                    @change=${(e: Event) => {
                      ui.onlyErr = (e.target as HTMLInputElement).checked;
                      app.requestRender();
                    }}
                  />${t('logic.onlyErr')}</label
                >
                <span class="grow"></span>
                <span class="muted sm-text">${t('logic.keys')}</span>
              </div>
              <div class="gridwrap">${rulesTable(app, kind)}</div> `
      }
      <div class="lg-counts sm-text muted" role="status">
        ${LOGIC_KINDS.map((k) => `${kindLabel(k)} ${counts[k]}/${KIND_LIMIT[k]}`).join(' · ')} ·
        ${t('logic.retainEstimate', { size: formatBytes(retain) })}
      </div>
    </div>`;
  }
}

customElements.define('mat-logic-editor', LogicEditor);

registerEditor({
  match: (id) => id === 'logic',
  render: (app) => html`<mat-logic-editor .app=${app}></mat-logic-editor>`,
});
registerDock({
  match: (id) => id === 'logic',
  render: (app) => html`<mat-logic-dock .app=${app}></mat-logic-dock>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-editor': LogicEditor;
  }
}
