// T152 (SC-031; FR-107): `isPolygonPath`, phân tích và ghi đường đa giác, sửa nút đa tuyến/đa giác/path đa giác trong
// hệ tài liệu (kể cả khi cha có transform), đóng/mở.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand } from './command.ts';
import { isPolygonPath, parsePath, pathToPolys, polysToPath } from './path.ts';
import {
  deletePoint,
  editablePoints,
  insertPoint,
  nearestSegment,
  setClosed,
  setPoint,
} from './polygon.ts';
import { attr, body, byId } from './test-helpers.ts';

describe('isPolygonPath', () => {
  it.each<[string, boolean]>([
    ['M0 0 L10 10', true],
    ['M0 0 H10 V10 Z', true],
    ['m0 0 l10 0 v10 h-10 z', true],
    ['M0,0 10,0 10,10', true],
    ['M0 0 L1 1 M5 5 L6 6 Z', true],
    ['M0 0 C1 1 2 2 3 3', false],
    ['M0 0 Q1 1 2 2', false],
    ['M0 0 S1 1 2 2', false],
    ['M0 0 T1 1', false],
    ['M0 0 A5 5 0 0 1 10 0', false],
    ['M0 0 L1 1 a1 1 0 0 1 2 2', false],
    ['L0 0', false],
    ['', false],
    ['M0 0 L', false],
  ])('%s → %s', (d, want) => expect(isPolygonPath(d)).toBe(want));
});

describe('pathToPolys và polysToPath (lệnh tuyệt đối)', () => {
  it.each<[string, string]>([
    ['M0 0 L10 10', 'M0 0 L10 10'],
    ['m1 1 l10 0 v10 h-10 z', 'M1 1 L11 1 L11 11 L1 11 Z'],
    ['M0 0 H5 V5 Z M10 10 L20 20', 'M0 0 L5 0 L5 5 Z M10 10 L20 20'],
    ['M0 0 L1 1 Z L5 5', 'M0 0 L1 1 Z M0 0 L5 5'],
    ['M0.1234 0 L1e1 2', 'M0.123 0 L10 2'],
  ])('%s → %s', (d, want) => expect(polysToPath(pathToPolys(d)!)).toBe(want));
  it('đường cong: null', () => expect(pathToPolys('M0 0 C1 1 2 2 3 3')).toBeNull());
  it('parsePath: cờ cung dính liền (a5 5 0 1010 10)', () => {
    const p = parsePath('M0 0 a5 5 0 1010 10')!;
    expect(p.segs[1]).toMatchObject({ cmd: 'A', large: true, sweep: false, x: 10, y: 10 });
  });
});

describe('sửa nút', () => {
  it('điểm của polyline trong hệ tài liệu (cha có transform)', () => {
    const doc = body(
      '<g transform="translate(10 0) scale(2)"><polyline id="p" points="0,0 5,5"/></g>',
    );
    const e = editablePoints(doc, byId(doc, 'p'));
    expect(e.ok && e.points).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
  });

  it('kéo điểm: quy về hệ của phần tử', () => {
    const doc = body(
      '<g transform="translate(10 0) scale(2)"><polyline id="p" points="0,0 5,5"/></g>',
    );
    applyCommand(doc, setPoint(doc, byId(doc, 'p'), 1, { x: 30, y: 20 }));
    expect(attr(doc, 'p', 'points')).toBe('0,0 10,10');
  });

  it('thêm điểm sau chỉ số 0 và xóa điểm', () => {
    const doc = body('<polygon id="p" points="0,0 10,0 10,10"/>');
    applyCommand(doc, insertPoint(doc, byId(doc, 'p'), 0, { x: 5, y: -1 }));
    expect(attr(doc, 'p', 'points')).toBe('0,0 5,-1 10,0 10,10');
    applyCommand(doc, deletePoint(doc, byId(doc, 'p'), 1));
    expect(attr(doc, 'p', 'points')).toBe('0,0 10,0 10,10');
  });

  it('không xóa dưới 3 điểm (đa giác) / 2 điểm (đa tuyến)', () => {
    const doc = body(
      '<polygon id="p" points="0,0 10,0 10,10"/><polyline id="q" points="0,0 1,1"/>',
    );
    expect(() => deletePoint(doc, byId(doc, 'p'), 0)).toThrow(CommandError);
    expect(() => deletePoint(doc, byId(doc, 'q'), 0)).toThrow(CommandError);
  });

  it('path đa giác: chỉ số phẳng qua các đường con, ghi lệnh tuyệt đối', () => {
    const doc = body('<path id="p" d="m0 0 h10 v10 z M20 20 l5 5"/>');
    const e = editablePoints(doc, byId(doc, 'p'));
    expect(e.ok && e.points.length).toBe(5);
    applyCommand(doc, setPoint(doc, byId(doc, 'p'), 3, { x: 21, y: 22 }));
    expect(attr(doc, 'p', 'd')).toBe('M0 0 L10 0 L10 10 Z M21 22 L25 25');
  });

  it('path có đường cong: khóa sửa nút, kèm lý do', () => {
    const doc = body('<path id="p" d="M0 0 C1 1 2 2 3 3"/>');
    const e = editablePoints(doc, byId(doc, 'p'));
    expect(e.ok).toBe(false);
    expect(!e.ok && e.reason).toMatch(/cong/);
    expect(() => setPoint(doc, byId(doc, 'p'), 0, { x: 1, y: 1 })).toThrow(CommandError);
  });

  it('rect: không sửa nút', () => {
    const doc = body('<rect id="r" width="1" height="1"/>');
    expect(editablePoints(doc, byId(doc, 'r')).ok).toBe(false);
  });

  it('đóng/mở: polyline ↔ polygon (thay nút, giữ uid); path thêm/bỏ Z', () => {
    const doc = body(
      '<polyline id="p" data-mat-uid="el_pppppppppp" points="0,0 10,0 10,10"/><path id="q" d="M0 0 L5 5 L0 5"/>',
    );
    const r = setClosed(doc, byId(doc, 'p'), true);
    applyCommand(doc, r.batch);
    const n = doc.nodes.get(r.id)!;
    expect(n.tag).toBe('polygon');
    expect(n.attrs.get('data-mat-uid')).toBe('el_pppppppppp');
    applyCommand(doc, setClosed(doc, byId(doc, 'q'), true).batch);
    expect(attr(doc, 'q', 'd')).toBe('M0 0 L5 5 L0 5 Z');
    applyCommand(doc, setClosed(doc, byId(doc, 'q'), false).batch);
    expect(attr(doc, 'q', 'd')).toBe('M0 0 L5 5 L0 5');
  });

  it.each<[[number, number], number]>([
    [[5, -1], 0],
    [[11, 5], 1],
    [[4, 6], 2],
  ])('nearestSegment(%s) = %s (nhấp đúp cạnh để thêm điểm)', (p, want) => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(nearestSegment(pts, { x: p[0], y: p[1] }, true).index).toBe(want);
  });
});
