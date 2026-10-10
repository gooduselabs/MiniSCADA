// Áp binding lên DOM của một màn hình (Master Plan §8.3): gom cập nhật trong một
// requestAnimationFrame, chỉ ghi khi giá trị hiển thị đổi, quay bằng Web Animations quanh tâm
// (transform-box: fill-box), tạm dừng animation khi tab ẩn, hủy sạch khi đổi màn hình.
import type { Binding, ElementBindings, TagDataType } from '@mat/project-schema';
import { evaluateBinding, spinRps, type Quality, type TagValue } from './transforms.ts';

export interface TagUpdate {
  id: string;
  value: TagValue;
  quality: Quality;
}

export interface DomApplierOptions {
  /** elementUid → phần tử (từ mountScreen). */
  elements: Map<string, Element>;
  bindings: ElementBindings[];
  raf?: (cb: () => void) => unknown;
  isHidden?: () => boolean;
  doc?: Document;
  /** Kiểu Tag (từ tags.json): INT64/UINT64 đến dạng chuỗi thập phân được đổi sang số. */
  tagTypes?: Record<string, TagDataType>;
}

interface Slot {
  el: Element;
  binding: Binding;
  last: string | number | undefined;
  box?: { x: number; y: number; width: number; height: number };
  anim?: Animation;
  duration?: number;
  rps?: number;
}

export class DomApplier {
  /** elementUid có binding nhưng không có trong SVG (đã bỏ qua). */
  readonly missing: string[] = [];
  /** Số lần ghi DOM (để đo/kiểm thử). */
  writes = 0;

  private readonly byTag = new Map<string, Slot[]>();
  private readonly pending = new Map<string, TagUpdate>();
  private readonly raf: (cb: () => void) => unknown;
  private readonly isHidden: () => boolean;
  private readonly doc: Document;
  private readonly tagTypes: Record<string, TagDataType>;
  private scheduled = false;
  private disposed = false;
  private readonly onVisibility = () => this.syncAnimations();

  constructor(opt: DomApplierOptions) {
    this.doc = opt.doc ?? document;
    this.tagTypes = opt.tagTypes ?? {};
    this.raf = opt.raf ?? ((cb) => requestAnimationFrame(cb));
    this.isHidden = opt.isHidden ?? (() => this.doc.hidden);
    for (const eb of opt.bindings) {
      const el = opt.elements.get(eb.elementUid);
      if (!el) {
        this.missing.push(eb.elementUid);
        continue;
      }
      for (const binding of eb.bindings) {
        const slot: Slot = { el, binding, last: undefined };
        if (binding.target === 'geometry.levelPercent') {
          // Hộp bao đo một lần (không gọi getBBox mỗi lần cập nhật để tránh layout thrash).
          const n = (a: string) => Number(el.getAttribute(a) ?? 0);
          slot.box = { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
        }
        if (binding.target === 'transform.rotate') {
          const st = (el as SVGElement).style;
          st.transformBox = 'fill-box';
          st.transformOrigin = 'center';
        }
        const list = this.byTag.get(binding.source.tagId) ?? [];
        list.push(slot);
        this.byTag.set(binding.source.tagId, list);
      }
    }
    this.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  tagIds(): string[] {
    return [...this.byTag.keys()];
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
    for (const c of batch)
      for (const slot of this.byTag.get(c.id) ?? []) {
        try {
          this.apply(slot, c);
        } catch (e) {
          console.warn('binding', slot.binding.id, e); // một binding lỗi không chặn binding khác
        }
      }
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    for (const list of this.byTag.values())
      for (const s of list) {
        s.anim?.cancel();
        s.anim = undefined;
      }
  }

  private apply(slot: Slot, c: TagUpdate): void {
    const out = evaluateBinding(slot.binding, c.value, c.quality);
    if (out.hold || out.value === slot.last) return;
    slot.last = out.value;
    this.writes++;
    const el = slot.el;
    const style = (el as SVGElement).style;
    const v = out.value;
    switch (slot.binding.target) {
      case 'style.fill':
        style.setProperty('fill', String(v));
        break;
      case 'style.stroke':
        style.setProperty('stroke', String(v));
        break;
      case 'style.opacity':
        style.setProperty('opacity', String(v));
        break;
      case 'style.visibility':
        style.setProperty('visibility', String(v));
        break;
      case 'text.content':
        el.textContent = String(v);
        break;
      case 'transform.rotate':
        if (slot.binding.animation === 'spin') this.spin(slot, Number(v));
        else style.setProperty('transform', `rotate(${Number(v)}deg)`);
        break;
      case 'geometry.levelPercent':
        this.level(slot, Number(v));
        break;
    }
  }

  private level(slot: Slot, percent: number): void {
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

  private spin(slot: Slot, rpm: number): void {
    const rps = spinRps(rpm);
    slot.rps = rps;
    if (rps > 0) {
      const duration = Math.round(1000 / rps);
      if (!slot.anim || slot.duration !== duration) {
        const current = slot.anim;
        slot.anim = slot.el.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
          { duration, iterations: Infinity },
        );
        current?.cancel();
        slot.duration = duration;
      }
    }
    this.syncAnimation(slot);
  }

  private syncAnimation(slot: Slot): void {
    if (!slot.anim) return;
    if (this.isHidden() || !(slot.rps && slot.rps > 0)) slot.anim.pause();
    else slot.anim.play();
  }

  private syncAnimations(): void {
    if (this.disposed) return;
    for (const list of this.byTag.values()) for (const s of list) this.syncAnimation(s);
  }
}
