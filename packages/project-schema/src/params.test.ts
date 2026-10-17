// T021 (FR-122, FR-125; contracts/project-format-1.0.md §3, §5): `substituteParams` thuần, dùng chung validator TS
// (bung tĩnh popup có tham số, bản sao template) và trang vận hành (@mat/ui-components, T174). Chỉ `{name}` ở đúng chỗ
// của bảng "chỗ dùng được" (danh mục widget, khóa `params.places`), không lồng, ký tự `{` `}` lạ là lỗi, giá trị kiểm
// theo `kind` (tagPrefix: regex và 64 byte; string: 128 byte, không ký tự điều khiển; number; color).
import { describe, expect, it } from 'vitest';
import {
  checkParamDecls,
  checkParamPlaces,
  paramTokens,
  paramValueError,
  resolveArgs,
  substituteParams,
  type ParamDecl,
} from './params.ts';

const P: ParamDecl[] = [
  { name: 'prefix', kind: 'tagPrefix' },
  { name: 'title', kind: 'string', default: 'Bơm' },
  { name: 'max', kind: 'number', default: '100' },
  { name: 'tone', kind: 'color', default: '#22c55e' },
];
const card = (over: Record<string, unknown> = {}) => ({
  id: 'flow',
  type: 'widget',
  widget: 'card',
  x: 0,
  y: 0,
  width: 150,
  height: 60,
  props: { label: '{title} (lưu lượng)', valueColor: '{tone}' },
  tags: { value: '{prefix}.FLOW' },
  ...over,
});
const gauge = () => ({
  id: 'g',
  type: 'widget',
  widget: 'gauge',
  x: 0,
  y: 0,
  width: 200,
  height: 160,
  props: { min: 0, max: '{max}' },
  tags: { value: '{prefix}' },
});

describe('paramValueError', () => {
  it('tagPrefix: regex của Tag id, tối đa 64 byte', () => {
    for (const v of ['PUMP07', 'Plant1.PUMP_07', 'A', 'a.b_c.9'])
      expect(paramValueError('tagPrefix', v), v).toBeNull();
    for (const v of [
      '',
      '7PUMP',
      'PUMP 07',
      'PUMP-07',
      'PUMP.',
      '.PUMP',
      'P{x}',
      'P}',
      'Bơm',
      'A..B',
    ])
      expect(paramValueError('tagPrefix', v), v).not.toBeNull();
    expect(paramValueError('tagPrefix', 'A'.repeat(64))).toBeNull();
    expect(paramValueError('tagPrefix', 'A'.repeat(65))).not.toBeNull();
  });
  it('string: tối đa 128 byte UTF-8, không ký tự điều khiển', () => {
    expect(paramValueError('string', 'Bơm số 7 {không thay}')).toBeNull();
    expect(paramValueError('string', '')).toBeNull();
    expect(paramValueError('string', 'ơ'.repeat(64))).toBeNull(); // 128 byte
    expect(paramValueError('string', 'ơ'.repeat(64) + 'a')).not.toBeNull();
    expect(paramValueError('string', 'a\nb')).not.toBeNull();
    expect(paramValueError('string', 'a\u007fb')).not.toBeNull();
  });
  it('number: số JSON hữu hạn viết thành chuỗi', () => {
    for (const v of ['0', '-1', '100', '2.5', '1e3', '-0.25E-2'])
      expect(paramValueError('number', v), v).toBeNull();
    for (const v of ['', '1.', '.5', '+1', '0x10', '1e999', 'NaN', 'Infinity', '01', ' 1'])
      expect(paramValueError('number', v), v).not.toBeNull();
  });
  it('color: #RRGGBB', () => {
    expect(paramValueError('color', '#22C55e')).toBeNull();
    for (const v of ['#fff', '22c55e', '#22c55g', 'red', 'auto'])
      expect(paramValueError('color', v), v).not.toBeNull();
  });
  it('giá trị không phải chuỗi là lỗi ở mọi kind', () => {
    for (const k of ['tagPrefix', 'string', 'number', 'color'] as const)
      expect(paramValueError(k, 5), k).not.toBeNull();
  });
});

