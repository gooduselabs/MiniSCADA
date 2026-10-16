// Mô hình inspector sinh từ danh mục, kiểm gắn Tag (feature 007, T105; contract widget-catalog §4; R21).
import { describe, expect, it } from 'vitest';
import {
  WIDGET_CATALOG,
  catalogWidget,
  type Item,
  type SlotSpec,
  type TagV1,
  type WidgetItem,
  type WidgetSpec,
} from '@mat/project-schema';
import {
  canBind,
  canBindForAction,
  commonProps,
  firstFreeSlot,
  inspectorModelOf,
  suggestFromTag,
  tagDefaults,
  tagInfoOf,
  type TagInfo,
} from './screen-catalog.ts';

const tag = (extra: Partial<TagInfo> = {}): TagInfo => ({
  id: 'a.b',
  type: 'INT16',
  access: 'R',
  kind: 'external',
  ...extra,
});
const slotOf = (widget: string, name: string): SlotSpec =>
  catalogWidget(widget)!.slots.find((s) => s.name === name)!;
const wi = (extra: Partial<WidgetItem> & { widget: string }): WidgetItem => ({
  id: 'x_1',
  type: 'widget',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...extra,
});

describe('tagInfoOf', () => {
  it('chuyển TagV1 gọn; access mặc định R', () => {
    const t: TagV1 = {
      id: 'tank.level',
      kind: 'external',
      type: 'FLOAT32',
      unit: 'm',
      min: 0,
      max: 5,
      limits: { min: 0, max: 4 },
      valueTable: 'vt',
      sim: { kind: 'sine' },
      source: { device: 'plc', address: '40001' },
    };
    expect(tagInfoOf(t)).toEqual({
      id: 'tank.level',
      type: 'FLOAT32',
      access: 'R',
      kind: 'external',
      unit: 'm',
      min: 0,
      max: 5,
      limits: { min: 0, max: 4 },
      valueTable: 'vt',
      sim: { kind: 'sine' },
    });
    expect(tagInfoOf({ ...t, access: 'RW' }).access).toBe('RW');
  });
});

describe('canBind', () => {
  const sw = slotOf('switch', 'target'); // bool, needsWrite
  const gauge = slotOf('gauge', 'value'); // number
  const card = slotOf('card', 'value'); // mọi lớp
  it('kiểu', () => {
    expect(canBind(tag(), card)).toEqual({ ok: true });
    expect(canBind(tag({ type: 'BOOL' }), card)).toEqual({ ok: true });
    expect(canBind(tag({ type: 'STRING' }), card)).toEqual({ ok: true });
    expect(canBind(tag({ type: 'BOOL' }), gauge)).toEqual({ ok: false, reason: 'type-mismatch' });
    expect(canBind(tag({ type: 'STRING' }), gauge)).toEqual({ ok: false, reason: 'type-mismatch' });
    expect(canBind(tag({ type: 'FLOAT64' }), gauge)).toEqual({ ok: true });
  });
  it('khe cần ghi: RW thật sự', () => {
    expect(canBind(tag({ type: 'BOOL', access: 'RW' }), sw)).toEqual({ ok: true });
    expect(canBind(tag({ type: 'BOOL', access: 'R' }), sw)).toEqual({
      ok: false,
      reason: 'needs-write',
    });
    expect(canBind(tag({ type: 'BOOL', access: 'RW', kind: 'calculated' }), sw)).toEqual({
      ok: false,
      reason: 'calculated',
    });
    expect(
      canBind(tag({ type: 'BOOL', access: 'RW', kind: 'simulation', sim: { kind: 'sine' } }), sw),
    ).toEqual({ ok: false, reason: 'simulation' });
    expect(
      canBind(tag({ type: 'BOOL', access: 'RW', kind: 'simulation', sim: { kind: 'manual' } }), sw),
    ).toEqual({ ok: true });
    expect(
      canBind(tag({ type: 'BOOL', access: 'R', kind: 'simulation', sim: { kind: 'manual' } }), sw),
    ).toEqual({ ok: false, reason: 'needs-write' });
    expect(canBind(tag({ type: 'BOOL', kind: 'internal', access: 'RW' }), sw)).toEqual({
      ok: true,
    });
  });
  it('khe chỉ đọc nhận Tag chỉ đọc, tính toán, mô phỏng', () => {
    expect(canBind(tag({ kind: 'calculated' }), gauge)).toEqual({ ok: true });
    expect(canBind(tag({ kind: 'simulation', sim: { kind: 'ramp' } }), gauge)).toEqual({
      ok: true,
    });
  });
  it('kiểu được xét trước quyền ghi', () => {
    expect(canBind(tag({ type: 'INT16', access: 'R' }), sw)).toEqual({
      ok: false,
      reason: 'type-mismatch',
    });
  });
  it('Tag không có trong project', () => {
    expect(canBind(undefined, gauge)).toEqual({ ok: false, reason: 'unknown-tag' });
  });
  it('khe multi: đầy và trùng', () => {
    const series = slotOf('line', 'series'); // max 8
    const eight = Array.from({ length: 8 }, (_, i) => `t.${i}`);
    expect(canBind(tag(), series, eight)).toEqual({ ok: false, reason: 'multi-full' });
    expect(canBind(tag({ id: 't.3' }), series, ['t.1', 't.3'])).toEqual({
      ok: false,
      reason: 'duplicate',
    });
    expect(canBind(tag(), series, ['t.1', 't.2'])).toEqual({ ok: true });
    expect(canBind(tag(), series, eight.slice(0, 7))).toEqual({ ok: true });
    expect(canBind(tag(), series)).toEqual({ ok: true });
  });
  it('khe thường đã có Tag: thay được', () => {
    expect(canBind(tag(), gauge, 'other.tag')).toEqual({ ok: true });
  });
});

