// Áp binding lên DOM của một màn hình (Master Plan §8.3; feature 008, contract binding-animation.md):
// gom cập nhật trong một requestAnimationFrame, chỉ ghi khi giá trị hiển thị đổi, hợp biến đổi thành một
// `style.transform` mỗi phần tử mỗi flush (giữ M0), quay/nhấp nháy/dòng chảy bằng Web Animations, tạm dừng
// hoạt ảnh khi tab ẩn, tôn trọng giảm chuyển động, hủy sạch khi đổi màn hình.
import type { ValueTable } from '@mat/expression';
import type {
  Binding04,
  ElementBindings,
  ElementBindings02,
  ElementEntry04,
  TagDataType,
} from '@mat/project-schema';
import {
  BLINK_EASING,
  DEFAULT_BLINK_PERIOD,
  DEFAULT_MIN_OPACITY,
  blinkKeyframes,
  blinkStartTime,
  blinkStaticOn,
  type BlinkMode,
} from './anim/blink.ts';
import { clipRect, type Box } from './anim/clip-level.ts';
import {
  BASE_SPEED,
  DEFAULT_DASH,
  dashTotal,
  flowDuration,
  flowKeyframes,
  flowReversed,
} from './anim/flow.ts';
import { SPIN_DURATION, spinFrames } from './anim/spin.ts';
import {
  buildTransform,
  readM0,
  scaleFactors,
  type Pivot,
  type TransformState,
} from './anim/transform-state.ts';
import { evaluateBinding, spinRps, type Quality, type TagValue } from './transforms.ts';

export interface TagUpdate {
  id: string;
  value: TagValue;
  quality: Quality;
}

export interface DomApplierOptions {
  /** elementUid → phần tử (từ mountScreen). */
  elements: Map<string, Element>;
  bindings: ElementBindings[] | ElementBindings02[] | ElementEntry04[];
  raf?: (cb: () => void) => unknown;
  isHidden?: () => boolean;
  doc?: Document;
  /** Kiểu Tag (từ tags.json): INT64/UINT64 đến dạng chuỗi thập phân được đổi sang số. */
  tagTypes?: Record<string, TagDataType>;
  /** Bảng giá trị của project theo tên (`valueTables` của projects/active), cho transform valueTable. */
  valueTables?: Record<string, ValueTable>;
  /** Tag → tên bảng của Tag (`valueTable` trong tags.json), khi binding không nêu `table`. */
  tagValueTables?: Record<string, string>;
  /** Đơn vị của Tag (cho `format.unitFromTag`). */
  tagUnits?: Record<string, string | undefined>;
  /** Đo hộp bao cục bộ; mặc định `el.getBBox()`. Test thay bằng hàm giả. */
  measure?: (el: Element) => Box;
  /** `prefers-reduced-motion`; mặc định `matchMedia('(prefers-reduced-motion: reduce)')`. */
  reducedMotion?: () => boolean;
  /** Đồng hồ trang cho pha nhấp nháy; mặc định `document.timeline.currentTime`. */
  now?: () => number;
}

const NS = 'http://www.w3.org/2000/svg';
const DEFAULT_PIVOT: Pivot = [0.5, 0.5];

/** Trạng thái hợp biến đổi của một phần tử (dùng chung cho các binding quay, dời, co giãn của nó). */
interface TState {
  el: Element;
  st: TransformState;
  /** Chuỗi đã ghi gần nhất. */
  last: string;
  spin?: Slot;
  spinKey?: string;
}

interface Slot {
  el: Element;
  binding: Binding04;
  last: string | number | undefined;
  /** Giá trị đầu ra gần nhất đã áp (để áp lại khi đổi giảm chuyển động). */
  out?: string | number;
  box?: Box;
  ts?: TState;
  anim?: Animation;
  /** Hoạt ảnh nên chạy (khi tab hiện): quay > 0, nhấp nháy bật, dòng chảy > 0. */
  active?: boolean;
  rate?: number;
  direction?: 'normal' | 'reverse';
  clip?: { cp: Element; rect: Element };
  warned?: boolean;
  dashSet?: boolean;
  savedTab?: string | null;
}

const isMotion = (b: Binding04): boolean =>
  b.target === 'effect.blink' || b.target === 'effect.flow' || b.animation === 'spin';

export class DomApplier {
  /** elementUid có binding nhưng không có trong SVG (đã bỏ qua). */
  readonly missing: string[] = [];
  /** Số lần ghi DOM (để đo/kiểm thử). */
  writes = 0;

