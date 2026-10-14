// Hộp thoại "Tạo alarm cho Tag…" (feature 009, T077, FR-075; contract studio-alarm-editor §6; mockup studio-alarms.html cảnh 2): hai
// cột, bên trái nhập (Tag, Loại, Ngưỡng với giá trị và lớp gợi ý, Chung), bên phải xem trước các dòng sẽ tạo (id, ngưỡng, lớp,
// nội dung mặc định đã chèn mẫu). Gợi ý ngưỡng 10/20/80/90 % khoảng của Tag, deadband 2 %, trễ 3 s; Tạo thêm dòng vào lưới
// trong MỘT bước hoàn tác rồi chọn dòng mới. Enter tạo, Esc đóng, bẫy focus; ARIA role=dialog (khung OnlineDialog).
import { html, nothing } from 'lit';
import { ALARM_THRESHOLDS, type AlarmThresholdName } from '@mat/project-schema';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  alarmDocOf,
  ctxOf,
  docEdits,
  tagFits,
  type AlarmDoc,
  type QuickCreateInput,
} from '../../model/alarm-doc.ts';
import { initialForm, previewOf, type QuickForm } from '../../model/alarm-quick.ts';
import { OnlineDialog } from '../dialogs/dialog-frame.ts';
import './alarm-editors.css';

const KINDS: readonly QuickCreateInput['kind'][] = ['limit', 'digital', 'quality'];

export class MatAlarmQuickDialog extends OnlineDialog {
  static override properties = { form: { state: true }, tagFilter: { state: true } };

  protected get kind(): 'alarmQuick' {
    return 'alarmQuick';
  }

  declare form: QuickForm;
  declare tagFilter: string;

  constructor() {
    super();
    this.form = initialForm([], new Map(), { areas: [], alarms: [], classes: [] });
    this.tagFilter = '';
  }

  private doc(): AlarmDoc {
    const o = this.app.store.state.outline;
    return alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
  }

  private lookup() {
    const o = this.app.store.state.outline;
    const devices = (o.connections?.channels ?? []).flatMap((c) =>
      (c.devices ?? []).map((d) => d.id),
    );
    return ctxOf((o.tags?.tags ?? []) as never, devices);
  }

  /** Tag ngoài → thiết bị trường đọc nó (gợi ý "cả thiết bị" cho alarm quality). */
  private deviceOf(): Map<string, string> {
    const m = new Map<string, string>();
    for (const x of (this.app.store.state.outline.tags?.tags ?? []) as unknown as Array<{
      id: string;
      kind?: string;
      source?: { device?: string };
    }>)
      if (x.kind === 'external' && x.source?.device) m.set(x.id, x.source.device);
    return m;
  }

