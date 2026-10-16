// Trình vẽ SVG (feature 011, T162, T163; FR-097 đến FR-108, FR-115; contracts/svg-editor.md; mockup studio-svg-draw cảnh 1 đã
// duyệt ở T007): tab editor `svgdraw:<tệp>`. Bố cục kiểu IDE (studio-ux.md §5): thanh công cụ của trình vẽ trên cùng; Toolbox
// công cụ dọc bên trái trong vùng editor; canvas có thước, lưới, tay nắm, đường gióng; bên phải panel Lớp (trên) và Thuộc tính
// (dưới, tab Chung/Hình học/Hiển thị/Văn bản/Gắn Tag); dải trạng thái dưới. Thông tin tệp và cảnh báo (W_SVG_FONT, khóa sửa
// nút, khối giữ nguyên) hiện ở tab Thuộc tính của dock dưới (registry). Mọi lệnh có trong bảng lệnh (Ctrl+Shift+P).
import { html, nothing } from 'lit';
import {
  SVG_MAX_BYTES,
  SVG_MAX_DEPTH,
  SVG_MAX_NODES,
  SVG_UNDO_DEPTH,
  checkFont,
  editablePoints,
  inherited,
  opaqueBlockOf,
  subtreeStats,
  utf8Length,
  type AlignMode,
  type NodeId,
  type Point,
} from '@mat/svg-edit';
import type { StudioApp } from '../../app/app.ts';
import { commandById } from '../../app/commands.ts';
import { SVGDRAW, relOfEditor, type BoundRef } from '../../app/svg-workspace.ts';
import { t } from '../../i18n/index.ts';
import type { SvgEditor } from '../../model/svg/editor.ts';
import { SVG_COMMANDS, type SvgCommandId } from '../../model/svg/keys.ts';
import type { PropKey } from '../../model/svg/props.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor, registerProps, type InspectorView } from '../registry.ts';
import '../screen/mat-ruler.ts';
import './canvas.ts';
import type { MatSvgCanvas } from './canvas.ts';
import { renderInspector } from './inspector.ts';
import { renderLayers } from './layers-panel.ts';
import { renderTextInput } from './text-input.ts';
import { CanvasInput, TOOL_OF, renderToolbox } from './tools.ts';
import './svg-editor.css';

const ALIGN: Partial<Record<SvgCommandId, AlignMode>> = {
  'svg.alignLeft': 'left',
  'svg.alignCenter': 'centerH',
  'svg.alignRight': 'right',
  'svg.alignTop': 'top',
  'svg.alignMiddle': 'centerV',
  'svg.alignBottom': 'bottom',
};

const BAR: ReadonlyArray<ReadonlyArray<{ id: SvgCommandId; icon: Parameters<typeof icon>[0] }>> = [
  [
    { id: 'svg.group', icon: 'group' },
    { id: 'svg.ungroup', icon: 'ungroup' },
  ],
  [
    { id: 'svg.alignLeft', icon: 'align-l' },
    { id: 'svg.alignCenter', icon: 'align-c' },
    { id: 'svg.alignRight', icon: 'align-r' },
    { id: 'svg.alignTop', icon: 'align-t' },
    { id: 'svg.alignMiddle', icon: 'align-m' },
    { id: 'svg.alignBottom', icon: 'align-b' },
    { id: 'svg.distributeH', icon: 'dist-h' },
    { id: 'svg.distributeV', icon: 'dist-v' },
    { id: 'svg.sameWidth', icon: 'same-w' },
    { id: 'svg.sameHeight', icon: 'same-h' },
  ],
  [
    { id: 'svg.toFront', icon: 'front' },
    { id: 'svg.forward', icon: 'forward' },
    { id: 'svg.backward', icon: 'backward' },
    { id: 'svg.toBack', icon: 'back' },
  ],
];

