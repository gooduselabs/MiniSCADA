// Thiết lập project (feature 004, US2, T062; FR-019, FR-018; mockup bản 1, renderSettings): tên, phiên
// bản, màn hình đầu (chọn từ các màn hình của project), số client tối đa (1–10) sửa được; mã project và
// runtime tối thiểu chỉ đọc; múi giờ của lưu trữ chỉ đọc (đặt trong logging.json, editor lưu trữ ở GĐ 5).
// Mỗi ô có dòng trợ giúp; lỗi của bộ kiểm tra hiện ngay tại ô (viền đỏ, lý do dưới ô, aria-describedby);
// lỗi ở trường không có ô sửa liệt kê ở đầu editor. Mỗi lần gõ là một sửa đổi của store, gộp thành một
// bước hoàn tác cho mỗi ô (khóa gộp `settings:{trường}`). Nhận vị trí lỗi bằng app.takeReveal('settings')
// và focus đúng ô.
import type { Issue } from '@mat/project-schema';
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { t, type MessageKey } from '../../i18n/index.ts';
import { parseNumber } from '../../model/grid-model.ts';
import { locate, severityOf } from '../../model/issue-map.ts';
import type { ProjectField, ScreenOutline } from '../../model/project-doc.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './tag-grid.css';

type FieldKey = ProjectField | 'projectId' | 'minRuntimeVersion';

const FIELDS: Readonly<Record<FieldKey, { label: MessageKey; help: MessageKey }>> = {
  projectName: { label: 'settings.projectName', help: 'settings.projectName.help' },
  projectId: { label: 'settings.projectId', help: 'settings.projectId.help' },
  projectVersion: { label: 'settings.projectVersion', help: 'settings.projectVersion.help' },
  entryScreen: { label: 'settings.entryScreen', help: 'settings.entryScreen.help' },
  maxClients: { label: 'settings.maxClients', help: 'settings.maxClients.help' },
  minRuntimeVersion: {
    label: 'settings.minRuntimeVersion',
    help: 'settings.minRuntimeVersion.help',
  },
};
const FORM_FIELDS: ReadonlySet<string> = new Set(Object.keys(FIELDS));

/** Múi giờ mặc định của logging.json khi không ghi (specs/003-data-logging, data-model §1). */
const DEFAULT_TIME_ZONE = '+07:00';

const asText = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const screenName = (s: ScreenOutline): string =>
  typeof s.screen?.name === 'string' && s.screen.name.trim() !== '' ? s.screen.name : s.id;

type IssuesByField = ReadonlyMap<string, readonly Issue[]>;

export class SettingsEditor extends AppElement {
  /** Sửa một trường của project.json; gõ liên tục vào cùng ô gộp thành một bước hoàn tác. */
  private edit(field: ProjectField, value: string | number): void {
    this.app.store.edit([{ kind: 'project', field, value }], `settings:${field}`);
  }

