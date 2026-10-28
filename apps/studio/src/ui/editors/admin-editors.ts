// Nhóm editor "Người dùng và quyền" (feature 027; docs/architecture/studio-ux.md §5 "Lưới … Người dùng"): mỗi mục là một
// editor tab `admin:<trang>`, dữ liệu của thiết bị đang Online (app.admin, @mat/admin-model dùng chung với trang Quản trị
// web), đối tượng chọn sửa ở Inspector (admin-inspector.ts), lệnh trong bảng lệnh và hộp thoại admin-dialog.ts. Chưa Online
// hoặc không phải administrator: trạng thái rõ kèm nút Online. Quyền theo component chọn item trên xem trước màn hình của
// project đang mở; digest khác project đang chạy thì báo.
import {
  PreviewHost,
  ROLES,
  ROLE_NAMES,
  defaultGrantees,
  filterScreen,
  fmtTime,
  granteeOptions,
  relativeTime,
  resourceTitle,
  type AccessResource,
  type AdminUser,
  type EmailConfig,
  type Level,
} from '@mat/admin-model';
import type { ScreenModel } from '@mat/project-schema';
import { MemoryTagSource, type MatScreen, type TagInfo as HostTagInfo } from '@mat/ui-components';
import { html, nothing, type TemplateResult } from 'lit';
import { isAdminPage, type AdminPage } from '../../app/admin-workspace.ts';
import { deviceDigestKey } from '../../app/compare.ts';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { hostTagInfo } from '../../model/preview-hosts.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './admin-editors.css';

export const PAGE_TITLE: Readonly<Record<AdminPage, MessageKey>> = {
  users: 'tree.admin.users',
  groups: 'tree.admin.groups',
  pages: 'tree.admin.pages',
  components: 'tree.admin.components',
  viewAs: 'tree.admin.viewAs',
  email: 'tree.admin.email',
  apikeys: 'tree.admin.apikeys',
};

const PAGE_ICON: Readonly<Record<AdminPage, IconName>> = {
  users: 'users',
  groups: 'group',
  pages: 'table',
  components: 'screen',
  viewAs: 'eye',
  email: 'bell',
  apikeys: 'lock',
};

/** Loại tài nguyên của Quyền theo trang (item nằm ở Quyền theo component). */
const PAGE_KINDS = ['screen', 'popup', 'page', 'history', 'report'] as const;

/** Chip người nhận ngắn gọn của một hàng (mặc định: theo vai trò của project). */
export function granteeSummary(
  app: StudioApp,
  r: AccessResource,
  level: Level,
): { text: string; dflt: boolean; dirty: boolean } {
  const a = app.admin!;
  const st = a.draft.get(r.id, level);
  if (st.grantees === null) {
    const def = r.defaults[level] ?? 'viewer';
    return {
      text: t('admin.rule.default', { role: ROLE_NAMES[def] ?? def }),
      dflt: true,
      dirty: st.dirty,
    };
  }
  if (st.grantees.length === 0)
    return { text: t('admin.rule.nobody'), dflt: false, dirty: st.dirty };
  const opts = granteeOptions(a.groups, a.users);
  const text = st.grantees.map((g) => opts.find((o) => o.id === g)?.short ?? g).join(', ');
  return { text, dflt: false, dirty: st.dirty };
}

/** Tag của project làm thông tin cho widget xem trước (đơn vị, bảng); không có giá trị, không gọi thiết bị. */
const sources = new WeakMap<object, MemoryTagSource>();
function previewSource(app: StudioApp): MemoryTagSource {
  const tags = app.store.state.outline.tags?.tags ?? [];
  let s = sources.get(tags);
  if (!s) {
    s = new MemoryTagSource({
      tags: (tags as unknown as Parameters<typeof hostTagInfo>[0][]).flatMap(
        (tg): HostTagInfo[] => {
          const i = hostTagInfo(tg);
          return i ? [i] : [];
        },
      ),
    });
    sources.set(tags, s);
  }
  return s;
}

/** Màn hình 0.3 của project đang mở (Quyền theo component, Xem với tư cách). */
export function projectScreens(app: StudioApp): { id: string; name: string; model: ScreenModel }[] {
  return app.store.state.outline.screens.flatMap((s) =>
    s.model ? [{ id: s.id, name: s.model.name || s.id, model: s.model }] : [],
  );
}

/**
 * Xem trước một màn hình của project đang mở bằng `<mat-screen>` chế độ chạy với PreviewHost (không gửi lệnh nào). Có
 * `pick`: lớp phủ một nút trong suốt đúng hộp mỗi item (bấm hoặc Tab + Enter để chọn).
 */
export class MatAdminPreview extends AppElement {
  static override properties = {
    model: { attribute: false },
    host: { attribute: false },
    selected: { attribute: false },
    pickable: { type: Boolean },
    titles: { attribute: false },
  };
  declare model: ScreenModel | null;
  declare host: PreviewHost | null;
  declare selected: string | null;
  declare pickable: boolean;
  declare titles: ReadonlyMap<string, string>;
  private boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private ro: ResizeObserver | null = null;
  private raf = 0;

