import { describe, expect, it } from 'vitest';
import { applyValue, collectBindings, valueToColor } from './lab-binding';
import { parseSvg } from '@mat/svg-renderer';

describe('valueToColor', () => {
  it('xanh khi thấp, đỏ khi cao, xám khi chất lượng không GOOD', () => {
    expect(valueToColor(0, 'GOOD')).toBe('hsl(120 62% 42%)');
    expect(valueToColor(100, 'GOOD')).toBe('hsl(0 62% 42%)');
    expect(valueToColor(50, 'BAD')).toBe('#8d99a3');
  });

  it('cắt giá trị ngoài 0..100', () => {
    expect(valueToColor(-20, 'GOOD')).toBe(valueToColor(0, 'GOOD'));
    expect(valueToColor(180, 'GOOD')).toBe(valueToColor(100, 'GOOD'));
  });
});

describe('collectBindings', () => {
  it('gom phần tử theo data-tag', () => {
    const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <rect data-tag="SIM.T0001"/><circle data-tag="SIM.T0001"/><g data-tag="SIM.T0002"/><rect/></svg>`);
    const map = collectBindings(svg);
    expect(map.get('SIM.T0001')).toHaveLength(2);
    expect(map.get('SIM.T0002')).toHaveLength(1);
    expect(map.size).toBe(2);
  });
});

describe('applyValue', () => {
  const make = (inner: string) =>
    parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);

  it('đổi fill của phần tử thường', () => {
    const svg = make('<rect id="r" data-tag="A" fill="#000"/>');
    const el = svg.querySelector('#r') as SVGElement;
    applyValue(el, 100, 'GOOD');
    const high = el.style.fill;
    applyValue(el, 0, 'GOOD');
    expect(high).not.toBe('');
    expect(el.style.fill).not.toBe('');
    expect(el.style.fill).not.toBe(high); // giá trị khác → màu khác
  });

  it('đổi stroke khi phần tử có fill="none"', () => {
    const svg = make('<polyline id="p" data-tag="A" fill="none" stroke="#000"/>');
    const el = svg.querySelector('#p') as SVGElement;
    applyValue(el, 0, 'GOOD');
    expect(el.style.stroke).not.toBe('');
    expect(el.style.fill).toBe('');
  });

  it('ghi giá trị vào <text>', () => {
    const svg = make('<text id="t" data-tag="A">--</text>');
    const el = svg.querySelector('#t') as SVGElement;
    applyValue(el, 42.345, 'GOOD');
    expect(el.textContent).toBe('42.3');
  });

  it('đặt thêm color cho <use> (currentColor trong symbol)', () => {
    const svg = make('<use id="u" data-tag="A"/>');
    const el = svg.querySelector('#u') as SVGElement;
    applyValue(el, 0, 'GOOD');
    expect(el.style.color).not.toBe('');
    expect(el.style.fill).not.toBe('');
  });
});

describe('giá trị lạ và chất lượng xấu (review S-5, S-6)', () => {
  const make = (inner: string) =>
    parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);

  it('valueToColor coi giá trị không hữu hạn là xấu', () => {
    expect(valueToColor(Number.NaN, 'GOOD')).toBe('#8d99a3');
    expect(valueToColor(Number.POSITIVE_INFINITY, 'GOOD')).toBe('#8d99a3');
  });

  it('<text> hiện "--" khi giá trị không phải số, không ném lỗi', () => {
    const svg = make('<text id="t">x</text>');
    const el = svg.querySelector('#t') as SVGElement;
    expect(() => applyValue(el, 'abc' as unknown as number, 'GOOD')).not.toThrow();
    expect(el.textContent).toBe('--');
  });

  it('<text> tô xám khi chất lượng không GOOD (ví dụ STALE khi mất kết nối)', () => {
    const svg = make('<text id="t">x</text>');
    const el = svg.querySelector('#t') as SVGElement;
    applyValue(el, 12.34, 'STALE');
    expect(el.textContent).toBe('12.3');
    expect(el.style.fill).not.toBe('');
    applyValue(el, 12.34, 'GOOD');
    expect(el.style.fill).toBe('');
  });
});
