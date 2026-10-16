// FR-099, FR-108 (contract §8): phần tử mới của công cụ có mặc định tô/viền, uid mới, nằm trong allowlist; phông ngoài
// danh sách an toàn cảnh báo W_SVG_FONT; "Mới: SVG trống" mở được và lưu cùng byte.
import { describe, expect, it } from 'vitest';
import { applyCommand } from './command.ts';
import { blankSvg, checkFont, createShape, type ShapeInput } from './shapes.ts';
import { serialize } from './serialize.ts';
import { body, open } from './test-helpers.ts';

describe('createShape', () => {
  it.each<[ShapeInput, string]>([
    [
      { kind: 'rect', x: 1, y: 2, width: 3, height: 4, rx: 1 },
      '<rect data-mat-uid="UID" x="1" y="2" width="3" height="4" rx="1" fill="#cfd8dc" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      { kind: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 1 },
      '<ellipse data-mat-uid="UID" cx="5" cy="5" rx="2" ry="1" fill="#cfd8dc" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      { kind: 'circle', cx: 5, cy: 5, r: 2.12345 },
      '<circle data-mat-uid="UID" cx="5" cy="5" r="2.123" fill="#cfd8dc" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      '<line data-mat-uid="UID" x1="0" y1="0" x2="10" y2="0" fill="none" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      {
        kind: 'polyline',
        points: [
          [0, 0],
          [5, 5],
        ],
      },
      '<polyline data-mat-uid="UID" points="0,0 5,5" fill="none" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      {
        kind: 'polygon',
        points: [
          [0, 0],
          [5, 5],
          [0, 5],
        ],
      },
      '<polygon data-mat-uid="UID" points="0,0 5,5 0,5" fill="#cfd8dc" stroke="#37474f" stroke-width="2"/>',
    ],
    [
      { kind: 'text', x: 1, y: 20, text: 'Bơm <1>' },
      '<text data-mat-uid="UID" x="1" y="20" fill="#263238" font-size="16" font-family="sans-serif" text-anchor="start">Bơm &lt;1&gt;</text>',
    ],
  ])('%j', (input, want) => {
    const doc = body('');
    const r = createShape(doc, input);
    applyCommand(doc, r.batch);
    const uid = doc.nodes.get(r.id)!.attrs.get('data-mat-uid')!;
    expect(uid).toMatch(/^el_[a-z2-7]{10}$/);
    expect(serialize(doc)).toContain(want.replace('UID', uid));
  });

  it('phông ngoài danh sách an toàn: W_SVG_FONT', () => {
    expect(checkFont('Arial, sans-serif')).toBeNull();
    expect(checkFont("'Segoe UI'")).toBeNull();
    expect(checkFont('Comic Sans MS')).toBe('W_SVG_FONT');
    const doc = body('');
    expect(
      createShape(doc, { kind: 'text', x: 0, y: 0, text: 'a', fontFamily: 'Wingdings' }).warning,
    ).toBe('W_SVG_FONT');
  });

  it('Mới: SVG trống mở được, lưu cùng byte, vẽ được', () => {
    const text = blankSvg(800, 600);
    const doc = open(text);
    expect(serialize(doc)).toBe(text);
    applyCommand(doc, createShape(doc, { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }).batch);
    expect(serialize(doc)).toMatch(/^<svg [^>]*>\n {2}<rect [^>]*\/>\n<\/svg>\n$/);
  });
});
