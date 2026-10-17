// Trạng thái soạn thảo và tự lưu của trình vẽ SVG (feature 011, T156; FR-105, FR-112, FR-113; contracts/svg-editor.md §6):
// lớp ẩn/khóa và đường gióng ở `.mat-editor/svg-state.json` (không vào gói, không đổi SVG), tự lưu 30 s (ghi tạm rồi đổi tên ở
// lớp Rust), tối đa 3 bản mỗi tệp, khôi phục sau tắt đột ngột (kill giả: bỏ đối tượng không dọn), phát hiện đổi trên đĩa
// (mtime và băm), không ghi đè im lặng.
import { describe, expect, it } from 'vitest';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import {
  SVG_STATE_FILE,
  SvgStateStore,
  emptySvgState,
  layerState,
  parseSvgState,
  serializeSvgState,
  withGuides,
  withLayerState,
  renameLayerState,
  dropLayerState,
} from './svg-state.ts';
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_KEEP,
  Autosaver,
  autosaveName,
  findRestorable,
  parseAutosaveName,
  platformAutosaveIo,
} from './svg/autosave.ts';
import { DiskWatcher, WATCH_INTERVAL_MS, compareDisk } from './svg/watch.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect/></svg>';

async function project(files: Record<string, string> = {}): Promise<MockPlatform> {
  const p = createMockPlatform();
  p.control.useProject({ 'project.json': '{}', 'graphics/bom.svg': SVG, ...files });
  await p.pickProject();
  return p;
}

/** Bộ hẹn giờ giả: chạy tay bằng `run()`. */
function fakeTimers() {
  let now = 1_800_000_000_000;
  const timers = new Map<number, { fn: () => void; at: number; every: number }>();
  let id = 0;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    setInterval: (fn: () => void, ms: number) => {
      timers.set(++id, { fn, at: now + ms, every: ms });
      return id;
    },
    clearInterval: (h: unknown) => void timers.delete(h as number),
    /** Chạy các hẹn giờ đã tới hạn. */
    due(): number {
      let n = 0;
      for (const t of timers.values())
        while (t.at <= now) {
          t.at += t.every;
          t.fn();
          n++;
        }
      return n;
    },
    get count() {
      return timers.size;
    },
  };
}