  constructor() {
    super();
    this.model = null;
    this.host = null;
    this.selected = null;
    this.pickable = false;
    this.titles = new Map();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure());
    this.ro?.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
  }

  protected override updated(): void {
    this.measure();
  }

  /** Hộp của từng item trong Shadow DOM của mat-screen (sau khi vẽ xong). */
  private measure(): void {
    if (!this.pickable) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(async () => {
      const ms = this.querySelector<MatScreen>('mat-screen');
      if (!ms) return;
      await ms.updateComplete;
      await ms.whenReady().catch(() => undefined);
      const base = this.getBoundingClientRect();
      const out: typeof this.boxes = [];
      for (const it of ms.shadowRoot?.querySelectorAll<HTMLElement>('.item[data-item-id]') ?? []) {
        if (it.closest('.popup-body')) continue;
        const r = it.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out.push({
          id: it.dataset.itemId!,
          x: r.left - base.left,
          y: r.top - base.top,
          w: r.width,
          h: r.height,
        });
      }
      const key = (b: typeof out) => b.map((x) => `${x.id}:${x.x}:${x.y}:${x.w}:${x.h}`).join('|');
      if (key(out) !== key(this.boxes)) {
        this.boxes = out;
        this.requestUpdate();
      }
    });
  }

  private pick(id: string): void {
    this.dispatchEvent(new CustomEvent('admin-pick', { detail: { id }, bubbles: true }));
  }

  /** Màn hình tự do: khung đúng tỉ lệ của màn hình (co theo bề ngang); lưới: cao cố định, cuộn trong mat-screen. */
  private screenStyle(): string {
    const m = this.model;
    const grid = (m as unknown as { layout?: { mode?: string } } | null)?.layout?.mode === 'grid';
    if (!m || grid || !m.size?.width || !m.size?.height) return 'height: 560px';
    return `aspect-ratio: ${m.size.width} / ${m.size.height}`;
  }

  protected override render() {
    if (!this.model) return nothing;
    return html`<div class="adm-preview">
      <mat-screen
        .screen=${this.model}
        .tags=${previewSource(this.app)}
        .host=${this.host}
        .mode=${'run'}
        .forceMotion=${true}
        .viewport=${'auto'}
        style=${this.screenStyle()}
        aria-label=${t('admin.preview.label', { name: this.model.name || this.model.id })}
      ></mat-screen>
      ${
        this.pickable
          ? html`<div class="adm-overlay">
              ${this.boxes.map((b) => {
                const title = this.titles.get(b.id) ?? b.id;
                return html`<button
                  type="button"
                  class="adm-pick"
                  data-pick=${b.id}
                  aria-pressed=${String(b.id === this.selected)}
                  aria-label=${t('admin.comp.pick', { name: title })}
                  title=${title}
                  style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"
                  @click=${() => this.pick(b.id)}
                ></button>`;
              })}
            </div>`
          : nothing
      }
    </div>`;
  }
}
customElements.define('mat-admin-preview', MatAdminPreview);

export class MatAdminEditor extends AppElement {
  static override properties = { page: { attribute: false } };
  declare page: AdminPage;
  private search = '';
  private roleFilter = '';
  private kindFilter = '';
  private localDigest: string | null | undefined = undefined;
  private digestFor: unknown = null;
  /** Nơi chứa của xem trước: một đối tượng ổn định (mat-screen dựng lại item khi `host` đổi). */
  private readonly lockedHost = new PreviewHost({
    session: () => null,
    message: t('admin.preview.locked'),
  });
  private viewHost: { acc: unknown; host: PreviewHost } | null = null;

  constructor() {
    super();
    this.page = 'users';
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    // Một phần tử dùng cho mọi trang: đổi trang thì bỏ bộ lọc của trang trước.
    if (changed.has('page')) this.search = this.roleFilter = this.kindFilter = '';
  }

  protected override updated(): void {
    this.app.admin?.ensureLoaded();
    if (this.page === 'components' || this.page === 'viewAs') this.checkDigest();
  }

  /** Digest của project đang mở (đã lưu) so với project đang chạy; tính lại khi tài liệu đổi. */
  private checkDigest(): void {
    const docs = this.app.store.state.docs;
    if (this.digestFor === docs || !this.app.compare) return;
    this.digestFor = docs;
    void this.app.compare.localDigest().then((d) => {
      this.localDigest = d;
      this.requestUpdate();
    });
  }

  // ---------- Khung chung ----------