const SNAPS: ReadonlyArray<{
  id: SvgCommandId;
  key: 'grid' | 'objects' | 'points' | 'angle';
  icon: Parameters<typeof icon>[0];
}> = [
  { id: 'svg.snapGrid', key: 'grid', icon: 'grid' },
  { id: 'svg.snapObjects', key: 'objects', icon: 'snap-el' },
  { id: 'svg.snapPoints', key: 'points', icon: 'snap-pt' },
  { id: 'svg.snapAngle', key: 'angle', icon: 'angle' },
];

/** Editor đang hiện (chỉ một): lệnh đăng ký một lần ở app gọi vào đây. */
let current: MatSvgEditor | null = null;
const setCurrent = (e: MatSvgEditor | null): void => {
  current = e;
};

/** Đo chữ bằng canvas 2D của trình duyệt (hộp bao chữ đúng hơn ước tính); jsdom không có thì ước tính. */
function browserMeasure():
  | ((
      text: string,
      f: { size: number; family: string; weight: string; style: string },
    ) => { width: number; ascent: number; descent: number })
  | undefined {
  if (typeof document === 'undefined') return undefined;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return undefined;
  const c = ctx;
  return (text, f) => {
    c.font = `${f.style} ${f.weight} ${f.size}px ${f.family}`;
    const m = c.measureText(text);
    return {
      width: m.width,
      ascent: m.actualBoundingBoxAscent || f.size * 0.8,
      descent: m.actualBoundingBoxDescent || f.size * 0.2,
    };
  };
}

export class MatSvgEditor extends AppElement {
  static override properties = {
    rel: { attribute: false },
    renaming: { state: true },
  };
  declare rel: string;
  declare renaming: string | null;
  private invalid = new Map<PropKey, string>();
  private input: CanvasInput | null = null;
  private inputFor: MatSvgCanvas | null = null;
  private attachedRel: string | null = null;
  private readonly onDocChange = (rel: string, targets: readonly NodeId[] | null) => {
    if (rel !== this.rel) return;
    this.canvasEl()?.sync(targets);
  };

  constructor() {
    super();
    this.rel = '';
    this.renaming = null;
  }

  protected override attached(): void {
    setCurrent(this);
    const app = this.app;
    for (const id of SVG_COMMANDS) app.setCommandHandler(id, () => current?.exec(id));
    app.svg.listeners.add(this.onDocChange);
    app.svg.measure ??= browserMeasure();
    void app.svg.ensure(this.rel);
  }

