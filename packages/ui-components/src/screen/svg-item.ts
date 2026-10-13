// Item `svg` của màn hình (ADR-013 điểm 2): mountScreen (Shadow DOM riêng, ADR-007) + DomApplier với binding đã tải,
// nối với TagSource. Dùng cùng package với trang runtime hiện tại (Constitution II).
import { DomApplier, type TagUpdate } from '@mat/binding-engine';
import type { ValueTable } from '@mat/expression';
import type { ElementBindings02, SvgItem, TagDataType } from '@mat/project-schema';
import { mountScreen, type MountedScreen } from '@mat/svg-renderer';
import { vi } from '../i18n/vi.ts';
import type { TagSource } from '../host/types.ts';

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
}

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
    return this.#ids;
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
      const tableNames = new Set<string>();
      for (const eb of bindings) {
        for (const b of eb.bindings) {
          const id = b.source.tagId;
          const info = source.info(id);
          if (info) {
            tagTypes[id] = info.type;
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
        bindings,
        raf: this.opt.raf,
        doc: host.ownerDocument,
        tagTypes,
        valueTables,
        tagValueTables,
      });
      this.#applier = applier;
      if (mounted.missingUids.length || applier.missing.length)
        console.warn('elementUid không có trong SVG, bỏ binding:', [
          ...new Set([...mounted.missingUids, ...applier.missing]),
        ]);

      this.#ids = applier.tagIds();
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
    this.#applier?.dispose();
    this.#applier = null;
    this.#mounted?.unmount();
    this.#mounted = null;
    this.#ids = [];
  }
}
