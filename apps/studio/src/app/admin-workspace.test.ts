// AdminWorkspace (feature 027): ánh xạ thao tác của nhóm editor Người dùng và quyền vào API quản trị qua `device_admin`
// (đường, rev, reauth trong thân), 409 giữ bản nháp, REAUTH_REQUIRED hỏi lại mật khẩu, mật khẩu sinh/token hiện một lần,
// lỗi kênh thành mã. Thiết bị là API quản trị giả của e2e (platform/mock-admin.ts).
import { describe, expect, it, vi } from 'vitest';
import { createMockAdmin, type MockAccount } from '../platform/mock-admin.ts';
import type { DeviceLink } from '../platform/device-types.ts';
import { AdminWorkspace, type AdminGate } from './admin-workspace.ts';

const PW = 'mat-khau-quan-tri-dai';

function rig(o: { gate?: AdminGate; fail?: string } = {}) {
  const accounts = new Map<string, MockAccount>([
    ['admin', { role: 'administrator', password: PW }],
    ['vh1', { role: 'operator', password: 'x'.repeat(16) }],
  ]);
  const mock = createMockAdmin(accounts);
  const calls: Array<[string, string, Record<string, string> | undefined, unknown]> = [];
  const link = {
    admin: vi.fn(
      async (
        _id: string,
        method: 'GET' | 'POST',
        path: string,
        query?: Record<string, string>,
        body?: unknown,
      ) => {
        calls.push([method, path, query, body]);
        if (o.fail) return { error: o.fail };
        return mock.handle('admin', method, path, query, body);
      },
    ),
  } as unknown as DeviceLink;
  let gate: AdminGate = o.gate ?? 'ready';
  const toasts: string[] = [];
  const relogin = vi.fn();
  const ws = new AdminWorkspace({
    link,
    deviceId: () => 'dev-1',
    gate: () => gate,
    me: () => 'admin',
    onChange: () => undefined,
    openDialog: () => undefined,
    closeDialog: () => undefined,
    toast: (t) => toasts.push(t),
    relogin,
  });
  return { ws, mock, calls, toasts, relogin, setGate: (g: AdminGate) => (gate = g) };
}

