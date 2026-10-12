// Ghi từ Bảng theo dõi (feature 006, T149, US2, FR-050, FR-040, data-model §13.3, R22): máy trạng thái từng dòng, hỏi kết quả
// mỗi 200 ms tới 30 s, mất mạng thì hỏi lại theo mã không gửi lại, phiên hết hạn thì đăng nhập lại và xác nhận lại, mã yêu
// cầu UUID v4 mới mỗi lần, ≤ 16 dòng mỗi POST, khóa Ghi kèm lý do, dấu chấm thập phân, INT64 lớn gửi dạng chuỗi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, DeviceError } from '../platform/device-types.ts';
import {
  POLL_MS,
  POLL_MAX_MS,
  WriteFlow,
  deviceTagDefs,
  diffDefs,
  parseWriteValue,
  planWrite,
  writeLock,
  type DeviceTagDef,
} from './write-flow.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SP: DeviceTagDef = {
  id: 'TANK01.SP',
  kind: 'external',
  type: 'FLOAT32',
  access: 'RW',
  limits: { min: 0, max: 90 },
};

describe('giá trị gõ vào', () => {
  it('số theo dấu chấm thập phân; dấu phẩy bị từ chối kèm gợi ý', () => {
    expect(parseWriteValue('75', SP)).toEqual({ ok: true, value: 75 });
    expect(parseWriteValue(' 12.5 ', SP)).toEqual({ ok: true, value: 12.5 });
    expect(parseWriteValue('1e1', SP)).toEqual({ ok: true, value: 10 });
    expect(parseWriteValue('12,5', SP)).toMatchObject({
      ok: false,
      error: 'wf.err.comma',
      hint: '12.5',
    });
    expect(parseWriteValue('abc', SP)).toMatchObject({ ok: false, error: 'wf.err.number' });
    expect(parseWriteValue('', SP)).toMatchObject({ ok: false, error: 'wf.err.empty' });
    expect(parseWriteValue('NaN', SP)).toMatchObject({ ok: false, error: 'wf.err.number' });
  });

  it('kiểu nguyên không nhận số lẻ; INT64 lớn gửi dạng chuỗi', () => {
    const i16 = { ...SP, type: 'INT16', limits: undefined };
    expect(parseWriteValue('5.5', i16)).toMatchObject({ ok: false, error: 'wf.err.integer' });
    const u64 = { ...SP, type: 'UINT64', limits: undefined };
    expect(parseWriteValue('12345678901234567890', u64)).toEqual({
      ok: true,
      value: '12345678901234567890',
    });
    expect(parseWriteValue('42', u64)).toEqual({ ok: true, value: 42 });
    expect(parseWriteValue('9007199254740993', { ...u64, type: 'INT64' })).toEqual({
      ok: true,
      value: '9007199254740993',
    });
  });

  it('BOOL và STRING', () => {
    const b = { ...SP, type: 'BOOL', limits: undefined };
    expect(parseWriteValue('true', b)).toEqual({ ok: true, value: true });
    expect(parseWriteValue('0', b)).toEqual({ ok: true, value: false });
    expect(parseWriteValue('có', b)).toEqual({ ok: true, value: true });
    expect(parseWriteValue('maybe', b)).toMatchObject({ ok: false, error: 'wf.err.bool' });
    const s = { ...SP, type: 'STRING', limits: { maxLength: 4 } };
    expect(parseWriteValue('abcd', s)).toEqual({ ok: true, value: 'abcd' });
    expect(parseWriteValue('abcde', s)).toMatchObject({ ok: false, error: 'wf.err.maxLength' });
  });

  it('giới hạn ghi theo định nghĩa trên BL335: ngoài thì lỗi kèm khoảng', () => {
    expect(parseWriteValue('95', SP)).toMatchObject({
      ok: false,
      error: 'wf.err.limits',
      min: 0,
      max: 90,
    });
    expect(parseWriteValue('-1', SP)).toMatchObject({ ok: false, error: 'wf.err.limits' });
    expect(parseWriteValue('90', SP)).toEqual({ ok: true, value: 90 });
  });
});