describe('paramTokens', () => {
  it('tách chuỗi thường và {name}', () => {
    expect(paramTokens('{title} (lưu lượng)')).toEqual({
      ok: true,
      parts: [{ param: 'title' }, ' (lưu lượng)'],
    });
    expect(paramTokens('không có')).toEqual({ ok: true, parts: ['không có'] });
  });
  it('lồng, ngoặc lạ, tên sai dạng là lỗi', () => {
    for (const s of ['{{a}}', '{a', 'a}', '{}', '{A}', '{a b}', '{a{b}}', '}{', '{1a}'])
      expect(paramTokens(s).ok, s).toBe(false);
  });
});

describe('checkParamDecls', () => {
  it('tên trùng và default sai kind', () => {
    expect(checkParamDecls(P)).toEqual([]);
    const bad = checkParamDecls([
      { name: 'a', kind: 'string' },
      { name: 'a', kind: 'string' },
      { name: 'n', kind: 'number', default: 'mười' },
      { name: 'p', kind: 'tagPrefix', default: 'A-B' },
    ]);
    expect(bad.map((x) => x.path)).toEqual(['/1/name', '/2/default', '/3/default']);
  });
});

describe('resolveArgs', () => {
  it('lấy default cho tham số vắng', () => {
    expect(resolveArgs(P, { prefix: 'PUMP07' })).toEqual({
      ok: true,
      values: { prefix: 'PUMP07', title: 'Bơm', max: '100', tone: '#22c55e' },
    });
  });
  it('thiếu (không default), thừa, sai kind, không phải chuỗi', () => {
    const r = resolveArgs(P, { title: 7, extra: 'x', max: 'nhiều' } as Record<string, unknown>);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.path).sort()).toEqual(['/extra', '/max', '/prefix', '/title']);
    expect(resolveArgs(P, undefined).ok).toBe(false);
    expect(resolveArgs([], undefined)).toEqual({ ok: true, values: {} });
    expect(resolveArgs([], {}).ok).toBe(true);
    expect(resolveArgs([], { a: 'x' }).ok).toBe(false);
    expect(resolveArgs(P, ['PUMP07'] as unknown as Record<string, unknown>).ok).toBe(false);
  });
});

describe('checkParamPlaces', () => {
  it('chỗ dùng đúng không có lỗi', () => {
    expect(checkParamPlaces(card(), P)).toEqual([]);
    expect(checkParamPlaces(gauge(), P)).toEqual([]);
  });
  it('{name} không khai, ngoài chỗ dùng được, sai kind cho chỗ đó', () => {
    const cases: Array<[unknown, string]> = [
      [card({ tags: { value: '{x}.FLOW' } }), '/tags/value'],
      [card({ tags: { value: 'PUMP.{prefix}' } }), '/tags/value'],
      [card({ tags: { value: '{title}.FLOW' } }), '/tags/value'],
      [card({ tags: { value: '{prefix}.{title}' } }), '/tags/value'],
      [card({ tags: { value: '{prefix}-FLOW' } }), '/tags/value'],
      [card({ props: { label: '{prefix}' } }), '/props/label'],
      [card({ props: { label: '{{title}}' } }), '/props/label'],
      [card({ props: { label: 'Bơm }' } }), '/props/label'],
      [card({ props: { showQuality: '{max}' } }), '/props/showQuality'],
      [card({ props: { valueColor: 'x{tone}' } }), '/props/valueColor'],
      [card({ props: { fontSize: '{title}' } }), '/props/fontSize'],
      [card({ name: '{title}' }), '/name'],
      [card({ id: 'a{b}' }), '/id'],
      [gauge(), ''],
    ];
    for (const [item, path] of cases.slice(0, -1)) {
      const r = checkParamPlaces(item, P);
      expect(
        r.map((x) => x.path),
        JSON.stringify(item),
      ).toEqual([path]);
    }
    // number vào props số nhưng không trọn chuỗi
    const g = gauge();
    g.props.max = '{max}0';
    expect(checkParamPlaces(g, P).map((x) => x.path)).toEqual(['/props/max']);
  });
  it('args của hành động popup: {param} chỉ được trong template', () => {
    const btn = {
      id: 'detail',
      type: 'widget',
      widget: 'button',
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      props: { label: 'Chi tiết {title}' },
      events: { click: { action: 'popup', screen: 'bom', args: { prefix: '{prefix}' } } },
    };
    expect(checkParamPlaces(btn, P, { template: true })).toEqual([]);
    expect(checkParamPlaces(btn, P).map((x) => x.path)).toEqual(['/events/click/args/prefix']);
    const undeclared = JSON.parse(JSON.stringify(btn));
    undeclared.events.click.args.prefix = '{x}';
    expect(checkParamPlaces(undeclared, P, { template: true }).map((x) => x.path)).toEqual([
      '/events/click/args/prefix',
    ]);
  });
  it('khe nhiều Tag và mảng chuỗi của props', () => {
    const line = {
      id: 'l',
      type: 'widget',
      widget: 'bar',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      props: { labels: ['{title} 1', 'B'] },
      tags: { series: ['{prefix}.A', '{prefix}.B', 'OTHER.C'] },
    };
    expect(checkParamPlaces(line, P)).toEqual([]);
  });
});

