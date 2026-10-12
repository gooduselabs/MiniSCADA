// Xem trước màn hình (FR-032, Constitution II): CÙNG package với runtime web: SVG dựng bằng
// @mat/svg-renderer (sanitizer, shadow root riêng), giá trị áp bằng DomApplier của @mat/binding-engine.
// SVG và binding lấy từ project trên máy Windows. Nguồn giá trị nằm ngoài: mô phỏng (SimSource) hoặc giá
// trị của phiên thiết bị duy nhất của Studio (FR-030), nên Preview không tự kết nối tới thiết bị.
import { DomApplier, type TagUpdate } from '@mat/binding-engine';
import type { ElementBindings, TagDataType } from '@mat/project-schema';
import { mountScreen, type MountedScreen, type ScreenLayout } from '@mat/svg-renderer';

/**
 * Nguồn giá trị: gắn hàm nhận cập nhật, phát ngay các giá trị đang có rồi các thay đổi sau đó (cùng kiểu
 * `TagUpdate` với dữ liệu sống). Trả hàm gỡ.
 */
export type ValueSource = (push: (changes: TagUpdate[]) => void) => () => void;

/** Kiểu riêng của Studio trong shadow root của màn hình: con trỏ chọn phần tử. */
const PICK_STYLE = '[data-mat-uid]{cursor:pointer}[data-mat-uid]:hover{filter:brightness(1.2)}';

interface MountArgs {
  host: HTMLElement;
  svgText: string;
  layout: ScreenLayout;
  bindings: ElementBindings[];
  tagTypes: Record<string, TagDataType>;
}

export class Preview {
  private mounted: MountedScreen | null = null;
  private applier: DomApplier | null = null;
  private args: MountArgs | null = null;
  private detach: (() => void) | null = null;
  /** Đã có giá trị áp lên DOM từ nguồn hiện tại (đổi nguồn thì dựng lại bản vẽ gốc). */
  private dirty = false;

  /**
   * Dựng màn hình trong `host` (shadow root). Trả uid khai báo trong màn hình hoặc binding mà SVG không có.
   * Ném lỗi khi SVG không hợp lệ (svg-renderer). Nguồn đang gắn (nếu có) được gỡ.
   */
  mount(
    host: HTMLElement,
    svgText: string,
    layout: ScreenLayout,
    bindings: ElementBindings[],
    tagTypes: Record<string, TagDataType> = {},
  ): string[] {
    this.stop();
    this.args = { host, svgText, layout, bindings, tagTypes };
    return this.build();
  }

  /** Đổi nguồn giá trị; `null`: màn hình như bản vẽ. Giá trị của nguồn cũ không còn trên màn hình. */
  setSource(source: ValueSource | null): void {
    this.detach?.();
    this.detach = null;
    if (this.dirty && this.args) this.build();
    if (!source) return;
    this.detach = source((changes) => {
      if (!this.applier || !changes.length) return;
      this.dirty = true;
      this.applier.update(changes);
    });
  }

  /** Tag mà binding của màn hình dùng. */
  get tags(): string[] {
    return this.applier?.tagIds() ?? [];
  }

  /** elementUid → phần tử trong SVG đã dựng. */
  get elements(): ReadonlyMap<string, Element> {
    return this.mounted?.elements ?? new Map();
  }

  /** Gỡ nguồn, hủy animation, bỏ màn hình. */
  stop(): void {
    this.detach?.();
    this.detach = null;
    this.teardown();
    this.args = null;
  }

  private teardown(): void {
    this.applier?.dispose();
    this.mounted?.unmount();
    this.applier = null;
    this.mounted = null;
    this.dirty = false;
  }

  private build(): string[] {
    this.teardown();
    const a = this.args!;
    const mounted = mountScreen(a.host, a.svgText, a.layout);
    const style = a.host.ownerDocument.createElement('style');
    style.textContent = PICK_STYLE;
    mounted.root.append(style);
    this.mounted = mounted;
    this.applier = new DomApplier({
      elements: mounted.elements,
      bindings: a.bindings,
      tagTypes: a.tagTypes,
      doc: a.host.ownerDocument,
    });
    return [...new Set([...mounted.missingUids, ...this.applier.missing])];
  }
}
