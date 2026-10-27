// Nơi chứa của `<mat-screen>` khi xem trước trên trang Quản trị web và trong Studio (feature 013, FR-042, FR-043; dùng
// chung từ feature 027): không bao giờ gửi lệnh. Mọi widget điều khiển khóa (`PREVIEW`, hoặc `NO_PERMISSION` cho item bị
// khóa của người đang "xem với tư cách"), điều hướng và popup không làm gì.
import type {
  ActionHost,
  AlarmAckOutcome,
  AlarmActionOutcome,
  SessionInfo,
  WriteOutcome,
} from '@mat/ui-components';

export class PreviewHost implements ActionHost {
  readonly #session: () => SessionInfo | null;
  readonly #locked: (screen: string, item: string) => boolean;
  readonly #popup: (popup: string) => boolean;
  readonly #message: string;

  constructor(o: {
    session: () => SessionInfo | null;
    locked?: (screen: string, item: string) => boolean;
    /** Popup người đang "xem với tư cách" không được xem (nút mở nó khóa NO_PERMISSION). */
    popupDenied?: (popup: string) => boolean;
    message: string;
  }) {
    this.#popup = o.popupDenied ?? (() => false);
    this.#session = o.session;
    this.#locked = o.locked ?? (() => false);
    this.#message = o.message;
  }

  session(): SessionInfo | null {
    return this.#session();
  }
  popupBlocked(popup: string): { code: 'NO_PERMISSION'; message: string } | null {
    return this.#popup(popup) ? { code: 'NO_PERMISSION', message: '' } : null;
  }
  writeBlocked(): null {
    return null;
  }
  itemBlocked(ctx: { screen: string; item: string }): {
    code: 'NO_PERMISSION' | 'PREVIEW';
    message: string;
  } {
    return this.#locked(ctx.screen, ctx.item)
      ? { code: 'NO_PERMISSION', message: '' }
      : { code: 'PREVIEW', message: this.#message };
  }
  async write(): Promise<WriteOutcome> {
    return { status: 'REJECTED', code: 'PREVIEW', message: this.#message };
  }
  navigate(): void {}
  openPopup(): void {}
  closePopup(): void {}
  requestLogin(): void {}
  async ackAlarms(): Promise<AlarmAckOutcome> {
    return {
      ok: false,
      error: { code: 'PREVIEW', message: this.#message },
      results: [],
      acked: 0,
      skippedNewer: 0,
    };
  }
  async shelveAlarm(): Promise<AlarmActionOutcome> {
    return { ok: false, error: { code: 'PREVIEW', message: this.#message } };
  }
  async unshelveAlarm(): Promise<AlarmActionOutcome> {
    return { ok: false, error: { code: 'PREVIEW', message: this.#message } };
  }
}
