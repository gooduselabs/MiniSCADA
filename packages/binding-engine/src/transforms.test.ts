import { lookupValueTable, type ValueTable } from '@mat/expression';
import type { Binding, Binding02 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyTransform, evaluateBinding, spinRps } from './transforms.ts';

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

  it('rangeMap, format và expression vẫn không hỗ trợ: xử lý như chất lượng xấu, không ném lỗi', () => {
    for (const kind of ['rangeMap', 'format', 'expression']) {
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
