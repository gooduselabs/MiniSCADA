// Nền chung của bốn widget lịch sử (feature 010; contracts/widget-catalog-010.md §1, §4): nhận HistorySource từ nơi
// chứa, KHÔNG đăng ký live và không gọi mạng. Lo catalog và nhóm, một yêu cầu đang chạy tại một thời điểm (hủy yêu
// cầu cũ), trạng thái FR-035 (đang tải, chưa đăng nhập, bận, chưa bật lưu trữ, lỗi, không dữ liệu) với lớp phủ chữ
// role="status" và nút Đăng nhập/Thử lại.
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { viHistory } from '../i18n/history-vi.ts';
import {
  isAbort,
  type HistoryCatalog,
  type HistoryCatalogGroup,
  type HistorySource,
  type HistoryState,
} from '../host/history-source.ts';
import { MatWidget } from './base.ts';

export type HistoryStatus =
  | 'loading'
  | 'ready'
  | 'updating'
  | 'empty'
  | 'login'
  | 'busy'
  | 'disabled'
  | 'error'
  | 'nogroup'
  | 'nosource';

/** Mã lỗi của máy chủ có câu tiếng Việt nên hiện nguyên văn (không phải lỗi mạng chung chung). */
const SHOW_SERVER_MESSAGE = new Set([
  'SCAN_LIMIT',
  'RANGE_TOO_LARGE',
  'NO_AGGREGATES',
  'EXPORT_TOO_LARGE',
  'BAD_REQUEST',
  'UNKNOWN_GROUP',
  'UNKNOWN_TAG',
]);

export const historyBaseStyles = css`
  .hw {
    position: relative;
    justify-content: flex-start;
    gap: 4px;
    padding: 6px;
  }
  .status {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
    text-align: center;
    color: var(--mat-text-muted, #56646a);
    background: color-mix(in srgb, var(--mat-surface, #fff) 82%, transparent);
  }
  .status button,
  .hbtn {
    font: inherit;
    color: var(--mat-text, #1a2225);
    background: var(--mat-surface-2, #f5f7f8);
    border: 1px solid var(--mat-border-strong, #b3bec3);
    border-radius: var(--mat-radius, 4px);
    padding: 2px 10px;
    cursor: pointer;
  }
  .status button:focus-visible,
  .hbtn:focus-visible {
    outline: 2px solid var(--mat-accent, #0b7285);
    outline-offset: 1px;
  }
  .hbtn[aria-pressed='true'] {
    background: var(--mat-accent, #0b7285);
    color: var(--mat-accent-ink, #fff);
    border-color: var(--mat-accent, #0b7285);
    font-weight: 600;
  }
  .updating {
    position: absolute;
    top: 4px;
    right: 8px;
    z-index: 2;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 8px;
    color: var(--mat-text-muted, #56646a);
    background: var(--mat-surface-2, #f5f7f8);
    border: 1px solid var(--mat-border, #d2d9dc);
  }
`;

