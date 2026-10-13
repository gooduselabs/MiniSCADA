// Máy trạng thái cử chỉ của canvas Màn hình (feature 007, T104; contract studio-screen-editor §3).
// Thuần: nhận sự kiện đã đổi sang tọa độ thiết kế (kèm tọa độ màn hình để đo ngưỡng và pan) và trả
// danh sách lệnh cho canvas. Không đổi tài liệu: chỉ phát `preview` khi kéo và `commit` khi thả (đúng
// một bước hoàn tác mỗi cử chỉ). Esc/`cancel` hủy, không đổi gì.
import { catalogWidget, type Item, type Rect, type ScreenModel } from '@mat/project-schema';
import { addWidget, moveItems, resizeItems, type Rejection } from '../screen-doc.ts';
import { boundsOf } from './align.ts';
import { hitTest, itemsInRect } from './hit.ts';
import type { Handle, MinSizeOf } from './resize.ts';
import { snapBox, snapDrag, snapResizeDelta, type Guide, type SnapOptions } from './snap.ts';
import { panBy, type Pt, type Viewport } from './viewport.ts';

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  space: boolean;
}

export type GestureEvent =
  | { type: 'down'; point: Pt; screen: Pt; mods: Modifiers; button?: 0 | 1 | 2; handle?: Handle }
  | { type: 'move'; point: Pt; screen: Pt; mods: Modifiers }
  | { type: 'up'; point: Pt; screen: Pt; mods: Modifiers }
  | { type: 'key'; key: string; mods: Modifiers }
  | { type: 'cancel' }
  | { type: 'tool-over'; widget: string; point: Pt; mods: Modifiers }
  | { type: 'tool-drop'; widget: string; point: Pt; mods: Modifiers }
  | { type: 'tool-leave' };

/** Thông tin cho chú giải theo con trỏ (UI tự ghép chữ và đơn vị). */
export type TooltipInfo =
  { kind: 'move'; x: number; y: number } | { kind: 'size'; width: number; height: number };

export type GestureOutput =
  | { kind: 'select'; ids: string[] }
  /** Tài liệu tạm khi đang kéo (chưa vào lịch sử). */
  | { kind: 'preview'; doc: ScreenModel }
  /** Thả: ghi `doc` thành một bước hoàn tác; `mergeKey` riêng cho mỗi cử chỉ. */
  | { kind: 'commit'; doc: ScreenModel; mergeKey: string; selection: string[] }
  | { kind: 'guides'; guides: Guide[] }
  | { kind: 'marquee'; rect: Rect | null }
  | { kind: 'cursor'; cursor: string }
  | { kind: 'tooltip'; info: TooltipInfo | null }
  | { kind: 'viewport'; viewport: Viewport }
  /** Bỏ xem trước và trả canvas về tài liệu hiện có. */
  | { kind: 'cancel' }
  | { kind: 'rejected'; reason: Rejection };

export type GestureState = 'idle' | 'marquee' | 'moving' | 'resizing' | 'panning' | 'tool-drop';

export interface GestureContext {
  getDoc: () => ScreenModel;
  getSelection: () => readonly string[];
  getViewport: () => Viewport;
  getGrid: () => { size: number; snap: boolean };
  minSizeOf: MinSizeOf;
}

/** Ngưỡng bắt đầu kéo, điểm ảnh màn hình. */
export const DRAG_THRESHOLD_PX = 3;

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};
export const cursorOfHandle = (h: Handle): string => CURSORS[h];

