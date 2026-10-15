// Luồng Nhập lại SVG (feature 008, T101; FR-028, FR-029; contract svg-import §7): idle → reading → importing → matching →
// resolve → applied | cancelled; lựa chọn mặc định "Mới"; "Bỏ binding" và "Giữ mồ côi"; Áp dụng thay SVG, `elements` và file
// binding trong MỘT bước hoàn tác; Hủy không đổi; hai item chung một tệp SVG; UID giữ qua lưu và mở lại. Dùng các cặp của T097.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BindingSet04, ScreenModel, SvgItem } from '@mat/project-schema';
import { importSvg, makeSeededUid, parseXml, type ImportResult } from '@mat/svg-import';
import { StudioStore } from '../app/store.ts';
import { createMockPlatform } from '../platform/mock.ts';
import { ImportFlow, type ImportRunner } from './import-flow.ts';
import {
  ReimportFlow,
  type ReimportPhase,
  type ReimportSharer,
  type ReimportTarget,
} from './reimport-flow.ts';
import { DASHBOARD_DEMO, dashboardDemo } from './test-fixtures.ts';

const PAIRS = resolve(DASHBOARD_DEMO, '../../tests/fixtures/svg-import/reimport');
const pair = (name: string) => ({
  v1: readFileSync(resolve(PAIRS, name, 'v1.svg'), 'utf8'),
  v2: new Uint8Array(readFileSync(resolve(PAIRS, name, 'v2.svg'))),
});

/** Bộ chạy giả: chạy importSvg thật (có `previous`) với bộ sinh UID cố định. */
const runner: ImportRunner = async (bytes, options) =>
  importSvg(bytes, {
    fileName: options.fileName,
    optimize: options.optimize,
    uid: makeSeededUid('n'),
    ...(options.previous ? { previous: options.previous } : {}),
  });

const screenOf = (items: SvgItem[]): ScreenModel =>
  ({
    schemaVersion: '0.4.0',
    id: 'bon-nuoc',
    name: 'Bồn nước',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    fitMode: 'contain',
    items,
  }) as ScreenModel;

const itemOf = (id: string, svgFile: string, uids: string[]): SvgItem =>
  ({
    id,
    type: 'svg',
    x: 0,
    y: 0,
    width: 1000,
    height: 600,
    svgFile,
    bindingFile: `screens/bon-nuoc.${id}.bindings.json`,
    viewBox: [0, 0, 1000, 600],
    elements: uids.map((u) => ({ elementUid: u, name: u })),
  }) as SvgItem;

const bindingOn = (itemId: string, uids: string[]): BindingSet04 => ({
  schemaVersion: '0.4.0',
  screenId: 'bon-nuoc',
  itemId,
  elements: uids.map((u) => ({
    elementUid: u,
    bindings: [
      {
        id: `b_${u}`,
        target: 'style.fill',
        source: { type: 'tag', tagId: 'Tank1.Level' },
        transform: { kind: 'direct' },
      },
    ],
  })) as BindingSet04['elements'],
});

const uidsOf = (svg: string): string[] => {
  const p = parseXml(svg);
  if (!p.ok) throw new Error('svg hỏng');
  return [...p.root.querySelectorAll('[data-mat-uid]')].map((e) => e.getAttribute('data-mat-uid')!);
};

function makeFlow(
  name: string,
  o: {
    bound?: string[];
    sharers?: ReimportSharer[];
    open?: Parameters<typeof Object>[0];
    run?: ImportRunner;
    openFn?: () => Promise<
      { name: string; bytes: Uint8Array } | { error: 'io' | 'too-large' | 'bad-extension' } | null
    >;
  } = {},
) {
  const { v1, v2 } = pair(name);
  const all = uidsOf(v1);
  const item = itemOf('svg_1', 'graphics/so-do.svg', all.slice(0, 3));
  const target: ReimportTarget = {
    screen: screenOf([item]),
    item,
    svg: v1,
    bindings: bindingOn('svg_1', o.bound ?? []),
    graphicsFiles: ['graphics/so-do.svg'],
    sharers: o.sharers ?? [],
  };
  const applied: Array<{
    edits?: ReadonlyArray<{ kind: string; [k: string]: unknown }>;
    replace?: Readonly<Record<string, string>>;
  }> = [];
  const flow = new ReimportFlow({
    open: o.openFn ?? (async () => ({ name: 'v2.svg', bytes: v2 })),
    run: o.run ?? runner,
    target: () => target,
    apply: (c) => void applied.push(c),
  });
  const phases: ReimportPhase[] = [];
  flow.subscribe(() => {
    if (phases.at(-1) !== flow.state.phase) phases.push(flow.state.phase);
  });
  return { flow, applied, phases, target, v1, all };
}

