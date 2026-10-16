// PopupHost (feature 007, FR-016, FR-023): trạng thái popup của Router → thuộc tính `popup` của `<mat-screen>`.
// Lớp phủ, bẫy focus và Esc do `<mat-screen>` lo (popup-layer.ts); ở đây chỉ tải mô hình popup theo yêu cầu.
// Faceplate (feature 011, FR-125; contracts/project-format-1.0.md §5): popup có `params` được thay `{param}` bằng `args`
// (substitutePopup → substituteParams, cùng hàm với validator TS) trước khi gán; `args` sai thì không mở và báo lỗi;
// Tag đã thay ngoài tập Tag công bố của project (`knownTag`) thì widget hiện "Tag không có" và không đăng ký.
import type { ScreenModel } from '@mat/project-schema';
import { substitutePopup } from '@mat/ui-components';
import { vi } from './i18n/vi.ts';

export interface PopupHostOptions {
  load: (id: string) => Promise<ScreenModel>;
  /** `<mat-screen>` (hoặc đối tượng có thuộc tính `popup`). */
  target: { popup: ScreenModel | null };
  onError: (id: string, message: string) => void;
  /** Tải lỗi hoặc `args` sai: đóng popup ở router. */
  onFail: () => void;
  /** Tag có trong project (`projects/active`); vắng thì không kiểm (mọi Tag đã thay đều được đăng ký). */
  knownTag?: (id: string) => boolean;
}

export class PopupHost {
  readonly #o: PopupHostOptions;
  #seq = 0;

  constructor(o: PopupHostOptions) {
    this.#o = o;
  }

  /** `id` = popup cần mở (kèm `args` của faceplate); `null` = đóng. Kết quả của lần gọi cũ hơn bị bỏ. */
  async sync(id: string | null, args?: Record<string, string>): Promise<void> {
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
    const r = substitutePopup(model, args, this.#o.knownTag);
    if (!r.ok) {
      this.#o.target.popup = null;
      this.#o.onError(id, vi.popupArgsInvalid(r.message));
      this.#o.onFail();
      return;
    }
    this.#o.target.popup = r.model;
  }
}