describe('svg-state.json: lớp ẩn/khóa, đường gióng (FR-105)', () => {
  it('đọc khoan dung: thiếu, hỏng, sai phiên bản ⇒ trạng thái rỗng; đúng dạng giữ nguyên', () => {
    expect(parseSvgState(null)).toEqual(emptySvgState());
    expect(parseSvgState('{hỏng')).toEqual(emptySvgState());
    expect(parseSvgState('{"version":2,"files":{}}')).toEqual(emptySvgState());
    const text =
      '{ "version": 1, "files": { "svg/bom.svg": { "layers": { "Bơm": { "hidden": false, "locked": true } }, "guides": [ { "axis": "x", "pos": 120.5 } ] } } }';
    const s = parseSvgState(text);
    expect(layerState(s, 'svg/bom.svg', 'Bơm')).toEqual({ hidden: false, locked: true });
    expect(s.files['svg/bom.svg'].guides).toEqual([{ axis: 'x', pos: 120.5 }]);
    expect(parseSvgState(serializeSvgState(s))).toEqual(s);
  });

  it('bỏ mục sai kiểu (đường dẫn lạ, cờ không phải boolean, gióng sai trục) thay vì hỏng cả tệp', () => {
    const s = parseSvgState(
      JSON.stringify({
        version: 1,
        files: {
          '../x.svg': { layers: { A: { hidden: true, locked: false } } },
          'graphics/a.svg': {
            layers: { A: { hidden: 'có', locked: true }, B: { hidden: true, locked: false } },
            guides: [
              { axis: 'z', pos: 1 },
              { axis: 'y', pos: 'x' },
              { axis: 'y', pos: 4 },
            ],
          },
        },
      }),
    );
    expect(Object.keys(s.files)).toEqual(['graphics/a.svg']);
    expect(layerState(s, 'graphics/a.svg', 'A')).toEqual({ hidden: false, locked: true });
    expect(layerState(s, 'graphics/a.svg', 'B')).toEqual({ hidden: true, locked: false });
    expect(s.files['graphics/a.svg'].guides).toEqual([{ axis: 'y', pos: 4 }]);
  });

  it('đặt, đổi tên, xóa trạng thái lớp và đường gióng là hàm thuần (không đổi đối tượng cũ); lớp mặc định có khóa rỗng', () => {
    const a = emptySvgState();
    const b = withLayerState(a, 'graphics/bom.svg', 'Bơm', { locked: true });
    expect(a).toEqual(emptySvgState());
    expect(layerState(b, 'graphics/bom.svg', 'Bơm')).toEqual({ hidden: false, locked: true });
    const c = withLayerState(b, 'graphics/bom.svg', '', { hidden: true });
    expect(layerState(c, 'graphics/bom.svg', '')).toEqual({ hidden: true, locked: false });
    const d = renameLayerState(c, 'graphics/bom.svg', 'Bơm', 'Bơm 1');
    expect(layerState(d, 'graphics/bom.svg', 'Bơm 1')).toEqual({ hidden: false, locked: true });
    expect(layerState(d, 'graphics/bom.svg', 'Bơm')).toEqual({ hidden: false, locked: false });
    const e = dropLayerState(d, 'graphics/bom.svg', 'Bơm 1');
    expect(Object.keys(e.files['graphics/bom.svg'].layers)).toEqual(['']);
    const f = withGuides(e, 'graphics/bom.svg', [{ axis: 'x', pos: 1.23456 }]);
    expect(f.files['graphics/bom.svg'].guides).toEqual([{ axis: 'x', pos: 1.235 }]);
    // trạng thái về mặc định hết thì tệp không còn mục (không phình)
    const g = withGuides(
      withLayerState(f, 'graphics/bom.svg', '', { hidden: false }),
      'graphics/bom.svg',
      [],
    );
    expect(g.files['graphics/bom.svg']).toBeUndefined();
  });

  it('SvgStateStore ghi đúng .mat-editor/svg-state.json, không đụng tệp SVG và không thành tài liệu của project', async () => {
    const p = await project();
    const store = new SvgStateStore(p);
    await store.load();
    await store.setLayer('graphics/bom.svg', 'Bơm', { hidden: true });
    await store.setLayer('graphics/bom.svg', 'Nhãn', { locked: true });
    expect(p.control.fileText('graphics/bom.svg')).toBe(SVG);
    const written = p.control.writes.map((w) => w.rel);
    expect(new Set(written)).toEqual(new Set([SVG_STATE_FILE]));
    const saved = parseSvgState(p.control.fileText(SVG_STATE_FILE) ?? null);
    expect(layerState(saved, 'graphics/bom.svg', 'Bơm').hidden).toBe(true);
    expect(layerState(saved, 'graphics/bom.svg', 'Nhãn').locked).toBe(true);
    // phiên sau đọc lại được
    const again = new SvgStateStore(p);
    await again.load();
    expect(again.layer('graphics/bom.svg', 'Nhãn')).toEqual({ hidden: false, locked: true });
  });

  it('mất tệp trạng thái không mất dữ liệu thiết kế: SVG mở như thường, mọi lớp hiện và mở khóa', async () => {
    const p = await project({ [SVG_STATE_FILE]: 'không phải JSON' });
    const store = new SvgStateStore(p);
    await store.load();
    expect(store.layer('graphics/bom.svg', 'Bơm')).toEqual({ hidden: false, locked: false });
  });
});