  private readonly byTag = new Map<string, Slot[]>();
  private readonly pending = new Map<string, TagUpdate>();
  private readonly dirty = new Set<TState>();
  private readonly deferred = new Set<TState>();
  private readonly raf: (cb: () => void) => unknown;
  private readonly isHidden: () => boolean;
  private readonly doc: Document;
  private readonly tagTypes: Record<string, TagDataType>;
  private readonly valueTables: Record<string, ValueTable>;
  private readonly tagValueTables: Record<string, string>;
  private readonly tagUnits: Record<string, string | undefined>;
  private readonly measureFn: (el: Element) => Box;
  private readonly reducedFn: () => boolean;
  private readonly nowFn: () => number;
  private readonly mq: MediaQueryList | null;
  private scheduled = false;
  private disposed = false;
  private readonly onVisibility = () => this.syncAnimations();
  private readonly onMotion = () => this.refreshMotion();

  constructor(opt: DomApplierOptions) {
    this.doc = opt.doc ?? document;
    this.tagTypes = opt.tagTypes ?? {};
    this.valueTables = opt.valueTables ?? {};
    this.tagValueTables = opt.tagValueTables ?? {};
    this.tagUnits = opt.tagUnits ?? {};
    this.raf = opt.raf ?? ((cb) => requestAnimationFrame(cb));
    this.isHidden = opt.isHidden ?? (() => this.doc.hidden);
    this.measureFn = opt.measure ?? ((el) => (el as SVGGraphicsElement).getBBox());
    const win = this.doc.defaultView;
    this.mq =
      !opt.reducedMotion && typeof win?.matchMedia === 'function'
        ? win.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.reducedFn = opt.reducedMotion ?? (() => this.mq?.matches ?? false);
    this.nowFn =
      opt.now ??
      (() => Number(this.doc.timeline?.currentTime ?? win?.performance?.now() ?? Date.now()));

    const states = new Map<Element, TState>();
    for (const eb of opt.bindings as ElementEntry04[]) {
      const el = opt.elements.get(eb.elementUid);
      if (!el) {
        this.missing.push(eb.elementUid);
        continue;
      }
      for (const binding of eb.bindings ?? []) {
        const slot: Slot = { el, binding, last: undefined };
        this.init(slot, states);
        const list = this.byTag.get(binding.source.tagId) ?? [];
        list.push(slot);
        this.byTag.set(binding.source.tagId, list);
      }
    }
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.mq?.addEventListener?.('change', this.onMotion);
  }

  tagIds(): string[] {
    return [...this.byTag.keys()];
  }

  /** Số hoạt ảnh vô hạn đang tồn tại (quay, nhấp nháy bật, dòng chảy). */
  animationCount(): number {
    let n = 0;
    for (const list of this.byTag.values()) for (const s of list) if (s.anim) n++;
    return n;
  }

  update(changes: TagUpdate[]): void {
    if (this.disposed) return;
    for (const c of changes) {
      if (!this.byTag.has(c.id)) continue;
      const t = this.tagTypes[c.id];
      // Hiển thị chấp nhận mất chính xác > 2^53 (chỉ để vẽ); giá trị gốc vẫn là chuỗi.
      const wide = (t === 'INT64' || t === 'UINT64') && typeof c.value === 'string';
      this.pending.set(c.id, wide ? { ...c, value: Number(c.value) } : c);
    }
    if (this.pending.size && !this.scheduled) {
      this.scheduled = true;
      this.raf(() => this.flush());
    }
  }

