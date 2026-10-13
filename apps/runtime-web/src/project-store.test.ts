// ProjectStore (feature 007, FR-006, FR-020, FR-023; research R5, R6): tóm tắt `projects/active`, tải màn hình theo yêu cầu
// qua `/project/…`, cache ≤ 8, lỗi từng màn hình độc lập, project 0.1 và 0.2 qua bộ chuyển sang mô hình v1, 503.
import { describe, expect, it } from 'vitest';
import { ProjectStore, ScreenLoadError } from './project-store.ts';

interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
}
type Routes = Record<string, Reply | (() => Reply)>;

function fakeFetch(routes: Routes) {
  const calls: string[] = [];
  const fn = ((url: string) => {
    calls.push(url);
    const r = routes[url];
    const reply = typeof r === 'function' ? r() : r;
    if (!reply)
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      });
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (reply.json === undefined) throw new Error('không phải JSON');
        return reply.json;
      },
      text: async () => reply.text ?? '',
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const screen03 = (id: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: '0.3.0',
  id,
  name: id.toUpperCase(),
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items: [],
  ...extra,
});

function body03(ids: string[], extra: Record<string, unknown> = {}) {
  return {
    project: {
      projectId: 'demo',
      projectVersion: '1.0.0',
      projectName: 'Demo',
      entryScreen: ids[0],
    },
    tags: {
      schemaVersion: '0.3.0',
      tags: [
        {
          id: 'T1',
          type: 'FLOAT32',
          kind: 'external',
          access: 'RW',
          unit: 'bar',
          min: 0,
          max: 10,
          valueTable: 'TT',
          source: { device: 'plc1', address: 'HR1' },
          limits: { min: 1, max: 9 },
        },
        { id: 'T2', type: 'BOOL', kind: 'internal' },
      ],
    },
    valueTables: { TT: { entries: [] } },
    connections: [{ id: 'plc1', name: 'PLC trạm bơm', kind: 'modbus-tcp' }],
    navigation: { position: 'left', items: [{ label: 'A', screen: ids[0] }] },
    screens: ids.map((id) => ({
      id,
      name: id.toUpperCase(),
      kind: id.startsWith('pop') ? 'popup' : 'screen',
      file: `screens/${id}.screen.json`,
    })),
    digest: 'sha256:abc',
    ...extra,
  };
}

const routes03 = (ids: string[]): Routes => {
  const r: Routes = { '/api/v1/projects/active': { json: body03(ids) } };
  for (const id of ids) r[`/project/screens/${id}.screen.json`] = { json: screen03(id) };
  return r;
};

const LEGACY_SCREEN = {
  screen: {
    schemaVersion: '0.2.0',
    id: 'main',
    name: 'Main',
    svgFile: 'screens/main.svg',
    viewBox: [0, 0, 100, 100],
    fitMode: 'contain',
    background: '#102030',
    bindingFile: 'screens/main.bindings.json',
    elements: [{ elementUid: 'el_a' }],
  },
  bindings: {
    schemaVersion: '0.2.0',
    screenId: 'main',
    elements: [{ elementUid: 'el_a', bindings: [] }],
  },
};
const legacyBody = (extra: Record<string, unknown> = {}) => ({
  project: {
    projectId: 'tank',
    projectVersion: '0.1.0',
    projectName: 'Tank',
    entryScreen: 'main',
    schemaVersion: '0.2.0',
  },
  tags: { tags: [{ id: 'LEVEL', type: 'FLOAT32', unit: 'm' }] },
  screens: { main: LEGACY_SCREEN },
  ...extra,
});

