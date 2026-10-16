// Nhóm Sự kiện của inspector phần tử SVG (feature 008, T081 phần giao diện; FR-054; contract studio-svg-editor §8; mockup studio-svg
// cảnh 2). Một ô "Nhấp chuột" với danh sách hành động (Không có, Chuyển màn hình, Mở popup, Đóng popup, Ghi giá trị, Đảo, Xung); ô
// đổi theo hành động: màn hình đích đúng loại, Tag chỉ Tag ghi được (kéo thả hoặc bộ chọn), giá trị theo kiểu Tag, thời gian xung,
// xác nhận, quyền tối thiểu, nhãn đọc. Nhập dở (chưa đủ để hợp lệ) giữ ở bản nháp, chỉ ghi vào project khi hợp lệ; lý do từ chối
// của `checkEvent` hiện đúng ô. Lỗi `E_EVENT_*` và cảnh báo `W_EVENT_*` của bộ kiểm tra hiện ở cuối nhóm.
import type { ElementAction } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import {
  applyEvent,
  bindingSetOf,
  eventCtx,
  eventRejectText,
  itemRef,
  removeEvent,
  type ItemRef,
} from '../app/svg-bind.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { tagClassOf04 } from '../model/animation-catalog.ts';
import type { TagInfo } from '../model/screen-catalog.ts';
import { elementOf, eventWritable, type EventRejection } from '../model/svg-binding-doc.ts';
import { groupBySvgElement, issuesOfRow } from '../model/svg-issues.ts';
import { AppElement, icon } from './base.ts';
import './tag-chooser.ts';

type Name = 'none' | 'navigate' | 'popup' | 'closePopup' | 'write' | 'toggle' | 'pulse';
const NAMES: readonly Name[] = [
  'none',
  'navigate',
  'popup',
  'closePopup',
  'write',
  'toggle',
  'pulse',
];

/** Bản nháp của hành động: mọi trường có thể đang dở. */
interface Draft {
  uid: string;
  action: Name;
  screen?: string;
  tag?: string;
  value?: boolean | number | string;
  durationMs?: number;
  confirm?: 'always' | 'none';
  minRole?: 'operator' | 'engineer' | 'administrator';
  label?: string;
}

const FIELD_OF: Readonly<Record<EventRejection, string>> = {
  'bad-action': 'action',
  'bad-tag': 'tag',
  'not-writable': 'tag',
  'not-bool': 'tag',
  'bad-value': 'value',
  'bad-duration': 'durationMs',
  'bad-confirm': 'confirm',
  'bad-role': 'minRole',
  'bad-label': 'label',
  'bad-screen': 'screen',
  'wrong-screen-kind': 'screen',
};

const isWrite = (a: Name): boolean => a === 'write' || a === 'toggle' || a === 'pulse';

function draftOf(uid: string, a: ElementAction | undefined): Draft {
  if (a === undefined) return { uid, action: 'none' };
  const x = a as unknown as Record<string, unknown>;
  const d: Draft = { uid, action: a.action };
  for (const k of ['screen', 'tag', 'value', 'durationMs', 'confirm', 'minRole', 'label'] as const)
    if (x[k] !== undefined) (d as unknown as Record<string, unknown>)[k] = x[k];
  return d;
}

/** Hành động đầy đủ từ bản nháp; `null` khi chưa đủ trường bắt buộc (chưa thể kiểm). */
function actionOf(d: Draft): ElementAction | null {
  const extras = {
    ...(d.confirm !== undefined ? { confirm: d.confirm } : {}),
    ...(d.minRole !== undefined ? { minRole: d.minRole } : {}),
    ...(d.label !== undefined && d.label !== '' ? { label: d.label } : {}),
  };
  const label = d.label !== undefined && d.label !== '' ? { label: d.label } : {};
  switch (d.action) {
    case 'none':
      return null;
    case 'closePopup':
      return { action: 'closePopup', ...label };
    case 'navigate':
    case 'popup':
      return d.screen === undefined ? null : { action: d.action, screen: d.screen, ...label };
    case 'toggle':
      return d.tag === undefined ? null : { action: 'toggle', tag: d.tag, ...extras };
    case 'write':
      return d.tag === undefined || d.value === undefined
        ? null
        : { action: 'write', tag: d.tag, value: d.value, ...extras };
    case 'pulse':
      return d.tag === undefined
        ? null
        : {
            action: 'pulse',
            tag: d.tag,
            value: typeof d.value === 'boolean' ? d.value : true,
            durationMs: d.durationMs ?? 500,
            ...extras,
          };
  }
}

