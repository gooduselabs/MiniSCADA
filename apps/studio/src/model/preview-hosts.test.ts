// Nơi chứa xem trước của Studio (feature 007, T121, T131, T132, FR-067, US6-6): Mô phỏng không bao giờ gọi thiết bị, ghi
// vào SimEngine theo RW, kiểu, giới hạn; chế độ Thiết bị đi qua WriteFlow của 006 với context, expect, pulseMs, khóa khi chưa
// Online hoặc role < operator; mất kết nối thì giá trị thành STALE.
import type { TagV1 } from '@mat/project-schema';
import type { WriteOutcome, WriteSpec } from '@mat/ui-components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveValue } from './device-session.ts';
import {
  DeviceActionHost,
  DeviceTagSource,
  SimActionHost,
  SimTagSource,
  hostTagInfo,
  type PreviewNav,
} from './preview-hosts.ts';
import { SimEngine } from './sim-engine.ts';
import { WriteFlow } from './write-flow.ts';

const tag = (id: string, extra: Partial<TagV1> = {}): TagV1 =>
  ({
    id,
    kind: 'simulation',
    type: 'FLOAT32',
    access: 'RW',
    sim: { kind: 'manual', initial: 5 },
    ...extra,
  }) as TagV1;

const TAGS: TagV1[] = [
  tag('SP', { limits: { min: 0, max: 100 } }),
  tag('RUN', { type: 'BOOL', sim: { kind: 'manual', initial: false } } as Partial<TagV1>),
  tag('RO', { access: 'R' }),
  {
    id: 'CALC',
    kind: 'calculated',
    type: 'FLOAT32',
    expression: 'SP * 2',
  } as unknown as TagV1,
];

const nav = (): PreviewNav & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    navigate: (id) => calls.push(`nav:${id}`),
    openPopup: (id) => calls.push(`popup:${id}`),
    closePopup: () => calls.push('close'),
  };
};

const spec = (over: Partial<WriteSpec> = {}): WriteSpec => ({
  kind: 'write',
  tag: 'SP',
  value: 40,
  context: { screen: 'tong-quan', widget: 'sp_1' },
  ...over,
});

describe('hostTagInfo', () => {
  it('kiểu, loại, quyền (mặc định chỉ đọc; Tag tính toán luôn chỉ đọc), đơn vị, giới hạn', () => {
    expect(hostTagInfo(tag('A', { unit: '%', valueTable: 'T' }))).toMatchObject({
      id: 'A',
      type: 'FLOAT32',
      kind: 'simulation',
      access: 'RW',
      unit: '%',
      valueTable: 'T',
    });
    expect(hostTagInfo(tag('B', { access: undefined }))?.access).toBe('R');
    expect(
      hostTagInfo({ id: 'C', kind: 'calculated', type: 'BOOL', access: 'RW' } as unknown as TagV1)
        ?.access,
    ).toBe('R');
    expect(hostTagInfo({ id: 'D', type: 'LẠ' } as unknown as TagV1)).toBeNull();
  });
});