describe('tự lưu (FR-112)', () => {
  it('tên bản tự lưu đảo được, sắp theo thời gian; đường dẫn có "/" và "%"', () => {
    const at = Date.UTC(2026, 9, 17, 9, 52, 31, 45);
    const n = autosaveName('graphics/tram%bom.svg', at);
    expect(n).toBe('graphics%2Ftram%25bom.svg.20261017T095231045Z.svg');
    expect(parseAutosaveName(n)).toEqual({ rel: 'graphics/tram%bom.svg', at });
    expect(parseAutosaveName('rác.svg')).toBeNull();
    expect(autosaveName('a.svg', at + 1) > autosaveName('a.svg', at)).toBe(true);
  });

  it('mỗi 30 s chỉ ghi khi version đổi; giữ tối đa 3 bản mới nhất mỗi tệp', async () => {
    const p = await project();
    const tm = fakeTimers();
    const io = platformAutosaveIo(p);
    const saver = new Autosaver(io, tm);
    let version = 1;
    let text = SVG;
    saver.track('graphics/bom.svg', { version: () => version, text: () => text });
    expect(tm.count).toBe(1);
    tm.advance(AUTOSAVE_INTERVAL_MS);
    tm.due();
    await saver.idle();
    expect(p.control.fileList('.mat-editor/autosave/')).toEqual([]); // chưa đổi gì
    for (let i = 0; i < 5; i++) {
      version++;
      text = SVG.replace('<rect/>', `<rect x="${i}"/>`);
      tm.advance(AUTOSAVE_INTERVAL_MS);
      tm.due();
      await saver.idle();
    }
    const list = p.control.fileList('.mat-editor/autosave/');
    expect(list.length).toBe(AUTOSAVE_KEEP);
    expect(p.control.fileText(list[2])).toContain('x="4"');
    expect(p.control.fileText(list[0])).toContain('x="2"');
    // tệp chính không đổi khi tự lưu
    expect(p.control.fileText('graphics/bom.svg')).toBe(SVG);
    saver.untrack('graphics/bom.svg');
    expect(tm.count).toBe(0);
  });

  it('lưu thật thành công thì xóa các bản tự lưu của tệp đó (không đụng tệp khác)', async () => {
    const p = await project({
      '.mat-editor/autosave/graphics%2Fbom.svg.20261017T095231045Z.svg': SVG,
      '.mat-editor/autosave/graphics%2Fvan.svg.20261017T095231045Z.svg': SVG,
    });
    const saver = new Autosaver(platformAutosaveIo(p), fakeTimers());
    await saver.discard('graphics/bom.svg');
    expect(p.control.fileList('.mat-editor/autosave/')).toEqual([
      '.mat-editor/autosave/graphics%2Fvan.svg.20261017T095231045Z.svg',
    ]);
  });

  it('kill giả: phiên sửa bị bỏ giữa chừng (không dọn) ⇒ mở lại có bản tự lưu mới hơn tệp thật để khôi phục, đủ nội dung 30 s gần nhất', async () => {
    const p = await project();
    const tm = fakeTimers();
    let version = 1;
    let text = SVG;
    const saver = new Autosaver(platformAutosaveIo(p), tm);
    saver.track('graphics/bom.svg', { version: () => version, text: () => text });
    version = 2;
    text = SVG.replace('<rect/>', '<rect width="9"/>');
    tm.advance(AUTOSAVE_INTERVAL_MS);
    tm.due();
    await saver.idle();
    // "tắt đột ngột": không untrack, không discard; mở lại project từ đĩa
    const reopened = createMockPlatform();
    reopened.control.useProject(p.control.snapshot());
    await reopened.pickProject();
    const offers = await findRestorable(platformAutosaveIo(reopened), reopened);
    expect(offers.length).toBe(1);
    expect(offers[0].rel).toBe('graphics/bom.svg');
    expect(offers[0].versions.length).toBe(1);
    expect(offers[0].versions[0].text).toContain('width="9"');
    expect(offers[0].diskMtimeMs).toBeLessThan(offers[0].versions[0].mtimeMs);
  });

  it('bản tự lưu cũ hơn tệp thật hoặc giống hệt tệp thật không được đề nghị khôi phục', async () => {
    const p = await project({
      '.mat-editor/autosave/graphics%2Fbom.svg.20261017T095231045Z.svg': SVG,
    });
    // giống hệt nội dung trên đĩa
    expect(await findRestorable(platformAutosaveIo(p), p)).toEqual([]);
    // tệp thật được ghi SAU bản tự lưu
    p.control.editOutside(
      '.mat-editor/autosave/graphics%2Fvan.svg.20261017T095231045Z.svg',
      '<svg/>',
    );
    p.control.editOutside('graphics/van.svg', '<svg><g/></svg>');
    expect(await findRestorable(platformAutosaveIo(p), p)).toEqual([]);
  });

  it('tệp mới chưa từng lưu (không có trên đĩa) mà có bản tự lưu: được đề nghị khôi phục', async () => {
    const p = await project({
      '.mat-editor/autosave/graphics%2Fmoi.svg.20261017T095231045Z.svg': SVG,
    });
    const offers = await findRestorable(platformAutosaveIo(p), p);
    expect(offers.map((o) => [o.rel, o.diskMtimeMs])).toEqual([['graphics/moi.svg', null]]);
  });
});