describe('substituteParams', () => {
  it('thay chuỗi thuần; number thành số; không đụng chỗ không có {name}', () => {
    const r = substituteParams(card(), P, { prefix: 'PUMP07', title: 'Bơm 7' });
    expect(r).toEqual({
      ok: true,
      value: card({
        props: { label: 'Bơm 7 (lưu lượng)', valueColor: '#22c55e' },
        tags: { value: 'PUMP07.FLOW' },
      }),
    });
    const g = substituteParams(gauge(), P, { prefix: 'TANK01.LEVEL', max: '250.5' });
    expect(g.ok && g.value.props).toEqual({ min: 0, max: 250.5 });
    expect(g.ok && g.value.tags).toEqual({ value: 'TANK01.LEVEL' });
  });
  it('một lần duyệt: giá trị chứa {x} không bị thay tiếp', () => {
    const r = substituteParams(card(), P, { prefix: 'P', title: '{prefix}' });
    expect(r.ok && (r.value.props as Record<string, unknown>).label).toBe('{prefix} (lưu lượng)');
  });
  it('không đổi đầu vào; cùng đầu vào cùng kết quả', () => {
    const item = card();
    const before = JSON.stringify(item);
    const a = substituteParams(item, P, { prefix: 'PUMP07' });
    const b = substituteParams(item, P, { prefix: 'PUMP07' });
    expect(JSON.stringify(item)).toBe(before);
    expect(a).toEqual(b);
  });
  it('lỗi chỗ đặt và lỗi args được báo riêng (kind place / args)', () => {
    const r = substituteParams(card({ tags: { value: '{x}.A' } }), P, {
      prefix: 'PUMP 07',
      extra: 'a',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => `${p.kind}:${p.path}`).sort()).toEqual([
      'args:/extra',
      'args:/prefix',
      'place:/tags/value',
    ]);
  });
  it('args trong template được thay khi bung', () => {
    const btn = {
      id: 'detail',
      type: 'widget',
      widget: 'button',
      events: {
        click: { action: 'popup', screen: 'bom', args: { prefix: '{prefix}', t: 'Bơm {title}' } },
      },
    };
    const r = substituteParams(btn, P, { prefix: 'PUMP07', title: '7' }, { template: true });
    expect(r.ok && r.value.events.click.args).toEqual({ prefix: 'PUMP07', t: 'Bơm 7' });
  });
  it('item không có {name} giữ nguyên với mọi args hợp lệ', () => {
    const plain = card({ props: { label: 'A' }, tags: { value: 'X.Y' } });
    expect(substituteParams(plain, P, { prefix: 'Z' })).toEqual({ ok: true, value: plain });
  });
});

// Rà soát T062 F8: khóa `__proto__` (JSON.parse tạo thành thuộc tính riêng) không được đổi prototype của bản thay, và
// không mất khỏi kết quả; `constructor`, `prototype` giữ nguyên là dữ liệu.
describe('substituteParams: khóa __proto__, constructor, prototype', () => {
  it('giữ khóa là thuộc tính riêng, prototype của bản thay không đổi', () => {
    const item = JSON.parse(
      JSON.stringify(card()).replace(
        '"props":{',
        '"props":{"__proto__":{"polluted":"yes"},"constructor":"c","prototype":"x",',
      ),
    ) as ReturnType<typeof card>;
    const r = substituteParams(item, P, { prefix: 'PUMP07', title: 'Bơm 7' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const props = r.value.props as Record<string, unknown>;
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(props, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(props, '__proto__')?.value).toEqual({ polluted: 'yes' });
    expect(props.label).toBe('Bơm 7 (lưu lượng)');
    expect((props as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(props, 'constructor')?.value).toBe('c');
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});