describe('khóa Ghi kèm lý do', () => {
  const base = {
    online: true,
    role: 'operator',
    def: SP as DeviceTagDef | null | undefined,
    live: { quality: 'GOOD' as const },
  };
  it('không khóa khi đủ điều kiện', () => expect(writeLock(base)).toBeNull());
  it('chưa Online có đăng nhập', () => {
    expect(writeLock({ ...base, online: false })?.reason).toBe('wf.lock.offline');
    expect(writeLock({ ...base, role: null })?.reason).toBe('wf.lock.offline');
  });
  it('role dưới operator', () => {
    expect(writeLock({ ...base, role: 'viewer' })?.reason).toBe('wf.lock.role');
    expect(writeLock({ ...base, role: 'engineer' })).toBeNull();
    expect(writeLock({ ...base, role: 'administrator' })).toBeNull();
  });
  it('Tag R hoặc tính toán', () => {
    expect(writeLock({ ...base, def: { ...SP, access: 'R' } })?.reason).toBe('wf.lock.readonly');
    expect(writeLock({ ...base, def: { ...SP, access: undefined } })?.reason).toBe(
      'wf.lock.readonly',
    );
    expect(writeLock({ ...base, def: { ...SP, kind: 'calculated', access: 'RW' } })?.reason).toBe(
      'wf.lock.readonly',
    );
  });
  it('Tag không có trên BL335 hoặc chưa đọc được định nghĩa', () => {
    expect(writeLock({ ...base, def: null })?.reason).toBe('wf.lock.notOnDevice');
    expect(writeLock({ ...base, def: undefined })?.reason).toBe('wf.lock.noDefinition');
  });
  it('kết nối xấu: quality BAD kèm lý do từ live', () => {
    const l = writeLock({ ...base, live: { quality: 'BAD', reason: 'DISCONNECTED' } });
    expect(l?.reason).toBe('wf.lock.badConnection');
    expect(l?.params?.reason).toContain('mất kết nối');
    expect(writeLock({ ...base, live: { quality: 'UNCERTAIN', reason: 'CLAMPED' } })).toBeNull();
    expect(writeLock({ ...base, live: undefined })).toBeNull();
  });
  it('định nghĩa từ projects/active: Tag theo id', () => {
    const defs = deviceTagDefs({
      tags: {
        tags: [
          { id: 'A', kind: 'external', type: 'INT16', access: 'RW' },
          { id: 'B', kind: 'internal', type: 'BOOL' },
        ],
      },
    });
    expect(defs?.get('A')).toMatchObject({ type: 'INT16', access: 'RW' });
    expect(defs?.has('C')).toBe(false);
    expect(deviceTagDefs({})).toBeNull();
  });
});

type Reply = ApiResult | DeviceError;
interface Rig {
  flow: WriteFlow;
  posts: Array<{
    path: string;
    body: { requests: Array<{ requestId: string; tag: string; value: unknown }> };
  }>;
  /** Mỗi lần hỏi: các mã yêu cầu đã hỏi, nối bằng dấu phẩy. */
  gets: string[];
  relogins: number;
  setPost(fn: (body: Rig['posts'][number]['body']) => Reply): void;
  setGet(fn: (ids: string[]) => Reply): void;
}

