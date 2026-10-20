// Bảng "Thử logic" (feature 011, T144; FR-094; mockup studio-logic.html cảnh 2): tab cạnh Thông tin ở khung dưới của editor
// Logic. Chạy `LogicSim` (model/logic-sim.ts: @mat/logic-engine trên Tag mô phỏng của 006, đồng hồ ảo): Chạy/Dừng (Space khi
// panel có focus), một quét, đặt lại, tua ×1/×10/×100 (mỗi 100 ms thật chạy đúng `speed` lần quét 100 ms), đặt tay giá trị
// và quality, cờ timeSynced và giờ thực giả lập cho khối Lịch; đường thời gian bằng SVG (lit `svg`, không innerHTML); nhật
// ký hành động; trạng thái khối; Lưu kịch bản thành ca vector. Không gửi gì tới thiết bị, không audit.
import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  LOGIC_SIM_SPEEDS,
  LogicSim,
  isoWithOffset,
  type LogicSimSpeed,
  type SimValue,
} from '../../model/logic-sim.ts';
import { AppElement, icon } from '../base.ts';
import { ACTION_ICON, actionLabel, num, stateChip } from './logic-parts.ts';
import { logicDoc, logicSim, projectTags, simChanged } from './logic-state.ts';

const TICK_MS = 100;
const DOW = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const WINDOW_KEY: Readonly<Record<LogicSimSpeed, MessageKey>> = {
  1: 'logic.test.win1',
  10: 'logic.test.win10',
  100: 'logic.test.win100',
};

const fmtVal = (v: SimValue | undefined): string => {
  if (!v) return '—';
  if (v.quality !== 'GOOD') return v.reason ? `${v.quality} · ${v.reason}` : v.quality;
  const x = v.value;
  if (typeof x === 'number') return num(x);
  if (typeof x === 'bigint') return x.toString();
  return String(x);
};

const isBoolType = (type: string | undefined) => type === 'BOOL';

/** Khoảng hiển thị tối thiểu của đường thời gian (ms): lúc mới chạy vẫn đọc được vài giây. */
const MIN_SPAN_MS = 10_000;

/**
 * Khoảng thời gian ảo đường thời gian hiển thị: từ 0 tới thời điểm hiện tại (cộng 5 %, tối thiểu MIN_SPAN_MS) khi chưa chạy
 * hết cửa sổ của tốc độ, rồi trượt theo cửa sổ. Tín hiệu luôn trải hết bề ngang, không dồn ở mép trái (T144).
 */
export function timelineWindow(t: number, windowMs: number): { t0: number; t1: number } {
  if (t >= windowMs) return { t0: t - windowMs, t1: t };
  return { t0: 0, t1: Math.min(windowMs, Math.max(MIN_SPAN_MS, Math.ceil(t * 1.05))) };
}

/** Bề ngang SVG (px) theo vùng chứa đo được: bằng vùng chứa, tối thiểu 320; chưa đo (0) thì 900. */
export function timelineWidth(measured: number): number {
  return measured > 0 ? Math.max(320, Math.floor(measured)) : 900;
}

interface Lane {
  id: string;
  sub: string;
  kind: 'analog' | 'bool' | 'rule';
}

export class LogicTestPanel extends AppElement {
  private simRef: LogicSim | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Bề ngang đo được của vùng đường thời gian (px): vẽ đúng cỡ, chữ không bị thu nhỏ. */
  private tlWidth = 0;
  private readonly onResize = (): void => this.requestUpdate();
  /** Đo lại khi vùng đường thời gian đổi cỡ (kéo khung dưới, thu task card), không chỉ khi cửa sổ đổi cỡ. */
  private observer: ResizeObserver | null = null;
  private observed: Element | null = null;