  protected override opened(): void {
    const d = this.app.ui.dialog;
    const tags = d?.kind === 'alarmQuick' ? d.tags : [];
    this.form = initialForm(tags, this.lookup().tags, this.doc());
    this.tagFilter = '';
  }

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('input[data-role="tag-filter"]') ??
      this.querySelector<HTMLElement>('[data-kind]')
    );
  }

  private set(patch: Partial<QuickForm>): void {
    this.form = { ...this.form, ...patch };
  }

  private setTh(
    n: AlarmThresholdName,
    patch: Partial<QuickForm['thresholds'][AlarmThresholdName]>,
  ): void {
    this.form = {
      ...this.form,
      thresholds: { ...this.form.thresholds, [n]: { ...this.form.thresholds[n], ...patch } },
    };
  }

  private preview() {
    return previewOf(this.form, this.lookup().tags, this.deviceOf(), this.doc());
  }

  private submit(): void {
    const p = this.preview();
    if (p.blocked || !p.added.length) return;
    const doc = this.doc();
    const o = this.app.store.state.outline;
    const version = String(
      (this.app.store.state.docs['project.json']?.value as { schemaVersion?: string } | null)
        ?.schemaVersion ?? '0.5.0',
    );
    const addedDefaults = doc.classes.length === 0;
    this.app.store.edit(
      docEdits(doc, p.doc, version, { alarms: !!o.alarms, classes: !!o.alarmClasses }),
    );
    this.app.closeOnlineDialog();
    this.app.openEditor('alarms');
    this.app.revealLocation({ editor: 'alarms', row: p.added[0]!, column: 'name' });
    this.app.toast(t('alarm.quick.created', { n: p.added.length }));
    if (addedDefaults) this.app.toast(t('alarm.quick.defaultsAdded'));
  }

  private tagPicker() {
    const lookup = this.lookup().tags;
    const q = this.tagFilter.trim().toLowerCase();
    const all = [...lookup.keys()];
    const list = (q ? all.filter((id) => id.toLowerCase().includes(q)) : all).slice(0, 200);
    const chosen = new Set(this.form.tags);
    return html`<div class="field">
      <label for="aq-tagfilter"
        >${t('alarm.quick.tag')} · ${t('alarm.quick.tags', { n: chosen.size })}</label
      >
      <input
        id="aq-tagfilter"
        class="input"
        type="search"
        data-role="tag-filter"
        autocomplete="off"
        spellcheck="false"
        placeholder=${t('alarm.grid.find')}
        .value=${this.tagFilter}
        @input=${(e: Event) => (this.tagFilter = (e.target as HTMLInputElement).value)}
      />
      <div class="al-taglist" role="group" aria-label=${t('alarm.quick.tag')}>
        ${list.map(
          (id) =>
            html`<label
              ><input
                type="checkbox"
                data-tag=${id}
                .checked=${chosen.has(id)}
                @change=${(e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const next = on
                    ? [...this.form.tags, id]
                    : this.form.tags.filter((x) => x !== id);
                  this.set({ tags: next });
                }}
              /><span class="mono">${id}</span></label
            >`,
        )}
      </div>
    </div>`;
  }

  private kindTabs() {
    const lookup = this.lookup().tags;
    const tags = this.form.tags.map((id) => lookup.get(id)).filter((x) => !!x);
    return html`<div class="field">
      <span class="lbl">${t('alarm.quick.kind')}</span>
      <div class="al-tabs" role="group" aria-label=${t('alarm.quick.kind')}>
        ${KINDS.map((k) => {
          const fits = tags.length === 0 || tags.every((x) => tagFits(x!, k));
          return html`<button
            class="btn sm"
            type="button"
            data-kind=${k}
            aria-pressed=${this.form.kind === k ? 'true' : 'false'}
            aria-disabled=${fits ? nothing : 'true'}
            title=${fits || k === 'quality' ? '' : t(`alarm.quick.kindLocked.${k}` as MessageKey)}
            @click=${() => (fits ? this.set({ kind: k }) : undefined)}
          >
            ${t(`alarm.quick.kind.${k}` as MessageKey)}
          </button>`;
        })}
      </div>
    </div>`;
  }

  private num(label: string, key: 'deadband' | 'onDelayS' | 'offDelayS', ph = '') {
    const id = `aq-${key}`;
    return html`<div class="field">
      <label for=${id}>${label}</label>
      <input
        id=${id}
        class="input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder=${ph}
        .value=${this.form[key]}
        @input=${(e: Event) => this.set({ [key]: (e.target as HTMLInputElement).value } as Partial<QuickForm>)}
        @keydown=${(e: KeyboardEvent) => this.onEnter(e)}
      />
    </div>`;
  }

  private onEnter(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      this.submit();
    }
  }

  private classSelect(value: string, on: (v: string) => void, label: string, name?: string) {
    const classes = this.doc().classes.length ? this.doc().classes : [];
    return html`<select
      class="select"
      aria-label=${label}
      data-cls=${name ?? ''}
      @change=${(e: Event) => on((e.target as HTMLSelectElement).value)}
    >
      ${classes.map((c) => html`<option value=${c.id} ?selected=${c.id === value}>${c.name}</option>`)}
      ${classes.length === 0 ? html`<option value="" selected>${t('alarm.quick.defaultsAdded')}</option>` : nothing}
    </select>`;
  }

  private limitPart() {
    const f = this.form;
    return html`<fieldset class="al-fs">
      <legend>${t('alarm.quick.thresholds')}</legend>
      <p class="help">${t('alarm.quick.thresholdHint')}</p>
      ${[...ALARM_THRESHOLDS].map(
        (n) =>
          html`<div class="al-qth">
            <input
              type="checkbox"
              data-th-on=${n}
              aria-label=${n}
              .checked=${f.thresholds[n].on}
              @change=${(e: Event) => this.setTh(n, { on: (e.target as HTMLInputElement).checked })}
            />
            <span class="lv">${n}</span>
            <input
              class="input"
              type="text"
              inputmode="decimal"
              data-th-value=${n}
              aria-label=${`${n}: ${t('alarm.quick.value')}`}
              placeholder=${this.suggestionFor(n)}
              ?disabled=${!f.thresholds[n].on}
              .value=${f.thresholds[n].value}
              @input=${(e: Event) => this.setTh(n, { value: (e.target as HTMLInputElement).value })}
              @keydown=${(e: KeyboardEvent) => this.onEnter(e)}
            />
            ${this.classSelect(f.thresholds[n].cls, (v) => this.setTh(n, { cls: v }), `${n}: ${t('alarm.quick.class')}`, n)}
          </div>`,
      )}
    </fieldset>`;
  }

  private suggestionFor(n: AlarmThresholdName): string {
    const lookup = this.lookup().tags;
    const first = this.form.tags.map((id) => lookup.get(id)).find((x) => !!x);
    if (!first) return '';
    const min = first.min ?? first.limits?.min;
    const max = first.max ?? first.limits?.max;
    if (min === undefined || max === undefined || max <= min) return '';
    const pct = { LL: 10, L: 20, H: 80, HH: 90 }[n];
    return String(Math.round((min + ((max - min) * pct) / 100) * 1e6) / 1e6);
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const f = this.form;
    const doc = this.doc();
    const p = this.preview();
    const ok = !p.blocked && p.added.length > 0;
    const devices = this.deviceOf();
    const device = f.tags.map((id) => devices.get(id)).find((x) => !!x);
    const body = html`<div class="al-qbody">
      <div data-role="inputs">
        ${this.tagPicker()} ${this.kindTabs()} ${f.kind === 'limit' ? this.limitPart() : nothing}
        ${
          f.kind === 'digital'
            ? html`<div class="field">
                  <label for="aq-trigger">${t('alarm.quick.trigger')}</label>
                  <select
                    id="aq-trigger"
                    class="select"
                    @change=${(e: Event) => this.set({ trigger: (e.target as HTMLSelectElement).value === 'on' })}
                  >
                    <option value="on" ?selected=${f.trigger}>${t('alarm.trigger.on')}</option>
                    <option value="off" ?selected=${!f.trigger}>${t('alarm.trigger.off')}</option>
                  </select>
                </div>
                <div class="field">
                  <label>${t('alarm.quick.class')}</label
                  >${this.classSelect(f.cls, (v) => this.set({ cls: v }), t('alarm.quick.class'))}
                </div>`
            : nothing
        }
        ${
          f.kind === 'quality'
            ? html`<div class="field">
                  <label for="aq-on">${t('alarm.quick.on')}</label>
                  <select
                    id="aq-on"
                    class="select"
                    @change=${(e: Event) => this.set({ on: (e.target as HTMLSelectElement).value as 'bad' | 'notGood' })}
                  >
                    <option value="bad" ?selected=${f.on === 'bad'}>
                      ${t('alarm.qualityOn.bad')}
                    </option>
                    <option value="notGood" ?selected=${f.on === 'notGood'}>
                      ${t('alarm.qualityOn.notGood')}
                    </option>
                  </select>
                </div>
                ${
                  device
                    ? html`<label class="al-chk"
                        ><input
                          type="checkbox"
                          data-role="by-device"
                          .checked=${f.byDevice}
                          @change=${(e: Event) => this.set({ byDevice: (e.target as HTMLInputElement).checked })}
                        />${t('alarm.quick.device', { device })}</label
                      >`
                    : nothing
                }
                <div class="field">
                  <label>${t('alarm.quick.class')}</label
                  >${this.classSelect(f.cls, (v) => this.set({ cls: v }), t('alarm.quick.class'))}
                </div>`
            : nothing
        }
        <fieldset class="al-fs">
          <legend>${t('alarm.quick.common')}</legend>
          <div class="al-two">
            ${f.kind === 'limit' ? this.num(t('alarm.quick.deadband'), 'deadband') : nothing}
            ${this.num(t('alarm.quick.onDelay'), 'onDelayS')}
            ${f.kind === 'quality' ? nothing : this.num(t('alarm.quick.offDelay'), 'offDelayS')}
            <div class="field">
              <label for="aq-area">${t('alarm.quick.area')}</label>
              <select
                id="aq-area"
                class="select"
                @change=${(e: Event) => this.set({ area: (e.target as HTMLSelectElement).value })}
              >
                <option value="" ?selected=${f.area === ''}>${t('alarm.area.common')}</option>
                ${doc.areas.map((a) => html`<option value=${a.id} ?selected=${a.id === f.area}>${a.name}</option>`)}
              </select>
            </div>
          </div>
        </fieldset>
      </div>
      <div data-role="preview" aria-live="polite">
        <h3 class="dlg-sub">${t('alarm.quick.preview')}</h3>
        <p class="help">${t('alarm.quick.previewText')}</p>
        <table class="al-t">
          <thead>
            <tr>
              <th>${t('alarm.grid.col.id')}</th>
              <th>${t('alarm.grid.col.cond')}</th>
              <th>${t('alarm.grid.col.class')}</th>
              <th>${t('alarm.grid.col.text')}</th>
            </tr>
          </thead>
          <tbody>
            ${p.rows.map(
              (r) =>
                html`<tr data-row=${r.id}>
                  <td class="mono">${r.id}</td>
                  <td>${r.summary}</td>
                  <td>${r.classes}</td>
                  <td>${r.text}</td>
                </tr>`,
            )}
          </tbody>
        </table>
        ${
          p.blocked
            ? html`<p class="field-err" role="alert" data-role="blocked">
                ${t(p.blocked as MessageKey)}
              </p>`
            : nothing
        }
        ${p.skipped.map((s) => html`<p class="field-err">${s.tag}: ${t(s.reason as MessageKey)}</p>`)}
      </div>
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" @click=${() => this.close()}>
        ${t('alarm.quick.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-act="create"
        ?disabled=${!ok}
        @click=${() => this.submit()}
      >
        ${t('alarm.quick.create')}
      </button>`;
    return this.frame({ title: t('alarm.quick.title'), icon: 'bell', body, foot });
  }
}

customElements.define('mat-alarm-quick-dialog', MatAlarmQuickDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-quick-dialog': MatAlarmQuickDialog;
  }
}