  protected override detached(): void {
    if (current === this) setCurrent(null);
    this.app.svg.listeners.delete(this.onDocChange);
    this.input?.detach();
    this.input = null;
    this.inputFor = null;
    this.saveView();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('rel') && this.hasApp && this.isConnected) {
      this.saveView();
      this.attachedRel = null;
      this.invalid.clear();
      void this.app.svg.ensure(this.rel);
    }
  }

  /** Thời gian xử lý mỗi lần di chuột khi kéo (ms), cho e2e hiệu năng (T164). */
  get moveTimes(): readonly number[] {
    return this.input?.moveTimes ?? [];
  }

  private canvasEl(): MatSvgCanvas | null {
    return this.querySelector('mat-svg-canvas');
  }

  ed(): SvgEditor | null {
    return this.hasApp ? this.app.svg.editor(this.rel) : null;
  }

  private saveView(): void {
    const cv = this.canvasEl();
    if (!cv || !this.attachedRel || !this.hasApp) return;
    const v = this.app.svg.view(this.attachedRel);
    v.zoom = cv.zoom;
    v.panX = cv.panX;
    v.panY = cv.panY;
  }

  protected override updated(): void {
    const cv = this.canvasEl();
    const s = this.app.svg.session(this.rel);
    const ed = this.ed();
    if (!cv || !s || !ed) return;
    if (this.inputFor !== cv) {
      this.input?.detach();
      this.input = new CanvasInput(cv, {
        app: this.app,
        rel: this.rel,
        editor: () => this.ed(),
        applied: (targets) => this.app.svg.changed(this.rel, targets),
        refresh: () => this.requestUpdate(),
        openText: () => this.requestUpdate(),
        pointer: (p) => this.showPointer(p),
      });
      this.input.attach();
      this.inputFor = cv;
    }
    const v = this.app.svg.view(this.rel);
    cv.host = {
      editor: () => this.ed(),
      showGrid: () => this.app.svg.view(this.rel).showGrid,
      guides: () => this.app.svg.state.guides(this.rel),
      layerHidden: (name) => this.app.svg.state.layer(this.rel, name).hidden,
      layerLocked: (name) => this.app.svg.state.layer(this.rel, name).locked,
    };
    if (this.attachedRel !== this.rel || cv.doc !== s.doc) {
      cv.zoom = v.zoom;
      cv.panX = v.panX;
      cv.panY = v.panY;
      cv.attach(s);
      this.attachedRel = this.rel;
      if (!v.fitted) {
        v.fitted = true;
        cv.fit();
      }
    } else {
      cv.applyLayers();
      cv.layout();
    }
    ed.zoom = cv.zoom;
    // rulers đi theo zoom và pan
    const vb = s.doc.viewBox;
    const rx = this.querySelector<HTMLElement & { zoom: number; pan: number; length: number }>(
      'mat-ruler[axis="x"]',
    );
    const ry = this.querySelector<HTMLElement & { zoom: number; pan: number; length: number }>(
      'mat-ruler[axis="y"]',
    );
    if (rx && ry) {
      rx.zoom = cv.zoom;
      rx.pan = cv.panX - vb.x * cv.zoom;
      rx.length = cv.clientWidth || 1200;
      ry.zoom = cv.zoom;
      ry.pan = cv.panY - vb.y * cv.zoom;
      ry.length = cv.clientHeight || 800;
    }
    const ta = this.querySelector<HTMLTextAreaElement>('textarea.sv-text');
    if (ta && document.activeElement !== ta) {
      ta.focus();
      ta.select();
    }
  }

  private showPointer(p: Point | null): void {
    const el = this.querySelector('.sv-ptr');
    if (el)
      el.textContent = p
        ? `X ${Math.round(p.x * 10) / 10}  Y ${Math.round(p.y * 10) / 10}`
        : 'X —  Y —';
  }

  /** Áp kết quả của một thao tác: vẽ lại nút, báo lý do khi bị từ chối. */
  private done(r: { ok: boolean; targets: readonly NodeId[] } | null | undefined): void {
    const ed = this.ed();
    if (r?.ok) this.app.svg.changed(this.rel, r.targets);
    else if (ed?.message) this.app.toast(ed.message);
    this.requestUpdate();
  }

  /** Thi hành lệnh `svg.*` (bảng lệnh, phím, thanh công cụ). */
  exec(id: SvgCommandId): void {
    const app = this.app;
    const ws = app.svg;
    const ed = this.ed();
    const cv = this.canvasEl();
    if (!ed) return;
    ed.message = null;
    const tool = TOOL_OF[id];
    if (tool) {
      ed.setTool(tool);
      cv?.drawOverlay();
      this.requestUpdate();
      return;
    }
    const align = ALIGN[id];
    if (align) return this.done(ed.align(align));
    switch (id) {
      case 'svg.selectAll':
        ed.selectAll();
        break;
      case 'svg.copy':
        if (ws.copy(this.rel)) app.toast(t('svgd.copied', { n: ed.selection.length }));
        break;
      case 'svg.cut':
        ws.cut(this.rel);
        break;
      case 'svg.paste':
        ws.paste(this.rel);
        break;
      case 'svg.duplicate':
        return this.done(ed.duplicate());
      case 'svg.delete':
        if (ed.tool === 'node' && ed.activePoint !== null) return this.done(ed.deleteActivePoint());
        ws.deleteSelection(this.rel);
        break;
      case 'svg.group':
        return this.done(ed.group());
      case 'svg.ungroup':
        return this.done(ed.ungroup());
      case 'svg.toFront':
        return this.done(ed.order('front'));
      case 'svg.toBack':
        return this.done(ed.order('back'));
      case 'svg.forward':
        return this.done(ed.order('forward'));
      case 'svg.backward':
        return this.done(ed.order('backward'));
      case 'svg.distributeH':
        return this.done(ed.distribute('h'));
      case 'svg.distributeV':
        return this.done(ed.distribute('v'));
      case 'svg.sameWidth':
        return this.done(ed.sameSize('width'));
      case 'svg.sameHeight':
        return this.done(ed.sameSize('height'));
      case 'svg.zoomIn':
        cv?.zoomBy(1.25);
        break;
      case 'svg.zoomOut':
        cv?.zoomBy(0.8);
        break;
      case 'svg.zoomFit':
        cv?.fit();
        break;
      case 'svg.toggleGrid': {
        const v = ws.view(this.rel);
        v.showGrid = !v.showGrid;
        cv?.layout();
        break;
      }
      case 'svg.snapGrid':
        ed.snap.grid = !ed.snap.grid;
        break;
      case 'svg.snapObjects':
        ed.snap.objects = !ed.snap.objects;
        break;
      case 'svg.snapPoints':
        ed.snap.points = !ed.snap.points;
        break;
      case 'svg.snapAngle':
        ed.snap.angle = !ed.snap.angle;
        break;
      case 'svg.addLayer':
        return this.done(ed.addLayer());
      case 'svg.rename': {
        ws.view(this.rel).ptab = 'common';
        this.requestUpdate();
        void this.updateComplete.then(() =>
          this.querySelector<HTMLInputElement>('#svp-name')?.focus(),
        );
        return;
      }
      case 'svg.closePath':
        return this.done(ed.toggleClosed());
      default:
        break;
    }
    cv?.drawOverlay();
    this.requestUpdate();
  }

  private boundUids(): Set<string> {
    const out = new Set<string>();
    const docs = this.app.store.state.docs;
    for (const s of this.app.store.state.outline.screens)
      for (const it of s.model?.items ?? []) {
        if (it.type !== 'svg' || it.svgFile !== this.rel) continue;
        const v = docs[it.bindingFile]?.value as
          { elements?: Array<{ elementUid: string }> } | null | undefined;
        for (const e of v?.elements ?? []) out.add(e.elementUid);
      }
    return out;
  }

  protected override render() {
    const app = this.app;
    const ws = app.svg;
    const s = ws.session(this.rel);
    const err = ws.errors.get(this.rel);
    if (!s)
      return html`<div class="ed sv">
        <div class="empty">
          ${icon(err ? 'err' : 'fsvg', 'lg')}
          <p>
            ${err ? t('svgd.openFailed', { file: this.rel, reason: err }) : t('svgd.opening', { file: this.rel })}
          </p>
        </div>
      </div>`;
    const ed = this.ed()!;
    const view = ws.view(this.rel);
    const cv = this.canvasEl();
    const map = cv ? cv.viewMap() : { zoom: 1, x: (v: number) => v, y: (v: number) => v };
    const readOnly = app.store.state.readOnly;
    const ctx = app.commandContext();
    const btn = (id: SvgCommandId, ic: Parameters<typeof icon>[0], pressed?: boolean) => {
      const spec = commandById(id);
      const ok = spec ? spec.enabled(ctx) : true;
      const label = t(`cmd.${id}` as const);
      return html`<button
        type="button"
        class="ibtn"
        data-cmd=${id}
        aria-label=${label}
        title=${ok === true ? label : `${label}: ${t(ok)}`}
        aria-disabled=${ok === true ? nothing : 'true'}
        aria-pressed=${pressed === undefined ? nothing : pressed ? 'true' : 'false'}
        @click=${() => void app.run(id)}
      >
        ${icon(ic)}
      </button>`;
    };
    const saved = ws.autosaver.lastSaved.get(this.rel);
    const scopeLabel = ed.scope !== null ? ed.label(ed.scope) : null;
    const sel = ed.selection;
    const selText =
      sel.length === 0
        ? t('svgd.status.noSel')
        : sel.length === 1
          ? t('svgd.status.one', {
              tag: ed.doc.nodes.get(sel[0])?.tag ?? '',
              name: ed.label(sel[0]),
            })
          : t('svgd.status.many', { n: sel.length });
    return html`<div class="ed ed-fill sv" data-rel=${this.rel}>
      <div class="toolbar sv-bar" role="toolbar" aria-label=${t('svgd.toolbar')}>
        <button
          type="button"
          class="ibtn"
          data-cmd="save"
          aria-label=${t('svgd.save')}
          title=${t('svgd.saveTip')}
          @click=${() => void app.run('project.save')}
        >
          ${icon('save')}
        </button>
        <button
          type="button"
          class="ibtn"
          data-cmd="undo"
          aria-label=${t('cmd.edit.undo')}
          title=${s.undo.undoLabel ? `${t('cmd.edit.undo')}: ${s.undo.undoLabel}` : t('cmd.edit.undo')}
          aria-disabled=${s.undo.canUndo ? nothing : 'true'}
          @click=${() => void app.run('edit.undo')}
        >
          ${icon('undo')}
        </button>
        <button
          type="button"
          class="ibtn"
          data-cmd="redo"
          aria-label=${t('cmd.edit.redo')}
          title=${t('cmd.edit.redo')}
          aria-disabled=${s.undo.canRedo ? nothing : 'true'}
          @click=${() => void app.run('edit.redo')}
        >
          ${icon('redo')}
        </button>
        <span class="mono sv-undo" title=${t('svgd.undoTip')}
          >${s.undo.undoSize}/${SVG_UNDO_DEPTH}</span
        >
        ${BAR.map((g) => html`<span class="tsep"></span>${g.map((b) => btn(b.id, b.icon))}`)}
        <span class="tsep"></span>
        <span class="tlabel">${t('svgd.snap')}</span>
        ${SNAPS.map((x) => btn(x.id, x.icon, ed.snap[x.key]))}
        <label class="row tlabel">
          <span class="visually-hidden">${t('svgd.gridStep')}</span>
          <select
            class="select sm"
            aria-label=${t('svgd.gridStep')}
            @change=${(e: Event) => {
              ed.snap.gridSize = Number((e.target as HTMLSelectElement).value);
              cv?.layout();
              this.requestUpdate();
            }}
          >
            ${[5, 10, 20].map((g) => html`<option value=${g} ?selected=${ed.snap.gridSize === g}>${t('svgd.grid', { n: g })}</option>`)}
          </select>
        </label>
        <label class="row tlabel"
          ><input
            type="checkbox"
            .checked=${view.showGrid}
            @change=${() => void app.run('svg.toggleGrid')}
          />${t('svgd.showGrid')}</label
        >
        <span class="grow"></span>
        ${readOnly ? html`<span class="chip warn">${icon('lock')}${t('reason.readOnly')}</span>` : nothing}
        <span class="chip ${s.dirty ? 'info' : 'ok'}" title=${t('svgd.autosaveTip')}
          >${icon('restore')}${saved ? t('svgd.autosaved', { s: Math.max(0, Math.round((Date.now() - saved) / 1000)) }) : s.dirty ? t('svgd.autosavePending') : t('svgd.autosaveClean')}</span
        >
      </div>
      <div class="sv-main">
        ${renderToolbox(app, ed)}
        <div class="sv-cv">
          <div class="sv-corner" title=${t('svgd.units')}>px</div>
          <mat-ruler axis="x"></mat-ruler>
          <mat-ruler axis="y"></mat-ruler>
          <div class="sv-vpw">
            ${scopeLabel !== null ? html`<div class="sv-crumb">${this.rel.split('/').pop()} › ${scopeLabel} · ${t('svgd.scopeHint')}</div>` : nothing}
            <mat-svg-canvas
              tabindex="0"
              role="application"
              aria-roledescription=${t('svgd.canvas.role')}
              aria-label=${t('svgd.canvas.label', { file: this.rel })}
              aria-describedby="sv-sel-live"
              class="tool-${ed.tool}"
            ></mat-svg-canvas>
            ${renderTextInput(ed.textTarget, map, {
              commit: (value) => {
                const r = ed.commitText(value);
                this.done(r);
                this.canvasEl()?.focus();
              },
            })}
            <div class="sv-zoom">
              <button
                type="button"
                class="ibtn sm"
                aria-label=${t('cmd.svg.zoomOut')}
                title=${t('cmd.svg.zoomOut')}
                @click=${() => void app.run('svg.zoomOut')}
              >
                ${icon('minus')}
              </button>
              <span class="mono" data-zoom>${Math.round((cv?.zoom ?? view.zoom) * 100)}%</span>
              <button
                type="button"
                class="ibtn sm"
                aria-label=${t('cmd.svg.zoomIn')}
                title=${t('cmd.svg.zoomIn')}
                @click=${() => void app.run('svg.zoomIn')}
              >
                ${icon('plus')}
              </button>
              <button
                type="button"
                class="ibtn sm"
                aria-label=${t('cmd.svg.zoomFit')}
                title=${t('cmd.svg.zoomFit')}
                @click=${() => void app.run('svg.zoomFit')}
              >
                ${icon('fit')}
              </button>
            </div>
          </div>
        </div>
        <aside class="sv-side" aria-label=${t('svgd.side')}>
          ${renderLayers({
            app,
            rel: this.rel,
            ed,
            renaming: this.renaming,
            setRenaming: (n) => {
              this.renaming = n;
              if (n !== null)
                void this.updateComplete.then(() =>
                  this.querySelector<HTMLInputElement>('.sv-lrename')?.focus(),
                );
            },
            bound: this.boundUids(),
            changed: (targets) => ws.changed(this.rel, targets),
            refresh: () => {
              this.canvasEl()?.drawOverlay();
              this.requestUpdate();
            },
          })}
          ${renderInspector({
            app,
            rel: this.rel,
            ed,
            view,
            invalid: this.invalid,
            setInvalid: (k, r) => {
              if (r === null) this.invalid.delete(k);
              else this.invalid.set(k, r);
              this.requestUpdate();
            },
            changed: (targets) => ws.changed(this.rel, targets),
            refresh: () => {
              this.canvasEl()?.drawOverlay();
              this.requestUpdate();
            },
            refs: (uid) => ws.bindingRefs(this.rel, [uid]),
          })}
        </aside>
      </div>
      <div class="sv-status">
        <span class="sb mono sv-ptr">X — Y —</span><span class="sb-sep"></span>
        <span class="sb">${Math.round((cv?.zoom ?? view.zoom) * 100)}%</span
        ><span class="sb-sep"></span>
        <span class="sb" id="sv-sel-live" aria-live="polite">${selText}</span
        ><span class="sb-sep"></span>
        <span class="sb"
          >${t('svgd.status.tool', { tool: t(`cmd.svg.tool${ed.tool[0].toUpperCase()}${ed.tool.slice(1)}` as 'cmd.svg.toolSelect') })}</span
        >
        <span class="grow"></span>
        ${ed.message ? html`<span class="sb warnc" role="status">${ed.message}</span><span class="sb-sep"></span>` : nothing}
        <span class="sb">${t('svgd.status.snap', { list: this.snapText(ed) })}</span>
      </div>
    </div>`;
  }

  private snapText(ed: SvgEditor): string {
    const s = ed.snap;
    const parts = [
      s.grid ? t('svgd.snap.grid', { n: s.gridSize }) : null,
      s.objects ? t('svgd.snap.objects') : null,
      s.points ? t('svgd.snap.points') : null,
      s.angle ? '15°' : null,
    ].filter((x): x is string => x !== null);
    return parts.length ? parts.join(', ') : t('svgd.snap.off');
  }
}