describe('canBindForAction (khe target của button)', () => {
  const target = slotOf('button', 'target');
  it('toggle và pulse cần Tag BOOL; write nhận mọi lớp', () => {
    const num = tag({ access: 'RW' });
    const bool = tag({ type: 'BOOL', access: 'RW' });
    expect(canBindForAction(num, target, { action: 'toggle' })).toEqual({
      ok: false,
      reason: 'type-mismatch',
    });
    expect(
      canBindForAction(bool, target, { action: 'pulse', value: true, durationMs: 500 }),
    ).toEqual({
      ok: true,
    });
    expect(canBindForAction(num, target, { action: 'write', value: 1 })).toEqual({ ok: true });
    expect(canBindForAction(tag({ access: 'R' }), target, { action: 'write', value: 1 })).toEqual({
      ok: false,
      reason: 'needs-write',
    });
  });
});

describe('tagDefaults / suggestFromTag ("Dùng của Tag")', () => {
  const full = tag({
    unit: '°C',
    min: 0,
    max: 100,
    limits: { min: 10, max: 90 },
    valueTable: 'vt',
  });
  it('chỉ gồm giá trị Tag có', () => {
    expect(tagDefaults(full)).toEqual({
      unit: '°C',
      min: 0,
      max: 100,
      'limits.min': 10,
      'limits.max': 90,
      valueTable: 'vt',
    });
    expect(tagDefaults(tag())).toEqual({});
  });
  it('gauge lấy unit, min, max; setpoint lấy unit và giới hạn; select lấy bảng', () => {
    expect(suggestFromTag('gauge', undefined, full)).toEqual({ min: 0, max: 100, unit: '°C' });
    expect(suggestFromTag('setpoint', undefined, full)).toEqual({ min: 10, max: 90, unit: '°C' });
    expect(suggestFromTag('select', undefined, full)).toEqual({ table: 'vt' });
    expect(suggestFromTag('card', undefined, full)).toEqual({ unit: '°C' });
  });
  it('không ghi đè thuộc tính đã đặt; widget không có thuộc tính đó thì bỏ', () => {
    expect(suggestFromTag('gauge', { min: 5 }, full)).toEqual({ max: 100, unit: '°C' });
    expect(suggestFromTag('lamp', undefined, full)).toEqual({});
    expect(suggestFromTag('gauge', undefined, tag())).toEqual({});
    expect(suggestFromTag('nope', undefined, full)).toEqual({});
  });
});

