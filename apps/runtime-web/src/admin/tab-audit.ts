// Tab Nhật ký (feature 013, US2 AC8; admin-api §5): `GET /api/v1/admin/audit` lọc theo người, loại (tiền tố hành động),
// khoảng thời gian; phân trang bằng `beforeId` (nút "Tải thêm"). Chi tiết before/after hiện dạng chữ (máy chủ không bao
// giờ đưa mật khẩu hay mã băm vào nhật ký).
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import type { AuditQuery, AuditRecord } from './api.ts';
import { fmtTime } from './model.ts';
import { button, field, h, input, pill } from './ui.ts';

const A = viAdmin.audit;
const PREFIX_HUE: Record<string, number> = { auth: 0, access: 6, account: 2, group: 4, admin: 8 };

function detailText(d: unknown): string {
  if (d === null || d === undefined) return '';
  if (typeof d !== 'object') return String(d);
  const o = d as Record<string, unknown>;
  const s = (v: unknown) => (v === null || v === undefined ? '∅' : JSON.stringify(v));
  if ('before' in o || 'after' in o) return `${s(o.before)} → ${s(o.after)}`;
  return JSON.stringify(d);
}

export class AuditTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #user: HTMLSelectElement;
  readonly #action: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #body: HTMLElement;
  readonly #more: HTMLButtonElement;
  readonly #status: HTMLElement;
  #records: AuditRecord[] = [];
  #next: number | null = null;
  #query: AuditQuery = {};
  #loaded = false;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#user = h('select');
    this.#action = h('select');
    this.#action.append(h('option', { text: A.allActions, attrs: { value: '' } }));
    for (const [p, t] of Object.entries(A.actions))
      this.#action.append(h('option', { text: t, attrs: { value: p } }));
    this.#from = input('datetime-local');
    this.#to = input('datetime-local');
    const filter = button(A.filter, () => void this.#load(), { kind: 'primary' });
    filter.setAttribute('data-filter', '');
    const form = h(
      'form',
      {
        class: 'ad-filters',
        on: {
          submit: (e) => {
            e.preventDefault();
            void this.#load();
          },
        },
      },
      field(A.user, this.#user),
      field(A.action, this.#action),
      field(A.from, this.#from),
      field(A.to, this.#to),
      filter,
    );
    const C = A.col;
    this.#body = h('tbody');
    this.#more = button(A.more, () => void this.#load(true), { kind: 'subtle' });
    this.#more.setAttribute('data-more', '');
    this.#status = h('p', { class: 'ad-hint', attrs: { role: 'status' } });
    this.el = h(
      'div',
      { class: 'ad-tabbody' },
      form,
      h(
        'div',
        // Bảng chỉ đọc, không có phần tử nhận focus: vùng cuộn tự nhận focus để cuộn bằng bàn phím (axe
        // scrollable-region-focusable).
        {
          class: 'ad-tablewrap',
          attrs: { tabindex: '0', role: 'region', 'aria-label': A.caption },
        },
        h(
          'table',
          { class: 'ad-table ad-audit' },
          h('caption', { class: 'sr-only', text: A.caption }),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...[C.ts, C.user, C.action, C.target, C.result, C.detail].map((t) =>
                h('th', { text: t, attrs: { scope: 'col' } }),
              ),
            ),
          ),
          this.#body,
        ),
      ),
      h('div', { class: 'ad-morebar' }, this.#more, this.#status),
    );
  }

  render(params: URLSearchParams): void {
    const cur = this.#user.value;
    this.#user.replaceChildren(
      h('option', { text: A.allUsers, attrs: { value: '' } }),
      ...this.#c.data.users.map((u) => h('option', { text: u.name, attrs: { value: u.name } })),
    );
    this.#user.value = params.get('u') ?? cur;
    if (!this.#loaded) void this.#load();
  }

  async #load(more = false): Promise<void> {
    if (!more) {
      const from = this.#from.value ? new Date(this.#from.value).getTime() : undefined;
      const to = this.#to.value ? new Date(this.#to.value).getTime() : undefined;
      if (from !== undefined && to !== undefined && from >= to) {
        this.#status.textContent = A.rangeBad;
        return;
      }
      this.#query = {
        ...(this.#user.value ? { user: this.#user.value } : {}),
        ...(this.#action.value ? { action: this.#action.value } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        limit: 50,
      };
    }
    try {
      const r = await this.#c.api.audit({
        ...this.#query,
        ...(more && this.#next !== null ? { beforeId: this.#next } : {}),
      });
      this.#loaded = true;
      this.#records = more ? [...this.#records, ...r.records] : r.records;
      this.#next = r.next;
      this.#renderRows();
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #renderRows(): void {
    if (!this.#records.length) {
      this.#body.replaceChildren(
        h('tr', {}, h('td', { class: 'ad-empty', text: A.empty, attrs: { colspan: '6' } })),
      );
    } else
      this.#body.replaceChildren(
        ...this.#records.map((r) => {
          const prefix = r.action.split('.')[0] ?? '';
          const tone = r.result === 'ok' ? 'ok' : r.result === 'denied' ? 'bad' : 'warn';
          const label =
            r.result === 'ok' ? A.ok : r.result === 'denied' ? A.denied : r.result || A.error;
          const detail = detailText(r.detail);
          return h(
            'tr',
            { attrs: { 'data-audit': String(r.id), 'data-action': r.action } },
            h('td', { class: 'nowrap', text: fmtTime(r.ts) }),
            h('td', { text: r.user ?? A.anon }),
            h(
              'td',
              {},
              h('span', { class: `ad-chip hue-${PREFIX_HUE[prefix] ?? 9}`, text: r.action }),
            ),
            h('td', { class: 'ad-mono', text: r.target ?? '' }),
            h('td', {}, pill(r.code ? `${label} · ${r.code}` : label, tone)),
            h('td', { class: 'ad-detail', text: detail, ...(detail ? { title: detail } : {}) }),
          );
        }),
      );
    this.#more.hidden = this.#next === null;
    this.#status.textContent = this.#next === null && this.#records.length ? A.noMore : '';
  }
}