describe('tóm tắt project 0.3', () => {
  it('chỉ gọi projects/active; tag, bảng, navigation, danh sách màn hình, dấu project', async () => {
    const f = fakeFetch(routes03(['tong-quan', 'bom1', 'pop1']));
    const store = new ProjectStore({ fetch: f.fn });
    const res = await store.open();
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const s = res.summary;
    expect(s.legacy).toBe(false);
    expect(s.name).toBe('Demo');
    expect(s.entry).toBe('tong-quan');
    expect(s.screens.map((x) => [x.id, x.kind])).toEqual([
      ['tong-quan', 'screen'],
      ['bom1', 'screen'],
      ['pop1', 'popup'],
    ]);
    expect(s.navigation?.position).toBe('left');
    expect(s.stamp).toEqual({ projectId: 'demo', projectVersion: '1.0.0', digest: 'sha256:abc' });
    expect(s.tags.find((t) => t.id === 'T1')).toEqual({
      id: 'T1',
      type: 'FLOAT32',
      kind: 'external',
      access: 'RW',
      unit: 'bar',
      min: 0,
      max: 10,
      limits: { min: 1, max: 9 },
      valueTable: 'TT',
      deviceName: 'PLC trạm bơm',
    });
    expect(s.tags.find((t) => t.id === 'T2')).toMatchObject({ access: 'R', kind: 'internal' });
    expect(Object.keys(s.valueTables)).toEqual(['TT']);
    expect(f.calls[0]).toBe('/api/v1/projects/active');
  });

  it('màn hình đầu tải ngay sau tóm tắt (song song với phần còn lại), không tải màn hình khác', async () => {
    const f = fakeFetch(routes03(['tong-quan', 'bom1']));
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    expect(f.calls).toEqual(['/api/v1/projects/active', '/project/screens/tong-quan.screen.json']);
    await store.screen('tong-quan'); // nhập vào lượt đang chạy
    expect(f.calls).toHaveLength(2);
  });

  it('navigation vắng → null', async () => {
    const r = routes03(['a']);
    (r['/api/v1/projects/active'] as { json: Record<string, unknown> }).json = body03(['a'], {
      navigation: undefined,
    });
    const store = new ProjectStore({ fetch: fakeFetch(r).fn });
    const res = await store.open();
    expect(res.status === 'ok' && res.summary.navigation).toBeNull();
  });

  it('kết nối kiểu 0.2 (kênh/thiết bị) cũng cho tên thiết bị', async () => {
    const r = routes03(['a']);
    (r['/api/v1/projects/active'] as { json: Record<string, unknown> }).json = body03(['a'], {
      connections: {
        channels: [
          { id: 'ch', name: 'Kênh', kind: 'modbus-tcp', devices: [{ id: 'plc1', name: 'PLC 1' }] },
        ],
      },
    });
    const res = await new ProjectStore({ fetch: fakeFetch(r).fn }).open();
    expect(res.status === 'ok' && res.summary.tags[0].deviceName).toBe('PLC 1');
  });
});

describe('tải màn hình lười', () => {
  it('lần đầu tải qua /project/…, lần sau lấy từ cache; gọi đồng thời chỉ một yêu cầu', async () => {
    const f = fakeFetch(routes03(['a', 'b']));
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    const [m1, m2] = await Promise.all([store.screen('b'), store.screen('b')]);
    expect(m1).toBe(m2);
    expect(m1.id).toBe('b');
    expect(f.calls.filter((c) => c.includes('b.screen.json'))).toHaveLength(1);
    await store.screen('b');
    expect(f.calls.filter((c) => c.includes('b.screen.json'))).toHaveLength(1);
  });

  it('cache giữ tối đa 8 màn hình, bỏ cái dùng lâu nhất; truy cập làm "mới" lại', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `s${i}`);
    const f = fakeFetch(routes03(ids));
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    for (const id of ids.slice(0, 8)) await store.screen(id);
    expect(store.cached()).toHaveLength(8);
    await store.screen('s0'); // s0 thành mới nhất
    await store.screen('s8'); // đẩy s1 ra
    expect(store.cached()).toHaveLength(8);
    expect(store.cached()).toContain('s0');
    expect(store.cached()).not.toContain('s1');
    const before = f.calls.length;
    await store.screen('s1'); // phải tải lại
    expect(f.calls.length).toBe(before + 1);
  });

  it('lỗi một màn hình không ảnh hưởng màn hình khác, và không bị cache', async () => {
    const r = routes03(['a', 'bad', 'c']);
    r['/project/screens/bad.screen.json'] = { status: 500 };
    const f = fakeFetch(r);
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    await expect(store.screen('bad')).rejects.toBeInstanceOf(ScreenLoadError);
    await expect(store.screen('bad')).rejects.toMatchObject({ screenId: 'bad', status: 500 });
    expect((await store.screen('c')).id).toBe('c');
    expect((await store.screen('a')).id).toBe('a');
    r['/project/screens/bad.screen.json'] = { json: screen03('bad') };
    expect((await store.screen('bad')).id).toBe('bad');
  });

  it('JSON hỏng hoặc sai hình dạng → ScreenLoadError', async () => {
    const r = routes03(['a', 'x', 'y']);
    r['/project/screens/x.screen.json'] = { status: 200 }; // json() ném
    r['/project/screens/y.screen.json'] = { json: { id: 'y', name: 'y' } }; // thiếu items
    const store = new ProjectStore({ fetch: fakeFetch(r).fn });
    await store.open();
    await expect(store.screen('x')).rejects.toBeInstanceOf(ScreenLoadError);
    await expect(store.screen('y')).rejects.toBeInstanceOf(ScreenLoadError);
  });

  it('id không có trong project → ScreenLoadError, không gọi mạng', async () => {
    const f = fakeFetch(routes03(['a']));
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    const n = f.calls.length;
    await expect(store.screen('khong-co')).rejects.toMatchObject({ screenId: 'khong-co' });
    expect(f.calls.length).toBe(n);
  });

  it('SVG và binding của item tải qua /project/ với đường dẫn mã hóa từng đoạn', async () => {
    const r = routes03(['a']);
    r['/project/screens/a%231.svg'] = { text: '<svg/>' };
    r['/project/screens/a.bindings.json'] = {
      json: { elements: [{ elementUid: 'u', bindings: [] }] },
    };
    r['/project/screens/gone.svg'] = { status: 404 };
    const store = new ProjectStore({ fetch: fakeFetch(r).fn });
    await store.open();
    expect(await store.loadSvg('screens/a#1.svg')).toBe('<svg/>');
    expect(await store.loadBindings('screens/a.bindings.json')).toEqual([
      { elementUid: 'u', bindings: [] },
    ]);
    await expect(store.loadSvg('screens/gone.svg')).rejects.toThrow(/404/);
  });
});