describe('inspectorModelOf', () => {
  it('card: nhóm Hiển thị theo thứ tự danh mục, khe, không sự kiện', () => {
    const m = inspectorModelOf('card')!;
    expect(m.labelKey).toBe('widget.card');
    expect(m.groups.display.map((f) => f.name)).toEqual([
      'label',
      'decimals',
      'unit',
      'fontSize',
      'showQuality',
      'valueColor',
      'background',
    ]);
    expect(m.groups.general).toEqual([]);
    expect(m.groups.security).toEqual([]);
    expect(m.slots).toEqual([
      {
        name: 'value',
        required: true,
        multi: false,
        types: ['number', 'bool', 'string'],
        needsWrite: false,
        i18nKey: 'widget.card.slot.value',
      },
    ]);
    expect(m.events).toEqual([]);
    expect(m.minRoles).toBeUndefined();
  });
  it('trường mang đủ ràng buộc và khóa i18n', () => {
    const f = inspectorModelOf('card')!.groups.display.find((x) => x.name === 'decimals')!;
    expect(f).toMatchObject({
      kind: 'int',
      min: 0,
      max: 6,
      default: 1,
      group: 'display',
      i18nKey: 'widget.card.prop.decimals',
    });
    const g = inspectorModelOf('gauge')!.groups.display.find((x) => x.name === 'min')!;
    expect(g).toMatchObject({ kind: 'number', fromTag: 'min', fallback: 0 });
    const e = inspectorModelOf('card')!.groups.display.find((x) => x.name === 'fontSize')!;
    expect(e.options).toEqual(['s', 'm', 'l', 'xl']);
  });
  it('button: nhóm Bảo mật, sự kiện click, vai trò', () => {
    const m = inspectorModelOf('button')!;
    expect(m.groups.security.map((f) => f.name)).toEqual(['confirm', 'confirmText']);
    expect(m.events).toEqual([
      {
        name: 'click',
        actions: ['write', 'toggle', 'pulse', 'navigate', 'popup', 'closePopup'],
        i18nKey: 'widget.button.event.click',
      },
    ]);
    expect(m.minRoles).toEqual(['operator', 'engineer', 'administrator']);
    expect(m.defaultRole).toBe('operator');
  });
  it('khe multi mang max; loại lạ trả undefined', () => {
    expect(inspectorModelOf('line')!.slots[0]).toMatchObject({ multi: true, max: 8 });
    expect(inspectorModelOf('nope')).toBeUndefined();
  });
  it('dựng được cho cả 21 loại (15 của 007, 2 alarm, 4 lịch sử), mọi trường có nhóm và khóa i18n', () => {
    expect(WIDGET_CATALOG.widgets).toHaveLength(21);
    for (const spec of WIDGET_CATALOG.widgets) {
      const m = inspectorModelOf(spec.id)!;
      const all = [...m.groups.general, ...m.groups.display, ...m.groups.security];
      expect(all).toHaveLength(spec.props.length);
      for (const f of all) expect(f.i18nKey).toBe(`widget.${spec.id}.prop.${f.name}`);
    }
  });
});

describe('commonProps (chọn nhiều)', () => {
  const card = (id: string, extra: Partial<WidgetItem> = {}): Item =>
    wi({ id, widget: 'card', x: 10, y: 20, width: 220, height: 110, ...extra });
  it('một item: không có giá trị lẫn', () => {
    const m = commonProps([card('card_1', { props: { decimals: 3 } })]);
    expect(m.widget).toBe('card');
    expect(m.geometry.x).toEqual({ value: 10, mixed: false });
    expect(m.props.find((p) => p.field.name === 'decimals')).toMatchObject({
      value: 3,
      mixed: false,
    });
    expect(m.props.find((p) => p.field.name === 'label')).toMatchObject({
      value: undefined,
      mixed: false,
    });
  });
  it('cùng loại: giá trị chung hoặc lẫn', () => {
    const m = commonProps([
      card('card_1', { x: 10, props: { decimals: 3, label: 'A' } }),
      card('card_2', { x: 20, props: { decimals: 3, label: 'B' }, locked: true }),
    ]);
    expect(m.count).toBe(2);
    expect(m.geometry.x).toEqual({ value: undefined, mixed: true });
    expect(m.geometry.width).toEqual({ value: 220, mixed: false });
    expect(m.locked).toEqual({ value: undefined, mixed: true });
    expect(m.hidden).toEqual({ value: false, mixed: false });
    expect(m.props.find((p) => p.field.name === 'decimals')).toMatchObject({
      value: 3,
      mixed: false,
    });
    expect(m.props.find((p) => p.field.name === 'label')).toMatchObject({ mixed: true });
  });
  it('khác loại: chỉ thuộc tính chung (hình học, khóa, ẩn), không có props', () => {
    const m = commonProps([card('card_1'), wi({ id: 'gauge_1', widget: 'gauge', x: 10, y: 0 })]);
    expect(m.widget).toBeNull();
    expect(m.props).toEqual([]);
    expect(m.geometry.x).toEqual({ value: 10, mixed: false });
    expect(m.geometry.y.mixed).toBe(true);
  });
  it('item svg: không có props', () => {
    const svg: Item = {
      id: 'svg_1',
      type: 'svg',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      svgFile: 'a.svg',
      bindingFile: 'a.json',
      viewBox: [0, 0, 1, 1],
      elements: [],
    };
    const m = commonProps([svg]);
    expect(m.widget).toBeNull();
    expect(m.props).toEqual([]);
  });
  it('rỗng', () => {
    expect(commonProps([]).count).toBe(0);
  });
});