customElements.define('mat-svg-editor', MatSvgEditor);

registerEditor({
  match: (id) => id.startsWith(SVGDRAW),
  render: (app, id) => html`<mat-svg-editor .app=${app} .rel=${relOfEditor(id)!}></mat-svg-editor>`,
});

// ---------- thông tin tệp ở dock dưới (tab Thuộc tính của inspector Studio) ----------

interface FileIssues {
  version: number;
  at: number;
  depth: number;
  items: Array<{ code: string; what: string; text: string; sev: 'warn' | 'info' }>;
}
const issuesCache = new WeakMap<object, FileIssues>();

function fileIssues(app: StudioApp, rel: string): FileIssues | null {
  const s = app.svg.session(rel);
  const ed = app.svg.editor(rel);
  if (!s || !ed) return null;
  const hit = issuesCache.get(s.doc);
  // tài liệu lớn: không quét lại sau mỗi phím mũi tên (tối đa mỗi 1,5 s)
  if (hit && (hit.version === s.doc.version || Date.now() - hit.at < 1500)) return hit;
  const doc = s.doc;
  const items: FileIssues['items'] = [];
  for (const n of doc.nodes.values()) {
    if (items.length >= 50) break;
    if (n.tag === 'text') {
      const fam = inherited(doc, n.id, 'font-family') ?? 'sans-serif';
      if (checkFont(fam))
        items.push({
          code: 'W_SVG_FONT',
          what: ed.label(n.id),
          text: t('svgd.info.font', { font: fam }),
          sev: 'warn',
        });
    } else if (n.tag === 'path') {
      if (!editablePoints(doc, n.id).ok)
        items.push({
          code: t('svgd.info.lockedCode'),
          what: ed.label(n.id),
          text: t('svgd.note.curves'),
          sev: 'info',
        });
    } else if (opaqueBlockOf(doc, n.id) === n.id)
      items.push({
        code: t('svgd.info.opaqueCode'),
        what: ed.label(n.id),
        text: t('svgd.note.opaque'),
        sev: 'info',
      });
  }
  const rep = s.report;
  if (rep && rep.removedElements + rep.removedAttributes > 0)
    items.unshift({
      code: 'SVG_SANITIZED',
      what: rel,
      text: t('svgd.info.sanitized', { e: rep.removedElements, a: rep.removedAttributes }),
      sev: 'warn',
    });
  const v: FileIssues = {
    version: doc.version,
    at: Date.now(),
    depth: subtreeStats(doc, doc.root).depth,
    items,
  };
  issuesCache.set(s.doc, v);
  return v;
}

