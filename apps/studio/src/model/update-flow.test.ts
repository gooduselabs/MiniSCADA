// Luồng "Cập nhật runtime" (OTA, feature 011, T110; FR-068; contracts/device-api-011.md §3, §5): chỉ administrator và thiết
// bị báo `update.supported`; tải gói có tiến trình; xem kế hoạch; xác nhận kèm mật khẩu (không giữ mật khẩu); theo dõi qua
// nối lại tới một trong ba kết quả (committed, rolled-back, mất kết nối quá 120 s); "Quay về bản trước".
import { describe, expect, it } from 'vitest';
import type { ApiResult, DeployEvent, DeviceError } from '../platform/device-types.ts';
import {
  LOST_AFTER_MS,
  UpdateFlow,
  parsePlan,
  parseStatus,
  updateAccess,
  updateErrorCode,
  type UpdateLink,
} from './update-flow.ts';

const UID = 'upd_0123456789abcdef';
const PLAN = {
  from: '1.0.0',
  to: '1.0.1',
  releaseSeq: 12,
  signer: { keyId: 'sha256:ab12cd34', label: 'release-primary' },
  projectCompatible: true,
  estimatedDowntimeS: 25,
  restartRequired: true,
  notes: 'Sửa lỗi Modbus',
  kind: 'runtime',
};
const LAST_OLD = {
  updateId: 'upd_ffffffffffffffff',
  result: 'committed',
  from: '0.9.0',
  to: '1.0.0',
  finishedAt: '2026-10-01T01:00:00Z',
  reason: '',
};

function status(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    state: 'idle',
    updateId: null,
    plan: null,
    step: null,
    startedAt: null,
    last: LAST_OLD,
    previous: { version: '0.9.0', available: true },
    ...patch,
  };
}

const ok = (status: number, body: unknown): ApiResult => ({ status, body });
const refused = (code: string, detail: unknown = null): DeviceError => ({
  error: 'update',
  detail: { code, detail },
});

/** DeviceLink giả của OTA: các lần hỏi trạng thái trả lần lượt `statuses` (phần tử cuối lặp lại). */
function fake(statuses: Array<Record<string, unknown> | DeviceError> = [status()]) {
  const calls: Array<{ cmd: string; args: unknown[] }> = [];
  const queue = [...statuses];
  let uploadResult: ApiResult | DeviceError = ok(201, {
    updateId: UID,
    state: 'verified',
    plan: PLAN,
  });
  let applyResult: ApiResult | DeviceError = ok(202, { state: 'applying' });
  let rollbackResult: ApiResult | DeviceError = ok(202, { state: 'applying' });
  let pickResult: unknown = { fileId: 'f1', name: 'mat-runtime-1.0.1.matupdate', size: 3_000_000 };
  const link: UpdateLink = {
    async updatePick() {
      calls.push({ cmd: 'pick', args: [] });
      return pickResult as never;
    },
    async updateUpload(id, fileId, onEvent: (e: DeployEvent) => void) {
      calls.push({ cmd: 'upload', args: [id, fileId] });
      onEvent({ kind: 'send', sent: 1_000_000, total: 3_000_000 });
      onEvent({ kind: 'send', sent: 3_000_000, total: 3_000_000 });
      return uploadResult;
    },
    async updateStatus(id) {
      calls.push({ cmd: 'status', args: [id] });
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return 'error' in next && typeof next.error === 'string' && !('state' in next)
        ? (next as DeviceError)
        : ok(200, next);
    },
    async updateApply(id, updateId, password) {
      calls.push({ cmd: 'apply', args: [id, updateId, password] });
      return applyResult;
    },
    async updateCancel(id, updateId) {
      calls.push({ cmd: 'cancel', args: [id, updateId] });
      return ok(200, { state: 'idle' });
    },
    async updateRollback(id, password) {
      calls.push({ cmd: 'rollback', args: [id, password] });
      return rollbackResult;
    },
  };
  return {
    link,
    calls,
    setUpload: (r: ApiResult | DeviceError) => (uploadResult = r),
    setApply: (r: ApiResult | DeviceError) => (applyResult = r),
    setRollback: (r: ApiResult | DeviceError) => (rollbackResult = r),
    setPick: (r: unknown) => (pickResult = r),
    push: (...s: Array<Record<string, unknown> | DeviceError>) => queue.push(...s),
  };
}

/** Luồng với đồng hồ giả: `sleep` chỉ cộng thời gian. */
function flowOf(f: ReturnType<typeof fake>) {
  let clock = 1_000_000;
  let changes = 0;
  const phases: string[] = [];
  const flow: UpdateFlow = new UpdateFlow({
    link: f.link,
    deviceId: 'dev-1',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 2000,
    onChange: () => {
      changes++;
      const ph = flow.following?.phase;
      if (ph && phases[phases.length - 1] !== ph) phases.push(ph);
    },
  });
  return { flow, now: () => clock, changes: () => changes, phases };
}

