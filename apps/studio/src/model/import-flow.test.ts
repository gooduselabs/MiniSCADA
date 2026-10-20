// Luồng Nhập SVG (feature 008, T056; data-model §3 máy trạng thái; FR-011, D29): chọn file → Worker chạy importSvg →
// xem trước → Nhập (một bước hoàn tác) hoặc Hủy (không đổi tài liệu). Worker được thay bằng bộ chạy giả.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenModel, SvgItem } from '@mat/project-schema';
import { importSvg, makeSeededUid, type ImportResult } from '@mat/svg-import';
import { StudioStore } from '../app/store.ts';
import { createMockPlatform } from '../platform/mock.ts';
import {
  ImportFlow,
  fitItemSize,
  planImport,
  type ImportRunner,
  type ImportState,
  type SvgOpenOutcome,
} from './import-flow.ts';
import { uniqueSvgPath } from './svg-doc.ts';
import { dashboardDemo } from './test-fixtures.ts';

const NS = 'http://www.w3.org/2000/svg';
const svg = (body: string, attrs = 'width="400" height="300" viewBox="0 0 400 300"') =>
  `<svg xmlns="${NS}" ${attrs}>${body}</svg>`;
const SAMPLE = svg(
  '<g id="Bon_nuoc"><rect id="Muc" x="10" y="10" width="50" height="80"/></g><circle cx="200" cy="100" r="30"/>',
);
const bytesOf = (s: string) => new TextEncoder().encode(s);

/** Bộ chạy giả của Worker: chạy importSvg thật (jsdom có DOMParser) với bộ sinh UID cố định, ghi lại tham số. */
function fakeRunner() {
  const calls: Array<{ optimize: boolean }> = [];
  const run: ImportRunner = async (bytes, options) => {
    calls.push({ optimize: options.optimize });
    return importSvg(bytes, {
      fileName: options.fileName,
      optimize: options.optimize,
      uid: makeSeededUid('t'),
    });
  };
  return { run, calls };
}

function screenOf(items: SvgItem[] = [], size = { width: 1920, height: 1080 }): ScreenModel {
  return {
    schemaVersion: '0.3.0',
    id: 'bon-nuoc',
    name: 'Bồn nước',
    kind: 'screen',
    size,
    fitMode: 'contain',
    items,
  } as ScreenModel;
}

const target = (screen = screenOf(), taken: string[] = []) => ({
  screen,
  graphicsFiles: taken,
  schemaVersion: '0.3.0',
});

function makeFlow(
  opts: {
    open?: () => Promise<SvgOpenOutcome>;
    run?: ImportRunner;
    screen?: ScreenModel;
    taken?: string[];
  } = {},
) {
  const applied: Array<Parameters<ConstructorParameters<typeof ImportFlow>[0]['apply']>[0]> = [];
  const runner = fakeRunner();
  const flow = new ImportFlow({
    open: opts.open ?? (async () => ({ name: 'Sơ đồ Bồn.svg', bytes: bytesOf(SAMPLE) })),
    run: opts.run ?? runner.run,
    target: () => target(opts.screen, opts.taken),
    apply: (c) => void applied.push(c),
  });
  const phases: string[] = [];
  flow.subscribe(() => {
    const p = flow.state.phase;
    if (phases.at(-1) !== p) phases.push(p);
  });
  return { flow, applied, phases, runner };
}

