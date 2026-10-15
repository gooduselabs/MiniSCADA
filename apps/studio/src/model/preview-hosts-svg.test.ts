// Xem trước chạy sự kiện của phần tử SVG (feature 008, T085, FR-054, US3-10): nơi chứa hành động của Studio nhận `context.widget` =
// `elementUid` (API ui-components giữ 1.2.0, ADR-025): Mô phỏng ghi vào SimEngine (không bao giờ gọi thiết bị), Thiết bị đi qua
// WriteFlow của 006 (kênh `studio`) với khóa `<màn hình>/<elementUid>`.
import type { TagV1 } from '@mat/project-schema';
import type { WriteSpec } from '@mat/ui-components';
import { describe, expect, it } from 'vitest';
import { DeviceActionHost, SimActionHost, SimTagSource, type PreviewNav } from './preview-hosts.ts';
import { SimEngine } from './sim-engine.ts';
import { WriteFlow } from './write-flow.ts';

const TAGS = [
  {
    id: 'PUMP.CMD',
    kind: 'simulation',
    type: 'BOOL',
    access: 'RW',
    sim: { kind: 'manual', initial: false },
  },
  {
    id: 'PUMP.RO',
    kind: 'simulation',
    type: 'BOOL',
    access: 'R',
    sim: { kind: 'const', value: false },
  },
] as unknown as TagV1[];

const spec = (over: Partial<WriteSpec> = {}): WriteSpec => ({
  kind: 'toggle',
  tag: 'PUMP.CMD',
  value: true,
  expect: false,
  context: { screen: 'bon', widget: 'el_hit' },
  ...over,
});

const nav = (): PreviewNav & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    navigate: (id) => calls.push(`nav:${id}`),
    openPopup: (id) => calls.push(`popup:${id}`),
    closePopup: () => calls.push('close'),
  };
};

describe('SimActionHost với sự kiện phần tử SVG', () => {
  const rig = () => {
    const engine = new SimEngine();
    engine.load(TAGS, []);
    engine.tick();
    const source = new SimTagSource({ engine, tags: () => TAGS, tables: () => [] });
    const n = nav();
    const host = new SimActionHost({ engine, source, nav: n, user: 'Mô phỏng' });
    return { engine, host, n };
  };

  it('nhấp phần tử ghi vào mô phỏng (CONFIRMED, đọc lại đúng), context là UID phần tử', async () => {
    const { engine, host } = rig();
    const phases: string[] = [];
    const r = await host.write(spec(), (o) => phases.push(o.status));
    expect(r).toMatchObject({ status: 'CONFIRMED', readback: true });
    expect(phases).toEqual(['ACCEPTED', 'CONFIRMED']);
    expect(engine.get('PUMP.CMD')!.value).toBe(true);
  });

  it('Tag chỉ đọc bị từ chối, không đổi gì; điều hướng và popup đi qua nơi chứa', async () => {
    const { engine, host, n } = rig();
    const r = await host.write(spec({ tag: 'PUMP.RO' }), () => undefined);
    expect(r).toMatchObject({ status: 'REJECTED', code: 'TAG_READONLY' });
    expect(engine.get('PUMP.RO')!.value).toBe(false);
    host.navigate('chinh');
    host.openPopup('chi-tiet');
    host.closePopup();
    expect(n.calls).toEqual(['nav:chinh', 'popup:chi-tiet', 'close']);
  });
});

describe('DeviceActionHost với sự kiện phần tử SVG', () => {
  it('ghi qua WriteFlow: khóa <màn hình>/<UID>, context mang UID, kèm expect và pulseMs; kênh studio', async () => {
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
              readback: true,
            })),
          },
        };
      },
      get: async () => ({ status: 200, body: { results: [] } }),
    });
    const n = nav();
    const host = new DeviceActionHost({
      flow,
      online: () => true,
      session: () => ({ user: 'kỹ sư', role: 'operator' }),
      notOnlineMessage: 'Chưa Online',
      nav: n,
      requestLogin: () => n.calls.push('login'),
    });
    const r = await host.write(spec({ kind: 'pulse', pulseMs: 500 }), () => undefined);
    expect(r).toMatchObject({ status: 'CONFIRMED' });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/api/v1/tags/write');
    expect((posts[0]!.body.requests as Array<Record<string, unknown>>)[0]).toMatchObject({
      tag: 'PUMP.CMD',
      value: true,
      expect: false,
      pulseMs: 500,
      context: { screen: 'bon', widget: 'el_hit' },
    });
    expect(flow.row('bon/el_hit')?.state).toBe('confirmed');
  });

  it('chưa Online: khóa kèm lý do, không gửi gì', () => {
    const flow = new WriteFlow({
      post: async () => {
        throw new Error('không được gọi');
      },
      get: async () => ({ status: 200, body: { results: [] } }),
    });
    const host = new DeviceActionHost({
      flow,
      online: () => false,
      session: () => null,
      notOnlineMessage: 'Chưa Online',
      nav: nav(),
      requestLogin: () => undefined,
    });
    expect(host.session()).toBeNull();
    expect(host.writeBlocked()).toEqual({ code: 'SESSION_EXPIRED', message: 'Chưa Online' });
  });
});
