import { lookupValueTable, type ValueTable } from '@mat/expression';
import type { Binding, Binding02 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyTransform, evaluateBinding, spinRps } from './transforms.ts';
import type { Binding04 } from './types04.ts';

const b04 = (over: Partial<Binding04>): Binding04 => ({
  id: 'x',
  target: 'style.fill',
  source: { type: 'tag', tagId: 'T' },
  transform: { kind: 'direct' },
  ...over,
});

const b = (over: Partial<Binding>): Binding => ({
  id: 'x',
  target: 'style.fill',
  source: { type: 'tag', tagId: 'T' },
  transform: { kind: 'direct' },
  ...over,
});

describe('applyTransform', () => {
  it('direct trả nguyên giá trị; null là lỗi', () => {
    expect(applyTransform({ kind: 'direct' }, 5)).toEqual({ ok: true, value: 5 });
    expect(applyTransform({ kind: 'direct' }, 'a')).toEqual({ ok: true, value: 'a' });
    expect(applyTransform({ kind: 'direct' }, null)).toEqual({ ok: false });
  });

  it('discreteMap so khớp chính xác theo kiểu; default; không khớp → lỗi', () => {
    const t = {
      kind: 'discreteMap' as const,
      cases: [
        { equals: true, value: '#0f0' },
        { equals: 2, value: 'two' },
        { equals: 'x', value: 'ex' },
      ],
    };
    expect(applyTransform(t, true)).toEqual({ ok: true, value: '#0f0' });
    expect(applyTransform(t, 2)).toEqual({ ok: true, value: 'two' });
    expect(applyTransform(t, 'x')).toEqual({ ok: true, value: 'ex' });
    expect(applyTransform(t, false)).toEqual({ ok: false });
    expect(applyTransform(t, '2')).toEqual({ ok: false }); // không ép kiểu
    expect(applyTransform({ ...t, default: 'd' }, 99)).toEqual({ ok: true, value: 'd' });
  });

  it('linearScale nội suy, kẹp mặc định, đảo chiều, NaN/không phải số → lỗi', () => {
    const t = { kind: 'linearScale' as const, inMin: 0, inMax: 20, outMin: 0.6, outMax: 1 };
    expect(applyTransform(t, 10)).toEqual({ ok: true, value: 0.8 });
    expect(applyTransform(t, 40)).toEqual({ ok: true, value: 1 });
    expect(applyTransform(t, -5)).toEqual({ ok: true, value: 0.6 });
    expect(applyTransform({ ...t, clamp: false }, 40)).toEqual({ ok: true, value: 1.4 });
    expect(applyTransform({ ...t, inMin: 20, inMax: 0 }, 5)).toEqual({ ok: true, value: 0.9 });
    expect(applyTransform(t, Number.NaN)).toEqual({ ok: false });
    expect(applyTransform(t, 'abc')).toEqual({ ok: false });
    expect(applyTransform(t, true)).toEqual({ ok: false });
  });
});