describe('ReimportFlow: máy trạng thái', () => {
  it('idle → reading → importing → matching → resolve; có đối chiếu và tóm tắt', async () => {
    const { flow, phases } = makeFlow('05-rename-add-delete');
    expect(flow.state.phase).toBe('idle');
    await flow.start();
    expect(phases).toEqual(['reading', 'importing', 'matching', 'resolve']);
    expect(flow.match!.orphans).toHaveLength(2);
    // Hai ứng viên chưa ai nhận cũng thành mồ côi khi người dùng để mặc định "Mới".
    expect(flow.summary()).toMatchObject({ kept: 40, added: 3, ambiguous: 2, orphans: 4 });
  });

  it('chọn file bị hủy: cancelled, không chạy importSvg', async () => {
    const run = vi.fn(runner);
    const { flow, phases } = makeFlow('05-rename-add-delete', { openFn: async () => null, run });
    await flow.start();
    expect(phases).toEqual(['reading', 'cancelled']);
    expect(run).not.toHaveBeenCalled();
  });

  it('file bị từ chối (DTD): error mã E_IMPORT_DTD, không đổi gì', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a SYSTEM "file:///x">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>`;
    const { flow, applied } = makeFlow('05-rename-add-delete', {
      openFn: async () => ({ name: 'x.svg', bytes: new TextEncoder().encode(evil) }),
    });
    await flow.start();
    expect(flow.state.phase).toBe('error');
    expect(flow.state.error?.code).toBe('E_IMPORT_DTD');
    expect(flow.commit()).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it('item chưa có SVG đọc được: error E_NO_TARGET', async () => {
    const { flow, target } = makeFlow('05-rename-add-delete');
    const f = new ReimportFlow({
      open: async () => null,
      run: runner,
      target: () => ({ ...target, svg: null }),
      apply: () => undefined,
    });
    await f.start();
    expect(f.state.phase).toBe('error');
    expect(f.state.error?.code).toBe('E_NO_TARGET');
    void flow;
  });

  it('bộ chạy ném lỗi: error mã worker, không treo', async () => {
    const { flow } = makeFlow('05-rename-add-delete', {
      run: async () => {
        throw new Error('chết');
      },
    });
    await flow.start();
    expect(flow.state.error).toMatchObject({ code: 'worker', detail: 'chết' });
  });

  it('bộ chạy nhận bản cũ (previous) kèm UID có binding và sự kiện', async () => {
    const seen: Array<unknown> = [];
    const { flow, all } = makeFlow('05-rename-add-delete', {
      bound: ['el_smlzq3mmey'],
      run: async (b, o) => {
        seen.push(o.previous);
        return runner(b, o);
      },
    });
    await flow.start();
    const prev = seen[0] as { bound: Set<string>; svg: string };
    expect([...prev.bound]).toEqual(['el_smlzq3mmey']);
    expect(all).toContain('el_smlzq3mmey');
  });

  it('Hủy khi đang importing: kết quả muộn bị bỏ, vẫn cancelled', async () => {
    let release: (r: ImportResult) => void = () => undefined;
    const { flow, applied } = makeFlow('05-rename-add-delete', {
      run: () => new Promise((r) => (release = r)),
    });
    const p = flow.start();
    await vi.waitFor(() => expect(flow.state.phase).toBe('importing'));
    flow.cancel();
    release(importSvg(pair('05-rename-add-delete').v2, { uid: makeSeededUid('n') }));
    await p;
    expect(flow.state.phase).toBe('cancelled');
    expect(applied).toHaveLength(0);
  });
});

describe('ReimportFlow: lựa chọn và mồ côi', () => {
  it('mặc định mọi mục cần chọn là "Mới"; Áp dụng không gán UID cũ cho chúng', async () => {
    const { flow, applied } = makeFlow('05-rename-add-delete');
    await flow.start();
    const amb = flow.match!.ambiguous;
    expect(amb).toHaveLength(2);
    expect(flow.commit()).toBe(true);
    const svg = Object.values(applied[0]!.replace!)[0]!;
    const uids = new Set(uidsOf(svg));
    for (const a of amb) for (const c of a.candidates) expect(uids.has(c.oldUid)).toBe(false);
  });

  it('chọn ứng viên cũ: phần tử mới nhận UID cũ; chọn lại ở mục khác không trùng UID', async () => {
    const { flow, applied } = makeFlow('05-rename-add-delete');
    await flow.start();
    const [a, b] = flow.match!.ambiguous;
    const pick = a!.candidates[0]!.oldUid;
    flow.choose(a!.newPath, pick);
    flow.choose('/khong/co', pick); // không phải mục cần chọn: bỏ qua
    expect(flow.state.choices[a!.newPath]).toBe(pick);
    if (b!.candidates.some((c) => c.oldUid === pick)) {
      flow.choose(b!.newPath, pick);
      expect(flow.state.choices[a!.newPath]).toBeNull();
    }
    flow.choose(b!.newPath, 'el_khong_phai_ung_vien');
    expect(flow.state.choices[b!.newPath]).not.toBe('el_khong_phai_ung_vien');
    flow.commit();
    const uids = uidsOf(Object.values(applied[0]!.replace!)[0]!);
    expect(new Set(uids).size).toBe(uids.length); // không UID trùng
    expect(uids).toContain(pick);
  });

  it('mồ côi có binding: mặc định "Bỏ binding" gỡ mục binding; "Giữ" để lại và không khai báo ở elements', async () => {
    const orphan = 'el_smlzq3mmey';
    const keepUid = 'el_3gjandbmwr'; // khớp được (bước 4)
    const drop = makeFlow('05-rename-add-delete', { bound: [orphan, keepUid] });
    await drop.flow.start();
    expect(drop.flow.summary().orphansBound).toBe(1);
    drop.flow.commit();
    const setDrop = drop.applied[0]!.edits!.find((e) => e.kind === 'svgBindings')!
      .set as BindingSet04;
    expect(setDrop.elements.map((e) => e.elementUid)).toEqual([keepUid]);

    const keep = makeFlow('05-rename-add-delete', { bound: [orphan, keepUid] });
    await keep.flow.start();
    keep.flow.setOrphan(orphan, 'keep');
    expect(keep.flow.keptOrphanCount()).toBe(1);
    keep.flow.commit();
    const setKeep = keep.applied[0]!.edits!.find((e) => e.kind === 'svgBindings')!
      .set as BindingSet04;
    expect(setKeep.elements.map((e) => e.elementUid).sort()).toEqual([keepUid, orphan].sort());
    const screen = keep.applied[0]!.edits!.find((e) => e.kind === 'screenUpsert')!
      .screen as ScreenModel;
    const item = screen.items[0] as SvgItem;
    expect(item.elements.map((e) => e.elementUid)).not.toContain(orphan); // E_REF_UID
    expect(item.elements.map((e) => e.elementUid)).toContain(keepUid);
  });

  it('phần tử khớp có binding mà không có nhãn vẫn được khai báo trong elements', async () => {
    const { flow, applied } = makeFlow('05-rename-add-delete', { bound: ['el_6n6y6bq2g4'] });
    await flow.start();
    flow.commit();
    const screen = applied[0]!.edits!.find((e) => e.kind === 'screenUpsert')!.screen as ScreenModel;
    expect((screen.items[0] as SvgItem).elements.map((e) => e.elementUid)).toContain(
      'el_6n6y6bq2g4',
    );
  });

  it('UID khớp được giữ nguyên trong SVG mới (FR-029) và viewBox của item theo SVG mới', async () => {
    const { flow, applied, v1 } = makeFlow('02-inkscape-plain');
    await flow.start();
    flow.commit();
    const out = Object.values(applied[0]!.replace!)[0]!;
    expect(new Set(uidsOf(out))).toEqual(new Set(uidsOf(v1)));
    const screen = applied[0]!.edits!.find((e) => e.kind === 'screenUpsert')!.screen as ScreenModel;
    expect((screen.items[0] as SvgItem).viewBox).toHaveLength(4);
  });

  it('Hủy ở resolve: không gọi apply', async () => {
    const { flow, applied } = makeFlow('05-rename-add-delete');
    await flow.start();
    flow.cancel();
    expect(flow.state.phase).toBe('cancelled');
    expect(flow.commit()).toBe(false);
    expect(applied).toHaveLength(0);
  });

  it('commit chỉ hợp lệ ở resolve và chỉ một lần', async () => {
    const { flow, applied } = makeFlow('02-inkscape-plain');
    expect(flow.commit()).toBe(false);
    await flow.start();
    expect(flow.commit()).toBe(true);
    expect(flow.state.phase).toBe('applied');
    expect(flow.commit()).toBe(false);
    expect(applied).toHaveLength(1);
  });
});

describe('ReimportFlow: hai item chung một tệp SVG', () => {
  const sharerOf = (v1: string): ReimportSharer => {
    const item = itemOf('svg_2', 'graphics/so-do.svg', uidsOf(v1).slice(0, 2));
    return { screen: screenOf([item]), item, bindings: bindingOn('svg_2', ['el_smlzq3mmey']) };
  };

  it('có item dùng chung: hasSharers; mặc định "tách": file mới, item khác giữ file cũ', async () => {
    const { v1 } = pair('05-rename-add-delete');
    const { flow, applied } = makeFlow('05-rename-add-delete', { sharers: [sharerOf(v1)] });
    await flow.start();
    expect(flow.hasSharers).toBe(true);
    expect(flow.state.shareMode).toBe('split');
    flow.commit();
    const files = Object.keys(applied[0]!.replace!);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe('graphics/so-do.svg');
    expect(files[0]).toMatch(/^graphics\/.+\.svg$/);
    const kinds = applied[0]!.edits!.filter((e) => e.kind === 'svgBindings');
    expect(kinds).toHaveLength(1); // chỉ file binding của item này
  });

  it('"áp cho mọi thể hiện": ghi đè file cũ, cập nhật cả item kia (bỏ binding mồ côi)', async () => {
    const { v1 } = pair('05-rename-add-delete');
    const { flow, applied } = makeFlow('05-rename-add-delete', { sharers: [sharerOf(v1)] });
    await flow.start();
    flow.setShare('all');
    flow.commit();
    expect(Object.keys(applied[0]!.replace!)).toEqual(['graphics/so-do.svg']);
    const sets = applied[0]!.edits!.filter((e) => e.kind === 'svgBindings');
    expect(sets).toHaveLength(2);
    const other = sets.find((e) => e.file === 'screens/bon-nuoc.svg_2.bindings.json')!;
    expect((other.set as BindingSet04).elements).toHaveLength(0); // mồ côi bị bỏ
  });

  it('không có item dùng chung: hasSharers false, ghi đè file của chính nó', async () => {
    const { flow, applied } = makeFlow('02-inkscape-plain');
    await flow.start();
    expect(flow.hasSharers).toBe(false);
    flow.commit();
    expect(Object.keys(applied[0]!.replace!)).toEqual(['graphics/so-do.svg']);
  });
});

describe('Nhập lại vào store: một bước hoàn tác; UID qua Lưu và mở lại', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const platform = createMockPlatform();
    platform.control.useProject(dashboardDemo());
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    await store.validateNow();
    const { v1, v2 } = pair('05-rename-add-delete');
    const screenOfStore = () =>
      store.state.outline.screens.find((s) => s.id === 'bon-nuoc')!.model!;
    const projectVersion = String(
      (store.state.outline.project as unknown as { schemaVersion: string }).schemaVersion,
    );
    // Nhập v1 (đã có UID) như một item mới, rồi gắn binding vào một phần tử khớp và một mồ côi.
    const first = new ImportFlow({
      open: async () => ({ name: 'so-do.svg', bytes: new TextEncoder().encode(v1) }),
      run: async (bytes, o) =>
        importSvg(bytes, { fileName: o.fileName, optimize: false, uid: makeSeededUid('z') }),
      target: () => ({
        screen: screenOfStore(),
        graphicsFiles: Object.keys(store.state.docs).filter((r) => r.startsWith('graphics/')),
        schemaVersion: projectVersion,
      }),
      apply: (c) => store.applyChange(c),
    });
    await first.start();
    const plan = first.commit();
    if (!plan?.ok) throw new Error('nhập v1 hỏng');
    const itemId = plan.item.id;
    const bindingFile = plan.bindingFile;
    store.edit([
      {
        kind: 'svgBindings',
        file: bindingFile,
        set: bindingOn(itemId, ['el_3gjandbmwr', 'el_smlzq3mmey']),
      },
    ]);
    const svgFile = plan.svgFile;
    // Nhập mới luôn sinh UID mới; thay bằng bản v1 đã có UID cố định (như file đã nhập từ trước).
    store.applyChange({ replace: { [svgFile]: v1 } });
    const makeReimport = () =>
      new ReimportFlow({
        open: async () => ({ name: 'v2.svg', bytes: v2 }),
        run: runner,
        target: () => {
          const screen = screenOfStore();
          const item = screen.items.find((i) => i.id === itemId) as SvgItem;
          return {
            screen,
            item,
            svg: store.textOf(item.svgFile),
            bindings: store.state.docs[item.bindingFile]!.value as BindingSet04,
            graphicsFiles: Object.keys(store.state.docs).filter((r) => r.startsWith('graphics/')),
            sharers: [],
          };
        },
        apply: (c) => store.applyChange(c),
      });
    return { store, platform, itemId, bindingFile, svgFile, makeReimport, screenOfStore };
  }

  it('Áp dụng: SVG, elements và binding đổi trong MỘT bước; Ctrl+Z trả lại cả ba; Hủy không đổi', async () => {
    const { store, bindingFile, svgFile, makeReimport } = await setup();
    const svg0 = store.textOf(svgFile);
    const bind0 = JSON.stringify(store.state.docs[bindingFile]!.value);

    const cancelled = makeReimport();
    await cancelled.start();
    cancelled.cancel();
    expect(store.textOf(svgFile)).toBe(svg0);

    const flow = makeReimport();
    await flow.start();
    expect(flow.commit()).toBe(true);
    expect(store.textOf(svgFile)).not.toBe(svg0);
    const set = store.state.docs[bindingFile]!.value as BindingSet04;
    expect(set.elements.map((e) => e.elementUid)).toEqual(['el_3gjandbmwr']); // mồ côi bị bỏ
    store.undo(); // một lần hoàn tác trả lại cả SVG và binding
    expect(store.textOf(svgFile)).toBe(svg0);
    expect(JSON.stringify(store.state.docs[bindingFile]!.value)).toBe(bind0);
    store.redo();
    expect(store.textOf(svgFile)).not.toBe(svg0);
  });

  it('UID giữ qua Lưu rồi mở lại project (FR-029)', async () => {
    const { store, platform, svgFile, bindingFile, makeReimport } = await setup();
    const flow = makeReimport();
    await flow.start();
    flow.commit();
    const uidsBefore = uidsOf(store.textOf(svgFile));
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.writes.length).toBeGreaterThan(0);
    // Mở lại từ đĩa: project gốc cộng các file vừa ghi (nền giả đọc lại từ bộ file đã nạp).
    const disk = { ...dashboardDemo() };
    for (const w of platform.control.writes) disk[w.rel] = w.content;
    const platform2 = createMockPlatform();
    platform2.control.useProject(disk);
    const reopened = new StudioStore({ platform: platform2 });
    expect(await reopened.openProject()).toBe(true);
    expect(uidsOf(reopened.textOf(svgFile))).toEqual(uidsBefore);
    expect(
      (reopened.state.docs[bindingFile]!.value as BindingSet04).elements.map((e) => e.elementUid),
    ).toEqual(['el_3gjandbmwr']);
  });
});