  private head(extra: unknown = nothing) {
    const a = this.app.admin;
    const s = this.app.session;
    return html`<div class="ed-head adm-head">
      ${icon(PAGE_ICON[this.page])}
      <h2>${t(PAGE_TITLE[this.page])}</h2>
      ${
        a?.gate === 'ready'
          ? html`<span class="chip online" data-role="device"
              >${icon('device')}${t('admin.head.device', {
                device: s.device?.name ?? '',
                user: s.auth?.user ?? '',
              })}</span
            >`
          : nothing
      }
      <span class="grow"></span>
      ${extra}
      ${
        a?.gate === 'ready'
          ? html`<button
              class="tbtn"
              type="button"
              data-role="reload"
              title=${t('cmd.admin.reload')}
              ?disabled=${a.status === 'loading'}
              @click=${() => void a.load()}
            >
              ${icon('refresh')}<span>${t('admin.reload')}</span>
            </button>`
          : nothing
      }
    </div>`;
  }

  private gate() {
    const a = this.app.admin;
    const gate = a?.gate ?? 'offline';
    const auth = this.app.session.auth;
    return html`<div class="ed ed-fill adm" data-page=${this.page}>
      ${this.head()}
      <div class="empty adm-gate" data-role="gate" data-gate=${gate}>
        ${icon(gate === 'notAdmin' ? 'lock' : 'users', 'lg')}
        <b>${t('admin.gate.title')}</b>
        <p>
          ${
            gate === 'notAdmin' && auth
              ? t('admin.gate.notAdminDetail', {
                  user: auth.user,
                  role: ROLE_NAMES[auth.role] ?? auth.role,
                })
              : t('admin.gate.offlineDetail')
          }
        </p>
        <p class="help">${t('admin.gate.where')}</p>
        <div class="row">
          ${
            gate === 'notAdmin'
              ? html`<button
                  class="btn primary"
                  type="button"
                  data-role="gate-login"
                  @click=${() => void this.app.run('online.logout')}
                >
                  ${icon('offline')}${t('admin.gate.switch')}
                </button>`
              : html`<button
                  class="btn primary"
                  type="button"
                  data-role="gate-login"
                  @click=${() =>
                    void this.app.run(
                      this.app.session.mode === 'online' ? 'online.login' : 'online.connect',
                    )}
                >
                  ${icon('online')}${t('admin.gate.online')}
                </button>`
          }
        </div>
      </div>
    </div>`;
  }

  private banners() {
    const a = this.app.admin!;
    const out: TemplateResult[] = [];
    if (a.conflict)
      out.push(
        html`<div class="banner warn adm-banner" role="alert" data-banner="conflict">
          ${icon('warn', 'warn')}
          <div>${t('admin.conflict')}</div>
          <button class="btn" type="button" @click=${() => a.dismissConflict()}>
            ${t('admin.conflict.ok')}
          </button>
        </div>`,
      );
    if (a.status === 'error')
      out.push(
        html`<div class="banner err adm-banner" role="alert" data-banner="error">
          ${icon('err', 'err')}
          <div>${t('admin.loadError', { reason: a.error ?? '' })}</div>
          <button class="btn" type="button" @click=${() => void a.load()}>
            ${t('admin.retry')}
          </button>
        </div>`,
      );
    if (a.access?.storeState === 'invalid')
      out.push(
        html`<div class="banner err adm-banner" role="alert" data-banner="store">
          ${icon('err', 'err')}
          <div>${t('admin.storeInvalid')}</div>
        </div>`,
      );
    return out;
  }

  private digestBanner() {
    const device = deviceDigestKey(this.app.session.info);
    if (this.localDigest === undefined || device === null) return nothing;
    const same = this.localDigest !== null && this.localDigest === device;
    const dirty = this.app.isDirty();
    if (same && !dirty) return nothing;
    return html`<div class="banner warn adm-banner" role="status" data-banner="digest">
      ${icon('warn', 'warn')}
      <div>${t(dirty ? 'admin.digest.dirty' : 'admin.digest.differs')}</div>
    </div>`;
  }

  private pendingBar() {
    const a = this.app.admin!;
    const n = a.draft.count;
    if (!n) return nothing;
    return html`<div class="adm-pending" role="status" data-role="pending">
      ${icon('warn', 'warn')}<span>${t('admin.pending', { n })}</span>
      <span class="grow"></span>
      <button class="btn" type="button" data-role="discard" @click=${() => a.draft.discard()}>
        ${t('admin.pending.discard')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="save-rules"
        title=${t('cmd.admin.saveRules')}
        ?disabled=${a.busy}
        @click=${() => void a.saveRules()}
      >
        ${icon('upload')}${t('admin.pending.save')}
      </button>
    </div>`;
  }