describe('evaluateBinding', () => {
  it('đổi màu theo discreteMap', () => {
    const bind = b({
      transform: { kind: 'discreteMap', cases: [{ equals: true, value: '#22c55e' }] },
    });
    expect(evaluateBinding(bind, true, 'GOOD')).toEqual({ hold: false, value: '#22c55e' });
  });

  it('chất lượng xấu: mặc định trung tính theo đích', () => {
    expect(evaluateBinding(b({ target: 'style.fill' }), '#fff', 'BAD')).toEqual({
      hold: false,
      value: '#8d99a3',
    });
    expect(evaluateBinding(b({ target: 'style.stroke' }), '#fff', 'STALE').value).toBe('#8d99a3');
    expect(evaluateBinding(b({ target: 'style.opacity' }), 1, 'UNCERTAIN').value).toBe(0.5);
    expect(evaluateBinding(b({ target: 'text.content' }), 1, 'BAD').value).toBe('--');
    expect(
      evaluateBinding(b({ target: 'transform.rotate', animation: 'spin' }), 1450, 'BAD'),
    ).toEqual({ hold: false, value: 0 });
    expect(evaluateBinding(b({ target: 'transform.rotate' }), 30, 'BAD')).toEqual({ hold: true });
    expect(evaluateBinding(b({ target: 'geometry.levelPercent' }), 50, 'BAD')).toEqual({
      hold: true,
    });
    expect(evaluateBinding(b({ target: 'style.visibility' }), true, 'BAD')).toEqual({ hold: true });
  });

  it('onBadQuality hold/override', () => {
    expect(evaluateBinding(b({ onBadQuality: { mode: 'hold' } }), '#fff', 'BAD')).toEqual({
      hold: true,
    });
    expect(
      evaluateBinding(b({ onBadQuality: { mode: 'override', value: '#f59e0b' } }), '#fff', 'STALE'),
    ).toEqual({ hold: false, value: '#f59e0b' });
  });

  it('transform lỗi (không khớp map) xử lý như chất lượng xấu', () => {
    const bind = b({
      transform: { kind: 'discreteMap', cases: [{ equals: true, value: '#0f0' }] },
      onBadQuality: { mode: 'override', value: '#123456' },
    });
    expect(evaluateBinding(bind, false, 'GOOD')).toEqual({ hold: false, value: '#123456' });
  });

  it('màu không hợp lệ hoặc có url( bị từ chối', () => {
    expect(evaluateBinding(b({}), 'url(http://x)', 'GOOD').value).toBe('#8d99a3');
    expect(evaluateBinding(b({}), 'red;background:url(x)', 'GOOD').value).toBe('#8d99a3');
    expect(evaluateBinding(b({}), 'red', 'GOOD').value).toBe('red');
    expect(evaluateBinding(b({}), '#abc', 'GOOD').value).toBe('#abc');
  });

  it('opacity/level kẹp biên; visibility từ BOOL/chuỗi', () => {
    expect(evaluateBinding(b({ target: 'style.opacity' }), 3, 'GOOD').value).toBe(1);
    expect(evaluateBinding(b({ target: 'geometry.levelPercent' }), -4, 'GOOD').value).toBe(0);
    expect(evaluateBinding(b({ target: 'geometry.levelPercent' }), 140, 'GOOD').value).toBe(100);
    expect(evaluateBinding(b({ target: 'style.visibility' }), false, 'GOOD').value).toBe('hidden');
    expect(evaluateBinding(b({ target: 'style.visibility' }), 'visible', 'GOOD').value).toBe(
      'visible',
    );
    expect(evaluateBinding(b({ target: 'style.visibility' }), 'maybe', 'GOOD')).toEqual({
      hold: true,
    });
  });

  it('override của chữ hiển thị nguyên văn, không thêm hậu tố', () => {
    const bind = b({
      target: 'text.content',
      format: { decimals: 1, suffix: ' °C' },
      onBadQuality: { mode: 'override', value: '--' },
    });
    expect(evaluateBinding(bind, 23.4, 'BAD').value).toBe('--');
  });

  it('text.content có format decimals/suffix', () => {
    const bind = b({ target: 'text.content', format: { decimals: 1, suffix: ' %' } });
    expect(evaluateBinding(bind, 65.234, 'GOOD').value).toBe('65.2 %');
    expect(evaluateBinding(b({ target: 'text.content' }), true, 'GOOD').value).toBe('true');
    expect(evaluateBinding(b({ target: 'text.content' }), 'abc', 'GOOD').value).toBe('abc');
    expect(
      evaluateBinding(b({ target: 'text.content', format: { decimals: 0 } }), 1449.6, 'GOOD').value,
    ).toBe('1450');
  });

  it('spin: rpm hoặc BOOL', () => {
    const spin = b({ target: 'transform.rotate', animation: 'spin' });
    expect(evaluateBinding(spin, 1450, 'GOOD').value).toBe(1450);
    expect(evaluateBinding(spin, true, 'GOOD').value).toBe(600);
    expect(evaluateBinding(spin, false, 'GOOD').value).toBe(0);
    expect(spinRps(0)).toBe(0);
    expect(spinRps(60)).toBeCloseTo(0.1);
    expect(spinRps(1450)).toBe(2); // giới hạn tốc độ hiển thị
  });
});

// ---- Transform `valueTable` (feature 006 T178; contract project-format-0.2 §8; FR-054) ----

