// Toolbox và nhập liệu canvas của trình vẽ SVG (feature 011, T162; FR-099, FR-101, FR-103, FR-115; contracts/svg-editor.md §8,
// §9; mockup studio-svg-draw cảnh 1: Toolbox dọc trong vùng editor). `CanvasInput` đổi sự kiện chuột, bánh xe, phím, clipboard
// của canvas thành lời gọi bộ điều khiển (`SvgEditor`) theo tọa độ tài liệu; lệnh có id đi qua `app.run` (cùng đường với bảng
// lệnh, menu chuột phải, nút thanh công cụ: lệnh bị khóa thì báo lý do).
import { html } from 'lit';
import { serializeSubtree, type NodeId, type Point } from '@mat/svg-edit';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import type { HandleId, Mods, SvgEditor, ToolId } from '../../model/svg/editor.ts';
import { resolveSvgKey, SVG_KEYS, type SvgCommandId } from '../../model/svg/keys.ts';
import { icon } from '../base.ts';
import type { MatSvgCanvas } from './canvas.ts';

export interface ToolDef {
  tool: ToolId;
  cmd: SvgCommandId;
  icon: IconName;
  label: MessageKey;
}

export const TOOLS: ReadonlyArray<ToolDef | null> = [
  { tool: 'select', cmd: 'svg.toolSelect', icon: 'pointer', label: 'cmd.svg.toolSelect' },
  { tool: 'node', cmd: 'svg.toolNode', icon: 'd-node', label: 'cmd.svg.toolNode' },
  null,
  { tool: 'rect', cmd: 'svg.toolRect', icon: 'd-rect', label: 'cmd.svg.toolRect' },
  { tool: 'ellipse', cmd: 'svg.toolEllipse', icon: 'd-ellipse', label: 'cmd.svg.toolEllipse' },
  { tool: 'line', cmd: 'svg.toolLine', icon: 'd-line', label: 'cmd.svg.toolLine' },
  { tool: 'poly', cmd: 'svg.toolPoly', icon: 'd-poly', label: 'cmd.svg.toolPoly' },
  { tool: 'text', cmd: 'svg.toolText', icon: 'text', label: 'cmd.svg.toolText' },
  null,
  { tool: 'hand', cmd: 'svg.toolHand', icon: 'hand', label: 'cmd.svg.toolHand' },
];

export const TOOL_OF: Readonly<Partial<Record<SvgCommandId, ToolId>>> = Object.fromEntries(
  TOOLS.filter((x): x is ToolDef => x !== null).map((x) => [x.cmd, x.tool]),
);

/** Toolbox dọc (nút bật/tắt có phím tắt), nút "Giới hạn có chủ ý" ở cuối. */
export function renderToolbox(app: StudioApp, ed: SvgEditor | null) {
  return html`<div
    class="sv-toolbox"
    role="toolbar"
    aria-orientation="vertical"
    aria-label=${t('svgd.toolbox')}
  >
    ${TOOLS.map((d) =>
      d === null
        ? html`<span class="sv-sep" aria-hidden="true"></span>`
        : html`<button
            type="button"
            class="sv-tool"
            data-tool=${d.tool}
            aria-pressed=${ed?.tool === d.tool ? 'true' : 'false'}
            aria-label=${`${t(d.label)} (${SVG_KEYS[d.cmd] ?? ''})`}
            title=${`${t(d.label)} (${SVG_KEYS[d.cmd] ?? ''})`}
            ?disabled=${!ed}
            @click=${() => void app.run(d.cmd)}
          >
            ${icon(d.icon)}<span class="k" aria-hidden="true">${SVG_KEYS[d.cmd]}</span>
          </button>`,
    )}
    <span class="grow"></span>
    <button
      type="button"
      class="sv-tool sv-limits"
      aria-label=${t('svgd.limits.title')}
      title=${t('svgd.limits.text')}
      @click=${() => app.toast(t('svgd.limits.text'))}
    >
      ${icon('info')}
    </button>
  </div>`;
}

const mods = (e: MouseEvent | KeyboardEvent): Mods => ({
  shift: e.shiftKey,
  alt: e.altKey,
  ctrl: e.ctrlKey || e.metaKey,
});

export interface InputHost {
  app: StudioApp;
  rel: string;
  editor(): SvgEditor | null;
  /** Áp xong một lô: vẽ lại các nút (null: cả tài liệu). */
  applied(targets: readonly NodeId[] | null): void;
  /** Vùng chọn, công cụ, lớp phủ đổi: vẽ lại phần giao diện (không đổi tài liệu). */
  refresh(): void;
  /** Mở ô nhập chữ của công cụ Văn bản. */
  openText(): void;
  /** Tọa độ con trỏ (thanh trạng thái), ghi thẳng vào DOM không qua Lit. */
  pointer(p: Point | null): void;
}

/** Sự kiện của canvas → bộ điều khiển. */
export class CanvasInput {
  private readonly canvas: MatSvgCanvas;
  private readonly host: InputHost;
  private down = false;
  private panning: { x: number; y: number } | null = null;
  private space = false;
  private nudging = false;
  private readonly off: Array<() => void> = [];
  /** Thời gian xử lý mỗi lần di chuột khi kéo (ms), để đo hiệu năng (T164). */
  readonly moveTimes: number[] = [];

  constructor(canvas: MatSvgCanvas, host: InputHost) {
    this.canvas = canvas;
    this.host = host;
  }

