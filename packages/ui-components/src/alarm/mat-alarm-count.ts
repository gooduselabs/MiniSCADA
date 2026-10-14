// Widget `alarm-count` (Số alarm; FR-069, FR-071, FR-072; contracts/ui-alarm.md §13.2): đèn tròn có số. Màu theo mức ưu tiên cao nhất
// trong tập đếm (màu của lớp đó), xám khi 0; nhấp nháy theo lớp khi có ACTIVE_UNACK (đồng hồ chung, ≤ 1 Hz; giảm chuyển động thì viền
// đậm tĩnh); bấm đi tới trang Alarm, một màn hình, hoặc không làm gì (`target`). Là `<button>` thật với `aria-label` đọc được.
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { alarmVi } from '../i18n/alarm-vi.ts';
import { vi } from '../i18n/vi.ts';
import type {
  AlarmClassInfo,
  AlarmColor,
  AlarmInstance,
  AlarmPriority,
  AlarmSource,
} from '../host/types.ts';
import { MatWidget } from '../widgets/base.ts';
import { PRIORITY_RANK, filterInstances, sharedBlinkClock } from './alarm-format.ts';
import { countProps } from './alarm-widget-props.ts';

const COLORS: ReadonlySet<string> = new Set([
  'red',
  'orange',
  'amber',
  'blue',
  'purple',
  'teal',
  'gray',
  'green',
]);
const DEFAULT_COLOR: Readonly<Record<AlarmPriority, AlarmColor>> = {
  critical: 'red',
  major: 'orange',
  minor: 'amber',
  advisory: 'blue',
};

const raf = (cb: () => void): number => {
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
  return g.requestAnimationFrame
    ? g.requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);
};