const statusCalls = (f: ReturnType<typeof fake>) =>
  f.calls.filter((c) => c.cmd === 'status').length;

/** Tới bước kế hoạch: tải trạng thái, chọn file, tải lên. */
async function toPlan(f: ReturnType<typeof fake>) {
  const env = flowOf(f);
  await env.flow.load();
  await env.flow.pick();
  await env.flow.upload();
  return env;
}

describe('updateAccess: ai thấy chức năng', () => {
  const info = (update: unknown) => ({ runtimeVersion: '1.0.0', update });
  const admin = { role: 'administrator' as const };
  it('administrator và thiết bị báo update.supported, enabled: bật', () => {
    expect(updateAccess(info({ enabled: true, supported: true }), admin)).toBe('enabled');
  });
  it('OTA đang tắt trên thiết bị: hiện nhưng khóa', () => {
    expect(updateAccess(info({ enabled: false, supported: true }), admin)).toBe('disabled');
  });
  it('không phải administrator: ẩn', () => {
    for (const role of ['viewer', 'operator', 'engineer'] as const)
      expect(updateAccess(info({ enabled: true, supported: true }), { role })).toBe('hidden');
    expect(updateAccess(info({ enabled: true, supported: true }), null)).toBe('hidden');
  });
  it('thiết bị cũ (không có khóa update trong system/info) hay chưa có system/info: ẩn', () => {
    expect(updateAccess({ runtimeVersion: '0.9.0' }, admin)).toBe('hidden');
    expect(updateAccess(null, admin)).toBe('hidden');
    expect(updateAccess(info({ enabled: true, supported: false }), admin)).toBe('hidden');
  });
});

describe('đọc phản hồi của thiết bị', () => {
  it('parsePlan giữ các trường của contract', () => {
    expect(parsePlan(PLAN)).toEqual(PLAN);
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan({ from: 1 })).toBeNull();
    // Trường tùy chọn thiếu: giá trị trung tính.
    expect(parsePlan({ from: '1.0.0', to: '1.0.1' })).toEqual({
      from: '1.0.0',
      to: '1.0.1',
      releaseSeq: null,
      signer: { keyId: '', label: '' },
      projectCompatible: false,
      estimatedDowntimeS: null,
      restartRequired: true,
      notes: '',
      kind: 'runtime',
    });
  });
  it('parseStatus', () => {
    const s = parseStatus(status({ state: 'verified', updateId: UID, plan: PLAN }))!;
    expect(s.state).toBe('verified');
    expect(s.updateId).toBe(UID);
    expect(s.plan?.to).toBe('1.0.1');
    expect(s.last?.to).toBe('1.0.0');
    expect(s.previous).toEqual({ version: '0.9.0', available: true });
    expect(parseStatus('x')).toBeNull();
    expect(parseStatus({ state: 3 })).toBeNull();
  });
  it('updateErrorCode lấy mã thiết bị của lỗi OTA', () => {
    expect(updateErrorCode(refused('UPDATE_DOWNGRADE'))).toBe('UPDATE_DOWNGRADE');
    expect(updateErrorCode({ error: 'forbidden' })).toBeNull();
  });
});

