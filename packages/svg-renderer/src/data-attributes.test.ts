import { describe, expect, it } from 'vitest';
import { parseSvg, sanitizeSvg } from './sanitize.ts';

describe('data-* (ADR-003: chỉ giữ data-mat-uid)', () => {
  const doc = () =>
    parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect data-mat-uid="el_a" data-tag="SIM.T0001" data-foo="x"/></svg>',
    );

  it('mặc định giữ data-mat-uid, bỏ data-* khác và đếm riêng', () => {
    const svg = doc();
    const report = sanitizeSvg(svg);
    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('data-mat-uid')).toBe('el_a');
    expect(rect.hasAttribute('data-tag')).toBe(false);
    expect(rect.hasAttribute('data-foo')).toBe(false);
    expect(report.removedDataAttributes).toBe(2);
    expect(report.removedAttributes).toBe(0);
  });

  it('trang lab có thể giữ thêm data-tag', () => {
    const svg = doc();
    sanitizeSvg(svg, { keepDataAttributes: ['data-mat-uid', 'data-tag'] });
    expect(svg.querySelector('rect')!.getAttribute('data-tag')).toBe('SIM.T0001');
  });
});
