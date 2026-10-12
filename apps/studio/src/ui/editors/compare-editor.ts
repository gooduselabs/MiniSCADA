// Editor So sánh (feature 005, US3, FR-029, FR-030; mockup đã duyệt openCompare): bảng đối tượng `= ≠ + -` của
// project trên máy với project đang chạy trên thiết bị, lọc theo trạng thái và loại; chọn dòng hiện khác biệt từng
// trường; "Đọc lên phần chọn" (từ engineer) lấy phần đó về project trên máy thành sửa đổi chưa lưu, hoàn tác được;
// "Nạp xuống phần khác" mở hộp thoại Nạp xuống. Viewer chỉ thấy khớp hay khác (digest công khai). Dữ liệu do
// `app.compare` (bộ tự so) ghi vào `session.compare`; logic dựng dòng ở model/compare-view.ts.
import type { DiffStatus, FieldDiff, ObjectKind } from '@mat/project-schema';
import { html, nothing } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { compareErrorText } from '../../app/compare-text.ts';
import { sessionActive } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { briefOf, compareRows, kindsOf, type CompareRow } from '../../model/compare-view.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './compare-editor.css';

const STATUSES: readonly DiffStatus[] = ['≠', '+', '-', '='];
const SYM_CLASS: Readonly<Record<DiffStatus, string>> = {
  '=': 'eq',
  '≠': 'ne',
  '+': 'add',
  '-': 'del',
};
const SYM_TEXT: Readonly<Record<DiffStatus, MessageKey>> = {
  '=': 'compare.sym.=',
  '≠': 'compare.sym.≠',
  '+': 'compare.sym.+',
  '-': 'compare.sym.-',
};
const KIND_TEXT: Readonly<Record<ObjectKind, MessageKey>> = {
  project: 'compare.kind.project',
  tag: 'compare.kind.tag',
  'logging-settings': 'compare.kind.logging-settings',
  'logging-group': 'compare.kind.logging-group',
  'logging-connection': 'compare.kind.logging-connection',
  channel: 'compare.kind.channel',
  'field-device': 'compare.kind.field-device',
  'value-table': 'compare.kind.value-table',
  'watch-table': 'compare.kind.watch-table',
  screen: 'compare.kind.screen',
  svg: 'compare.kind.svg',
  binding: 'compare.kind.binding',
};

/** Giá trị một trường để hiện: chuỗi JSON gọn, cắt ở 160 ký tự; thiếu thì gạch. */
function valueText(v: unknown): string {
  if (v === undefined) return t('compare.field.noValue');
  const s = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v));
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

const sym = (s: DiffStatus) =>
  html`<span class="cmp-sym ${SYM_CLASS[s]}" aria-hidden="true">${s}</span
    ><span class="visually-hidden">${t(SYM_TEXT[s])}</span>`;

export class MatCompareEditor extends AppElement {
  private sel: string | null = null;
  private statusFilter: DiffStatus | 'all' = 'all';
  private kindFilter: ObjectKind | 'all' = 'all';
  /** Đang lấy phần chọn từ thiết bị. */
  private taking = false;

  private get online(): boolean {
    const s = this.app.session;
    return s.mode === 'online' && s.auth !== null && sessionActive(s.state);
  }

  private get full(): boolean {
    const role = this.app.session.auth?.role;
    return role === 'engineer' || role === 'administrator';
  }

  private visibleRows(): CompareRow[] {
    const result = this.app.session.compare.info?.result;
    return result ? compareRows(result, { status: this.statusFilter, kind: this.kindFilter }) : [];
  }

  /** Dòng đang chọn: giữ lựa chọn nếu còn; chưa có thì dòng khác đầu tiên, rồi dòng đầu. */
  private current(rows: readonly CompareRow[]): CompareRow | null {
    if (!rows.length) return null;
    return rows.find((r) => r.id === this.sel) ?? rows.find((r) => r.status !== '=') ?? rows[0];
  }

