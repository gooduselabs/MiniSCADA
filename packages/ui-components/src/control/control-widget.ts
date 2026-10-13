// Lớp nền chung của 5 widget điều khiển, kế thừa MatWidget (S2): thêm ControlController, hộp xác nhận
// (dựng ở lớp phủ chung `ModalRegistry.layer` hoặc document.body, nên không bị `transform: scale` của màn hình
// bóp lệch), dải kết quả và dòng lý do khóa. Chế độ `edit` không tạo controller, không phát hành động.
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { MatWidget } from '../widgets/base.ts';
import { widgetStyles } from '../styles/widget-styles.ts';
import { MatConfirmDialog } from './confirm-dialog.ts';
import { ControlController, effectiveLimits, type ControlState } from './controller.ts';
import { defaultModalRegistry, type ModalRegistry } from './modal-registry.ts';
import './result-banner.ts';

function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const controlStyles = css`
  :host {
    overflow: visible;
  }
  .w.ctl {
    overflow: visible;
    gap: 3px;
    padding: 4px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .name {
    font-size: 12px;
    color: var(--mat-text-muted, #56646a);
  }
  .lockmsg {
    font-size: 11px;
    color: var(--mat-text-muted, #56646a);
  }
  .err {
    font-size: 11px;
    color: var(--mat-bad, #c42b2b);
  }
  .status {
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 2px;
    width: max-content;
    min-width: 100%;
    max-width: 320px;
    z-index: 5;
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  [role='switch']:focus-visible {
    outline: 2px solid var(--mat-info, #0b5cad);
    outline-offset: 2px;
  }
  :disabled,
  [aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

export abstract class ControlWidget extends MatWidget {
  static override properties = { ...MatWidget.properties, modal: { attribute: false } };
  static override styles = [widgetStyles, controlStyles];

  declare modal: ModalRegistry | null;

  protected ctl: ControlController | null = null;
  #dialog: MatConfirmDialog | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #built = false;
  #prevPhase: ControlState['phase'] | undefined;

  constructor() {
    super();
    this.modal = null;
  }

  /** Widget có ghi Tag (cần controller). Nút chỉ điều hướng thì false. */
  protected needsController(): boolean {
    return true;
  }

  get tagId(): string | undefined {
    return this.tagOf('target');
  }

  /** Trạng thái điều khiển; `null` ở chế độ edit hoặc khi không có controller. */
  protected get cstate(): ControlState | null {
    return this.mode === 'run' && this.ctl ? this.ctl.state : null;
  }

  /** Điều khiển được bấm: chạy thật và controller ở `ready`. */
  protected get ready(): boolean {
    return this.cstate?.phase === 'ready';
  }

  /** Giới hạn hiệu lực (không cần controller, dùng được ở chế độ edit). */
  protected limits(): { min?: number; max?: number } {
    const id = this.tagId;
    return effectiveLimits(this.item, id ? this.source.info(id) : undefined);
  }

  /** Gọi khi điều khiển rời các pha hoạt động (xác nhận, gửi, kết quả) về ready/locked: xóa trạng thái cục bộ. */
  protected settled(): void {}

  protected optNum(name: string): number | undefined {
    const v = this.item?.props?.[name];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  protected override willUpdate(ch: PropertyValues): void {
    super.willUpdate(ch);
    if (
      !this.#built ||
      ch.has('item') ||
      ch.has('source') ||
      ch.has('host') ||
      ch.has('mode') ||
      ch.has('context') ||
      ch.has('modal')
    ) {
      this.#rebuild();
    }
    const ph = this.cstate?.phase;
    if (
      (this.#prevPhase === 'confirming' ||
        this.#prevPhase === 'sending' ||
        this.#prevPhase === 'result') &&
      (ph === 'ready' || ph === 'locked')
    ) {
      this.settled();
    }
    this.#prevPhase = ph;
  }

  override disconnectedCallback(): void {
    this.#teardown();
    this.#built = false;
    super.disconnectedCallback();
  }

  #teardown(): void {
    this.#closeDialog(false);
    this.ctl?.dispose();
    this.ctl = null;
  }

  #rebuild(): void {
    this.#teardown();
    this.#built = true;
    const { item, source, host } = this;
    if (!item || !source || !host || this.mode !== 'run' || !this.needsController()) return;
    const c = new ControlController({
      item,
      source,
      host,
      now: () => Date.now(),
      uuid,
      modal: this.modal ?? defaultModalRegistry,
      context: this.context ?? { screen: '', widget: item.id },
    });
    c.onChange = () => this.requestUpdate();
    this.ctl = c;
  }

  protected override updated(ch: PropertyValues): void {
    super.updated(ch);
    this.#syncDialog();
  }

  // ---- hộp xác nhận ----

  #syncDialog(): void {
    const c = this.ctl;
    const s = this.cstate;
    if (!c || !s || s.phase !== 'confirming') {
      this.#closeDialog(true);
      return;
    }
    if (!this.#dialog) {
      const d = new MatConfirmDialog();
      d.onConfirm = () => c.confirm();
      d.onCancel = () => c.cancel();
      const layer = (this.modal ?? defaultModalRegistry).layer ?? document.body;
      layer.append(d);
      this.#dialog = d;
      // Phiên hết hạn không có sự kiện: kiểm lại mỗi giây khi hộp đang mở.
      this.#poll = setInterval(() => c.recompute(), 1000);
    }
    const d = this.#dialog;
    const info = s.draft.info;
    d.draft = s.draft;
    d.account = this.host?.session()?.user ?? '';
    d.lock = c.confirmLock();
    d.limits = c.limits();
    const tn = this.prop('table', '') || info.valueTable || '';
    d.table = (tn ? this.source.valueTable(tn) : undefined) ?? null;
    d.decimals = this.optNum('decimals');
  }

  #closeDialog(restoreFocus: boolean): void {
    if (this.#poll) clearInterval(this.#poll);
    this.#poll = null;
    if (!this.#dialog) return;
    this.#dialog.remove();
    this.#dialog = null;
    if (restoreFocus) this.renderRoot.querySelector<HTMLElement>('[data-main]')?.focus();
  }

  // ---- phần hiển thị dùng chung ----

  /** Nhãn (nếu có) trong khung widget. */
  protected renderName(): TemplateResult | typeof nothing {
    const label = this.prop('label', '');
    return label ? html`<div class="name ellipsis">${label}</div>` : nothing;
  }

  /** Dòng lý do khóa (trong khung), lỗi nhập, và dải kết quả nổi bên dưới. */
  protected renderStatus(): TemplateResult {
    const s = this.cstate;
    const err = this.ctl?.error;
    return html`${
        s?.phase === 'locked'
          ? html`<div class="lockmsg ellipsis" id="lock" title=${s.message} data-lock=${s.code}>
              🔒 ${s.message}
            </div>`
          : nothing
      }
      ${err ? html`<div class="err" role="alert" id="err">${err}</div>` : nothing}
      <div class="status">
        <mat-result-banner
          .state=${s}
          .canDismiss=${this.ctl?.busyLock() !== 'BUSY'}
          .onDismiss=${() => this.ctl?.dismissResult()}
        ></mat-result-banner>
      </div>`;
  }

  /** Id của phần tử mô tả để `aria-describedby` (khóa hoặc lỗi). */
  protected describedBy(): string | undefined {
    if (this.cstate?.phase === 'locked') return 'lock';
    if (this.ctl?.error) return 'err';
    return undefined;
  }

  /** Khung ngoài: lớp quality, nhãn quality, nội dung, trạng thái. */
  protected frame(content: TemplateResult): TemplateResult {
    const qv = this.qv(this.tagId);
    return html`<div class="w ctl ${qv.cls}">
      ${this.badge(qv)} ${content} ${this.renderStatus()}
    </div>`;
  }
}
