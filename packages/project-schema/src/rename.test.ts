// renameTag (T188, FR-047, D32): đổi tên Tag ở mọi tham chiếu: biểu thức (theo token, giữ nguyên định dạng), bảng theo dõi,
// nhóm lưu trữ, binding. Trả danh sách chỗ sẽ đổi; từ chối tên mới đã có hoặc sai luật.
import { describe, expect, it } from 'vitest';
import { renameTableInExpression, renameTag, type RenameProject } from './rename.ts';
import type { BindingSet02, TagListV1, TagV1, WatchTableDoc } from './index.ts';

const tag = (id: string, extra: Partial<TagV1> = {}): TagV1 => ({
  id,
  kind: 'external',
  type: 'FLOAT32',
  source: { device: 'plc1', address: 'HR1' },
  ...extra,
});

function project(): RenameProject {
  const tags: TagListV1 = {
    schemaVersion: '0.2.0',
    tags: [
      tag('TANK02.LEVEL'),
      tag('TANK01.LEVEL'),
      {
        id: 'DIFF',
        kind: 'calculated',
        type: 'FLOAT64',
        expression: 'TANK02.LEVEL  -  TANK01.LEVEL',
      },
      {
        id: 'HIGH',
        kind: 'calculated',
        type: 'BOOL',
        expression: 'TANK02.LEVEL > 80 ? true : false\n',
      },
      {
        id: 'TXT',
        kind: 'calculated',
        type: 'STRING',
        expression: 'text(TANK02.LEVEL, "TANK02.LEVEL")',
      },
      {
        id: 'BAD',
        kind: 'calculated',
        type: 'FLOAT64',
        expression: 'TANK02.LEVELX + XTANK02.LEVEL + TANK02',
      },
    ],
  };
  const watch: WatchTableDoc = {
    schemaVersion: '0.2.0',
    id: 'van-hanh',
    name: 'Vận hành',
    rows: [{ tag: 'TANK01.LEVEL' }, { tag: 'TANK02.LEVEL', format: 'dec' }],
  };
  const bindings: BindingSet02 = {
    schemaVersion: '0.2.0',
    screenId: 'main',
    elements: [
      {
        elementUid: 'e1',
        bindings: [
          {
            id: 'b1',
            target: 'geometry.levelPercent',
            source: { type: 'tag', tagId: 'TANK02.LEVEL' },
            transform: { kind: 'identity' },
          },
          {
            id: 'b2',
            target: 'text.content',
            source: { type: 'tag', tagId: 'TANK01.LEVEL' },
            transform: { kind: 'identity' },
          },
        ],
      },
    ],
  } as unknown as BindingSet02;
  return {
    tags,
    watchTables: { 'van-hanh': watch },
    logging: {
      schemaVersion: '0.1.0',
      groups: [
        { id: 'g', tags: [{ tagId: 'TANK02.LEVEL' }, { tagId: 'TANK01.LEVEL', column: 'x' }] },
      ],
    } as unknown as RenameProject['logging'],
    bindings: { main: bindings },
  };
}