describe('phát hiện đổi trên đĩa (FR-113)', () => {
  it('so mtime và băm: chỉ mtime đổi (chạm tệp) là "giống"; băm đổi là "đã đổi"; mất tệp là "mất"', () => {
    const base = { mtimeMs: 10, size: 5, hash: 'aa' };
    expect(compareDisk(base, { mtimeMs: 10, size: 5, hash: 'aa' }).kind).toBe('same');
    expect(compareDisk(base, { mtimeMs: 11, size: 5, hash: 'aa' }).kind).toBe('same');
    expect(compareDisk(base, { mtimeMs: 11, size: 6, hash: 'bb' }).kind).toBe('changed');
    expect(compareDisk(base, { error: 'missing' }).kind).toBe('missing');
    expect(compareDisk(null, { error: 'missing' }).kind).toBe('same');
    expect(compareDisk(null, { mtimeMs: 1, size: 1, hash: 'x' }).kind).toBe('changed');
  });

  it('DiskWatcher kiểm mỗi 5 s và khi cửa sổ lấy focus; báo một lần cho mỗi bản trên đĩa khác', async () => {
    const p = await project();
    const tm = fakeTimers();
    const fp = await p.fingerprint('graphics/bom.svg');
    if ('error' in fp) throw new Error('thiếu tệp');
    const seen: string[] = [];
    const w = new DiskWatcher(p, tm);
    w.watch('graphics/bom.svg', fp, (st) => seen.push(st.kind));
    tm.advance(WATCH_INTERVAL_MS);
    tm.due();
    await w.idle();
    expect(seen).toEqual([]);
    p.control.editOutside('graphics/bom.svg', SVG.replace('<rect/>', '<circle/>'));
    await w.focus();
    expect(seen).toEqual(['changed']);
    tm.advance(WATCH_INTERVAL_MS);
    tm.due();
    await w.idle();
    expect(seen).toEqual(['changed']); // cùng bản trên đĩa: không hỏi lại
    p.control.editOutside('graphics/bom.svg', SVG.replace('<rect/>', '<line/>'));
    tm.advance(WATCH_INTERVAL_MS);
    tm.due();
    await w.idle();
    expect(seen).toEqual(['changed', 'changed']);
    w.unwatch('graphics/bom.svg');
    expect(tm.count).toBe(0);
  });

  it('không ghi đè im lặng: ghi với băm lúc nạp khi tệp đã đổi bị từ chối "changed" và tệp trên đĩa giữ nguyên', async () => {
    const p = await project();
    const r = await p.read('graphics/bom.svg');
    if (!('hash' in r)) throw new Error('thiếu tệp');
    p.control.editOutside('graphics/bom.svg', '<svg><circle/></svg>');
    expect(await p.write('graphics/bom.svg', '<svg/>', r.hash, false)).toEqual({
      error: 'changed',
    });
    expect(p.control.fileText('graphics/bom.svg')).toBe('<svg><circle/></svg>');
  });
});

describe('T202: tên lớp trùng thuộc tính của Object (__proto__, constructor)', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'lớp %s giữ trạng thái ẩn/khóa qua đặt, ghi, đọc lại, đổi tên',
    (name) => {
      const rel = 'screens/a.svg';
      expect(layerState(emptySvgState(), rel, name)).toEqual({ hidden: false, locked: false });
      let s = withLayerState(emptySvgState(), rel, name, { hidden: true });
      s = withLayerState(s, rel, name, { locked: true });
      expect(layerState(s, rel, name)).toEqual({ hidden: true, locked: true });
      const back = parseSvgState(serializeSvgState(s));
      expect(layerState(back, rel, name)).toEqual({ hidden: true, locked: true });
      const moved = renameLayerState(back, rel, name, 'L2');
      expect(layerState(moved, rel, 'L2')).toEqual({ hidden: true, locked: true });
      expect(layerState(moved, rel, name)).toEqual({ hidden: false, locked: false });
      expect(layerState(dropLayerState(back, rel, name), rel, name)).toEqual({
        hidden: false,
        locked: false,
      });
      expect(({} as Record<string, unknown>).hidden).toBeUndefined();
    },
  );
});
