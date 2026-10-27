// Nhóm editor "Người dùng và quyền" của Studio (feature 027): dữ liệu quản trị của thiết bị đang Online (người dùng, nhóm,
// quy tắc quyền, email cảnh báo, API key), bản nháp quy tắc, lựa chọn của từng editor, hộp thoại đang mở và xác nhận lại
// mật khẩu. Gọi đúng API quản trị của 013/023/025 bằng `AdminApi` dùng chung với trang Quản trị web (@mat/admin-model), qua
// lệnh Tauri `device_admin` (Bearer của phiên Studio, HTTPS có ghim). Dữ liệu vẫn ở thiết bị (ADR-042): Studio không lưu gì
// vào project. Không DOM.
import {
  AdminApi,
  AdminApiError,
  RuleDraft,
  adminErrorText,
  userEditPlan,
  type AccessStore,
  type AdminGroup,
  type AdminUser,
  type ApiKeyList,
  type ApiKeySettings,
  type EffectiveAccess,
  type EmailConfig,
  type EmailSettings,
  type Level,
  type Role,
} from '@mat/admin-model';
import { t } from '../i18n/index.ts';
import { isDeviceError, type DeviceLink } from '../platform/device-types.ts';

export type AdminPage =
  'users' | 'groups' | 'pages' | 'components' | 'viewAs' | 'email' | 'apikeys';
export const ADMIN_PAGES: readonly AdminPage[] = [
  'users',
  'groups',
  'pages',
  'components',
  'viewAs',
  'email',
  'apikeys',
];
export const isAdminPage = (s: string): s is AdminPage => ADMIN_PAGES.includes(s as AdminPage);

/** `offline`: chưa Online có đăng nhập; `notAdmin`: tài khoản không phải administrator; `ready`: dùng được. */
export type AdminGate = 'offline' | 'notAdmin' | 'ready';

export type AdminDialog =
  | { kind: 'createUser' }
  | { kind: 'password'; user: string }
  | { kind: 'deleteUser'; user: string }
  | { kind: 'createGroup' }
  | { kind: 'deleteGroup'; id: string }
  | { kind: 'createKey' }
  | { kind: 'revokeKey'; id: string }
  | { kind: 'emailTest' }
  /** Mật khẩu sinh hoặc token API key: hiện đúng một lần. */
  | { kind: 'secret'; title: string; label: string; value: string; note: string }
  /** Xác nhận lại mật khẩu của chính mình rồi chạy `run(mật khẩu)`. */
  | { kind: 'reauth'; reason: string; run: (password: string) => Promise<void> };

export interface AdminSelection {
  users: string | null;
  groups: string | null;
  /** Mã tài nguyên (`screen:…`, `page:…`). */
  pages: string | null;
  /** Màn hình đang xem và item đang chọn. */
  components: { screen: string | null; item: string | null };
  apikeys: string | null;
  /** Mã quy tắc email. */
  email: string | null;
}

export interface AdminDeps {
  link: DeviceLink;
  deviceId: () => string | null;
  gate: () => AdminGate;
  /** Tên tài khoản đang đăng nhập (thao tác lên chính mình). */
  me: () => string | null;
  onChange: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  toast: (text: string) => void;
  /** 401: phiên trên thiết bị hết, mở Đăng nhập lại. */
  relogin: () => void;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 409 CONFLICT của người khác vừa đổi dữ liệu. */
const isConflict = (e: unknown) => e instanceof AdminApiError && e.code === 'CONFLICT';

export class AdminWorkspace {
  readonly api: AdminApi;
  readonly draft = new RuleDraft();
  status: LoadStatus = 'idle';
  error: string | null = null;
  /** Lần lưu vừa rồi bị 409: dữ liệu đã tải lại, bản nháp còn giữ. */
  conflict = false;
  busy = false;
  users: AdminUser[] = [];
  usersRev = 0;
  groups: AdminGroup[] = [];
  access: AccessStore | null = null;
  email: EmailSettings | null = null;
  /** Cấu hình email đang sửa (chưa lưu); `null`: chưa sửa. */
  emailDraft: EmailConfig | null = null;
  keys: ApiKeyList | null = null;
  /** Phần không có trên runtime này (404): email (023), API key (025). */
  unsupported = new Set<'email' | 'apikeys'>();
  selection: AdminSelection = {
    users: null,
    groups: null,
    pages: null,
    components: { screen: null, item: null },
    apikeys: null,
    email: null,
  };
  viewAs: { user: string | null; screen: string | null; access: EffectiveAccess | null } = {
    user: null,
    screen: null,
    access: null,
  };
  /** Quyền hiệu lực của mọi người (bảng "ai thấy, ai thao tác"); tải khi cần, bỏ khi quy tắc đổi. */
  effective: Map<string, EffectiveAccess> | null = null;
  dialog: AdminDialog | null = null;
  dialogError: string | null = null;
  private readonly d: AdminDeps;
  private device: string | null = null;
  private effectiveLoading = false;
  private pendingSecret: AdminDialog | null = null;