describe('ImportFlow: máy trạng thái', () => {
  it('idle → reading → importing → preview; có kết quả, báo cáo và tên file', async () => {
    const { flow, phases } = makeFlow();
    expect(flow.state.phase).toBe('idle');
    await flow.start();
    expect(phases).toEqual(['reading', 'importing', 'preview']);
    const s = flow.state;
    expect(s.phase).toBe('preview');
    expect(s.fileName).toBe('Sơ đồ Bồn.svg');
    expect(s.result?.ok).toBe(true);
    expect(s.options.optimize).toBe(false);
  });

  it('người dùng hủy hộp thoại chọn file: cancelled, không chạy importSvg', async () => {
    const runner = fakeRunner();
    const { flow, phases } = makeFlow({ open: async () => null, run: runner.run });
    await flow.start();
    expect(phases).toEqual(['reading', 'cancelled']);
    expect(runner.calls).toHaveLength(0);
  });

  it.each([
    ['too-large', 'E_IMPORT_LIMIT'],
    ['bad-extension', 'E_IMPORT_EXT'],
  ] as const)('svg_open báo %s: error với mã %s, không chạy importSvg', async (err, code) => {
    const runner = fakeRunner();
    const { flow } = makeFlow({ open: async () => ({ error: err }), run: runner.run });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.state.error?.code).toBe(code);
    expect(runner.calls).toHaveLength(0);
  });

  it('svg_open lỗi io: error mã io kèm chi tiết', async () => {
    const { flow } = makeFlow({ open: async () => ({ error: 'io', detail: 'không đọc được' }) });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.state.error).toMatchObject({ code: 'io', detail: 'không đọc được' });
  });

  it('file DTD nguy hiểm bị importSvg từ chối: error giữ mã E_IMPORT_DTD và báo cáo', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a SYSTEM "file:///etc/passwd">]><svg xmlns="${NS}">&a;</svg>`;
    const { flow } = makeFlow({ open: async () => ({ name: 'x.svg', bytes: bytesOf(evil) }) });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.state.error?.code).toBe('E_IMPORT_DTD');
    expect(flow.state.result?.ok).toBe(false);
  });

  it('bộ chạy ném lỗi (Worker chết): error mã worker, không treo ở importing', async () => {
    const { flow } = makeFlow({
      run: async () => {
        throw new Error('worker chết');
      },
    });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.state.error?.code).toBe('worker');
  });

  it('đổi Tối ưu: preview → importing → preview và chạy lại với tùy chọn mới', async () => {
    const { flow, phases, runner } = makeFlow();
    await flow.start();
    await flow.setOptimize(true);
    expect(phases).toEqual(['reading', 'importing', 'preview', 'importing', 'preview']);
    expect(runner.calls.map((c) => c.optimize)).toEqual([false, true]);
    expect(flow.state.options.optimize).toBe(true);
  });

  it('đổi Tối ưu hai lần liên tiếp: chỉ kết quả của lần sau được nhận', async () => {
    const gates: Array<() => void> = [];
    const results: ImportResult[] = [];
    const run: ImportRunner = (bytes, options) =>
      new Promise((resolve) => {
        const r = importSvg(bytes, { optimize: options.optimize, uid: makeSeededUid('t') });
        results.push(r);
        gates.push(() => resolve(r));
      });
    const { flow } = makeFlow({ run });
    const first = flow.start();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!();
    await first;
    const a = flow.setOptimize(true);
    const b = flow.setOptimize(false);
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[2]!(); // lần sau xong trước
    gates[1]!(); // lần trước xong muộn: bị bỏ
    await Promise.all([a, b]);
    expect(flow.state.options.optimize).toBe(false);
    expect(flow.state.result).toBe(results[2]);
  });

  it('chọn file khác (pick lại) từ error: chạy lại từ reading', async () => {
    let n = 0;
    const { flow, phases } = makeFlow({
      open: async () =>
        n++ === 0 ? { error: 'too-large' as const } : { name: 'b.svg', bytes: bytesOf(SAMPLE) },
    });
    await flow.start();
    await flow.start();
    expect(phases).toEqual(['reading', 'error', 'reading', 'importing', 'preview']);
  });

  it('commit chỉ hợp lệ ở preview', async () => {
    const { flow, applied } = makeFlow();
    expect(flow.commit()).toBeNull();
    await flow.start();
    expect(flow.commit()).not.toBeNull();
    expect(flow.state.phase).toBe('committed');
    expect(flow.commit()).toBeNull();
    expect(applied).toHaveLength(1);
  });

  it('commit với file bị từ chối: không đổi gì', async () => {
    const { flow, applied } = makeFlow({
      open: async () => ({ name: 'a.svg', bytes: bytesOf('không phải xml') }),
    });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.commit()).toBeNull();
    expect(applied).toHaveLength(0);
  });

  it('Hủy ở preview: cancelled, không gọi apply (tài liệu không đổi)', async () => {
    const { flow, applied } = makeFlow();
    await flow.start();
    flow.cancel();
    expect(flow.state.phase).toBe('cancelled');
    expect(applied).toHaveLength(0);
  });

  it('Hủy khi đang importing: kết quả muộn bị bỏ, vẫn là cancelled', async () => {
    let release: (r: ImportResult) => void = () => undefined;
    const run: ImportRunner = () => new Promise((r) => (release = r));
    const { flow } = makeFlow({ run });
    const p = flow.start();
    await vi.waitFor(() => expect(flow.state.phase).toBe('importing'));
    flow.cancel();
    release(importSvg(bytesOf(SAMPLE), { uid: makeSeededUid('t') }));
    await p;
    expect(flow.state.phase).toBe('cancelled');
  });

  it('tiến độ từ Worker được ghi vào state', async () => {
    const run: ImportRunner = async (bytes, options, onProgress) => {
      onProgress?.(0.5);
      return importSvg(bytes, { optimize: options.optimize, uid: makeSeededUid('t') });
    };
    const seen: Array<number | null> = [];
    const { flow } = makeFlow({ run });
    flow.subscribe(() => seen.push((flow.state as ImportState).progress));
    await flow.start();
    expect(seen).toContain(0.5);
  });
});

describe('planImport: item, file SVG và file binding (D29)', () => {
  const ok = (s = SAMPLE, name = 'Sơ đồ Bồn.svg') => {
    const r = importSvg(bytesOf(s), { fileName: name, uid: makeSeededUid('t') });
    if (!r.ok) throw new Error('fixture hỏng');
    return r;
  };

  it('màn hình lưới (feature 012): item svg không có tọa độ, đặt vào ô trống đầu tiên', () => {
    const grid = {
      ...screenOf(),
      layout: {
        mode: 'grid',
        columns: 12,
        rows: [{ id: 'r1', height: 'auto', cells: [{ id: 'c1', span: 12 }] }],
      },
    } as unknown as ScreenModel;
    const p = planImport(ok(), 'Sơ đồ Bồn.svg', target(grid));
    if (!p.ok) throw new Error(p.reason);
    const up = p.change.edits![0] as unknown as {
      screen: ScreenModel & { layout: { rows: Array<{ cells: Array<{ item?: string }> }> } };
    };
    const placed = up.screen.items.at(-1) as unknown as Record<string, unknown>;
    expect(placed.x).toBeUndefined();
    expect(placed.width).toBeUndefined();
    expect(up.screen.layout.rows[0]!.cells[0]!.item).toBe('svg_1');
  });

  it('item svg ở (0, 0), cỡ viewBox, file graphics/<slug>.svg, binding rỗng, một màn hình sửa', () => {
    const r = ok();
    const p = planImport(r, 'Sơ đồ Bồn.svg', target());
    if (!p.ok) throw new Error(p.reason);
    const item = p.item;
    expect(item).toMatchObject({
      id: 'svg_1',
      type: 'svg',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      svgFile: 'graphics/so-do-bon.svg',
      bindingFile: 'screens/bon-nuoc.svg_1.bindings.json',
      viewBox: r.viewBox,
    });
    expect(p.change.replace).toEqual({ 'graphics/so-do-bon.svg': r.svg });
    const edits = p.change.edits ?? [];
    expect(edits.map((e) => e.kind)).toEqual(['screenUpsert', 'svgBindings']);
    const bind = edits[1] as { file: string; set: { elements: unknown[]; itemId: string } };
    expect(bind.file).toBe('screens/bon-nuoc.svg_1.bindings.json');
    expect(bind.set).toMatchObject({ screenId: 'bon-nuoc', itemId: 'svg_1', elements: [] });
  });

  it('thu vừa màn hình khi viewBox lớn hơn; giữ tỉ lệ; không phóng to file nhỏ', () => {
    expect(fitItemSize([0, 0, 4000, 3000], { width: 1920, height: 1080 })).toEqual({
      width: 1440,
      height: 1080,
    });
    expect(fitItemSize([0, 0, 100, 50], { width: 1920, height: 1080 })).toEqual({
      width: 100,
      height: 50,
    });
    expect(fitItemSize([0, 0, 0.2, 0.2], { width: 1920, height: 1080 })).toEqual({
      width: 1,
      height: 1,
    });
  });

  it('id item không trùng; slug trùng tên thêm -2, -3', () => {
    const exist = ok();
    const first = planImport(exist, 'a.svg', target(screenOf(), ['graphics/a.svg']));
    if (!first.ok) throw new Error(first.reason);
    expect(first.item.svgFile).toBe('graphics/a-2.svg');
    const screen = screenOf([first.item as SvgItem]);
    const second = planImport(
      exist,
      'a.svg',
      target(screen, ['graphics/a.svg', 'graphics/a-2.svg']),
    );
    if (!second.ok) throw new Error(second.reason);
    expect(second.item.id).toBe('svg_2');
    expect(second.item.svgFile).toBe('graphics/a-3.svg');
  });

  it('item.elements chỉ liệt kê phần tử có nhãn (tên riêng), kèm tên', () => {
    const r = ok(
      svg('<g id="Bon_nuoc"><rect id="Muc" x="1" y="1" width="5" height="5"/></g><circle r="3"/>'),
    );
    const p = planImport(r, 'a.svg', target());
    if (!p.ok) throw new Error(p.reason);
    const named = r.elements.filter((e) => e.label !== undefined);
    expect(named.length).toBeGreaterThan(0);
    expect((p.item as SvgItem).elements).toEqual(
      named.map((e) => ({ elementUid: e.uid, name: e.name })),
    );
  });

  it('từ chối khi đủ trần item svg (0.3: 8) hoặc màn hình đầy item', () => {
    const r = ok();
    const items = Array.from(
      { length: 8 },
      (_, i) =>
        ({
          id: `svg_${i + 1}`,
          type: 'svg',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          svgFile: `graphics/s${i}.svg`,
          bindingFile: `screens/bon-nuoc.svg_${i + 1}.bindings.json`,
          viewBox: [0, 0, 10, 10],
          elements: [],
        }) as SvgItem,
    );
    const p = planImport(r, 'a.svg', target(screenOf(items)));
    expect(p).toMatchObject({ ok: false, reason: 'max-svg-items' });
    // 0.4: trần 64 nên vẫn nhập được.
    const p4 = planImport(r, 'a.svg', { ...target(screenOf(items)), schemaVersion: '0.4.0' });
    expect(p4.ok).toBe(true);
  });

  it('đường dẫn tổng ≤ 128 byte: slug dài bị cắt ở 48 ký tự', () => {
    const p = uniqueSvgPath('a'.repeat(300) + '.svg', []);
    expect(p).toBe(`graphics/${'a'.repeat(48)}.svg`);
    expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(128);
  });
});

describe('Nhập vào store: một bước hoàn tác', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  async function opened() {
    const platform = createMockPlatform();
    platform.control.useProject(dashboardDemo());
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    await store.validateNow();
    return { store, platform };
  }

  it('Nhập thêm item, file SVG và file binding chưa ghi đĩa; Ctrl+Z gỡ cả ba một lần; Ctrl+Y làm lại', async () => {
    const { store, platform } = await opened();
    const screen = store.state.outline.screens.find((s) => s.id === 'bon-nuoc')!.model!;
    const before = screen.items.length;
    const svgItems = screen.items.filter((i) => i.type === 'svg').length;
    const flow = new ImportFlow({
      open: async () => ({ name: 'Sơ đồ mới.svg', bytes: bytesOf(SAMPLE) }),
      run: fakeRunner().run,
      target: () => ({
        screen: store.state.outline.screens.find((s) => s.id === 'bon-nuoc')!.model!,
        graphicsFiles: Object.keys(store.state.docs).filter((r) => r.startsWith('graphics/')),
        schemaVersion: String(
          (store.state.outline.project as unknown as { schemaVersion: string }).schemaVersion,
        ),
      }),
      apply: (c) => store.applyChange(c),
    });
    await flow.start();
    const plan = flow.commit();
    if (!plan?.ok) throw new Error('commit hỏng');
    const after = store.state.outline.screens.find((s) => s.id === 'bon-nuoc')!.model!;
    expect(after.items).toHaveLength(before + 1);
    expect(after.items.filter((i) => i.type === 'svg')).toHaveLength(svgItems + 1);
    expect(store.dirtyFiles().sort()).toEqual(
      [
        'graphics/so-do-moi.svg',
        'screens/bon-nuoc.screen.json',
        `screens/bon-nuoc.${plan.item.id}.bindings.json`,
      ].sort(),
    );
    expect(platform.control.writes).toHaveLength(0); // chưa ghi đĩa
    store.undo();
    expect(store.state.outline.screens.find((s) => s.id === 'bon-nuoc')!.model!.items).toHaveLength(
      before,
    );
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.docs['graphics/so-do-moi.svg']).toBeUndefined();
    store.redo();
    expect(store.dirtyFiles()).toHaveLength(3);
  });

  it('Hủy: tài liệu không đổi, lịch sử không thêm bước', async () => {
    const { store } = await opened();
    const flow = new ImportFlow({
      open: async () => ({ name: 'a.svg', bytes: bytesOf(SAMPLE) }),
      run: fakeRunner().run,
      target: () => null,
      apply: (c) => store.applyChange(c),
    });
    await flow.start();
    flow.cancel();
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.commandContext().canUndo).toBe(false);
  });
});