describe('transform valueTable', () => {
  const table: ValueTable = {
    entries: [
      { value: 0, text: 'Dừng', color: '#808080' },
      { value: 1, text: 'Chạy', color: '#2E7D32' },
      { value: 2, text: 'Lỗi' },
      { from: 10, to: 20, text: 'Bảo trì', color: '#1565C0' },
    ],
    default: { text: 'Không rõ', color: '#B26A00' },
  };
  const noDefault: ValueTable = { entries: [{ value: 1, text: 'Bật', color: '#0f0' }] };
  const tables = { TrangThaiBom: table, Khac: noDefault };
  const text = (over: Partial<Binding02> = {}): Binding02 =>
    ({
      id: 'x',
      target: 'text.content',
      source: { type: 'tag', tagId: 'PUMP01.STATE' },
      transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'text' },
      ...over,
    }) as Binding02;
  const color = (over: Partial<Binding02> = {}): Binding02 =>
    text({
      target: 'style.fill',
      transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' },
      ...over,
    });

  it('chữ theo mục khớp, khoảng nửa mở [from, to)', () => {
    const ctx = { tables };
    expect(evaluateBinding(text(), 0, 'GOOD', ctx)).toEqual({ hold: false, value: 'Dừng' });
    expect(evaluateBinding(text(), 1, 'GOOD', ctx)).toEqual({ hold: false, value: 'Chạy' });
    expect(evaluateBinding(text(), 10, 'GOOD', ctx).value).toBe('Bảo trì');
    expect(evaluateBinding(text(), 19.9, 'GOOD', ctx).value).toBe('Bảo trì');
    expect(evaluateBinding(text(), 20, 'GOOD', ctx).value).toBe('Không rõ'); // 20 ngoài [10, 20)
  });

  it('màu theo mục; mục không có màu thì không áp màu (chuỗi rỗng bỏ kiểu, phần tử giữ màu gốc)', () => {
    const ctx = { tables };
    expect(evaluateBinding(color(), 1, 'GOOD', ctx)).toEqual({ hold: false, value: '#2E7D32' });
    expect(evaluateBinding(color(), 15, 'GOOD', ctx).value).toBe('#1565C0');
    expect(evaluateBinding(color(), 2, 'GOOD', ctx)).toEqual({ hold: false, value: '' });
    const stroke = color({ target: 'style.stroke' });
    expect(evaluateBinding(stroke, 0, 'GOOD', ctx).value).toBe('#808080');
  });

  it('không khớp: mục mặc định; không có mặc định thì chữ rỗng, màu không áp', () => {
    expect(evaluateBinding(text(), 99, 'GOOD', { tables }).value).toBe('Không rõ');
    expect(evaluateBinding(color(), 99, 'GOOD', { tables }).value).toBe('#B26A00');
    const t = text({ transform: { kind: 'valueTable', table: 'Khac', output: 'text' } });
    const c = color({ transform: { kind: 'valueTable', table: 'Khac', output: 'color' } });
    expect(evaluateBinding(t, 7, 'GOOD', { tables })).toEqual({ hold: false, value: '' });
    expect(evaluateBinding(c, 7, 'GOOD', { tables })).toEqual({ hold: false, value: '' });
  });

  it('vắng `table` thì dùng bảng của Tag; cả hai vắng thì giữ như chất lượng xấu', () => {
    const noTable = text({ transform: { kind: 'valueTable', output: 'text' } });
    expect(evaluateBinding(noTable, 1, 'GOOD', { tables, tagTable: 'TrangThaiBom' }).value).toBe(
      'Chạy',
    );
    expect(evaluateBinding(noTable, 1, 'GOOD', { tables }).value).toBe('--');
    expect(evaluateBinding(noTable, 1, 'GOOD').value).toBe('--');
    // `table` của binding thắng bảng của Tag
    expect(evaluateBinding(text(), 1, 'GOOD', { tables, tagTable: 'Khac' }).value).toBe('Chạy');
  });

  it('BOOL tra như 1 và 0; chuỗi không dùng được', () => {
    expect(evaluateBinding(text(), true, 'GOOD', { tables }).value).toBe('Chạy');
    expect(evaluateBinding(text(), false, 'GOOD', { tables }).value).toBe('Dừng');
    expect(evaluateBinding(text(), 'abc', 'GOOD', { tables }).value).toBe('--');
    expect(evaluateBinding(text(), Number.NaN, 'GOOD', { tables }).value).toBe('Không rõ');
  });

  it('chất lượng xấu, giá trị null hay bảng chưa có thì xử lý như binding khác', () => {
    expect(evaluateBinding(text(), 1, 'BAD', { tables }).value).toBe('--');
    expect(evaluateBinding(color(), 1, 'STALE', { tables }).value).toBe('#8d99a3');
    expect(evaluateBinding(text(), null, 'GOOD', { tables }).value).toBe('--');
    expect(evaluateBinding(text(), 1, 'GOOD', { tables: {} }).value).toBe('--');
    const hold = text({ onBadQuality: { mode: 'hold' } });
    expect(evaluateBinding(hold, 1, 'BAD', { tables })).toEqual({ hold: true });
  });

  it('cùng kết quả với lookupValueTable của @mat/expression (xem trước của Studio)', () => {
    for (const x of [0, 1, 2, 5, 9.99, 10, 15, 19, 20, -1, true, false]) {
      const want = lookupValueTable(table, x);
      expect(evaluateBinding(text(), x, 'GOOD', { tables }).value).toBe(want.text);
      expect(evaluateBinding(color(), x, 'GOOD', { tables }).value).toBe(want.color ?? '');
    }
  });

  it('màu không hợp lệ trong bảng không được áp', () => {
    const evil: ValueTable = { entries: [{ value: 1, text: 'x', color: 'red;background:url(x)' }] };
    const c = color({ transform: { kind: 'valueTable', table: 'E', output: 'color' } });
    expect(evaluateBinding(c, 1, 'GOOD', { tables: { E: evil } }).value).toBe('');
  });

  it('format và expression vẫn không hỗ trợ: xử lý như chất lượng xấu, không ném lỗi (rangeMap đã hỗ trợ từ 0.4)', () => {
    for (const kind of ['format', 'expression']) {
      const bad = { ...b({ target: 'text.content' }), transform: { kind } } as unknown as Binding;
      expect(() => evaluateBinding(bad, 1, 'GOOD')).not.toThrow();
      expect(evaluateBinding(bad, 1, 'GOOD')).toEqual({ hold: false, value: '--' });
    }
  });

  it('transform có sẵn không đổi khi có ngữ cảnh bảng', () => {
    const direct = b({ target: 'text.content' });
    expect(evaluateBinding(direct, 'abc', 'GOOD', { tables })).toEqual({
      hold: false,
      value: 'abc',
    });
  });
});