describe('UpdateFlow', () => {
  it('mở: không có gói chờ thì ở bước chọn file, biết bản trước', async () => {
    const f = fake();
    const { flow } = flowOf(f);
    expect(flow.step).toBe('loading');
    await flow.load();
    expect(flow.step).toBe('pick');
    expect(flow.previous).toEqual({ version: '0.9.0', available: true });
  });

  it('mở khi đã có gói verified (lần trước chưa áp dụng): vào thẳng bước kế hoạch', async () => {
    const f = fake([status({ state: 'verified', updateId: UID, plan: PLAN })]);
    const { flow } = flowOf(f);
    await flow.load();
    expect(flow.step).toBe('plan');
    expect(flow.updateId).toBe(UID);
    expect(flow.plan?.to).toBe('1.0.1');
  });

  it('OTA tắt trên thiết bị (404 UPDATE_DISABLED): ở bước chọn file kèm lỗi', async () => {
    const f = fake([refused('UPDATE_DISABLED')]);
    const { flow } = flowOf(f);
    await flow.load();
    expect(flow.step).toBe('pick');
    expect(updateErrorCode(flow.error!)).toBe('UPDATE_DISABLED');
  });

  it('chọn file: hủy hộp thoại thì không đổi; chọn xong thì có tên và cỡ', async () => {
    const f = fake();
    const { flow } = flowOf(f);
    await flow.load();
    f.setPick(null);
    await flow.pick();
    expect(flow.file).toBeNull();
    f.setPick({ fileId: 'f1', name: 'mat-runtime-1.0.1.matupdate', size: 3_000_000 });
    await flow.pick();
    expect(flow.file).toEqual({
      fileId: 'f1',
      name: 'mat-runtime-1.0.1.matupdate',
      size: 3_000_000,
    });
  });

  it('chưa chọn file thì không tải lên', async () => {
    const f = fake();
    const { flow } = flowOf(f);
    await flow.load();
    await flow.upload();
    expect(f.calls.some((c) => c.cmd === 'upload')).toBe(false);
  });

  it('tải lên có tiến trình rồi tới bước kế hoạch', async () => {
    const f = fake();
    const seen: Array<{ sent: number; total: number } | null> = [];
    const env = flowOf(f);
    await env.flow.load();
    await env.flow.pick();
    const p = env.flow.upload();
    expect(env.flow.step).toBe('uploading');
    seen.push(env.flow.progress);
    await p;
    expect(f.calls.find((c) => c.cmd === 'upload')!.args).toEqual(['dev-1', 'f1']);
    expect(env.flow.progress).toEqual({ sent: 3_000_000, total: 3_000_000 });
    expect(env.flow.step).toBe('plan');
    expect(env.flow.updateId).toBe(UID);
    expect(env.flow.plan).toEqual(PLAN);
    expect(env.changes()).toBeGreaterThan(2);
  });

  it('thiết bị từ chối gói: về bước chọn file, giữ mã lỗi và detail', async () => {
    const f = fake();
    f.setUpload(refused('UPDATE_PACKAGE_INVALID', { code: 'E_UPD_HASH' }));
    const { flow } = await toPlan(f);
    expect(flow.step).toBe('pick');
    expect(flow.error).toEqual(refused('UPDATE_PACKAGE_INVALID', { code: 'E_UPD_HASH' }));
    expect(flow.plan).toBeNull();
  });

  it('áp dụng: gửi mật khẩu một lần, không giữ lại; theo dõi qua lúc chạy lại tới committed', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push(
      status({ state: 'applying', updateId: UID, plan: PLAN, step: 'switching' }),
      { error: 'unreachable' },
      { error: 'timeout' },
      { error: 'http', detail: 503 },
      status({
        state: 'committed',
        updateId: UID,
        last: { ...LAST_OLD, updateId: UID, from: '1.0.0', to: '1.0.1', result: 'committed' },
        previous: { version: '1.0.0', available: true },
      }),
    );
    const secret = 'mật-khẩu-thử-không-lưu';
    await env.flow.apply(secret);
    const apply = f.calls.filter((c) => c.cmd === 'apply');
    expect(apply).toHaveLength(1);
    expect(apply[0]!.args).toEqual(['dev-1', UID, secret]);
    expect(env.flow.step).toBe('result');
    expect(env.flow.result).toMatchObject({
      mode: 'update',
      outcome: 'committed',
      version: '1.0.1',
      from: '1.0.0',
    });
    // Mật khẩu không nằm trong trạng thái của luồng.
    const dump = JSON.stringify({ ...env.flow, link: undefined });
    expect(dump).not.toContain(secret);
    expect(env.flow.previous).toEqual({ version: '1.0.0', available: true });
  });

  it('đang theo dõi: pha "đang áp dụng" rồi "đang chạy lại" khi thiết bị không trả lời', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push(
      status({ state: 'applying', updateId: UID, plan: PLAN, step: 'health-check' }),
      { error: 'unreachable' },
      status({ state: 'committed', last: { ...LAST_OLD, updateId: UID, to: '1.0.1' } }),
    );
    await env.flow.apply('pw');
    expect(env.phases).toEqual(['applying', 'restarting']);
    expect(env.flow.following).toBeNull();
  });

  it('sai mật khẩu (REAUTH_FAILED): ở lại bước kế hoạch, báo lỗi, không theo dõi', async () => {
    const f = fake();
    const env = await toPlan(f);
    const before = statusCalls(f);
    f.setApply(refused('REAUTH_FAILED'));
    await env.flow.apply('sai');
    expect(env.flow.step).toBe('plan');
    expect(updateErrorCode(env.flow.error!)).toBe('REAUTH_FAILED');
    expect(statusCalls(f)).toBe(before);
    // Khóa vì sai nhiều lần: lỗi `locked` của Rust.
    f.setApply({ error: 'locked', detail: 300 });
    await env.flow.apply('sai');
    expect(env.flow.error).toEqual({ error: 'locked', detail: 300 });
  });

  it('gói đã hết hạn (UPDATE_NOT_FOUND): về bước chọn file', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.setApply(refused('UPDATE_NOT_FOUND'));
    await env.flow.apply('pw');
    expect(env.flow.step).toBe('pick');
    expect(env.flow.updateId).toBeNull();
    expect(updateErrorCode(env.flow.error!)).toBe('UPDATE_NOT_FOUND');
  });

  it('thiết bị tự quay về (rolled-back): kết quả kèm lý do', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push(
      { error: 'unreachable' },
      status({
        state: 'rolled-back',
        last: {
          ...LAST_OLD,
          updateId: UID,
          from: '1.0.0',
          to: '1.0.1',
          result: 'rolled-back',
          reason: 'health-check: /api/v1/system/info không trả lời trong 60 s',
        },
      }),
    );
    await env.flow.apply('pw');
    expect(env.flow.result).toMatchObject({
      outcome: 'rolled-back',
      version: '1.0.0',
      reason: 'health-check: /api/v1/system/info không trả lời trong 60 s',
    });
  });

  it('trạng thái failed cũng là "không cập nhật": coi như quay về', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push(status({ state: 'failed', step: 'verify', last: LAST_OLD }));
    await env.flow.apply('pw');
    expect(env.flow.result?.outcome).toBe('rolled-back');
  });

  it('kết quả cũ của lần cập nhật trước không bị lấy nhầm', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push(
      status({ state: 'idle', last: LAST_OLD }),
      status({ state: 'idle', last: LAST_OLD }),
      status({ state: 'committed', last: { ...LAST_OLD, updateId: UID, to: '1.0.1' } }),
    );
    await env.flow.apply('pw');
    expect(env.flow.result).toMatchObject({ outcome: 'committed', version: '1.0.1' });
  });

  it('không trả lời quá 120 s: mất kết nối (không kết luận sớm hơn)', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push({ error: 'unreachable' });
    const start = env.now();
    await env.flow.apply('pw');
    expect(env.flow.result).toMatchObject({ outcome: 'lost', lostCause: 'timeout' });
    const waited = env.now() - start;
    expect(waited).toBeGreaterThan(LOST_AFTER_MS);
    expect(waited).toBeLessThanOrEqual(LOST_AFTER_MS + 2 * 2000);
  });

  it('mất phiên sau khi chạy lại: kết thúc với lý do phiên (đăng nhập lại để xem kết quả)', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push({ error: 'unreachable' }, { error: 'session-expired' });
    await env.flow.apply('pw');
    expect(env.flow.result).toMatchObject({ outcome: 'lost', lostCause: 'session' });
  });

  it('Hủy gói: gửi cancel với updateId, về bước chọn file', async () => {
    const f = fake();
    const env = await toPlan(f);
    await env.flow.cancel();
    expect(f.calls.find((c) => c.cmd === 'cancel')!.args).toEqual(['dev-1', UID]);
    expect(env.flow.step).toBe('pick');
    expect(env.flow.plan).toBeNull();
    expect(env.flow.updateId).toBeNull();
  });

  it('Quay về bản trước: hỏi mật khẩu, gửi rollback, theo dõi tới khi có kết quả mới', async () => {
    const f = fake();
    const env = flowOf(f);
    await env.flow.load();
    env.flow.askRollback();
    expect(env.flow.step).toBe('confirm-rollback');
    f.push(
      status({ state: 'applying', step: 'switching' }),
      { error: 'unreachable' },
      status({
        state: 'idle',
        last: {
          updateId: 'upd_00000000000000aa',
          result: 'rolled-back',
          from: '1.0.0',
          to: '0.9.0',
          finishedAt: '2026-10-17T02:00:00Z',
          reason: 'manual',
        },
        previous: null,
      }),
    );
    await env.flow.rollback('pw-admin');
    expect(f.calls.find((c) => c.cmd === 'rollback')!.args).toEqual(['dev-1', 'pw-admin']);
    expect(env.flow.result).toMatchObject({
      mode: 'rollback',
      outcome: 'committed',
      version: '0.9.0',
    });
  });

  it('Quay về bản trước khi không có bản trước: lỗi UPDATE_NO_PREVIOUS, ở lại bước xác nhận', async () => {
    const f = fake();
    const env = flowOf(f);
    await env.flow.load();
    env.flow.askRollback();
    f.setRollback(refused('UPDATE_NO_PREVIOUS'));
    await env.flow.rollback('pw');
    expect(env.flow.step).toBe('confirm-rollback');
    expect(updateErrorCode(env.flow.error!)).toBe('UPDATE_NO_PREVIOUS');
  });

  it('dispose dừng theo dõi: không hỏi thêm', async () => {
    const f = fake();
    const env = await toPlan(f);
    f.push({ error: 'unreachable' });
    const p = env.flow.apply('pw');
    await Promise.resolve();
    env.flow.dispose();
    await p;
    const n = statusCalls(f);
    await new Promise((r) => setTimeout(r, 0));
    expect(statusCalls(f)).toBe(n);
    expect(env.flow.result).toBeNull();
  });
});