registerProps((app): InspectorView | null => {
  const rel = relOfEditor(app.store.state.active);
  if (rel === null) return null;
  const s = app.svg.session(rel);
  const info = fileIssues(app, rel);
  if (!s || !info)
    return {
      ctx: t('svgd.info.ctx', { file: rel }),
      body: html`<p class="help pad">${t('svgd.opening', { file: rel })}</p>`,
    };
  const vb = s.doc.viewBox;
  const bytes = s.dirty ? null : utf8Length(s.base.text);
  return {
    ctx: t('svgd.info.ctx', { file: rel }),
    body: html`<div class="sv-info">
      <p class="mono sv-info-line">
        ${rel} · viewBox ${vb.x} ${vb.y} ${vb.width} ${vb.height} ·
        ${t('svgd.info.nodes', { n: s.doc.elementCount, max: SVG_MAX_NODES.toLocaleString('vi-VN') })}
        · ${t('svgd.info.depth', { n: info.depth, max: SVG_MAX_DEPTH })} ·
        ${bytes === null ? t('svgd.info.unsaved') : t('svgd.info.size', { kb: Math.ceil(bytes / 1024), max: SVG_MAX_BYTES / 1024 / 1024 })}
      </p>
      ${
        info.items.length
          ? html`<ul class="sv-issues" aria-label=${t('svgd.info.list')}>
              ${info.items.map(
                (i) =>
                  html`<li class="issue">
                    ${icon(i.sev === 'warn' ? 'warn' : 'info', i.sev === 'warn' ? 'warn' : 'info')}<span
                      class="mono"
                      >${i.code}</span
                    ><span class="muted">${i.what}</span><span>${i.text}</span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="help pad">${t('svgd.info.clean')}</p>`
      }
    </div>`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-editor': MatSvgEditor;
  }
}

export type { BoundRef };