// ---- Chuyển đổi mở rộng 0.4 (feature 008 T024; contract binding-animation.md §2, §7) ----

describe('rangeMap (0.4)', () => {
  const t = {
    kind: 'rangeMap' as const,
    ranges: [
      { to: 20, value: 'low' },
      { from: 20, to: 80, value: 'mid' },
      { from: 80, value: 'high' },
    ],
  };
  it('from bao gồm, to không bao gồm; -inf và +inf', () => {
    expect(applyTransform(t, -1000)).toEqual({ ok: true, value: 'low' });
    expect(applyTransform(t, 19.99)).toEqual({ ok: true, value: 'low' });
    expect(applyTransform(t, 20)).toEqual({ ok: true, value: 'mid' });
    expect(applyTransform(t, 79.99)).toEqual({ ok: true, value: 'mid' });
    expect(applyTransform(t, 80)).toEqual({ ok: true, value: 'high' });
    expect(applyTransform(t, 1e9)).toEqual({ ok: true, value: 'high' });
  });
  it('không khớp: default hoặc lỗi; không phải số hữu hạn: lỗi', () => {
    const gap = { kind: 'rangeMap' as const, ranges: [{ from: 0, to: 10, value: 1 }] };
    expect(applyTransform(gap, 10)).toEqual({ ok: false });
    expect(applyTransform({ ...gap, default: 9 }, 10)).toEqual({ ok: true, value: 9 });
    expect(applyTransform(gap, true)).toEqual({ ok: false });
    expect(applyTransform(gap, 'a')).toEqual({ ok: false });
    expect(applyTransform(gap, Number.NaN)).toEqual({ ok: false });
    expect(applyTransform(gap, null)).toEqual({ ok: false });
  });
  it('đổi màu theo khoảng qua evaluateBinding', () => {
    const bind = b04({
      target: 'style.fill',
      transform: { kind: 'rangeMap', ranges: [{ to: 50, value: '#00ff00' }], default: '' },
    });
    expect(evaluateBinding(bind, 10, 'GOOD')).toEqual({ hold: false, value: '#00ff00' });
    expect(evaluateBinding(bind, 60, 'GOOD')).toEqual({ hold: false, value: '' });
  });
});