describe('AdminWorkspace', () => {
  it('tải người dùng, nhóm, quy tắc, email, API key qua device_admin', async () => {
    const r = rig();
    await r.ws.load();
    expect(r.ws.status).toBe('ready');
    expect(r.ws.users.map((u) => u.name)).toEqual(['admin', 'vh1']);
    expect(r.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual([
      'GET /api/v1/admin/users',
      'GET /api/v1/admin/groups',
      'GET /api/v1/admin/access',
      'GET /api/v1/admin/email',
      'GET /api/v1/admin/apikeys',
    ]);
  });

  it('chưa Online: không gọi thiết bị; đổi thiết bị/Offline thì bỏ dữ liệu', async () => {
    const r = rig({ gate: 'offline' });
    r.ws.ensureLoaded();
    await r.ws.load();
    expect(r.calls).toHaveLength(0);
    r.setGate('ready');
    r.ws.sync();
    await r.ws.load();
    expect(r.ws.users).toHaveLength(2);
    r.setGate('offline');
    r.ws.sync();
    expect(r.ws.users).toHaveLength(0);
    expect(r.ws.status).toBe('idle');
  });

  it('tạo người dùng sinh mật khẩu: thân đúng hợp đồng, hộp thoại hiện mật khẩu một lần', async () => {
    const r = rig();
    await r.ws.load();
    await r.ws.createGroup('ca-a', 'Ca A');
    r.ws.openDialog({ kind: 'createUser' });
    expect(
      await r.ws.createUser({
        name: 'vh3',
        role: 'operator',
        groups: ['ca-a'],
        email: 'vh3@example.com',
        password: null,
      }),
    ).toBe(true);
    const post = r.calls.find((c) => c[0] === 'POST' && c[1] === '/api/v1/admin/users')!;
    expect(post[3]).toEqual({
      rev: 1,
      name: 'vh3',
      role: 'operator',
      groups: ['ca-a'],
      generate: true,
      email: 'vh3@example.com',
    });
    expect(r.ws.dialog?.kind).toBe('secret');
    expect(r.ws.users.find((u) => u.name === 'vh3')?.groups).toEqual(['ca-a']);
    expect(r.ws.selection.users).toBe('vh3');
  });

  it('hạ vai trò: hỏi lại mật khẩu; sai thì báo trong hộp thoại, đúng thì lưu', async () => {
    const r = rig();
    await r.ws.load();
    await r.ws.updateUser('vh1', { role: 'viewer', groups: [], enabled: true, email: '' });
    const d = r.ws.dialog;
    expect(d?.kind).toBe('reauth');
    if (d?.kind !== 'reauth') return;
    await d.run('sai-mat-khau');
    expect(r.ws.dialogError).toBe('Mật khẩu xác nhận không đúng.');
    expect(r.ws.dialog?.kind).toBe('reauth');
    await d.run(PW);
    expect(r.ws.dialog).toBeNull();
    expect(r.ws.user('vh1')?.role).toBe('viewer');
    const last = r.calls.filter((c) => c[1] === '/api/v1/admin/users/vh1').at(-1)!;
    expect(last[3]).toMatchObject({ role: 'viewer', reauth: PW });
  });

  it('409 khi lưu quy tắc: tải lại, giữ bản nháp, báo xung đột; lưu lại được', async () => {
    const r = rig();
    await r.ws.load();
    r.ws.toggleGrantee('page:alarms', 'view', 'role:operator');
    expect(r.ws.draft.count).toBe(1);
    r.mock.control.bumpRev();
    expect(await r.ws.saveRules()).toBe(false);
    expect(r.ws.conflict).toBe(true);
    expect(r.ws.draft.count).toBe(1);
    expect(await r.ws.saveRules()).toBe(true);
    expect(r.ws.draft.count).toBe(0);
    // Hàng đang mặc định (viewer) bắt đầu từ tập tương đương `*` rồi thêm người nhận được bật.
    expect(r.mock.control.rules()['page:alarms|view']).toEqual(['*', 'role:operator']);
  });

  it('API key ghi được cần reauth; token hiện một lần; thu hồi', async () => {
    const r = rig();
    await r.ws.load();
    r.ws.openDialog({ kind: 'createKey' });
    await r.ws.createKey({ name: 'MES', role: 'operator', readOnly: false }, 'sai');
    expect(r.ws.dialogError).toBe('Mật khẩu xác nhận không đúng.');
    await r.ws.createKey({ name: 'MES', role: 'operator', readOnly: false }, PW);
    expect(r.ws.dialog?.kind).toBe('secret');
    const id = r.ws.keys!.keys[0]!.id;
    expect(r.ws.keys!.keys[0]!.canWrite).toBe(true);
    await r.ws.revokeKey(id);
    expect(r.ws.keys!.keys).toHaveLength(0);
  });

  it('gửi thử email: kết quả SMTP là kết quả, không phải lỗi', async () => {
    const r = rig();
    await r.ws.load();
    expect(await r.ws.testEmail('kysu@example.com')).toEqual({
      ok: true,
      text: 'Máy chủ SMTP đã nhận thư gửi tới kysu@example.com.',
    });
    expect((await r.ws.testEmail('loi@example.com'))?.ok).toBe(false);
    expect(r.mock.control.emailTests).toEqual(['kysu@example.com', 'loi@example.com']);
  });

  it('lỗi kênh (Rust) thành mã: mạng → NETWORK, ghim sai → DEVICE_PIN_MISMATCH', async () => {
    const r = rig({ fail: 'timeout' });
    await r.ws.load();
    expect(r.ws.status).toBe('error');
    expect(r.ws.error).toBe('Không kết nối được tới thiết bị.');
    const p = rig({ fail: 'pin-mismatch' });
    await p.ws.load();
    expect(p.ws.error).toContain('DEVICE_PIN_MISMATCH');
  });
});
