import type { Binding } from '@mat/project-schema';
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