describe('text.content mở rộng (0.4)', () => {
  const text = (format: Binding04['format'], over: Partial<Binding04> = {}): Binding04 =>
    b04({ target: 'text.content', format, ...over });
  it('decimals, prefix, suffix', () => {
    const f = { decimals: 1, prefix: '~', suffix: ' %' };
    expect(evaluateBinding(text(f), 65.234, 'GOOD').value).toBe('~65.2 %');
    expect(evaluateBinding(text({ decimals: 0 }), 1449.6, 'GOOD').value).toBe('1450');
    expect(evaluateBinding(text({ prefix: 'Mức: ' }), 'abc', 'GOOD').value).toBe('Mức: abc');
  });
  it('unitFromTag dùng đơn vị Tag; suffix thắng; vắng đơn vị thì không thêm', () => {
    const f = { decimals: 1, unitFromTag: true };
    expect(evaluateBinding(text(f), 3.14, 'GOOD', { unit: 'bar' }).value).toBe('3.1 bar');
    expect(evaluateBinding(text({ ...f, suffix: '!' }), 3.14, 'GOOD', { unit: 'bar' }).value).toBe(
      '3.1!',
    );
    expect(evaluateBinding(text(f), 3.14, 'GOOD').value).toBe('3.1');
  });
  it('bảng giá trị và rangeMap cho chữ', () => {
    const tables = { S: { entries: [{ value: 1, text: 'Chạy' }] } };
    const vt = text(undefined, { transform: { kind: 'valueTable', table: 'S', output: 'text' } });
    expect(evaluateBinding(vt, 1, 'GOOD', { tables }).value).toBe('Chạy');
    const rm = text(undefined, {
      transform: { kind: 'rangeMap', ranges: [{ to: 10, value: 'Thấp' }], default: 'Cao' },
    });
    expect(evaluateBinding(rm, 5, 'GOOD').value).toBe('Thấp');
    expect(evaluateBinding(rm, 50, 'GOOD').value).toBe('Cao');
  });
});

describe('effect.blink (0.4)', () => {
  const blink = (over: Partial<Binding04> = {}): Binding04 =>
    b04({ target: 'effect.blink', ...over });
  it('BOOL, số 0, số khác 0', () => {
    expect(evaluateBinding(blink(), true, 'GOOD')).toEqual({ hold: false, value: 1 });
    expect(evaluateBinding(blink(), false, 'GOOD')).toEqual({ hold: false, value: 0 });
    expect(evaluateBinding(blink(), 0, 'GOOD')).toEqual({ hold: false, value: 0 });
    expect(evaluateBinding(blink(), -3.5, 'GOOD')).toEqual({ hold: false, value: 1 });
  });
  it('discreteMap và rangeMap cho đầu ra boolean', () => {
    const dm = blink({
      transform: { kind: 'discreteMap', cases: [{ equals: 3, value: true }], default: false },
    });
    expect(evaluateBinding(dm, 3, 'GOOD').value).toBe(1);
    expect(evaluateBinding(dm, 4, 'GOOD').value).toBe(0);
    const rm = blink({
      transform: { kind: 'rangeMap', ranges: [{ from: 90, value: true }], default: false },
    });
    expect(evaluateBinding(rm, 95, 'GOOD').value).toBe(1);
    expect(evaluateBinding(rm, 10, 'GOOD').value).toBe(0);
  });
  it('chất lượng xấu: tắt; override/hold theo khai báo', () => {
    expect(evaluateBinding(blink(), true, 'BAD')).toEqual({ hold: false, value: 0 });
    expect(evaluateBinding(blink({ onBadQuality: { mode: 'hold' } }), true, 'BAD')).toEqual({
      hold: true,
    });
    const ov = blink({ onBadQuality: { mode: 'override', value: true } });
    expect(evaluateBinding(ov, 0, 'STALE').value).toBe(1);
  });
});

