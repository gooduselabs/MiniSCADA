// Inspector › Thuộc tính của Tag (feature 004 T066, FR-006; feature 006 T126, FR-047): project 0.2 hiện MỌI thuộc tính của Tag
// theo nhóm (Chung, Nguồn Modbus, Thang đo, Giới hạn ghi, Giá trị đầu và giữ, Biểu thức, Mô phỏng) và cho sửa tại chỗ; mỗi lần
// xác nhận một trường là một bước hoàn tác qua cùng bộ kiểm của Bảng Tag (TagTable.apply). Project 0.1 giữ dạng chỉ xem của 004.
// Dưới cùng: dòng giá trị sống khi theo dõi và "Dùng ở đâu".
import type { TagDefinition } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { t, type MessageKey } from '../../i18n/index.ts';
import { cellText } from '../../model/grid-model.ts';
import {
  propertyGroups,
  tableInputs,
  tagTable,
  type PropField,
  type TagTable,
} from '../../model/tag-table.ts';
import { whereUsed, xrefLocation, xrefText } from '../../model/xref.ts';
import { AppElement, icon } from '../base.ts';
import { prow } from '../mat-inspector.ts';
import { registerProps } from '../registry.ts';
import { liveOf, qualityText } from './tag-live.ts';

const asText = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const bound = (v: unknown): string => (v === undefined || v === null || v === '' ? '…' : asText(v));

/**
 * Dòng "Giá trị sống" của inspector khi theo dõi: tự vẽ lại khi giá trị của Tag này đổi (inspector chỉ
 * vẽ lại khi app báo đổi, không theo từng giá trị).
 */
export class TagLiveRow extends AppElement {
  private tagId = '';
  private unit: unknown = undefined;
  private offValues: (() => void) | null = null;

  set tagRef(ref: { id: string; unit: unknown }) {
    if (ref.id === this.tagId && ref.unit === this.unit) return;
    this.tagId = ref.id;
    this.unit = ref.unit;
    this.requestUpdate();
  }

  protected override attached(): void {
    this.offValues = this.app.subscribeValues((tags) => {
      if (tags.includes(this.tagId)) this.requestUpdate();
    });
  }

  protected override detached(): void {
    this.offValues?.();
    this.offValues = null;
  }

  protected override render() {
    const v = liveOf(this.app, this.tagId, this.unit);
    const text =
      v.kind === 'value' && v.quality
        ? t('tagProps.liveValue', { value: v.text, quality: qualityText(v.quality) })
        : v.text;
    return prow(t('tagProps.live'), text, { mono: true });
  }
}

customElements.define('mat-tag-live', TagLiveRow);

/** Form thuộc tính của Tag đang chọn (project 0.2). */
export class MatTagProps extends AppElement {
  static override properties = { errors: { state: true } };

  declare errors: Readonly<Record<string, string>>;

  constructor() {
    super();
    this.errors = {};
  }

  private adapter(): TagTable {
    const s = this.app.store.state;
    return tagTable({
      ...tableInputs(s.outline),
      version: '0.2',
      readOnly: s.readOnly || !s.docs[s.outline.tagFile]?.editable,
    });
  }

  private row(): number | null {
    const sel = this.app.store.state.selection;
    return sel?.kind === 'tag' ? sel.row : null;
  }

  /** Xác nhận một trường: kiểm bằng adapter của Bảng Tag, lỗi hiện tại trường, đúng thì ghi MỘT sửa đổi. */
  private commit(row: number, col: string, text: string): void {
    const adapter = this.adapter();
    if (adapter.text(row, col) === text) {
      if (this.errors[col]) this.errors = { ...this.errors, [col]: '' };
      return;
    }
    const res = adapter.apply([{ row, col, text }]);
    if (res.rejected.length) {
      const reason = String(res.rejected[0].reason);
      this.errors = { ...this.errors, [col]: t(reason as MessageKey) };
      return;
    }
    this.errors = { ...this.errors, [col]: '' };
    if (res.edits.length) this.app.store.edit(res.edits);
  }

  private fieldTpl(adapter: TagTable, row: number, f: PropField, rawLabel: string) {
    const id = `tp-${f.col}`;
    const err = this.errors[f.col];
    const value = adapter.text(row, f.col);
    const editable = f.kind !== 'readonly' && adapter.editable(row, f.col);
    const label = rawLabel;
    let control;
    if (!editable) {
      control = html`<output id=${id} class="tp-ro ${f.mono ? 'mono' : ''}"
        >${value || t('prop.none')}</output
      >`;
    } else if (f.kind === 'select') {
      const opts = [...(adapter.options(row, f.col) ?? [])];
      if (value && !opts.includes(value)) opts.unshift(value);
      control = html`<select
        id=${id}
        class="select sm ${f.mono ? 'mono' : ''}"
        aria-invalid=${err ? 'true' : 'false'}
        aria-describedby=${err ? `${id}-e` : nothing}
        .value=${live(value)}
        @change=${(e: Event) => this.commit(row, f.col, (e.target as HTMLSelectElement).value)}
      >
        ${opts.map((o) => html`<option value=${o} ?selected=${o === value}>${o === '' ? t('prop.none') : o}</option>`)}
      </select>`;
    } else if (f.kind === 'multiline') {
      control = html`<textarea
        id=${id}
        class="input sm mono"
        rows="3"
        spellcheck="false"
        aria-invalid=${err ? 'true' : 'false'}
        aria-describedby=${err ? `${id}-e` : nothing}
        .value=${live(value)}
        @change=${(e: Event) => this.commit(row, f.col, (e.target as HTMLTextAreaElement).value)}
      ></textarea>`;
    } else {
      control = html`<input
        id=${id}
        class="input sm ${f.mono ? 'mono' : ''}"
        type="text"
        autocomplete="off"
        spellcheck="false"
        inputmode=${f.kind === 'number' ? 'decimal' : nothing}
        aria-invalid=${err ? 'true' : 'false'}
        aria-describedby=${err ? `${id}-e` : nothing}
        .value=${live(value)}
        @change=${(e: Event) => this.commit(row, f.col, (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
        }}
      />`;
    }
    return html`<div class="tp-field">
      <label for=${id}>${label}</label>
      ${control} ${err ? html`<p class="field-err" id="${id}-e" role="alert">${err}</p>` : nothing}
    </div>`;
  }

