// Mô hình editor Recipe (feature 024, US1): loại, tham số từ Tag (từ chối Tag chỉ đọc), bản, ô, dán TSV, CSV vòng tròn,
// sửa đổi `{ kind: 'recipes' }` một bước hoàn tác (tạo recipes.json và recipesFile khi chưa có).
import type { RecipesConfig } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyEdits, type EditableProject } from './project-doc.ts';
import {
  addParams,
  addRecipe,
  addType,
  cellProblem,
  duplicateRecipe,
  emptyRecipes,
  exportCsv,
  importCsv,
  moveParam,
  pasteBlock,
  recipesEdit,
  removeParam,
  removeRecipe,
  setParamField,
  setSecurity,
  setValue,
  slug,
  type RecipeTagInfo,
} from './recipes-doc.ts';

const TAGS = new Map<string, RecipeTagInfo>(
  [
    {
      id: 'LO.SP',
      type: 'FLOAT32',
      kind: 'internal',
      access: 'RW',
      unit: '°C',
      limits: { min: 20, max: 300 },
    },
    { id: 'LO.RUN', type: 'BOOL', kind: 'internal', access: 'RW' },
    { id: 'LO.N', type: 'UINT16', kind: 'internal', access: 'RW' },
    { id: 'LO.NOTE', type: 'STRING', kind: 'internal', access: 'RW' },
    { id: 'LO.PV', type: 'FLOAT32', kind: 'internal' },
    { id: 'LO.CALC', type: 'FLOAT32', kind: 'calculated', access: 'RW' },
    { id: 'SIM.RAMP', type: 'FLOAT32', kind: 'simulation', access: 'RW', sim: { kind: 'ramp' } },
    { id: 'SIM.MAN', type: 'INT16', kind: 'simulation', access: 'RW', sim: { kind: 'manual' } },
  ].map((t) => [t.id, t]),
);

function base(): RecipesConfig {
  let c = addType(emptyRecipes('1.1.0'), 'Lò sấy').cfg;
  c = addRecipe(c, 0, 'Mùa hè', TAGS).cfg;
  const r = addParams(c, 0, ['LO.SP', 'LO.RUN', 'LO.N', 'LO.NOTE'], TAGS);
  if (!r.ok) throw new Error(r.reason);
  return r.cfg;
}