  /** Bộ chạy của tài liệu hiện tại (dùng chung với sơ đồ, tạo lại khi logic.json đổi; feature 015). */
  get sim(): LogicSim | null {
    const sim = logicSim(this.app);
    if (sim !== this.simRef) {
      this.stop();
      this.simRef = sim;
    }
    return sim;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Vẽ lại sau khi đổi trạng thái của bộ chạy từ ngoài (test, phím). */
  refresh(): void {
    this.requestUpdate();
  }

  protected override attached(): void {
    window.addEventListener('resize', this.onResize);
  }

  protected override detached(): void {
    this.stop();
    simChanged(this.app);
    window.removeEventListener('resize', this.onResize);
    this.observer?.disconnect();
    this.observer = null;
    this.observed = null;
  }

  protected override updated(): void {
    // sơ đồ hiện giá trị của cùng bộ chạy: báo sau mỗi lần vẽ (mỗi quét, đặt tay, đặt lại)
    simChanged(this.app);
    const wrap = this.querySelector<HTMLElement>('.tlwrap');
    if (wrap && wrap !== this.observed && typeof ResizeObserver !== 'undefined') {
      this.observer ??= new ResizeObserver(() => this.requestUpdate());
      if (this.observed) this.observer.unobserve(this.observed);
      this.observer.observe(wrap);
      this.observed = wrap;
    }
    const w = wrap?.clientWidth ?? 0;
    if (w > 0 && Math.abs(w - this.tlWidth) > 4) {
      this.tlWidth = w;
      this.requestUpdate();
    }
  }

  private play(): void {
    const sim = this.sim;
    if (!sim || sim.error) return;
    if (this.timer !== null) {
      this.stop();
      this.requestUpdate();
      return;
    }
    this.timer = setInterval(() => {
      sim.advanceRealMs(TICK_MS);
      this.requestUpdate();
    }, TICK_MS);
    this.requestUpdate();
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === ' ' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) {
      e.preventDefault();
      this.play();
    }
  }

  private saveScenario(sim: LogicSim): void {
    const name = `${this.app.store.state.outline.project?.projectId ?? 'logic'}-thu-logic`;
    const v = sim.scenario(name);
    void this.app.csvSave(`${name}.json`, `${JSON.stringify(v, null, 2)}\n`, 'json');
  }

  // ---------- Đầu vào ----------

  private inputRow(sim: LogicSim, id: string) {
    const type = projectTags(this.app).find((x) => x.id === id)?.type;
    const man = sim.manualOf(id);
    const cur = sim.value(id);
    const setManual = (
      p: Partial<{
        value: boolean | number | string | null;
        quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
      }>,
    ) => {
      const base = sim.manualOf(id) ?? {
        value:
          (cur?.value as boolean | number | string | null | undefined) ??
          (isBoolType(type) ? false : 0),
        quality: 'GOOD' as const,
      };
      sim.setManual(id, { ...base, ...p } as never);
      this.requestUpdate();
    };
    return html`<div class="inrow ${man ? 'manual' : ''}" data-input=${id}>
      <span class="nm">${id} <span class="muted">${type ?? ''}</span></span
      ><span class="val mono">${fmtVal(cur)}</span>
      <div class="ctl">
        <label class="row inline sm-text"
          ><input
            type="checkbox"
            data-manual=${id}
            .checked=${!!man}
            @change=${(e: Event) => {
              if ((e.target as HTMLInputElement).checked) setManual({});
              else {
                sim.clearManual(id);
                this.requestUpdate();
              }
            }}
          />${t('logic.test.manual')}</label
        >
        ${
          isBoolType(type)
            ? html`<select
                class="select sm"
                data-value=${id}
                aria-label=${t('logic.test.valueOf', { tag: id })}
                ?disabled=${!man}
                @change=${(e: Event) => setManual({ value: (e.target as HTMLSelectElement).value === 'true' })}
              >
                <option value="true" ?selected=${man?.value === true}>true</option>
                <option value="false" ?selected=${man?.value !== true}>false</option>
              </select>`
            : html`<input
                class="input sm num"
                data-value=${id}
                aria-label=${t('logic.test.valueOf', { tag: id })}
                inputmode="decimal"
                ?disabled=${!man}
                .value=${man && man.value !== null ? String(man.value) : ''}
                @change=${(e: Event) => {
                  const s = (e.target as HTMLInputElement).value.trim().replace(',', '.');
                  const n = Number(s);
                  setManual({ value: type === 'STRING' ? s : Number.isFinite(n) ? n : 0 });
                }}
              />`
        }
        <select
          class="select sm"
          data-quality=${id}
          aria-label=${t('logic.test.qualityOf', { tag: id })}
          ?disabled=${!man}
          @change=${(e: Event) =>
            setManual({
              quality: (e.target as HTMLSelectElement).value as 'GOOD' | 'UNCERTAIN' | 'BAD',
            })}
        >
          ${(['GOOD', 'UNCERTAIN', 'BAD'] as const).map(
            (q) =>
              html`<option value=${q} ?selected=${(man?.quality ?? 'GOOD') === q}>${q}</option>`,
          )}
        </select>
      </div>
    </div>`;
  }