  protected override render() {
    const row = this.row();
    const app = this.app;
    const s = app.store.state;
    const tag =
      row === null
        ? undefined
        : (s.outline.tags?.tags[row] as unknown as Record<string, unknown> | undefined);
    if (row === null || !tag) return nothing;
    const adapter = this.adapter();
    const id = typeof tag.id === 'string' ? tag.id : '';
    const refs = id ? whereUsed(s.outline, id) : [];
    const info = adapter.addressInfo(row);
    return html`${propertyGroups(tag).map(
        (g) =>
          html`<div class="psec">${t(`tt.grp.${g.key}` as MessageKey)}</div>
            <div class="tp-group" role="group" aria-label=${t(`tt.grp.${g.key}` as MessageKey)}>
              ${g.fields.map((f) => this.fieldTpl(adapter, row, f, t(f.col.startsWith('sim') && f.col !== 'simKind' ? (`tt.simp.${f.col}` as MessageKey) : (`tt.col.${f.col}` as MessageKey))))}
              ${
                g.key === 'source' && info
                  ? html`<p class="${info.ok ? 'help' : 'field-err'}" data-role="addr-info">
                      ${
                        info.ok
                          ? t('tt.hint.address', {
                              fc: info.fc ?? '',
                              offset: info.offset ?? 0,
                              regs: info.regs ?? 0,
                            })
                          : t(info.error!)
                      }
                    </p>`
                  : nothing
              }
            </div>`,
      )}
      ${app.online() ? html`<mat-tag-live .app=${app} .tagRef=${{ id, unit: tag.unit }}></mat-tag-live>` : nothing}
      <div class="psec">
        ${icon('link')}${t('tagProps.whereUsed')} <span class="cnt">${refs.length}</span>
      </div>
      ${
        refs.length
          ? html`<ul class="xref">
              ${refs.map((e) => {
                const label = xrefText(e);
                return html`<li>
                  ${icon(e.kind === 'logging' ? 'db' : 'screen')}
                  <button
                    class="tg-xref"
                    type="button"
                    title=${t('tagProps.gotoRef', { ref: label })}
                    @click=${() => app.revealLocation(xrefLocation(e))}
                  >
                    ${label}
                  </button>
                </li>`;
              })}
            </ul>`
          : html`<p class="help pad">${t('tagProps.unused')}</p>`
      }`;
  }
}

customElements.define('mat-tag-props', MatTagProps);

registerProps((app) => {
  const s = app.store.state;
  const sel = s.selection;
  if (sel?.kind !== 'tag') return null;
  const tag = s.outline.tags?.tags[sel.row] as unknown as Record<string, unknown> | undefined;
  if (!tag || typeof tag !== 'object') return null;
  const id = typeof tag.id === 'string' ? tag.id : '';
  const name = id || t('details.unnamed');
  if (s.outline.version === '0.2')
    return {
      ctx: t('tagProps.ctx', { id: name }),
      body: html`<mat-tag-props .app=${app}></mat-tag-props>`,
    };
  // Project 0.1: dạng chỉ xem của 004.
  const old = tag as unknown as TagDefinition;
  const none = t('prop.none');
  const refs = id ? whereUsed(s.outline, id) : [];
  const range =
    old.min === undefined && old.max === undefined
      ? none
      : t('tagProps.rangeValue', { min: bound(old.min), max: bound(old.max) });
  return {
    ctx: t('tagProps.ctx', { id: name }),
    body: html`${prow(t('tagProps.name'), name, { mono: true })}
      ${prow(t('tagProps.type'), asText(old.type) || none)}
      ${prow(t('tagProps.source'), cellText(old, 'source') || none)}
      ${prow(t('tagProps.unit'), asText(old.unit) || none)} ${prow(t('tagProps.range'), range)}
      ${prow(t('tagProps.description'), asText(old.description) || none)}
      ${app.online() ? html`<mat-tag-live .app=${app} .tagRef=${{ id, unit: old.unit }}></mat-tag-live>` : nothing}
      <div class="psec">
        ${icon('link')}${t('tagProps.whereUsed')} <span class="cnt">${refs.length}</span>
      </div>
      ${
        refs.length
          ? html`<ul class="xref">
              ${refs.map((e) => {
                const label = xrefText(e);
                return html`<li>
                  ${icon(e.kind === 'logging' ? 'db' : 'screen')}
                  <button
                    class="tg-xref"
                    type="button"
                    title=${t('tagProps.gotoRef', { ref: label })}
                    @click=${() => app.revealLocation(xrefLocation(e))}
                  >
                    ${label}
                  </button>
                </li>`;
              })}
            </ul>`
          : html`<p class="help pad">${t('tagProps.unused')}</p>`
      }`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-tag-props': MatTagProps;
    'mat-tag-live': TagLiveRow;
  }
}
