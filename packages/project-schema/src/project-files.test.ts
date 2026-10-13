// Tập file của project (specs/005-device-online/data-model.md §8): những file Studio đóng gói và digest tính
// trên đó. Cùng vector với bản C++ LoadedProject::files(): trường `files` của vector hợp lệ trong
// tests/project-vectors.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFiles, validateProject, type ProjectFileRefs } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const expectedOf = (d: string) => JSON.parse(readFileSync(join(DIR, d, 'expected.json'), 'utf8'));
const valid = readdirSync(DIR).filter(
  (d) => existsSync(join(DIR, d, 'expected.json')) && expectedOf(d).valid,
);

const screen = (bindingFile: string, svgFile: string) => ({ screen: { bindingFile, svgFile } });

describe('projectFiles()', () => {
  it('project.json, tagFile, loggingFile, mỗi màn hình 3 file; không trùng; sắp theo byte UTF-8', () => {
    const p: ProjectFileRefs = {
      project: {
        tagFile: 'Thẻ Tag.json',
        loggingFile: 'logging.json',
        screens: ['overview', 'pump'],
      },
      screens: {
        pump: screen('màn hình/gắn kết.json', 'màn hình/Tổng quan.svg'),
        overview: screen('screens/overview.bindings.json', 'màn hình/Tổng quan.svg'), // SVG dùng chung
      },
    };
    expect(projectFiles(p)).toEqual([
      'Thẻ Tag.json', // 'T' (0x54) đứng trước mọi chữ thường
      'logging.json',
      'màn hình/Tổng quan.svg', // 'T' trước 'g'
      'màn hình/gắn kết.json',
      'project.json',
      'screens/overview.bindings.json',
      'screens/overview.screen.json',
      'screens/pump.screen.json',
    ]);
  });

  it('không có loggingFile thì không có file lưu trữ', () => {
    const p: ProjectFileRefs = {
      project: { tagFile: 'tags.json', screens: ['main'] },
      screens: { main: screen('screens/main.bindings.json', 'screens/main.svg') },
    };
    expect(projectFiles(p)).toEqual([
      'project.json',
      'screens/main.bindings.json',
      'screens/main.screen.json',
      'screens/main.svg',
      'tags.json',
    ]);
  });

  it('màn hình chưa nạp được vẫn có file .screen.json; khóa của Object.prototype không bị đọc', () => {
    const p: ProjectFileRefs = {
      project: { tagFile: 'tags.json', screens: ['main', 'constructor'] },
      screens: {},
    };
    expect(projectFiles(p)).toEqual([
      'project.json',
      'screens/constructor.screen.json',
      'screens/main.screen.json',
      'tags.json',
    ]);
  });
});

describe('tests/project-vectors: projectFiles() khớp `files` của vector hợp lệ', () => {
  it('có đủ vector hợp lệ', () => {
    expect(valid.length).toBeGreaterThanOrEqual(10);
    expect(valid).toContain('valid-tank-demo');
  });

  for (const d of valid) {
    it(d, async () => {
      const r = await validateProject(new NodeDirSource(join(DIR, d)), {
        checkSvg: false,
        // ca 0.5 ghi runtime của chúng (0.8.0; runtime của repo chưa nâng tới T125)
        ...(expectedOf(d).runtimeVersion ? { runtimeVersion: expectedOf(d).runtimeVersion } : {}),
      });
      expect(r.valid, JSON.stringify(r.errors, null, 1)).toBe(true);
      expect(projectFiles((r.project ?? r.project02 ?? r.project03)!)).toEqual(expectedOf(d).files);
    });
  }
});

describe('projectFiles() với định dạng 0.2 (contract project-format-0.2 §1)', () => {
  it('thêm connectionFile, value-tables/<tên>.json và watch-tables/<id>.json', () => {
    const p: ProjectFileRefs = {
      project: {
        tagFile: 'tags.json',
        connectionFile: 'connections.json',
        valueTables: ['TrangThaiBom', 'Khác'],
        watchTables: ['van-hanh'],
        screens: ['main'],
      },
      screens: { main: screen('screens/main.bindings.json', 'screens/main.svg') },
    };
    expect(projectFiles(p)).toEqual([
      'connections.json',
      'project.json',
      'screens/main.bindings.json',
      'screens/main.screen.json',
      'screens/main.svg',
      'tags.json',
      'value-tables/Khác.json',
      'value-tables/TrangThaiBom.json',
      'watch-tables/van-hanh.json',
    ]);
  });

  it('thứ tự byte UTF-8, không phải thứ tự khai báo', () => {
    const p: ProjectFileRefs = {
      project: {
        tagFile: 'tags.json',
        valueTables: ['b', 'B', 'a'],
        watchTables: ['z', 'a'],
        screens: [],
      },
      screens: {},
    };
    expect(projectFiles(p)).toEqual([
      'project.json',
      'tags.json',
      'value-tables/B.json',
      'value-tables/a.json',
      'value-tables/b.json',
      'watch-tables/a.json',
      'watch-tables/z.json',
    ]);
  });
});

describe('projectFiles() với định dạng 0.3 (contract project-format-0.3 §1)', () => {
  const svgItem = (id: string, svgFile: string, bindingFile: string) => ({
    id,
    type: 'svg' as const,
    svgFile,
    bindingFile,
  });
  const widget = (id: string) => ({ id, type: 'widget' as const, widget: 'panel' });

  it('mỗi màn hình có .screen.json, thêm svgFile và bindingFile của từng item svg; item widget không thêm file', () => {
    const p: ProjectFileRefs = {
      project: { tagFile: 'tags.json', screens: ['main', 'pump'] },
      screens: {
        main: {
          screen: {
            items: [
              svgItem('svg1', 'screens/main.svg', 'screens/main.bindings.json'),
              widget('panel_1'),
              svgItem('svg2', 'screens/extra.svg', 'screens/extra.bindings.json'),
            ],
          },
        },
        pump: { screen: { items: [widget('p1')] } },
      },
    };
    expect(projectFiles(p)).toEqual([
      'project.json',
      'screens/extra.bindings.json',
      'screens/extra.svg',
      'screens/main.bindings.json',
      'screens/main.screen.json',
      'screens/main.svg',
      'screens/pump.screen.json',
      'tags.json',
    ]);
  });

  it('SVG dùng chung giữa hai item hoặc hai màn hình chỉ tính một lần', () => {
    const p: ProjectFileRefs = {
      project: { tagFile: 'tags.json', screens: ['a', 'b'] },
      screens: {
        a: {
          screen: {
            items: [
              svgItem('svg1', 'screens/shared.svg', 'screens/a1.bindings.json'),
              svgItem('svg2', 'screens/shared.svg', 'screens/a2.bindings.json'),
            ],
          },
        },
        b: {
          screen: { items: [svgItem('svg1', 'screens/shared.svg', 'screens/b.bindings.json')] },
        },
      },
    };
    expect(projectFiles(p).filter((f) => f === 'screens/shared.svg')).toHaveLength(1);
    expect(projectFiles(p)).toHaveLength(8);
  });

  it('màn hình 0.3 chưa nạp được vẫn có .screen.json', () => {
    const p: ProjectFileRefs = {
      project: { tagFile: 'tags.json', screens: ['main'] },
      screens: {},
    };
    expect(projectFiles(p)).toEqual(['project.json', 'screens/main.screen.json', 'tags.json']);
  });
});
