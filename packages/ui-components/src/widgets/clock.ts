// Widget `clock` (feature 014): ngày giờ theo giờ của thiết bị (TagSource.now(), ưu tiên giờ BL335) ở múi `utcOffset`
// (mặc định +07:00 như thời gian địa phương của project). Không Tag; vẽ lại mỗi giây khi đang gắn vào trang và tab hiện.
import { css, html, nothing, type TemplateResult } from 'lit';
import { MatWidget } from './base.ts';

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const pad = (n: number): string => String(n).padStart(2, '0');

/** Phút lệch của chuỗi `±HH:MM`; sai dạng thì +07:00. */
export function offsetMinutes(s: unknown): number {
  const m = typeof s === 'string' ? /^([+-])(\d{2}):(\d{2})$/.exec(s) : null;
  if (!m) return 7 * 60;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

/** Giờ và ngày (chuỗi) của thời điểm `ms` (UTC) ở múi `offset` phút. */
export function clockParts(
  ms: number,
  offset: number,
  seconds: boolean,
): { time: string; date: string; weekday: string } {
  const d = new Date(ms + offset * 60_000);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return { time, date, weekday: WEEKDAYS[d.getUTCDay()]! };
}

/** Phần phụ thuộc môi trường (bộ hẹn giờ), thay được trong test. */
export const clockEnv = {
  setInterval: (fn: () => void, ms: number): unknown => globalThis.setInterval(fn, ms),
  clearInterval: (h: unknown): void =>
    globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

export class MatClock extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        gap: 2px;
        padding: 10px 14px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
      .label {
        font-size: 13px;
        color: var(--mat-text-muted);
      }
      .big {
        font-size: 28px;
        font-weight: 700;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .sub {
        font-size: 13px;
        color: var(--mat-text-muted);
        white-space: nowrap;
      }
    `,
  ];

  #timer: unknown = null;

  override tagIds(): string[] {
    return [];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.#timer === null)
      this.#timer = clockEnv.setInterval(() => {
        if (!this.ownerDocument.hidden) this.requestUpdate();
      }, 1000);
  }

  override disconnectedCallback(): void {
    if (this.#timer !== null) clockEnv.clearInterval(this.#timer);
    this.#timer = null;
    super.disconnectedCallback();
  }

  protected override renderWidget(): TemplateResult {
    const p = clockParts(
      this.source.now(),
      offsetMinutes(this.prop('utcOffset', '+07:00')),
      this.prop('seconds', true),
    );
    const format = this.prop('format', 'datetime');
    const label = this.prop('label', '');
    const day = `${p.weekday}, ${p.date}`;
    return html`<div
      class="w"
      role="timer"
      aria-label=${[label, p.time, day].filter(Boolean).join(', ')}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      ${
        format === 'date'
          ? html`<div class="big">${p.date}</div>
              <div class="sub">${p.weekday}</div>`
          : html`<div class="big">${p.time}</div>
              ${format === 'datetime' ? html`<div class="sub">${day}</div>` : nothing}`
      }
    </div>`;
  }
}