  private clockRow(sim: LogicSim) {
    const tz = sim.config.tzOffsetMin;
    const iso = isoWithOffset(sim.wallMs(), tz);
    const local = new Date(sim.wallMs() + tz * 60_000);
    return html`<div class="inrow" data-input="__clock">
      <span class="nm">${t('logic.test.clock')}</span>
      <span class="val"
        >${sim.timeSynced ? t('logic.test.synced') : t('logic.test.notSynced')}</span
      >
      <div class="ctl">
        <label class="row inline sm-text"
          ><input
            type="checkbox"
            data-role="synced"
            .checked=${sim.timeSynced}
            @change=${(e: Event) => {
              sim.setSynced((e.target as HTMLInputElement).checked);
              this.requestUpdate();
            }}
          /><span class="mono">timeSynced</span></label
        >
        <input
          type="datetime-local"
          class="input sm"
          data-role="wall"
          aria-label=${t('logic.test.wall')}
          .value=${iso.slice(0, 16)}
          @change=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
            if (!m) return;
            const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - tz * 60_000;
            sim.jumpWall(utc);
            this.requestUpdate();
          }}
        />
      </div>
      <span class="muted sm-text">${DOW[local.getUTCDay()]}</span>
    </div>`;
  }

  // ---------- Đường thời gian ----------

