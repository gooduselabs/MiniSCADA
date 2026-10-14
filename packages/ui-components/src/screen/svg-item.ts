// Item `svg` của màn hình (ADR-013 điểm 2): mountScreen (Shadow DOM riêng, ADR-007) + DomApplier với binding đã tải,
// nối với TagSource. Dùng cùng package với trang runtime hiện tại (Constitution II).
import { DomApplier, type TagUpdate } from '@mat/binding-engine';
import type { ValueTable } from '@mat/expression';
import type {
  ElementAction,
  ElementBindings02,
  ElementEntry04,
  SvgItem,
  TagDataType,
} from '@mat/project-schema';
import { mountScreen, type MountedScreen } from '@mat/svg-renderer';
import { vi } from '../i18n/vi.ts';
import type { ModalRegistry } from '../control/modal-registry.ts';
import type { ActionHost, TagSource } from '../host/types.ts';
import { bindSvgEvents, type StatusSink } from './svg-events.ts';

/** Ngữ cảnh gắn sự kiện phần tử (0.4): đọc lại mỗi lần `syncEvents` để theo host/mode hiện thời. */
export interface SvgItemEventsContext {
  screenId: string;
  host: ActionHost;
  mode: 'run' | 'edit';
  status: StatusSink;
  modal?: ModalRegistry;
}

export interface SvgItemOptions {
  item: SvgItem;
  /** Phần tử chứa (sẽ gắn Shadow DOM). */
  host: HTMLElement;
  source: TagSource;
  loadSvg: (path: string) => Promise<string>;
  loadBindings: (path: string) => Promise<ElementBindings02[]>;
  raf: (cb: () => void) => unknown;
  /** Gọi khi đã tải xong (thành công hay lỗi). */
  onLoaded?: () => void;
  /** Cấp ngữ cảnh để gắn `events.click` của phần tử; vắng thì không gắn sự kiện. */
  events?: () => SvgItemEventsContext;
}

type ElementEvents = Array<{ elementUid: string; click: ElementAction }>;

/** Khóa so sánh để biết item `svg` có phải dựng lại (cùng khóa: chỉ đổi vị trí/cỡ). */
export function svgItemKey(item: SvgItem): string {
  return JSON.stringify([
    item.svgFile,
    item.bindingFile,
    item.viewBox,
    item.fit ?? 'contain',
    item.elements,
  ]);
}

export class SvgItemView {
  readonly ready: Promise<void>;
  readonly key: string;
  #ids: string[] = [];
  #applier: DomApplier | null = null;
  #mounted: MountedScreen | null = null;
  #events: ElementEvents = [];
  #eventsBound: { dispose(): void; refresh(): void } | null = null;
  #eventsCtx: SvgItemEventsContext | null = null;
  #unsub: (() => void) | null = null;
  #disposed = false;

  readonly opt: SvgItemOptions;