  constructor(deps: AdminDeps) {
    this.d = deps;
    this.draft.onChange(() => deps.onChange());
    this.api = new AdminApi({
      transport: async (method, path, body) => {
        const id = deps.deviceId();
        if (!id) throw new AdminApiError(0, 'NETWORK', {});
        const [p, qs] = path.split('?') as [string, string | undefined];
        const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
        const r = await deps.link.admin(id, method, p, query, body);
        if (isDeviceError(r)) throw new AdminApiError(0, deviceCode(r.error), { error: r.error });
        return r;
      },
      onUnauthorized: () => deps.relogin(),
    });
  }

  get gate(): AdminGate {
    return this.d.gate();
  }

  /** Gọi khi phiên đổi: đổi thiết bị hay Offline thì bỏ hết dữ liệu. */
  sync(): void {
    const id = this.gate === 'ready' ? this.d.deviceId() : null;
    if (id !== this.device) {
      this.device = id;
      this.reset();
    }
  }

  reset(): void {
    this.status = 'idle';
    this.error = null;
    this.conflict = false;
    this.users = [];
    this.groups = [];
    this.access = null;
    this.email = null;
    this.emailDraft = null;
    this.keys = null;
    this.unsupported.clear();
    this.effective = null;
    this.viewAs = { user: null, screen: null, access: null };
    this.draft.load([]);
    if (this.dialog) this.closeDialog();
  }

  /** Editor vừa hiện: tải lần đầu khi dùng được. */
  ensureLoaded(): void {
    if (this.gate === 'ready' && this.status === 'idle') void this.load();
  }

  /** Tải lại mọi thứ từ thiết bị; giữ bản nháp quy tắc khác với bản mới (`keepEdits`). */
  async load(): Promise<void> {
    if (this.gate !== 'ready') return;
    this.status = 'loading';
    this.d.onChange();
    const opt = async <T>(key: 'email' | 'apikeys', p: Promise<T>): Promise<T | null> => {
      try {
        return await p;
      } catch (e) {
        if (e instanceof AdminApiError && e.status === 404) {
          this.unsupported.add(key);
          return null;
        }
        throw e;
      }
    };
    try {
      const [u, g, a, em, k] = await Promise.all([
        this.api.users(),
        this.api.groups(),
        this.api.access(),
        opt('email', this.api.emailSettings()),
        opt('apikeys', this.api.apiKeys()),
      ]);
      this.users = u.users;
      this.usersRev = u.rev;
      this.groups = g.groups;
      this.access = a;
      this.draft.load(a.rules, true);
      this.email = em;
      this.keys = k;
      this.effective = null;
      this.status = 'ready';
      this.error = null;
    } catch (e) {
      this.status = 'error';
      this.error = this.text(e);
    }
    this.d.onChange();
  }

  text(e: unknown): string {
    return adminErrorText(e, t('admin.conflict'));
  }

  // ---------- Hộp thoại ----------

  openDialog(d: AdminDialog): void {
    this.dialog = d;
    this.dialogError = null;
    this.d.openDialog();
    this.d.onChange();
  }

  closeDialog(): void {
    this.dialog = null;
    this.dialogError = null;
    this.busy = false;
    this.d.closeDialog();
    this.d.onChange();
  }

