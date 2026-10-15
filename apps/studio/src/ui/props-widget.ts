// Inspector cho item của màn hình 0.3 (feature 007, T115, FR-052, FR-063, FR-064; contract studio-screen-editor §6; mockup studio-screens
// cảnh 1): các nhóm Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật sinh từ danh mục widget JSON dùng chung (model/screen-catalog.ts);
// item `svg` có nhóm Chung và "Đồ họa" chỉ đọc. Chọn nhiều item thì chỉ hiện thuộc tính chung (hình học, khóa, ẩn và, khi cùng loại
// widget, các thuộc tính của loại đó). Lỗi của bộ kiểm tra hiện theo ô (viền đỏ, câu lỗi). Mọi sửa đi qua `app.editScreen`: một bước
// hoàn tác mỗi cử chỉ, gõ liên tục gộp theo `mergeKey`.
import {
  catalogWidget,
  type Action,
  type ActionNameCatalog,
  type Item,
  type PropValue,
  type Role03,
  type ScreenModel,
  type SvgItem,
  type WidgetItem,
} from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import { bindTag } from '../app/screen-bind.ts';
import { groupBindCheck } from '../model/history-bind.ts';
import { tagTypesOf } from '../model/logging-doc.ts';
import { hasKey, t, type MessageKey } from '../i18n/index.ts';
import {
  rename,
  setAction,
  setHidden,
  setLocked,
  setProp,
  setRect,
  setSecurity,
  setTag,
} from '../model/screen-doc.ts';
import {
  canBind,
  commonProps,
  inspectorModelOf,
  suggestFromTag,
  type FieldModel,
  type InspectorModel,
  type SlotModel,
  type TagInfo,
} from '../model/screen-catalog.ts';
import {
  groupByItem,
  screenIssues,
  severityOfField,
  type ItemIssue,
} from '../model/screen-issues.ts';
import { AppElement, icon } from './base.ts';
import { prow } from './mat-inspector.ts';
import { targetLabel } from '../model/xref.ts';
import { renderField } from './props-fields.ts';
import { registerProps } from './registry.ts';
import './props-widget.css';

type TabId = 'general' | 'display' | 'tags' | 'events' | 'security' | 'graphics';

const TAB_LABEL: Readonly<Record<TabId, MessageKey>> = {
  general: 'wi.tab.general',
  display: 'wi.tab.display',
  tags: 'wi.tab.tags',
  events: 'wi.tab.events',
  security: 'wi.tab.security',
  graphics: 'wi.tab.graphics',
};

const ACTIONS: readonly ActionNameCatalog[] = [
  'write',
  'toggle',
  'pulse',
  'navigate',
  'popup',
  'closePopup',
];

const slotText = (s: SlotModel): string =>
  hasKey(s.i18nKey) ? t(s.i18nKey as MessageKey) : t(`wslot.${s.name}` as MessageKey);

const itemName = (it: Item): string => it.name?.trim() || it.id;

const rectFields = [
  ['x', 'wi.x'],
  ['y', 'wi.y'],
  ['width', 'wi.width'],
  ['height', 'wi.height'],
] as const;

export class MatWidgetProps extends AppElement {
  static override properties = { screenId: { attribute: false }, errors: { state: true } };
  declare screenId: string;
  /** Lỗi nhập tạm theo tên ô (chưa vào tài liệu). */
  declare errors: Record<string, MessageKey | null>;

  constructor() {
    super();
    this.screenId = '';
    this.errors = {};
  }

  // ---------- Dữ liệu ----------

  private get doc(): ScreenModel | null {
    return this.app.screenModel(this.screenId);
  }

  private items(): Item[] {
    const sel = new Set(this.app.selectedItems(this.screenId));
    return (this.doc?.items ?? []).filter((i) => sel.has(i.id));
  }

  private get tab(): TabId {
    return this.app.screens.inspTab as TabId;
  }

  private issuesOf(): Map<string, ItemIssue[]> {
    const doc = this.doc;
    if (!doc) return new Map();
    return groupByItem(screenIssues(this.app.store.state.issues, this.screenId), doc).byItem;
  }

