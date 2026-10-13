// Nâng cấp 0.2 -> 0.3 (T016; contract project-format-0.3 §8): cặp file tests/migration-vectors/*-0.2to0.3, giống từng
// byte với cùng đầu vào, project sau nâng cấp hợp lệ trên validator 0.3, lỗi của bản gốc được mang sang.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate02to03, migrateTo03, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors');
const cases = readdirSync(DIR).filter(
  (d) => d.endsWith('-0.2to0.3') && statSync(join(DIR, d)).isDirectory(),
);

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}
const before = (c: string) => tree(join(DIR, c, 'before'));
const modbus = () => before('modbus-demo-0.2to0.3');

describe('tests/migration-vectors/*-0.2to0.3', () => {
  it('has the required cases', () => {
    for (const c of [
      'tank-demo',
      'modbus-demo',
      'viewbox-offset',
      'viewbox-huge',
      'fit-cover-background',
      'fit-stretch',
      'multi-screen',
      'screen-existing-error',
    ])
      expect(cases).toContain(`${c}-0.2to0.3`);
  });
  for (const c of cases) {
    it(c, async () => {
      const b = before(c);
      const r = await migrateTo03(b);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      // chạy hai lần cho cùng byte
      const again = await migrateTo03(b);
      expect(again.ok && again.files).toEqual(r.files);
    });
  }
});

