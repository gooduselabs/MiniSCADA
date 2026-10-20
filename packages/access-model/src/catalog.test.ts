// Danh mục tài nguyên từ project đã nạp (feature 013, T005; contracts/access-model.md §2, §3, §7).
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProject } from '@mat/project-schema';
import { NodeDirSource } from '@mat/project-schema/node';
import { catalogFromProject, type CatalogProjectInput } from './catalog.ts';

const PROJECTS = resolve(__dirname, '../../../projects');

async function load(name: string): Promise<CatalogProjectInput> {
  const r = await validateProject(new NodeDirSource(resolve(PROJECTS, name)), {
    checkSvg: false,
  });
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  const p = r.project10 ?? r.project05 ?? r.project03;
  expect(p).toBeDefined();
  return p as unknown as CatalogProjectInput;
}

describe('catalogFromProject: projects/grid-demo (1.1)', () => {
  it('màn hình, popup theo thứ tự project; item, operable, mặc định', async () => {
    const cat = catalogFromProject(await load('grid-demo'));
    expect(cat.screens.map((s) => [s.id, s.popup, s.view])).toEqual([
      ['bang-dieu-khien', false, 'viewer'],
      ['tong-quan', false, 'viewer'],
      ['bon-nuoc', false, 'viewer'],
      ['giam-sat', false, 'viewer'],
      ['bom1', true, 'viewer'],
      ['bom', false, 'viewer'],
      ['bom-chi-tiet', true, 'viewer'],
    ]);
    const tq = cat.screens.find((s) => s.id === 'tong-quan')!;
    const it = (id: string) => tq.items.find((i) => i.id === id);
    expect(it('btn_start')).toEqual({
      id: 'btn_start',
      operable: true,
      view: 'viewer',
      operate: 'operator',
      tags: ['PUMP01.RUN_CMD'],
    });
    // svg không có sự kiện ghi: không operable; Tag từ binding, sắp và không trùng
    expect(it('svg1')).toEqual({
      id: 'svg1',
      operable: false,
      view: 'viewer',
      tags: ['PUMP01.FAULT', 'PUMP01.STATE', 'TANK01.LEVEL'],
    });
    expect(it('card_level')).toEqual({
      id: 'card_level',
      operable: false,
      view: 'viewer',
      tags: ['TANK01.LEVEL'],
    });
    expect(it('btn_goto')).toMatchObject({ operable: true, tags: [] });
    expect(it('select_mode')).toMatchObject({ operable: true, tags: ['SIM.MODE'] });
    expect(tq.items).toHaveLength(29);
    expect(cat.historyGroups).toEqual([]);
    expect(cat.reports).toEqual([]);
    expect(cat.alarms).toEqual([]);
  });

  it('popup có tham số: Tag bung theo mọi chỗ gọi (args), không còn {param}', async () => {
    const cat = catalogFromProject(await load('grid-demo'));
    const fp = cat.screens.find((s) => s.id === 'bom-chi-tiet')!;
    const sw = fp.items.find((i) => i.id === 'run_sw')!;
    expect(sw.operable).toBe(true);
    expect(sw.tags).toHaveLength(20);
    expect(sw.tags).toContain('PUMP01.RUN_CMD');
    expect(sw.tags).toContain('PUMP20.RUN_CMD');
    for (const s of cat.screens)
      for (const i of s.items) for (const t of i.tags) expect(t).not.toMatch(/[{}]/);
  });
});

describe('catalogFromProject: nhóm lưu trữ, mẫu báo cáo, alarm', () => {
  it('projects/history-demo (0.6): logging.json, reports.json', async () => {
    const cat = catalogFromProject(await load('history-demo'));
    expect(cat.historyGroups).toEqual([
      { id: 'ap-suat', tags: ['PROC.PRESSURE', 'PROC.TEMP'] },
      { id: 'me-tron', tags: ['METER1.KWH', 'PROC.PRESSURE', 'PROC.TEMP'] },
      { id: 'dien', tags: ['METER1.KW', 'METER1.KWH'] },
      { id: 'van-hanh', tags: ['PUMP1.RUN'] },
    ]);
    expect(cat.reports.map((r) => r.id)).toEqual(['dien-ngay', 'dien-ca', 'dien-thang']);
    expect(cat.reports[0].tags).toEqual(['METER1.KW', 'METER1.KWH']);
  });

  it('projects/alarm-demo (0.5): alarm có Tag nguồn; alarm theo thiết bị không có Tag thì không vào danh mục', async () => {
    const cat = catalogFromProject(await load('alarm-demo'));
    expect(cat.alarms).toContainEqual({ id: 'TANK1_LEVEL', tag: 'TANK1.LEVEL' });
    // an alarm of a device (no source Tag) is kept, with tag null (decision of 2026-10-20)
    expect(cat.alarms).toContainEqual({ id: 'PLC1_LINK', tag: null });
    expect(cat.alarms).toHaveLength(12);
  });
});

describe('catalogFromProject: security của định dạng 1.1 (§3)', () => {
  const W = (id: string, widget: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'widget',
    widget,
    ...extra,
  });
  const input = (): CatalogProjectInput => ({
    screens: {
      s1: {
        screen: {
          id: 's1',
          security: { view: 'engineer' },
          items: [
            W('b1', 'button', { security: { minRole: 'engineer' }, tags: { target: 'A' } }),
            W('b2', 'button', { security: { minRole: 'engineer', operate: 'administrator' } }),
            W('c1', 'card', { security: { view: 'operator' }, tags: { value: 'B' } }),
            W('h1', 'history-trend', { tags: { series: ['C', 'A', 'C'] } }),
            {
              id: 'svg1',
              type: 'svg',
              security: { view: 'operator', operate: 'engineer' },
            },
          ],
        },
        bindings: {
          svg1: {
            elements: [
              { elementUid: 'el_a', bindings: [{ source: { tagId: 'D' } }] },
              { elementUid: 'el_b', events: { click: { action: 'toggle', tag: 'E' } } },
            ],
          },
        },
      },
      p1: { screen: { id: 'p1', kind: 'popup', items: [] }, bindings: {} },
    },
  });

  it('view, operate, minRole (bí danh), svg có sự kiện ghi là operable', () => {
    const cat = catalogFromProject(input());
    expect(cat.screens).toEqual([
      {
        id: 's1',
        popup: false,
        view: 'engineer',
        items: [
          { id: 'b1', operable: true, view: 'viewer', operate: 'engineer', tags: ['A'] },
          { id: 'b2', operable: true, view: 'viewer', operate: 'administrator', tags: [] },
          { id: 'c1', operable: false, view: 'operator', tags: ['B'] },
          { id: 'h1', operable: false, view: 'viewer', tags: ['A', 'C'] },
          { id: 'svg1', operable: true, view: 'operator', operate: 'engineer', tags: ['D', 'E'] },
        ],
      },
      { id: 'p1', popup: true, view: 'viewer', items: [] },
    ]);
  });

  it('không sửa đầu vào', () => {
    const p = input();
    const before = JSON.stringify(p);
    catalogFromProject(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});
