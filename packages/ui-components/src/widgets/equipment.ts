// Widget `equipment` (feature 037): thiết bị Motor / Bơm / Quạt / Van có trạng thái Chạy / Dừng / Lỗi và nút điều khiển.
// - Trạng thái: khe `state` (BOOL, hoặc số bằng `runValue` = chạy); lỗi khi khe `fault` sáng hoặc `state` bằng
//   `faultValue`. Màu: chạy xanh lá, dừng xám đá, lỗi đỏ nhấp nháy; chữ trạng thái luôn có (không chỉ màu).
// - Chuyển động: cánh quạt/bánh công tác/đầu trục quay khi chạy (`animate`, CSS `transform: rotate`, chỉ ở chế độ chạy,
//   tắt khi giảm chuyển động). Van không quay: mở = tô màu.
// - Điều khiển: khe `target` (tùy chọn, cần quyền ghi) và `showButtons` thì có hai nút Chạy / Dừng; BOOL ghi true/false,
//   số ghi `startValue` / `stopValue`; xác nhận, khóa quyền, dải kết quả dùng chung ControlWidget.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { numberOf } from '../format/format-value.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

export type EquipState = 'run' | 'stop' | 'fault' | 'unknown';
export const EQUIP_KINDS = ['motor', 'pump', 'fan', 'valve'] as const;
type Kind = (typeof EQUIP_KINDS)[number];

const WORD: Record<EquipState, string> = {
  run: 'Đang chạy',
  stop: 'Dừng',
  fault: 'Lỗi',
  unknown: 'Không rõ',
};
const VALVE_WORD: Partial<Record<EquipState, string>> = { run: 'Mở', stop: 'Đóng' };

const truthy = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : numberOf(v as Parameters<typeof numberOf>[0]) !== 0;

/** Rotor quay (nhóm `rot`) và phần tĩnh của từng loại, lưới 64 × 64. */
function symbol(kind: Kind) {
  switch (kind) {
    case 'pump':
      return svg`<path class="pipe" d="M4 40h14M46 14h14"/>
        <circle class="body" cx="32" cy="36" r="17"/>
        <path class="body" d="M40 22h10v-8"/>
        <path class="base" d="M18 58h28l-4-6H22Z"/>
        <g class="rot"><circle class="hub" cx="32" cy="36" r="4"/>
          <path class="blade" d="M32 32c2-6 8-8 11-6M36 38c6 1 9 6 7 9M28 38c-5 4-11 3-12 0"/></g>`;
    case 'fan':
      return svg`<circle class="body" cx="32" cy="32" r="27"/>
        <g class="rot"><path class="vane" d="M32 32c-2-9 1-18 7-19s6 9-7 19Z"/>
          <path class="vane" d="M32 32c9-2 18 1 19 7s-9 6-19-7Z"/>
          <path class="vane" d="M32 32c2 9-1 18-7 19s-6-9 7-19Z"/>
          <path class="vane" d="M32 32c-9 2-18-1-19-7s9-6 19 7Z"/>
          <circle class="hub" cx="32" cy="32" r="4"/></g>`;
    case 'valve':
      return svg`<path class="pipe" d="M2 40h10M52 40h10"/>
        <path class="body vbody" d="M12 28v24l20-12Z M52 28v24L32 40Z"/>
        <path class="stem" d="M32 40V20"/>
        <path class="body act" d="M20 8h24v12H20Z"/>`;
    default:
      return svg`<path class="body" d="M10 20h34v28H10Z"/>
        <path class="fin" d="M16 20v28M22 20v28M28 20v28M34 20v28"/>
        <path class="body" d="M44 26h6v16h-6Z"/>
        <path class="base" d="M8 54h40l-3-6H11Z"/>
        <g class="rot"><circle class="body" cx="56" cy="34" r="6"/><path class="hub-x" d="M56 29v10M51 34h10"/></g>`;
  }
}