  attach(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      c.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => c.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', () => this.cancel());
    on('pointerleave', () => this.host.pointer(null));
    on('dblclick', (e) => this.onDouble(e));
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('keydown', (e) => this.onKey(e));
    on('keyup', (e) => this.onKeyUp(e));
    on('paste', (e) => this.onPaste(e));
    on('copy', (e) => this.onCopy(e, false));
    on('cut', (e) => this.onCopy(e, true));
  }

  detach(): void {
    for (const f of this.off.splice(0)) f();
  }

  private ed(): SvgEditor | null {
    return this.host.editor();
  }

  private onDown(e: PointerEvent): void {
    const ed = this.ed();
    if (!ed) return;
    this.canvas.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && (this.space || ed.tool === 'hand'))) {
      this.panning = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (ed.textTarget) return; // ô nhập chữ đang mở: thả chuột ngoài ô sẽ chốt (blur)
    const h = this.canvas.handleOf(e);
    const handle: HandleId | { point: number } | undefined =
      h === null
        ? undefined
        : h.startsWith('pt:')
          ? { point: Number(h.slice(3)) }
          : (h as HandleId);
    const p = this.canvas.toDoc(e.clientX, e.clientY);
    ed.zoom = this.canvas.zoom;
    ed.pointerDown(p, this.canvas.hitOf(e), mods(e), handle);
    this.down = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // jsdom, con trỏ giả
    }
    e.preventDefault();
    if (ed.textTarget) this.host.openText();
    this.canvas.drawOverlay();
    this.host.refresh();
  }

  private onMove(e: PointerEvent): void {
    const ed = this.ed();
    if (!ed) return;
    if (this.panning) {
      this.canvas.panBy(e.clientX - this.panning.x, e.clientY - this.panning.y);
      this.panning = { x: e.clientX, y: e.clientY };
      this.host.refresh();
      return;
    }
    const p = this.canvas.toDoc(e.clientX, e.clientY);
    this.host.pointer(p);
    if (!this.down && !(ed.tool === 'poly' && ed.polyPoints.length)) return;
    const t0 = performance.now();
    ed.pointerMove(p, mods(e));
    this.canvas.drawOverlay();
    if (this.down) this.moveTimes.push(performance.now() - t0);
    if (this.moveTimes.length > 2000) this.moveTimes.splice(0, 1000);
  }

  private onUp(e: PointerEvent): void {
    const ed = this.ed();
    if (this.panning) {
      this.panning = null;
      return;
    }
    if (!ed || !this.down) return;
    this.down = false;
    const r = ed.pointerUp(this.canvas.toDoc(e.clientX, e.clientY), mods(e));
    if (r?.ok) this.host.applied(r.targets);
    else {
      this.canvas.clearPreview();
      this.canvas.drawOverlay();
      if (ed.message) this.host.app.toast(ed.message);
    }
    this.host.refresh();
  }

  private cancel(): void {
    this.down = false;
    this.panning = null;
    this.ed()?.cancelGesture();
    this.canvas.clearPreview();
    this.canvas.drawOverlay();
  }

  private onDouble(e: MouseEvent): void {
    const ed = this.ed();
    if (!ed) return;
    const what = ed.doubleClick(this.canvas.toDoc(e.clientX, e.clientY), this.canvas.hitOf(e));
    if (what === 'text') this.host.openText();
    if (what === 'point' || what === 'poly') this.host.applied(null);
    this.canvas.drawOverlay();
    this.host.refresh();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey)
      this.canvas.zoomBy(Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
    else this.canvas.panBy(-e.deltaX, -e.deltaY);
    this.host.refresh();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target !== this.canvas) return;
    const ed = this.ed();
    if (!ed) return;
    // Ctrl+C/X/V: để trình duyệt phát sự kiện clipboard (onCopy, onPaste), không chặn
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      ['c', 'x', 'v'].includes(e.key.toLowerCase())
    )
      return;
    const a = resolveSvgKey(e);
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    switch (a.kind) {
      case 'command':
        void this.host.app.run(a.id);
        return;
      case 'nudge': {
        const step = a.grid ? ed.snap.gridSize : 1;
        const r = ed.nudge(a.dx * step, a.dy * step);
        this.nudging = true;
        if (r?.ok) this.host.applied(r.targets);
        else if (ed.message) this.host.app.toast(ed.message);
        return;
      }
      case 'tab':
        ed.selectNext(a.reverse);
        break;
      case 'enter': {
        if (ed.tool === 'poly' && ed.polyPoints.length) {
          const r = ed.finishPoly();
          if (r?.ok) this.host.applied(r.targets);
          break;
        }
        if (ed.enter() === 'text') this.host.openText();
        break;
      }
      case 'escape': {
        const what = ed.escape();
        if (what === 'poly') this.host.applied(null);
        this.canvas.clearPreview();
        break;
      }
      case 'pan':
        this.space = true;
        return;
    }
    this.canvas.drawOverlay();
    this.host.refresh();
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') this.space = false;
    if (this.nudging && e.key.startsWith('Arrow')) {
      this.nudging = false;
      this.ed()?.endNudge();
    }
  }

  private onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    this.host.app.svg.paste(this.host.rel, text);
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    const ed = this.ed();
    if (!ed || !ed.selection.length) return;
    e.preventDefault();
    const ws = this.host.app.svg;
    ws.copy(this.host.rel);
    // chép cả dạng chữ SVG để dán được sang tài liệu khác hoặc công cụ khác (đi lại qua allowlist khi dán)
    const parts = ed.selection.map((id) => serializeSubtree(ed.doc, id));
    const vb = ed.doc.viewBox;
    e.clipboardData?.setData(
      'text/plain',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}">${parts.join('')}</svg>`,
    );
    if (cut) ws.deleteSelection(this.host.rel);
  }
}