export abstract class MatHistoryWidget extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    history: { attribute: false },
    _status: { state: true },
    _errMsg: { state: true },
  };

  declare history: HistorySource | undefined;
  declare _status: HistoryStatus;
  declare _errMsg: string;

  /** Nhóm đã tra từ catalog (null khi chưa có). */
  protected group: HistoryCatalogGroup | null = null;
  protected catalogData: HistoryCatalog | null = null;

  #booted = false;
  #unsub: (() => void) | null = null;
  #initAc: AbortController | null = null;
  #runAc: AbortController | null = null;

  constructor() {
    super();
    this._status = 'loading';
    this._errMsg = '';
  }

  /** Widget lịch sử không đăng ký live. */
  override tagIds(): string[] {
    return [];
  }

  // ---- khai báo cho lớp con ----------------------------------------------------------------------------------

  /** Nhóm lưu trữ của widget (thuộc tính `group`). */
  /** Nhãn hiển thị của cột theo bảng lưu trữ (042); rỗng khi chưa đặt. */
  protected catalogLabel(tagId: string | undefined): string {
    if (!tagId) return '';
    return this.group?.tags.find((t) => t.tagId === tagId)?.label ?? '';
  }

  protected groupId(): string {
    return this.prop('group', '');
  }

  /** Catalog và nhóm đã sẵn: lớp con dựng đồ thị và gọi yêu cầu đầu tiên. */
  protected abstract onGroupReady(g: HistoryCatalogGroup): void | Promise<void>;
  /** Giải phóng tài nguyên của lớp con (bộ đếm, bộ vẽ…). */
  protected abstract onDispose(): void;
  /** Đã có hình/dữ liệu để giữ khi cập nhật. */
  protected abstract hasData(): boolean;

  // ---- vòng đời ----------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#boot();
  }

  override disconnectedCallback(): void {
    this.#teardown();
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues): void {
    if (!this.isConnected) return;
    if (!this.#booted) {
      this.#boot();
      return;
    }
    const itemChanged = changed.has('item') && this.#keyOf() !== this.#key;
    if (changed.has('history') || itemChanged) {
      this.#teardown();
      this.#boot();
    }
  }

  /** Item đổi thuộc tính hay Tag thì dựng lại; chỉ đổi vị trí hay kích thước thì không. */
  #key = '';
  #keyOf(): string {
    return JSON.stringify([this.item?.props, this.item?.tags]);
  }

  #boot(): void {
    if (this.#booted || !this.isConnected || !this.item) return;
    this.#key = this.#keyOf();
    if (!this.history || this.mode === 'edit') {
      this._status = 'nosource';
      return;
    }
    this.#booted = true;
    this.#unsub = this.history.onState((s) => this.#onHistoryState(s));
    void this.#init();
  }

  #teardown(): void {
    this.#booted = false;
    this.#unsub?.();
    this.#unsub = null;
    this.#initAc?.abort();
    this.#initAc = null;
    this.#runAc?.abort();
    this.#runAc = null;
    this.onDispose();
    this.group = null;
    this.catalogData = null;
  }

  async #init(): Promise<void> {
    const gid = this.groupId();
    if (!gid) {
      this._status = 'nogroup';
      return;
    }
    this.#initAc?.abort();
    const ac = new AbortController();
    this.#initAc = ac;
    this._status = this.hasData() ? 'updating' : 'loading';
    let cat: HistoryCatalog;
    try {
      cat = await this.history!.catalog(ac.signal);
    } catch (e) {
      if (ac.signal.aborted) return;
      this.handleError(e);
      return;
    }
    if (ac.signal.aborted) return;
    this.catalogData = cat;
    if (!cat.enabled) {
      this._status = 'disabled';
      return;
    }
    const g = cat.groups.find((x) => x.id === gid);
    if (!g) {
      this._status = 'nogroup';
      return;
    }
    this.group = g;
    await this.onGroupReady(g);
  }

  #onHistoryState(s: HistoryState): void {
    if (s === 'login-required') this._status = 'login';
    else if (s === 'disabled') this._status = 'disabled';
    else if (s === 'busy') this._status = 'busy';
    else if (s === 'ready') {
      if (this._status === 'login' || this._status === 'disabled' || this._status === 'error') {
        void this.#init();
      } else if (this._status === 'busy') {
        this._status = this.#runAc ? (this.hasData() ? 'updating' : 'loading') : 'ready';
      }
    }
  }

  // ---- chạy yêu cầu ------------------------------------------------------------------------------------------

  /** Chạy một yêu cầu, hủy yêu cầu cũ; trả undefined khi bị hủy hoặc lỗi (trạng thái đã đặt). */
  protected async run<T>(
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    this.#runAc?.abort();
    const ac = new AbortController();
    this.#runAc = ac;
    this._status = this.hasData() ? 'updating' : 'loading';
    try {
      const value = await fn(ac.signal);
      if (ac.signal.aborted) return undefined;
      this.#runAc = null;
      this._status = 'ready';
      return { value };
    } catch (e) {
      if (ac.signal.aborted) return undefined;
      this.#runAc = null;
      this.handleError(e);
      return undefined;
    }
  }

  /** Hủy yêu cầu đang chạy (lớp con gọi khi đổi khoảng trước khi hẹn yêu cầu mới). */
  protected cancelRun(): void {
    this.#runAc?.abort();
    this.#runAc = null;
  }

  protected handleError(e: unknown): void {
    if (isAbort(e)) return;
    const code = (e as { code?: string }).code ?? '';
    const msg = (e as { message?: string }).message ?? '';
    if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED' || code === 'SESSION_INVALID') {
      this._errMsg = '';
      this._status = 'login';
    } else if (code === 'HTTPS_REQUIRED') {
      this._errMsg = viHistory.state.insecure;
      this._status = 'login';
    } else if (code === 'NO_HISTORY') {
      this._status = 'disabled';
    } else if (code === 'BUSY') {
      this._status = 'busy';
    } else {
      this._errMsg = SHOW_SERVER_MESSAGE.has(code) && msg ? msg : '';
      this._status = 'error';
    }
  }

  protected retry(): void {
    if (this.group) void this.onGroupReady(this.group);
    else void this.#init();
  }

  protected login(): void {
    if (this.history?.requestLogin) this.history.requestLogin();
    else this.host?.requestLogin();
  }

  // ---- giao diện trạng thái ----------------------------------------------------------------------------------

  protected statusText(): string {
    const s = viHistory.state;
    switch (this._status) {
      case 'loading':
        return s.loading;
      case 'updating':
        return s.updating;
      case 'empty':
        return s.empty;
      case 'login':
        return this._errMsg || s.login;
      case 'busy':
        return s.busy;
      case 'disabled':
        return s.disabled;
      case 'error':
        return this._errMsg || s.error;
      case 'nogroup':
        return s.noGroup;
      case 'nosource':
        return s.noSource;
      default:
        return '';
    }
  }

  /** Lớp phủ chữ (chặn hình khi chưa có dữ liệu) hoặc chỉ báo nhỏ khi đã có hình cũ. */
  protected renderStatus(): TemplateResult | typeof nothing {
    const st = this._status;
    if (st === 'ready') return nothing;
    const has = this.hasData();
    if (has && (st === 'updating' || st === 'loading' || st === 'busy' || st === 'empty')) {
      return html`<div class="updating">${this.statusText()}</div>`;
    }
    if (has && st === 'login') {
      // Phiên hết hạn nhưng còn hình cũ: vẫn cho đăng nhập lại.
    }
    return html`<div class="status" role="status">
      <span>${this.statusText()}</span>
      ${
        st === 'login' && !this._errMsg
          ? html`<button type="button" @click=${() => this.login()}>
              ${viHistory.state.loginButton}
            </button>`
          : nothing
      }
      ${
        st === 'error'
          ? html`<button type="button" @click=${() => this.retry()}>
              ${viHistory.state.retry}
            </button>`
          : nothing
      }
    </div>`;
  }
}