type Phase =
  | { s: 'idle' }
  | {
      s: 'pending';
      kind: 'move' | 'resize' | 'marquee';
      startScreen: Pt;
      startPoint: Pt;
      additive: boolean;
      /** Item bị nhấn (kind = move). */
      hit: string | null;
      /** Item đó đã nằm trong vùng chọn lúc nhấn. */
      hitWasSelected: boolean;
      handle: Handle | null;
      baseSel: string[];
    }
  | {
      s: 'moving';
      startDoc: ScreenModel;
      startPoint: Pt;
      ids: string[];
      seq: number;
      last: ScreenModel;
    }
  | {
      s: 'resizing';
      startDoc: ScreenModel;
      startPoint: Pt;
      ids: string[];
      handle: Handle;
      seq: number;
      last: ScreenModel;
    }
  | { s: 'marquee'; startDoc: ScreenModel; startPoint: Pt; baseSel: string[]; additive: boolean }
  | { s: 'panning'; startScreen: Pt; startVp: Viewport }
  | { s: 'tool-drop' };

const norm = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});
const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const rectOf = (it: Item): Rect => ({ x: it.x, y: it.y, width: it.width, height: it.height });

export interface Gesture {
  handle(ev: GestureEvent): GestureOutput[];
  state(): GestureState;
}