describe('project 0.1 và 0.2 (bản đầy đủ trong projects/active)', () => {
  it('qua bộ chuyển: một item svg `svg1`, kích thước theo viewBox, nền giữ nguyên', async () => {
    const f = fakeFetch({ '/api/v1/projects/active': { json: legacyBody() } });
    const store = new ProjectStore({ fetch: f.fn });
    const res = await store.open();
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.summary.legacy).toBe(true);
    expect(res.summary.entry).toBe('main');
    expect(res.summary.navigation).toBeNull();
    expect(res.summary.screens).toEqual([{ id: 'main', name: 'Main', kind: 'screen' }]);
    const m = await store.screen('main');
    expect(m).toMatchObject({
      schemaVersion: '0.3.0',
      id: 'main',
      kind: 'screen',
      size: { width: 100, height: 100 },
      fitMode: 'contain',
      background: '#102030',
    });
    expect(m.items).toHaveLength(1);
    expect(m.items[0]).toMatchObject({
      id: 'svg1',
      type: 'svg',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      svgFile: 'screens/main.svg',
      bindingFile: 'screens/main.bindings.json',
      fit: 'contain',
      viewBox: [0, 0, 100, 100],
    });
    expect(f.calls).toEqual(['/api/v1/projects/active']); // không tải màn hình riêng
  });

  it('binding lấy từ thân projects/active, không gọi mạng', async () => {
    const f = fakeFetch({ '/api/v1/projects/active': { json: legacyBody() } });
    const store = new ProjectStore({ fetch: f.fn });
    await store.open();
    expect(await store.loadBindings('screens/main.bindings.json')).toEqual(
      LEGACY_SCREEN.bindings.elements,
    );
    expect(f.calls).toHaveLength(1);
  });

  it('project 0.1: tag mặc định chỉ đọc, kind simulation, không có bảng giá trị', async () => {
    const store = new ProjectStore({
      fetch: fakeFetch({ '/api/v1/projects/active': { json: legacyBody() } }).fn,
    });
    const res = await store.open();
    expect(res.status === 'ok' && res.summary.tags[0]).toEqual({
      id: 'LEVEL',
      type: 'FLOAT32',
      unit: 'm',
      access: 'R',
      kind: 'simulation',
    });
    expect(res.status === 'ok' && res.summary.valueTables).toEqual({});
  });

  it('màn hình cũ hỏng (thiếu fitMode) → ScreenLoadError riêng của màn hình đó', async () => {
    const bad = legacyBody();
    (bad.screens.main.screen as { fitMode?: string }).fitMode = undefined;
    const store = new ProjectStore({
      fetch: fakeFetch({ '/api/v1/projects/active': { json: bad } }).fn,
    });
    await store.open();
    await expect(store.screen('main')).rejects.toBeInstanceOf(ScreenLoadError);
  });
});

describe('lỗi', () => {
  it('503: chưa có project hợp lệ, trả danh sách lỗi', async () => {
    const errors = [{ code: 'E_SCHEMA', file: 'project.json', path: '/x', message: 'lỗi' }];
    const f = fakeFetch({
      '/api/v1/projects/active': { status: 503, json: { error: 'NO_VALID_PROJECT', errors } },
    });
    const res = await new ProjectStore({ fetch: f.fn }).open();
    expect(res).toEqual({ status: 'no-project', errors });
  });

  it('503 không có thân JSON: danh sách lỗi rỗng', async () => {
    const f = fakeFetch({ '/api/v1/projects/active': { status: 503 } });
    expect(await new ProjectStore({ fetch: f.fn }).open()).toEqual({
      status: 'no-project',
      errors: [],
    });
  });

  it('mã khác (500) hoặc thân lạ → ném lỗi', async () => {
    await expect(
      new ProjectStore({
        fetch: fakeFetch({ '/api/v1/projects/active': { status: 500 } }).fn,
      }).open(),
    ).rejects.toThrow(/500/);
    await expect(
      new ProjectStore({
        fetch: fakeFetch({ '/api/v1/projects/active': { json: { x: 1 } } }).fn,
      }).open(),
    ).rejects.toThrow();
  });

  it('401 (viewerLogin: required, chưa đăng nhập) → trạng thái login-required', async () => {
    const f = fakeFetch({
      '/api/v1/projects/active': { status: 401, json: { error: 'AUTH_REQUIRED' } },
    });
    expect(await new ProjectStore({ fetch: f.fn }).open()).toEqual({ status: 'login-required' });
  });
});
