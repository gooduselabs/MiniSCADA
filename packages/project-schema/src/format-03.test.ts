// Định dạng ghi 0.3 (T018; contracts/project-format-0.3.md §11, FR-070): cùng đầu vào cùng byte, mỗi item một khối
// gọn trên một dòng, thứ tự khóa chuẩn, không ghi trường bằng mặc định, không BOM, xuất rồi đọc lại bằng nhau.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MemorySource,
  formatProject03,
  formatScreen03,
  validateProject,
  type Project03,
  type ScreenModel,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v03-valid-full');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const mainScreen = (): ScreenModel => JSON.parse(read('screens/main.screen.json'));

const small = (): ScreenModel => ({
  schemaVersion: '0.3.0',
  id: 'main',
  name: 'Tổng quan',
  kind: 'screen',
  size: { width: 1920, height: 1080 },
  fitMode: 'contain',
  items: [
    {
      id: 'card_level',
      name: 'Mức bồn',
      type: 'widget',
      widget: 'card',
      x: 60,
      y: 100,
      width: 220,
      height: 110,
      locked: false,
      hidden: false,
      props: { decimals: 1, label: 'Mức nước', showQuality: true },
      tags: { value: 'TANK01.LEVEL' },
    },
    {
      id: 'svg1',
      name: 'Đồ họa',
      type: 'svg',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      svgFile: 'screens/main.svg',
      bindingFile: 'screens/main.bindings.json',
      viewBox: [0, 0, 100, 100],
      fit: 'contain',
      elements: [{ elementUid: 'el_aaa' }],
    },
  ],
});

describe('formatScreen03', () => {
  it('cùng đầu vào cho cùng byte, kể cả khi thứ tự khóa đầu vào khác', () => {
    const a = formatScreen03(small());
    expect(formatScreen03(small())).toBe(a);
    const shuffled = JSON.parse(JSON.stringify(small()));
    shuffled.items[0] = Object.fromEntries(Object.entries(shuffled.items[0]).reverse());
    expect(formatScreen03(shuffled)).toBe(a);
  });

  it('UTF-8 không BOM, kết thúc bằng đúng một dòng trống, chữ có dấu không bị escape', () => {
    const s = formatScreen03(small());
    expect(s.charCodeAt(0)).toBe(0x7b);
    expect(s.endsWith('}\n')).toBe(true);
    expect(s.endsWith('\n\n')).toBe(false);
    expect(s).toContain('Tổng quan');
    expect(s).toContain('Mức nước');
    expect(s).not.toMatch(/\\u[0-9a-f]{4}/);
  });

  it('cấp màn hình thụt 2 dấu cách, mỗi item một dòng gọn', () => {
    const lines = formatScreen03(small()).split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "schemaVersion": "0.3.0",');
    expect(lines[2]).toBe('  "id": "main",');
    expect(lines[3]).toBe('  "name": "Tổng quan",');
    const itemLines = lines.filter((l) => l.startsWith('    {'));
    expect(itemLines).toHaveLength(2);
    for (const l of itemLines) expect(JSON.parse(l.trim().replace(/,$/, ''))).toBeTypeOf('object');
    expect(lines.at(-4)).toMatch(/^ {4}\{.*\}$/); // item cuối không có dấu phẩy
    expect(lines.at(-3)).toBe('  ]');
    expect(lines.at(-2)).toBe('}');
  });

  it('không ghi trường bằng mặc định', () => {
    const s = formatScreen03(small());
    expect(s).not.toContain('"kind"');
    expect(s).not.toContain('"fitMode"');
    expect(s).not.toContain('"locked"');
    expect(s).not.toContain('"hidden"');
    expect(s).not.toContain('"fit"');
    expect(s).not.toContain('showQuality'); // mặc định true của card
    expect(s).not.toContain('"decimals"');
    expect(s).toContain('"label":"Mức nước"');
  });

  it('ghi trường khác mặc định', () => {
    const m = small();
    m.kind = 'popup';
    m.fitMode = 'cover';
    m.background = '#0F172A';
    Object.assign(m.items[0]!, { locked: true, hidden: true });
    (m.items[0] as { props: Record<string, unknown> }).props.decimals = 2;
    (m.items[1] as { fit?: string }).fit = 'cover';
    const s = formatScreen03(m);
    expect(s).toContain('"kind": "popup"');
    expect(s).toContain('"fitMode": "cover"');
    expect(s).toContain('"background": "#0F172A"');
    expect(s).toContain('"locked":true');
    expect(s).toContain('"hidden":true');
    expect(s).toContain('"decimals":2');
    expect(s).toContain('"fit":"cover"');
  });

  it('thứ tự khóa của item widget: id, name, type, widget, x, y, width, height, locked, hidden, props, tags, events, security', () => {
    const m = small();
    m.items = [
      {
        security: { minRole: 'engineer' },
        events: { click: { durationMs: 500, value: true, action: 'pulse' } },
        tags: { target: 'PUMP01.RUN_CMD' },
        props: { variant: 'danger', label: 'B' },
        hidden: true,
        locked: true,
        height: 48,
        width: 160,
        y: 2,
        x: 1,
        widget: 'button',
        type: 'widget',
        name: 'N',
        id: 'btn1',
      } as never,
    ];
    const line = formatScreen03(m)
      .split('\n')
      .find((l) => l.startsWith('    {'))!;
    const keys = Object.keys(JSON.parse(line.trim()));
    expect(keys).toEqual([
      'id',
      'name',
      'type',
      'widget',
      'x',
      'y',
      'width',
      'height',
      'locked',
      'hidden',
      'props',
      'tags',
      'events',
      'security',
    ]);
    // thứ tự prop theo danh mục (label trước variant); hành động: action, value, durationMs
    expect(line).toContain('"props":{"label":"B","variant":"danger"}');
    expect(line).toContain('"click":{"action":"pulse","value":true,"durationMs":500}');
  });

  it('thứ tự khóa của item svg: ..., locked, hidden, svgFile, bindingFile, viewBox, fit, elements', () => {
    const m = small();
    const svg = m.items[1] as unknown as Record<string, unknown>;
    svg.fit = 'stretch';
    svg.locked = true;
    svg.hidden = true;
    const line = formatScreen03(m)
      .split('\n')
      .find((l) => l.includes('"type":"svg"'))!;
    expect(Object.keys(JSON.parse(line.trim()))).toEqual([
      'id',
      'name',
      'type',
      'x',
      'y',
      'width',
      'height',
      'locked',
      'hidden',
      'svgFile',
      'bindingFile',
      'viewBox',
      'fit',
      'elements',
    ]);
  });

  it('props, tags, events, security rỗng sau khi bỏ mặc định thì không ghi', () => {
    const m = small();
    m.items = [
      {
        id: 'sw1',
        type: 'widget',
        widget: 'switch',
        x: 0,
        y: 0,
        width: 160,
        height: 48,
        props: { onText: 'Bật', confirm: 'always' },
        tags: { target: 'PUMP01.RUN_CMD' },
        security: { minRole: 'operator' },
      },
    ];
    const line = formatScreen03(m)
      .split('\n')
      .find((l) => l.startsWith('    {'))!;
    expect(Object.keys(JSON.parse(line.trim()))).toEqual([
      'id',
      'type',
      'widget',
      'x',
      'y',
      'width',
      'height',
      'tags',
    ]);
  });

  it('màn hình không item: "items": []', () => {
    const m = small();
    m.items = [];
    expect(formatScreen03(m)).toContain('  "items": []\n}\n');
  });

  it('vùng màu (zones) giữ thứ tự from, to, color', () => {
    const m = small();
    m.items = [
      {
        id: 'g1',
        type: 'widget',
        widget: 'gauge',
        x: 0,
        y: 0,
        width: 240,
        height: 200,
        props: { zones: [{ color: '#00FF00', to: 50, from: 0 }] },
        tags: { value: 'TANK01.LEVEL' },
      },
    ];
    expect(formatScreen03(m)).toContain('"zones":[{"from":0,"to":50,"color":"#00FF00"}]');
  });

  it('xuất rồi đọc lại bằng nhau (tới dạng chuẩn) và vẫn hợp lệ', async () => {
    const out = formatScreen03(mainScreen());
    const again = formatScreen03(JSON.parse(out) as ScreenModel);
    expect(again).toBe(out);
    const files: Record<string, string> = {};
    for (const f of [
      'project.json',
      'tags.json',
      'connections.json',
      'value-tables/TrangThaiBom.json',
      'watch-tables/van-hanh.json',
      'screens/main.bindings.json',
      'screens/main.svg',
      'screens/pump.screen.json',
    ])
      files[f] = read(f);
    files['screens/main.screen.json'] = out;
    const r = await validateProject(new MemorySource(files), { checkSvg: false });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.project03?.screens.main!.screen.items.map((i) => i.id)).toEqual(
      mainScreen().items.map((i) => i.id),
    );
  });
});