describe('xem trước bằng Mô phỏng', () => {
  let engine: SimEngine;
  let tick: () => void;
  beforeEach(() => {
    engine = new SimEngine({
      clock: () => 1_000,
      timers: {
        setInterval: (fn) => {
          tick = fn;
          return 1;
        },
        clearInterval: () => undefined,
      },
    });
    engine.load(TAGS, []);
    engine.start();
  });
  afterEach(() => engine.stop());

  const source = () =>
    new SimTagSource({ engine, tags: () => TAGS, tables: () => [], clock: () => 1_000 });

  it('nguồn Tag: thông tin từ project, giá trị từ engine, connection luôn live, Tag lạ là UNKNOWN', () => {
    const s = source();
    expect(s.connection).toBe('live');
    expect(s.info('SP')?.access).toBe('RW');
    expect(s.info('khong-co')).toBeUndefined();
    expect(s.get('khong-co').quality).toBe('UNKNOWN');
    expect(s.get('SP')).toMatchObject({ value: 5, quality: 'GOOD' });
    expect(s.now()).toBe(1_000);
  });

  it('đăng ký chỉ nhận thay đổi của Tag mình quan tâm', () => {
    const s = source();
    const seen: string[][] = [];
    const off = s.subscribe(['SP'], (c) => seen.push([...c]));
    engine.write('RUN', true);
    engine.write('SP', 7);
    expect(seen.flat()).toEqual(['SP']);
    off();
    engine.write('SP', 8);
    expect(seen).toHaveLength(1);
    void tick;
  });

  it('ghi: CONFIRMED vào engine; Tag chỉ đọc, Tag tính toán, Tag lạ, ngoài giới hạn, sai kỳ vọng bị REJECTED và engine không đổi', async () => {
    const s = source();
    const host = new SimActionHost({ engine, source: s, nav: nav(), user: 'mo-phong' });
    const phases: string[] = [];
    const ok = await host.write(spec(), (o) => phases.push(o.status));
    expect(ok).toMatchObject({ status: 'CONFIRMED', readback: 40 });
    expect(phases).toEqual(['ACCEPTED', 'CONFIRMED']);
    expect(engine.get('SP')?.value).toBe(40);
    const code = async (over: Partial<WriteSpec>): Promise<string | undefined> => {
      const r: WriteOutcome = await host.write(spec(over), () => undefined);
      expect(r.status).toBe('REJECTED');
      return r.code;
    };
    expect(await code({ tag: 'RO' })).toBe('TAG_READONLY');
    expect(await code({ tag: 'CALC' })).toBe('TAG_CALCULATED');
    expect(await code({ tag: 'KHONG' })).toBe('TAG_UNKNOWN');
    expect(await code({ value: 101 })).toBe('OUT_OF_RANGE');
    expect(await code({ value: -1 })).toBe('OUT_OF_RANGE');
    expect(await code({ tag: 'RUN', kind: 'toggle', value: true, expect: true })).toBe(
      'STALE_EXPECTATION',
    );
    expect(engine.get('SP')?.value).toBe(40);
    expect(engine.get('RUN')?.value).toBe(false);
  });

  it('xung: giữ giá trị rồi đảo lại sau pulseMs bằng hẹn giờ', async () => {
    vi.useFakeTimers();
    try {
      const timers = {
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      };
      const host = new SimActionHost({ engine, source: source(), nav: nav(), user: 'x', timers });
      const p = host.write(
        spec({ tag: 'RUN', kind: 'pulse', value: true, pulseMs: 500 }),
        () => undefined,
      );
      await Promise.resolve();
      expect(engine.get('RUN')?.value).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect((await p).status).toBe('CONFIRMED');
      expect(engine.get('RUN')?.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('phiên giả là operator, không khóa; chuyển màn hình đổi trong editor', () => {
    const n = nav();
    const host = new SimActionHost({ engine, source: source(), nav: n, user: 'mo-phong' });
    expect(host.session()).toEqual({ user: 'mo-phong', role: 'operator' });
    expect(host.writeBlocked()).toBeNull();
    host.navigate('a');
    host.openPopup('b');
    host.closePopup();
    expect(n.calls).toEqual(['nav:a', 'popup:b', 'close']);
  });
});

describe('xem trước bằng Thiết bị', () => {
  const live = (value: LiveValue['value'], quality: LiveValue['quality'] = 'GOOD'): LiveValue => ({
    value,
    quality,
    ts: 500,
  });

  it('nguồn Tag: giá trị của phiên; mất kết nối thì STALE; Tag thiết bị báo không có là UNKNOWN; thông báo theo Tag đăng ký', () => {
    const values = new Map<string, LiveValue>([['SP', live(12)]]);
    let conn: 'live' | 'stale' | 'offline' = 'live';
    const s = new DeviceTagSource({
      tags: () => TAGS,
      tables: () => [],
      values: () => values,
      unknown: () => new Set(['RO']),
      connection: () => conn,
    });
    expect(s.get('SP')).toMatchObject({ value: 12, quality: 'GOOD', updatedAt: 500 });
    conn = 'stale';
    expect(s.get('SP').quality).toBe('STALE');
    expect(s.connection).toBe('stale');
    values.set('RO', live(1));
    expect(s.get('RO').quality).toBe('UNKNOWN');
    expect(s.get('CHUA-CO').quality).toBe('UNKNOWN');
    const seen: string[][] = [];
    s.subscribe(['SP', 'RUN'], (c) => seen.push([...c]));
    s.notify(['RO', 'SP']);
    s.notifyAll();
    expect(seen).toEqual([['SP'], ['SP', 'RUN']]);
    expect(s.watched().sort()).toEqual(['RUN', 'SP']);
  });

  function deviceHost(opts: { online: boolean; role?: 'viewer' | 'operator' }) {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    const flow = new WriteFlow({
      post: async (path, body) => {
        posts.push({ path, body: body as Record<string, unknown> });
        const reqs = (body as { requests: Array<{ requestId: string }> }).requests;
        return {
          status: 200,
          body: {
            results: reqs.map((r) => ({
              requestId: r.requestId,
              status: 'CONFIRMED',
              readback: 40,
            })),
          },
        };
      },
      get: async () => ({ status: 200, body: { results: [] } }),
    });
    const n = nav();
    const host = new DeviceActionHost({
      flow,
      online: () => opts.online,
      session: () => ({ user: 'kỹ sư', role: opts.role ?? 'operator' }),
      notOnlineMessage: 'Chưa Online',
      nav: n,
      requestLogin: () => n.calls.push('login'),
    });
    return { host, posts, n };
  }

  it('khóa khi chưa Online: không phiên, kèm lý do; Online thì có phiên theo tài khoản', () => {
    const off = deviceHost({ online: false }).host;
    expect(off.session()).toBeNull();
    expect(off.writeBlocked()).toEqual({ code: 'SESSION_EXPIRED', message: 'Chưa Online' });
    const on = deviceHost({ online: true, role: 'viewer' }).host;
    expect(on.session()).toEqual({ user: 'kỹ sư', role: 'viewer' });
    expect(on.writeBlocked()).toBeNull();
  });

  it('ghi qua WriteFlow: một POST kèm context, expect, pulseMs; kết quả CONFIRMED có readback', async () => {
    const { host, posts } = deviceHost({ online: true });
    const phases: string[] = [];
    const r = await host.write(
      spec({ tag: 'RUN', kind: 'pulse', value: true, pulseMs: 500, expect: false }),
      (o) => phases.push(o.status),
    );
    expect(r).toMatchObject({ status: 'CONFIRMED', readback: 40 });
    expect(phases.at(-1)).toBe('CONFIRMED');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/api/v1/tags/write');
    expect((posts[0]!.body.requests as Array<Record<string, unknown>>)[0]).toMatchObject({
      tag: 'RUN',
      value: true,
      expect: false,
      pulseMs: 500,
      context: { screen: 'tong-quan', widget: 'sp_1' },
    });
  });

  it('ghi thường không gửi pulseMs hay expect', async () => {
    const { host, posts } = deviceHost({ online: true });
    await host.write(spec(), () => undefined);
    const req = (posts[0]!.body.requests as Array<Record<string, unknown>>)[0]!;
    expect(req).not.toHaveProperty('pulseMs');
    expect(req).not.toHaveProperty('expect');
  });

  it('điều hướng và đăng nhập đi qua editor', () => {
    const { host, n } = deviceHost({ online: true });
    host.navigate('a');
    host.openPopup('p');
    host.closePopup();
    host.requestLogin();
    expect(n.calls).toEqual(['nav:a', 'popup:p', 'close', 'login']);
  });
});