  flush(): void {
    this.scheduled = false;
    if (this.disposed) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const ts of this.deferred) this.dirty.add(ts); // hộp bao chưa có: thử lại
    this.deferred.clear();
    for (const c of batch)
      for (const slot of this.byTag.get(c.id) ?? []) {
        try {
          this.apply(slot, c);
        } catch (e) {
          console.warn('binding', slot.binding.id, e); // một binding lỗi không chặn binding khác
        }
      }
    this.commitDirty();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.dirty.clear();
    this.deferred.clear();
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.mq?.removeEventListener?.('change', this.onMotion);
    for (const list of this.byTag.values())
      for (const s of list) {
        s.anim?.cancel();
        s.anim = undefined;
        if (s.clip) {
          s.clip.cp.remove();
          s.el.removeAttribute('clip-path');
          s.clip = undefined;
        }
      }
  }

  // ---- dựng ---------------------------------------------------------------------------------------------

  private measure(el: Element): Box | null {
    try {
      const b = this.measureFn(el);
      return b.width === 0 && b.height === 0 ? null : b;
    } catch {
      return null; // chưa có layout (jsdom, phần tử ẩn): hoãn tới lần áp kế
    }
  }

  private init(slot: Slot, states: Map<Element, TState>): void {
    const { el, binding } = slot;
    const t = binding.target;
    if (t === 'geometry.levelPercent') {
      // Hộp bao đo một lần (không gọi getBBox mỗi lần cập nhật để tránh layout thrash).
      const n = (a: string) => Number(el.getAttribute(a) ?? 0);
      slot.box = { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
    } else if (t === 'geometry.clipLevel') {
      this.ensureClip(slot);
    } else if (
      t === 'transform.rotate' ||
      t === 'transform.translateX' ||
      t === 'transform.translateY' ||
      t === 'transform.scale'
    ) {
      let ts = states.get(el);
      if (!ts) {
        ts = {
          el,
          last: '',
          st: {
            m0: readM0(el.getAttribute('transform')),
            bbox: null,
            translate: null,
            rotate: null,
            scale: null,
          },
        };
        const style = (el as SVGElement).style;
        style.setProperty('transform-origin', '0 0');
        style.setProperty('transform-box', 'view-box');
        states.set(el, ts);
      }
      if ((t === 'transform.translateX' || t === 'transform.translateY') && !ts.st.translate)
        ts.st.translate = { x: 0, y: 0 };
      if (t === 'transform.rotate' || t === 'transform.scale') ts.st.bbox ??= this.measure(el);
      slot.ts = ts;
      if (binding.animation === 'spin') ts.spin = slot;
    }
  }

  private ensureClip(slot: Slot): boolean {
    if (slot.clip) return true;
    const el = slot.el;
    if (slot.warned) return false;
    slot.box ??= this.measure(el) ?? undefined;
    if (!slot.box) return false; // chưa đo được: thử lại ở lần áp kế
    if (el.hasAttribute('clip-path')) {
      slot.warned = true;
      console.warn('clipLevel: phần tử đã có clip-path, bỏ qua', el.getAttribute('data-mat-uid'));
      return false;
    }
    const svg = el.closest('svg');
    if (!svg) return false;
    let defs = [...svg.children].find((c) => c.localName === 'defs');
    if (!defs) {
      defs = this.doc.createElementNS(NS, 'defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    const id = `mat-clip-${el.getAttribute('data-mat-uid') ?? 'x'}`;
    const cp = this.doc.createElementNS(NS, 'clipPath');
    cp.setAttribute('id', id);
    cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const rect = this.doc.createElementNS(NS, 'rect');
    this.setRect(rect, slot.box);
    cp.append(rect);
    defs.append(cp);
    el.setAttribute('clip-path', `url(#${id})`);
    slot.clip = { cp, rect };
    return true;
  }

  private setRect(rect: Element, r: Box): void {
    rect.setAttribute('x', String(r.x));
    rect.setAttribute('y', String(r.y));
    rect.setAttribute('width', String(r.width));
    rect.setAttribute('height', String(r.height));
  }

  // ---- áp giá trị ---------------------------------------------------------------------------------------

  private apply(slot: Slot, c: TagUpdate): void {
    const out = evaluateBinding(slot.binding, c.value, c.quality, {
      tables: this.valueTables,
      tagTable: this.tagValueTables[c.id],
      unit: this.tagUnits[c.id],
    });
    if (out.hold || out.value === slot.last) return;
    slot.last = out.value;
    slot.out = out.value;
    this.run(slot, out.value);
  }

  private run(slot: Slot, v: string | number): void {
    const el = slot.el;
    const style = (el as SVGElement).style;
    const b = slot.binding;
    const ts = slot.ts;
    switch (b.target) {
      case 'style.fill':
        this.writes++;
        style.setProperty('fill', String(v));
        break;
      case 'style.stroke':
        this.writes++;
        style.setProperty('stroke', String(v));
        break;
      case 'style.opacity':
        this.writes++;
        style.setProperty('opacity', String(v));
        break;
      case 'style.visibility':
        this.writes++;
        this.visibility(slot, String(v));
        break;
      case 'text.content':
        this.writes++;
        el.textContent = String(v);
        break;
      case 'transform.rotate':
        if (!ts) break;
        if (b.animation === 'spin') {
          slot.rate = spinRps(Number(v));
          ts.st.rotate = { angle: 0, pivot: b.pivot ?? DEFAULT_PIVOT };
        } else {
          ts.st.rotate = { angle: Number(v), pivot: b.pivot ?? DEFAULT_PIVOT };
        }
        this.dirty.add(ts);
        break;
      case 'transform.translateX':
        if (ts?.st.translate) ts.st.translate.x = Number(v);
        if (ts) this.dirty.add(ts);
        break;
      case 'transform.translateY':
        if (ts?.st.translate) ts.st.translate.y = Number(v);
        if (ts) this.dirty.add(ts);
        break;
      case 'transform.scale':
        if (!ts) break;
        ts.st.scale = { ...scaleFactors(Number(v), b.axis), pivot: b.pivot ?? DEFAULT_PIVOT };
        this.dirty.add(ts);
        break;
      case 'geometry.levelPercent':
        this.level(slot, Number(v));
        break;
      case 'geometry.clipLevel':
        if (!this.ensureClip(slot)) {
          slot.last = undefined; // thử lại khi có hộp bao
          break;
        }
        this.writes++;
        this.setRect(slot.clip!.rect, clipRect(slot.box!, b.direction ?? 'up', Number(v)));
        break;
      case 'effect.blink':
        this.blink(slot, Number(v) === 1);
        break;
      case 'effect.flow':
        this.flow(slot, Number(v));
        break;
    }
  }

  private visibility(slot: Slot, v: string): void {
    const el = slot.el;
    const style = (el as SVGElement).style;
    style.setProperty('visibility', v);
    if (v === 'hidden') {
      style.setProperty('pointer-events', 'none');
      if (el.hasAttribute('tabindex') && slot.savedTab === undefined) {
        slot.savedTab = el.getAttribute('tabindex');
        el.setAttribute('tabindex', '-1');
      }
    } else {
      style.removeProperty('pointer-events');
      if (slot.savedTab !== undefined) {
        if (slot.savedTab === null) el.removeAttribute('tabindex');
        else el.setAttribute('tabindex', slot.savedTab);
        slot.savedTab = undefined;
      }
    }
  }

  private level(slot: Slot, percent: number): void {
    if (slot.el.localName !== 'rect') {
      if (!slot.warned) {
        slot.warned = true;
        console.warn(
          'levelPercent chỉ dùng cho rect; dùng clipLevel cho hình khác',
          slot.binding.id,
        );
      }
      return;
    }
    this.writes++;
    const b = slot.box!;
    const p = percent / 100;
    const el = slot.el;
    const fmt = (x: number) => String(Math.round(x * 100) / 100);
    const dir = slot.binding.direction ?? 'up';
    if (dir === 'up' || dir === 'down') {
      const h = b.height * p;
      el.setAttribute('height', fmt(h));
      el.setAttribute('y', fmt(dir === 'up' ? b.y + b.height - h : b.y));
    } else {
      const w = b.width * p;
      el.setAttribute('width', fmt(w));
      el.setAttribute('x', fmt(dir === 'left' ? b.x + b.width - w : b.x));
    }
  }

  // ---- hợp biến đổi và quay ----------------------------------------------------------------------------

  private commitDirty(): void {
    const list = [...this.dirty];
    this.dirty.clear();
    for (const ts of list) {
      try {
        this.commit(ts);
      } catch (e) {
        console.warn('transform', e);
      }
    }
  }

  private commit(ts: TState): void {
    const st = ts.st;
    if (!st.bbox && (st.rotate || st.scale)) {
      st.bbox = this.measure(ts.el);
      if (!st.bbox) this.deferred.add(ts);
    }
    const str = buildTransform(st);
    if (str !== ts.last) {
      ts.last = str;
      this.writes++;
      (ts.el as SVGElement).style.setProperty('transform', str);
    }
    if (ts.spin) this.syncSpin(ts, ts.spin);
  }

  private syncSpin(ts: TState, slot: Slot): void {
    const rps = slot.rate ?? 0;
    if (this.reducedFn() || !ts.st.bbox) {
      if (slot.anim) {
        slot.anim.cancel();
        slot.anim = undefined;
        ts.spinKey = undefined;
      }
      return;
    }
    const f = spinFrames(ts.st, slot.binding.reverse === true);
    if (!slot.anim) {
      if (rps <= 0) return;
      slot.anim = (ts.el as SVGElement).animate(f.frames, {
        duration: SPIN_DURATION,
        iterations: Infinity,
        easing: 'linear',
      });
      ts.spinKey = f.key;
      slot.rate = rps;
      slot.anim.updatePlaybackRate(rps);
    } else {
      if (ts.spinKey !== f.key) {
        (slot.anim.effect as KeyframeEffect | null)?.setKeyframes(f.frames);
        ts.spinKey = f.key;
      }
      if (rps > 0 && slot.anim.playbackRate !== rps) slot.anim.updatePlaybackRate(rps);
    }
    slot.active = rps > 0;
    this.runState(slot);
  }

  private runState(slot: Slot): void {
    const a = slot.anim;
    if (!a) return;
    if (this.isHidden() || !slot.active) a.pause();
    else a.play();
  }

  // ---- nhấp nháy, dòng chảy ---------------------------------------------------------------------------

  private blinkMode(slot: Slot): BlinkMode {
    return slot.binding.mode ?? 'opacity';
  }

  private blink(slot: Slot, on: boolean): void {
    const el = slot.el;
    const style = (el as SVGElement).style;
    const b = slot.binding;
    const mode = this.blinkMode(slot);
    const [prop, staticVal] = blinkStaticOn(mode, b.color);
    if (!on) {
      slot.anim?.cancel();
      slot.anim = undefined;
      slot.active = false;
      style.removeProperty(prop);
      this.writes++;
      return;
    }
    if (this.reducedFn()) {
      slot.anim?.cancel();
      slot.anim = undefined;
      style.setProperty(prop, staticVal);
      return;
    }
    const period = b.period ?? DEFAULT_BLINK_PERIOD;
    if (!slot.anim) {
      const base =
        mode === 'opacity'
          ? '1'
          : style.getPropertyValue(mode) || el.getAttribute(mode) || 'currentColor';
      slot.anim = (el as SVGElement).animate(
        blinkKeyframes(mode, b.minOpacity ?? DEFAULT_MIN_OPACITY, b.color, base),
        { duration: period, iterations: Infinity, easing: BLINK_EASING },
      );
      slot.anim.startTime = blinkStartTime(this.nowFn(), period);
    }
    slot.active = true;
    this.runState(slot);
  }

  private flow(slot: Slot, signed: number): void {
    const el = slot.el;
    const b = slot.binding;
    if (el.getAttribute('stroke') === 'none') {
      if (!slot.warned) {
        slot.warned = true;
        console.warn('effect.flow cần phần tử có nét (stroke)', b.id);
      }
      return;
    }
    const dash = b.dash ?? DEFAULT_DASH;
    const style = (el as SVGElement).style;
    if (!slot.dashSet) {
      slot.dashSet = true;
      if (!el.hasAttribute('stroke-dasharray') && !style.getPropertyValue('stroke-dasharray'))
        style.setProperty('stroke-dasharray', dash);
    }
    if (this.reducedFn()) {
      slot.anim?.cancel();
      slot.anim = undefined;
      return;
    }
    const speed = Math.abs(signed);
    const direction = flowReversed(b.reverse === true, b.byValueSign === true, signed)
      ? 'reverse'
      : 'normal';
    if (!slot.anim) {
      if (speed === 0) return;
      const total = dashTotal(dash);
      slot.anim = (el as SVGElement).animate(flowKeyframes(total), {
        duration: flowDuration(total),
        iterations: Infinity,
        easing: 'linear',
        direction,
      });
      slot.direction = direction;
    } else if (slot.direction !== direction) {
      slot.anim.effect?.updateTiming({ direction });
      slot.direction = direction;
    }
    slot.active = speed > 0;
    if (speed > 0) slot.anim.updatePlaybackRate(speed / BASE_SPEED);
    this.runState(slot);
  }

  // ---- tab ẩn, giảm chuyển động ------------------------------------------------------------------------

  private syncAnimations(): void {
    if (this.disposed) return;
    for (const list of this.byTag.values())
      for (const s of list) {
        if (!s.anim) continue;
        this.runState(s);
        // nhấp nháy tính lại pha khi hiện lại
        if (s.binding.target === 'effect.blink' && s.active && !this.isHidden())
          s.anim.startTime = blinkStartTime(this.nowFn(), s.binding.period ?? DEFAULT_BLINK_PERIOD);
      }
  }

  /** Đổi `prefers-reduced-motion` giữa chừng: dựng lại hoặc gỡ hoạt ảnh theo giá trị gần nhất. */
  private refreshMotion(): void {
    if (this.disposed) return;
    for (const list of this.byTag.values())
      for (const s of list)
        if (isMotion(s.binding) && s.out !== undefined) {
          try {
            this.run(s, s.out);
          } catch (e) {
            console.warn('binding', s.binding.id, e);
          }
        }
    this.commitDirty();
  }
}
