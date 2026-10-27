// Widget `time-range` (feature 029): hẹn giờ Từ–Đến ghi vào Tag, kiểu bộ chọn giờ của ATSCADA FastWeb. Hai dạng lưu:
//  - `hourMinute` (mặc định): bốn Tag số `startHour`, `startMinute`, `endHour`, `endMinute`;
//  - `minutes`: hai Tag số `start`, `end` là phút trong ngày (0–1439).
// Bấm Ghi: một hộp xác nhận cho cả khoảng giờ, rồi ghi lần lượt từng Tag qua ControlController (kiểm quyền, minRole,
// giới hạn Tag như mọi widget điều khiển). Đang soạn thì giữ giá trị người dùng nhập tới khi ghi xong hoặc hủy.
import { css, html, nothing, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

const HM = ['startHour', 'startMinute', 'endHour', 'endMinute'] as const;
const MIN = ['start', 'end'] as const;

const pad = (n: number): string => String(n).padStart(2, '0');
/** "HH:MM" → phút trong ngày; sai dạng thì null. */
export function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}
export const fmtHm = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export class MatWTimeRange extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      .tr {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--mat-text-muted, #56646a);
        font-size: 12px;
      }
      input {
        width: 92px;
        padding: 3px 6px;
        border-radius: var(--mat-radius, 4px);
        border: 1px solid var(--mat-border-strong, #b3bec3);
        background: var(--mat-surface, #fff);
        font-variant-numeric: tabular-nums;
      }
      button {
        flex: none;
        padding: 4px 12px;
        border-radius: var(--mat-radius, 4px);
        border: 1px solid var(--mat-accent, #0b7285);
        background: var(--mat-accent, #0b7285);
        color: var(--mat-accent-ink, #fff);
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ];

  #draft: { from: string; to: string } | null = null;

  #format(): 'hourMinute' | 'minutes' {
    return this.prop('format', 'hourMinute') === 'minutes' ? 'minutes' : 'hourMinute';
  }

  protected override controlSlots(): readonly string[] {
    return this.#format() === 'minutes' ? MIN : HM;
  }

  override get tagId(): string | undefined {
    for (const s of this.controlSlots()) {
      const id = this.tagOf(s);
      if (id) return id;
    }
    return undefined;
  }

  protected override settled(): void {
    this.#draft = null;
  }

  #num(slot: string): number | null {
    const id = this.tagOf(slot);
    const v = id ? this.source?.get(id).value : null;
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  }

  /** Khoảng giờ hiện trên Tag ("HH:MM"), rỗng khi chưa có giá trị. */
  #current(): { from: string; to: string } {
    if (this.#format() === 'minutes') {
      const a = this.#num('start');
      const b = this.#num('end');
      return {
        from: a !== null && a >= 0 && a < 1440 ? fmtHm(a) : '',
        to: b !== null && b >= 0 && b < 1440 ? fmtHm(b) : '',
      };
    }
    const [sh, sm, eh, em] = HM.map((s) => this.#num(s));
    const hm = (h: number | null, m: number | null) =>
      h !== null && m !== null && h >= 0 && h < 24 && m >= 0 && m < 60 ? `${pad(h)}:${pad(m)}` : '';
    return { from: hm(sh!, sm!), to: hm(eh!, em!) };
  }

  /** Lệnh ghi cho khoảng giờ; null khi sai dạng hoặc thiếu Tag. */
  entries(from: string, to: string): Array<{ tag: string; value: number }> | null {
    const a = parseHm(from);
    const b = parseHm(to);
    if (a === null || b === null) return null;
    const vals: Record<string, number> =
      this.#format() === 'minutes'
        ? { start: a, end: b }
        : {
            startHour: Math.floor(a / 60),
            startMinute: a % 60,
            endHour: Math.floor(b / 60),
            endMinute: b % 60,
          };
    const out: Array<{ tag: string; value: number }> = [];
    for (const s of this.controlSlots()) {
      const tag = this.tagOf(s);
      if (!tag) return null;
      out.push({ tag, value: vals[s]! });
    }
    return out;
  }

  #edit(which: 'from' | 'to', v: string): void {
    this.#draft = { ...(this.#draft ?? this.#current()), [which]: v };
    if (this.ctl) this.ctl.error = null;
    this.requestUpdate();
  }

  #submit = (): void => {
    const c = this.ctl;
    if (!c || !this.ready) return;
    const d = this.#draft ?? this.#current();
    const list = this.entries(d.from, d.to);
    if (!list) {
      c.error = 'Nhập đủ giờ Từ và Đến (HH:MM)';
      this.requestUpdate();
      return;
    }
    const label = this.prop('label', '');
    c.proposeMany(list, `${label ? label + ': ' : ''}đặt giờ từ ${d.from} đến ${d.to}`);
  };

  protected override renderWidget(): TemplateResult | typeof nothing {
    const shown = this.#draft ?? this.#current();
    const disabled = this.mode !== 'run' || !this.ready;
    const label = this.prop('label', '');
    return this.frame(
      html`${label ? html`<div class="name ellipsis">${label}</div>` : nothing}
        <div class="tr" role="group" aria-label=${label || 'Hẹn giờ'}>
          <label
            >${this.prop('fromText', 'Từ')}
            <input
              type="time"
              data-main
              data-part="from"
              .value=${shown.from}
              ?disabled=${disabled}
              @change=${(e: Event) => this.#edit('from', (e.target as HTMLInputElement).value)}
          /></label>
          <label
            >${this.prop('toText', 'Đến')}
            <input
              type="time"
              data-part="to"
              .value=${shown.to}
              ?disabled=${disabled}
              @change=${(e: Event) => this.#edit('to', (e.target as HTMLInputElement).value)}
          /></label>
          <button type="button" data-write ?disabled=${disabled} @click=${this.#submit}>Ghi</button>
        </div>`,
    );
  }
}

if (!customElements.get('mat-w-time-range'))
  customElements.define('mat-w-time-range', MatWTimeRange);