  /**
   * Chạy một thao tác ghi: báo bận, lỗi thành câu tiếng Việt. Lỗi trong hộp thoại hiện ngay trong hộp thoại (giữ mở); 409
   * thì tải lại và báo dải xung đột; REAUTH_REQUIRED ngoài hộp thoại xác nhận thì mở hộp thoại xác nhận rồi làm lại.
   */
  private async run(
    fn: (reauth?: string) => Promise<void>,
    o: { done?: string; reauth?: string | null; inDialog?: boolean } = {},
  ): Promise<boolean> {
    if (o.reauth) {
      this.askReauth(o.reauth, (pw) => fn(pw), o.done);
      return false;
    }
    this.busy = true;
    this.dialogError = null;
    this.d.onChange();
    try {
      await fn();
      this.busy = false;
      this.conflict = false;
      if (o.inDialog) this.closeDialog();
      const secret = this.pendingSecret;
      this.pendingSecret = null;
      if (secret) this.openDialog(secret);
      if (o.done) this.d.toast(o.done);
      await this.load();
      return true;
    } catch (e) {
      this.busy = false;
      if (isConflict(e)) {
        this.conflict = true;
        if (o.inDialog) this.closeDialog();
        await this.load();
      } else if (o.inDialog) {
        this.dialogError = this.text(e);
      } else this.d.toast(this.text(e));
      this.d.onChange();
      return false;
    }
  }

  /** Hộp thoại xác nhận lại: sai mật khẩu (REAUTH_REQUIRED) thì báo trong hộp thoại, giữ mở. */
  askReauth(reason: string, fn: (pw: string) => Promise<void>, done?: string): void {
    this.openDialog({
      kind: 'reauth',
      reason,
      run: async (pw) => {
        this.busy = true;
        this.dialogError = null;
        this.d.onChange();
        try {
          await fn(pw);
          this.closeDialog();
          if (done) this.d.toast(done);
          await this.load();
        } catch (e) {
          this.busy = false;
          if (isConflict(e)) {
            this.conflict = true;
            this.closeDialog();
            await this.load();
          } else this.dialogError = this.text(e);
          this.d.onChange();
        }
      },
    });
  }

  dismissConflict(): void {
    this.conflict = false;
    this.d.onChange();
  }

  // ---------- Người dùng ----------

  select<K extends keyof AdminSelection>(key: K, value: AdminSelection[K]): void {
    this.selection = { ...this.selection, [key]: value };
    this.d.onChange();
  }

  user(name: string | null): AdminUser | null {
    return this.users.find((u) => u.name === name) ?? null;
  }

  createUser(b: {
    name: string;
    role: Role;
    groups: string[];
    email: string;
    password: string | null;
  }): Promise<boolean> {
    return this.run(
      async () => {
        const r = await this.api.createUser({
          rev: this.usersRev,
          name: b.name,
          role: b.role,
          groups: b.groups,
          ...(b.password === null ? { generate: true as const } : { password: b.password }),
          ...(b.email.trim() ? { email: b.email.trim() } : {}),
        });
        this.selection = { ...this.selection, users: b.name };
        if (r.password) this.showSecret(t('admin.secret.userTitle', { name: b.name }), r.password);
      },
      { done: t('admin.done.created', { name: b.name }), inDialog: true },
    );
  }

  private showSecret(title: string, value: string, note = t('admin.secret.note')): void {
    // Mở sau khi hộp thoại tạo/đặt lại đóng (xem `run`).
    this.pendingSecret = { kind: 'secret', title, label: t('admin.secret.label'), value, note };
  }

  /** Áp sửa đổi của Inspector (vai trò, nhóm, bật/tắt, email); hạ vai trò hoặc tắt thì hỏi mật khẩu. */
  updateUser(
    name: string,
    after: { role: Role; groups: string[]; enabled: boolean; email: string },
  ): Promise<boolean> | void {
    const before = this.user(name);
    if (!before) return;
    const plan = userEditPlan(before, after);
    if (plan.empty) return;
    const send = async (reauth?: string) => {
      const r = await this.api.updateUser(name, {
        rev: this.usersRev,
        ...plan.body,
        ...(reauth ? { reauth } : {}),
      });
      if (r.signedOut) this.d.relogin();
    };
    return this.run(send, {
      done: t('admin.done.updated', { name }),
      reauth: plan.reauth ? t('admin.reauth.user', { name }) : null,
    });
  }

  unlockUser(name: string): Promise<boolean> {
    return this.run(
      async () => void (await this.api.updateUser(name, { rev: this.usersRev, unlock: true })),
      { done: t('admin.done.unlocked', { name }) },
    );
  }