export class MatAlarmCount extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    alarms: { attribute: false },
  };
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .w {
        display: grid;
        place-items: center;
        height: 100%;
      }
      button {
        --c: var(--mat-alarm-gray);
        --c-soft: var(--mat-alarm-gray-soft);
        --c-ink: var(--mat-alarm-gray-ink);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        min-height: 32px;
        max-width: 100%;
        max-height: 100%;
        aspect-ratio: 1;
        padding: 0 8px;
        border-radius: 999px;
        border: 2px solid var(--c);
        background: var(--c);
        color: var(--c-ink);
        font: 700 16px/1 var(--mat-font);
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }
      button[data-act='none'],
      button[data-edit] {
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--mat-accent);
        outline-offset: 2px;
      }
      button[data-color='red'] {
        --c: var(--mat-alarm-red);
        --c-soft: var(--mat-alarm-red-soft);
        --c-ink: var(--mat-alarm-red-ink);
      }
      button[data-color='orange'] {
        --c: var(--mat-alarm-orange);
        --c-soft: var(--mat-alarm-orange-soft);
        --c-ink: var(--mat-alarm-orange-ink);
      }
      button[data-color='amber'] {
        --c: var(--mat-alarm-amber);
        --c-soft: var(--mat-alarm-amber-soft);
        --c-ink: var(--mat-alarm-amber-ink);
      }
      button[data-color='blue'] {
        --c: var(--mat-alarm-blue);
        --c-soft: var(--mat-alarm-blue-soft);
        --c-ink: var(--mat-alarm-blue-ink);
      }
      button[data-color='purple'] {
        --c: var(--mat-alarm-purple);
        --c-soft: var(--mat-alarm-purple-soft);
        --c-ink: var(--mat-alarm-purple-ink);
      }
      button[data-color='teal'] {
        --c: var(--mat-alarm-teal);
        --c-soft: var(--mat-alarm-teal-soft);
        --c-ink: var(--mat-alarm-teal-ink);
      }
      button[data-color='green'] {
        --c: var(--mat-alarm-green);
        --c-soft: var(--mat-alarm-green-soft);
        --c-ink: var(--mat-alarm-green-ink);
      }
      @media (prefers-reduced-motion: no-preference) {
        :host([data-blink-phase='off']) button.blink {
          background: var(--c-soft);
          color: var(--mat-text);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        button.blink {
          outline: 3px solid var(--mat-text);
          outline-offset: 2px;
        }
      }
    `,
  ];

  declare alarms: AlarmSource | undefined;

  #unsub: (() => void) | null = null;
  #subbed: AlarmSource | undefined;
  #rafId = 0;
  #blinkOff: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resubscribe();
  }

  override disconnectedCallback(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#subbed = undefined;
    this.#blinkOff?.();
    this.#blinkOff = null;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has('alarms') && this.isConnected) this.#resubscribe();
  }

  protected override updated(): void {
    const blink = this.#state().blink && this.mode !== 'edit';
    if (blink && !this.#blinkOff) {
      this.#blinkOff = sharedBlinkClock(this.ownerDocument).acquire((p) => {
        this.dataset.blinkPhase = p;
      });
    } else if (!blink && this.#blinkOff) {
      this.#blinkOff();
      this.#blinkOff = null;
      delete this.dataset.blinkPhase;
    }
  }

  #resubscribe(): void {
    if (this.#subbed === this.alarms && this.#unsub) return;
    this.#unsub?.();
    this.#subbed = this.alarms;
    this.#unsub =
      this.alarms?.subscribe(() => {
        if (this.#rafId) return;
        this.#rafId = raf(() => {
          this.#rafId = 0;
          this.requestUpdate();
        });
      }) ?? null;
  }

  /** Số đếm, màu, nhấp nháy từ nguồn hiện tại. */
  #state(): { n: number; color: AlarmColor; blink: boolean } {
    const src = this.alarms;
    const p = countProps(this.item);
    if (!src) return { n: 0, color: 'gray', blink: false };
    const classes: ReadonlyMap<string, AlarmClassInfo> = new Map(
      src.classes().map((c) => [c.id, c]),
    );
    const pool = filterInstances(
      src.snapshot().instances.filter((i) => i.shelved === undefined && i.state !== 'NORMAL'),
      { areas: p.areas, minPriority: p.minPriority },
    );
    const counted: AlarmInstance[] =
      p.mode === 'active'
        ? pool
        : pool.filter((i) => i.state === 'ACTIVE_UNACK' || i.state === 'RTN_UNACK');
    if (counted.length === 0) return { n: 0, color: 'gray', blink: false };
    let top = counted[0]!;
    for (const i of counted) if (PRIORITY_RANK[i.priority] > PRIORITY_RANK[top.priority]) top = i;
    const cls = classes.get(top.class);
    const color: AlarmColor =
      cls && COLORS.has(cls.color) ? cls.color : DEFAULT_COLOR[top.priority];
    const blink = counted.some(
      (i) => i.state === 'ACTIVE_UNACK' && classes.get(i.class)?.blink === true,
    );
    return { n: counted.length, color, blink };
  }

  #click = (): void => {
    if (this.mode === 'edit') return;
    const t = countProps(this.item).target;
    if (t.kind === 'alarms') location.hash = '#/alarms';
    else if (t.kind === 'screen') this.host?.navigate(t.screen);
  };

  protected override render(): TemplateResult | typeof nothing {
    if (!this.item) return nothing;
    const src = this.alarms;
    const p = countProps(this.item);
    const status = src?.status();
    const { n, color, blink } = this.#state();
    const label = !src
      ? alarmVi.emptyNoSource
      : status === 'none'
        ? alarmVi.emptyNoConfig
        : p.mode === 'active'
          ? alarmVi.widget.countActive(n)
          : alarmVi.widget.countUnacked(n);
    return html`<div class="w">
      <button
        type="button"
        class=${blink && this.mode !== 'edit' ? 'blink' : ''}
        data-color=${color}
        data-act=${p.target.kind}
        ?data-edit=${this.mode === 'edit'}
        aria-label=${label}
        title=${label}
        @click=${this.#click}
      >
        <span data-n>${src ? n : vi.noValue}</span>
      </button>
    </div>`;
  }
}