export class MatSvgEvents extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    itemId: { attribute: false },
    uids: { attribute: false },
    draft: { state: true },
    chooser: { state: true },
    errors: { state: true },
  };

  declare screenId: string;
  declare itemId: string;
  declare uids: readonly string[];
  declare draft: Draft | null;
  declare chooser: boolean;
  /** Lý do từ chối theo ô (`field` → mã). */
  declare errors: Readonly<Record<string, EventRejection>>;

  private lastStored = '';

  constructor() {
    super();
    this.screenId = '';
    this.itemId = '';
    this.uids = [];
    this.draft = null;
    this.chooser = false;
    this.errors = {};
  }

  private ref(): ItemRef | null {
    return itemRef(this.app, this.screenId, this.itemId);
  }

  protected override updated(): void {
    // Nhảy từ tab Thông tin (nhấp đúp một lỗi của sự kiện): đưa focus tới đúng ô.
    const j = this.app.screens.takeJump('events');
    if (j === null) return;
    const el =
      this.querySelector<HTMLElement>(`[data-field="${j.field}"]`) ??
      this.querySelector<HTMLElement>('select, input, button');
    el?.scrollIntoView?.({ block: 'nearest' });
    el?.focus();
  }

  private get uid(): string {
    return this.uids.at(-1) ?? '';
  }

  /** Đồng bộ bản nháp với sự kiện đã ghi khi đổi phần tử hoặc project đổi từ nơi khác (hoàn tác). */
  protected override willUpdate(): void {
    const ref = this.ref();
    if (ref === null || this.uids.length !== 1) return;
    const stored = elementOf(bindingSetOf(this.app, ref), this.uid)?.events?.click;
    const sig = `${this.uid}|${JSON.stringify(stored ?? null)}`;
    if (sig === this.lastStored) return;
    this.lastStored = sig;
    this.draft = draftOf(this.uid, stored);
    this.errors = {};
    this.chooser = false;
  }

  /** Cập nhật bản nháp và ghi khi hợp lệ. */
  private update_(ref: ItemRef, patch: Partial<Draft>, drop: readonly (keyof Draft)[] = []): void {
    const cur = this.draft ?? { uid: this.uid, action: 'none' as Name };
    const next: Draft = { ...cur, ...patch };
    for (const k of drop) delete (next as unknown as Record<string, unknown>)[k];
    this.draft = next;
    if (next.action === 'none') {
      this.errors = {};
      removeEvent(this.app, ref, this.uid);
      this.lastStored = `${this.uid}|null`;
      return;
    }
    const act = actionOf(next);
    if (act === null) {
      // Chưa đủ trường để hợp lệ: sự kiện cũ (hành động khác) không còn đúng, bỏ để project không giữ thứ đã đổi ý.
      this.errors = {};
      removeEvent(this.app, ref, this.uid);
      this.lastStored = `${this.uid}|null`;
      return;
    }
    const why = applyEvent(this.app, ref, this.uid, act);
    if (why === null) {
      this.errors = {};
      this.lastStored = `${this.uid}|${JSON.stringify(act)}`;
    } else this.errors = { [FIELD_OF[why]]: why };
  }

  private changeAction(ref: ItemRef, name: Name): void {
    const cur = this.draft;
    const keepTag = cur?.tag !== undefined && isWrite(name) ? cur.tag : undefined;
    const base: Draft = { uid: this.uid, action: name };
    if (keepTag !== undefined) base.tag = keepTag;
    if (name === 'pulse') {
      base.value = true;
      base.durationMs = 500;
    }
    if (name === 'navigate' || name === 'popup') {
      const first = eventCtx(this.app).screens.find(
        (s) => s.kind === (name === 'navigate' ? 'screen' : 'popup') && s.id !== this.screenId,
      );
      if (first !== undefined) base.screen = first.id;
    }
    this.draft = base;
    this.chooser = false;
    this.update_(ref, {}, []);
  }

  private tagInfo(): TagInfo | undefined {
    const id = this.draft?.tag;
    return id === undefined ? undefined : this.app.screens.tagInfos().get(id);
  }

  // ---------- Vẽ ----------

  private err(field: string): TemplateResult | typeof nothing {
    const why = this.errors[field];
    return why === undefined
      ? nothing
      : html`<span class="ferr" id="sve-${field}-e" role="alert">${eventRejectText(why)}</span>`;
  }

  private issueView(ref: ItemRef): TemplateResult | typeof nothing {
    const set = bindingSetOf(this.app, ref);
    const { byElement } = groupBySvgElement(
      this.app.store.state.issues.filter((i) => i.file === ref.file),
      set,
    );
    const list = issuesOfRow(byElement.get(this.uid), 'event');
    if (list.length === 0) return nothing;
    return html`<ul class="berrs" aria-label=${t('sve.issues')}>
      ${list.map(
        (i) =>
          html`<li class=${i.severity === 'error' ? 'e' : 'w'} data-field=${i.field}>
            <span class="mono">${i.issue.code}</span> ${i.issue.message}
          </li>`,
      )}
    </ul>`;
  }

  private row(
    id: string,
    label: string,
    control: TemplateResult,
    field: string,
    hint?: string,
  ): TemplateResult {
    const bad = this.errors[field] !== undefined;
    return html`<div class="sv-row ${bad ? 'bad' : ''}">
      <label class="sv-l" for=${id}>${label}</label>
      <div class="sv-v">${control}</div>
      ${hint ? html`<p class="sv-hint">${hint}</p>` : nothing} ${this.err(field)}
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const ref = this.ref();
    if (ref === null) return nothing;
    if (this.uids.length !== 1)
      return html`<p class="help pad" role="status">${t('sve.single')}</p>`;
    const d = this.draft ?? { uid: this.uid, action: 'none' as Name };
    const disabled = app.store.state.readOnly;
    const screens = eventCtx(app).screens;
    const tag = this.tagInfo();
    const cls = tag ? tagClassOf04(tag.type) : null;
    const rawTag = tag
      ? (
          app.store.state.outline.tags?.tags as unknown as
            Array<{ id?: string; kind?: string; source?: { readback?: boolean } }> | undefined
        )?.find((x) => x.id === tag.id)
      : undefined;
    const readback =
      d.action === 'pulse' && rawTag?.kind === 'external' && rawTag.source?.readback !== false;
    return html`<div class="sve">
      ${this.row(
        'sve-action',
        t('sve.click'),
        html`<select
          id="sve-action"
          class="sv-in"
          data-field="event:action"
          ?disabled=${disabled}
          aria-describedby=${this.errors.action ? 'sve-action-e' : nothing}
          @change=${(e: Event) => this.changeAction(ref, (e.target as HTMLSelectElement).value as Name)}
        >
          ${NAMES.map((n) => html`<option value=${n} ?selected=${d.action === n}>${t(`sve.act.${n}` as MessageKey)}</option>`)}
        </select>`,
        'action',
        d.action === 'none' ? t('sve.noneHint') : undefined,
      )}
      ${
        d.action === 'navigate' || d.action === 'popup'
          ? this.row(
              'sve-screen',
              d.action === 'navigate' ? t('sve.screen') : t('sve.popup'),
              html`<select
                  id="sve-screen"
                  class="sv-in"
                  data-field="event:screen"
                  ?disabled=${disabled}
                  @change=${(e: Event) => this.update_(ref, { screen: (e.target as HTMLSelectElement).value })}
                >
                  ${d.screen === undefined ? html`<option value="" selected disabled>${t('sve.pickScreen')}</option>` : nothing}
                  ${screens
                    .filter((s) => s.kind === (d.action === 'navigate' ? 'screen' : 'popup'))
                    .map(
                      (s) =>
                        html`<option value=${s.id} ?selected=${d.screen === s.id}>
                          ${app.screenModel(s.id)?.name ?? s.id}
                        </option>`,
                    )}
                </select>
                ${
                  d.action === 'popup'
                    ? html`<button
                        type="button"
                        class="btn sm"
                        ?disabled=${disabled}
                        @click=${() => void app.run('screen.addPopup')}
                      >
                        ${icon('plus')}${t('sve.newPopup')}
                      </button>`
                    : nothing
                }`,
              'screen',
            )
          : nothing
      }
      ${
        isWrite(d.action)
          ? html`${this.row(
              'sve-tag',
              t('sve.tag'),
              html`<button
                type="button"
                id="sve-tag"
                class="tagbtn ${d.tag ? 'has' : ''}"
                data-field="event:tag"
                aria-haspopup="listbox"
                aria-expanded=${this.chooser ? 'true' : 'false'}
                ?disabled=${disabled}
                @click=${() => (this.chooser = !this.chooser)}
                @dragover=${(e: DragEvent) => {
                  if ((e.dataTransfer?.types ?? []).includes('application/x-mat-tag'))
                    e.preventDefault();
                }}
                @drop=${(e: DragEvent) => {
                  const id = e.dataTransfer?.getData('application/x-mat-tag');
                  if (id) {
                    e.preventDefault();
                    this.update_(ref, { tag: id });
                  }
                }}
              >
                ${
                  d.tag
                    ? html`<span class="mono tg-id">${d.tag}</span
                        ><span class="tg-t"
                          >${tag ? `${tag.type}${tag.access === 'RW' ? ' · RW' : ''}` : t('svb.unknownTag')}</span
                        >`
                    : html`<span class="tg-ph">${icon('link', 'sm')}${t('sve.tagPh')}</span>`
                }
              </button>`,
              'tag',
              t('sve.tagHint'),
            )}
            ${
              this.chooser
                ? html`<div class="chooser">
                    <mat-tag-chooser
                      .app=${app}
                      .label=${t('sve.chooseTag')}
                      .accept=${(tg: TagInfo) => eventWritable(tg) && (d.action === 'write' || tagClassOf04(tg.type) === 'bool')}
                      @choose=${(e: CustomEvent<{ id: string }>) => {
                        this.chooser = false;
                        this.update_(ref, { tag: e.detail.id });
                      }}
                      @cancel=${() => (this.chooser = false)}
                    ></mat-tag-chooser>
                  </div>`
                : nothing
            }`
          : nothing
      }
      ${
        d.action === 'write' && tag
          ? this.row(
              'sve-value',
              t('sve.value'),
              cls === 'bool'
                ? html`<select
                    id="sve-value"
                    class="sv-in"
                    data-field="event:value"
                    @change=${(e: Event) => this.update_(ref, { value: (e.target as HTMLSelectElement).value === 'true' })}
                  >
                    ${d.value === undefined ? html`<option selected disabled value="">${t('sve.pickValue')}</option>` : nothing}
                    <option value="true" ?selected=${d.value === true}>${t('svg.on')}</option>
                    <option value="false" ?selected=${d.value === false}>${t('svg.off')}</option>
                  </select>`
                : html`<input
                    id="sve-value"
                    class="sv-in ${cls === 'number' ? 'num' : ''}"
                    data-field="event:value"
                    .value=${d.value === undefined ? '' : String(d.value)}
                    aria-invalid=${this.errors.value ? 'true' : nothing}
                    @change=${(e: Event) => {
                      const raw = (e.target as HTMLInputElement).value;
                      if (cls === 'string') return this.update_(ref, { value: raw });
                      const n = Number(raw.trim());
                      if (raw.trim() === '' || raw.includes(',') || !Number.isFinite(n))
                        return void (this.errors = { value: 'bad-value' });
                      this.update_(ref, { value: n });
                    }}
                  />`,
              'value',
              tag.min !== undefined || tag.limits?.min !== undefined
                ? t('sve.valueRange', {
                    min: tag.limits?.min ?? tag.min ?? '',
                    max: tag.limits?.max ?? tag.max ?? '',
                  })
                : undefined,
            )
          : nothing
      }
      ${
        d.action === 'pulse'
          ? this.row(
              'sve-dur',
              t('sve.duration'),
              html`<input
                  id="sve-dur"
                  class="sv-in num"
                  data-field="event:durationMs"
                  inputmode="numeric"
                  .value=${String(d.durationMs ?? 500)}
                  aria-invalid=${this.errors.durationMs ? 'true' : nothing}
                  @change=${(e: Event) => {
                    const n = Number((e.target as HTMLInputElement).value.trim());
                    this.update_(ref, { durationMs: Number.isFinite(n) ? n : NaN });
                  }}
                /><span class="sv-hint">ms</span>`,
              'durationMs',
              t('sve.durationHint'),
            )
          : nothing
      }
      ${
        isWrite(d.action) && d.tag !== undefined
          ? html`${this.row(
              'sve-confirm',
              t('sve.confirm'),
              html`<select
                id="sve-confirm"
                class="sv-in"
                data-field="event:confirm"
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  this.update_(
                    ref,
                    v === '' ? {} : { confirm: v as 'always' | 'none' },
                    v === '' ? ['confirm'] : [],
                  );
                }}
              >
                <option value="" ?selected=${d.confirm === undefined}>
                  ${t('sve.confirm.default')}
                </option>
                <option value="always" ?selected=${d.confirm === 'always'}>
                  ${t('sve.confirm.always')}
                </option>
                <option value="none" ?selected=${d.confirm === 'none'} ?disabled=${cls !== 'bool'}>
                  ${t('sve.confirm.none')}
                </option>
              </select>`,
              'confirm',
              d.confirm === 'none' ? t('sve.confirmNoneWarn') : undefined,
            )}
            ${this.row(
              'sve-role',
              t('sve.minRole'),
              html`<select
                id="sve-role"
                class="sv-in"
                data-field="event:minRole"
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  this.update_(
                    ref,
                    v === '' ? {} : { minRole: v as 'operator' },
                    v === '' ? ['minRole'] : [],
                  );
                }}
              >
                <option value="" ?selected=${d.minRole === undefined}>
                  ${t('svp.role.default')}
                </option>
                <option value="operator" ?selected=${d.minRole === 'operator'}>
                  ${t('svp.role.operator')}
                </option>
                <option value="engineer" ?selected=${d.minRole === 'engineer'}>
                  ${t('svp.role.engineer')}
                </option>
                <option value="administrator" ?selected=${d.minRole === 'administrator'}>
                  ${t('svp.role.administrator')}
                </option>
              </select>`,
              'minRole',
              t('sve.minRoleHint'),
            )}`
          : nothing
      }
      ${
        d.action !== 'none'
          ? this.row(
              'sve-label',
              t('sve.label'),
              html`<input
                id="sve-label"
                class="sv-in"
                data-field="event:label"
                .value=${d.label ?? ''}
                aria-invalid=${this.errors.label ? 'true' : nothing}
                @change=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  this.update_(ref, v === '' ? {} : { label: v }, v === '' ? ['label'] : []);
                }}
              />`,
              'label',
              t('sve.labelHint'),
            )
          : nothing
      }
      ${readback ? html`<p class="sv-note w" role="note"><span class="mono">W_EVENT_PULSE_READBACK</span> ${t('sve.pulseReadback')}</p>` : nothing}
      ${this.issueView(ref)}
    </div>`;
  }
}

customElements.define('mat-svg-events', MatSvgEvents);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-events': MatSvgEvents;
  }
}