  /** Áp một thao tác thuần lên mọi item đang chọn trong MỘT bước hoàn tác. */
  private applyEach(
    key: string | undefined,
    f: (doc: ScreenModel, id: string) => ReturnType<typeof setProp>,
  ): boolean {
    const ids = this.items().map((i) => i.id);
    const r = this.app.editScreen(
      this.screenId,
      (d) => {
        let cur = d;
        for (const id of ids) {
          const x = f(cur, id);
          if (x.rejected) return x;
          cur = x.doc;
        }
        return { doc: cur };
      },
      key === undefined ? undefined : `${key}:${ids.join(',')}`,
    );
    return r !== null && !r.rejected;
  }

  private setErr(name: string, e: MessageKey | null): void {
    if ((this.errors[name] ?? null) === e) return;
    this.errors = { ...this.errors, [name]: e };
  }

  // ---------- Vẽ ----------

  protected override updated(): void {
    // Giữ nhóm đang chọn hợp lệ với loại item (item `svg` không có Gắn Tag, widget hiển thị không có Sự kiện).
    const tabs = this.tabsFor();
    if (!tabs.includes(this.tab)) {
      this.app.screens.inspTab = tabs[0]!;
      this.requestUpdate();
    }
  }

  private model(): InspectorModel | null {
    const its = this.items();
    const w =
      its.length > 0 && its.every((i) => i.type === 'widget') ? commonProps(its).widget : null;
    return w === null ? null : (inspectorModelOf(w) ?? null);
  }

  private tabsFor(): TabId[] {
    const its = this.items();
    if (its.length === 0) return ['general'];
    const tabs: TabId[] = ['general'];
    if (its.length === 1 && its[0]!.type === 'svg') return ['general', 'graphics'];
    const m = this.model();
    if (!m) return tabs;
    if (m.groups.display.length) tabs.push('display');
    if (m.slots.length && its.length === 1) tabs.push('tags');
    if (its.length === 1 && (m.events.length || m.groups.security.length)) tabs.push('events');
    if (m.minRoles) tabs.push('security');
    return tabs;
  }

  private tabsView(): TemplateResult {
    const tabs = this.tabsFor();
    const cur = tabs.includes(this.tab) ? this.tab : tabs[0]!;
    return html`<div class="wi-tabs" role="tablist" aria-label=${t('wi.groups')}>
      ${tabs.map(
        (x) =>
          html`<button
            type="button"
            role="tab"
            id="wi-tab-${x}"
            aria-selected=${cur === x ? 'true' : 'false'}
            aria-controls="wi-panel"
            tabindex=${cur === x ? 0 : -1}
            @click=${() => {
              this.app.screens.inspTab = x;
              this.requestUpdate();
            }}
            @keydown=${(e: KeyboardEvent) => this.onTabKey(e, tabs, x)}
          >
            ${t(TAB_LABEL[x])}
          </button>`,
      )}
    </div>`;
  }

