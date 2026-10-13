// PopupHost (feature 007, FR-016, FR-023): trạng thái popup của Router → thuộc tính `popup` của `<mat-screen>`.
// Lớp phủ, bẫy focus và Esc do `<mat-screen>` lo (popup-layer.ts); ở đây chỉ tải mô hình popup theo yêu cầu.
import type { ScreenModel } from '@mat/project-schema';

export interface PopupHostOptions {
  load: (id: string) => Promise<ScreenModel>;
  /** `<mat-screen>` (hoặc đối tượng có thuộc tính `popup`). */
  target: { popup: ScreenModel | null };
  onError: (id: string, message: string) => void;
  /** Tải lỗi: đóng popup ở router. */
  onFail: () => void;
}

export class PopupHost {
  readonly #o: PopupHostOptions;
  #seq = 0;

  constructor(o: PopupHostOptions) {
    this.#o = o;
  }

  /** `id` = popup cần mở; `null` = đóng. Kết quả của lần gọi cũ hơn bị bỏ. */
  async sync(id: string | null): Promise<void> {
    const seq = ++this.#seq;
    if (id === null) {
      this.#o.target.popup = null;
      return;
    }
    let model: ScreenModel;
    try {
      model = await this.#o.load(id);
    } catch (e) {
      if (seq !== this.#seq) return;
      this.#o.onError(id, e instanceof Error ? e.message : String(e));
      this.#o.onFail();
      return;
    }
    if (seq !== this.#seq) return;
    this.#o.target.popup = model;
  }
}