describe('renameTag', () => {
  it('đổi định nghĩa Tag, biểu thức theo token (giữ khoảng trắng, chuỗi chữ và tên gần giống), bảng theo dõi, lưu trữ, binding', () => {
    const r = renameTag(project(), 'TANK02.LEVEL', 'BON2.MUC');
    if (!r.ok) throw new Error(r.code);
    const tags = r.project.tags.tags;
    expect(tags[0]!.id).toBe('BON2.MUC');
    expect(tags.find((x) => x.id === 'DIFF')!.expression).toBe('BON2.MUC  -  TANK01.LEVEL');
    expect(tags.find((x) => x.id === 'HIGH')!.expression).toBe('BON2.MUC > 80 ? true : false\n');
    // chuỗi chữ "TANK02.LEVEL" không phải Tag; tên chỉ giống một phần không bị đổi
    expect(tags.find((x) => x.id === 'TXT')!.expression).toBe('text(BON2.MUC, "TANK02.LEVEL")');
    expect(tags.find((x) => x.id === 'BAD')!.expression).toBe(
      'TANK02.LEVELX + XTANK02.LEVEL + TANK02',
    );
    expect(r.project.watchTables['van-hanh']!.rows.map((x) => x.tag)).toEqual([
      'TANK01.LEVEL',
      'BON2.MUC',
    ]);
    expect(r.project.watchTables['van-hanh']!.rows[1]!.format).toBe('dec');
    const g = (r.project.logging as unknown as { groups: { tags: { tagId: string }[] }[] })
      .groups[0]!;
    expect(g.tags[0]!.tagId).toBe('BON2.MUC');
    expect(r.project.bindings.main!.elements[0]!.bindings[0]!.source.tagId).toBe('BON2.MUC');
    expect(r.project.bindings.main!.elements[0]!.bindings[1]!.source.tagId).toBe('TANK01.LEVEL');
  });

  it('danh sách chỗ sẽ đổi: Tag, hai biểu thức + 1 chuỗi, bảng theo dõi, lưu trữ, binding', () => {
    const r = renameTag(project(), 'TANK02.LEVEL', 'BON2.MUC');
    if (!r.ok) throw new Error(r.code);
    expect(r.hits.map((h) => h.kind)).toEqual([
      'tag',
      'expression',
      'expression',
      'expression',
      'watch',
      'logging',
      'binding',
    ]);
    expect(
      r.hits.filter((h) => h.kind === 'expression').map((h) => (h as { tag: string }).tag),
    ).toEqual(['DIFF', 'HIGH', 'TXT']);
    const w = r.hits.find((h) => h.kind === 'watch') as { table: string; row: number };
    expect(w).toMatchObject({ table: 'van-hanh', row: 1 });
  });

  it('cột lưu trữ mặc định theo tên Tag: giữ nguyên cột cũ để không đổi cấu trúc cơ sở dữ liệu', () => {
    const r = renameTag(project(), 'TANK02.LEVEL', 'BON2.MUC');
    if (!r.ok) throw new Error(r.code);
    const g = (r.project.logging as unknown as { groups: { tags: { column?: string }[] }[] })
      .groups[0]!;
    expect(g.tags[0]!.column).toBe('TANK02_LEVEL');
    expect(g.tags[1]!.column).toBe('x');
  });

  it('không đụng phần không liên quan: chỉ trả phần đã đổi, phần còn lại không có trong kết quả', () => {
    const r = renameTag(project(), 'TANK01.LEVEL', 'T1');
    if (!r.ok) throw new Error(r.code);
    expect(Object.keys(r.project.watchTables)).toEqual(['van-hanh']);
    const r2 = renameTag(project(), 'DIFF', 'DELTA');
    if (!r2.ok) throw new Error(r2.code);
    expect(r2.hits.map((h) => h.kind)).toEqual(['tag']);
    expect(Object.keys(r2.project.watchTables)).toEqual([]);
    expect(Object.keys(r2.project.bindings)).toEqual([]);
    expect(r2.project.logging).toBeNull();
  });

  it('bản gốc không bị sửa', () => {
    const p = project();
    const before = JSON.stringify(p);
    renameTag(p, 'TANK02.LEVEL', 'BON2.MUC');
    expect(JSON.stringify(p)).toBe(before);
  });

  it('từ chối: tên mới đã có, sai luật (cú pháp, 64 ký tự, true/false), tên cũ không có, cùng tên', () => {
    const p = project();
    expect(renameTag(p, 'TANK02.LEVEL', 'TANK01.LEVEL')).toMatchObject({
      ok: false,
      code: 'E_RENAME_EXISTS',
    });
    expect(renameTag(p, 'TANK02.LEVEL', '1ABC')).toMatchObject({
      ok: false,
      code: 'E_RENAME_SYNTAX',
    });
    expect(renameTag(p, 'TANK02.LEVEL', 'a b')).toMatchObject({
      ok: false,
      code: 'E_RENAME_SYNTAX',
    });
    expect(renameTag(p, 'TANK02.LEVEL', 'A'.repeat(65))).toMatchObject({
      ok: false,
      code: 'E_RENAME_SYNTAX',
    });
    expect(renameTag(p, 'TANK02.LEVEL', 'true')).toMatchObject({
      ok: false,
      code: 'E_RENAME_SYNTAX',
    });
    expect(renameTag(p, 'NOPE', 'X')).toMatchObject({ ok: false, code: 'E_RENAME_MISSING' });
    expect(renameTag(p, 'TANK02.LEVEL', 'TANK02.LEVEL')).toMatchObject({
      ok: false,
      code: 'E_RENAME_SAME',
    });
  });

  it('tên mới chỉ khác hoa thường của Tag khác vẫn là tên khác (tên Tag phân biệt hoa thường)', () => {
    const r = renameTag(project(), 'TANK02.LEVEL', 'tank01.level');
    expect(r.ok).toBe(true);
  });
});

describe('renameTableInExpression', () => {
  it('đổi tên bảng giá trị trong text(), không đụng Tag hay chuỗi trùng tên', () => {
    expect(renameTableInExpression('text(PUMP.STATE, Bom) + "Bom"', 'Bom', 'Bom2')).toBe(
      'text(PUMP.STATE, Bom2) + "Bom"',
    );
    expect(renameTableInExpression('Bom * 2', 'Bom', 'Bom2')).toBeNull();
  });
});
