// Project mới (2026-10-20): mã project sinh từ tên, dựng bộ file của hai mẫu, mọi bộ file qua `validateProject`
// với 0 lỗi (định dạng 1.1).
import { MemorySource, validateProject } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  buildNewProject,
  isValidProjectId,
  projectIdFromName,
  type NewProjectTemplate,
  type NewProjectTheme,
} from './new-project.ts';

const json = (files: Record<string, string>, rel: string) =>
  JSON.parse(files[rel]) as Record<string, unknown>;

describe('projectIdFromName', () => {
  it('bỏ dấu tiếng Việt, chữ thường, gạch nối', () => {
    expect(projectIdFromName('Trạm bơm Số 1')).toBe('tram-bom-so-1');
    expect(projectIdFromName('  Nhà máy nước Đồng Tâm  ')).toBe('nha-may-nuoc-dong-tam');
    expect(projectIdFromName('Lò hơi_A/B (cũ)')).toBe('lo-hoi-a-b-cu');
    expect(projectIdFromName('ĐỒNG HỒ — ĐIỆN')).toBe('dong-ho-dien');
  });

  it('cắt còn 48 ký tự, không để gạch ở cuối', () => {
    const id = projectIdFromName('Trạm '.repeat(30));
    expect(id.length).toBeLessThanOrEqual(48);
    expect(id.endsWith('-')).toBe(false);
    expect(isValidProjectId(id)).toBe(true);
  });

  it('tên không có chữ hay số thì rỗng (người dùng gõ mã)', () => {
    expect(projectIdFromName('!!!')).toBe('');
    expect(projectIdFromName('')).toBe('');
  });

  it('một ký tự thì thêm hậu tố để đủ 2 ký tự', () => {
    expect(projectIdFromName('A')).toBe('a-1');
    expect(isValidProjectId(projectIdFromName('Ă'))).toBe(true);
  });
});

describe('isValidProjectId', () => {
  it('theo pattern projectId của schema, không phải tên thiết bị Windows', () => {
    for (const ok of ['tram-bom', 'ab', '1-tram', 'a'.repeat(48)])
      expect(isValidProjectId(ok)).toBe(true);
    for (const bad of [
      '',
      'a',
      '-ab',
      'Tram',
      'tram bom',
      'tram_bom',
      'trạm',
      'con',
      'nul',
      'com1',
      'a'.repeat(49),
    ])
      expect(isValidProjectId(bad)).toBe(false);
  });
});

describe('buildNewProject', () => {
  const cases: Array<[NewProjectTemplate, NewProjectTheme]> = [
    ['blank', 'vivid'],
    ['blank', 'industrial'],
    ['blank', 'dark'],
    ['pump', 'vivid'],
    ['pump', 'dark'],
  ];

  it.each(cases)('mẫu %s, chủ đề %s: hợp lệ 1.1, 0 lỗi', async (template, theme) => {
    const r = buildNewProject({ name: 'Trạm bơm Số 1', id: 'tram-bom-so-1', template, theme });
    const result = await validateProject(new MemorySource(r.files), { checkSvg: false });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    const p = json(r.files, 'project.json');
    expect(p.format).toBe('matscada-project');
    expect(p.schemaVersion).toBe('1.1.0');
    expect(p.projectId).toBe('tram-bom-so-1');
    expect(p.projectName).toBe('Trạm bơm Số 1');
    expect(p.theme).toBe(theme);
    expect(p.entryScreen).toBe(r.entryScreen);
    // Mọi file đều có đường dẫn tương đối an toàn, không có thư mục ẩn.
    for (const rel of Object.keys(r.files)) {
      expect(rel).toMatch(/^[a-z0-9][A-Za-z0-9_./-]*\.(json|svg)$/);
      expect(rel.split('/').some((s) => s.startsWith('.') || s === '..')).toBe(false);
    }
  });

  it('mẫu trống: project.json, tags.json rỗng, một màn hình lưới tong-quan, điều hướng trỏ vào nó', () => {
    const r = buildNewProject({ name: 'P', id: 'p1', template: 'blank', theme: 'vivid' });
    expect(Object.keys(r.files).sort()).toEqual([
      'project.json',
      'screens/tong-quan.screen.json',
      'tags.json',
    ]);
    expect(r.entryScreen).toBe('tong-quan');
    const p = json(r.files, 'project.json');
    expect(p.screens).toEqual(['tong-quan']);
    expect(p.navigation).toMatchObject({ items: [{ screen: 'tong-quan' }] });
    expect(json(r.files, 'tags.json').tags).toEqual([]);
    const s = json(r.files, 'screens/tong-quan.screen.json');
    expect(s.layout).toMatchObject({ mode: 'grid', columns: 12 });
    const rows = (s.layout as { rows: Array<{ cells: Array<{ span: number; item?: string }> }> })
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.reduce((n, c) => n + c.span, 0)).toBe(12);
    expect(rows[0].cells.every((c) => c.item === undefined)).toBe(true);
    expect(s.items).toEqual([]);
  });

  it('mẫu trạm bơm: Tag mô phỏng, màn hình lưới, biểu đồ; chỉ đổi mã, tên, chủ đề', () => {
    const r = buildNewProject({
      name: 'Trạm A',
      id: 'tram-a',
      template: 'pump',
      theme: 'industrial',
    });
    const tags = json(r.files, 'tags.json').tags as Array<{ kind: string }>;
    expect(tags.some((t) => t.kind === 'simulation')).toBe(true);
    const screens = Object.keys(r.files).filter((k) => k.endsWith('.screen.json'));
    expect(screens.length).toBeGreaterThan(1);
    expect(
      screens.some(
        (k) => (json(r.files, k).layout as { mode?: string } | undefined)?.mode === 'grid',
      ),
    ).toBe(true);
    expect(Object.values(r.files).some((v) => /"widget":\s*"line"/.test(v))).toBe(true);
    expect(r.entryScreen).toBe(json(r.files, 'project.json').entryScreen);
    expect(r.files[`screens/${r.entryScreen}.screen.json`]).toBeDefined();
  });

  it('tên được cắt khoảng trắng hai đầu', () => {
    const r = buildNewProject({ name: '  Trạm  ', id: 'tram', template: 'blank', theme: 'vivid' });
    expect(json(r.files, 'project.json').projectName).toBe('Trạm');
  });
});
