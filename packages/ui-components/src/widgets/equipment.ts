// Widget `equipment` (feature 037): thiết bị Motor / Bơm / Quạt / Van có trạng thái Chạy / Dừng / Lỗi và nút điều khiển.
// - Trạng thái: khe `state` (BOOL, hoặc số bằng `runValue` = chạy); lỗi khi khe `fault` sáng hoặc `state` bằng
//   `faultValue`. Màu: chạy xanh lá, dừng xám, lỗi đỏ nhấp nháy; chữ trạng thái luôn có (không chỉ màu), đổi được bằng
//   `runText` / `stopText` / `faultText`.
// - Chuyển động (review hiệu năng BL335): phần quay là một <svg> riêng (phần tử hộp CSS) xoay bằng `transform` quanh tâm
//   rotor, nên trình duyệt quay cả lớp trên compositor, không tính lại hình SVG mỗi khung. Chỉ quay khi `animate`, chế độ
//   chạy, widget trong vùng nhìn và project bật chuyển động (thuộc tính `still` của MatWidget). Van không quay.
// - Điều khiển: khe `target` (tùy chọn, cần quyền ghi) và `showButtons` thì có hai nút Chạy / Dừng; BOOL ghi true/false,
//   số ghi `startValue` / `stopValue` (làm tròn khi Tag kiểu nguyên); câu xác nhận "Chạy Bơm 1?"; xác nhận, khóa quyền,
//   dải kết quả dùng chung ControlWidget.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

export type EquipState = 'run' | 'stop' | 'fault' | 'unknown';
export const EQUIP_KINDS = ['motor', 'pump', 'fan', 'valve'] as const;
type Kind = (typeof EQUIP_KINDS)[number];

const INTEGER_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);

const truthy = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : numberOf(v as Parameters<typeof numberOf>[0]) !== 0;

interface Sym {
  fixed: ReturnType<typeof svg>;
  rotor?: ReturnType<typeof svg>;
  /** Tâm quay theo % của khung 64 × 64. */
  origin?: string;
}