  private select(rows: readonly CompareRow[], i: number, focus: boolean): void {
    const row = rows[i];
    if (!row) return;
    this.sel = row.id;
    this.requestUpdate();
    if (focus)
      void this.updateComplete.then(() =>
        this.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(row.id)}"]`)?.focus(),
      );
  }

  private onRowKey(e: KeyboardEvent, rows: readonly CompareRow[], i: number): void {
    const last = rows.length - 1;
    const next =
      e.key === 'ArrowDown'
        ? Math.min(last, i + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : e.key === 'PageDown'
                ? Math.min(last, i + 8)
                : e.key === 'PageUp'
                  ? Math.max(0, i - 8)
                  : null;
    if (next === null) return;
    e.preventDefault();
    this.select(rows, next, true);
  }

  /** Lý do "Đọc lên phần chọn" khóa; `null` khi được. */
  private takeBlock(row: CompareRow | null): MessageKey | null {
    const c = this.app.session.compare;
    if (!this.full) return 'compare.take.role';
    if (c.busy || this.taking) return 'compare.take.busy';
    if (!row) return 'compare.take.pick';
    if (row.status === '=') return 'compare.take.same';
    if (row.status === '+') return 'compare.take.local';
    return null;
  }

  private async take(row: CompareRow | null): Promise<void> {
    if (!row || this.takeBlock(row) !== null) return;
    this.taking = true;
    this.requestUpdate();
    try {
      await this.app.takeFromDevice(row);
    } finally {
      this.taking = false;
      this.requestUpdate();
    }
  }

  private header() {
    const app = this.app;
    const c = app.session.compare;
    const device = app.session.device?.name ?? '';
    const info = c.info;
    return html`<div class="ed-head">
      <h2>
        ${
          this.online
            ? t('compare.title', { project: app.projectName(), device })
            : t('compare.titleNoDevice')
        }
      </h2>
      ${
        info
          ? html`<span class="cmp-meta mono" data-role="digests"
              >${t('compare.digest', {
                local: info.localDigest.replace(/^sha256:/, '').slice(0, 8),
                device: info.deviceDigest.replace(/^sha256:/, '').slice(0, 8),
              })}</span
            >`
          : nothing
      }
      <span class="grow"></span>
      ${
        c.busy
          ? html`<span class="row" role="status" data-role="busy"
              ><span class="spin" aria-hidden="true"></span>${t('compare.busy')}</span
            >`
          : nothing
      }
    </div>`;
  }

  private tools(rows: readonly CompareRow[], all: readonly CompareRow[], cur: CompareRow | null) {
    const app = this.app;
    const result = app.session.compare.info?.result;
    const count = (s: DiffStatus) => all.filter((r) => r.status === s).length;
    const block = this.takeBlock(cur);
    const dl = app.enabled('online.download');
    const filter = (status: DiffStatus | 'all', label: string) =>
      html`<button
        class="btn"
        type="button"
        data-role=${`status-${status}`}
        aria-pressed=${this.statusFilter === status ? 'true' : 'false'}
        @click=${() => {
          this.statusFilter = status;
          this.requestUpdate();
        }}
      >
        ${label}
      </button>`;
    return html`<div class="ed-tools">
      <div
        class="cmp-filters"
        role="group"
        data-role="legend"
        aria-label=${t('compare.filter.status')}
      >
        ${filter('all', t('compare.filter.all', { n: all.length }))}
        ${STATUSES.map((s) =>
          filter(s, t('compare.filter.one', { sym: s, text: t(SYM_TEXT[s]), n: count(s) })),
        )}
      </div>
      <select
        class="select"
        data-role="kind"
        aria-label=${t('compare.filter.kind')}
        @change=${(e: Event) => {
          this.kindFilter = (e.target as HTMLSelectElement).value as ObjectKind | 'all';
          this.requestUpdate();
        }}
      >
        <option value="all" ?selected=${this.kindFilter === 'all'}>
          ${t('compare.filter.kindAll')}
        </option>
        ${(result ? kindsOf(result) : []).map(
          (k) =>
            html`<option value=${k} ?selected=${this.kindFilter === k}>${t(KIND_TEXT[k])}</option>`,
        )}
      </select>
      <span class="grow"></span>
      <button
        class="btn"
        type="button"
        data-role="refresh"
        title=${t('compare.refreshTip')}
        @click=${() => void app.compare?.refresh()}
      >
        ${icon('refresh')}${t('compare.refresh')}
      </button>
      <button
        class="btn"
        type="button"
        data-role="take"
        aria-disabled=${block ? 'true' : nothing}
        title=${block ? t(block) : t('compare.take.tip')}
        @click=${() => void this.take(cur)}
      >
        ${icon('upload')}${t('compare.take')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="download"
        aria-disabled=${dl === true ? nothing : 'true'}
        title=${dl === true ? t('compare.downloadTip') : t(dl)}
        @click=${() => dl === true && void app.run('online.download')}
      >
        ${icon('download')}${t('compare.download')}
      </button>
      <span class="visually-hidden" role="status"
        >${rows.length === 0 && all.length > 0 ? t('compare.none') : ''}</span
      >
    </div>`;
  }

  private cells(r: CompareRow): [string, string] {
    switch (r.status) {
      case '=':
        return [t('compare.cell.same'), t('compare.cell.same')];
      case '≠':
        return [t('compare.cell.has'), t('compare.cell.fields', { n: r.fieldCount })];
      case '+':
        return [t('compare.cell.has'), t('compare.cell.none')];
      case '-':
        return [t('compare.cell.none'), t('compare.cell.has')];
    }
  }

  private table(rows: readonly CompareRow[], cur: CompareRow | null) {
    if (!rows.length)
      return html`<p class="help cmp-note" data-role="none">${t('compare.none')}</p>`;
    return html`<table
      class="grid dense cmp-objects"
      role="grid"
      aria-readonly="true"
      data-table="objects"
      aria-label=${t('compare.table')}
    >
      <thead>
        <tr>
          <th scope="col">${t('compare.col.sym')}</th>
          <th scope="col">${t('compare.col.kind')}</th>
          <th scope="col">${t('compare.col.object')}</th>
          <th scope="col">${t('compare.col.local')}</th>
          <th scope="col">${t('compare.col.device')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const selected = cur?.id === r.id;
          const [local, device] = this.cells(r);
          return html`<tr
            class=${selected ? 'rsel' : ''}
            data-id=${r.id}
            data-key=${r.key}
            data-kind=${r.kind}
            data-status=${r.status}
            aria-selected=${selected ? 'true' : 'false'}
            tabindex=${selected ? 0 : -1}
            @click=${() => this.select(rows, i, false)}
            @keydown=${(e: KeyboardEvent) => this.onRowKey(e, rows, i)}
          >
            <td class="sym" title=${t(SYM_TEXT[r.status])}>${sym(r.status)}</td>
            <td>${t(KIND_TEXT[r.kind])}</td>
            <td class="key">${r.key}</td>
            <td>${local}</td>
            <td>${device}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private detail(cur: CompareRow | null) {
    if (!cur) return html`<p class="help cmp-note">${t('compare.detail.pick')}</p>`;
    const fieldRow = (f: FieldDiff) =>
      html`<tr>
        <td class="mono">${f.path || '/'}</td>
        <td class="val">${valueText(f.local)}</td>
        <td class="val">${valueText(f.device)}</td>
      </tr>`;
    const wholeFile = cur.kind !== 'project' && cur.kind !== 'tag';
    return html`<h4 class="cmp-sub" data-role="detail-title">
        ${t('compare.detail', { object: `${t(KIND_TEXT[cur.kind])} ${cur.key}` })}
      </h4>
      ${
        cur.fields.length
          ? html`<div class="cmp-frame cmp-detail">
              <table class="grid dense" data-table="fields" aria-label=${t('compare.field.table')}>
                <thead>
                  <tr>
                    <th scope="col">${t('compare.field.col')}</th>
                    <th scope="col">${t('compare.field.local')}</th>
                    <th scope="col">${t('compare.field.device')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${cur.fields.map(fieldRow)}
                </tbody>
              </table>
            </div>`
          : html`<p class="help cmp-note" data-role="detail-text">
              ${
                cur.status === '='
                  ? t('compare.detail.same')
                  : cur.status === '+'
                    ? t('compare.detail.local')
                    : t('compare.detail.device')
              }
            </p>`
      }
      ${
        wholeFile && cur.status !== '=' && cur.status !== '+'
          ? html`<p class="help cmp-note">${t('compare.detail.wholeFile', { file: cur.file })}</p>`
          : nothing
      }`;
  }

  private notOnline() {
    return html`<div class="ed ed-fill">
      ${this.header()}
      <div class="empty cmp-empty" data-role="offline">
        ${icon('compare', 'lg')}
        <b>${t('compare.titleNoDevice')}</b>
        <p>${t('compare.offline')}</p>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    if (!this.online) return this.notOnline();
    const c = app.session.compare;
    const info = c.info;
    // Viewer: chỉ khớp hay khác từ digest công khai.
    if (!this.full)
      return html`<div class="ed ed-fill">
        ${this.header()} ${c.error ? this.errorBanner(c.error) : nothing}
        ${
          info
            ? html`<div class="cmp-result ${info.same ? 'ok' : 'warn'}" data-role="brief">
                ${icon(info.same ? 'ok' : 'warn', `lg ${info.same ? 'ok' : 'warn'}`)}
                <div>
                  <b
                    >${t(briefOf(info) === 'match' ? 'compare.brief.match' : 'compare.brief.differ')}</b
                  >
                  <p>${t('compare.brief.role', { role: app.session.auth?.role ?? '' })}</p>
                </div>
              </div>`
            : nothing
        }
      </div>`;
    const result = info?.result ?? null;
    const all = result ? compareRows(result) : [];
    const rows = this.visibleRows();
    const cur = this.current(rows);
    return html`<div class="ed ed-fill">
      ${this.header()} ${this.tools(rows, all, cur)}
      ${c.error ? this.errorBanner(c.error) : nothing}
      ${
        result && info
          ? html`${
                info.same
                  ? html`<div class="cmp-result ok" data-role="same">
                      ${icon('ok', 'lg ok')}
                      <div>
                        <b>${t('compare.same')}</b>
                        <p>
                          ${t('compare.sameDetail', {
                            name: app.projectName(),
                            version: String(
                              (
                                app.store.state.outline.project as {
                                  projectVersion?: unknown;
                                } | null
                              )?.projectVersion ?? '',
                            ),
                          })}
                        </p>
                      </div>
                    </div>`
                  : info.deviceDigest === 'none'
                    ? html`<p class="help cmp-note" data-role="no-project">
                        ${t('compare.noProject')}
                      </p>`
                    : nothing
              }
              <div class="cmp-body">
                <div class="cmp-frame gridwrap">${this.table(rows, cur)}</div>
                <div>${this.detail(cur)}</div>
                <p class="help">${t('compare.saved')} ${t('compare.help')}</p>
              </div>`
          : c.busy || c.error
            ? nothing
            : html`<p class="help cmp-note">${t('compare.busy')}</p>`
      }
    </div>`;
  }

  private errorBanner(code: string) {
    return html`<div class="banner err" role="alert" data-role="error">
      ${icon('err', 'err')}
      <div>${t('compare.error', { reason: compareErrorText(code) })}</div>
    </div>`;
  }
}

customElements.define('mat-compare-editor', MatCompareEditor);

registerEditor({
  match: (id) => id === 'compare',
  render: (app: StudioApp) => html`<mat-compare-editor .app=${app}></mat-compare-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-compare-editor': MatCompareEditor;
  }
}
