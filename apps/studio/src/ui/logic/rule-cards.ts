// Khung nhìn "Luật" của editor Logic (feature 043, "Logic dễ hiểu"): mỗi luật là một THẺ có màu và icon theo loại kích hoạt
// (Khi giá trị — tia sét xanh dương, Theo giờ — đồng hồ tím, Lặp lại — mũi tên vòng xanh ngọc, Trễ/Timer — đồng hồ cát cam,
// Đếm — xanh lá, Nâng cao — xám) và đọc như câu: "KHI Nhiệt độ lò > 80 liên tục 5 giây → THÌ Bật Quạt". Mọi ô trong câu là
// chip bấm được (Tag: ô tìm hoặc kéo Tag từ task card thả vào). Bật/tắt, nhân bản, xóa, kéo đổi thứ tự, nhóm, tìm, lọc theo
// loại; lỗi hiện ngay trong thẻ bằng câu tiếng Việt; "Thử" chạy luật bằng bộ Thử logic (không ghi ra thiết bị). Luật không
// đọc được thành câu hiện "Luật nâng cao" và mở bằng trình soạn đầy đủ (Sơ đồ / Bảng). Dữ liệu chỉ qua binding của Lit.
import { html, nothing, svg, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { Issue, LogicDoc, TagV1 } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { fold, t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { tryRule, type TryInput, type TryResult } from '../../model/logic-card-try.ts';
import {
  CMP_OPS,
  TEMPLATES,
  addFromTemplate,
  cardBlockIds,
  cardCategory,
  duplicateRule,
  formatCondition,
  logicTagLabel,
  plusMinute,
  readCards,
  removeRule,
  reorderRule,
  validHm,
  writeCounterCard,
  writeRuleCard,
  writeTimerCard,
  type Card,
  type CardAction,
  type CardCategory,
  type Clause,
  type CounterCard,
  type RuleCard,
  type Scalar,
  type TemplateId,
  type TimeTrigger,
  type TimerCard,
  type Trigger,
  type ValueTrigger,
  type Verb,
} from '../../model/logic-cards.ts';
import { KIND_LIMIT, issueTarget, type LogicKind } from '../../model/logic-doc.ts';
import { setGroup } from '../../model/logic-layout.ts';
import './rule-cards.css';
import { AppElement, icon } from '../base.ts';
import { kindLabel } from './logic-parts.ts';
import {
  editLayout,
  editLogic,
  logicDoc,
  logicIssues,
  logicLayout,
  projectTags,
  select,
  setKind,
  setView,
} from './logic-state.ts';

type Cat = CardCategory;
const CAT_ICON: Readonly<Record<Cat, IconName>> = {
  value: 'bolt',
  time: 'clock',
  every: 'repeat',
  timer: 'hourglass',
  counter: 'counter',
  advanced: 'fx',
  other: 'logic',
};
const FILTERS: ReadonlyArray<Cat | 'all'> = [
  'all',
  'value',
  'time',
  'every',
  'timer',
  'counter',
  'advanced',
];
const DAY_SETS: Readonly<Record<'all' | 'work' | 'weekend', number[]>> = {
  all: [1, 2, 3, 4, 5, 6, 7],
  work: [1, 2, 3, 4, 5],
  weekend: [6, 7],
};
const TAG_SHOW = 60;

interface CardsUi {
  cat: Cat | 'all';
  search: string;
  /** Ô Tag đang mở bộ chọn (khóa ô). */
  picker: string | null;
  pickerQ: string;
  tpl: boolean;
  tryOpen: Set<string>;
  tryIn: Map<string, TryInput>;
  tryRes: Map<string, TryResult>;
  /** Điều kiện nháp (ô Tag còn trống) theo id khối. */
  drafts: Map<string, ValueTrigger>;
  drag: string | null;
  dropAt: string | null;
  collapsed: Set<string>;
  groupEdit: string | null;
  flash: string | null;
}
const states = new WeakMap<StudioApp, CardsUi>();
export function cardsUi(app: StudioApp): CardsUi {
  let s = states.get(app);
  if (!s) {
    s = {
      cat: 'all',
      search: '',
      picker: null,
      pickerQ: '',
      tpl: false,
      tryOpen: new Set(),
      tryIn: new Map(),
      tryRes: new Map(),
      drafts: new Map(),
      drag: null,
      dropAt: null,
      collapsed: new Set(),
      groupEdit: null,
      flash: null,
    };
    states.set(app, s);
  }
  return s;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const catLabel = (c: Cat | 'all') => t(`lgc.cat.${c}` as MessageKey);

function parseValue(raw: string, type: string | undefined): Scalar {
  const s = raw.trim();
  if (type === 'BOOL') return /^(true|1|bật|bat|on|đúng)$/i.test(s);
  if (type === 'STRING') return raw;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : type ? 0 : s;
}
const showValue = (v: Scalar | undefined) =>
  v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
const secs = (ms: number) => Math.round((ms / 1000) * 10) / 10;

export class LogicCards extends AppElement {
  private tagIndex = new Map<string, TagV1>();
  /** Hàm đặt Tag theo khóa ô (dựng lại mỗi lần vẽ). */
  private setters = new Map<string, (tag: string) => void>();

  private readonly onDoc = (e: Event): void => {
    const ui = cardsUi(this.app);
    const el = e.target as HTMLElement;
    if (ui.picker && !el.closest?.('.lgc-pick, .lgc-tag')) {
      ui.picker = null;
      this.app.requestRender();
    }
  };

  protected override attached(): void {
    document.addEventListener('pointerdown', this.onDoc, true);
  }

  protected override detached(): void {
    document.removeEventListener('pointerdown', this.onDoc, true);
  }

  private get ro(): boolean {
    return this.app.store.state.readOnly;
  }

  private tags(): TagV1[] {
    return projectTags(this.app);
  }

  // ---------- ghi ----------

  private saveRule(card: RuleCard): void {
    const doc = logicDoc(this.app);
    if (!doc || this.ro) return;
    const ui = cardsUi(this.app);
    if (card.trigger.type === 'value') {
      if (
        formatCondition(card.trigger.join, card.trigger.clauses) === '' &&
        card.trigger.clauses.length
      )
        ui.drafts.set(card.id, clone(card.trigger));
      else ui.drafts.delete(card.id);
    } else ui.drafts.delete(card.id);
    ui.tryRes.delete(card.id);
    editLogic(this.app, writeRuleCard(doc, card, this.tags()));
  }

  private saveTimer(card: TimerCard): void {
    const doc = logicDoc(this.app);
    if (!doc || this.ro) return;
    this.keepDraft(card.id, card.input);
    editLogic(this.app, writeTimerCard(doc, card));
  }

  private saveCounter(card: CounterCard): void {
    const doc = logicDoc(this.app);
    if (!doc || this.ro) return;
    this.keepDraft(card.id, card.up);
    editLogic(this.app, writeCounterCard(doc, card));
  }

  private keepDraft(id: string, tr: Trigger): void {
    const ui = cardsUi(this.app);
    if (tr.type === 'value' && formatCondition(tr.join, tr.clauses) === '' && tr.clauses.length)
      ui.drafts.set(id, clone(tr));
    else ui.drafts.delete(id);
  }

  /** Thẻ đọc từ logic.json, phủ điều kiện nháp khi ô Tag còn trống. */
  private cards(doc: LogicDoc): Card[] {
    const ui = cardsUi(this.app);
    return readCards(doc).map((c) => {
      const d = ui.drafts.get(c.id);
      if (!d) return c;
      if (c.kind === 'rule' && c.trigger.type === 'value' && c.srcWhen.trim() === '')
        return { ...c, trigger: { ...clone(d), holdMs: c.trigger.holdMs } };
      if (c.kind === 'timer' && c.srcIn.trim() === '') return { ...c, input: clone(d) };
      if (c.kind === 'counter' && c.srcUp.trim() === '') return { ...c, up: clone(d) };
      return c;
    });
  }

  private openAdvanced(kind: LogicKind, id: string): void {
    setView(this.app, 'table');
    setKind(this.app, kind);
    select(this.app, kind, id);
  }

  private addTemplate(tpl: TemplateId): void {
    const app = this.app;
    const doc = logicDoc(app);
    const ui = cardsUi(app);
    if (!doc || this.ro) return;
    const name = t(`lgc.tpl.${tpl}` as MessageKey).replace(/…$/, '');
    const r = addFromTemplate(doc, tpl, name, this.tags());
    for (const [id, d] of Object.entries(r.drafts)) ui.drafts.set(id, d);
    ui.tpl = false;
    ui.cat = 'all';
    ui.search = '';
    ui.flash = r.id;
    editLogic(app, r.doc);
    app.toast(t('lgc.added', { name }));
    void this.updateComplete.then(() =>
      this.querySelector(`[data-card="${r.id}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
  }

  // ---------- mảnh câu ----------

  private tagChip(
    key: string,
    tag: string,
    set: (tag: string) => void,
    opts: { out?: boolean } = {},
  ) {
    const ui = cardsUi(this.app);
    this.setters.set(key, set);
    const doc = logicDoc(this.app);
    const info = this.tagIndex.get(tag);
    const label = tag ? (logicTagLabel(doc, tag) ?? info?.description ?? tag) : t('lgc.pickTag');
    const open = ui.picker === key;
    const missing = tag !== '' && !info && !tag.startsWith('LOGIC.');
    return html`<span class="lgc-tagwrap"
      ><button
        type="button"
        class="lgc-chip lgc-tag ${tag ? '' : 'empty'} ${missing ? 'bad' : ''} ${opts.out ? 'out' : ''}"
        data-key=${key}
        data-tag=${tag}
        title=${tag ? `${tag}${info ? ` · ${info.type}` : ''}\n${t('lgc.pickTagTip')}` : t('lgc.pickTagTip')}
        ?disabled=${this.ro}
        aria-haspopup="listbox"
        aria-expanded=${open ? 'true' : 'false'}
        @click=${() => {
          ui.picker = open ? null : key;
          ui.pickerQ = '';
          this.app.requestRender();
          if (!open)
            void this.updateComplete.then(() =>
              this.querySelector<HTMLInputElement>('.lgc-pick input')?.focus(),
            );
        }}
        @dragover=${(e: DragEvent) => {
          if (!this.ro && e.dataTransfer?.types.includes('text/plain')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            (e.currentTarget as HTMLElement).classList.add('drop');
          }
        }}
        @dragleave=${(e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop')}
        @drop=${(e: DragEvent) => {
          const v = e.dataTransfer?.getData('text/plain')?.trim();
          (e.currentTarget as HTMLElement).classList.remove('drop');
          if (!v || this.ro) return;
          e.preventDefault();
          e.stopPropagation();
          set(v);
        }}
      >
        ${icon('tag', 'sm')}<span class="nm">${label}</span>${
          tag && label !== tag ? html`<span class="id">${tag}</span>` : nothing
        }</button
      >${open ? this.picker(key) : nothing}</span
    >`;
  }

  private picker(key: string) {
    const ui = cardsUi(this.app);
    const q = fold(ui.pickerQ).trim();
    const list = this.tags().filter(
      (tg) => !q || fold(`${tg.id} ${tg.description ?? ''}`).includes(q),
    );
    const shown = list.slice(0, TAG_SHOW);
    const pick = (id: string) => {
      ui.picker = null;
      this.setters.get(key)?.(id);
    };
    return html`<div class="lgc-pick" role="dialog" aria-label=${t('lgc.tagFilter')}>
      <input
        class="input sm"
        type="search"
        placeholder=${t('lgc.tagFilter')}
        aria-label=${t('lgc.tagFilter')}
        .value=${live(ui.pickerQ)}
        @input=${(e: Event) => {
          ui.pickerQ = (e.target as HTMLInputElement).value;
          this.app.requestRender();
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            ui.picker = null;
            this.app.requestRender();
          } else if (e.key === 'Enter' && shown[0]) {
            e.preventDefault();
            pick(shown[0].id);
          }
        }}
      />
      <div class="lgc-picklist" role="listbox">
        ${
          shown.length === 0
            ? html`<div class="help pad">${t('lgc.noTag')}</div>`
            : shown.map(
                (tg) =>
                  html`<button
                    type="button"
                    role="option"
                    data-pick=${tg.id}
                    @click=${() => pick(tg.id)}
                  >
                    <span class="mono">${tg.id}</span><span class="d">${tg.description ?? ''}</span
                    ><span class="ty"
                      >${tg.type}${tg.kind === 'internal' ? ' · nội bộ' : tg.access === 'RW' ? ' · RW' : ''}</span
                    >
                  </button>`,
              )
        }
      </div>
    </div>`;
  }

  private kw(text: string, cls = '') {
    return html`<span class="lgc-kw ${cls}">${text}</span>`;
  }

  private numChip(
    value: number,
    set: (n: number) => void,
    opts: { min?: number; step?: number; w?: number; label: string },
  ) {
    return html`<input
      class="lgc-chip lgc-num"
      type="number"
      aria-label=${opts.label}
      .value=${live(String(value))}
      min=${opts.min ?? 0}
      step=${opts.step ?? 1}
      style="width:${opts.w ?? 64}px"
      ?disabled=${this.ro}
      @change=${(e: Event) => {
        const n = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(n)) set(n);
      }}
    />`;
  }

  private valueChip(
    value: Scalar | undefined,
    type: string | undefined,
    set: (v: Scalar) => void,
    label: string,
  ) {
    if (type === 'BOOL')
      return html`<select
        class="lgc-chip lgc-val"
        aria-label=${label}
        ?disabled=${this.ro}
        .value=${live(value === false ? 'false' : 'true')}
        @change=${(e: Event) => set((e.target as HTMLSelectElement).value === 'true')}
      >
        <option value="true">true (bật)</option>
        <option value="false">false (tắt)</option>
      </select>`;
    return html`<input
      class="lgc-chip lgc-val"
      aria-label=${label}
      .value=${live(showValue(value))}
      ?disabled=${this.ro}
      style="width:${Math.max(56, Math.min(160, showValue(value).length * 9 + 26))}px"
      @change=${(e: Event) => set(parseValue((e.target as HTMLInputElement).value, type))}
    />`;
  }

  /** Điều kiện dạng câu (luật, timer, counter). */
  private conditionLine(
    key: string,
    tr: ValueTrigger,
    set: (tr: ValueTrigger) => void,
    opts: { hold?: boolean; allowOr?: boolean } = {},
  ) {
    const upd = (fn: (d: ValueTrigger) => void) => {
      const d = clone(tr);
      fn(d);
      set(d);
    };
    const clauses = tr.clauses.length ? tr.clauses : [{ tag: '', test: 'on' } as Clause];
    return html`${clauses.map((c, i) => {
      const info = this.tagIndex.get(c.tag);
      const testVal = c.test === 'cmp' ? `cmp:${c.op}` : c.test;
      const setClause = (fn: (c: Clause) => Clause) =>
        upd((d) => {
          if (!d.clauses.length) d.clauses = [{ tag: '', test: 'on' }];
          d.clauses[i] = fn(d.clauses[i]!);
        });
      return html`${
          i > 0
            ? html`<select
                class="lgc-chip lgc-join"
                aria-label=${t('lgc.and')}
                ?disabled=${this.ro || opts.allowOr === false}
                .value=${live(tr.join)}
                @change=${(e: Event) => upd((d) => (d.join = (e.target as HTMLSelectElement).value as 'and' | 'or'))}
              >
                <option value="and">${t('lgc.and')}</option>
                <option value="or">${t('lgc.or')}</option>
              </select>`
            : nothing
        }${this.tagChip(`${key}:c${i}`, c.tag, (tag) =>
          setClause((x) => {
            const nt = this.tagIndex.get(tag);
            // Tag BOOL mới chọn cho mệnh đề so sánh "= 1" mặc định: đổi thành "bật lên" cho tự nhiên
            if (
              x.test === 'cmp' &&
              nt?.type === 'BOOL' &&
              x.rhs.kind === 'const' &&
              typeof x.rhs.v === 'number'
            )
              return { tag, test: x.op === '!=' ? 'off' : 'on' };
            return { ...x, tag };
          }),
        )}<select
          class="lgc-chip lgc-op"
          aria-label="phép so sánh"
          ?disabled=${this.ro}
          .value=${live(testVal)}
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            setClause((x) => {
              if (v === 'on' || v === 'off') return { tag: x.tag, test: v };
              const op = v.slice(4) as (typeof CMP_OPS)[number];
              const rhs =
                x.test === 'cmp'
                  ? x.rhs
                  : { kind: 'const' as const, v: info?.type === 'BOOL' ? true : 0 };
              return { tag: x.tag, test: 'cmp', op, rhs };
            });
          }}
        >
          ${CMP_OPS.map((op) => html`<option value=${`cmp:${op}`}>${t(`lgc.op.${op}` as MessageKey)}</option>`)}
          <option value="on">${t('lgc.test.on')}</option>
          <option value="off">${t('lgc.test.off')}</option></select
        >${
          c.test === 'cmp'
            ? html`${
                  c.rhs.kind === 'tag'
                    ? this.tagChip(`${key}:r${i}`, c.rhs.tag, (tag) =>
                        setClause((x) =>
                          x.test === 'cmp' ? { ...x, rhs: { kind: 'tag', tag } } : x,
                        ),
                      )
                    : this.valueChip(
                        c.rhs.v,
                        info?.type,
                        (v) =>
                          setClause((x) =>
                            x.test === 'cmp' ? { ...x, rhs: { kind: 'const', v } } : x,
                          ),
                        'giá trị so sánh',
                      )
                }<button
                  type="button"
                  class="lgc-mini"
                  title=${c.rhs.kind === 'tag' ? t('lgc.valueConst') : t('lgc.valueTag')}
                  aria-label=${c.rhs.kind === 'tag' ? t('lgc.valueConst') : t('lgc.valueTag')}
                  ?disabled=${this.ro}
                  @click=${() =>
                    setClause((x) =>
                      x.test === 'cmp'
                        ? {
                            ...x,
                            rhs:
                              x.rhs.kind === 'tag'
                                ? { kind: 'const', v: 0 }
                                : { kind: 'tag', tag: '' },
                          }
                        : x,
                    )}
                >
                  ${c.rhs.kind === 'tag' ? '123' : icon('tag', 'sm')}
                </button>`
            : nothing
        }${
          clauses.length > 1
            ? html`<button
                type="button"
                class="lgc-mini x"
                title=${t('lgc.removeCond')}
                aria-label=${t('lgc.removeCond')}
                ?disabled=${this.ro}
                @click=${() => upd((d) => d.clauses.splice(i, 1))}
              >
                ${icon('x', 'sm')}
              </button>`
            : nothing
        }`;
    })}${
      this.ro
        ? nothing
        : html`<button
            type="button"
            class="lgc-add"
            data-act="add-cond"
            title=${t('lgc.addCond')}
            @click=${() =>
              upd((d) => {
                if (!d.clauses.length) d.clauses = [{ tag: '', test: 'on' }];
                d.clauses.push({ tag: '', test: 'on' });
              })}
          >
            ${icon('plus', 'sm')}${tr.join === 'or' ? t('lgc.or') : t('lgc.and')}
          </button>`
    }${
      opts.hold
        ? html`<span class="lgc-hold" title=${t('lgc.holdTip')}
            >${this.kw(t('lgc.hold'), 'soft')}${this.numChip(
              secs(tr.holdMs),
              (n) => upd((d) => (d.holdMs = Math.max(0, Math.round(n * 1000)))),
              { step: 0.5, w: 58, label: t('lgc.holdTip') },
            )}${this.kw(t('lgc.sec'), 'soft')}</span
          >`
        : nothing
    }`;
  }

  private timeLine(card: RuleCard, set: (c: RuleCard) => void) {
    const tr = card.trigger;
    if (tr.type !== 'time') return nothing;
    const upd = (fn: (d: TimeTrigger) => void) => {
      const d = clone(tr) as TimeTrigger;
      fn(d);
      if (d.at) d.to = plusMinute(d.from);
      set({ ...card, trigger: d });
    };
    const sorted = [...tr.days].sort().join(',');
    const preset = (Object.keys(DAY_SETS) as Array<keyof typeof DAY_SETS>).find(
      (k) => DAY_SETS[k].join(',') === sorted,
    );
    const pick = preset ?? 'pick';
    return html`${this.kw(tr.at ? t('lgc.at') : t('lgc.from'), 'when')}<select
        class="lgc-chip"
        aria-label="kiểu giờ"
        ?disabled=${this.ro}
        .value=${live(tr.at ? 'at' : 'window')}
        @change=${(e: Event) =>
          upd((d) => {
            d.at = (e.target as HTMLSelectElement).value === 'at';
            if (!d.at && d.to === plusMinute(d.from)) d.to = '17:00';
          })}
      >
        <option value="at">${t('lgc.mode.at')}</option>
        <option value="window">${t('lgc.mode.window')}</option></select
      ><input
        class="lgc-chip lgc-time ${validHm(tr.from) ? '' : 'bad'}"
        type="time"
        aria-label="giờ bắt đầu"
        .value=${live(tr.from)}
        ?disabled=${this.ro}
        @change=${(e: Event) => upd((d) => (d.from = (e.target as HTMLInputElement).value.slice(0, 5)))}
      />${
        tr.at
          ? nothing
          : html`${this.kw(t('lgc.to'), 'when')}<input
                class="lgc-chip lgc-time ${validHm(tr.to) ? '' : 'bad'}"
                type="time"
                aria-label="giờ kết thúc"
                .value=${live(tr.to)}
                ?disabled=${this.ro}
                @change=${(e: Event) => upd((d) => (d.to = (e.target as HTMLInputElement).value.slice(0, 5)))}
              />`
      }<select
        class="lgc-chip"
        aria-label="ngày trong tuần"
        ?disabled=${this.ro}
        .value=${live(pick)}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value as keyof typeof DAY_SETS | 'pick';
          upd((d) => (d.days = v === 'pick' ? [...d.days] : [...DAY_SETS[v]]));
        }}
      >
        <option value="all">${t('lgc.days.all')}</option>
        <option value="work">${t('lgc.days.work')}</option>
        <option value="weekend">${t('lgc.days.weekend')}</option>
        <option value="pick">${t('lgc.days.pick')}</option></select
      >${
        pick === 'pick'
          ? html`<span class="lgc-days" role="group" aria-label=${t('lgc.days.pick')}
              >${[1, 2, 3, 4, 5, 6, 7].map(
                (d) =>
                  html`<button
                    type="button"
                    aria-pressed=${tr.days.includes(d) ? 'true' : 'false'}
                    ?disabled=${this.ro}
                    @click=${() =>
                      upd((x) => {
                        x.days = x.days.includes(d)
                          ? x.days.filter((y) => y !== d)
                          : [...x.days, d];
                      })}
                  >
                    ${t(`lgc.day.${d}` as MessageKey)}
                  </button>`,
              )}</span
            >`
          : nothing
      }`;
  }

  private everyLine(card: RuleCard, set: (c: RuleCard) => void) {
    const tr = card.trigger;
    if (tr.type !== 'every') return nothing;
    const unit =
      tr.everyMs % 3_600_000 === 0 ? 3_600_000 : tr.everyMs % 60_000 === 0 ? 60_000 : 1000;
    return html`${this.kw(t('lgc.every'), 'when')}${this.numChip(
        tr.everyMs / unit,
        (n) =>
          set({ ...card, trigger: { type: 'every', everyMs: Math.max(1, Math.round(n * unit)) } }),
        { min: 1, w: 64, label: t('lgc.every') },
      )}<select
        class="lgc-chip"
        aria-label="đơn vị"
        ?disabled=${this.ro}
        .value=${live(String(unit))}
        @change=${(e: Event) => {
          const u = Number((e.target as HTMLSelectElement).value);
          set({
            ...card,
            trigger: { type: 'every', everyMs: Math.max(1, Math.round((tr.everyMs / unit) * u)) },
          });
        }}
      >
        <option value="1000">${t('lgc.sec')}</option>
        <option value="60000">${t('lgc.min')}</option>
        <option value="3600000">${t('lgc.hour')}</option></select
      >${this.kw(t('lgc.start'), 'soft')}`;
  }

  private actionRow(key: string, a: CardAction, set: (a: CardAction | null) => void) {
    const info = this.tagIndex.get(a.tag);
    const upd = (p: Partial<CardAction>) => set({ ...a, ...p });
    const verbSel = html`<select
      class="lgc-chip lgc-verb v-${a.verb}"
      aria-label="việc cần làm"
      ?disabled=${this.ro}
      .value=${live(a.verb)}
      @change=${(e: Event) => {
        const verb = (e.target as HTMLSelectElement).value as Verb;
        const p: Partial<CardAction> = { verb };
        if (verb === 'set' && a.value === undefined) p.value = info?.type === 'BOOL' ? true : 0;
        if (verb === 'add') p.value = typeof a.value === 'number' ? a.value : 1;
        if (verb === 'pulse') {
          p.value = info?.type === 'BOOL' || a.value === undefined ? true : a.value;
          p.ms = a.ms ?? 1000;
        }
        if (verb === 'expr') p.expr = a.expr ?? a.tag;
        set({ ...a, ...p });
      }}
    >
      ${(['on', 'off', 'set', 'toggle', 'pulse', 'add', 'expr'] as Verb[]).map(
        (v) => html`<option value=${v}>${t(`lgc.verb.${v}` as MessageKey)}</option>`,
      )}
    </select>`;
    const tagChip = this.tagChip(key, a.tag, (tag) => upd({ tag }), { out: true });
    const body =
      a.verb === 'add'
        ? html`${verbSel}${this.numChip(
            typeof a.value === 'number' ? a.value : 1,
            (n) => upd({ value: n }),
            {
              step: 1,
              w: 64,
              label: t('lgc.verb.add'),
            },
          )}${this.kw(t('lgc.into'), 'soft')}${tagChip}`
        : a.verb === 'set'
          ? html`${verbSel}${tagChip}${this.kw(t('lgc.eq'), 'soft')}${this.valueChip(
              a.value,
              info?.type,
              (value) => upd({ value }),
              'giá trị ghi',
            )}`
          : a.verb === 'pulse'
            ? html`${verbSel}${tagChip}${this.kw(t('lgc.eq'), 'soft')}${this.valueChip(
                a.value,
                info?.type,
                (value) => upd({ value }),
                'giá trị xung',
              )}${this.kw(t('lgc.for'), 'soft')}${this.numChip(
                secs(a.ms ?? 1000),
                (n) => upd({ ms: Math.round(n * 1000) }),
                { step: 0.1, w: 58, label: 'thời gian xung' },
              )}${this.kw(t('lgc.sec'), 'soft')}`
            : a.verb === 'expr'
              ? html`${verbSel}${tagChip}${this.kw(t('lgc.eq'), 'soft')}<input
                    class="lgc-chip lgc-expr mono"
                    aria-label="biểu thức"
                    .value=${live(a.expr ?? '')}
                    ?disabled=${this.ro}
                    @change=${(e: Event) => upd({ expr: (e.target as HTMLInputElement).value })}
                  />`
              : html`${verbSel}${tagChip}`;
    return html`<span class="lgc-act" data-verb=${a.verb}
      >${body}${
        info?.kind === 'external' && a.verb !== 'toggle'
          ? html`<span class="lgc-plc" title=${t('lgc.viaPlcTip', { id: a.write ?? '…' })}
              >${icon('plc', 'sm')}${t('lgc.viaPlc')}</span
            >`
          : nothing
      }<button
        type="button"
        class="lgc-mini x"
        title=${t('lgc.removeAction')}
        aria-label=${t('lgc.removeAction')}
        ?disabled=${this.ro}
        @click=${() => set(null)}
      >
        ${icon('x', 'sm')}
      </button></span
    >`;
  }

  private actionsLine(card: RuleCard, edge: 'rise' | 'fall', set: (c: RuleCard) => void) {
    const list = card[edge] ?? [];
    const upd = (i: number, a: CardAction | null) => {
      const next = [...list];
      if (a === null) next.splice(i, 1);
      else next[i] = a;
      set({ ...card, [edge]: next });
    };
    return html`${list.map((a, i) => this.actionRow(`${card.id}:${edge}${i}`, a, (x) => upd(i, x)))}${
      this.ro
        ? nothing
        : html`<button
            type="button"
            class="lgc-add"
            data-act=${edge === 'rise' ? 'add-action' : 'add-else'}
            @click=${() => set({ ...card, [edge]: [...list, { verb: 'on', tag: '' }] })}
          >
            ${icon('plus', 'sm')}${list.length ? t('lgc.addAction') : edge === 'rise' ? t('lgc.addAction') : t('lgc.addElse')}
          </button>`
    }`;
  }

  // ---------- lỗi ----------

  private cardErrors(card: Card, issues: readonly Issue[], doc: LogicDoc): string[] {
    const out: string[] = [];
    const clauseEmpty = (tr: Trigger | null) =>
      tr?.type === 'value' &&
      (tr.clauses.length === 0 || formatCondition(tr.join, tr.clauses) === '');
    if (card.kind === 'rule') {
      const tr = card.trigger;
      if (clauseEmpty(tr)) out.push(t('lgc.err.noTag'));
      if (tr.type === 'time') {
        if (!validHm(tr.from)) out.push(t('lgc.err.time', { v: tr.from }));
        if (!tr.at && !validHm(tr.to)) out.push(t('lgc.err.time', { v: tr.to }));
        if (tr.days.length === 0) out.push(t('lgc.err.noDays'));
      }
      if (tr.type === 'every' && tr.everyMs < 10_000) out.push(t('lgc.err.every'));
      for (const a of [...(card.rise ?? []), ...(card.fall ?? [])]) {
        if (!a.tag) {
          if (!out.includes(t('lgc.err.noTarget'))) out.push(t('lgc.err.noTarget'));
          continue;
        }
        const info = this.tagIndex.get(a.tag);
        if (!info) continue;
        if (info.kind === 'external' && info.access !== 'RW')
          out.push(t('lgc.err.readonly', { tag: a.tag }));
        else if (a.verb === 'toggle' && info.kind !== 'internal')
          out.push(t('lgc.err.toggleDevice'));
        else if (a.verb === 'pulse' && info.kind !== 'external')
          out.push(t('lgc.err.pulseInternal'));
        else if (
          (a.verb === 'on' || a.verb === 'off' || a.verb === 'toggle') &&
          info.type !== 'BOOL'
        )
          out.push(t('lgc.err.typeBool', { tag: a.tag }));
        if (a.verb === 'pulse' && (a.ms ?? 0) < 100) out.push(t('lgc.err.pulseMs'));
      }
    } else if (card.kind === 'timer' && clauseEmpty(card.input)) out.push(t('lgc.err.noTag'));
    else if (card.kind === 'counter' && clauseEmpty(card.up)) out.push(t('lgc.err.noTag'));
    const ids = new Set(cardBlockIds(card));
    const own = out.length > 0;
    for (const i of issues) {
      if (i.code.startsWith('W_')) continue;
      const tg = issueTarget(doc, i.path);
      if (!tg?.id || !ids.has(tg.id)) continue;
      // lỗi máy của ô còn trống đã nói bằng câu ở trên
      if (own && (i.message.includes("''") || /\/(when|in|up)$/.test(i.path))) continue;
      const label = t(
        (`lgc.code.${i.code}` in LABELS ? `lgc.code.${i.code}` : 'lgc.code.other') as MessageKey,
      );
      const msg = `${label}: ${i.message}`;
      if (!out.includes(msg)) out.push(msg);
    }
    return out;
  }

  // ---------- thử ----------

  private tryPanel(card: RuleCard, doc: LogicDoc) {
    const ui = cardsUi(this.app);
    const tags = new Set<string>();
    if (card.trigger.type === 'value')
      for (const c of card.trigger.clauses) {
        if (c.tag) tags.add(c.tag);
        if (c.test === 'cmp' && c.rhs.kind === 'tag' && c.rhs.tag) tags.add(c.rhs.tag);
      }
    const input: TryInput = ui.tryIn.get(card.id) ?? {
      values: {},
      day: 1,
      time: card.trigger.type === 'time' ? card.trigger.from : '08:00',
    };
    for (const tg of tags)
      if (!(tg in input.values) && card.trigger.type === 'value') {
        const c = card.trigger.clauses.find((x) => x.tag === tg);
        const info = this.tagIndex.get(tg);
        input.values[tg] =
          c?.test === 'on'
            ? true
            : c?.test === 'off'
              ? false
              : c?.test === 'cmp' && c.rhs.kind === 'const'
                ? c.rhs.v
                : info?.type === 'BOOL'
                  ? false
                  : 0;
      }
    ui.tryIn.set(card.id, input);
    const res = ui.tryRes.get(card.id);
    const run = () => {
      ui.tryRes.set(card.id, tryRule(doc, card.id, this.tags(), input));
      this.app.requestRender();
    };
    return html`<div class="lgc-try" data-role="try">
      <div class="lgc-try-h">
        ${icon('play', 'sm')}<b>${t('lgc.try.title')}</b
        ><span class="muted">${t('lgc.try.note')}</span>
      </div>
      <div class="lgc-try-in">
        ${[...tags].map((tg) => {
          const info = this.tagIndex.get(tg);
          const v = input.values[tg];
          return html`<label class="lgc-try-v"
            ><span class="mono">${tg}</span>${
              info?.type === 'BOOL'
                ? html`<select
                    class="input sm"
                    data-try=${tg}
                    .value=${live(v ? 'true' : 'false')}
                    @change=${(e: Event) => {
                      input.values[tg] = (e.target as HTMLSelectElement).value === 'true';
                      ui.tryRes.delete(card.id);
                      this.app.requestRender();
                    }}
                  >
                    <option value="true">true (bật)</option>
                    <option value="false">false (tắt)</option>
                  </select>`
                : html`<input
                    class="input sm"
                    data-try=${tg}
                    .value=${live(showValue(v as Scalar))}
                    @change=${(e: Event) => {
                      input.values[tg] = parseValue(
                        (e.target as HTMLInputElement).value,
                        info?.type,
                      );
                      ui.tryRes.delete(card.id);
                      this.app.requestRender();
                    }}
                  />`
            }</label
          >`;
        })}
        ${
          card.trigger.type === 'time'
            ? html`<label class="lgc-try-v"
                ><span>${t('lgc.try.clock')}</span
                ><select
                  class="input sm"
                  data-try="day"
                  .value=${live(String(input.day))}
                  @change=${(e: Event) => {
                    input.day = Number((e.target as HTMLSelectElement).value);
                    ui.tryRes.delete(card.id);
                    this.app.requestRender();
                  }}
                >
                  ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`<option value=${d}>${t(`lgc.day.${d}` as MessageKey)}</option>`)}</select
                ><input
                  class="input sm"
                  type="time"
                  data-try="time"
                  .value=${live(input.time)}
                  @change=${(e: Event) => {
                    input.time = (e.target as HTMLInputElement).value.slice(0, 5);
                    ui.tryRes.delete(card.id);
                    this.app.requestRender();
                  }}
              /></label>`
            : nothing
        }
        <button type="button" class="btn primary sm" data-act="try-run" @click=${run}>
          ${icon('play', 'sm')}${t('lgc.try.run')}
        </button>
      </div>
      ${res ? this.tryResult(res) : nothing}
    </div>`;
  }

  private tryResult(res: TryResult) {
    if (res.error)
      return html`<div class="lgc-try-r bad" role="status">
        ${icon('err', 'sm')}${t('lgc.try.error', { msg: res.error })}
      </div>`;
    if (!res.fired)
      return html`<div class="lgc-try-r no" role="status" data-fired="false">
        ${icon('ban', 'sm')}${t('lgc.try.notFired')}
      </div>`;
    return html`<div class="lgc-try-r yes" role="status" data-fired="true">
      <div>
        ${icon('ok', 'sm')}<b>${t('lgc.try.fired', { s: secs(Math.max(0, res.ranMs - 100)) })}</b>
      </div>
      <ul>
        ${res.actions.map(
          (a) =>
            html`<li>
              → <span class="mono">${a.tag}</span> =
              <b class="mono">${a.value === undefined ? '?' : String(a.value)}</b>
              <span class="muted">(${t(`lgc.try.res.${a.result}` as MessageKey)})</span>
            </li>`,
        )}
      </ul>
    </div>`;
  }

  // ---------- thẻ ----------

  private header(card: Card, cat: Cat, extra: TemplateResult | typeof nothing) {
    const app = this.app;
    const ui = cardsUi(app);
    const isRule = card.kind === 'rule';
    const group = logicLayout(app).groups?.[card.id] ?? '';
    const name = isRule ? card.name : '';
    const kindName =
      card.kind === 'timer'
        ? kindLabel('timer')
        : card.kind === 'counter'
          ? kindLabel('counter')
          : card.kind === 'other'
            ? kindLabel(card.blockKind)
            : catLabel(cat);
    return html`<header class="lgc-h">
      ${
        isRule && !this.ro
          ? html`<span class="lgc-grip" title=${t('lgc.drag')} aria-hidden="true"
              >${icon('grip', 'sm')}</span
            >`
          : nothing
      }
      <span class="lgc-catchip">${icon(CAT_ICON[cat], 'sm')}${kindName}</span>
      ${
        isRule
          ? html`<input
              class="lgc-name"
              aria-label=${t('lgc.name')}
              placeholder=${t('lgc.unnamed', { id: card.id })}
              maxlength="80"
              .value=${live(name)}
              ?disabled=${this.ro}
              @change=${(e: Event) => this.saveRule({ ...card, name: (e.target as HTMLInputElement).value.trim() })}
            />`
          : html`<span class="lgc-name ro mono">${card.id}</span>`
      }
      ${isRule && card.name ? html`<span class="lgc-id mono">${card.id}</span>` : nothing}
      <span class="grow"></span>
      ${
        ui.groupEdit === card.id
          ? html`<input
              class="input sm lgc-groupin"
              list="lgc-groups"
              placeholder=${t('lgc.groupNew')}
              aria-label=${t('lgc.group')}
              .value=${group}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  ui.groupEdit = null;
                  app.requestRender();
                }
              }}
              @blur=${(e: Event) => {
                ui.groupEdit = null;
                const v = (e.target as HTMLInputElement).value;
                if (v.trim() !== group) editLayout(app, setGroup(logicLayout(app), card.id, v));
                else app.requestRender();
              }}
            />`
          : html`<button
              type="button"
              class="lgc-ibtn"
              data-act="group"
              title=${t('lgc.groupTip')}
              ?disabled=${this.ro}
              @click=${() => {
                ui.groupEdit = card.id;
                app.requestRender();
                void this.updateComplete.then(() =>
                  this.querySelector<HTMLInputElement>('.lgc-groupin')?.focus(),
                );
              }}
            >
              ${icon('project', 'sm')}${group || t('lgc.group')}
            </button>`
      }
      ${extra}
    </header>`;
  }

  private ruleTools(card: RuleCard) {
    const app = this.app;
    const ui = cardsUi(app);
    const canTry = card.trigger.type !== 'advanced';
    return html`${
        canTry
          ? html`<button
              type="button"
              class="lgc-ibtn try ${ui.tryOpen.has(card.id) ? 'on' : ''}"
              data-act="try"
              title=${t('lgc.tryTip')}
              aria-pressed=${ui.tryOpen.has(card.id) ? 'true' : 'false'}
              @click=${() => {
                if (ui.tryOpen.has(card.id)) ui.tryOpen.delete(card.id);
                else ui.tryOpen.add(card.id);
                app.requestRender();
              }}
            >
              ${icon('play', 'sm')}${t('lgc.try')}
            </button>`
          : nothing
      }
      <button
        type="button"
        class="lgc-ibtn"
        data-act="dup"
        title=${t('lgc.dup')}
        aria-label=${t('lgc.dup')}
        ?disabled=${this.ro}
        @click=${() => {
          const doc = logicDoc(app);
          if (!doc) return;
          if ((doc.rules ?? []).length >= KIND_LIMIT.rule) {
            app.toast(t('lgc.tpl.full', { n: KIND_LIMIT.rule }));
            return;
          }
          const r = duplicateRule(doc, card.id);
          const g = logicLayout(app).groups?.[card.id];
          ui.flash = r.id;
          editLogic(app, r.doc, undefined, g ? setGroup(logicLayout(app), r.id, g) : undefined);
        }}
      >
        ${icon('copy', 'sm')}
      </button>
      <button
        type="button"
        class="lgc-ibtn"
        data-act="adv"
        title=${t('lgc.openAdv')}
        aria-label=${t('lgc.openAdv')}
        @click=${() => this.openAdvanced('rule', card.id)}
      >
        ${icon('fx', 'sm')}
      </button>
      <button
        type="button"
        class="lgc-ibtn del"
        data-act="del"
        title=${t('lgc.del')}
        aria-label=${t('lgc.del')}
        ?disabled=${this.ro}
        @click=${() => {
          const doc = logicDoc(app);
          if (doc)
            editLogic(
              app,
              removeRule(doc, card.id),
              undefined,
              setGroup(logicLayout(app), card.id, ''),
            );
        }}
      >
        ${icon('trash', 'sm')}
      </button>
      <label class="lgc-switch" title=${t('lgc.enabled')}
        ><input
          type="checkbox"
          role="switch"
          data-act="enabled"
          aria-label=${t('lgc.enabled')}
          .checked=${live(card.enabled)}
          ?disabled=${this.ro}
          @change=${(e: Event) => this.saveRule({ ...card, enabled: (e.target as HTMLInputElement).checked })} /><span></span
      ></label>`;
  }

  private ruleCard(card: RuleCard, cat: Cat, errors: string[], doc: LogicDoc) {
    const ui = cardsUi(this.app);
    const set = (c: RuleCard) => this.saveRule(c);
    const tr = card.trigger;
    let body: TemplateResult;
    if (cat === 'advanced') {
      body = html`<div class="lgc-adv">
        ${icon('fx')}
        <div>
          <b>${t('lgc.advCard')}</b>
          <div class="mono sm-text">
            ${t('lgc.advWhen', { when: tr.type === 'advanced' ? tr.when : card.srcWhen })}
          </div>
          ${card.rise === null || card.fall === null ? html`<div class="sm-text muted">${t('lgc.advActions')}</div>` : nothing}
        </div>
        <button
          type="button"
          class="btn sm"
          data-act="open-adv"
          @click=${() => this.openAdvanced('rule', card.id)}
        >
          ${icon('fx', 'sm')}${t('lgc.openAdv')}
        </button>
      </div>`;
    } else {
      const whenLine =
        tr.type === 'value'
          ? html`${this.kw(t('lgc.when'), 'when')}${this.conditionLine(
              card.id,
              tr,
              (x) => set({ ...card, trigger: x }),
              {
                hold: true,
              },
            )}`
          : tr.type === 'time'
            ? this.timeLine(card, set)
            : this.everyLine(card, set);
      const showElse =
        (card.fall ?? []).length > 0 || tr.type === 'time' ? true : (card.fall ?? []).length > 0;
      body = html`<div class="lgc-line">${whenLine}</div>
        <div class="lgc-line then">
          <span class="lgc-arrow" aria-hidden="true">➜</span
          >${this.kw(t('lgc.then'), 'then')}${this.actionsLine(card, 'rise', set)}
        </div>
        ${
          showElse || tr.type === 'value'
            ? html`<div class="lgc-line else ${(card.fall ?? []).length ? '' : 'faint'}">
                <span class="lgc-arrow" aria-hidden="true">↩</span>${this.kw(
                  tr.type === 'time' && !tr.at ? `${t('lgc.endAt')} ${tr.to}` : t('lgc.else'),
                  'else',
                )}${this.actionsLine(card, 'fall', set)}
              </div>`
            : nothing
        }`;
    }
    return this.shell(
      card,
      cat,
      errors,
      this.ruleTools(card),
      html`${body}${
        ui.tryOpen.has(card.id) && cat !== 'advanced' ? this.tryPanel(card, doc) : nothing
      }`,
    );
  }

  private timerCard(card: TimerCard, errors: string[]) {
    const set = (c: TimerCard) => this.saveTimer(c);
    const s = secs(card.pt);
    const kind = ['ton', 'tof', 'tp'].includes(card.timerKind) ? card.timerKind : 'ton';
    const body =
      card.input.type === 'value'
        ? html`<div class="lgc-line">
              <select
                class="lgc-chip lgc-verb"
                aria-label="loại timer"
                ?disabled=${this.ro}
                .value=${live(kind)}
                @change=${(e: Event) => set({ ...card, timerKind: (e.target as HTMLSelectElement).value })}
              >
                <option value="ton">${t('lgc.timer.ton')} (TON)</option>
                <option value="tof">${t('lgc.timer.tof')} (TOF)</option>
                <option value="tp">${t('lgc.timer.tp')} (TP)</option></select
              >${this.kw(t('lgc.when'), 'when')}${this.conditionLine(card.id, card.input, (x) =>
                set({ ...card, input: x }),
              )}
            </div>
            <div class="lgc-line then">
              <span class="lgc-arrow" aria-hidden="true">➜</span>${this.kw(
                t(`lgc.timer.sentence.${kind}` as MessageKey),
                'soft',
              )}${this.numChip(s, (n) => set({ ...card, pt: Math.max(1, Math.round(n * 1000)) }), {
                step: 0.5,
                w: 64,
                label: 'thời gian',
              })}${this.kw(t('lgc.sec'), 'soft')}${this.kw(t('lgc.then'), 'then')}${this.kw(t('lgc.timer.out'), 'soft')}<span
                class="lgc-chip lgc-tag out ro"
                title=${t('lgc.timer.outTip', { tag: card.q })}
                >${icon('tag', 'sm')}<span class="nm mono">${card.q}</span></span
              >${this.kw(t('lgc.test.on'), 'soft')}
            </div>`
        : this.otherBody(
            t('lgc.other', { kind: kindLabel('timer'), id: card.id }),
            'timer',
            card.id,
          );
    return this.shell(card, 'timer', errors, nothing, body);
  }

  private counterCard(card: CounterCard, errors: string[]) {
    const set = (c: CounterCard) => this.saveCounter(c);
    if (card.up.type !== 'value' || (card.reset && card.reset.type !== 'value'))
      return this.shell(
        card,
        'counter',
        errors,
        nothing,
        this.otherBody(
          t('lgc.other', { kind: kindLabel('counter'), id: card.id }),
          'counter',
          card.id,
        ),
      );
    const reset = card.reset;
    return this.shell(
      card,
      'counter',
      errors,
      nothing,
      html`<div class="lgc-line">
          ${this.kw(t('lgc.counter.each'), 'when')}${this.conditionLine(card.id, card.up, (x) => set({ ...card, up: x }))}${this.kw(
            t('lgc.test.on'),
            'soft',
          )}
        </div>
        <div class="lgc-line then">
          <span class="lgc-arrow" aria-hidden="true">➜</span
          >${this.kw(t('lgc.counter.plus'), 'then')}<span class="lgc-chip lgc-tag out ro"
            >${icon('tag', 'sm')}<span class="nm mono">${card.value}</span></span
          >
        </div>
        <div class="lgc-line then">
          <span class="lgc-arrow" aria-hidden="true">➜</span
          >${this.kw(t('lgc.counter.preset'), 'then')}${this.numChip(
            card.preset ?? 0,
            (n) => set({ ...card, preset: n > 0 ? Math.round(n) : null }),
            { w: 72, label: t('lgc.counter.preset') },
          )}${this.kw(t('lgc.counter.times'), 'soft')}<span class="lgc-chip lgc-tag out ro"
            >${icon('tag', 'sm')}<span class="nm mono">${card.reached}</span></span
          >
        </div>
        <div class="lgc-line else">
          <span class="lgc-arrow" aria-hidden="true">↺</span
          >${this.kw(t('lgc.counter.reset'), 'else')}${
            reset && reset.type === 'value'
              ? html`${this.conditionLine(`${card.id}:rst`, reset, (x) => set({ ...card, reset: x }))}<button
                    type="button"
                    class="lgc-mini x"
                    aria-label=${t('lgc.removeCond')}
                    ?disabled=${this.ro}
                    @click=${() => set({ ...card, reset: null })}
                  >
                    ${icon('x', 'sm')}
                  </button>`
              : html`<span class="muted">${t('lgc.counter.noReset')}</span>${
                    this.ro
                      ? nothing
                      : html`<button
                          type="button"
                          class="lgc-add"
                          @click=${() => set({ ...card, reset: { type: 'value', join: 'and', clauses: [{ tag: '', test: 'on' }], holdMs: 0 } })}
                        >
                          ${icon('plus', 'sm')}${t('lgc.counter.addReset')}
                        </button>`
                  }`
          }
        </div>`,
    );
  }

  private otherBody(text: string, kind: LogicKind, id: string) {
    return html`<div class="lgc-adv">
      ${icon('logic')}
      <div><b>${text}</b></div>
      <button
        type="button"
        class="btn sm"
        data-act="open-adv"
        @click=${() => this.openAdvanced(kind, id)}
      >
        ${icon('fx', 'sm')}${t('lgc.openAdv')}
      </button>
    </div>`;
  }

  private shell(card: Card, cat: Cat, errors: string[], tools: unknown, body: unknown) {
    const app = this.app;
    const ui = cardsUi(app);
    const isRule = card.kind === 'rule';
    const off = isRule && !card.enabled;
    return html`<article
      class="lgc-card cat-${cat} ${off ? 'off' : ''} ${errors.length ? 'has-err' : ''} ${ui.flash === card.id ? 'flash' : ''} ${
        ui.dropAt === card.id ? 'drop' : ''
      }"
      data-card=${card.id}
      data-cat=${cat}
      draggable=${isRule && !this.ro ? 'true' : 'false'}
      @dragstart=${(e: DragEvent) => {
        const el = e.target as HTMLElement;
        if (!isRule || el.closest('input, select, .lgc-tag') || !e.dataTransfer) {
          if (!isRule) e.preventDefault();
          return;
        }
        ui.drag = card.id;
        e.dataTransfer.setData('application/x-mat-logic-card', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      @dragend=${() => {
        ui.drag = null;
        ui.dropAt = null;
        app.requestRender();
      }}
      @dragover=${(e: DragEvent) => {
        if (!ui.drag || !isRule || ui.drag === card.id) return;
        e.preventDefault();
        if (ui.dropAt !== card.id) {
          ui.dropAt = card.id;
          app.requestRender();
        }
      }}
      @drop=${(e: DragEvent) => {
        if (!ui.drag || !isRule) return;
        e.preventDefault();
        const doc = logicDoc(app);
        const from = ui.drag;
        ui.drag = null;
        ui.dropAt = null;
        if (!doc || from === card.id) return app.requestRender();
        const g = logicLayout(app).groups?.[card.id] ?? '';
        const layout =
          (logicLayout(app).groups?.[from] ?? '') !== g
            ? setGroup(logicLayout(app), from, g)
            : undefined;
        editLogic(app, reorderRule(doc, from, card.id), undefined, layout);
      }}
      @animationend=${() => {
        if (ui.flash === card.id) ui.flash = null;
      }}
    >
      <div class="lgc-badge" aria-hidden="true">${icon(CAT_ICON[cat])}</div>
      <div class="lgc-main">
        ${this.header(card, cat, html`${tools}`)}
        ${off ? html`<div class="lgc-offnote">${icon('ban', 'sm')}${t('lgc.off')}</div>` : nothing}
        ${body}
        ${
          errors.length
            ? html`<div class="lgc-errs" role="alert">
                ${errors.map((m) => html`<div>${icon('err', 'sm')}<span>${m}</span></div>`)}
              </div>`
            : nothing
        }
      </div>
    </article>`;
  }

  private renderCard(card: Card, issues: readonly Issue[], doc: LogicDoc) {
    const cat = cardCategory(card);
    const errors = this.cardErrors(card, issues, doc);
    if (card.kind === 'rule') return this.ruleCard(card, cat, errors, doc);
    if (card.kind === 'timer') return this.timerCard(card, errors);
    if (card.kind === 'counter') return this.counterCard(card, errors);
    return this.shell(
      card,
      'other',
      errors,
      nothing,
      this.otherBody(
        t('lgc.other', { kind: kindLabel(card.blockKind), id: card.id }),
        card.blockKind,
        card.id,
      ),
    );
  }

  private cardMatches(card: Card, q: string, doc: LogicDoc): boolean {
    if (!q) return true;
    const parts: string[] = [card.id];
    if (card.kind === 'rule') {
      parts.push(card.name, card.srcWhen);
      for (const a of [...(card.rise ?? []), ...(card.fall ?? [])]) parts.push(a.tag);
    }
    if (card.kind === 'timer') parts.push(card.srcIn, card.q);
    if (card.kind === 'counter') parts.push(card.srcUp, card.value);
    const g = logicLayout(this.app).groups?.[card.id];
    if (g) parts.push(g);
    for (const p of [...parts]) {
      const l = logicTagLabel(doc, p) ?? this.tagIndex.get(p)?.description;
      if (l) parts.push(l);
    }
    return fold(parts.join(' ')).includes(q);
  }

  // ---------- mẫu ----------

  private templates() {
    const ui = cardsUi(this.app);
    const full = (logicDoc(this.app)?.rules ?? []).length >= KIND_LIMIT.rule;
    const close = () => {
      ui.tpl = false;
      this.app.requestRender();
    };
    return html`<div
      class="lgc-scrim"
      @click=${(e: Event) => e.target === e.currentTarget && close()}
    >
      <div
        class="lgc-tpl"
        role="dialog"
        aria-modal="true"
        aria-label=${t('lgc.tpl.title')}
        @keydown=${(e: KeyboardEvent) => e.key === 'Escape' && close()}
      >
        <div class="lgc-tpl-h">
          <div>
            <b>${t('lgc.tpl.title')}</b>
            <div class="muted sm-text">${t('lgc.tpl.sub')}</div>
          </div>
          <span class="grow"></span>
          <button
            type="button"
            class="ibtn"
            aria-label=${t('lgc.tpl.close')}
            title=${t('lgc.tpl.close')}
            @click=${close}
          >
            ${icon('x')}
          </button>
        </div>
        ${full ? html`<div class="lgc-errs">${icon('warn', 'sm')}${t('lgc.tpl.full', { n: KIND_LIMIT.rule })}</div>` : nothing}
        <div class="lgc-tpl-grid">
          ${TEMPLATES.map(
            (id) =>
              html`<button
                type="button"
                class="lgc-tpl-item tpl-${id}"
                data-tpl=${id}
                ?disabled=${full && id !== 'count'}
                @click=${() => this.addTemplate(id)}
              >
                <span class="art">${TEMPLATE_ART[id]}</span>
                <b>${t(`lgc.tpl.${id}` as MessageKey)}</b>
                <span class="d">${t(`lgc.tpl.${id}.d` as MessageKey)}</span>
              </button>`,
          )}
        </div>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const doc = logicDoc(app);
    const ui = cardsUi(app);
    this.setters.clear();
    if (!doc) return html`<div class="empty">${t('lgc.noLogic')}</div>`;
    this.tagIndex = new Map(this.tags().map((tg) => [tg.id, tg]));
    const issues = logicIssues(app);
    const all = this.cards(doc);
    const q = fold(ui.search).trim();
    const counts = new Map<Cat | 'all', number>([['all', all.length]]);
    for (const c of all) counts.set(cardCategory(c), (counts.get(cardCategory(c)) ?? 0) + 1);
    const shown = all.filter(
      (c) => (ui.cat === 'all' || cardCategory(c) === ui.cat) && this.cardMatches(c, q, doc),
    );
    const groups = logicLayout(app).groups ?? {};
    const order: string[] = [];
    for (const c of shown) {
      const g = groups[c.id] ?? '';
      if (!order.includes(g)) order.push(g);
    }
    order.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0));
    const names = [...new Set(Object.values(groups))];
    return html`<div class="lgc-bar" role="toolbar" aria-label=${t('lgc.list')}>
        <button
          type="button"
          class="btn primary lgc-addbtn"
          data-act="add-rule"
          title=${t('lgc.addTip')}
          ?disabled=${this.ro}
          @click=${() => {
            ui.tpl = true;
            app.requestRender();
            void this.updateComplete.then(() =>
              this.querySelector<HTMLElement>('.lgc-tpl-item')?.focus(),
            );
          }}
        >
          ${icon('plus')}${t('lgc.add')}
        </button>
        <span class="lgc-filters" role="group" aria-label=${t('lgc.cat.all')}>
          ${FILTERS.filter((f) => f === 'all' || counts.get(f)).map(
            (f) =>
              html`<button
                type="button"
                class="lgc-fchip f-${f}"
                data-filter=${f}
                aria-pressed=${ui.cat === f ? 'true' : 'false'}
                @click=${() => {
                  ui.cat = f;
                  app.requestRender();
                }}
              >
                ${f === 'all' ? nothing : icon(CAT_ICON[f as Cat], 'sm')}${catLabel(f)}<span
                  class="n"
                  >${counts.get(f) ?? 0}</span
                >
              </button>`,
          )}
        </span>
        <span class="grow"></span>
        <input
          class="input sm lgc-search"
          type="search"
          data-role="card-search"
          placeholder=${t('lgc.search')}
          aria-label=${t('lgc.search')}
          .value=${live(ui.search)}
          @input=${(e: Event) => {
            ui.search = (e.target as HTMLInputElement).value;
            app.requestRender();
          }}
        />
      </div>
      <datalist id="lgc-groups">${names.map((n) => html`<option value=${n}></option>`)}</datalist>
      <div class="lgc-list" role="list" aria-label=${t('lgc.list')}>
        ${
          all.length === 0
            ? html`<div class="lgc-empty">
                <div class="lgc-empty-art">${TEMPLATE_ART.threshold}</div>
                <b>${t('lgc.empty.title')}</b>
                <p>${t('lgc.empty.text')}</p>
                <button
                  type="button"
                  class="btn primary"
                  ?disabled=${this.ro}
                  @click=${() => {
                    ui.tpl = true;
                    app.requestRender();
                  }}
                >
                  ${icon('plus')}${t('lgc.add')}
                </button>
              </div>`
            : shown.length === 0
              ? html`<p class="help pad">${t('lgc.noMatch')}</p>`
              : order.map((g) => {
                  const list = shown.filter((c) => (groups[c.id] ?? '') === g);
                  const collapsed = ui.collapsed.has(g);
                  return html`<section class="lgc-group" data-group=${g}>
                    ${
                      order.length > 1 || g
                        ? html`<button
                            type="button"
                            class="lgc-group-h"
                            aria-expanded=${collapsed ? 'false' : 'true'}
                            @click=${() => {
                              if (collapsed) ui.collapsed.delete(g);
                              else ui.collapsed.add(g);
                              app.requestRender();
                            }}
                          >
                            ${icon(collapsed ? 'chev-r' : 'chev-d', 'sm')}${icon('project', 'sm')}<b
                              >${g || t('lgc.groupNone')}</b
                            ><span class="n">${list.length}</span>
                          </button>`
                        : nothing
                    }
                    ${collapsed ? nothing : list.map((c) => html`<div role="listitem">${this.renderCard(c, issues, doc)}</div>`)}
                  </section>`;
                })
        }
      </div>
      ${ui.tpl ? this.templates() : nothing}`;
  }
}

const LABELS: Record<string, true> = Object.fromEntries(
  [
    'E_LOGIC_TAG_REF',
    'E_LOGIC_TYPE',
    'E_LOGIC_SCHEDULE',
    'E_LOGIC_WRITE_TARGET',
    'E_LOGIC_WRITE_VALUE',
    'E_LOGIC_ACTION',
    'E_LOGIC_EXPR',
    'E_LOGIC_LIMIT',
    'E_LOGIC_SELF_TRIGGER',
    'E_LOGIC_CYCLE',
  ].map((c) => [`lgc.code.${c}`, true]),
);

// ---------- Hình minh họa của mẫu (SVG nội tuyến, màu theo token của loại) ----------

const TEMPLATE_ART: Readonly<Record<TemplateId, TemplateResult>> = {
  equal: html`<svg viewBox="0 0 120 64" class="c-value">
    ${svg`<rect x="6" y="18" width="40" height="28" rx="6" class="f-soft s-main"/>
    <text x="26" y="37" class="t-main">= 1</text>
    <path d="M50 32h20" class="s-main arrow"/><path d="M66 27l6 5-6 5" class="s-main"/>
    <circle cx="94" cy="32" r="13" class="f-on"/><path d="M94 22v8M87 26a10 10 0 1 0 14 0" class="s-ink"/>`}
  </svg>`,
  threshold: html`<svg viewBox="0 0 120 64" class="c-value">
    ${svg`<path d="M6 22h108" class="s-err dash"/>
    <path d="M6 52 C26 48 30 40 42 34 S62 12 76 16 S96 30 114 18" class="s-main w3"/>
    <rect x="58" y="8" width="34" height="10" rx="3" class="f-err-soft"/>
    <text x="75" y="16" class="t-xs">5 giây</text>
    <circle cx="66" cy="20" r="3" class="f-err"/>`}
  </svg>`,
  at: html`<svg viewBox="0 0 120 64" class="c-time">
    ${svg`<circle cx="38" cy="32" r="24" class="f-soft s-main"/>
    <path d="M38 32V14M38 32l-12 7" class="s-main w3"/>
    <text x="88" y="38" class="t-big">07:00</text>`}
  </svg>`,
  every: html`<svg viewBox="0 0 120 64" class="c-every">
    ${svg`<path d="M30 14a20 20 0 1 1-18 12" class="s-main w3"/><path d="M8 18l4 9 9-4" class="s-main"/>
    <g class="f-main"><rect x="64" y="40" width="6" height="12" rx="1"/><rect x="78" y="40" width="6" height="12" rx="1"/><rect x="92" y="40" width="6" height="12" rx="1"/><rect x="106" y="40" width="6" height="12" rx="1"/></g>
    <text x="88" y="28" class="t-main">5 phút</text>`}
  </svg>`,
  onoff: html`<svg viewBox="0 0 120 64" class="c-time">
    ${svg`<path d="M6 46h22V20h62v26h24" class="s-main w3"/>
    <text x="28" y="14" class="t-xs">07:00</text><text x="90" y="14" class="t-xs">17:00</text>
    <text x="59" y="38" class="t-main">CHẠY</text>`}
  </svg>`,
  count: html`<svg viewBox="0 0 120 64" class="c-counter">
    ${svg`<g class="s-main w3"><path d="M10 14v36M20 14v36M30 14v36M40 14v36M4 40l42-16"/></g>
    <rect x="62" y="16" width="50" height="32" rx="6" class="f-soft s-main"/><text x="87" y="38" class="t-big">10</text>`}
  </svg>`,
  delay: html`<svg viewBox="0 0 120 64" class="c-timer">
    ${svg`<path d="M6 30h14V12h94" class="s-muted w3"/>
    <path d="M6 54h44V36h64" class="s-main w3"/>
    <path d="M20 46h30" class="s-main dash"/><text x="35" y="44" class="t-xs">5 s</text>`}
  </svg>`,
  interlock: html`<svg viewBox="0 0 120 64" class="c-value">
    ${svg`<rect x="8" y="20" width="30" height="24" rx="4" class="f-soft s-main"/><text x="23" y="36" class="t-main">A</text>
    <rect x="46" y="20" width="30" height="24" rx="4" class="f-soft s-err"/><text x="61" y="36" class="t-main">B</text>
    <rect x="88" y="28" width="22" height="20" rx="3" class="f-main"/><path d="M92 28v-6a7 7 0 0 1 14 0v6" class="s-main w3"/>`}
  </svg>`,
};

customElements.define('mat-logic-cards', LogicCards);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-cards': LogicCards;
  }
}