/** Ký hiệu từng loại, lưới 64 × 64. Bơm theo ký hiệu ISA 5.1: vòng tròn, cửa ra tiếp tuyến, chân tam giác. */
function symbol(kind: Kind): Sym {
  switch (kind) {
    case 'pump':
      return {
        fixed: svg`<path class="pipe" d="M2 36h12M32 16h28"/>
          <path class="base" d="M17 58h30L32 44Z"/>
          <circle class="body" cx="32" cy="34" r="18"/>`,
        rotor: svg`<path class="blade" d="M32 34l0-11M32 34l9.5 5.5M32 34l-9.5 5.5"/>
          <circle class="hub" cx="32" cy="34" r="3.5"/>`,
        origin: '50% 53.125%',
      };
    case 'fan':
      return {
        fixed: svg`<circle class="body" cx="32" cy="32" r="27"/>`,
        rotor: svg`<path class="vane" d="M32 32c-2-9 1-18 7-19s6 9-7 19Z"/>
          <path class="vane" d="M32 32c9-2 18 1 19 7s-9 6-19-7Z"/>
          <path class="vane" d="M32 32c2 9-1 18-7 19s-6-9 7-19Z"/>
          <path class="vane" d="M32 32c-9 2-18-1-19-7s9-6 19 7Z"/>
          <circle class="hub" cx="32" cy="32" r="4"/>`,
        origin: '50% 50%',
      };
    case 'valve':
      return {
        fixed: svg`<path class="pipe" d="M2 40h10M52 40h10"/>
          <path class="body vbody" d="M12 28v24l20-12Z M52 28v24L32 40Z"/>
          <path class="stem" d="M32 40V20"/>
          <path class="body act" d="M20 8h24v12H20Z"/>`,
      };
    default:
      return {
        fixed: svg`<path class="body" d="M8 20h34v28H8Z"/>
          <path class="fin" d="M14 20v28M20 20v28M26 20v28M32 20v28"/>
          <path class="body" d="M42 26h6v16h-6Z"/>
          <path class="base" d="M6 54h40l-3-6H9Z"/>
          <circle class="body" cx="55" cy="34" r="7"/>`,
        rotor: svg`<path class="hub-x" d="M55 28v12M49 34h12"/>`,
        origin: '85.94% 53.125%',
      };
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
      .w.st-run {
        --c: var(--mat-tile-green, #268426);
      }
      .w.st-stop {
        --c: #6f7f88;
      }
      .w.st-fault {
        --c: var(--mat-tile-rose, #c84845);
      }
      .w.st-unknown {
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
      .symwrap {
        flex: 1;
        min-height: 0;
        display: flex;
        justify-content: center;
      }
      .sq {
        position: relative;
        height: 100%;
        max-width: 100%;
        aspect-ratio: 1;
      }
      .sq > svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .sq * {
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
        fill: color-mix(in srgb, var(--c) 18%, var(--mat-surface, #fff));
      }
      .blade {
        stroke-width: 3.5;
        stroke: var(--c);
      }
      .base {
        fill: color-mix(in srgb, var(--c) 45%, #3a4247);
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
      .w.st-run .vbody {
        fill: var(--c);
      }
      .spin .rotor {
        animation: mat-spin 1.4s linear infinite;
      }
      @keyframes mat-spin {
        to {
          transform: rotate(360deg);
        }
      }
      /* Rotor quay là trạng thái vận hành (ADR 056): không theo prefers-reduced-motion, chỉ "still". */
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

  /** Chữ trạng thái: thuộc tính đặt tay thắng chữ mặc định (van: Mở/Đóng). */
  stateWord(st: EquipState, kind: Kind): string {
    const own = (k: string) => this.prop(k, '');
    if (st === 'run') return own('runText') || (kind === 'valve' ? vi.equip.open : vi.equip.run);
    if (st === 'stop')
      return own('stoppedText') || (kind === 'valve' ? vi.equip.closed : vi.equip.stop);
    if (st === 'fault') return own('faultText') || vi.equip.fault;
    return vi.equip.unknown;
  }

  /** Giá trị ghi của lệnh: BOOL true/false; số theo startValue/stopValue, làm tròn khi Tag kiểu nguyên. */
  commandValue(start: boolean): boolean | number | undefined {
    const id = this.tagId;
    const type = id ? this.source.info(id)?.type : undefined;
    if (!type) return undefined;
    if (type === 'BOOL') return start;
    const v = start ? (this.optNum('startValue') ?? 1) : (this.optNum('stopValue') ?? 0);
    return INTEGER_TYPES.has(type) ? Math.round(v) : v;
  }

  #command(start: boolean): void {
    const v = this.commandValue(start);
    if (!this.ctl || !this.ready || v === undefined) return;
    const cmd = start
      ? this.prop('startText', vi.equip.start)
      : this.prop('stopText', vi.equip.stop);
    const name = this.prop('label', '') || this.nameOf(this.tagOf('state'));
    this.ctl.propose('write', v, {
      text: vi.equip.confirm.replace('{cmd}', cmd).replace('{name}', name),
    });
  }

  protected override renderWidget(): TemplateResult {
    const st = this.equipState();
    const kindProp = this.prop('kind', 'motor');
    const kind: Kind = (EQUIP_KINDS as readonly string[]).includes(kindProp)
      ? (kindProp as Kind)
      : 'motor';
    const word = this.stateWord(st, kind);
    const sym = symbol(kind);
    const spin = st === 'run' && !!sym.rotor && this.mode !== 'edit' && this.prop('animate', true);
    const label = this.prop('label', '');
    const name = label || this.nameOf(this.tagOf('state'));
    const qv = this.qv(this.tagOf('state'));
    const buttons = !!this.tagId && this.prop('showButtons', true);
    const disabled = this.mode !== 'run' || !this.ready;
    const startText = this.prop('startText', vi.equip.start);
    const stopText = this.prop('stopText', vi.equip.stop);
    return html`<div
      class="w ctl st-${st} ${qv.cls}"
      role="group"
      aria-label=${[`${name}: ${word}`, qv.aria].filter(Boolean).join(', ')}
    >
      <div class="top">
        <span class="title ellipsis">${name}</span>
        <span class="pill ${st === 'fault' ? 'blink' : ''}">${word}</span>
      </div>
      <div class="symwrap" aria-hidden="true">
        <div class="sq ${spin ? 'spin' : ''}">
          <svg class="sym" viewBox="0 0 64 64">${sym.fixed}</svg>
          ${
            sym.rotor
              ? html`<svg class="rotor" viewBox="0 0 64 64" style="transform-origin:${sym.origin}">
                  ${sym.rotor}
                </svg>`
              : nothing
          }
        </div>
      </div>
      ${
        buttons
          ? html`<div class="btns">
              <button
                type="button"
                class="b-start"
                data-main
                ?disabled=${disabled}
                aria-label=${`${startText} ${name}`}
                aria-describedby=${this.describedBy() ?? nothing}
                @click=${() => this.#command(true)}
              >
                ${startText}
              </button>
              <button
                type="button"
                class="b-stop"
                ?disabled=${disabled}
                aria-label=${`${stopText} ${name}`}
                @click=${() => this.#command(false)}
              >
                ${stopText}
              </button>
            </div>`
          : nothing
      }
      ${this.badge(qv)} ${buttons ? this.renderStatus() : nothing}
    </div>`;
  }
}