  /** Bảng có dòng chọn được (chuột, mũi tên lên/xuống, Home/End). */
  private grid(
    label: string,
    cols: string[],
    rows: { key: string; cells: unknown[] }[],
    selected: string | null,
    onSelect: (key: string) => void,
    table: string,
  ) {
    const move = (e: KeyboardEvent) => {
      const i = rows.findIndex((r) => r.key === selected);
      let j: number;
      if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1);
      else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = rows.length - 1;
      else return;
      e.preventDefault();
      const r = rows[j];
      if (!r) return;
      onSelect(r.key);
      void this.updateComplete.then(() =>
        this.querySelector<HTMLElement>(
          `[data-table="${table}"] tr[data-key="${CSS.escape(r.key)}"]`,
        )?.focus(),
      );
    };
    return html`<div class="gridwrap adm-grid">
      <table
        class="grid dense"
        role="grid"
        aria-readonly="true"
        aria-label=${label}
        data-table=${table}
      >
        <thead>
          <tr>
            ${cols.map((c) => html`<th scope="col">${c}</th>`)}
          </tr>
        </thead>
        <tbody @keydown=${move}>
          ${rows.map(
            (r) =>
              html`<tr
                data-key=${r.key}
                class=${r.key === selected ? 'rsel' : ''}
                aria-selected=${String(r.key === selected)}
                tabindex=${r.key === selected || (selected === null && r === rows[0]) ? '0' : '-1'}
                @click=${() => onSelect(r.key)}
              >
                ${r.cells.map((c) => html`<td>${c}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>
      ${rows.length ? nothing : html`<p class="help adm-note" data-role="empty">${t('admin.empty')}</p>`}
    </div>`;
  }

  // ---------- Người dùng ----------

  private usersPage() {
    const a = this.app.admin!;
    const q = this.search.trim().toLowerCase();
    const list = a.users.filter(
      (u) =>
        (!this.roleFilter || u.role === this.roleFilter) &&
        (!q || u.name.includes(q) || u.groups.some((g) => g.includes(q))),
    );
    const now = Date.now();
    const status = (u: AdminUser) =>
      !u.enabled
        ? html`<span class="chip">${t('admin.user.disabled')}</span>`
        : u.locked && u.locked.until > now
          ? html`<span class="chip warn">${icon('lock', 'warn')}${t('admin.user.locked')}</span>`
          : html`<span class="chip ok">${t('admin.user.enabled')}</span>`;
    const groupName = (id: string) => a.group(id)?.name ?? id;
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <button
          class="btn primary"
          type="button"
          data-role="add-user"
          title=${t('cmd.admin.addUser')}
          @click=${() => a.openDialog({ kind: 'createUser' })}
        >
          ${icon('plus')}${t('admin.user.add')}
        </button>
        <input
          class="input adm-search"
          type="search"
          aria-label=${t('admin.user.search')}
          placeholder=${t('admin.user.search')}
          .value=${this.search}
          @input=${(e: Event) => {
            this.search = (e.target as HTMLInputElement).value;
            this.requestUpdate();
          }}
        />
        <select
          class="select"
          aria-label=${t('admin.user.roleFilter')}
          @change=${(e: Event) => {
            this.roleFilter = (e.target as HTMLSelectElement).value;
            this.requestUpdate();
          }}
        >
          <option value="">${t('admin.user.allRoles')}</option>
          ${ROLES.map((r) => html`<option value=${r} ?selected=${this.roleFilter === r}>${ROLE_NAMES[r]}</option>`)}
        </select>
        <span class="grow"></span>
        <span class="help" data-role="count"
          >${t('admin.user.count', { n: list.length, all: a.users.length })}</span
        >
      </div>
      ${this.grid(
        t('admin.user.table'),
        [
          t('admin.col.name'),
          t('admin.col.role'),
          t('admin.col.groups'),
          t('admin.col.email'),
          t('admin.col.status'),
          t('admin.col.lastLogin'),
        ],
        list.map((u) => ({
          key: u.name,
          cells: [
            html`<span class="mono">${u.name}</span>${
                u.name === this.app.session.auth?.user
                  ? html` <span class="chip info">${t('admin.user.me')}</span>`
                  : nothing
              }`,
            html`<span class="chip role-${u.role}">${ROLE_NAMES[u.role]}</span>`,
            u.groups.length
              ? u.groups.map(groupName).join(', ')
              : html`<span class="muted">${t('admin.user.noGroup')}</span>`,
            u.email ?? html`<span class="muted">${t('admin.none')}</span>`,
            status(u),
            relativeTime(u.lastLoginAt, now),
          ],
        })),
        a.selection.users,
        (k) => a.select('users', k),
        'users',
      )}`;
  }

  // ---------- Nhóm ----------

  private groupsPage() {
    const a = this.app.admin!;
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <button
          class="btn primary"
          type="button"
          data-role="add-group"
          title=${t('cmd.admin.addGroup')}
          @click=${() => a.openDialog({ kind: 'createGroup' })}
        >
          ${icon('plus')}${t('admin.group.add')}
        </button>
        <span class="grow"></span>
        <span class="help">${t('admin.group.help')}</span>
      </div>
      ${this.grid(
        t('admin.group.table'),
        [
          t('admin.col.groupName'),
          t('admin.col.groupId'),
          t('admin.col.members'),
          t('admin.col.rules'),
        ],
        a.groups.map((g) => ({
          key: g.id,
          cells: [
            g.name,
            html`<span class="mono">${g.id}</span>`,
            g.members.length ? g.members.join(', ') : html`<span class="muted">0</span>`,
            String(g.rules),
          ],
        })),
        a.selection.groups,
        (k) => a.select('groups', k),
        'groups',
      )}`;
  }

  // ---------- Quyền theo trang ----------

  private pagesPage() {
    const a = this.app.admin!;
    const q = this.search.trim().toLowerCase();
    const list = (a.access?.resources ?? []).filter(
      (r) =>
        (PAGE_KINDS as readonly string[]).includes(r.kind) &&
        (!this.kindFilter || r.kind === this.kindFilter) &&
        (!q || r.title.toLowerCase().includes(q) || r.id.includes(q)),
    );
    const cell = (r: AccessResource, level: Level) => {
      if (!r.levels.includes(level)) return html`<span class="muted">${t('admin.none')}</span>`;
      const s = granteeSummary(this.app, r, level);
      return html`<span
        class="adm-rule ${s.dflt ? 'dflt' : ''} ${s.dirty ? 'dirty' : ''}"
        data-level=${level}
        title=${s.text}
        >${s.dirty ? html`<span class="adm-dot" aria-label=${t('admin.rule.unsaved')}></span>` : nothing}${s.text}</span
      >`;
    };
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <input
          class="input adm-search"
          type="search"
          aria-label=${t('admin.rule.search')}
          placeholder=${t('admin.rule.search')}
          .value=${this.search}
          @input=${(e: Event) => {
            this.search = (e.target as HTMLInputElement).value;
            this.requestUpdate();
          }}
        />
        <select
          class="select"
          aria-label=${t('admin.rule.kind')}
          @change=${(e: Event) => {
            this.kindFilter = (e.target as HTMLSelectElement).value;
            this.requestUpdate();
          }}
        >
          <option value="">${t('admin.rule.allKinds')}</option>
          ${PAGE_KINDS.map(
            (k) =>
              html`<option value=${k} ?selected=${this.kindFilter === k}>
                ${t(`admin.kind.${k}` as MessageKey)}
              </option>`,
          )}
        </select>
        <span class="grow"></span>
        <span class="help">${t('admin.rule.help')}</span>
      </div>
      ${this.pendingBar()}
      ${this.grid(
        t('admin.rule.table'),
        [t('admin.col.resource'), t('admin.col.kind'), t('admin.col.view'), t('admin.col.operate')],
        list.map((r) => ({
          key: r.id,
          cells: [
            html`<b>${r.title}</b> <span class="mono muted">${r.id}</span>`,
            t(`admin.kind.${r.kind}` as MessageKey),
            cell(r, 'view'),
            cell(r, 'operate'),
          ],
        })),
        a.selection.pages,
        (k) => a.select('pages', k),
        'pages',
      )}`;
  }

  // ---------- Quyền theo component ----------

  private componentsPage() {
    const a = this.app.admin!;
    const screens = projectScreens(this.app);
    if (!screens.length)
      return html`<div class="empty" data-role="no-screens">
        ${icon('screen', 'lg')}<b>${t('admin.comp.noScreens')}</b>
        <p>${t('admin.comp.noScreensHelp')}</p>
      </div>`;
    const sel = a.selection.components;
    const cur = screens.find((s) => s.id === sel.screen) ?? screens[0]!;
    const resources = a.access?.resources ?? [];
    const titles = new Map(
      cur.model.items.map((i) => [
        i.id,
        resources.find((r) => r.id === `item:${cur.id}/${i.id}`)?.title ?? i.id,
      ]),
    );
    const host = this.lockedHost;
    const rulesOn = (id: string) =>
      resources
        .filter((r) => r.kind === 'item' && r.screen === id)
        .filter((r) => r.levels.some((l) => a.draft.get(r.id, l).grantees !== null)).length;
    return html`${this.digestBanner()} ${this.pendingBar()}
      <div class="adm-split">
        <nav class="adm-list" aria-label=${t('admin.comp.screens')}>
          <div class="pane-h">${t('admin.comp.screens')}</div>
          <ul role="listbox" aria-label=${t('admin.comp.screens')}>
            ${screens.map(
              (s) =>
                html`<li
                  role="option"
                  tabindex=${s.id === cur.id ? '0' : '-1'}
                  aria-selected=${String(s.id === cur.id)}
                  data-screen=${s.id}
                  @click=${() => a.select('components', { screen: s.id, item: null })}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      a.select('components', { screen: s.id, item: null });
                    }
                  }}
                >
                  ${icon(s.model.kind === 'popup' ? 'popup' : 'screen')}<span>${s.name}</span>
                  ${rulesOn(s.id) ? html`<span class="chip info">${rulesOn(s.id)}</span>` : nothing}
                </li>`,
            )}
          </ul>
        </nav>
        <div
          class="adm-canvas"
          @admin-pick=${(e: CustomEvent<{ id: string }>) =>
            a.select('components', { screen: cur.id, item: e.detail.id })}
        >
          <p class="help adm-note">${t('admin.comp.help')}</p>
          <mat-admin-preview
            .app=${this.app}
            .model=${cur.model}
            .host=${host}
            .titles=${titles}
            .selected=${sel.screen === cur.id || sel.screen === null ? sel.item : null}
            pickable
          ></mat-admin-preview>
        </div>
      </div>`;
  }

  // ---------- Xem với tư cách ----------

  private viewAsPage() {
    const a = this.app.admin!;
    const v = a.viewAs;
    const screens = projectScreens(this.app);
    const acc = v.access;
    const visible = acc ? screens.filter((s) => acc.screens.includes(s.id)) : [];
    const cur = visible.find((s) => s.id === v.screen) ?? visible[0] ?? null;
    const u = a.user(v.user);
    if (acc && this.viewHost?.acc !== acc)
      this.viewHost = {
        acc,
        host: new PreviewHost({
          session: () => (u ? { user: u.name, role: u.role } : null),
          locked: (screen, item) => (acc.lockedItems[screen] ?? []).includes(item),
          popupDenied: (p) => !acc.admin && !acc.screens.includes(p),
          message: t('admin.preview.locked'),
        }),
      };
    const host = acc ? this.viewHost!.host : null;
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <label class="adm-inline"
          >${t('admin.viewAs.user')}
          <select
            class="select"
            data-role="view-as-user"
            @change=${(e: Event) => void a.viewAsUser((e.target as HTMLSelectElement).value || null)}
          >
            <option value="">${t('admin.viewAs.pick')}</option>
            ${a.users.map(
              (x) =>
                html`<option value=${x.name} ?selected=${v.user === x.name}>
                  ${x.name} (${ROLE_NAMES[x.role]})
                </option>`,
            )}
          </select></label
        >
        <label class="adm-inline"
          >${t('admin.viewAs.screen')}
          <select
            class="select"
            data-role="view-as-screen"
            ?disabled=${!acc}
            @change=${(e: Event) => a.viewAsScreen((e.target as HTMLSelectElement).value || null)}
          >
            ${visible.map(
              (s) => html`<option value=${s.id} ?selected=${cur?.id === s.id}>${s.name}</option>`,
            )}
          </select></label
        >
      </div>
      ${this.digestBanner()}
      ${
        acc && u
          ? html`<div class="banner adm-banner" role="status" data-banner="view-as">
              ${icon('eye')}
              <div>
                ${t('admin.viewAs.banner', { user: u.name, role: ROLE_NAMES[u.role] ?? u.role })}
                <div class="help" data-role="view-as-screens">
                  ${t('admin.viewAs.screens', {
                    list: visible.map((s) => s.name).join(', ') || t('admin.none'),
                  })}
                </div>
              </div>
            </div>`
          : html`<p class="help adm-note">${t('admin.viewAs.help')}</p>`
      }
      ${
        acc && cur
          ? html`<div class="adm-canvas solo">
              <mat-admin-preview
                .app=${this.app}
                .model=${filterScreen(cur.model, acc.admin ? [] : (acc.hiddenItems[cur.id] ?? []))}
                .host=${host}
              ></mat-admin-preview>
            </div>`
          : acc
            ? html`<div class="empty" data-role="view-as-none">
                ${icon('eyeoff', 'lg')}<b>${t('admin.viewAs.noScreen')}</b>
              </div>`
            : nothing
      }`;
  }

  // ---------- Email cảnh báo ----------

  private emailPage() {
    const a = this.app.admin!;
    if (a.unsupported.has('email'))
      return html`<div class="empty">
        ${icon('bell', 'lg')}<b>${t('admin.email.unsupported')}</b>
      </div>`;
    const s = a.email;
    const c = a.emailConfig;
    if (!s || !c) return nothing;
    const dirty = a.emailDraft !== null;
    const st = s.status;
    const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const text = (
      id: string,
      label: string,
      value: string,
      set: (v: string) => void,
      o: { type?: string; mono?: boolean; help?: string } = {},
    ) =>
      html`<div class="field">
        <label for=${id}>${label}</label>
        <input
          id=${id}
          class="input ${o.mono ? 'mono' : ''}"
          type=${o.type ?? 'text'}
          autocomplete="off"
          spellcheck="false"
          .value=${value}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        />
        ${o.help ? html`<p class="help">${o.help}</p>` : nothing}
      </div>`;
    const E = (fn: (x: EmailConfig) => void) => a.editEmail((x) => (fn(x), x));
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <label class="adm-inline"
          ><input
            type="checkbox"
            data-role="email-enabled"
            .checked=${c.enabled}
            @change=${(e: Event) => E((x) => (x.enabled = (e.target as HTMLInputElement).checked))}
          />${t('admin.email.enabled')}</label
        >
        <span class="grow"></span>
        <button
          class="btn"
          type="button"
          data-role="email-test"
          title=${t('cmd.admin.testEmail')}
          @click=${() => a.openDialog({ kind: 'emailTest' })}
        >
          ${icon('bell')}${t('admin.email.test')}
        </button>
        <button class="btn" type="button" ?disabled=${!dirty} @click=${() => a.discardEmail()}>
          ${t('admin.pending.discard')}
        </button>
        <button
          class="btn primary"
          type="button"
          data-role="email-save"
          ?disabled=${!dirty || a.busy}
          @click=${() => void a.saveEmail()}
        >
          ${icon('upload')}${t('admin.email.save')}
        </button>
      </div>
      <div class="adm-scroll" tabindex="0" role="region" aria-label=${t('tree.admin.email')}>
        <div class="adm-email">
          <section class="adm-card" aria-labelledby="adm-smtp">
            <h3 id="adm-smtp">${t('admin.email.smtp')}</h3>
            <div class="adm-form2">
              ${text('em-host', t('admin.email.host'), c.smtp.host, (v) => E((x) => (x.smtp.host = v)), { mono: true })}
              ${text('em-port', t('admin.email.port'), String(c.smtp.port), (v) => E((x) => (x.smtp.port = num(v))), { type: 'number' })}
              <div class="field">
                <label for="em-sec">${t('admin.email.security')}</label>
                <select
                  id="em-sec"
                  class="select"
                  @change=${(e: Event) =>
                    E(
                      (x) =>
                        (x.smtp.security = (e.target as HTMLSelectElement)
                          .value as typeof x.smtp.security),
                    )}
                >
                  ${(['starttls', 'smtps', 'none'] as const).map(
                    (k) =>
                      html`<option value=${k} ?selected=${c.smtp.security === k}>
                        ${t(`admin.email.sec.${k}` as MessageKey)}
                      </option>`,
                  )}
                </select>
              </div>
              ${text('em-user', t('admin.email.username'), c.smtp.username, (v) => E((x) => (x.smtp.username = v)), { mono: true })}
              ${text('em-from', t('admin.email.from'), c.smtp.from, (v) => E((x) => (x.smtp.from = v)), { type: 'email' })}
              ${text('em-fromname', t('admin.email.fromName'), c.smtp.fromName, (v) => E((x) => (x.smtp.fromName = v)))}
            </div>
            <p class="help">
              ${t('admin.email.password')}:
              <span class="chip ${s.passwordSet ? 'ok' : 'warn'}"
                >${t(s.passwordSet ? 'admin.email.pwSet' : 'admin.email.pwMissing')}</span
              >
            </p>
          </section>
          <section class="adm-card" aria-labelledby="adm-site">
            <h3 id="adm-site">${t('admin.email.site')}</h3>
            <div class="adm-form2">
              ${text('em-site', t('admin.email.siteName'), c.siteName, (v) => E((x) => (x.siteName = v)))}
              ${text('em-base', t('admin.email.baseUrl'), c.baseUrl, (v) => E((x) => (x.baseUrl = v)), { mono: true })}
              ${text('em-batch', t('admin.email.batch'), String(c.batchSeconds), (v) => E((x) => (x.batchSeconds = num(v))), { type: 'number' })}
              ${text('em-max', t('admin.email.maxPerHour'), String(c.maxPerHour), (v) => E((x) => (x.maxPerHour = num(v))), { type: 'number' })}
            </div>
          </section>
          <section class="adm-card adm-status" aria-labelledby="adm-queue">
            <h3 id="adm-queue">${t('admin.email.queue')}</h3>
            <dl class="kvs">
              <dt>${t('admin.email.q.count')}</dt>
              <dd data-role="queue-count">${st.queue.count}</dd>
              <dt>${t('admin.email.q.sent')}</dt>
              <dd>${st.sent}</dd>
              <dt>${t('admin.email.q.failed')}</dt>
              <dd>${st.failed}</dd>
              <dt>${t('admin.email.q.lastOk')}</dt>
              <dd>${st.lastOkAt ? fmtTime(st.lastOkAt) : t('admin.none')}</dd>
              <dt>${t('admin.email.q.lastError')}</dt>
              <dd>
                ${st.lastError ? `${st.lastError.stage}: ${st.lastError.message}` : t('admin.none')}
              </dd>
            </dl>
          </section>
        </div>
        <section class="adm-rules" aria-labelledby="adm-erules">
          <div class="adm-tools">
            <h3 id="adm-erules">${t('admin.email.rules')}</h3>
            <span class="grow"></span>
            <button
              class="btn"
              type="button"
              data-role="email-rule-add"
              @click=${() => {
                let id = '';
                a.editEmail((x) => {
                  for (let i = 1; ; i++)
                    if (!x.rules.some((r) => r.id === `r${i}`)) {
                      id = `r${i}`;
                      break;
                    }
                  x.rules.push({
                    id,
                    name: '',
                    enabled: true,
                    priorities: [1, 2],
                    classes: [],
                    areas: [],
                    events: ['active'],
                    reminderMin: 30,
                    to: [],
                    groups: [],
                  });
                  return x;
                });
                a.select('email', id);
              }}
            >
              ${icon('plus')}${t('admin.email.ruleAdd')}
            </button>
          </div>
          ${this.grid(
            t('admin.email.rules'),
            [
              t('admin.col.ruleName'),
              t('admin.col.priorities'),
              t('admin.col.events'),
              t('admin.col.to'),
              t('admin.col.status'),
            ],
            c.rules.map((r) => ({
              key: r.id,
              cells: [
                r.name || html`<span class="mono muted">${r.id}</span>`,
                r.priorities.join(', ') || t('admin.none'),
                r.events.map((ev) => t(`admin.email.ev.${ev}` as MessageKey)).join(', '),
                [...r.to, ...r.groups.map((g) => `@${a.group(g)?.name ?? g}`)].join(', ') ||
                  html`<span class="chip err">${t('admin.email.noTarget')}</span>`,
                r.enabled
                  ? html`<span class="chip ok">${t('admin.user.enabled')}</span>`
                  : html`<span class="chip">${t('admin.user.disabled')}</span>`,
              ],
            })),
            a.selection.email,
            (k) => a.select('email', k),
            'email-rules',
          )}
        </section>
      </div>`;
  }

  // ---------- API key ----------

  private apikeysPage() {
    const a = this.app.admin!;
    if (a.unsupported.has('apikeys'))
      return html`<div class="empty">
        ${icon('lock', 'lg')}<b>${t('admin.key.unsupported')}</b>
      </div>`;
    const l = a.keys;
    if (!l) return nothing;
    return html`<div class="adm-tools" role="toolbar" aria-label=${t('admin.tools')}>
        <button
          class="btn primary"
          type="button"
          data-role="add-key"
          title=${t('cmd.admin.addKey')}
          @click=${() => a.openDialog({ kind: 'createKey' })}
        >
          ${icon('plus')}${t('admin.key.add')}
        </button>
        <span class="grow"></span>
        <span class="help">${t('admin.key.help')}</span>
      </div>
      ${
        l.storeOk
          ? nothing
          : html`<div class="banner err adm-banner" role="alert">
              ${icon('err', 'err')}
              <div>${t('admin.key.storeBad')}</div>
            </div>`
      }
      ${this.grid(
        t('admin.key.table'),
        [
          t('admin.col.name'),
          t('admin.col.prefix'),
          t('admin.col.role'),
          t('admin.col.write'),
          t('admin.col.groups'),
          t('admin.col.expires'),
          t('admin.col.lastUsed'),
          t('admin.col.calls'),
        ],
        l.keys.map((k) => ({
          key: k.id,
          cells: [
            k.name,
            html`<span class="mono">${k.prefix}…</span>`,
            ROLE_NAMES[k.role],
            k.canWrite
              ? html`<span class="chip warn">${t('admin.key.canWrite')}</span>`
              : html`<span class="chip">${t('admin.key.readOnlyShort')}</span>`,
            k.groups.map((g) => a.group(g)?.name ?? g).join(', ') || t('admin.none'),
            k.expired
              ? html`<span class="chip err">${t('admin.key.expired')}</span>`
              : (k.expiresAt?.slice(0, 10) ?? t('admin.key.never')),
            k.lastUsedAt ? fmtTime(Date.parse(k.lastUsedAt)) : t('admin.key.unused'),
            `${k.calls} / ${k.denied}`,
          ],
        })),
        a.selection.apikeys,
        (k) => a.select('apikeys', k),
        'apikeys',
      )}`;
  }

  protected override render() {
    const a = this.app.admin;
    if (!a || a.gate !== 'ready') return this.gate();
    const body =
      a.status === 'loading' && !a.access
        ? html`<p class="row adm-note" role="status" data-role="loading">
            <span class="spin" aria-hidden="true"></span>${t('admin.loading')}
          </p>`
        : !a.access
          ? nothing
          : this.page === 'users'
            ? this.usersPage()
            : this.page === 'groups'
              ? this.groupsPage()
              : this.page === 'pages'
                ? this.pagesPage()
                : this.page === 'components'
                  ? this.componentsPage()
                  : this.page === 'viewAs'
                    ? this.viewAsPage()
                    : this.page === 'email'
                      ? this.emailPage()
                      : this.apikeysPage();
    return html`<div
      class="ed ed-fill adm"
      data-page=${this.page}
      aria-busy=${a.status === 'loading' ? 'true' : 'false'}
    >
      ${this.head()} ${this.banners()} ${body}
    </div>`;
  }
}
customElements.define('mat-admin-editor', MatAdminEditor);

registerEditor({
  match: (id) => id.startsWith('admin:') && isAdminPage(id.slice(6)),
  render: (app, id) =>
    html`<mat-admin-editor .app=${app} .page=${id.slice(6) as AdminPage}></mat-admin-editor>`,
});

/** Tiêu đề hiển thị của một tài nguyên (dùng ở Inspector). */
export const titleOf = (app: StudioApp, id: string): string =>
  resourceTitle(app.admin?.access?.resources ?? [], id);

/** Người nhận mặc định tương đương của một mức (điểm bắt đầu khi bật/tắt chip trên hàng đang mặc định). */
export const defaultsOf = (r: AccessResource, level: Level): string[] =>
  defaultGrantees(r.defaults[level]);

declare global {
  interface HTMLElementTagNameMap {
    'mat-admin-editor': MatAdminEditor;
    'mat-admin-preview': MatAdminPreview;
  }
}