describe('recipes-doc', () => {
  it('loại: id từ tên không dấu, không trùng', () => {
    expect(slug('Lò sấy Đông')).toBe('lo-say-dong');
    const c = addType(base(), 'Lò sấy').cfg;
    expect(c.types.map((t) => t.id)).toEqual(['lo-say', 'lo-say-2']);
  });

  it('thêm Tag: mặc định trong giới hạn cho mọi bản; đơn vị từ Tag', () => {
    const c = base();
    expect(c.types[0]!.params.map((p) => p.tagId)).toEqual(['LO.SP', 'LO.RUN', 'LO.N', 'LO.NOTE']);
    expect(c.types[0]!.params[0]!.unit).toBe('°C');
    expect(c.types[0]!.recipes[0]!.values).toEqual({
      'LO.SP': 20,
      'LO.RUN': false,
      'LO.N': 0,
      'LO.NOTE': '',
    });
    const c2 = addRecipe(c, 0, 'Mùa đông', TAGS).cfg;
    expect(c2.types[0]!.recipes[1]!.values['LO.SP']).toBe(20);
  });

  it('Tag chỉ đọc, tính toán, mô phỏng không manual: từ chối kèm lý do; manual được', () => {
    for (const id of ['LO.PV', 'LO.CALC', 'SIM.RAMP'])
      expect(addParams(base(), 0, [id], TAGS)).toEqual({ ok: false, reason: 'readOnly', tag: id });
    expect(addParams(base(), 0, ['LO.SP'], TAGS)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(addParams(base(), 0, ['KHONG'], TAGS)).toMatchObject({ ok: false, reason: 'missing' });
    expect(addParams(base(), 0, ['SIM.MAN'], TAGS).ok).toBe(true);
  });

  it('xóa, sắp xếp tham số; thuộc tính số', () => {
    let c = removeParam(base(), 0, 1);
    expect(c.types[0]!.recipes[0]!.values['LO.RUN']).toBeUndefined();
    c = moveParam(c, 0, 0, 2);
    expect(c.types[0]!.params.map((p) => p.tagId)).toEqual(['LO.N', 'LO.NOTE', 'LO.SP']);
    c = setParamField(c, 0, 2, 'max', '250,5');
    expect(c.types[0]!.params[2]!.max).toBe(250.5);
    expect(setParamField(c, 0, 2, 'max', 'abc')).toBe(c);
    c = setParamField(c, 0, 2, 'max', '');
    expect(c.types[0]!.params[2]!.max).toBeUndefined();
  });

  it('ô: ép kiểu theo Tag; lỗi giới hạn tô ngay', () => {
    let c = base();
    c = setValue(c, 0, 0, 'LO.RUN', 'BOOL', 'bật')!;
    expect(c.types[0]!.recipes[0]!.values['LO.RUN']).toBe(true);
    expect(setValue(c, 0, 0, 'LO.SP', 'FLOAT32', 'x')).toBeNull();
    c = setValue(c, 0, 0, 'LO.SP', 'FLOAT32', '500')!;
    expect(cellProblem(c.types[0]!.params[0]!, TAGS.get('LO.SP'), 500)).toBe('E_RECIPE_LIMIT');
    expect(cellProblem(c.types[0]!.params[2]!, TAGS.get('LO.N'), 2.5)).toBe('E_RECIPE_VALUE');
    expect(cellProblem(c.types[0]!.params[2]!, TAGS.get('LO.N'), 3)).toBeNull();
  });

  it('dán TSV nhiều ô; ô hỏng báo vị trí', () => {
    let c = addRecipe(base(), 0, 'B', TAGS).cfg;
    const r = pasteBlock(c, 0, 0, 0, '100\t110\n1\tmaybe\n', TAGS);
    c = r.cfg;
    expect(r.bad).toEqual([[2, 2]]);
    expect(c.types[0]!.recipes.map((x) => x.values['LO.SP'])).toEqual([100, 110]);
    expect(c.types[0]!.recipes[0]!.values['LO.RUN']).toBe(true);
  });

  it('sao chép, xóa bản; security', () => {
    let c = duplicateRecipe(base(), 0, 0, 'Mùa hè (bản sao)').cfg;
    expect(c.types[0]!.recipes.map((r) => r.id)).toEqual(['mua-he', 'mua-he-copy']);
    c = removeRecipe(c, 0, 0);
    expect(c.types[0]!.recipes.map((r) => r.id)).toEqual(['mua-he-copy']);
    c = setSecurity(c, 0, 'operate', 'engineer');
    expect(c.types[0]!.security).toEqual({ operate: 'engineer' });
    c = setSecurity(c, 0, 'operate', undefined);
    expect(c.types[0]!.security).toBeUndefined();
  });

  it('CSV: xuất rồi nhập cho cùng dữ liệu (dấu phẩy, ngoặc kép trong tên)', () => {
    let c = addRecipe(base(), 0, 'Đặc biệt, "A"', TAGS).cfg;
    c = setValue(c, 0, 1, 'LO.NOTE', 'STRING', 'a,b "c"')!;
    c = setValue(c, 0, 1, 'LO.SP', 'FLOAT32', '123.5')!;
    const csv = exportCsv(c.types[0]!);
    expect(csv.split('\r\n')[0]).toBe('tagId,mua-he,dac-biet-a');
    const empty = { ...c, types: [{ ...c.types[0]!, recipes: [] }] };
    const back = importCsv(empty, 0, csv, TAGS);
    expect(back.ok && back.cfg).toEqual(c);
  });

  it('CSV hỏng: lỗi theo dòng/cột, không đổi gì', () => {
    const c = base();
    const r = importCsv(c, 0, 'tagId,a\nname,A\nLO.SP,abc\nKHAC,1\n', TAGS);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.map((e) => [e.line, e.column, e.code])).toEqual([
        [3, 2, 'value'],
        [4, 1, 'notParam'],
      ]);
    expect(importCsv(c, 0, 'x,a\n', TAGS)).toMatchObject({ ok: false });
  });

  it('một sửa đổi recipes: tạo recipes.json và recipesFile; một bước', () => {
    const state: EditableProject = {
      project: {
        format: 'matscada-project',
        schemaVersion: '1.1.0',
        projectId: 'p',
        projectName: 'P',
        projectVersion: '1.0.0',
        minRuntimeVersion: '1.1.0',
        entryScreen: 'main',
        screens: ['main'],
        tagFile: 'tags.json',
        maxClients: 10,
      } as unknown as EditableProject['project'],
      tags: { schemaVersion: '1.1.0', tags: [] } as unknown as EditableProject['tags'],
    };
    const { state: s, touched } = applyEdits(state, [recipesEdit(base())]);
    expect((s.project as unknown as { recipesFile?: string }).recipesFile).toBe('recipes.json');
    expect(s.recipes?.types[0]?.id).toBe('lo-say');
    expect(touched.recipes && touched.project).toBe(true);
  });
});