export class MatWEquipment extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      .w.ctl {
        --c: var(--mat-tile-slate, #2d353c);
        padding: 8px 10px;
        gap: 6px;
        justify-content: flex-start;
        border-top: 4px solid var(--c);
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
      }
      .st-run {
        --c: var(--mat-tile-green, #268426);
      }
      .st-stop {
        --c: #6f7f88;
      }
      .st-fault {
        --c: var(--mat-tile-rose, #c84845);
      }
      .st-unknown {
        --c: var(--mat-offline, #6b777c);
      }
      .top {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .title {
        flex: 1;
        min-width: 0;
        font-weight: 600;
        font-size: 13px;
      }
      .pill {
        flex: none;
        padding: 1px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        color: #fff;
        background: var(--c);
      }
      .sym {
        flex: 1;
        min-height: 0;
        width: 100%;
        display: block;
      }
      .sym * {
        vector-effect: non-scaling-stroke;
      }
      .body,
      .fin,
      .pipe,
      .stem,
      .base,
      .hub-x,
      .blade {
        fill: none;
        stroke: color-mix(in srgb, var(--c) 85%, #000);
        stroke-width: 2.5;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
      .body {
        fill: color-mix(in srgb, var(--c) 16%, var(--mat-surface, #fff));
      }
      .base {
        fill: color-mix(in srgb, var(--c) 40%, #3a4247);
      }
      .pipe {
        stroke-width: 6;
        stroke: #8a979e;
      }
      .vane,
      .hub {
        fill: var(--c);
        stroke: none;
      }
      .st-run .vbody {
        fill: var(--c);
      }
      .rot {
        transform-box: fill-box;
        transform-origin: center;
      }
      .spin .rot {
        animation: mat-spin 1.4s linear infinite;
      }
      @keyframes mat-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spin .rot {
          animation: none;
        }
      }
      .btns {
        display: flex;
        gap: 6px;
      }
      .btns button {
        flex: 1;
        min-height: 30px;
        border: 0;
        border-radius: var(--mat-radius, 4px);
        font-weight: 700;
        color: #fff;
        cursor: pointer;
      }
      .b-start {
        background: var(--mat-tile-green, #268426);
      }
      .b-stop {
        background: var(--mat-tile-rose, #c84845);
      }
      .btns button:hover:not(:disabled) {
        filter: brightness(1.08);
      }
    `,
  ];

  protected override needsController(): boolean {
    return !!this.tagOf('target');
  }

  /** Trạng thái thiết bị từ khe `state` và `fault`. */
  equipState(): EquipState {
    const id = this.tagOf('state');
    if (!id) return 'unknown';
    const s = this.source.get(id);
    if (s.quality !== 'GOOD' && s.quality !== 'UNCERTAIN') return 'unknown';
    const fid = this.tagOf('fault');
    if (fid) {
      const f = this.source.get(fid);
      if ((f.quality === 'GOOD' || f.quality === 'UNCERTAIN') && f.value != null && truthy(f.value))
        return 'fault';
    }
    const v = s.value;
    if (v === null || v === undefined) return 'unknown';
    if (typeof v === 'boolean') return v ? 'run' : 'stop';
    const n = numberOf(v as Parameters<typeof numberOf>[0]);
    if (!Number.isFinite(n)) return 'unknown';
    const fv = this.optNum('faultValue');
    if (fv !== undefined && n === fv) return 'fault';
    return n === (this.optNum('runValue') ?? 1) ? 'run' : 'stop';
  }

  #command(start: boolean): void {
    const id = this.tagId;
    if (!this.ctl || !this.ready || !id) return;
    const type = this.source.info(id)?.type;
    if (type === 'BOOL') this.ctl.propose('write', start);
    else
      this.ctl.propose(
        'write',
        start ? (this.optNum('startValue') ?? 1) : (this.optNum('stopValue') ?? 0),
      );
  }

  protected override renderWidget(): TemplateResult {
    const st = this.equipState();
    const kindProp = this.prop('kind', 'motor');
    const kind: Kind = (EQUIP_KINDS as readonly string[]).includes(kindProp)
      ? (kindProp as Kind)
      : 'motor';
    const word = (kind === 'valve' ? VALVE_WORD[st] : undefined) ?? WORD[st];
    const spin =
      st === 'run' && kind !== 'valve' && this.mode !== 'edit' && this.prop('animate', true);
    const label = this.prop('label', '');
    const name = this.nameOf(this.tagOf('state'));
    const qv = this.qv(this.tagOf('state'));
    const buttons = !!this.tagId && this.prop('showButtons', true);
    const disabled = this.mode !== 'run' || !this.ready;
    return html`<div
      class="w ctl st-${st} ${qv.cls}"
      role="group"
      aria-label=${[`${name}: ${word}`, qv.aria].filter(Boolean).join(', ')}
    >
      <div class="top">
        <span class="title ellipsis">${label || name}</span>
        <span class="pill ${st === 'fault' && this.mode !== 'edit' ? 'blink' : ''}">${word}</span>
      </div>
      <svg class="sym ${spin ? 'spin' : ''}" viewBox="0 0 64 64" aria-hidden="true">
        ${symbol(kind)}
      </svg>
      ${
        buttons
          ? html`<div class="btns">
              <button
                type="button"
                class="b-start"
                data-main
                ?disabled=${disabled}
                aria-describedby=${this.describedBy() ?? nothing}
                @click=${() => this.#command(true)}
              >
                ${this.prop('startText', 'Chạy')}
              </button>
              <button
                type="button"
                class="b-stop"
                ?disabled=${disabled}
                @click=${() => this.#command(false)}
              >
                ${this.prop('stopText', 'Dừng')}
              </button>
            </div>`
          : nothing
      }
      ${this.badge(qv)} ${buttons ? this.renderStatus() : nothing}
    </div>`;
  }
}