  private lanes(sim: LogicSim): Lane[] {
    const types = new Map(projectTags(this.app).map((x) => [x.id, x.type]));
    const doc = logicDoc(this.app);
    const outType = new Map<string, string>();
    for (const k of ['timers', 'counters', 'totalizers', 'runhours', 'schedules'] as const)
      for (const b of (doc?.[k] ?? []) as unknown as Array<Record<string, unknown>>)
        for (const [f, v] of Object.entries(b))
          if (typeof v === 'string' && sim.outputTags.includes(v))
            outType.set(v, ['q', 'reached', 'due', 'out'].includes(f) ? 'BOOL' : 'NUM');
    const out: Lane[] = [];
    const seen = new Set<string>();
    const push = (l: Lane) => {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        out.push(l);
      }
    };
    for (const id of sim.inputs.slice(0, 6))
      push({ id, sub: types.get(id) ?? '', kind: isBoolType(types.get(id)) ? 'bool' : 'analog' });
    for (const id of sim.ruleIds.slice(0, 6))
      push({ id, sub: t('logic.test.laneRule'), kind: 'rule' });
    for (const id of sim.writeTargets)
      push({
        id,
        sub: t('logic.test.laneWrite'),
        kind: isBoolType(types.get(id)) ? 'bool' : 'analog',
      });
    for (const id of sim.outputTags.slice(0, 6))
      push({
        id,
        sub: t('logic.test.laneLogic'),
        kind: outType.get(id) === 'BOOL' ? 'bool' : 'analog',
      });
    return out;
  }

  private timeline(sim: LogicSim): TemplateResult {
    const lanes = this.lanes(sim);
    const W = timelineWidth(this.tlWidth);
    const L = W < 560 ? 132 : 168;
    const R = 46;
    const pw = W - L - R;
    const lane = 34;
    const H = lanes.length * lane + 26;
    const { t0, t1 } = timelineWindow(sim.t, sim.windowMs);
    const span = t1 - t0;
    const X = (tm: number) => L + ((tm - t0) / span) * pw;
    const pts = sim.history.filter((h) => h.t >= t0 - 2000);
    const marks = sim.marks.filter((m) => m.t >= t0);
    const tz = sim.config.tzOffsetMin;
    const hhmmss = (tm: number) => isoWithOffset(sim.wallMs(tm), tz).slice(11, 19);
    const grid: SVGTemplateResult[] = [];
    for (let k = 0; k <= 6; k++) {
      const x = L + (pw * k) / 6;
      grid.push(
        svg`<line x1=${x} y1="0" x2=${x} y2=${H - 22} class="tl-gl"></line><text x=${x} y=${H - 8} class="tl-ax" text-anchor="middle">${hhmmss(t0 + (span * k) / 6)}</text>`,
      );
    }
    const step = Math.max(1.5, (pw / span) * 1000);
    const rows = lanes.map((ln, i) => {
      const y0 = i * lane;
      const yb = y0 + lane - 6;
      const yt = y0 + 6;
      const head = svg`<rect x="0" y=${y0} width=${L - 4} height=${lane} class=${i % 2 ? 'tl-row2' : 'tl-row'}></rect>
        <line x1="0" y1=${y0 + lane} x2=${W} y2=${y0 + lane} class="tl-gl"></line>
        <text x="8" y=${y0 + 15} class="tl-lab">${ln.id}</text>
        <text x="8" y=${y0 + 28} class="tl-sub">${ln.sub}</text>`;
      let body: SVGTemplateResult | SVGTemplateResult[] = svg``;
      if (pts.length && ln.kind === 'rule') {
        const bands: SVGTemplateResult[] = [];
        let run: { s: string; t: number } | null = null;
        const flush = (end: number) => {
          if (run)
            bands.push(
              svg`<rect x=${X(run.t)} y=${y0 + 2} width=${Math.max(1, X(end) - X(run.t))} height=${lane - 4} class="tl-s${run.s}"></rect>`,
            );
        };
        for (const p of pts) {
          const s = p.rules[ln.id]?.state ?? 'OK';
          if (!run || run.s !== s) {
            flush(p.t);
            run = { s, t: p.t };
          }
        }
        flush(sim.t);
        const holds = pts
          .filter((p) => p.rules[ln.id]?.holding)
          .map(
            (p) =>
              svg`<rect x=${X(p.t)} y=${yb + 1} width=${step} height="4" class="tl-hold"></rect>`,
          );
        let d = '';
        let prev: boolean | null = null;
        for (const p of pts) {
          const c = p.rules[ln.id]?.cond ?? null;
          if (c === null) {
            prev = null;
            continue;
          }
          const y = c ? yt + 4 : yb - 4;
          d += prev === null ? `M${X(p.t).toFixed(1)} ${y}` : `H${X(p.t).toFixed(1)}V${y}`;
          prev = c;
        }
        body = [...bands, ...holds, svg`<path d=${d || 'M0 0'} class="tl-a"></path>`];
      } else if (pts.length && ln.kind === 'bool') {
        let d = '';
        let prevNull = true;
        const bad: SVGTemplateResult[] = [];
        for (const p of pts) {
          const v = p.values[ln.id];
          if (!v || v.quality !== 'GOOD' || v.value === null) {
            if (!prevNull) d += `V${yb}`;
            prevNull = true;
            bad.push(
              svg`<rect x=${X(p.t)} y=${yt} width=${step} height=${yb - yt} class="tl-bad"></rect>`,
            );
            continue;
          }
          const y = v.value ? yt : yb;
          d += prevNull ? `M${X(p.t).toFixed(1)} ${yb}V${y}` : `H${X(p.t).toFixed(1)}V${y}`;
          prevNull = false;
        }
        if (d) d += `H${X(sim.t).toFixed(1)}V${yb}`;
        const ms = marks
          .filter((m) => m.tag === ln.id)
          .map((m) => {
            const x = X(m.t);
            return m.kind === 'write'
              ? svg`<path data-mark="write" d=${`M${x - 5} ${y0 + 12}l5 -8 5 8z`} class="tl-wr"><title>${m.rule}</title></path>`
              : svg`<path data-mark=${m.kind} d=${`M${x - 4} ${y0 + 4}l8 8M${x + 4} ${y0 + 4}l-8 8`} class="tl-rj"><title>${m.rule}</title></path>`;
          });
        body = [...bad, svg`<path d=${d || 'M0 0'} class="tl-b"></path>`, ...ms];
      } else if (pts.length) {
        const vals = pts
          .map((p) => p.values[ln.id])
          .map((v) => (v && v.quality === 'GOOD' && v.value !== null ? Number(v.value) : null));
        const finite = vals.filter((v): v is number => v !== null && Number.isFinite(v));
        let lo = finite.length ? Math.min(...finite) : 0;
        let hi = finite.length ? Math.max(...finite) : 1;
        if (hi - lo < 1e-6) hi = lo + 1;
        if (lo > 0 && lo < hi * 0.5) lo = 0;
        const Y = (v: number) => yb - ((v - lo) / (hi - lo)) * (yb - yt);
        let d = '';
        let gap = true;
        const bad: SVGTemplateResult[] = [];
        pts.forEach((p, k) => {
          const v = vals[k];
          if (v === null || v === undefined) {
            gap = true;
            bad.push(
              svg`<rect x=${X(p.t)} y=${yt} width=${step} height=${yb - yt} class="tl-bad"></rect>`,
            );
            return;
          }
          d += `${gap ? 'M' : 'L'}${X(p.t).toFixed(1)} ${Y(v).toFixed(1)}`;
          gap = false;
        });
        const last = finite.at(-1);
        body = [
          ...bad,
          svg`<path d=${d || 'M0 0'} class="tl-a"></path>`,
          svg`<text x=${L + pw + 4} y=${y0 + 15} class="tl-val">${last === undefined ? '' : num(last)}</text>`,
        ];
      }
      return svg`<g data-lane=${ln.id}>${head}${body}</g>`;
    });
    return html`<svg
      class="tlsvg"
      viewBox="0 0 ${W} ${H}"
      width=${W}
      height=${H}
      role="img"
      aria-label=${t('logic.test.timeline', { n: lanes.length })}
    >
      <defs>
        <pattern
          id="lg-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" class="tl-hatch-bg"></rect>
          <path d="M0 0v6" class="tl-hatch-ln"></path>
        </pattern>
      </defs>
      <rect x="0" y="0" width=${W} height=${H} class="tl-bg"></rect>
      ${grid} ${rows}
      <line x1=${X(sim.t)} y1="0" x2=${X(sim.t)} y2=${H - 22} class="tl-now"></line>
    </svg>`;
  }

  // ---------- Nhật ký, trạng thái khối ----------

  private logView(sim: LogicSim) {
    if (!sim.log.length) return html`<p class="help pad">${t('logic.test.noLog')}</p>`;
    return sim.log.slice(0, 200).map((a) => {
      const bad = a.result !== 'OK' && a.result !== 'QUEUED';
      const v =
        a.value === undefined
          ? ''
          : ` = ${typeof a.value === 'bigint' ? a.value.toString() : String(a.value)}`;
      return html`<div class="li ${bad ? 'bad' : ''}">
        <span class="t mono">${num(a.t / 1000)} s</span>
        <span>
          ${icon(bad ? 'x' : (ACTION_ICON[a.do] ?? 'info'), `sm ${bad ? 'errc' : 'okc'}`)}
          <span class="mono">${a.rule}</span> · ${actionLabel(a.do)}<br /><span class="mono sm-text"
            >${a.write ? `${a.write} → ` : ''}${a.tag}${v}${a.ms !== undefined ? `, ${a.ms} ms` : ''}</span
          >
        </span>
        <span class="r ${bad ? 'errc' : 'muted'}"
          >${t(`logic.test.res.${a.result}` as MessageKey)}</span
        >
      </div>`;
    });
  }

  private blockStates(sim: LogicSim) {
    const doc = logicDoc(this.app);
    const rows: TemplateResult[] = [];
    for (const r of doc?.rules ?? []) {
      if (!sim.hasBlock(r.id)) continue;
      const s = sim.state(r.id);
      rows.push(
        html`<tr data-block=${r.id}>
          <td>${icon('rule', 'sm')} <span class="mono">${r.id}</span></td>
          <td>${stateChip(s.state, s.reason)}</td>
        </tr>`,
      );
    }
    for (const id of sim.outputTags)
      rows.push(
        html`<tr data-out=${id}>
          <td>${icon('logic', 'sm')} <span class="mono">${id}</span></td>
          <td class="mono">${fmtVal(sim.value(id))}</td>
        </tr>`,
      );
    return rows;
  }

  protected override render() {
    const sim = this.sim;
    if (!sim) return html`<p class="help pad">${t('logic.test.noLogic')}</p>`;
    if (sim.error)
      return html`<div class="banner err pad" role="alert">
        ${icon('err', 'err')}
        <div>${t('logic.test.cannot')} <span class="mono">${sim.error}</span></div>
      </div>`;
    const running = this.running;
    return html`<div class="lg-test" @keydown=${(e: KeyboardEvent) => this.onKey(e)}>
      <div class="ttools" role="toolbar" aria-label=${t('logic.test.toolbar')}>
        <button
          type="button"
          class="btn primary sm"
          data-act="play"
          title=${t('logic.test.playTip')}
          @click=${() => this.play()}
        >
          ${icon(running ? 'pause' : 'play')}<span
            >${t(running ? 'logic.test.pause' : 'logic.test.play')}</span
          >
        </button>
        <button
          type="button"
          class="ibtn"
          data-act="step"
          aria-label=${t('logic.test.step')}
          title=${t('logic.test.stepTip', { ms: sim.scanMs })}
          @click=${() => {
            sim.step();
            this.requestUpdate();
          }}
        >
          ${icon('step')}
        </button>
        <button
          type="button"
          class="ibtn"
          data-act="reset"
          aria-label=${t('logic.test.reset')}
          title=${t('logic.test.reset')}
          @click=${() => {
            this.stop();
            sim.reset();
            this.requestUpdate();
          }}
        >
          ${icon('refresh')}
        </button>
        <span class="tsep"></span>
        <span class="muted sm-text">${t('logic.test.speed')}</span>
        <span class="seg" role="group" aria-label=${t('logic.test.speed')}>
          ${LOGIC_SIM_SPEEDS.map(
            (sp) =>
              html`<button
                type="button"
                data-speed=${sp}
                aria-pressed=${sim.speed === sp ? 'true' : 'false'}
                @click=${() => {
                  sim.speed = sp;
                  this.requestUpdate();
                }}
              >
                ×${sp}
              </button>`,
          )}
        </span>
        <span class="clock mono" title=${t('logic.test.clockTip')}
          >${icon('timer', 'sm')}t = ${num(sim.t / 1000)} s ·
          ${isoWithOffset(sim.wallMs(), sim.config.tzOffsetMin).slice(11, 19)}</span
        >
        <span class="chip ${running ? 'ok' : ''}" data-role="state"
          >${running ? t('logic.test.running', { n: sim.speed }) : t('logic.test.stopped')}</span
        >
        <span class="grow"></span>
        <span class="muted sm-text" data-role="window"
          >${t(WINDOW_KEY[sim.speed])} · ${t('logic.test.scan', { ms: sim.scanMs })}</span
        >
        <button
          type="button"
          class="btn sm"
          data-act="save-vector"
          title=${t('logic.test.saveTip')}
          @click=${() => this.saveScenario(sim)}
        >
          ${icon('export')}${t('logic.test.save')}
        </button>
      </div>
      <div class="tgrid">
        <section class="tin" aria-label=${t('logic.test.inputs')}>
          <div class="pane-h">
            <span>${t('logic.test.inputs')}</span
            ><span class="lc">${t('logic.test.inputsSub')}</span>
          </div>
          ${sim.inputs.map((id) => this.inputRow(sim, id))} ${this.clockRow(sim)}
          <p class="help pad">${t('logic.test.inputsHelp')}</p>
        </section>
        <section class="tlwrap" tabindex="0" aria-label=${t('logic.test.timelineLabel')}>
          ${this.timeline(sim)}
        </section>
        <section class="tout" aria-label=${t('logic.test.actions')}>
          <div class="pane-h">
            <span>${t('logic.test.actions')}</span><span class="lc">${sim.log.length}</span>
          </div>
          <div
            class="alog"
            data-role="log"
            role="log"
            aria-live="polite"
            tabindex="0"
            aria-label=${t('logic.test.actions')}
          >
            ${this.logView(sim)}
          </div>
          <div class="bst" tabindex="0" role="group" aria-label=${t('logic.test.states')}>
            <div class="pane-h"><span>${t('logic.test.states')}</span></div>
            <table data-role="bst" aria-label=${t('logic.test.states')}>
              <tbody>
                ${this.blockStates(sim)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div class="tfoot sm-text muted">
        ${t('logic.test.scans')} <b data-role="scans">${sim.scans}</b> ·
        ${t('logic.test.writes', { w: sim.stats.writes, r: sim.stats.rejected, s: sim.stats.suppressed })}
        · ${t('logic.test.noDevice')}
      </div>
    </div>`;
  }
}

customElements.define('mat-logic-test', LogicTestPanel);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-test': LogicTestPanel;
  }
}