  /** Không vẽ khi đã rời document (lần vẽ còn chờ lúc đổi tab không được lấy vị trí của editor khác). */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // Nhảy tới lỗi (tab Thông tin): focus đúng ô; trường không có ô thì focus danh sách lỗi ở đầu.
    const loc = this.app.takeReveal('settings');
    if (loc?.editor !== 'settings') return;
    const target = this.querySelector<HTMLElement>(
      FORM_FIELDS.has(loc.field) ? `#set-${loc.field}` : '#set-other',
    );
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement && !target.readOnly) target.select();
    target.scrollIntoView?.({ block: 'nearest' });
  }

  /** Một ô của form: nhãn, ô nhập, lỗi tại ô (nếu có), dòng trợ giúp. */
  private field(
    key: string,
    label: MessageKey,
    help: MessageKey,
    issues: readonly Issue[] | undefined,
    control: (describedBy: string, bad: boolean) => unknown,
  ) {
    const id = `set-${key}`;
    const has = !!issues?.length;
    const bad = !!issues?.some((i) => severityOf(i) === 'error');
    const describedBy = has ? `${id}-err ${id}-help` : `${id}-help`;
    return html`<div class="field">
      <label for=${id}>${t(label)}</label>
      ${control(describedBy, bad)}
      ${
        has
          ? html`<p class=${bad ? 'err-text' : 'help'} id="${id}-err">
              ${icon(bad ? 'err' : 'warn', `sm ${bad ? 'err' : 'warn'}`)}
              ${issues!
                .map((i) => t('settings.issue', { code: i.code, message: i.message }))
                .join(' · ')}
            </p>`
          : nothing
      }
      <p class="help" id="${id}-help">${t(help)}</p>
    </div>`;
  }

  private textField(key: 'projectName' | 'projectVersion', value: string, issues: IssuesByField) {
    const spec = FIELDS[key];
    return this.field(
      key,
      spec.label,
      spec.help,
      issues.get(key),
      (describedBy, bad) =>
        html`<input
          class="input ${bad ? 'bad' : ''}"
          id="set-${key}"
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-describedby=${describedBy}
          aria-invalid=${bad ? 'true' : nothing}
          .value=${live(value)}
          @input=${(e: Event) => this.edit(key, (e.currentTarget as HTMLInputElement).value)}
        />`,
    );
  }

  private readonlyField(
    key: 'projectId' | 'minRuntimeVersion',
    value: string,
    issues: IssuesByField,
  ) {
    const spec = FIELDS[key];
    return this.field(
      key,
      spec.label,
      spec.help,
      issues.get(key),
      (describedBy, bad) =>
        html`<input
          class="input mono ${bad ? 'bad' : ''}"
          id="set-${key}"
          type="text"
          readonly
          aria-describedby=${describedBy}
          aria-invalid=${bad ? 'true' : nothing}
          .value=${live(value)}
        />`,
    );
  }

  private entryField(entry: string, screens: readonly ScreenOutline[], issues: IssuesByField) {
    const spec = FIELDS.entryScreen;
    const known = screens.some((s) => s.id === entry);
    return this.field(
      'entryScreen',
      spec.label,
      spec.help,
      issues.get('entryScreen'),
      (describedBy, bad) =>
        html`<select
          class="select ${bad ? 'bad' : ''}"
          id="set-entryScreen"
          aria-describedby=${describedBy}
          aria-invalid=${bad ? 'true' : nothing}
          @change=${(e: Event) =>
            this.edit('entryScreen', (e.currentTarget as HTMLSelectElement).value)}
        >
          ${screens.map(
            (s) =>
              html`<option value=${s.id} .selected=${live(s.id === entry)}>
                ${t('settings.entryScreen.option', { name: screenName(s), id: s.id })}
              </option>`,
          )}
          ${
            known
              ? nothing
              : html`<option value=${entry} .selected=${live(true)}>
                  ${t('settings.entryScreen.missing', { id: entry || '—' })}
                </option>`
          }
        </select>`,
    );
  }

  private clientsField(value: string, issues: IssuesByField) {
    const spec = FIELDS.maxClients;
    return this.field(
      'maxClients',
      spec.label,
      spec.help,
      issues.get('maxClients'),
      (describedBy, bad) =>
        html`<input
          class="input ${bad ? 'bad' : ''}"
          id="set-maxClients"
          type="number"
          min="1"
          max="10"
          step="1"
          inputmode="numeric"
          aria-describedby=${describedBy}
          aria-invalid=${bad ? 'true' : nothing}
          .value=${live(value)}
          @input=${(e: Event) =>
            // Không phải số (hoặc trống) thì giữ nguyên để bộ kiểm tra báo lỗi ngay tại ô (FR-023).
            this.edit('maxClients', parseNumber((e.currentTarget as HTMLInputElement).value) ?? '')}
        />`,
    );
  }

  private timeZoneField(zone: unknown) {
    const raw = typeof zone === 'string' && zone.trim() !== '' ? zone : DEFAULT_TIME_ZONE;
    const shown = /^[+-]\d{2}:\d{2}$/.test(raw)
      ? t('settings.timeZone.value', { offset: raw })
      : raw;
    return this.field(
      'timeZone',
      'settings.timeZone',
      'settings.timeZone.help',
      undefined,
      (describedBy) =>
        html`<input
          class="input mono"
          id="set-timeZone"
          type="text"
          readonly
          aria-describedby=${describedBy}
          .value=${live(shown)}
        />`,
    );
  }

  /** Lỗi ở trường của project.json không có ô sửa (screens, tagFile…): sửa bằng trình soạn thảo. */
  private otherIssues(issues: readonly Issue[]) {
    const bad = issues.some((i) => severityOf(i) === 'error');
    return html`<div class="banner se-other ${bad ? 'err' : 'warn'}" id="set-other" tabindex="-1">
      ${icon(bad ? 'err' : 'warn', bad ? 'err' : 'warn')}
      <div>
        <b>${t('settings.otherIssues')}</b>
        <ul>
          ${issues.map(
            (i) =>
              html`<li>
                <span class="mono">${i.code}</span><span class="mono">${i.path}</span>${i.message}
              </li>`,
          )}
        </ul>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const head = html`<div class="ed-head">
      <h2>${app.editorTitle('settings')}</h2>
      <span class="path">project.json</span>
    </div>`;
    const p = s.outline.project as Readonly<Record<string, unknown>> | null;
    if (!p)
      return html`<div class="ed">
        ${head}
        <div class="banner err" role="alert">
          ${icon('err', 'err')}
          <div>${t('settings.broken')}</div>
        </div>
      </div>`;
    const byField = new Map<string, Issue[]>();
    const other: Issue[] = [];
    for (const issue of s.issues) {
      if (issue.file !== 'project.json') continue;
      const loc = locate(issue, s.outline);
      if (loc.editor === 'settings' && FORM_FIELDS.has(loc.field))
        byField.set(loc.field, [...(byField.get(loc.field) ?? []), issue]);
      else other.push(issue);
    }
    const logging = s.outline.logging;
    return html`<div class="ed">
      ${head} ${other.length ? this.otherIssues(other) : nothing}
      <div class="form">
        <fieldset>
          <legend>${t('settings.general')}</legend>
          ${this.textField('projectName', asText(p.projectName), byField)}
          ${this.readonlyField('projectId', asText(p.projectId), byField)}
          ${this.textField('projectVersion', asText(p.projectVersion), byField)}
        </fieldset>
        <fieldset>
          <legend>${t('settings.runtime')}</legend>
          ${this.entryField(asText(p.entryScreen), s.outline.screens, byField)}
          ${this.clientsField(asText(p.maxClients), byField)}
          ${this.readonlyField('minRuntimeVersion', asText(p.minRuntimeVersion), byField)}
        </fieldset>
        ${
          logging
            ? html`<fieldset>
                <legend>${t('settings.logging')}</legend>
                ${this.timeZoneField(logging.timeZone)}
              </fieldset>`
            : nothing
        }
      </div>
    </div>`;
  }
}

customElements.define('mat-settings-editor', SettingsEditor);

registerEditor({
  match: (id) => id === 'settings',
  render: (app) => html`<mat-settings-editor .app=${app}></mat-settings-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-settings-editor': SettingsEditor;
  }
}