  private onTabKey(e: KeyboardEvent, tabs: TabId[], cur: TabId): void {
    const i = tabs.indexOf(cur);
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    this.app.screens.inspTab = tabs[j]!;
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('.wi-tabs [aria-selected="true"]')?.focus(),
    );
  }

  protected override render() {
    const doc = this.doc;
    if (!doc) return nothing;
    const its = this.items();
    if (its.length === 0) return this.screenView(doc);
    const cur = this.tabsFor().includes(this.tab) ? this.tab : 'general';
    const body =
      cur === 'general'
        ? this.generalTab(its)
        : cur === 'display'
          ? this.displayTab(its)
          : cur === 'tags'
            ? this.tagsTab(its[0] as WidgetItem)
            : cur === 'events'
              ? this.eventsTab(its[0] as WidgetItem)
              : cur === 'security'
                ? this.securityTab(its)
                : this.graphicsTab(its[0] as SvgItem);
    return html`${this.tabsView()}
      <div class="wi-panel" id="wi-panel" role="tabpanel" aria-labelledby="wi-tab-${cur}">
        ${body}
      </div>`;
  }

  // ---------- Không chọn item: thuộc tính màn hình ----------

  private screenView(doc: ScreenModel): TemplateResult {
    const fit = doc.fitMode ?? 'contain';
    return html`<div class="wi-panel">
      ${prow(t('wi.screen.name'), doc.name)}
      ${prow(t('wi.screen.kind'), doc.kind === 'popup' ? t('spd.kind.popup') : t('spd.kind.screen'))}
      ${prow(t('wi.screen.size'), t('scr.tip.size', { w: doc.size.width, h: doc.size.height }), { mono: true })}
      ${prow(t('wi.screen.fit'), fit, { mono: true })}
      ${prow(t('wi.screen.bg'), doc.background ?? t('spd.bg.default'), { mono: true })}
      ${prow(t('wi.screen.items'), String(doc.items.length), { mono: true })}
      <div class="wi-actions">
        <button
          type="button"
          class="btn"
          data-act="screen-props"
          @click=${() => void this.app.run('screen.props')}
        >
          ${icon('gear')}${t('cmd.screen.props')}
        </button>
      </div>
      <p class="help pad">${t('wi.screen.hint')}</p>
    </div>`;
  }

  // ---------- Chung ----------

  private numberRow(
    label: string,
    name: 'x' | 'y' | 'width' | 'height',
    its: Item[],
    issues: Map<string, ItemIssue[]>,
  ): TemplateResult {
    const values = its.map((i) => i[name]);
    const mixed = new Set(values).size > 1;
    const issue = its.length === 1 ? severityOfField(issues.get(its[0]!.id), 'rect') : null;
    const err = this.errors[`rect:${name}`];
    return html`<div class="pf-row ${issue || err ? 'bad' : ''}" data-field="rect">
      <label class="pf-l" for="wi-${name}">${label}</label>
      <div class="pf-v">
        <input
          id="wi-${name}"
          class="pf-in mono num"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          .value=${mixed ? '' : String(values[0] ?? '')}
          placeholder=${mixed ? t('pf.mixed') : ''}
          aria-invalid=${err || issue ? 'true' : 'false'}
          @change=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value.trim();
            if (!/^-?\d+$/.test(raw)) {
              this.setErr(`rect:${name}`, 'pf.err.integer');
              return;
            }
            this.setErr(`rect:${name}`, null);
            const n = Number(raw);
            this.applyEach(`rect:${name}`, (d, id) => setRect(d, id, { [name]: n }));
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      ${err ? html`<div class="pf-err" role="alert">${t(err)}</div>` : nothing}
    </div>`;
  }

  private checkRow(
    label: string,
    name: string,
    on: boolean,
    mixed: boolean,
    set: (v: boolean) => void,
  ) {
    return html`<div class="pf-row" data-field=${name}>
      <label class="pf-l" for="wi-${name}">${label}</label>
      <div class="pf-v">
        <input
          id="wi-${name}"
          type="checkbox"
          .checked=${on}
          .indeterminate=${mixed}
          @change=${(e: Event) => set((e.target as HTMLInputElement).checked)}
        />
      </div>
    </div>`;
  }

  private generalTab(its: Item[]): TemplateResult {
    const issues = this.issuesOf();
    const common = commonProps(its);
    const one = its.length === 1 ? its[0]! : null;
    const m = this.model();
    const general = m ? m.groups.general : [];
    return html`
      ${
        one
          ? html`<div class="pf-row" data-field="item">
                <label class="pf-l" for="wi-name">${t('wi.name')}</label>
                <div class="pf-v">
                  <input
                    id="wi-name"
                    class="pf-in"
                    type="text"
                    maxlength="80"
                    autocomplete="off"
                    spellcheck="false"
                    .value=${one.name ?? ''}
                    placeholder=${one.id}
                    @input=${(e: Event) => {
                      if ((e as InputEvent).isComposing) return;
                      const v = (e.target as HTMLInputElement).value;
                      if (v.trim() !== '') this.applyEach('name', (d, id) => rename(d, id, v));
                    }}
                    @change=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v !== '') this.applyEach('name', (d, id) => rename(d, id, v));
                    }}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter' && !e.isComposing)
                        (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>
              </div>
              ${prow(t('wi.id'), one.id, { mono: true })}
              ${prow(t('wi.type'), one.type === 'svg' ? t('widget.svg') : t(`widget.${one.widget}` as MessageKey))}`
          : html`<p class="help pad" role="status">${t('wi.multi', { n: its.length })}</p>`
      }
      ${rectFields.map(([k, key]) => this.numberRow(t(key), k, its, issues))}
      ${this.checkRow(
        t('wi.locked'),
        'locked',
        common.locked.value === true,
        common.locked.mixed,
        (v) =>
          void this.app.editScreen(this.screenId, (d) =>
            setLocked(
              d,
              its.map((i) => i.id),
              v,
            ),
          ),
      )}
      ${this.checkRow(
        t('wi.hidden'),
        'hidden',
        common.hidden.value === true,
        common.hidden.mixed,
        (v) =>
          void this.app.editScreen(this.screenId, (d) =>
            setHidden(
              d,
              its.map((i) => i.id),
              v,
            ),
          ),
      )}
      ${
        general.length
          ? html`<h3 class="wi-sub">${t('wi.params')}</h3>
              ${general.map((f) => this.field(f, its, issues))}`
          : nothing
      }
      <p class="help pad">${t('wi.lockedNote')}</p>
    `;
  }

  // ---------- Hiển thị ----------

  private suggestionFor(f: FieldModel, its: Item[]): PropValue | undefined {
    if (its.length !== 1) return undefined;
    const it = its[0]!;
    if (it.type !== 'widget' || f.fromTag === undefined) return undefined;
    const info = this.boundInfo(it);
    return info ? suggestFromTag(it.widget, it.props, info)[f.name] : undefined;
  }

  /** Thông tin Tag của khe chính (khe đầu tiên đã gắn). */
  private boundInfo(it: WidgetItem): TagInfo | undefined {
    const m = inspectorModelOf(it.widget);
    for (const s of m?.slots ?? []) {
      const v = it.tags?.[s.name];
      const id = typeof v === 'string' ? v : v?.[0];
      if (id) return this.app.screens.tagInfos().get(id);
    }
    return undefined;
  }

  private field(f: FieldModel, its: Item[], issues: Map<string, ItemIssue[]>): TemplateResult {
    const props = commonProps(its).props.find((p) => p.field.name === f.name);
    const issue =
      its.length === 1
        ? (issues.get(its[0]!.id)?.find((e) => e.field === `prop:${f.name}`)?.issue.message ?? null)
        : null;
    const tables = this.app.store.state.outline.valueTables.map((v) => v.name);
    const local = { error: this.errors[`prop:${f.name}`] ?? null };
    return renderField(
      f,
      {
        value: props?.value,
        mixed: props?.mixed ?? false,
        issue,
        tables,
        logGroups: (this.app.store.state.outline.logging?.groups ?? []).map((g) => ({
          id: g.id,
          name: g.name,
        })),
        suggestion: this.suggestionFor(f, its),
        commit: (v) => this.applyEach(`prop:${f.name}`, (d, id) => setProp(d, id, f.name, v)),
      },
      local,
      (e) => this.setErr(`prop:${f.name}`, e),
    );
  }

  private displayTab(its: Item[]): TemplateResult {
    const m = this.model();
    if (!m) return html`<p class="help pad">${t('wi.noDisplay')}</p>`;
    const issues = this.issuesOf();
    return html`${m.groups.display.map((f) => this.field(f, its, issues))}`;
  }

  // ---------- Gắn Tag ----------

  private tagChip(slot: SlotModel, item: WidgetItem, id: string, index: number): TemplateResult {
    const info = this.app.screens.tagInfos().get(id);
    const meta = info
      ? `${info.type}${info.unit ? ` · ${info.unit}` : ''} · ${info.access}`
      : t('wi.tag.missing');
    return html`<div class="wi-chip ${info ? '' : 'bad'}" data-tag=${id}>
      ${icon('tag', 'sm')}
      <span class="mono id" title=${id}>${id}</span>
      <span class="meta">${meta}</span>
      <button
        type="button"
        class="ibtn sm"
        aria-label=${t('wi.tag.remove', { tag: id })}
        @click=${() =>
          this.applyEach(undefined, (d, iid) => {
            const cur = item.tags?.[slot.name];
            if (!slot.multi || typeof cur === 'string' || cur === undefined)
              return setTag(d, iid, slot.name, null);
            const next = cur.filter((_, k) => k !== index);
            return setTag(d, iid, slot.name, next.length ? next : null);
          })}
      >
        ${icon('x', 'sm')}
      </button>
    </div>`;
  }

  private tagPicker(slot: SlotModel, item: WidgetItem): TemplateResult {
    const spec = catalogWidget(item.widget)?.slots.find((s) => s.name === slot.name);
    const cur = item.tags?.[slot.name];
    const infos = [...this.app.screens.tagInfos().values()];
    const action = item.events?.click;
    const slotSpec = spec!;
    const outline = this.app.store.state.outline;
    const types = tagTypesOf(outline.tags);
    const ok = (i: TagInfo) =>
      canBind(i, slotSpec, slot.multi ? cur : undefined).ok &&
      groupBindCheck(slotSpec, item.props, i.id, outline.logging, types) === null &&
      !(
        slot.needsWrite &&
        (action?.action === 'toggle' || action?.action === 'pulse') &&
        i.type !== 'BOOL'
      );
    const choices = infos.filter(ok);
    const full =
      slot.multi && Array.isArray(cur) && slot.max !== undefined && cur.length >= slot.max;
    return html`<select
      class="pf-in wi-pick"
      aria-label=${t('wi.tag.pick', { slot: slotText(slot) })}
      ?disabled=${full || choices.length === 0}
      @change=${(e: Event) => {
        const el = e.target as HTMLSelectElement;
        if (el.value !== '') bindTag(this.app, this.screenId, item.id, el.value, slot.name);
        el.value = '';
      }}
    >
      <option value="">
        ${full ? t('wi.tag.full') : t('wi.tag.choose', { n: choices.length })}
      </option>
      ${choices.map((i) => html`<option value=${i.id}>${i.id} (${i.type})</option>`)}
    </select>`;
  }

  private tagsTab(item: WidgetItem): TemplateResult {
    const m = inspectorModelOf(item.widget);
    if (!m) return html`<p class="help pad">${t('wi.noTags')}</p>`;
    const issues = this.issuesOf().get(item.id);
    const info = this.boundInfo(item);
    const sug = info ? suggestFromTag(item.widget, item.props, info) : {};
    const dropOn = (slot: SlotModel) => (e: DragEvent) => {
      const id = e.dataTransfer?.getData('application/x-mat-tag');
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove('drop');
      if (id) bindTag(this.app, this.screenId, item.id, id, slot.name);
    };
    return html`${m.slots.map((s) => {
        const v = item.tags?.[s.name];
        const list = v === undefined ? [] : typeof v === 'string' ? [v] : v;
        // Khe bắt buộc còn trống: bộ kiểm tra trỏ vào cả item (khe chưa có khóa), tên khe nằm trong câu báo.
        const missing = issues?.find(
          (e) =>
            e.issue.code === 'E_WIDGET_SLOT' &&
            e.issue.message.startsWith(`slot '${s.name}' `) &&
            list.length === 0,
        );
        const bad = severityOfField(issues, `tag:${s.name}`) ?? (missing ? missing.severity : null);
        const msg =
          issues?.find((e) => e.field === `tag:${s.name}`)?.issue.message ?? missing?.issue.message;
        const types = s.types.map((x) => t(`wi.class.${x}` as MessageKey)).join(' / ');
        return html`<div class="wi-slot ${bad ? 'bad' : ''}" data-field=${`tag:${s.name}`}>
          <div class="wi-slot-h">
            <span class="pf-l"
              >${slotText(s)}${s.required ? html`<b class="req" title=${t('wi.required')}> *</b>` : nothing}</span
            >
            <span class="meta"
              >${types}${s.needsWrite ? ` · ${t('wi.needsWrite')}` : ''}${s.multi ? ` · ${t('wi.slotMax', { max: s.max ?? 0 })}` : ''}</span
            >
          </div>
          <div
            class="dyn ${list.length ? 'has' : ''}"
            @dragover=${(e: DragEvent) => {
              if ((e.dataTransfer?.types ?? []).includes('application/x-mat-tag')) {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add('drop');
              }
            }}
            @dragleave=${(e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('drop')}
            @drop=${dropOn(s)}
          >
            ${list.length ? list.map((id, k) => this.tagChip(s, item, id, k)) : html`<span class="ph">${t('wi.tag.drop')}</span>`}
          </div>
          <div class="wi-slot-a">${this.tagPicker(s, item)}</div>
          ${bad && msg ? html`<div class="pf-err" role="alert">${msg}</div>` : nothing}
        </div>`;
      })}
      ${
        info
          ? html`<div class="wi-useTag">
              <div class="meta">
                ${t('wi.tag.info', { id: info.id, type: info.type, access: info.access })}
              </div>
              <button
                type="button"
                class="btn sm"
                data-act="use-tag"
                ?disabled=${Object.keys(sug).length === 0}
                title=${t('wi.useTagTip')}
                @click=${() => this.useTagDefaults(item, sug)}
              >
                ${t('wi.useTag')}
              </button>
              ${Object.keys(sug).length === 0 ? html`<span class="meta">${t('wi.useTagNone')}</span>` : nothing}
            </div>`
          : nothing
      }
      <p class="help pad">${t('wi.tag.help')}</p>`;
  }

  /** "Dùng đơn vị, bảng, giới hạn của Tag": ghi các thuộc tính chưa đặt thành MỘT bước hoàn tác. */
  private useTagDefaults(item: WidgetItem, sug: Record<string, PropValue>): void {
    this.app.editScreen(this.screenId, (d) => {
      let cur = d;
      for (const [name, v] of Object.entries(sug)) {
        const r = setProp(cur, item.id, name, v);
        if (r.rejected) return r;
        cur = r.doc;
      }
      return { doc: cur };
    });
  }

  // ---------- Sự kiện ----------

  private screensOfKind(kind: 'screen' | 'popup'): Array<{ id: string; name: string }> {
    return this.app.store.state.outline.screens.flatMap((s) =>
      s.model && (s.model.kind === 'popup') === (kind === 'popup') && s.id !== this.screenId
        ? [{ id: s.id, name: s.model.name }]
        : [],
    );
  }

  private actionEditor(item: WidgetItem): TemplateResult {
    const a = item.events?.click;
    const set = (next: Action | null) =>
      this.applyEach(undefined, (d, id) => setAction(d, id, 'click', next));
    const target = typeof item.tags?.target === 'string' ? item.tags.target : undefined;
    const info = target ? this.app.screens.tagInfos().get(target) : undefined;
    const isBool = info?.type === 'BOOL';
    const mk = (name: ActionNameCatalog): Action => {
      switch (name) {
        case 'write':
          return { action: 'write', value: isBool ? true : 0 };
        case 'toggle':
          return { action: 'toggle' };
        case 'pulse':
          return { action: 'pulse', value: true, durationMs: 500 };
        case 'navigate':
          return { action: 'navigate', screen: this.screensOfKind('screen')[0]?.id ?? '' };
        case 'popup':
          return { action: 'popup', screen: this.screensOfKind('popup')[0]?.id ?? '' };
        case 'closePopup':
          return { action: 'closePopup' };
      }
    };
    const issues = this.issuesOf().get(item.id);
    const bad = severityOfField(issues, 'event');
    const msg = issues?.find((e) => e.field === 'event')?.issue.message;
    return html`<div class="pf-row ${bad ? 'bad' : ''}" data-field="event">
      <label class="pf-l" for="wi-action">${t('wi.event.click')}</label>
      <div class="pf-v">
        <select
          id="wi-action"
          class="pf-in"
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            set(v === '' ? null : mk(v as ActionNameCatalog));
          }}
        >
          <option value="" ?selected=${!a}>${t('wi.action.none')}</option>
          ${ACTIONS.map(
            (n) =>
              html`<option value=${n} ?selected=${a?.action === n}>
                ${t(`wi.action.${n}` as MessageKey)}
              </option>`,
          )}
        </select>
      </div>
      ${a ? this.actionParams(item, a, set, isBool) : nothing}
      ${bad && msg ? html`<div class="pf-err" role="alert">${msg}</div>` : nothing}
    </div>`;
  }

  private actionParams(
    item: WidgetItem,
    a: Action,
    set: (a: Action | null) => boolean,
    isBool: boolean,
  ): TemplateResult {
    void item;
    switch (a.action) {
      case 'write':
        return html`<div class="wi-param">
          <label class="pf-l" for="wi-aval">${t('wi.action.value')}</label>
          ${
            isBool
              ? html`<select
                  id="wi-aval"
                  class="pf-in"
                  @change=${(e: Event) =>
                    set({
                      action: 'write',
                      value: (e.target as HTMLSelectElement).value === 'true',
                    })}
                >
                  <option value="true" ?selected=${a.value === true}>${t('pf.on')}</option>
                  <option value="false" ?selected=${a.value === false}>${t('pf.off')}</option>
                </select>`
              : html`<input
                  id="wi-aval"
                  class="pf-in mono num"
                  type="text"
                  inputmode="decimal"
                  .value=${String(a.value)}
                  @change=${(e: Event) => {
                    const raw = (e.target as HTMLInputElement).value.trim();
                    if (raw.includes(',')) return void this.setErr('action:value', 'pf.err.comma');
                    this.setErr('action:value', null);
                    const n = Number(raw);
                    set({ action: 'write', value: raw !== '' && Number.isFinite(n) ? n : raw });
                  }}
                />`
          }
          ${this.errors['action:value'] ? html`<div class="pf-err" role="alert">${t(this.errors['action:value']!)}</div>` : nothing}
        </div>`;
      case 'pulse':
        return html`<div class="wi-param">
            <label class="pf-l" for="wi-pval">${t('wi.action.pulseTo')}</label>
            <select
              id="wi-pval"
              class="pf-in"
              @change=${(e: Event) =>
                set({ ...a, value: (e.target as HTMLSelectElement).value === 'true' })}
            >
              <option value="true" ?selected=${a.value === true}>${t('pf.on')}</option>
              <option value="false" ?selected=${a.value === false}>${t('pf.off')}</option>
            </select>
          </div>
          <div class="wi-param">
            <label class="pf-l" for="wi-pms">${t('wi.action.duration')}</label>
            <input
              id="wi-pms"
              class="pf-in mono num"
              type="text"
              inputmode="numeric"
              .value=${String(a.durationMs)}
              @change=${(e: Event) => {
                const n = Number((e.target as HTMLInputElement).value.trim());
                if (Number.isInteger(n)) set({ ...a, durationMs: n });
              }}
            />
            <div class="pf-hint">${t('wi.action.durationHint')}</div>
          </div>`;
      case 'navigate':
      case 'popup': {
        const kind = a.action === 'popup' ? 'popup' : 'screen';
        const opts = this.screensOfKind(kind);
        return html`<div class="wi-param">
          <label class="pf-l" for="wi-ascr"
            >${t(kind === 'popup' ? 'wi.action.popupTo' : 'wi.action.screenTo')}</label
          >
          <select
            id="wi-ascr"
            class="pf-in"
            @change=${(e: Event) => set({ action: a.action, screen: (e.target as HTMLSelectElement).value })}
          >
            ${a.screen === '' || !opts.some((o) => o.id === a.screen) ? html`<option value=${a.screen} selected>${a.screen || t('wi.action.pickScreen')}</option>` : nothing}
            ${opts.map((o) => html`<option value=${o.id} ?selected=${a.screen === o.id}>${o.name}</option>`)}
          </select>
        </div>`;
      }
      default:
        return html``;
    }
  }

  private eventsTab(item: WidgetItem): TemplateResult {
    const m = inspectorModelOf(item.widget);
    if (!m) return html``;
    const issues = this.issuesOf();
    const sec = m.groups.security;
    return html`${m.events.length ? this.actionEditor(item) : nothing}
      ${
        sec.length
          ? html`<h3 class="wi-sub">${t('wi.confirm')}</h3>
              ${sec.map((f) => this.field(f, [item], issues))}`
          : nothing
      }
      <p class="help pad">${t('wi.confirm.help')}</p>`;
  }

  // ---------- Bảo mật ----------

  private securityTab(its: Item[]): TemplateResult {
    const m = this.model();
    if (!m?.minRoles) return html``;
    const roles = its.map((i) => (i as WidgetItem).security?.minRole ?? null);
    const mixed = new Set(roles).size > 1;
    const cur = roles[0] ?? m.defaultRole ?? 'operator';
    const issues = this.issuesOf();
    const bad = its.length === 1 && severityOfField(issues.get(its[0]!.id), 'security');
    return html`<div class="pf-row ${bad ? 'bad' : ''}" data-field="security">
        <label class="pf-l" for="wi-role">${t('wi.role')}</label>
        <div class="pf-v">
          <select
            id="wi-role"
            class="pf-in"
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value as Exclude<Role03, 'viewer'>;
              this.applyEach(undefined, (d, id) =>
                setSecurity(d, id, v === (m.defaultRole ?? 'operator') ? null : v),
              );
            }}
          >
            ${mixed ? html`<option value="" selected>${t('pf.mixed')}</option>` : nothing}
            ${m.minRoles.map(
              (r) =>
                html`<option value=${r} ?selected=${!mixed && cur === r}>
                  ${t(`wi.role.${r}` as MessageKey)}
                </option>`,
            )}
          </select>
        </div>
      </div>
      <div class="banner info wi-note" role="note">
        ${icon('shield')}
        <div>${t('wi.role.always')}</div>
      </div>`;
  }

  // ---------- Đồ họa (item svg, chỉ đọc) ----------

  private graphicsTab(item: SvgItem): TemplateResult {
    const outline = this.app.store.state.outline.screens.find((s) => s.id === this.screenId);
    const bound = outline?.itemBindings[item.id];
    const withTag = (bound?.elements ?? []).filter((e) => (e.bindings ?? []).length > 0).length;
    return html`${prow(t('wi.svg.file'), item.svgFile, { mono: true })}
      ${prow(t('wi.svg.binding'), item.bindingFile, { mono: true })}
      ${prow(t('wi.svg.viewBox'), item.viewBox.join(' '), { mono: true })}
      ${prow(t('wi.svg.elements'), String(item.elements.length), { mono: true })}
      ${prow(t('wi.svg.bound'), String(withTag), { mono: true })}
      ${
        withTag > 0
          ? html`<h3 class="wi-sub">${t('wi.svg.bindings')}</h3>
              <ul class="wi-binds" aria-label=${t('wi.svg.bindings')}>
                ${(bound?.elements ?? []).flatMap((e) =>
                  (e.bindings ?? []).map((b) => {
                    const name = item.elements.find((x) => x.elementUid === e.elementUid)?.name;
                    return html`<li>
                      <span class="mono">${name ?? e.elementUid}</span>
                      <span class="muted">${targetLabel(b.target)}</span>
                      <span class="mono">${b.source?.tagId ?? ''}</span>
                    </li>`;
                  }),
                )}
              </ul>`
          : nothing
      }
      <p class="help pad">${t('wi.svg.help')}</p>`;
  }
}

customElements.define('mat-widget-props', MatWidgetProps);

registerProps((app) => {
  const s = app.store.state;
  if (s.outline.schema !== '0.3' || !s.active.startsWith('screen:')) return null;
  const id = s.active.slice('screen:'.length);
  const doc = app.screenModel(id);
  if (!doc) return null;
  const sel = app.selectedItems(id);
  const items = doc.items.filter((i) => sel.includes(i.id));
  const ctx =
    items.length === 0
      ? t('wi.ctx.screen', { name: doc.name })
      : items.length === 1
        ? t('wi.ctx.item', {
            kind:
              items[0]!.type === 'svg'
                ? t('widget.svg')
                : t(`widget.${items[0]!.widget}` as MessageKey),
            name: itemName(items[0]!),
          })
        : t('wi.ctx.multi', { n: items.length });
  return {
    ctx,
    body: html`<mat-widget-props .app=${app} .screenId=${id}></mat-widget-props>`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-widget-props': MatWidgetProps;
  }
}