describe('firstFreeSlot (thả Tag lên widget)', () => {
  const two: WidgetSpec = {
    id: 'demo',
    group: 'display',
    label: 'widget.demo',
    defaultSize: [10, 10],
    minSize: [1, 1],
    slots: [
      { name: 'a', required: true, multi: false, types: ['bool'], needsWrite: false },
      { name: 'b', required: false, multi: false, types: ['number'], needsWrite: false },
    ],
    props: [],
    events: [],
  };
  const spec = (id: string) => catalogWidget(id)!;
  it('khe trống đầu tiên hợp kiểu', () => {
    expect(firstFreeSlot(spec('card'), wi({ widget: 'card' }), tag())).toEqual({
      slot: 'value',
      mode: 'set',
    });
    expect(firstFreeSlot(two, wi({ widget: 'demo' }), tag())).toEqual({ slot: 'b', mode: 'set' });
    expect(firstFreeSlot(two, wi({ widget: 'demo' }), tag({ type: 'BOOL' }))).toEqual({
      slot: 'a',
      mode: 'set',
    });
  });
  it('bỏ qua khe đã gắn', () => {
    const item = wi({ widget: 'demo', tags: { a: 'x.y' } });
    expect(firstFreeSlot(two, item, tag())).toEqual({ slot: 'b', mode: 'set' });
  });
  it('khe trống tồn tại nhưng không hợp kiểu: null', () => {
    const item = wi({ widget: 'demo', tags: { a: 'x.y' } });
    expect(firstFreeSlot(two, item, tag({ type: 'BOOL' }))).toBeNull();
  });
  it('mọi khe đã gắn: thay khe chính nếu hợp kiểu', () => {
    const item = wi({ widget: 'demo', tags: { a: 'x.y', b: 'x.z' } });
    expect(firstFreeSlot(two, item, tag({ type: 'BOOL' }))).toEqual({ slot: 'a', mode: 'replace' });
    expect(firstFreeSlot(two, item, tag())).toBeNull();
    expect(
      firstFreeSlot(spec('card'), wi({ widget: 'card', tags: { value: 'q.r' } }), tag()),
    ).toEqual({
      slot: 'value',
      mode: 'replace',
    });
  });
  it('khe multi: nối thêm tới khi đầy', () => {
    const line = spec('line');
    expect(firstFreeSlot(line, wi({ widget: 'line' }), tag())).toEqual({
      slot: 'series',
      mode: 'set',
    });
    expect(
      firstFreeSlot(line, wi({ widget: 'line', tags: { series: ['a.1', 'a.2'] } }), tag()),
    ).toEqual({ slot: 'series', mode: 'append' });
    const eight = Array.from({ length: 8 }, (_, i) => `t.${i}`);
    expect(firstFreeSlot(line, wi({ widget: 'line', tags: { series: eight } }), tag())).toBeNull();
    expect(
      firstFreeSlot(line, wi({ widget: 'line', tags: { series: ['a.b'] } }), tag({ id: 'a.b' })),
    ).toBeNull();
  });
  it('khe cần ghi mà Tag chỉ đọc: null', () => {
    expect(
      firstFreeSlot(spec('switch'), wi({ widget: 'switch' }), tag({ type: 'BOOL' })),
    ).toBeNull();
    expect(
      firstFreeSlot(spec('switch'), wi({ widget: 'switch' }), tag({ type: 'BOOL', access: 'RW' })),
    ).toEqual({ slot: 'target', mode: 'set' });
  });
});