export function createGesture(ctx: GestureContext): Gesture {
  let phase: Phase = { s: 'idle' };
  let seq = 0;

  const snapOpts = (doc: ScreenModel, excluded: ReadonlySet<string>, alt: boolean): SnapOptions => {
    const g = ctx.getGrid();
    return {
      grid: g.size,
      zoom: ctx.getViewport().zoom,
      snap: g.snap,
      alt,
      others: doc.items.filter((it) => !excluded.has(it.id) && it.hidden !== true).map(rectOf),
      screen: doc.size,
    };
  };

  const end = (...extra: GestureOutput[]): GestureOutput[] => [
    ...extra,
    { kind: 'guides', guides: [] },
    { kind: 'tooltip', info: null },
    { kind: 'cursor', cursor: 'default' },
  ];

  /** Hủy cử chỉ đang chạy: phát lệnh dọn dẹp tương ứng, không đổi tài liệu. */
  function abort(): GestureOutput[] {
    const p = phase;
    phase = { s: 'idle' };
    switch (p.s) {
      case 'moving':
      case 'resizing':
        return end({ kind: 'cancel' });
      case 'marquee':
        return end({ kind: 'marquee', rect: null }, { kind: 'cancel' });
      case 'panning':
        return end({ kind: 'viewport', viewport: p.startVp });
      case 'tool-drop':
        return end({ kind: 'cancel' });
      default:
        return [];
    }
  }

  function selectionAfterClick(p: Extract<Phase, { s: 'pending' }>): string[] | null {
    const cur = ctx.getSelection();
    let next: string[];
    if (p.kind === 'move' && p.hit !== null && p.hitWasSelected) {
      next = p.additive ? cur.filter((id) => id !== p.hit) : [p.hit];
    } else if (p.kind === 'marquee' && !p.additive) next = [];
    else return null;
    return sameIds(next, cur) ? null : next;
  }

  function down(ev: Extract<GestureEvent, { type: 'down' }>): GestureOutput[] {
    if (phase.s !== 'idle' && phase.s !== 'pending') return [];
    if (ev.button === 1 || ((ev.button ?? 0) === 0 && ev.mods.space)) {
      phase = { s: 'panning', startScreen: ev.screen, startVp: ctx.getViewport() };
      return [{ kind: 'cursor', cursor: 'grabbing' }];
    }
    if ((ev.button ?? 0) !== 0) return [];
    const doc = ctx.getDoc();
    const sel = ctx.getSelection();
    const additive = ev.mods.shift || ev.mods.ctrl;
    const base = {
      s: 'pending' as const,
      startScreen: ev.screen,
      startPoint: ev.point,
      additive,
      hit: null,
      hitWasSelected: false,
      handle: null,
      baseSel: [...sel],
    };
    if (ev.handle !== undefined && sel.length > 0) {
      phase = { ...base, kind: 'resize', handle: ev.handle };
      return [];
    }
    const hit = hitTest(doc.items, ev.point);
    if (hit === null) {
      phase = { ...base, kind: 'marquee', baseSel: additive ? [...sel] : [] };
      return [];
    }
    const inSel = sel.includes(hit);
    const out: GestureOutput[] = [];
    let now = [...sel];
    if (!inSel) {
      now = additive ? [...sel, hit] : [hit];
      out.push({ kind: 'select', ids: now });
    }
    phase = { ...base, kind: 'move', hit, hitWasSelected: inSel, baseSel: now };
    return out;
  }

  function startDrag(p: Extract<Phase, { s: 'pending' }>): void {
    const doc = ctx.getDoc();
    if (p.kind === 'marquee') {
      phase = {
        s: 'marquee',
        startDoc: doc,
        startPoint: p.startPoint,
        baseSel: p.baseSel,
        additive: p.additive,
      };
      return;
    }
    const ids = p.baseSel.filter((id) =>
      doc.items.some((it) => it.id === id && it.locked !== true),
    );
    if (ids.length === 0) {
      phase = { s: 'idle' };
      return;
    }
    seq += 1;
    phase =
      p.kind === 'move'
        ? { s: 'moving', startDoc: doc, startPoint: p.startPoint, ids, seq, last: doc }
        : {
            s: 'resizing',
            startDoc: doc,
            startPoint: p.startPoint,
            ids,
            handle: p.handle!,
            seq,
            last: doc,
          };
  }

  function drag(ev: { point: Pt; mods: Modifiers }): GestureOutput[] {
    const p = phase;
    if (p.s === 'moving') {
      let dx = ev.point.x - p.startPoint.x;
      let dy = ev.point.y - p.startPoint.y;
      if (ev.mods.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const rects = p.startDoc.items.filter((it) => p.ids.includes(it.id)).map(rectOf);
      const s = snapDrag(rects, dx, dy, snapOpts(p.startDoc, new Set(p.ids), ev.mods.alt));
      const res = moveItems(p.startDoc, p.ids, s.dx, s.dy);
      p.last = res.doc;
      const b = boundsOf(rects);
      return [
        { kind: 'preview', doc: res.doc },
        { kind: 'guides', guides: s.guides },
        { kind: 'tooltip', info: { kind: 'move', x: b.x + s.dx, y: b.y + s.dy } },
        { kind: 'cursor', cursor: 'move' },
      ];
    }
    if (p.s === 'resizing') {
      const rects = p.startDoc.items.filter((it) => p.ids.includes(it.id)).map(rectOf);
      let dx = ev.point.x - p.startPoint.x;
      let dy = ev.point.y - p.startPoint.y;
      let guides: Guide[] = [];
      const keepRatio = ev.mods.shift && p.handle.length === 2;
      if (!keepRatio) {
        const s = snapResizeDelta(
          boundsOf(rects),
          p.handle,
          dx,
          dy,
          snapOpts(p.startDoc, new Set(p.ids), ev.mods.alt),
        );
        dx = s.dx;
        dy = s.dy;
        guides = s.guides;
      }
      const res = resizeItems(
        p.startDoc,
        p.ids,
        p.handle,
        { dx, dy },
        {
          keepRatio,
          minSizeOf: ctx.minSizeOf,
        },
      );
      p.last = res.doc;
      const nb = boundsOf(res.doc.items.filter((it) => p.ids.includes(it.id)).map(rectOf));
      return [
        { kind: 'preview', doc: res.doc },
        { kind: 'guides', guides },
        { kind: 'tooltip', info: { kind: 'size', width: nb.width, height: nb.height } },
        { kind: 'cursor', cursor: cursorOfHandle(p.handle) },
      ];
    }
    if (p.s === 'marquee')
      return [
        { kind: 'marquee', rect: norm(p.startPoint, ev.point) },
        { kind: 'cursor', cursor: 'crosshair' },
      ];
    return [];
  }

  function move(ev: Extract<GestureEvent, { type: 'move' }>): GestureOutput[] {
    const p = phase;
    if (p.s === 'pending') {
      const d = Math.hypot(ev.screen.x - p.startScreen.x, ev.screen.y - p.startScreen.y);
      if (d < DRAG_THRESHOLD_PX) return [];
      startDrag(p);
      return drag(ev);
    }
    if (p.s === 'panning') {
      const vp = panBy(p.startVp, ev.screen.x - p.startScreen.x, ev.screen.y - p.startScreen.y);
      return [{ kind: 'viewport', viewport: vp }];
    }
    return drag(ev);
  }

  function up(ev: Extract<GestureEvent, { type: 'up' }>): GestureOutput[] {
    const p = phase;
    if (p.s === 'pending') {
      phase = { s: 'idle' };
      const next = selectionAfterClick(p);
      return next === null ? [] : [{ kind: 'select', ids: next }];
    }
    if (p.s === 'moving' || p.s === 'resizing') {
      drag(ev);
      phase = { s: 'idle' };
      if (p.last === p.startDoc || JSON.stringify(p.last) === JSON.stringify(p.startDoc))
        return end({ kind: 'cancel' });
      const key = `${p.s === 'moving' ? 'move' : 'resize'}#${p.seq}`;
      return end({ kind: 'commit', doc: p.last, mergeKey: key, selection: p.ids });
    }
    if (p.s === 'marquee') {
      phase = { s: 'idle' };
      const hits = itemsInRect(p.startDoc.items, norm(p.startPoint, ev.point));
      const ids = p.additive ? [...p.baseSel, ...hits.filter((h) => !p.baseSel.includes(h))] : hits;
      return end({ kind: 'marquee', rect: null }, { kind: 'select', ids });
    }
    if (p.s === 'panning') {
      phase = { s: 'idle' };
      return [{ kind: 'cursor', cursor: 'default' }];
    }
    return [];
  }

  /** Vị trí thả của widget từ Toolbox: góc trên trái, bắt dính theo hộp cỡ mặc định. */
  function dropAt(
    widget: string,
    point: Pt,
    mods: Modifiers,
  ): { doc: ScreenModel; res: ReturnType<typeof addWidget>; guides: Guide[] } {
    const doc = ctx.getDoc();
    const spec = catalogWidget(widget);
    const [w, h] = spec?.defaultSize ?? [0, 0];
    const s = snapBox(
      { x: point.x, y: point.y, width: w, height: h },
      snapOpts(doc, new Set(), mods.alt),
    );
    return { doc, res: addWidget(doc, widget, { x: s.x, y: s.y }), guides: s.guides };
  }

  function handle(ev: GestureEvent): GestureOutput[] {
    switch (ev.type) {
      case 'down':
        return down(ev);
      case 'move':
        return move(ev);
      case 'up':
        return up(ev);
      case 'key': {
        if (ev.key !== 'Escape') return [];
        if (phase.s === 'idle') {
          return ctx.getSelection().length > 0 ? [{ kind: 'select', ids: [] }] : [];
        }
        return abort();
      }
      case 'cancel':
        return abort();
      case 'tool-over': {
        const d = dropAt(ev.widget, ev.point, ev.mods);
        if (d.res.rejected !== undefined) {
          phase = { s: 'idle' };
          return [
            { kind: 'rejected', reason: d.res.rejected },
            { kind: 'cursor', cursor: 'not-allowed' },
          ];
        }
        phase = { s: 'tool-drop' };
        return [
          { kind: 'preview', doc: d.res.doc },
          { kind: 'guides', guides: d.guides },
          { kind: 'cursor', cursor: 'copy' },
        ];
      }
      case 'tool-drop': {
        const d = dropAt(ev.widget, ev.point, ev.mods);
        phase = { s: 'idle' };
        if (d.res.rejected !== undefined)
          return end({ kind: 'rejected', reason: d.res.rejected }, { kind: 'cancel' });
        seq += 1;
        const sel = d.res.selection ?? [];
        return end(
          { kind: 'commit', doc: d.res.doc, mergeKey: `add#${seq}`, selection: sel },
          { kind: 'select', ids: sel },
        );
      }
      case 'tool-leave':
        return phase.s === 'tool-drop' ? abort() : [];
    }
  }

  return { handle, state: () => (phase.s === 'pending' ? 'idle' : phase.s) };
}