describe('effect.flow (0.4)', () => {
  const flow = (over: Partial<Binding04> = {}): Binding04 =>
    b04({ target: 'effect.flow', ...over });
  it('BOOL: speed (mặc định 60) hoặc dừng', () => {
    expect(evaluateBinding(flow(), true, 'GOOD').value).toBe(60);
    expect(evaluateBinding(flow({ speed: 80 }), true, 'GOOD').value).toBe(80);
    expect(evaluateBinding(flow(), false, 'GOOD').value).toBe(0);
  });
  it('số: |s| kẹp [0, 300]; âm không byValueSign lấy trị tuyệt đối', () => {
    expect(evaluateBinding(flow(), 120, 'GOOD').value).toBe(120);
    expect(evaluateBinding(flow(), 999, 'GOOD').value).toBe(300);
    expect(evaluateBinding(flow(), -50, 'GOOD').value).toBe(50);
    expect(evaluateBinding(flow(), 0, 'GOOD').value).toBe(0);
  });
  it('byValueSign giữ dấu (chiều) và kẹp 300', () => {
    const f = flow({ byValueSign: true });
    expect(evaluateBinding(f, -50, 'GOOD').value).toBe(-50);
    expect(evaluateBinding(f, -999, 'GOOD').value).toBe(-300);
    expect(evaluateBinding(f, 70, 'GOOD').value).toBe(70);
  });
  it('chất lượng xấu: dừng', () => {
    expect(evaluateBinding(flow(), 100, 'BAD')).toEqual({ hold: false, value: 0 });
  });
});

describe('translate, scale, clipLevel, rotate (0.4)', () => {
  it('translateX/Y kẹp ±100000; không phải số → giữ', () => {
    const tx = b04({ target: 'transform.translateX' });
    expect(evaluateBinding(tx, 25, 'GOOD').value).toBe(25);
    expect(evaluateBinding(tx, 1e7, 'GOOD').value).toBe(100000);
    const ty = b04({ target: 'transform.translateY' });
    expect(evaluateBinding(ty, -1e7, 'GOOD').value).toBe(-100000);
    expect(evaluateBinding(tx, 'abc', 'GOOD')).toEqual({ hold: true });
    expect(evaluateBinding(tx, 5, 'BAD')).toEqual({ hold: true });
  });
  it('scale kẹp [0.01, 10]; chất lượng xấu giữ', () => {
    const sc = b04({ target: 'transform.scale' });
    expect(evaluateBinding(sc, 2, 'GOOD').value).toBe(2);
    expect(evaluateBinding(sc, 0, 'GOOD').value).toBe(0.01);
    expect(evaluateBinding(sc, 50, 'GOOD').value).toBe(10);
    expect(evaluateBinding(sc, 2, 'STALE')).toEqual({ hold: true });
    expect(evaluateBinding(sc, 'x', 'GOOD')).toEqual({ hold: true });
  });
  it('clipLevel kẹp [0, 100]; xấu giữ', () => {
    const cl = b04({ target: 'geometry.clipLevel' });
    expect(evaluateBinding(cl, 140, 'GOOD').value).toBe(100);
    expect(evaluateBinding(cl, -4, 'GOOD').value).toBe(0);
    expect(evaluateBinding(cl, 50, 'BAD')).toEqual({ hold: true });
    expect(evaluateBinding(cl, true, 'GOOD')).toEqual({ hold: true });
  });
  it('rotate/visibility với rangeMap; fill cho phép chuỗi rỗng (giữ màu gốc)', () => {
    const rot = b04({
      target: 'transform.rotate',
      transform: { kind: 'rangeMap', ranges: [{ from: 1, value: 90 }], default: 0 },
    });
    expect(evaluateBinding(rot, 5, 'GOOD').value).toBe(90);
    expect(evaluateBinding(rot, 0, 'GOOD').value).toBe(0);
    const vis = b04({
      target: 'style.visibility',
      transform: { kind: 'rangeMap', ranges: [{ from: 1, value: 'visible' }], default: 'hidden' },
    });
    expect(evaluateBinding(vis, 0, 'GOOD').value).toBe('hidden');
    const fill = b04({
      target: 'style.fill',
      transform: { kind: 'discreteMap', cases: [{ equals: true, value: '' }] },
    });
    expect(evaluateBinding(fill, true, 'GOOD')).toEqual({ hold: false, value: '' });
  });
});
