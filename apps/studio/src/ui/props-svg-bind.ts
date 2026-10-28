// Nhóm Gắn Tag của inspector phần tử SVG (feature 008, T072, T073, T074; FR-031…FR-046; contract studio-svg-editor §5, §6, §7;
// mockup studio-svg cảnh 2). Mười ba dòng sinh từ `animation-catalog`: mỗi dòng có tên, ô Tag (kéo thả từ Details hoặc bộ chọn bằng
// bàn phím), nút phép biến đổi, giá trị hiện tại, nút xóa và chỉ báo lỗi; dòng đã gắn mở vùng tham số (phép biến đổi Trực tiếp,
// Tuyến tính, Rời rạc, Bảng giá trị, Khoảng và tham số riêng của mục). Dòng không hợp loại phần tử hoặc kiểu Tag bị mờ kèm lý do.
// Thanh Thử giá trị dính ở đầu nhóm; nút Gợi ý, Sao chép và Dán (Ctrl+C, Ctrl+V khi focus ở nhóm này) ở dải công cụ. Mọi thao tác
// là MỘT bước hoàn tác (`svgBindings`). Lỗi của bộ kiểm tra hiện đúng dòng và ô (viền đỏ, mô tả cho trình đọc màn hình).
import type { Binding04, Scalar, Transform04 } from '@mat/project-schema';
import { html, nothing, type TemplateResult } from 'lit';
import {
  acceptSuggestion,
  bindRow,
  bindingSetOf,
  copyElementBindings,
  elementNameOf,
  itemRef,
  kindOfUid,
  pasteBindings,
  patchBinding,
  rejectText,
  removeRow,
  retag,
  suggestionsFor,
  type ItemRef,
} from '../app/svg-bind.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import {
  ANIMATION_ROWS,
  ROW_SECTIONS,
  recommendedRows,
  rowUnit,
  SPIN_PRESETS,
  spinPresetTransform,
  spinSpeedOf,
  type SpinSpeed,
  defaultTransform,
  rowAcceptsKind,
  rowAcceptsTag,
  rowBlock,
  rowOfBinding,
  tagClassOf04,
  tagRange,
  transformChoices,
  transformsFor,
  type AnimationRow,
  type ParamSpec,
  type RowId,
  type TransformKind04,
} from '../model/animation-catalog.ts';
import { elementOf, type BindRejection } from '../model/svg-binding-doc.ts';
import { findByUid } from '../model/svg-dom.ts';
import { rowIssueTexts } from '../model/svg-issue-text.ts';
import { groupBySvgElement, issuesOfRow, type SvgIssue } from '../model/svg-issues.ts';
import {
  checkParam,
  checkRanges,
  outputKindOf,
  paramPatch,
  parseScalar,
  readParam,
  sortRanges,
  type OutputKind,
  type RangeRow,
} from '../model/svg-params.ts';
import type { TagInfo } from '../model/screen-catalog.ts';
import type { Suggestion } from '../model/svg-suggest.ts';
import { AppElement, icon } from './base.ts';
import { liveText } from './props-element.ts';
import './tag-chooser.ts';
import './test-strip.ts';

const REJECT_CODE: Readonly<Partial<Record<BindRejection, string>>> = {
  'tag-type': 'E_TYPE_MISMATCH',
  transform: 'E_BIND_TRANSFORM',
  'duplicate-group': 'E_DUP_BINDING',
  'element-kind': 'W_BIND_ELEMENT_KIND',
};

/** Nhãn nhận dạng của đích (dòng thứ hai của cột tên): mã đích của hợp đồng. */
const TARGET_CODE = (row: AnimationRow, b: Binding04 | undefined): string =>
  b?.target ?? row.target;

const PIVOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [0.5, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

export class MatSvgBind extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    itemId: { attribute: false },
    uids: { attribute: false },
    open: { state: true },
    activeRow: { state: true },
    chooser: { state: true },
    suggestions: { state: true },
    dropRow: { state: true },
    rowErr: { state: true },
    fieldErr: { state: true },
  };

  declare screenId: string;
  declare itemId: string;
  declare uids: readonly string[];
  /** Dòng đang mở vùng tham số. */
  declare open: ReadonlySet<RowId>;
  /** Dòng đang chọn (thanh Thử giá trị theo dòng này). */
  declare activeRow: RowId | null;
  /** Bộ chọn Tag đang mở: của một dòng, hoặc của nút Gợi ý. */
  declare chooser: RowId | 'suggest' | null;
  declare suggestions: { uid: string; items: Suggestion[]; tag: string } | null;
  declare dropRow: RowId | null;
  /** Lỗi tạm theo dòng (từ chối thả Tag...) và theo ô (giá trị gõ chưa hợp). */
  declare rowErr: Readonly<Record<string, string>>;
  declare fieldErr: Readonly<Record<string, string>>;

  private offValues: (() => void) | null = null;

  constructor() {
    super();
    this.screenId = '';
    this.itemId = '';
    this.uids = [];
    this.open = new Set();
    this.activeRow = null;
    this.chooser = null;
    this.suggestions = null;
    this.dropRow = null;
    this.rowErr = {};
    this.fieldErr = {};
  }

  protected override attached(): void {
    this.offValues = this.app.subscribeValues(() => this.requestUpdate());
  }

  protected override detached(): void {
    this.offValues?.();
    this.offValues = null;
  }

  protected override updated(): void {
    // Nhảy tới dòng, ô lỗi từ tab Thông tin (nhấp đúp một lỗi): mở dòng và đưa focus.
    const j = this.app.screens.takeJump('bind');
    if (j === null) return;
    const row = j.rowId as RowId | undefined;
    if (row === undefined || rowById(row) === undefined) return;
    this.open = new Set([...this.open, row]);
    this.activeRow = row;
    void this.updateComplete.then(() => {
      const host = this.querySelector<HTMLElement>(`[data-row="${row}"]`);
      // Ô lỗi có thể nằm ở vùng tham số (dưới dòng): tìm ở đó trước, rồi tới ô của chính dòng (Tag, phép biến đổi).
      const target =
        this.querySelector<HTMLElement>(`[data-params="${row}"] [data-field="${j.field}"]`) ??
        host?.querySelector<HTMLElement>(`[data-field="${j.field}"]`) ??
        host?.querySelector<HTMLElement>('select, input, button');
      (target ?? host)?.scrollIntoView?.({ block: 'nearest' });
      target?.focus();
    });
  }

  // ---------- Truy cập ----------

  private ref(): ItemRef | null {
    return itemRef(this.app, this.screenId, this.itemId);
  }

  private get primary(): string {
    return this.uids.at(-1) ?? '';
  }

  private bindingOf(row: AnimationRow, ref: ItemRef): Binding04 | undefined {
    const set = bindingSetOf(this.app, ref);
    return elementOf(set, this.primary)?.bindings?.find((b) => rowOfBinding(b)?.id === row.id);
  }

  private nameOfPrimary(ref: ItemRef): string {
    const app = this.app;
    const item = app.screenModel(ref.screen)?.items.find((i) => i.id === ref.item);
    const root = app.screens.svgRoot(ref.screen, ref.item);
    const el = root === null ? null : findByUid(root, this.primary);
    return item?.type === 'svg'
      ? elementNameOf(item, this.primary, el) || this.primary
      : this.primary;
  }

  private setErr(key: string, msg: string | null): void {
    const cur = { ...this.rowErr };
    if (msg === null) delete cur[key];
    else cur[key] = msg;
    this.rowErr = cur;
  }

  private setFieldErr(key: string, msg: string | null): void {
    const cur = { ...this.fieldErr };
    if (msg === null) delete cur[key];
    else cur[key] = msg;
    this.fieldErr = cur;
  }

  private reject(rowId: RowId, why: BindRejection): void {
    const code = REJECT_CODE[why];
    this.setErr(rowId, code ? `${code} · ${rejectText(why)}` : rejectText(why));
    this.app.toast(rejectText(why));
  }

  // ---------- Gắn Tag ----------

  private assign(row: AnimationRow, ref: ItemRef, tagId: string): void {
    const app = this.app;
    const info = app.screens.tagInfos().get(tagId);
    this.setErr(row.id, null);
    if (info === undefined) return this.reject(row.id, 'unknown-tag');
    if (!rowAcceptsTag(row, info)) return this.reject(row.id, 'tag-type');
    const own = this.bindingOf(row, ref);
    if (this.uids.length === 1 && own !== undefined) {
      const why = retag(app, ref, this.primary, own.id, tagId);
      if (why === null) return void (this.activeRow = row.id);
      if (why !== 'transform') return this.reject(row.id, why);
    }
    const r = bindRow(app, ref, this.uids, row.id, tagId);
    if (!r.ok) this.setErr(row.id, r.rejected ? rejectText(r.rejected) : '');
    else this.activeRow = row.id;
    this.chooser = null;
    this.open = new Set([...this.open, row.id]);
  }

  private onDrop(e: DragEvent, row: AnimationRow, ref: ItemRef): void {
    this.dropRow = null;
    const tag = e.dataTransfer?.getData('application/x-mat-tag');
    if (!tag) return;
    e.preventDefault();
    this.assign(row, ref, tag);
  }

  private onDragOver(e: DragEvent, row: AnimationRow): void {
    if (!(e.dataTransfer?.types ?? []).includes('application/x-mat-tag')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
    if (this.dropRow !== row.id) this.dropRow = row.id;
  }

  private changeTransform(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    kind: TransformKind04,
  ): void {
    const tag = this.app.screens.tagInfos().get(b.source.tagId);
    const why = patchBinding(this.app, ref, this.primary, b.id, {
      transform: defaultTransform(row, kind, tag, this.tableNames()),
    });
    this.setErr(row.id, null);
    if (why !== null) return this.reject(row.id, why);
    // Mở sẵn phần chi tiết để người dùng sửa giá trị mặc định vừa điền.
    if (kind !== 'direct') this.open = new Set([...this.open, row.id]);
  }

  /** Quay khi chạy: đổi tốc độ (preset, theo Tag) bằng phép biến đổi sẵn có, không đổi schema. */
  private changeSpinSpeed(row: AnimationRow, ref: ItemRef, b: Binding04, speed: SpinSpeed): void {
    if (speed === 'custom') {
      this.open = new Set([...this.open, row.id]);
      return;
    }
    const tag = this.app.screens.tagInfos().get(b.source.tagId);
    const transform: Transform04 =
      speed === 'tag' ? { kind: 'direct' } : spinPresetTransform(speed, tag);
    const why = patchBinding(this.app, ref, this.primary, b.id, { transform });
    this.setErr(row.id, null);
    if (why !== null) this.reject(row.id, why);
  }

  private spinSelect(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    tag: TagInfo | undefined,
    label: string,
  ): TemplateResult {
    const cur = spinSpeedOf(b, tag);
    const isBool = tag?.type === 'BOOL';
    const opts: SpinSpeed[] = [
      ...(Object.keys(SPIN_PRESETS) as SpinSpeed[]),
      ...(isBool ? [] : (['tag'] as SpinSpeed[])),
      ...(cur === 'custom' ? (['custom'] as SpinSpeed[]) : []),
    ];
    return html`<select
      class="sv-in xf spd"
      data-field="speed"
      aria-label=${t('svb.spin.label', { row: label })}
      ?disabled=${this.app.store.state.readOnly}
      @change=${(e: Event) =>
        this.changeSpinSpeed(row, ref, b, (e.target as HTMLSelectElement).value as SpinSpeed)}
    >
      ${opts.map(
        (k) =>
          html`<option value=${k} ?selected=${cur === k}>
            ${t(`svb.spin.${k}` as MessageKey)}
          </option>`,
      )}
    </select>`;
  }

  private tableNames(): string[] {
    return this.app.store.state.outline.valueTables
      .map((v) => (v.doc as { name?: string } | null)?.name)
      .filter((n): n is string => typeof n === 'string' && n !== '');
  }

  private patch(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    patch: Partial<Binding04>,
    key?: string,
  ): boolean {
    const why = patchBinding(this.app, ref, this.primary, b.id, patch, key);
    if (why !== null) {
      this.reject(row.id, why);
      return false;
    }
    this.setErr(row.id, null);
    return true;
  }

  // ---------- Dải công cụ: Gợi ý, sao chép, dán ----------

  private onSuggest(ref: ItemRef): void {
    const set = bindingSetOf(this.app, ref);
    const first = elementOf(set, this.primary)?.bindings?.[0]?.source.tagId;
    if (first !== undefined) this.runSuggest(ref, first);
    else this.chooser = this.chooser === 'suggest' ? null : 'suggest';
  }

  private runSuggest(ref: ItemRef, tagId: string): void {
    this.chooser = null;
    const items = suggestionsFor(this.app, ref, this.primary, this.nameOfPrimary(ref), tagId);
    this.suggestions = { uid: this.primary, items, tag: tagId };
  }

  private onKey(e: KeyboardEvent, ref: ItemRef): void {
    const target = e.target as HTMLElement;
    if (target.matches('input:not([type=range]):not([type=checkbox]), textarea')) return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      copyElementBindings(this.app, ref, this.primary);
    } else if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      pasteBindings(this.app, ref, this.uids);
    }
  }

  // ---------- Vẽ: một dòng ----------

  private rowView(
    row: AnimationRow,
    ref: ItemRef,
    issues: readonly SvgIssue[],
    kind: ReturnType<typeof kindOfUid>,
    groupHeld: ReadonlySet<string>,
  ): TemplateResult {
    const app = this.app;
    const b = this.bindingOf(row, ref);
    const tag = b ? app.screens.tagInfos().get(b.source.tagId) : undefined;
    const label = t(`svg.row.${row.id}` as MessageKey);
    const sugTag =
      this.suggestions?.uid === this.primary
        ? app.screens.tagInfos().get(this.suggestions.tag)
        : undefined;
    const fits =
      b === undefined && sugTag !== undefined && recommendedRows(sugTag).includes(row.id);
    let block: 'element-kind' | 'tag-type' | 'group' | null = rowBlock(row, kind);
    if (block === null && b === undefined && groupHeld.has(row.group)) block = 'group';
    const rowIssues = issuesOfRow(issues, row.id);
    const err = this.rowErr[row.id];
    const hasErr = rowIssues.some((i) => i.severity === 'error') || err !== undefined;
    const expanded = b !== undefined && this.open.has(row.id);
    const sel = this.activeRow === row.id;
    const disabled = app.store.state.readOnly;
    const errId = `svb-err-${row.id}`;
    return html`<div
        class="brow ${sel ? 'sel' : ''} ${block ? 'dis' : ''} ${hasErr ? 'errr' : ''} ${this.dropRow === row.id ? 'dropt' : ''}"
        role="group"
        aria-label=${label}
        data-row=${row.id}
        data-bound=${b ? 'true' : 'false'}
        @focusin=${() => {
          if (this.activeRow !== row.id) this.activeRow = row.id;
        }}
        @dragover=${block ? nothing : (e: DragEvent) => this.onDragOver(e, row)}
        @dragleave=${() => {
          if (this.dropRow === row.id) this.dropRow = null;
        }}
        @drop=${block ? nothing : (e: DragEvent) => this.onDrop(e, row, ref)}
      >
        <button
          type="button"
          class="tw"
          aria-expanded=${b ? (expanded ? 'true' : 'false') : nothing}
          aria-label=${t('svb.toggleParams', { row: label })}
          ?disabled=${b === undefined}
          @click=${() => {
            const s = new Set(this.open);
            if (s.has(row.id)) s.delete(row.id);
            else s.add(row.id);
            this.open = s;
            this.activeRow = row.id;
          }}
        >
          ${b ? icon(expanded ? 'chev-d' : 'chev-r') : nothing}
        </button>
        <div class="nm">
          <b>${label}</b>${fits ? html`<span class="fit">${t('svg.fitsTag')}</span>` : nothing}
          <small class="help">${t(`svg.help.${row.id}` as MessageKey)}</small>
          <small class="ex"
            >${
              b && row.id !== 'spin'
                ? t(`svb.xfHelp.${b.transform.kind}` as MessageKey)
                : b && row.id === 'spin' && spinSpeedOf(b, tag) === 'tag'
                  ? t('svb.spin.tagHint')
                  : t(`svg.ex.${row.id}` as MessageKey)
            }</small
          >
          <i class="mono" title=${TARGET_CODE(row, b)}>${TARGET_CODE(row, b)}</i>
        </div>
        ${
          block
            ? html`<div class="reason" id=${errId}>${t(`svg.block.${block}` as MessageKey)}</div>`
            : html` <button
                  type="button"
                  class="tagbtn ${b ? 'has' : ''}"
                  data-field="tag"
                  aria-haspopup="listbox"
                  aria-expanded=${this.chooser === row.id ? 'true' : 'false'}
                  aria-label=${t('svb.tagButton', {
                    row: label,
                    tag: b ? b.source.tagId : t('svb.noTag'),
                  })}
                  ?disabled=${disabled}
                  @click=${() => {
                    this.chooser = this.chooser === row.id ? null : row.id;
                    this.activeRow = row.id;
                  }}
                >
                  ${
                    b
                      ? html`<span class="mono tg-id">${b.source.tagId}</span
                          ><span class="tg-t"
                            >${tag ? `${tag.type}${tag.unit ? ` · ${tag.unit}` : ''}` : t('svb.unknownTag')}</span
                          >`
                      : html`<span class="tg-ph">${icon('link', 'sm')}${t('svb.dropHere')}</span>`
                  }
                </button>
                ${
                  row.id === 'spin' && b !== undefined
                    ? this.spinSelect(row, ref, b, tag, label)
                    : html`<select
                        class="sv-in xf"
                        data-field="transform"
                        aria-label=${t('svb.transformLabel', { row: label })}
                        ?disabled=${b === undefined || disabled}
                        aria-invalid=${rowIssues.some((i) => i.field === 'transform') ? 'true' : nothing}
                        @change=${(e: Event) =>
                          b &&
                          this.changeTransform(
                            row,
                            ref,
                            b,
                            (e.target as HTMLSelectElement).value as TransformKind04,
                          )}
                      >
                        ${
                          b === undefined
                            ? html`<option>${t('svb.transformNone')}</option>`
                            : transformChoices(row, tag, this.tableNames(), b.transform.kind).map(
                                (k) =>
                                  html`<option value=${k} ?selected=${b.transform.kind === k}>
                                    ${t(`svg.xf.${k}` as MessageKey)}
                                  </option>`,
                              )
                        }
                      </select>`
                }
                <div class="val mono">${b ? this.valueCell(b.source.tagId) : nothing}</div>
                <button
                  type="button"
                  class="ibtn sm rm"
                  aria-label=${t('svb.remove', { row: label })}
                  ?disabled=${b === undefined || disabled}
                  @click=${() => removeRow(app, ref, this.uids, row.id)}
                >
                  ${icon('x')}
                </button>
                <span class="ind"
                  >${
                    hasErr
                      ? html`<span aria-label=${t('svb.hasError')} role="img" class="e"
                          >${icon('err', 'err')}</span
                        >`
                      : nothing
                  }</span
                >`
        }
      </div>
      ${this.chooser === row.id ? this.chooserView(row, ref, kind) : nothing}
      ${
        err !== undefined || rowIssues.length > 0
          ? html`<ul class="berrs" id=${errId} aria-label=${t('svb.errors', { row: label })}>
              ${err !== undefined ? html`<li class="e" role="alert">${err}</li>` : nothing}
              ${rowIssueTexts(rowIssues, b, row.id).map(
                (i) =>
                  html`<li class=${i.severity === 'error' ? 'e' : 'w'} data-code=${i.code}>
                    ${i.text}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
      ${expanded && b && tag !== undefined ? this.paramView(row, ref, b, rowIssues, tag) : nothing}
      ${expanded && b && tag === undefined ? html`<p class="sv-hint pad">${t('svb.unknownTagHint', { tag: b.source.tagId })}</p>` : nothing}`;
  }

  private valueCell(tagId: string): TemplateResult {
    const app = this.app;
    const testing = app.screens.testActive.includes(tagId);
    if (testing) {
      const v = app.simulation.read(tagId)?.value;
      return html`<span class="live test" title=${t('ts.active')}
        >${icon('play', 'sm')}${v === null || v === undefined ? '—' : String(v)}</span
      >`;
    }
    const v = liveText(app, tagId);
    return html`<span class="live ${v.cls}" title=${v.text}>${v.text}</span>`;
  }

  private chooserView(
    row: AnimationRow,
    ref: ItemRef,
    kind: ReturnType<typeof kindOfUid>,
  ): TemplateResult {
    return html`<div class="chooser">
      <mat-tag-chooser
        .app=${this.app}
        .label=${t('svb.chooseFor', { row: t(`svg.row.${row.id}` as MessageKey) })}
        .accept=${(tg: { type: string }) => rowAcceptsKind(row, kind) && rowAcceptsTag(row, tg) && transformsFor(row, tg).length > 0}
        @choose=${(e: CustomEvent<{ id: string }>) => {
          this.chooser = null;
          this.assign(row, ref, e.detail.id);
          void this.updateComplete.then(() =>
            this.querySelector<HTMLElement>(`[data-row="${row.id}"] .tagbtn`)?.focus(),
          );
        }}
        @cancel=${() => {
          this.chooser = null;
          void this.updateComplete.then(() =>
            this.querySelector<HTMLElement>(`[data-row="${row.id}"] .tagbtn`)?.focus(),
          );
        }}
      ></mat-tag-chooser>
    </div>`;
  }

  // ---------- Vẽ: vùng tham số ----------

  private paramView(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    issues: readonly SvgIssue[],
    tag: TagInfo,
  ): TemplateResult {
    const hasIssue = (f: string) => issues.some((i) => i.field === f && i.severity === 'error');
    return html`<div class="bparam" data-params=${row.id}>
      ${this.transformEditor(row, ref, b, tag, hasIssue)}
      ${
        row.params.length > 0
          ? html`<div class="pgrid">
              ${row.params.map((p) => this.paramField(row, ref, b, p, hasIssue))}
            </div>`
          : nothing
      }
      ${
        row.id === 'blink'
          ? html`<p class="sv-note" data-role="blink-note">${t('svb.blink.note')}</p>`
          : nothing
      }
    </div>`;
  }

  private field(
    id: string,
    label: string,
    control: TemplateResult,
    err: string | null,
    bad = false,
  ): TemplateResult {
    return html`<div class="field ${err || bad ? 'bad' : ''}">
      <label for=${id}>${label}</label>
      ${control} ${err ? html`<span class="ferr" id="${id}-e" role="alert">${err}</span>` : nothing}
    </div>`;
  }

  /** Ô số có kiểm cục bộ: giá trị chưa hợp chỉ báo tại ô, không ghi vào project. */
  private numberInput(
    id: string,
    value: number | undefined,
    onCommit: (v: number | undefined) => boolean,
    errKey: string,
    check?: (v: number) => string | null,
    attrs: { placeholder?: string } = {},
  ): TemplateResult {
    const err = this.fieldErr[errKey];
    return html`<input
      id=${id}
      class="sv-in num"
      inputmode="decimal"
      .value=${value === undefined ? '' : String(value)}
      placeholder=${attrs.placeholder ?? nothing}
      aria-invalid=${err ? 'true' : nothing}
      aria-describedby=${err ? `${id}-e` : nothing}
      @change=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value.trim();
        if (raw === '') {
          this.setFieldErr(errKey, null);
          onCommit(undefined);
          return;
        }
        if (raw.includes(',')) return this.setFieldErr(errKey, t('svb.err.comma'));
        const n = Number(raw);
        if (!Number.isFinite(n)) return this.setFieldErr(errKey, t('svb.err.number'));
        const why = check?.(n) ?? null;
        if (why !== null) return this.setFieldErr(errKey, why);
        this.setFieldErr(errKey, null);
        onCommit(n);
      }}
    />`;
  }

  private paramMessage(spec: ParamSpec, v: unknown): string | null {
    const why = checkParam(spec, v);
    if (why === null) return null;
    if (why === 'int') return t('svb.err.int');
    if (why === 'range') {
      if (spec.kind === 'int' || spec.kind === 'number')
        return t('svb.err.range', { min: spec.min, max: spec.max });
      if (spec.kind === 'string') return t('svb.err.maxLength', { n: spec.maxLength });
      return t('svb.err.value');
    }
    return t('svb.err.value');
  }

  private paramField(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    p: ParamSpec,
    hasIssue: (f: string) => boolean,
  ): TemplateResult {
    const id = `svp-${row.id}-${p.key.replace('.', '-')}`;
    const label = t(`svg.param.${p.key}` as MessageKey);
    const cur = readParam(b, p.key);
    const errKey = `${row.id}:${p.key}`;
    const commit = (v: unknown) =>
      this.patch(row, ref, b, paramPatch(b, p.key, v), `p:${b.id}:${p.key}`);
    const bad = hasIssue(`param:${p.key}`);
    const ferr = this.fieldErr[errKey] ?? null;
    switch (p.kind) {
      case 'int':
      case 'number':
        return this.field(
          id,
          label,
          this.numberInput(
            id,
            num(cur),
            (v) => commit(v),
            errKey,
            (n) => this.paramMessage(p, n),
            { placeholder: p.default !== undefined ? String(p.default) : '' },
          ),
          ferr,
          bad,
        );
      case 'bool':
        return this.field(
          id,
          label,
          html`<input
            id=${id}
            type="checkbox"
            .checked=${cur === true || (cur === undefined && p.default === true)}
            @change=${(e: Event) => commit((e.target as HTMLInputElement).checked ? true : p.default === true ? false : undefined)}
          />`,
          null,
          bad,
        );
      case 'enum':
        return this.field(
          id,
          label,
          html`<select
            id=${id}
            class="sv-in"
            data-field="param:${p.key}"
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              commit(v === p.default ? undefined : v);
            }}
          >
            ${p.options.map(
              (o) =>
                html`<option
                  value=${o}
                  ?selected=${(typeof cur === 'string' ? cur : p.default) === o}
                >
                  ${t(`svg.opt.${o}` as MessageKey)}
                </option>`,
            )}
          </select>`,
          null,
          bad,
        );
      case 'string':
        return this.field(
          id,
          label,
          html`<input
            id=${id}
            class="sv-in mono"
            data-field="param:${p.key}"
            .value=${typeof cur === 'string' ? cur : (p.default ?? '')}
            aria-invalid=${ferr || bad ? 'true' : nothing}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              const msg = this.paramMessage(p, v);
              this.setFieldErr(errKey, msg);
              if (msg === null) commit(v === '' || v === p.default ? undefined : v);
            }}
          />`,
          ferr,
          bad,
        );
      case 'color':
        return this.field(
          id,
          label,
          html`<span class="colorbox"
            ><input
              id=${id}
              type="color"
              .value=${typeof cur === 'string' ? cur : '#9e9e9e'}
              @change=${(e: Event) => commit((e.target as HTMLInputElement).value)}
            /><span class="mono">${typeof cur === 'string' ? cur : t('svb.noColor')}</span
            ><button
              type="button"
              class="ibtn sm"
              aria-label=${t('svb.clearColor')}
              ?disabled=${cur === undefined}
              @click=${() => commit(undefined)}
            >
              ${icon('x')}
            </button></span
          >`,
          null,
          bad,
        );
      case 'pivot': {
        const pv = Array.isArray(cur) ? (cur as number[]) : undefined;
        return html`<div class="field pivot ${bad ? 'bad' : ''}" role="group" aria-label=${label}>
          <span class="lbl">${label}</span>
          <span class="pgrid3">
            ${PIVOTS.map(
              ([x, y], i) =>
                html`<button
                  type="button"
                  class="pv ${pv !== undefined && pv[0] === x && pv[1] === y ? 'on' : ''}"
                  aria-pressed=${pv !== undefined && pv[0] === x && pv[1] === y ? 'true' : 'false'}
                  aria-label=${t(`svg.pivot.${i}` as MessageKey)}
                  title=${t(`svg.pivot.${i}` as MessageKey)}
                  @click=${() => commit([x, y])}
                ></button>`,
            )}
          </span>
          <span class="pxy">
            ${this.numberInput(
              `${id}-x`,
              pv?.[0],
              (v) => commit(v === undefined ? undefined : [v, pv?.[1] ?? 0.5]),
              `${errKey}:x`,
              (n) => (n < 0 || n > 1 ? t('svb.err.range', { min: 0, max: 1 }) : null),
              { placeholder: 'x' },
            )}
            ${this.numberInput(
              `${id}-y`,
              pv?.[1],
              (v) => commit(v === undefined ? undefined : [pv?.[0] ?? 0.5, v]),
              `${errKey}:y`,
              (n) => (n < 0 || n > 1 ? t('svb.err.range', { min: 0, max: 1 }) : null),
              { placeholder: 'y' },
            )}
            <button
              type="button"
              class="ibtn sm"
              aria-label=${t('svb.clearPivot')}
              ?disabled=${pv === undefined}
              @click=${() => commit(undefined)}
            >
              ${icon('x')}
            </button>
          </span>
        </div>`;
      }
    }
  }

  // ---------- Vẽ: trình soạn phép biến đổi ----------

  private transformEditor(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    tag: TagInfo,
    hasIssue: (f: string) => boolean,
  ): TemplateResult {
    const tr = b.transform;
    const setTr = (next: Transform04, key?: string) =>
      this.patch(row, ref, b, { transform: next }, key ?? `t:${b.id}`);
    const base = `svt-${row.id}`;
    switch (tr.kind) {
      case 'direct':
        return html`<p class="sv-hint">${t('svb.xf.direct')}</p>`;
      case 'linearScale': {
        const f = (k: 'inMin' | 'inMax' | 'outMin' | 'outMax', label: MessageKey) =>
          this.field(
            `${base}-${k}`,
            t(label),
            this.numberInput(
              `${base}-${k}`,
              tr[k],
              (v) => (v === undefined ? false : setTr({ ...tr, [k]: v }, `t:${b.id}:${k}`)),
              `${row.id}:${k}`,
            ),
            this.fieldErr[`${row.id}:${k}`] ?? null,
            hasIssue('transform'),
          );
        return html`<div class="pgrid">
          ${f('inMin', 'svb.xf.inMin')} ${f('inMax', 'svb.xf.inMax')}
          ${f('outMin', 'svb.xf.outMin')} ${f('outMax', 'svb.xf.outMax')}
          ${this.field(
            `${base}-clamp`,
            t('svb.xf.clamp'),
            html`<input
              id="${base}-clamp"
              type="checkbox"
              .checked=${tr.clamp !== false}
              @change=${(e: Event) => setTr({ ...tr, clamp: (e.target as HTMLInputElement).checked })}
            />`,
            null,
          )}
          <button
            type="button"
            class="btn sm"
            @click=${() => {
              const [lo, hi] = tagRange(tag);
              setTr({ ...tr, inMin: lo, inMax: hi });
            }}
          >
            ${t('svb.xf.fromTag')}
          </button>
        </div>`;
      }
      case 'valueTable': {
        const names = this.app.store.state.outline.valueTables
          .map((v) => (v.doc as { name?: string } | null)?.name)
          .filter((n): n is string => typeof n === 'string');
        const cur = tr.table ?? tag.valueTable ?? '';
        return html`<div class="pgrid">
          ${this.field(
            `${base}-table`,
            t('svb.xf.table'),
            html`<select
              id="${base}-table"
              class="sv-in"
              data-field="transform"
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                setTr({ ...tr, table: v === '' ? undefined : v } as Transform04);
              }}
            >
              <option value="" ?selected=${cur === ''}>
                ${t('svb.xf.tableDefault', { name: tag.valueTable ?? t('prop.none') })}
              </option>
              ${names.map((n) => html`<option value=${n} ?selected=${cur === n && tr.table !== undefined}>${n}</option>`)}
            </select>`,
            null,
            hasIssue('transform'),
          )}
          ${
            cur !== ''
              ? html`<button
                  type="button"
                  class="btn sm"
                  @click=${() => this.app.selectNode(`valuetable:${cur}`)}
                >
                  ${t('svb.xf.openTable')}
                </button>`
              : nothing
          }
        </div>`;
      }
      case 'discreteMap':
        return this.discreteEditor(row, ref, b, tr, tag);
      case 'rangeMap':
        return this.rangeEditor(row, ref, b, tr, hasIssue);
    }
  }

  private scalarInput(
    id: string,
    kind: OutputKind,
    value: Scalar | undefined,
    onCommit: (v: Scalar) => void,
    errKey: string,
    label: string,
  ): TemplateResult {
    const err = this.fieldErr[errKey];
    switch (kind) {
      case 'color':
        return html`<input
          id=${id}
          type="color"
          aria-label=${label}
          .value=${typeof value === 'string' ? value : '#9e9e9e'}
          @change=${(e: Event) => onCommit((e.target as HTMLInputElement).value)}
        />`;
      case 'visibility':
        return html`<select
          id=${id}
          class="sv-in"
          aria-label=${label}
          @change=${(e: Event) => onCommit((e.target as HTMLSelectElement).value)}
        >
          ${['visible', 'hidden'].map((o) => html`<option value=${o} ?selected=${value === o}>${t(`svg.opt.${o}` as MessageKey)}</option>`)}
        </select>`;
      case 'bool':
        return html`<select
          id=${id}
          class="sv-in"
          aria-label=${label}
          @change=${(e: Event) => onCommit((e.target as HTMLSelectElement).value === 'true')}
        >
          ${[true, false].map((o) => html`<option value=${String(o)} ?selected=${value === o}>${o ? t('svg.on') : t('svg.off')}</option>`)}
        </select>`;
      default:
        return html`<input
          id=${id}
          class="sv-in ${kind === 'number' ? 'num' : ''}"
          aria-label=${label}
          aria-invalid=${err ? 'true' : nothing}
          .value=${value === undefined ? '' : String(value)}
          @change=${(e: Event) => {
            const r = parseScalar((e.target as HTMLInputElement).value, kind);
            if (!r.ok)
              return this.setFieldErr(
                errKey,
                kind === 'number' ? t('svb.err.number') : t('svb.err.value'),
              );
            this.setFieldErr(errKey, null);
            onCommit(r.value);
          }}
        />`;
    }
  }

  private discreteEditor(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    tr: Extract<Transform04, { kind: 'discreteMap' }>,
    tag: TagInfo,
  ): TemplateResult {
    const out = outputKindOf(row.id);
    const bool = tagClassOf04(tag.type) === 'bool';
    const cases = tr.cases;
    const set = (next: Transform04) => this.patch(row, ref, b, { transform: next }, `t:${b.id}`);
    const base = `svd-${row.id}`;
    return html`<table class="rtab" aria-label=${t('svb.xf.discrete')}>
        <thead>
          <tr>
            <th scope="col">${t('svb.xf.equals')}</th>
            <th scope="col">${t('svb.xf.value')}</th>
            <th scope="col"><span class="sr">${t('svb.xf.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          ${cases.map(
            (c, i) =>
              html`<tr>
                <td>
                  ${
                    bool
                      ? html`<span class="mono">${String(c.equals)}</span>`
                      : html`<input
                          class="sv-in mono"
                          aria-label=${t('svb.xf.equalsN', { n: i + 1 })}
                          .value=${String(c.equals)}
                          @change=${(e: Event) => {
                            const raw = (e.target as HTMLInputElement).value;
                            const n = Number(raw);
                            const equals =
                              raw.trim() !== '' && Number.isFinite(n) && !raw.includes(',')
                                ? n
                                : raw;
                            set({
                              ...tr,
                              cases: cases.map((x, j) => (j === i ? { ...x, equals } : x)),
                            });
                          }}
                        />`
                  }
                </td>
                <td>
                  ${this.scalarInput(`${base}-v${i}`, out, c.value as Scalar, (v) => set({ ...tr, cases: cases.map((x, j) => (j === i ? { ...x, value: v } : x)) }), `${row.id}:case${i}`, t('svb.xf.valueN', { n: i + 1 }))}
                </td>
                <td>
                  ${
                    bool
                      ? nothing
                      : html`<button
                          type="button"
                          class="ibtn sm"
                          aria-label=${t('svb.xf.removeCase', { n: i + 1 })}
                          ?disabled=${cases.length <= 1}
                          @click=${() => set({ ...tr, cases: cases.filter((_, j) => j !== i) })}
                        >
                          ${icon('x')}
                        </button>`
                  }
                </td>
              </tr>`,
          )}
          <tr>
            <td><span class="muted">${t('svb.xf.default')}</span></td>
            <td>
              ${this.scalarInput(`${base}-d`, out, tr.default as Scalar | undefined, (v) => set({ ...tr, default: v }), `${row.id}:default`, t('svb.xf.default'))}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
      ${
        bool
          ? nothing
          : html`<button
              type="button"
              class="btn sm"
              @click=${() => set({ ...tr, cases: [...cases, { equals: cases.length, value: tr.default ?? 0 } as never] })}
            >
              ${icon('plus')}${t('svb.xf.addCase')}
            </button>`
      }`;
  }

  private rangeEditor(
    row: AnimationRow,
    ref: ItemRef,
    b: Binding04,
    tr: Extract<Transform04, { kind: 'rangeMap' }>,
    hasIssue: (f: string) => boolean,
  ): TemplateResult {
    const out = outputKindOf(row.id);
    const ranges = tr.ranges as RangeRow[];
    const local = new Map(checkRanges(ranges).map((x) => [x.index, x.error]));
    const set = (next: Transform04, key?: string) =>
      this.patch(row, ref, b, { transform: next }, key ?? `t:${b.id}`);
    const rows = (next: RangeRow[]) => set({ ...tr, ranges: next as never });
    const base = `svr-${row.id}`;
    const edge = (i: number, k: 'from' | 'to') => (e: Event) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const errKey = `${row.id}:${k}${i}`;
      if (raw === '') {
        this.setFieldErr(errKey, null);
        const x = { ...ranges[i]! };
        delete x[k];
        return rows(ranges.map((r, j) => (j === i ? x : r)));
      }
      const n = Number(raw);
      if (raw.includes(',') || !Number.isFinite(n))
        return this.setFieldErr(errKey, t('svb.err.number'));
      this.setFieldErr(errKey, null);
      rows(ranges.map((r, j) => (j === i ? { ...r, [k]: n } : r)));
    };
    return html`<table class="rtab" aria-label=${t('svb.xf.range')}>
        <thead>
          <tr>
            <th scope="col">${t('svb.xf.from')}</th>
            <th scope="col">${t('svb.xf.to')}</th>
            <th scope="col">${t('svb.xf.value')}</th>
            <th scope="col"><span class="sr">${t('svb.xf.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          ${ranges.map((r, i) => {
            const e = local.get(i);
            const bad = e !== undefined || hasIssue(`range:${i}`);
            const msg =
              e === 'order'
                ? t('svb.err.rangeOrder')
                : e === 'overlap'
                  ? t('svb.err.rangeOverlap')
                  : null;
            return html`<tr class=${bad ? 'bad' : ''} data-range=${i}>
                <td>
                  <input
                    class="sv-in num ${bad ? 'bad' : ''}"
                    data-field="range:${i}"
                    aria-label=${t('svb.xf.fromN', { n: i + 1 })}
                    aria-invalid=${bad ? 'true' : nothing}
                    aria-describedby=${msg ? `${base}-e${i}` : nothing}
                    .value=${r.from === undefined ? '' : String(r.from)}
                    placeholder="−∞"
                    @change=${edge(i, 'from')}
                  />
                </td>
                <td>
                  <input
                    class="sv-in num ${bad ? 'bad' : ''}"
                    aria-label=${t('svb.xf.toN', { n: i + 1 })}
                    aria-invalid=${bad ? 'true' : nothing}
                    .value=${r.to === undefined ? '' : String(r.to)}
                    placeholder="+∞"
                    @change=${edge(i, 'to')}
                  />
                </td>
                <td>
                  ${this.scalarInput(`${base}-v${i}`, out, r.value, (v) => rows(ranges.map((x, j) => (j === i ? { ...x, value: v } : x))), `${row.id}:rv${i}`, t('svb.xf.valueN', { n: i + 1 }))}
                </td>
                <td>
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label=${t('svb.xf.removeRange', { n: i + 1 })}
                    ?disabled=${ranges.length <= 1}
                    @click=${() => rows(ranges.filter((_, j) => j !== i))}
                  >
                    ${icon('x')}
                  </button>
                </td>
              </tr>
              ${
                msg
                  ? html`<tr class="rerr">
                      <td colspan="4" id="${base}-e${i}" role="alert">
                        <span class="mono">E_RANGE</span> ${msg}
                      </td>
                    </tr>`
                  : nothing
              }`;
          })}
          <tr>
            <td colspan="2"><span class="muted">${t('svb.xf.default')}</span></td>
            <td>
              ${this.scalarInput(`${base}-d`, out, tr.default as Scalar | undefined, (v) => set({ ...tr, default: v }), `${row.id}:default`, t('svb.xf.default'))}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div class="rbtns">
        <button
          type="button"
          class="btn sm"
          @click=${() => {
            const last = ranges.reduce((m, r) => Math.max(m, r.to ?? r.from ?? 0), 0);
            rows([...ranges, { from: last, value: tr.default ?? 0 }]);
          }}
        >
          ${icon('plus')}${t('svb.xf.addRange')}
        </button>
        <button type="button" class="btn sm" @click=${() => rows(sortRanges(ranges))}>
          ${t('svb.xf.sortRanges')}
        </button>
      </div>`;
  }

  // ---------- Vẽ: tổng ----------

  private suggestView(ref: ItemRef): TemplateResult | typeof nothing {
    const s = this.suggestions;
    if (s === null || s.uid !== this.primary) return nothing;
    return html`<div class="sugg" role="region" aria-label=${t('svb.suggestLabel')}>
      <div class="sugg-h">
        <b>${t('svb.suggestTitle', { tag: s.tag })}</b>
        <button type="button" class="btn sm" @click=${() => (this.suggestions = null)}>
          ${t('svb.suggestDismiss')}
        </button>
      </div>
      ${
        s.items.length === 0
          ? html`<p class="sv-hint">${t('svb.suggestNone')}</p>`
          : s.items.map(
              (x) =>
                html`<div class="sugg-r">
                  <span
                    >${t(`svg.row.${x.rowId}` as MessageKey)} —
                    ${t(`svg.suggest.${x.reason}` as MessageKey)}</span
                  >
                  <button
                    type="button"
                    class="btn sm primary"
                    @click=${() => {
                      if (acceptSuggestion(this.app, ref, this.uids, x)) {
                        this.suggestions = { ...s, items: s.items.filter((y) => y !== x) };
                        this.activeRow = x.rowId;
                      }
                    }}
                  >
                    ${t('svb.suggestAccept')}
                  </button>
                </div>`,
            )
      }
    </div>`;
  }

  private stripView(ref: ItemRef): TemplateResult | typeof nothing {
    const row =
      this.activeRow === null ? undefined : ANIMATION_ROWS.find((r) => r.id === this.activeRow);
    const b = row ? this.bindingOf(row, ref) : undefined;
    const tag = b ? this.app.screens.tagInfos().get(b.source.tagId) : undefined;
    if (b === undefined || tag === undefined) return nothing;
    const tr = b.transform;
    const range: readonly [number, number] | undefined =
      tr.kind === 'linearScale' ? [tr.inMin, tr.inMax] : undefined;
    const table = tag.valueTable ?? (tr.kind === 'valueTable' ? tr.table : undefined);
    const doc = table
      ? (this.app.store.state.outline.valueTables.find(
          (v) => (v.doc as { name?: string } | null)?.name === table,
        )?.doc as
          { entries?: Array<{ value?: number | boolean; text: string }> } | null | undefined)
      : undefined;
    const entries = doc?.entries?.flatMap((e) =>
      e.value === undefined ? [] : [{ value: e.value, text: e.text }],
    );
    return html`<mat-test-strip
      .app=${this.app}
      .tag=${tag}
      .range=${range}
      .unit=${row && rowUnit(row.id, b) !== null ? t(`ts.unit.${rowUnit(row.id, b)}` as MessageKey) : (tag.unit ?? '')}
      .entries=${entries}
    ></mat-test-strip>`;
  }

  protected override render() {
    const app = this.app;
    const ref = this.ref();
    if (ref === null || this.uids.length === 0) return nothing;
    const set = bindingSetOf(app, ref);
    const entry = elementOf(set, this.primary);
    const kind = kindOfUid(app, ref, this.primary);
    const { byElement } = groupBySvgElement(
      app.store.state.issues.filter((i) => i.file === ref.file),
      set,
    );
    const issues = byElement.get(this.primary) ?? [];
    const groupHeld = new Set((entry?.bindings ?? []).flatMap((x) => rowOfBinding(x)?.group ?? []));
    const bound = entry?.bindings?.length ?? 0;
    return html`<div class="svb" @keydown=${(e: KeyboardEvent) => this.onKey(e, ref)}>
      <div class="svb-tools">
        <button
          type="button"
          class="btn sm"
          data-act="suggest"
          aria-expanded=${this.chooser === 'suggest' ? 'true' : 'false'}
          @click=${() => this.onSuggest(ref)}
          ?disabled=${app.store.state.readOnly}
        >
          ${t('svb.suggest')}
        </button>
        <button
          type="button"
          class="btn sm"
          data-act="copy"
          ?disabled=${bound === 0}
          title=${t('svb.copyTip')}
          @click=${() => copyElementBindings(app, ref, this.primary)}
        >
          ${icon('paste')}${t('svb.copy')}
        </button>
        <button
          type="button"
          class="btn sm"
          data-act="paste"
          ?disabled=${app.screens.bindClip === null || app.store.state.readOnly}
          title=${t('svb.pasteTip')}
          @click=${() => pasteBindings(app, ref, this.uids)}
        >
          ${t('svb.paste')}
        </button>
        <span class="grow"></span>
        <span class="sv-hint">${t('svb.count', { n: bound })}</span>
      </div>
      ${
        this.uids.length > 1
          ? html`<p class="sv-hint pad" role="status">
              ${t('svb.multi', { n: this.uids.length })}
            </p>`
          : nothing
      }
      ${
        this.chooser === 'suggest'
          ? html`<div class="chooser">
              <mat-tag-chooser
                .app=${app}
                .label=${t('svb.suggestPick')}
                @choose=${(e: CustomEvent<{ id: string }>) => this.runSuggest(ref, e.detail.id)}
                @cancel=${() => (this.chooser = null)}
              ></mat-tag-chooser>
            </div>`
          : nothing
      }
      ${this.suggestView(ref)} ${this.stripView(ref)}
      <div class="brows">
        ${ROW_SECTIONS.map(
          (sec) =>
            html`<div class="bsec" role="heading" aria-level="4" data-sec=${sec.id}>
                ${t(`svg.sec.${sec.id}` as MessageKey)}
              </div>
              ${sec.rows.map((id) => this.rowView(rowById(id)!, ref, issues, kind, groupHeld))}`,
        )}
      </div>
    </div>`;
  }
}

const rowById = (id: string) => ANIMATION_ROWS.find((r) => r.id === id);

customElements.define('mat-svg-bind', MatSvgBind);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-bind': MatSvgBind;
  }
}
