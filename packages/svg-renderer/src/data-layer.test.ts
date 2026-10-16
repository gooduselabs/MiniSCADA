// T166 (feature 011, FR-105; contracts/project-format-1.0.md §8, svg-editor.md §6): trình vẽ SVG ghi lớp bằng
// `<g data-mat-layer="<tên>">` và tên hiển thị `data-mat-name`; hai thuộc tính nằm trong allowlist và runtime bỏ qua.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP_DATA_ATTRIBUTES,
  MAX_LAYER_NAME_BYTES,
  isDataAttrValue,
  isLayerName,
} from './allowlist.ts';
import { mountScreen } from './mount.ts';
import { parseSvg, sanitizeSvg } from './sanitize.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('data-mat-layer, data-mat-name trong allowlist', () => {
  it('danh sách data-* giữ mặc định gồm uid, name, layer', () => {
    expect([...DEFAULT_KEEP_DATA_ATTRIBUTES].sort()).toEqual([
      'data-mat-layer',
      'data-mat-name',
      'data-mat-uid',
    ]);
  });

  it('bộ lọc giữ data-mat-layer trên g và data-mat-name, không báo gì', () => {
    const svg = parseSvg(
      `<svg ${NS}><g data-mat-layer="Bơm" data-mat-name="Lớp bơm"><rect data-mat-uid="el_aaa" data-mat-name="Vỏ" width="1" height="1"/></g></svg>`,
    );
    const r = sanitizeSvg(svg);
    expect(svg.querySelector('g')!.getAttribute('data-mat-layer')).toBe('Bơm');
    expect(svg.querySelector('g')!.getAttribute('data-mat-name')).toBe('Lớp bơm');
    expect(svg.querySelector('rect')!.getAttribute('data-mat-name')).toBe('Vỏ');
    expect(r.removedAttributes).toBe(0);
    expect(r.removedDataAttributes).toBe(0);
    expect(Object.keys(r.codes)).toEqual([]);
  });

  it('data-mat-layer chỉ trên g: phần tử khác bị gỡ (R_VALUE_INVALID)', () => {
    const svg = parseSvg(`<svg ${NS}><rect data-mat-layer="A" width="1" height="1"/></svg>`);
    const r = sanitizeSvg(svg);
    expect(svg.querySelector('rect')!.hasAttribute('data-mat-layer')).toBe(false);
    expect(r.codes.R_VALUE_INVALID).toBe(1);
  });

  it.each([
    ['rỗng', ''],
    ['ký tự hướng U+202E', 'a‮b'],
    ['ký tự điều khiển', 'a\u0001b'],
    ['quá 64 byte UTF-8', 'Đ'.repeat(33)],
  ])('tên lớp không hợp lệ (%s) bị gỡ', (_l, v) => {
    expect(isLayerName(v)).toBe(false);
    const svg = parseSvg(`<svg ${NS}><g/></svg>`);
    svg.querySelector('g')!.setAttribute('data-mat-layer', v);
    const r = sanitizeSvg(svg);
    expect(svg.querySelector('g')!.hasAttribute('data-mat-layer')).toBe(false);
    expect(r.codes.R_VALUE_INVALID).toBe(1);
  });

  it('tên lớp đúng 64 byte UTF-8 hợp lệ, 65 byte thì không', () => {
    expect(MAX_LAYER_NAME_BYTES).toBe(64);
    expect(isLayerName('Đ'.repeat(32))).toBe(true);
    expect(isLayerName('a'.repeat(64))).toBe(true);
    expect(isLayerName('a'.repeat(65))).toBe(false);
  });

  it('isDataAttrValue: luật theo tên và phần tử', () => {
    expect(isDataAttrValue('g', 'data-mat-layer', 'Nền')).toBe(true);
    expect(isDataAttrValue('rect', 'data-mat-layer', 'Nền')).toBe(false);
    expect(isDataAttrValue('rect', 'data-mat-uid', 'el_abc123')).toBe(true);
    expect(isDataAttrValue('rect', 'data-mat-uid', 'x')).toBe(false);
    expect(isDataAttrValue('rect', 'data-mat-name', 'Bồn 1')).toBe(true);
    expect(isDataAttrValue('rect', 'data-other', 'x')).toBe(false);
  });

  it('runtime bỏ qua hai thuộc tính: dựng như không có chúng, binding theo uid không đổi', () => {
    const layout = {
      viewBox: [0, 0, 10, 10] as [number, number, number, number],
      fitMode: 'contain' as const,
      elements: [{ elementUid: 'el_aaa' }],
    };
    const withAttrs = `<svg ${NS}><g data-mat-layer="Nền" data-mat-name="N"><rect data-mat-uid="el_aaa" width="5" height="5"/></g></svg>`;
    const a = mountScreen(document.createElement('div'), withAttrs, layout);
    expect(a.report.removedDataAttributes).toBe(0);
    expect(a.report.removedAttributes).toBe(0);
    expect(a.missingUids).toEqual([]);
    expect(a.elements.get('el_aaa')!.localName).toBe('rect');
    a.unmount();
  });
});