function rig(): Rig {
  let postFn: (b: Rig['posts'][number]['body']) => Reply = (b) => ({
    status: 200,
    body: {
      results: b.requests.map((r) => ({
        requestId: r.requestId,
        status: 'ACCEPTED',
        phase: 'queued',
        tag: r.tag,
      })),
    },
  });
  let getFn: (ids: string[]) => Reply = (ids) => ({
    status: 200,
    body: {
      results: ids.map((id) => ({
        requestId: id,
        status: 'CONFIRMED',
        code: 'CONFIRMED',
        readback: 1,
      })),
    },
  });
  const r: Rig = {
    posts: [],
    gets: [],
    relogins: 0,
    setPost: (fn) => void (postFn = fn),
    setGet: (fn) => void (getFn = fn),
    flow: null as never,
  };
  r.flow = new WriteFlow({
    post: async (path, body) => {
      r.posts.push({ path, body: body as never });
      return postFn(body as never);
    },
    get: async (path, query) => {
      expect(path).toBe('/api/v1/tags/write');
      const ids = (query?.ids ?? '').split(',').filter(Boolean);
      r.gets.push(ids.join(','));
      return getFn(ids);
    },
    onRelogin: () => void r.relogins++,
  });
  return r;
}

describe('WriteFlow', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('idle → sending → accepted → confirmed; hỏi mỗi 200 ms theo mã yêu cầu', async () => {
    const r = rig();
    expect(r.flow.row('a')?.state ?? 'idle').toBe('idle');
    const p = r.flow.submit([{ key: 'a', tag: 'TANK01.SP', value: 75 }]);
    expect(r.flow.row('a')?.state).toBe('sending');
    await p;
    expect(r.flow.row('a')).toMatchObject({ state: 'accepted', phase: 'queued' });
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].path).toBe('/api/v1/tags/write');
    expect(r.posts[0].body.requests[0]).toMatchObject({ tag: 'TANK01.SP', value: 75 });
    expect(r.posts[0].body.requests[0].requestId).toMatch(UUID);
    expect(POLL_MS).toBe(200);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')).toMatchObject({ state: 'confirmed', code: 'CONFIRMED', readback: 1 });
    expect(r.gets).toHaveLength(1);
    expect(r.gets[0]).toBe(r.posts[0].body.requests[0].requestId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.gets).toHaveLength(1);
  });

  it('tiếp tục hỏi khi còn ACCEPTED, kèm phase; kết quả cuối FAILED, TIMEOUT', async () => {
    const r = rig();
    let n = 0;
    r.setGet((ids) => ({
      status: 200,
      body: {
        results: ids.map((id) =>
          ++n < 3
            ? { requestId: id, status: 'ACCEPTED', phase: n === 1 ? 'sent' : 'readback' }
            : {
                requestId: id,
                status: 'FAILED',
                code: 'DEVICE_EXCEPTION',
                exception: { code: '02', meaning: 'địa chỉ không hợp lệ' },
              },
        ),
      },
    }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')).toMatchObject({ state: 'accepted', phase: 'sent' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')).toMatchObject({ state: 'accepted', phase: 'readback' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')).toMatchObject({
      state: 'failed',
      code: 'DEVICE_EXCEPTION',
      exception: { code: '02' },
    });
  });

  it('TIMEOUT của thiết bị trường là trạng thái cuối riêng', async () => {
    const r = rig();
    r.setGet((ids) => ({
      status: 200,
      body: {
        results: ids.map((id) => ({ requestId: id, status: 'TIMEOUT', code: 'WRITE_TIMEOUT' })),
      },
    }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')).toMatchObject({ state: 'timeout', code: 'WRITE_TIMEOUT' });
  });

  it('REJECTED ngay khi gửi: lý do, retryAfterMs; không hỏi tiếp', async () => {
    const r = rig();
    r.setPost((b) => ({
      status: 200,
      body: {
        results: [
          {
            requestId: b.requests[0].requestId,
            status: 'REJECTED',
            reason: 'OUT_OF_LIMITS',
            message: 'x',
          },
          {
            requestId: b.requests[1].requestId,
            status: 'REJECTED',
            reason: 'RATE_LIMITED',
            retryAfterMs: 2400,
          },
        ],
      },
    }));
    await r.flow.submit([
      { key: 'a', tag: 'T', value: 1 },
      { key: 'b', tag: 'U', value: 2 },
    ]);
    expect(r.flow.row('a')).toMatchObject({ state: 'rejected', code: 'OUT_OF_LIMITS' });
    expect(r.flow.row('b')).toMatchObject({
      state: 'rejected',
      code: 'RATE_LIMITED',
      retryAfterMs: 2400,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.gets).toEqual([]);
  });

  it('hỏi tối đa 30 giây: hết hạn thì unknown, không gửi lại', async () => {
    const r = rig();
    r.setGet((ids) => ({
      status: 200,
      body: { results: ids.map((id) => ({ requestId: id, status: 'ACCEPTED', phase: 'queued' })) },
    }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_MS);
    expect(POLL_MAX_MS).toBe(30000);
    expect(r.flow.row('a')?.state).toBe('unknown');
    expect(r.posts).toHaveLength(1);
  });

  it('mất mạng sau khi gửi: unknown; có mạng thì hỏi lại theo mã, TUYỆT ĐỐI không POST lần hai (US2-10)', async () => {
    const r = rig();
    r.setPost(() => ({ error: 'timeout' }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 7 }]);
    expect(r.flow.row('a')?.state).toBe('unknown');
    const id = r.posts[0].body.requests[0].requestId;
    r.setGet((ids) => ({
      status: 200,
      body: { results: ids.map((i) => ({ requestId: i, status: 'CONFIRMED', code: 'CONFIRMED' })) },
    }));
    await r.flow.recheck();
    expect(r.gets[0]).toContain(id);
    expect(r.flow.row('a')?.state).toBe('confirmed');
    expect(r.posts).toHaveLength(1);
  });

  it('thiết bị không còn nhớ mã (UNKNOWN / NO_SUCH_REQUEST): vẫn unknown, kèm lời giải thích', async () => {
    const r = rig();
    r.setPost(() => ({ error: 'unreachable' }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 7 }]);
    r.setGet((ids) => ({
      status: 200,
      body: { results: ids.map((i) => ({ requestId: i, status: 'UNKNOWN' })) },
    }));
    await r.flow.recheck();
    expect(r.flow.row('a')).toMatchObject({ state: 'unknown', code: 'NO_SUCH_REQUEST' });
    r.setGet(() => ({ error: 'no-such-request' }));
    await r.flow.recheck();
    expect(r.flow.row('a')).toMatchObject({ state: 'unknown', code: 'NO_SUCH_REQUEST' });
    expect(r.posts).toHaveLength(1);
  });

  it('mất mạng giữa lúc hỏi: unknown', async () => {
    const r = rig();
    r.setGet(() => ({ error: 'unreachable' }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')?.state).toBe('unknown');
  });

  it('phiên hết hạn: relogin, gọi onRelogin; sau đăng nhập lại về idle và phải xác nhận lại (US2-11)', async () => {
    const r = rig();
    r.setPost(() => ({ error: 'session-expired' }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    expect(r.flow.row('a')?.state).toBe('relogin');
    expect(r.relogins).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(r.posts).toHaveLength(1);
    r.flow.loggedIn();
    expect(r.flow.row('a')?.state ?? 'idle').toBe('idle');
    expect(r.posts).toHaveLength(1);
  });

  it('401 kèm results SESSION_EXPIRED cũng là relogin', async () => {
    const r = rig();
    r.setPost((b) => ({
      status: 401,
      body: {
        error: 'SESSION_EXPIRED',
        results: b.requests.map((x) => ({
          requestId: x.requestId,
          status: 'REJECTED',
          reason: 'SESSION_EXPIRED',
        })),
      },
    }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    expect(r.flow.row('a')?.state).toBe('relogin');
  });

  it('403 FORBIDDEN kèm results: rejected', async () => {
    const r = rig();
    r.setPost((b) => ({
      status: 403,
      body: {
        error: 'FORBIDDEN',
        results: b.requests.map((x) => ({
          requestId: x.requestId,
          status: 'REJECTED',
          reason: 'FORBIDDEN',
        })),
      },
    }));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    expect(r.flow.row('a')).toMatchObject({ state: 'rejected', code: 'FORBIDDEN' });
  });

  it('mỗi lần xác nhận sinh requestId UUID v4 mới', async () => {
    const r = rig();
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    const ids = r.posts.map((p) => p.body.requests[0].requestId);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('nhiều dòng: chia mỗi POST tối đa 16', async () => {
    const r = rig();
    const items = Array.from({ length: 40 }, (_, i) => ({ key: `r${i}`, tag: `T${i}`, value: i }));
    await r.flow.submit(items);
    expect(r.posts.map((p) => p.body.requests.length)).toEqual([16, 16, 8]);
    expect(r.flow.row('r39')?.state).toBe('accepted');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('r0')?.state).toBe('confirmed');
    expect(r.flow.row('r39')?.state).toBe('confirmed');
    expect(r.gets.every((g) => g.split(',').length <= 16)).toBe(true);
  });

  it('INT64 lớn đi dạng chuỗi trong thân', async () => {
    const r = rig();
    await r.flow.submit([{ key: 'a', tag: 'T', value: '12345678901234567890' }]);
    expect(r.posts[0].body.requests[0].value).toBe('12345678901234567890');
  });

  it('đang gửi hoặc đang chờ thì không nhận lần ghi thứ hai của cùng dòng', async () => {
    const r = rig();
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await r.flow.submit([{ key: 'a', tag: 'T', value: 2 }]);
    expect(r.posts).toHaveLength(1);
  });

  it('báo cho người nghe mỗi lần trạng thái đổi; reset đưa dòng về idle', async () => {
    const r = rig();
    let n = 0;
    r.flow.subscribe(() => n++);
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(n).toBeGreaterThanOrEqual(3);
    r.flow.reset('a');
    expect(r.flow.row('a')?.state ?? 'idle').toBe('idle');
  });
});

describe('khác biệt định nghĩa trên máy và trên BL335', () => {
  const base: DeviceTagDef = {
    id: 'T',
    kind: 'external',
    type: 'FLOAT32',
    access: 'RW',
    source: { device: 'plc1', address: 'HR200', byteOrder: 'CDAB' },
    limits: { min: 0, max: 90 },
  };
  it('giống nhau thì rỗng; địa chỉ, giới hạn, thang đo khác thì liệt kê từng trường', () => {
    expect(diffDefs(base, { ...base })).toEqual([]);
    expect(diffDefs(undefined, base)).toEqual([]);
    const d = diffDefs(base, {
      ...base,
      source: { ...base.source, address: 'HR201' },
      limits: { min: 0, max: 100 },
      scaling: { rawMin: 0 },
    });
    expect(d.map((x) => x.field)).toEqual(['source.address', 'scaling', 'limits']);
    expect(d[0]).toEqual({ field: 'source.address', local: 'HR200', device: 'HR201' });
  });
  it('mặc định không tính là khác: quyền R, nhóm quét normal, kiểu thô bằng kiểu', () => {
    const a: DeviceTagDef = {
      id: 'T',
      kind: 'external',
      type: 'INT16',
      source: { device: 'd', address: 'HR1' },
    };
    const b: DeviceTagDef = {
      id: 'T',
      kind: 'external',
      type: 'INT16',
      access: 'R',
      source: { device: 'd', address: 'HR1', scanGroup: 'normal', rawType: 'INT16' },
    };
    expect(diffDefs(a, b)).toEqual([]);
  });
});

describe('thời điểm của từng dòng', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());
  it('at đổi theo trạng thái cuối', async () => {
    const r = rig();
    vi.setSystemTime(new Date('2026-10-20T03:12:00Z'));
    await r.flow.submit([{ key: 'a', tag: 'T', value: 1 }]);
    const t0 = r.flow.row('a')!.at;
    vi.setSystemTime(new Date('2026-10-20T03:12:05Z'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(r.flow.row('a')!.state).toBe('confirmed');
    expect(r.flow.row('a')!.at).toBeGreaterThan(t0);
  });
});

describe('planWrite: bản xem trước của hộp xác nhận', () => {
  const defs = new Map<string, DeviceTagDef>([
    ['TANK01.SP', SP],
    ['PUMP.RUN', { id: 'PUMP.RUN', kind: 'external', type: 'BOOL', access: 'RW' }],
    ['TANK01.LEVEL', { id: 'TANK01.LEVEL', kind: 'external', type: 'FLOAT32', access: 'R' }],
  ]);
  const local = new Map<string, DeviceTagDef>([
    ['TANK01.SP', { ...SP, source: { device: 'plc1', address: 'HR200' } }],
  ]);
  const ctx = {
    online: true,
    role: 'operator',
    defs,
    local,
    live: (tag: string) => (tag === 'TANK01.SP' ? { text: '72.5', quality: 'GOOD' } : null),
  };

  it('dòng hợp lệ: hiểu giá trị theo định nghĩa trên BL335, kèm giá trị hiện tại', () => {
    const d = planWrite([{ key: 'a', tag: 'TANK01.SP', text: '75' }], ctx);
    expect(d.sendable).toBe(1);
    expect(d.items[0]).toMatchObject({ value: 75, current: '72.5', def: SP });
    expect(d.items[0].blocked).toBeUndefined();
  });

  it('ngoài giới hạn: khóa với khoảng; dấu phẩy: gợi ý dấu chấm; Tag R, không có, chưa có định nghĩa', () => {
    const d = planWrite(
      [
        { key: 'a', tag: 'TANK01.SP', text: '95' },
        { key: 'b', tag: 'TANK01.SP', text: '12,5' },
        { key: 'c', tag: 'TANK01.LEVEL', text: '1' },
        { key: 'd', tag: 'KHONG.CO', text: '1' },
        { key: 'e', tag: 'PUMP.RUN', text: 'true' },
      ],
      ctx,
    );
    expect(d.items.map((i) => i.blocked?.reason)).toEqual([
      'wf.err.limitsRange',
      'wf.err.comma',
      'wf.lock.readonly',
      'wf.lock.notOnDevice',
      undefined,
    ]);
    expect(d.items[0].blocked?.params).toMatchObject({ min: 0, max: 90 });
    expect(d.items[1].blocked?.params).toMatchObject({ hint: '12.5' });
    expect(d.sendable).toBe(1);
    const none = planWrite([{ key: 'a', tag: 'TANK01.SP', text: '1' }], {
      ...ctx,
      defs: undefined,
    });
    expect(none.items[0].blocked?.reason).toBe('wf.lock.noDefinition');
    expect(
      planWrite([{ key: 'a', tag: 'TANK01.SP', text: '1' }], { ...ctx, role: 'viewer' }).items[0]
        .blocked?.reason,
    ).toBe('wf.lock.role');
    expect(
      planWrite([{ key: 'a', tag: 'TANK01.SP', text: '1' }], { ...ctx, online: false }).items[0]
        .blocked?.reason,
    ).toBe('wf.lock.offline');
  });

  it('kết nối xấu theo live: khóa kèm lý do', () => {
    const d = planWrite([{ key: 'a', tag: 'TANK01.SP', text: '1' }], {
      ...ctx,
      live: () => ({ text: '—', quality: 'BAD', reason: 'DISCONNECTED' }),
    });
    expect(d.items[0].blocked?.reason).toBe('wf.lock.badConnection');
  });

  it('khác biệt với bản trên máy được nêu theo trường', () => {
    const d = planWrite([{ key: 'a', tag: 'TANK01.SP', text: '75' }], ctx);
    expect(d.items[0].differences).toEqual([
      { field: 'source.device', local: 'plc1', device: '' },
      { field: 'source.address', local: 'HR200', device: '' },
    ]);
  });
});
