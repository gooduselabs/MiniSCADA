// T011: danh mục widget (contracts/widget-catalog.md). Nguồn duy nhất: schemas/widgets.catalog.json.
import { describe, expect, it } from 'vitest';
import {
  ACTION_NAMES,
  WIDGET_CATALOG,
  catalogWidget,
  checkPropValue,
  type PropSpec,
} from './catalog.ts';

const IDS = [
  'card',
  'label',
  'lamp',
  'gauge',
  'level',
  'panel',
  // danh mục 0.6.0 (feature 014): widget dashboard
  'stat-tile',
  'kpi',
  'progress',
  'status-list',
  'clock',
  'text',
  'image',
  'line',
  'bar',
  'pie',
  'tag-table',
  'button',
  'switch',
  'setpoint',
  'slider',
  'select',
  'alarm-list',
  'alarm-count',
  // danh mục 0.5.0 (feature 010)
  'history-trend',
  'history-table',
  'history-bar',
  'history-pie',
];

describe('danh mục widget', () => {
  it('có đúng 28 id theo contract (15 của 007, 2 của 009, 4 của 010, 7 của 014)', () => {
    expect(WIDGET_CATALOG.widgets.map((w) => w.id)).toEqual(IDS);
    expect(WIDGET_CATALOG.catalogVersion).toBe('0.6.0');
  });

  it('id đúng dạng, nhóm hợp lệ, minSize <= defaultSize', () => {
    for (const w of WIDGET_CATALOG.widgets) {
      expect(w.id).toMatch(/^[a-z][a-z-]{1,19}$/);
      expect(['display', 'chart', 'table', 'control', 'alarm', 'history']).toContain(w.group);
      expect(w.minSize[0]).toBeLessThanOrEqual(w.defaultSize[0]);
      expect(w.minSize[1]).toBeLessThanOrEqual(w.defaultSize[1]);
      expect(w.label).toBe(`widget.${w.id}`);
    }
  });

  it('cỡ mặc định và tối thiểu khớp bảng contract §2', () => {
    const size = (id: string) => [catalogWidget(id)!.defaultSize, catalogWidget(id)!.minSize];
    expect(size('card')).toEqual([
      [220, 110],
      [96, 56],
    ]);
    expect(size('label')).toEqual([
      [200, 40],
      [24, 16],
    ]);
    expect(size('lamp')).toEqual([
      [140, 40],
      [24, 24],
    ]);
    expect(size('gauge')).toEqual([
      [240, 200],
      [120, 100],
    ]);
    expect(size('level')).toEqual([
      [100, 260],
      [40, 80],
    ]);
    expect(size('panel')).toEqual([
      [400, 300],
      [80, 60],
    ]);
    expect(size('line')).toEqual([
      [600, 300],
      [240, 140],
    ]);
    expect(size('bar')).toEqual([
      [400, 260],
      [160, 120],
    ]);
    expect(size('pie')).toEqual([
      [280, 280],
      [120, 120],
    ]);
    expect(size('tag-table')).toEqual([
      [420, 300],
      [240, 80],
    ]);
    expect(size('button')).toEqual([
      [160, 48],
      [64, 32],
    ]);
    expect(size('switch')).toEqual([
      [160, 48],
      [64, 32],
    ]);
    expect(size('setpoint')).toEqual([
      [220, 72],
      [120, 48],
    ]);
    expect(size('slider')).toEqual([
      [280, 64],
      [120, 32],
    ]);
    expect(size('select')).toEqual([
      [220, 72],
      [120, 48],
    ]);
  });

  it('khe: types thuộc 3 lớp; khe multi có max; khe needsWrite chỉ ở widget điều khiển', () => {
    for (const w of WIDGET_CATALOG.widgets) {
      for (const s of w.slots) {
        for (const t of s.types) expect(['number', 'bool', 'string']).toContain(t);
        if (s.multi) expect(s.max).toBeGreaterThan(0);
        if (s.needsWrite) expect(w.group).toBe('control');
      }
    }
    expect(catalogWidget('line')!.slots[0]).toMatchObject({ multi: true, max: 8, required: true });
    expect(catalogWidget('bar')!.slots[0]!.max).toBe(12);
    expect(catalogWidget('pie')!.slots[0]!.max).toBe(8);
    expect(catalogWidget('tag-table')!.slots[0]!.max).toBe(50);
    expect(catalogWidget('panel')!.slots).toEqual([]);
  });

  it('hành động chỉ từ tập 6; chỉ button có sự kiện click', () => {
    for (const w of WIDGET_CATALOG.widgets) {
      for (const e of w.events) for (const a of e.actions) expect(ACTION_NAMES).toContain(a);
      expect(w.events.length > 0).toBe(w.id === 'button');
    }
    expect(ACTION_NAMES).toEqual(['write', 'toggle', 'pulse', 'navigate', 'popup', 'closePopup']);
  });

  it('props không trùng tên; default hợp ràng buộc của chính nó', () => {
    for (const w of WIDGET_CATALOG.widgets) {
      const names = w.props.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
      for (const p of w.props) {
        if (p.default !== undefined) {
          expect(checkPropValue(p, p.default), `${w.id}.${p.name}`).toBeNull();
        }
      }
    }
  });

  it('widget điều khiển có security.minRole mặc định operator, không viewer', () => {
    for (const w of WIDGET_CATALOG.widgets.filter((x) => x.group === 'control')) {
      expect(w.security?.default).toBe('operator');
      expect(w.security?.minRole).not.toContain('viewer');
    }
    expect(catalogWidget('card')!.security).toBeUndefined();
  });

  it('thuộc tính chính theo contract', () => {
    const prop = (w: string, p: string) => catalogWidget(w)!.props.find((x) => x.name === p)!;
    expect(prop('card', 'decimals')).toMatchObject({ kind: 'int', min: 0, max: 6, default: 1 });
    expect(prop('line', 'windowSec')).toMatchObject({ min: 10, max: 3600, default: 60 });
    expect(prop('line', 'sampleMs')).toMatchObject({ min: 250, max: 60000, default: 1000 });
    expect(prop('gauge', 'zones')).toMatchObject({ kind: 'array', maxItems: 4 });
    expect(prop('switch', 'onText').default).toBe('Bật');
    expect(prop('button', 'confirm').default).toBe('always');
    expect(catalogWidget('setpoint')!.props.some((p) => p.name === 'confirm')).toBe(false);
    expect(prop('tag-table', 'columns').default).toEqual(['label', 'value', 'unit', 'quality']);
  });

  // Feature 014: widget dashboard và khung có tiêu đề.
  it('widget dashboard (014): nhóm display, không sự kiện, cỡ tối thiểu, thuộc tính chính', () => {
    const prop = (w: string, p: string) => catalogWidget(w)!.props.find((x) => x.name === p)!;
    for (const id of ['stat-tile', 'kpi', 'progress', 'status-list', 'clock', 'text', 'image']) {
      const w = catalogWidget(id)!;
      expect(w.group, id).toBe('display');
      expect(w.events, id).toEqual([]);
    }
    expect(catalogWidget('stat-tile')!.minSize).toEqual([160, 96]);
    expect(prop('stat-tile', 'color').options).toEqual([
      'teal',
      'blue',
      'rose',
      'violet',
      'olive',
      'indigo',
      'orange',
      'cyan',
      'green',
      'slate',
    ]);
    const icons = prop('stat-tile', 'icon').options!;
    expect(icons[0]).toBe('none');
    expect(icons.length - 1).toBeGreaterThanOrEqual(16);
    expect(catalogWidget('stat-tile')!.slots.map((s) => [s.name, s.required])).toEqual([
      ['value', true],
      ['alarm', false],
    ]);
    expect(catalogWidget('status-list')!.slots[0]).toMatchObject({ multi: true, max: 16 });
    expect(catalogWidget('clock')!.slots).toEqual([]);
    const off = prop('clock', 'utcOffset');
    expect(checkPropValue(off, '+07:00')).toBeNull();
    expect(checkPropValue(off, '-14:00')).toBeNull();
    expect(checkPropValue(off, '+7:00')).not.toBeNull();
    expect(checkPropValue(off, '+15:00')).not.toBeNull();
    const src = prop('image', 'src');
    expect(checkPropValue(src, '')).toBeNull();
    expect(checkPropValue(src, 'graphics/logo.svg')).toBeNull();
    expect(checkPropValue(src, 'graphics/symbols/bom-ly-tam.svg')).toBeNull();
    for (const bad of [
      'graphics/../project.json',
      '/graphics/a.svg',
      'https://x/a.svg',
      'graphics/a.png',
      'screens/a.svg',
      'graphics/a b.svg',
    ])
      expect(checkPropValue(src, bad), bad).not.toBeNull();
    expect(prop('text', 'text')).toMatchObject({ kind: 'string', maxLength: 300, multiline: true });
    for (const id of ['line', 'bar', 'pie', 'gauge', 'tag-table'])
      expect(prop(id, 'title'), id).toMatchObject({ kind: 'string', maxLength: 60, default: '' });
    expect(prop('line', 'highLimit').kind).toBe('number');
    expect(prop('line', 'lowLimit').kind).toBe('number');
    expect(prop('panel', 'variant')).toMatchObject({
      options: ['plain', 'card'],
      default: 'plain',
    });
  });
});