  resetPassword(name: string, password: string | null, reauth: string): Promise<boolean> {
    return this.run(
      async () => {
        const r = await this.api.resetPassword(name, {
          rev: this.usersRev,
          reauth,
          ...(password === null ? { generate: true as const } : { password }),
        });
        if (r.password) this.showSecret(t('admin.secret.userTitle', { name }), r.password);
        if (r.signedOut && name === this.d.me()) this.d.relogin();
      },
      { done: t('admin.done.password', { name }), inDialog: true },
    );
  }

  deleteUser(name: string, reauth: string): Promise<boolean> {
    return this.run(
      async () => {
        await this.api.deleteUser(name, { rev: this.usersRev, reauth });
        if (this.selection.users === name) this.selection = { ...this.selection, users: null };
      },
      { done: t('admin.done.deleted', { name }), inDialog: true },
    );
  }

  // ---------- Nhóm ----------

  get accessRev(): number {
    return this.access?.rev ?? 0;
  }

  group(id: string | null): AdminGroup | null {
    return this.groups.find((g) => g.id === id) ?? null;
  }

  createGroup(id: string, name: string): Promise<boolean> {
    return this.run(
      async () => {
        await this.api.createGroup({ rev: this.accessRev, id, name });
        this.selection = { ...this.selection, groups: id };
      },
      { done: t('admin.done.groupCreated', { name }), inDialog: true },
    );
  }

  renameGroup(id: string, name: string): Promise<boolean> {
    return this.run(
      async () => void (await this.api.renameGroup(id, { rev: this.accessRev, name })),
      { done: t('admin.done.groupRenamed', { name }) },
    );
  }

  deleteGroup(id: string, reauth: string): Promise<boolean> {
    return this.run(
      async () => {
        try {
          await this.api.deleteGroup(id, { rev: this.accessRev, reauth });
        } catch (e) {
          if (e instanceof AdminApiError && e.code === 'IN_USE') {
            const u = e.usedBy;
            throw new AdminApiError(409, 'IN_USE_TEXT', {
              message: t('admin.group.inUse', {
                users: u.users.join(', ') || '0',
                rules: u.rules.length,
              }),
            });
          }
          throw e;
        }
        if (this.selection.groups === id) this.selection = { ...this.selection, groups: null };
      },
      { done: t('admin.done.groupDeleted', { name: id }), inDialog: true },
    );
  }

  /** Thêm/bỏ một người dùng khỏi nhóm (đổi `groups` của người đó, như trang web). */
  setMember(user: string, group: string, member: boolean): Promise<boolean> | void {
    const u = this.user(user);
    if (!u) return;
    const groups = member
      ? [...new Set([...u.groups, group])]
      : u.groups.filter((g) => g !== group);
    return this.updateUser(user, {
      role: u.role,
      groups,
      enabled: u.enabled,
      email: u.email ?? '',
    });
  }

  // ---------- Quy tắc ----------

  toggleGrantee(resource: string, level: Level, grantee: string): void {
    const r = this.access?.resources.find((x) => x.id === resource);
    this.draft.toggle(resource, level, grantee, r?.defaults[level]);
  }

  resetRule(resource: string, level: Level): void {
    this.draft.set(resource, level, null);
  }

  /** Lưu bản nháp quy tắc theo lô (≤ 500 mỗi lần). 409: tải lại, giữ thay đổi chưa lưu. */
  saveRules(): Promise<boolean> {
    const all = this.draft.changes();
    if (!all.length) return Promise.resolve(true);
    return this.run(
      async () => {
        for (let i = 0; i < all.length; i += 500) {
          const r = await this.api.setAccess({ rev: this.accessRev, set: all.slice(i, i + 500) });
          if (this.access) this.access = { ...this.access, rev: r.rev };
        }
        this.draft.discard();
        this.effective = null;
      },
      { done: t('admin.done.rules', { n: all.length }) },
    );
  }

  /** Quyền hiệu lực của mọi người (bảng ai thấy, ai thao tác), một lần cho mỗi bản quy tắc. */
  loadEffective(): void {
    if (this.effective || this.effectiveLoading || this.status !== 'ready') return;
    this.effectiveLoading = true;
    void this.api
      .effectiveMany(this.users.map((u) => u.name))
      .then((m) => (this.effective = m))
      .catch(() => (this.effective = new Map()))
      .finally(() => {
        this.effectiveLoading = false;
        this.d.onChange();
      });
  }