describe('formatProject03', () => {
  const project = (): Project03 => ({
    format: 'matscada-project',
    schemaVersion: '0.3.0',
    projectId: 'pump-station',
    projectName: 'Trạm bơm số 1',
    projectVersion: '1.2.0',
    minRuntimeVersion: '0.6.0',
    entryScreen: 'tong-quan',
    screens: ['tong-quan', 'giam-sat'],
    tagFile: 'tags.json',
    maxClients: 10,
    navigation: {
      position: 'left',
      items: [
        { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
        { label: 'Giám sát', icon: 'chart', items: [{ label: 'Xu hướng', screen: 'giam-sat' }] },
      ],
    },
  });

  it('giữ thứ tự khóa đầu vào, navigation đứng trước maxClients khi đầu vào để cuối', () => {
    const lines = formatProject03(project()).split('\n');
    const keys = lines.filter((l) => /^ {2}"/.test(l)).map((l) => l.trim().split('"')[1]);
    expect(keys).toEqual([
      'format',
      'schemaVersion',
      'projectId',
      'projectName',
      'projectVersion',
      'minRuntimeVersion',
      'entryScreen',
      'screens',
      'tagFile',
      'navigation',
      'maxClients',
    ]);
  });

  it('mỗi mục menu một dòng gọn; vị trí giữ nguyên (không bỏ mặc định)', () => {
    const s = formatProject03(project());
    expect(s).toContain('    "position": "left",');
    expect(s).toContain('      {"label":"Tổng quan","screen":"tong-quan","icon":"home"},');
    expect(s).toContain(
      '      {"label":"Giám sát","icon":"chart","items":[{"label":"Xu hướng","screen":"giam-sat"}]}',
    );
  });

  it('cùng đầu vào cùng byte; không BOM; một dòng trống cuối; đọc lại bằng nhau', () => {
    const a = formatProject03(project());
    expect(formatProject03(project())).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
    expect(JSON.parse(a)).toEqual(project());
    expect(formatProject03(JSON.parse(a) as Project03)).toBe(a);
  });

  it('không navigation thì không ghi; menu rỗng ghi "items": []', () => {
    const p = project();
    delete p.navigation;
    expect(formatProject03(p)).not.toContain('navigation');
    p.navigation = { position: 'hidden', items: [] };
    expect(formatProject03(p)).toContain('    "items": []');
  });
});