describe('checkPropValue', () => {
  const p = (o: Partial<PropSpec> & { kind: PropSpec['kind'] }): PropSpec =>
    ({ name: 'x', group: 'display', ...o }) as PropSpec;
  it('string: độ dài', () => {
    expect(checkPropValue(p({ kind: 'string', maxLength: 3 }), 'abc')).toBeNull();
    expect(checkPropValue(p({ kind: 'string', maxLength: 3 }), 'abcd')).not.toBeNull();
    expect(checkPropValue(p({ kind: 'string', maxLength: 3 }), 5)).not.toBeNull();
  });
  it('int: số nguyên trong khoảng', () => {
    const s = p({ kind: 'int', min: 0, max: 6 });
    expect(checkPropValue(s, 0)).toBeNull();
    expect(checkPropValue(s, 6)).toBeNull();
    expect(checkPropValue(s, 7)).not.toBeNull();
    expect(checkPropValue(s, 1.5)).not.toBeNull();
    expect(checkPropValue(s, '1')).not.toBeNull();
  });
  it('number: hữu hạn, exclusiveMin', () => {
    expect(checkPropValue(p({ kind: 'number' }), 1.5)).toBeNull();
    expect(checkPropValue(p({ kind: 'number' }), Infinity)).not.toBeNull();
    expect(checkPropValue(p({ kind: 'number', exclusiveMin: 0 }), 0)).not.toBeNull();
    expect(checkPropValue(p({ kind: 'number', exclusiveMin: 0 }), 0.1)).toBeNull();
  });
  it('bool, enum', () => {
    expect(checkPropValue(p({ kind: 'bool' }), true)).toBeNull();
    expect(checkPropValue(p({ kind: 'bool' }), 'true')).not.toBeNull();
    expect(checkPropValue(p({ kind: 'enum', options: ['a', 'b'] }), 'a')).toBeNull();
    expect(checkPropValue(p({ kind: 'enum', options: ['a', 'b'] }), 'c')).not.toBeNull();
  });
  it('color: #RRGGBB, auto chỉ khi allowAuto', () => {
    expect(checkPropValue(p({ kind: 'color' }), '#A1b2C3')).toBeNull();
    expect(checkPropValue(p({ kind: 'color' }), '#abc')).not.toBeNull();
    expect(checkPropValue(p({ kind: 'color' }), 'auto')).not.toBeNull();
    expect(checkPropValue(p({ kind: 'color', allowAuto: true }), 'auto')).toBeNull();
  });
  it('array: maxItems, phần tử, unique', () => {
    const s = p({
      kind: 'array',
      items: { kind: 'enum', options: ['a', 'b'] },
      maxItems: 2,
      unique: true,
    });
    expect(checkPropValue(s, ['a', 'b'])).toBeNull();
    expect(checkPropValue(s, ['a', 'a'])).not.toBeNull();
    expect(checkPropValue(s, ['a', 'b', 'a'])).not.toBeNull();
    expect(checkPropValue(s, ['c'])).not.toBeNull();
  });
  it('zones: from < to, không chồng, màu hợp lệ, <= 4', () => {
    const z = catalogWidget('gauge')!.props.find((x) => x.name === 'zones')!;
    const ok = [
      { from: 0, to: 10, color: '#112233' },
      { from: 10, to: 20, color: '#445566' },
    ];
    expect(checkPropValue(z, ok)).toBeNull();
    expect(checkPropValue(z, [{ from: 5, to: 5, color: '#112233' }])).not.toBeNull();
    expect(
      checkPropValue(z, [
        { from: 0, to: 10, color: '#112233' },
        { from: 9, to: 20, color: '#445566' },
      ]),
    ).not.toBeNull();
    expect(checkPropValue(z, [{ from: 0, to: 10, color: 'red' }])).not.toBeNull();
    const five = Array.from({ length: 5 }, (_, i) => ({ from: i, to: i + 1, color: '#112233' }));
    expect(checkPropValue(z, five)).not.toBeNull();
  });
  it('tableRef: chuỗi tên', () => {
    expect(checkPropValue(p({ kind: 'tableRef' }), 'TrangThai')).toBeNull();
    expect(checkPropValue(p({ kind: 'tableRef' }), 3)).not.toBeNull();
  });
});