  /** Xem với tư cách: máy chủ tính EffectiveAccess của người đó (ghi `admin.view-as`). */
  async viewAsUser(user: string | null): Promise<void> {
    this.viewAs = { ...this.viewAs, user, access: null };
    this.d.onChange();
    if (!user) return;
    try {
      const a = await this.api.effective(user);
      if (this.viewAs.user !== user) return;
      const screen =
        this.viewAs.screen && a.screens.includes(this.viewAs.screen) ? this.viewAs.screen : null;
      this.viewAs = { user, screen, access: a };
    } catch (e) {
      this.d.toast(this.text(e));
    }
    this.d.onChange();
  }

  viewAsScreen(screen: string | null): void {
    this.viewAs = { ...this.viewAs, screen };
    this.d.onChange();
  }

  // ---------- Email cảnh báo ----------

  get emailConfig(): EmailConfig | null {
    return this.emailDraft ?? this.email?.config ?? null;
  }

  editEmail(fn: (c: EmailConfig) => EmailConfig): void {
    const cur = this.emailConfig;
    if (!cur) return;
    this.emailDraft = fn(structuredClone(cur));
    this.d.onChange();
  }

  discardEmail(): void {
    this.emailDraft = null;
    this.d.onChange();
  }

  saveEmail(): Promise<boolean> {
    const cfg = this.emailDraft;
    const rev = this.email?.rev ?? 0;
    if (!cfg) return Promise.resolve(true);
    return this.run(
      async () => {
        await this.api.saveEmail(rev, cfg);
        this.emailDraft = null;
      },
      { done: t('admin.done.saved') },
    );
  }

  /** Gửi thử: kết quả hiện trong hộp thoại (lỗi SMTP cũng là kết quả, không phải lỗi API). */
  async testEmail(to: string): Promise<{ ok: boolean; text: string } | null> {
    this.busy = true;
    this.dialogError = null;
    this.d.onChange();
    try {
      const r = await this.api.testEmail(to);
      this.busy = false;
      this.d.onChange();
      return r.ok
        ? { ok: true, text: t('admin.email.testOk', { to }) }
        : {
            ok: false,
            text: t('admin.email.testFail', {
              stage: r.stage,
              message: r.message || r.error,
            }),
          };
    } catch (e) {
      this.busy = false;
      this.dialogError = this.text(e);
      this.d.onChange();
      return null;
    }
  }

  // ---------- API key ----------

  key(id: string | null) {
    return this.keys?.keys.find((k) => k.id === id) ?? null;
  }

  createKey(b: ApiKeySettings & { name: string }, reauth?: string): Promise<boolean> {
    return this.run(
      async () => {
        const r = await this.api.createApiKey({
          ...b,
          rev: this.keys?.rev ?? 0,
          ...(reauth ? { reauth } : {}),
        });
        this.selection = { ...this.selection, apikeys: r.id };
        this.showSecret(
          t('admin.secret.keyTitle', { name: b.name }),
          r.token,
          t('admin.secret.keyNote'),
        );
      },
      { done: t('admin.done.keyCreated', { name: b.name }), inDialog: true },
    );
  }

  updateKey(id: string, b: ApiKeySettings, reauthReason: string | null): Promise<boolean> {
    const send = async (reauth?: string) =>
      void (await this.api.updateApiKey(id, {
        ...b,
        rev: this.keys?.rev ?? 0,
        ...(reauth ? { reauth } : {}),
      }));
    return this.run(send, { done: t('admin.done.saved'), reauth: reauthReason });
  }

  revokeKey(id: string): Promise<boolean> {
    return this.run(
      async () => {
        await this.api.revokeApiKey(id, this.keys?.rev ?? 0);
        if (this.selection.apikeys === id) this.selection = { ...this.selection, apikeys: null };
      },
      { done: t('admin.done.keyRevoked'), inDialog: true },
    );
  }
}

/** Lỗi của lớp thiết bị (Rust) thành mã AdminApiError: mạng → NETWORK, còn lại giữ tên lỗi viết hoa. */
function deviceCode(error: string): string {
  if (error === 'unreachable' || error === 'timeout' || error === 'network') return 'NETWORK';
  return `DEVICE_${error.toUpperCase().replace(/-/g, '_')}`;
}