describe('migrate02to03', () => {
  it('project sau nâng cấp hợp lệ trên validator 0.3 (runtime 0.6.0), không cảnh báo mới', async () => {
    for (const c of ['modbus-demo', 'multi-screen', 'fit-cover-background', 'viewbox-huge']) {
      const r = await migrate02to03(before(`${c}-0.2to0.3`));
      if (!r.ok) throw new Error(`${c}: ${JSON.stringify(r)}`);
      const v = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '0.6.0',
      });
      expect(v.errors, c).toEqual([]);
      expect(v.project03, c).toBeDefined();
      expect(v.project03!.project.schemaVersion).toBe('0.3.0');
    }
  });

  it('modbus-demo: một màn hình nên không có navigation; minRuntime 0.6.0; tags.json chỉ đổi schemaVersion', async () => {
    const b = modbus();
    const r = await migrate02to03(b);
    if (!r.ok) throw new Error('migrate');
    expect(JSON.parse(r.files['project.json']!).navigation).toBeUndefined();
    expect(r.changes).toContainEqual({ kind: 'minRuntime', version: '0.6.0' });
    expect(r.changes).toContainEqual({ kind: 'screens', count: 1, clamped: [], skipped: [] });
    // từng byte còn lại của tags.json giữ nguyên
    expect(r.files['tags.json']).toBe(
      b['tags.json']!.replace('"schemaVersion": "0.2.0"', '"schemaVersion": "0.3.0"'),
    );
    expect(r.files['screens/main.svg']).toBe(b['screens/main.svg']);
    expect(r.backup).toEqual(
      [
        'connections.json',
        'project.json',
        'screens/main.bindings.json',
        'screens/main.screen.json',
        'tags.json',
        'value-tables/TrangThaiBom.json',
        'watch-tables/van-hanh.json',
      ].sort(),
    );
  });

  it('nhiều màn hình: navigation một mục lá mỗi màn hình theo thứ tự screens, nhãn là name cắt 40 ký tự', async () => {
    const r = await migrate02to03(before('multi-screen-0.2to0.3'));
    if (!r.ok) throw new Error('migrate');
    const nav = JSON.parse(r.files['project.json']!).navigation;
    expect(nav.position).toBe('left');
    expect(nav.items.map((i: { screen: string }) => i.screen)).toEqual(['main', 'second', 'third']);
    expect(nav.items[1].label).toBe('Màn hình thứ hai');
    expect([...nav.items[2].label]).toHaveLength(40);
    expect(r.changes).toContainEqual({ kind: 'navigation', entries: 3 });
  });

  it('viewBox ngoài khoảng: size kẹp, báo trong changes.screens.clamped; viewBox giữ nguyên', async () => {
    const r = await migrate02to03(before('viewbox-huge-0.2to0.3'));
    if (!r.ok) throw new Error('migrate');
    const s = JSON.parse(r.files['screens/main.screen.json']!);
    expect(s.size).toEqual({ width: 4096, height: 2304 });
    expect(s.items[0].viewBox).toEqual([0, 0, 10000, 5000]);
    expect(r.changes).toContainEqual({ kind: 'screens', count: 1, clamped: ['main'], skipped: [] });
  });

  it('binding: chỉ đổi schemaVersion và thêm itemId svg1 ngay sau screenId', async () => {
    const r = await migrate02to03(modbus());
    if (!r.ok) throw new Error('migrate');
    const b = JSON.parse(r.files['screens/main.bindings.json']!);
    expect(Object.keys(b).slice(0, 4)).toEqual(['schemaVersion', 'screenId', 'itemId', 'elements']);
    expect(b.itemId).toBe('svg1');
    expect(b.schemaVersion).toBe('0.3.0');
  });

  it('lỗi của bản gốc được mang sang, không chặn', async () => {
    const r = await migrate02to03(before('screen-existing-error-0.2to0.3'));
    expect(r.ok && r.changes[0]).toMatchObject({ kind: 'originalErrors' });
    if (!r.ok) throw new Error('migrate');
    const v = await validateProject(new MemorySource(r.files), { checkSvg: false });
    expect([...new Set(v.errors.map((e) => e.code))]).toEqual(['E_REF_UID']);
  });

  it('màn hình hỏng JSON: mang nguyên văn, ghi trong changes.screens.skipped', async () => {
    const b = before('screen-broken-file-0.2to0.3');
    const r = await migrate02to03(b);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.files['screens/second.screen.json']).toBe(b['screens/second.screen.json']);
    expect(r.changes).toContainEqual({
      kind: 'screens',
      count: 1,
      clamped: [],
      skipped: ['second'],
    });
    expect(r.backup).not.toContain('screens/second.screen.json');
  });

  it('BOM: tệp chỉ đổi phiên bản giữ BOM, tệp màn hình viết lại không BOM', async () => {
    const r = await migrate02to03(before('edge-bom-0.2to0.3'));
    if (!r.ok) throw new Error('migrate');
    expect(r.files['tags.json']!.charCodeAt(0)).toBe(0xfeff);
    expect(r.files['tags.json']).toContain('"schemaVersion": "0.3.0"');
    expect(r.files['screens/main.screen.json']!.charCodeAt(0)).toBe(0x7b);
  });

  it('minRuntimeVersion cao hơn 0.6.0 được giữ', async () => {
    const r = await migrate02to03(before('min-runtime-higher-0.2to0.3'));
    if (!r.ok) throw new Error('migrate');
    expect(JSON.parse(r.files['project.json']!).minRuntimeVersion).toBe('0.7.0');
  });

  it('từ chối: đã là 0.3, phiên bản mới hơn, 0.1, project không đọc được', async () => {
    expect(await migrate02to03(before('already-03-0.2to0.3'))).toEqual({
      ok: false,
      error: { code: 'ALREADY_03' },
    });
    expect(await migrate02to03(before('unsupported-version-0.2to0.3'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_VERSION', version: '0.4.0' },
    });
    const v01 = tree(join(DIR, 'valid-tank-demo', 'before'));
    expect(await migrate02to03(v01)).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_VERSION', version: '0.1.0' },
    });
    expect(await migrate02to03(before('unreadable-project-0.2to0.3'))).toEqual({
      ok: false,
      error: { code: 'UNREADABLE', file: 'project.json' },
    });
  });
});

describe('migrateTo03 từ project 0.1', () => {
  it('nối 0.1 -> 0.2 -> 0.3 trong một lần, một danh sách sao lưu, kết quả hợp lệ 0.3', async () => {
    const r = await migrateTo03(before('tank-demo-0.2to0.3'));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const v = await validateProject(new MemorySource(r.files), { checkSvg: false });
    expect(v.errors).toEqual([]);
    expect(v.project03?.tags.tags.every((t) => t.kind === 'simulation')).toBe(true);
    expect(r.changes).toContainEqual({ kind: 'legacyTags', count: 5 });
    expect(r.changes.find((c) => c.kind === 'rewrite')).toBeDefined();
    expect(r.changes.filter((c) => c.kind === 'rewrite')).toHaveLength(1);
    expect(r.backup).toContain('tags.json');
    expect(r.backup).toContain('screens/tank-motor.screen.json');
  });
  it('đã là 0.3 thì ALREADY_03; 0.2 đi thẳng', async () => {
    expect(await migrateTo03(before('already-03-0.2to0.3'))).toEqual({
      ok: false,
      error: { code: 'ALREADY_03' },
    });
    const direct = await migrate02to03(modbus());
    expect(await migrateTo03(modbus())).toEqual(direct);
  });
});