  constructor(opt: SvgItemOptions) {
    this.opt = opt;
    this.key = svgItemKey(opt.item);
    this.ready = this.#load().finally(() => {
      if (!this.#disposed) opt.onLoaded?.();
    });
  }

  /** Tag của binding (sau khi tải xong); rỗng khi chưa tải hoặc lỗi. */
  tagIds(): string[] {
    const extra = this.#events.flatMap((e) =>
      'tag' in e.click && typeof e.click.tag === 'string' ? [e.click.tag] : [],
    );
    return extra.length ? [...new Set([...this.#ids, ...extra])] : this.#ids;
  }

  /** Số hoạt ảnh vô hạn của item (quay, nhấp nháy, dòng chảy); 0 khi chưa tải. */
  animationCount(): number {
    return this.#applier?.animationCount() ?? 0;
  }

  /** Gắn (hoặc gắn lại khi host/mode/trạng thái đổi) sự kiện của phần tử; gọi lại để cập nhật khóa. */
  syncEvents(): void {
    const ctx = this.opt.events?.();
    const mounted = this.#mounted;
    if (!ctx || !mounted || this.#disposed) return;
    const prev = this.#eventsCtx;
    if (
      this.#eventsBound &&
      prev &&
      prev.host === ctx.host &&
      prev.mode === ctx.mode &&
      prev.screenId === ctx.screenId
    ) {
      this.#eventsBound.refresh();
      return;
    }
    this.#eventsBound?.dispose();
    this.#eventsBound = null;
    this.#eventsCtx = ctx;
    if (this.#events.length === 0) return;
    this.#eventsBound = bindSvgEvents({
      screenId: ctx.screenId,
      mounted,
      events: this.#events,
      source: this.opt.source,
      host: ctx.host,
      status: ctx.status,
      mode: ctx.mode,
      ...(ctx.modal ? { modal: ctx.modal } : {}),
      now: () => Date.now(),
      uuid: () => globalThis.crypto.randomUUID(),
    });
  }

  async #load(): Promise<void> {
    const { item, host, source } = this.opt;
    try {
      const [svgText, bindings] = await Promise.all([
        this.opt.loadSvg(item.svgFile),
        this.opt.loadBindings(item.bindingFile),
      ]);
      if (this.#disposed) return;
      const mounted = mountScreen(host, svgText, {
        viewBox: item.viewBox,
        fitMode: item.fit ?? 'contain',
        elements: item.elements,
      });
      this.#mounted = mounted;

      const tagTypes: Record<string, TagDataType> = {};
      const tagValueTables: Record<string, string> = {};
      const tagUnits: Record<string, string | undefined> = {};
      const tableNames = new Set<string>();
      // 0.4: phần tử có thể chỉ có `events` (không có `bindings`).
      type Entry = { elementUid: string; bindings?: unknown[]; events?: { click?: ElementAction } };
      this.#events = (bindings as Entry[]).flatMap((eb) =>
        eb.events?.click ? [{ elementUid: eb.elementUid, click: eb.events.click }] : [],
      );
      const withBindings = bindings.filter((eb) => ((eb as Entry).bindings?.length ?? 0) > 0);
      for (const eb of withBindings) {
        for (const b of eb.bindings) {
          const id = b.source.tagId;
          const info = source.info(id);
          if (info) {
            tagTypes[id] = info.type;
            if (info.unit) tagUnits[id] = info.unit;
            if (info.valueTable) {
              tagValueTables[id] = info.valueTable;
              tableNames.add(info.valueTable);
            }
          }
          const tr = b.transform as { kind: string; table?: string };
          if (tr.kind === 'valueTable' && tr.table) tableNames.add(tr.table);
        }
      }
      const valueTables: Record<string, ValueTable> = {};
      for (const n of tableNames) {
        const t = source.valueTable(n);
        if (t) valueTables[n] = t;
      }

      const applier = new DomApplier({
        elements: mounted.elements,
        bindings: withBindings as unknown as ElementEntry04[],
        raf: this.opt.raf,
        doc: host.ownerDocument,
        tagTypes,
        valueTables,
        tagValueTables,
        tagUnits,
      });
      this.#applier = applier;
      if (mounted.missingUids.length || applier.missing.length)
        console.warn('elementUid không có trong SVG, bỏ binding:', [
          ...new Set([...mounted.missingUids, ...applier.missing]),
        ]);

      this.#ids = applier.tagIds();
      this.syncEvents();
      if (this.#ids.length > 0) {
        this.#unsub = source.subscribe(this.#ids, (changed) =>
          applier.update(changed.map((id) => this.#update(id))),
        );
        // Giá trị đã có sẵn lúc dựng (mở màn hình giữa chừng) được áp ngay.
        const have = this.#ids.filter((id) => {
          const s = source.get(id);
          return !(s.quality === 'UNKNOWN' && s.value === null);
        });
        if (have.length > 0) applier.update(have.map((id) => this.#update(id)));
      }
    } catch (e) {
      if (this.#disposed) return;
      host.textContent = `${vi.screen.svgFailed}: ${item.svgFile}`;
      host.classList.add('svg-failed');
      console.warn('item svg lỗi:', item.id, e);
    }
  }

  #update(id: string): TagUpdate {
    const s = this.opt.source.get(id);
    return { id, value: s.value, quality: s.quality === 'UNKNOWN' ? 'BAD' : s.quality };
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsub?.();
    this.#unsub = null;
    this.#eventsBound?.dispose();
    this.#eventsBound = null;
    this.#events = [];
    this.#applier?.dispose();
    this.#applier = null;
    this.#mounted?.unmount();
    this.#mounted = null;
    this.#ids = [];
  }
}
