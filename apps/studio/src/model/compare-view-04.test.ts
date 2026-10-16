// So sánh project 0.4 trong Studio (feature 008, T106, FR-010): binding và sự kiện nhấp của phần tử SVG hiện thành dòng
// "Binding" theo item và phần tử, ánh xạ vào nút màn hình, nhận ra dòng sự kiện (`@click`) để hiển thị nhãn riêng.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MemorySource,
  compareProjects,
  packageDigest,
  packageFile,
  type LocalSide,
  type PackageFile,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { compareRows, eventTargetOf, isEventRow, treeMarks } from './compare-view.ts';

const AFTER = resolve(
  __dirname,
  '../../../../tests/migration-vectors/dashboard-demo-0.3to0.4/after',
);
const FILES = [
  'project.json',
  'tags.json',
  'connections.json',
  'value-tables/TrangThaiBom.json',
  'screens/tong-quan.screen.json',
  'screens/tong-quan.bindings.json',
  'screens/tong-quan.svg',
  'screens/bon-nuoc.screen.json',
  'screens/giam-sat.screen.json',
  'screens/bom1.screen.json',
];

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FILES) {
    try {
      out[f] = readFileSync(resolve(AFTER, f), 'utf8');
    } catch {
      // file không có trong bộ mẫu: bỏ qua
    }
  }
  return out;
}

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function side(files: Record<string, string>): Promise<LocalSide> {
  const list: PackageFile[] = await Promise.all(
    Object.entries(files).map(([p, t]) => packageFile(p, t, sha)),
  );
  return {
    digest: await packageDigest(list, sha),
    files: list,
    source: new MemorySource(files),
  };
}

describe('So sánh 0.4: binding và sự kiện SVG', () => {
  it('sự kiện nhấp khác nhau hiện thành dòng binding `@click` của đúng item và phần tử', async () => {
    const local = load();
    const device = load();
    const b = JSON.parse(local['screens/tong-quan.bindings.json']!) as {
      elements: Array<{ elementUid: string; events?: unknown }>;
    };
    b.elements[1]!.events = { click: { action: 'toggle', tag: 'PUMP01.RUN', confirm: 'always' } };
    local['screens/tong-quan.bindings.json'] = JSON.stringify(b, null, 2);
    const l = await side(local);
    const d = await side(device);
    const result = await compareProjects(l, {
      digest: d.digest,
      files: async () => d.files,
      source: async () => d.source,
    });
    const rows = compareRows(result).filter((r) => r.kind === 'binding');
    const click = rows.find((r) => isEventRow(r));
    expect(click?.key).toBe('tong-quan/svg1/el_pump/@click');
    expect(click?.status).toBe('+');
    expect(eventTargetOf(click!)).toEqual({
      screen: 'tong-quan',
      item: 'svg1',
      element: 'el_pump',
    });
    expect(rows.filter((r) => !isEventRow(r)).every((r) => r.status === '=')).toBe(true);
    const marks = treeMarks(result, {
      schema: '0.3',
      screens: [{ id: 'tong-quan' }],
    } as never);
    // Nút màn hình gộp mọi đối tượng của nó: có dòng `+` lẫn `=` nên là `≠`.
    expect(marks.get('screen:tong-quan')).toBe('≠');
  });

  it('dòng binding thường không phải dòng sự kiện', () => {
    expect(isEventRow({ kind: 'binding', key: 'tong-quan/svg1/el_tank/b1' } as never)).toBe(false);
    expect(isEventRow({ kind: 'item', key: 'tong-quan/svg1/@click' } as never)).toBe(false);
    expect(
      eventTargetOf({ kind: 'binding', key: 'tong-quan/svg1/el_tank/b1' } as never),
    ).toBeNull();
  });
});
