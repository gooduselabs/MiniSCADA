// T153 (SC-032; FR-098, FR-110): từng lệnh và lệnh đảo, Batch, gộp mergeKey, độ sâu 100, làm lại bị xóa khi có thao
// tác mới, từ chối khi vượt giới hạn/allowlist, property test 1.000 chuỗi lệnh (hạt cố định), xóa phần tử có binding
// kèm lô khôi phục binding.
import { describe, expect, it } from 'vitest';
import { makeSeededUid } from '@mat/svg-import';
import { buildSubtree } from './build.ts';
import {
  Batch,
  CommandError,
  ExternalCommand,
  InsertNode,
  MoveNode,
  RemoveNode,
  SetAttr,
  SetText,
  applyCommand,
  type Command,
} from './command.ts';
import { SVG_UNDO_DEPTH } from './limits.ts';
import { documentOrder, findById, textOf, type DrawDoc, type NodeId } from './node.ts';
import { parseDrawDoc } from './parse.ts';
import { canonical } from './serialize.ts';
import { UndoStack } from './undo.ts';
import { randomCommand, rng } from './test-helpers.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const BASE =
  `<svg ${NS} viewBox="0 0 200 100">\n` +
  `  <defs><linearGradient id="lg"><stop offset="0" stop-color="#fff"/></linearGradient></defs>\n` +
  `  <g id="g1" data-mat-uid="el_g1aaaaaaaa">\n` +
  `    <rect id="r1" data-mat-uid="el_r1aaaaaaaa" x="10" y="10" width="20" height="20" fill="url(#lg)"/>\n` +
  `    <circle id="c1" data-mat-uid="el_c1aaaaaaaa" cx="50" cy="50" r="5"/>\n` +
  `  </g>\n` +
  `  <text id="t1" data-mat-uid="el_t1aaaaaaaa" x="5" y="90">Bơm 1</text>\n` +
  `  <polyline id="p1" points="0,0 10,10 20,0" fill="none" stroke="#000"/>\n` +
  `</svg>\n`;

function open(text = BASE): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(7) });
  if (!r.ok) throw new Error(r.message);
  return r.doc;
}
const byId = (doc: DrawDoc, id: string): NodeId => findById(doc, id)!;

describe('lệnh nguyên tử và lệnh đảo', () => {
  it('SetAttr: đặt, thêm, xóa; đảo khôi phục giá trị, vị trí và nguyên văn', () => {
    const doc = open();
    const before = canonical(doc);
    const r1 = byId(doc, 'r1');
    for (const cmd of [
      new SetAttr(r1, 'x', '15'),
      new SetAttr(r1, 'stroke', '#000'),
      new SetAttr(r1, 'fill', null),
      new SetAttr(r1, 'transform', 'rotate(10 20 20)'),
    ]) {
      const inv = applyCommand(doc, cmd);
      expect(canonical(doc)).not.toBe(before);
      applyCommand(doc, inv);
      expect(canonical(doc)).toBe(before);
    }
  });

  it('SetText: đổi, xóa hết, đặt lại; đảo khôi phục', () => {
    const doc = open();
    const t = byId(doc, 't1');
    const before = canonical(doc);
    const i1 = applyCommand(doc, new SetText(t, 'Bơm 2'));
    expect(textOf(doc, t)).toBe('Bơm 2');
    const i2 = applyCommand(doc, new SetText(t, ''));
    expect(textOf(doc, t)).toBe('');
    const i3 = applyCommand(doc, new SetText(t, 'X'));
    expect(textOf(doc, t)).toBe('X');
    applyCommand(doc, i3);
    applyCommand(doc, i2);
    applyCommand(doc, i1);
    expect(canonical(doc)).toBe(before);
  });

  it('InsertNode và RemoveNode đảo nhau; RemoveNode giữ cả cây con (cùng mã nút)', () => {
    const doc = open();
    const before = canonical(doc);
    const g = byId(doc, 'g1');
    const ids = documentOrder(doc, g);
    const inv = applyCommand(doc, new RemoveNode(g));
    expect(findById(doc, 'r1')).toBeNull();
    applyCommand(doc, inv);
    expect(canonical(doc)).toBe(before);
    expect(documentOrder(doc, g)).toEqual(ids);

    const sub = buildSubtree(doc, {
      tag: 'rect',
      attrs: [
        ['width', '3'],
        ['height', '3'],
      ],
    });
    const inv2 = applyCommand(doc, new InsertNode(doc.root, 1, sub));
    expect(doc.nodes.has(sub.root)).toBe(true);
    applyCommand(doc, inv2);
    expect(canonical(doc)).toBe(before);
  });

  it('MoveNode: đổi cha và thứ tự; đảo về chỗ cũ', () => {
    const doc = open();
    const before = canonical(doc);
    const inv = applyCommand(doc, new MoveNode(byId(doc, 'c1'), doc.root, 0));
    expect(doc.nodes.get(byId(doc, 'c1'))!.parent).toBe(doc.root);
    applyCommand(doc, inv);
    expect(canonical(doc)).toBe(before);
  });

  it('Batch: một bước; lỗi giữa lô cuộn lại hết', () => {
    const doc = open();
    const before = canonical(doc);
    const v = doc.version;
    expect(() =>
      applyCommand(
        doc,
        new Batch([
          new SetAttr(byId(doc, 'r1'), 'x', '99'),
          new SetAttr(byId(doc, 'c1'), 'onclick', 'x()'),
        ]),
      ),
    ).toThrow(CommandError);
    expect(canonical(doc)).toBe(before);
    expect(doc.version).toBe(v);
  });
});

describe('từ chối khi vượt allowlist hoặc giới hạn: tài liệu không đổi', () => {
  const cases: Array<[string, (d: DrawDoc) => Command, string]> = [
    ['on*', (d) => new SetAttr(byId(d, 'r1'), 'onclick', 'alert(1)'), 'SVG_UNSAFE'],
    ['href ngoài', (d) => new SetAttr(byId(d, 'r1'), 'fill', 'url(http://evil/x)'), 'SVG_UNSAFE'],
    [
      'javascript:',
      (d) =>
        new InsertNode(
          d.root,
          0,
          buildSubtree(d, { tag: 'use', attrs: [['href', 'javascript:alert(1)']] }),
        ),
      'SVG_UNSAFE',
    ],
    [
      'script',
      (d) => new InsertNode(d.root, 0, buildSubtree(d, { tag: 'script', text: 'alert(1)' })),
      'SVG_UNSAFE',
    ],
    [
      'foreignObject',
      (d) => new InsertNode(d.root, 0, buildSubtree(d, { tag: 'foreignObject' })),
      'SVG_UNSAFE',
    ],
    [
      'style có url ngoài',
      (d) => new SetAttr(byId(d, 'r1'), 'style', 'fill:url(http://evil/x)'),
      'SVG_UNSAFE',
    ],
    ['data-* lạ', (d) => new SetAttr(byId(d, 'r1'), 'data-x', '1'), 'SVG_UNSAFE'],
    [
      'uid trùng',
      (d) => new SetAttr(byId(d, 'c1'), 'data-mat-uid', 'el_r1aaaaaaaa'),
      'SVG_INVALID',
    ],
    [
      'id trùng khi chèn',
      (d) => new InsertNode(d.root, 0, buildSubtree(d, { tag: 'rect', attrs: [['id', 'r1']] })),
      'SVG_INVALID',
    ],
    [
      'độ sâu 33',
      (d) => {
        let spec: { tag: string; children?: unknown[] } = { tag: 'g' };
        for (let i = 0; i < 31; i++) spec = { tag: 'g', children: [spec] };
        return new InsertNode(d.root, 0, buildSubtree(d, spec as never));
      },
      'SVG_LIMIT',
    ],
    [
      '20.001 phần tử',
      (d) =>
        new InsertNode(
          d.root,
          0,
          buildSubtree(d, {
            tag: 'g',
            children: Array.from({ length: 20_000 }, () => ({ tag: 'rect' })),
          }),
        ),
      'SVG_LIMIT',
    ],
    [
      'bom use',
      (d) => {
        // 6 tầng x 10 use: 10^6 phần tử hiệu dụng
        const levels = [];
        for (let k = 0; k < 6; k++)
          levels.push({
            tag: 'g',
            attrs: [['id', `L${k}`]] as Array<[string, string]>,
            children: Array.from({ length: 10 }, () => ({
              tag: 'use',
              attrs: [['href', k === 0 ? '#r1' : `#L${k - 1}`]] as Array<[string, string]>,
            })),
          });
        return new InsertNode(d.root, 0, buildSubtree(d, { tag: 'defs', children: levels }));
      },
      'SVG_LIMIT',
    ],
    [
      'chuyển nút vào chính nó',
      (d) => new MoveNode(byId(d, 'g1'), byId(d, 'r1'), 0),
      'SVG_INVALID',
    ],
    ['xóa gốc', (d) => new RemoveNode(d.root), 'SVG_INVALID'],
  ];
  it.each(cases)('%s', (_l, mk, code) => {
    const doc = open();
    const before = canonical(doc);
    const stack = new UndoStack(doc);
    let err: unknown = null;
    try {
      stack.push(mk(doc));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).code).toBe(code);
    expect(canonical(doc)).toBe(before);
    expect(stack.canUndo).toBe(false);
  });

  it('style có @import: phần không phải khai báo bị bỏ, chỉ lưu khai báo hợp lệ', () => {
    const doc = open();
    applyCommand(doc, new SetAttr(byId(doc, 'r1'), 'style', '@import url(x.css); fill:red'));
    expect(doc.nodes.get(byId(doc, 'r1'))!.attrs.get('style')).toBe('fill:red');
  });

  it('phần tử trong mask là khối giữ nguyên: SVG_LOCKED', () => {
    const doc = open(
      `<svg ${NS}><defs><mask id="m"><rect id="mr" width="1" height="1"/></mask></defs></svg>`,
    );
    expect(() => applyCommand(doc, new SetAttr(byId(doc, 'mr'), 'x', '1'))).toThrow(
      /khối giữ nguyên/,
    );
  });
});

describe('UndoStack', () => {
  it('hoàn tác, làm lại; version tăng mỗi lô, hoàn tác và làm lại', () => {
    const doc = open();
    const s = new UndoStack(doc);
    const v0 = doc.version;
    const b0 = canonical(doc);
    s.push(
      new Batch([new SetAttr(byId(doc, 'r1'), 'x', '1'), new SetAttr(byId(doc, 'c1'), 'r', '9')]),
    );
    const b1 = canonical(doc);
    expect(doc.version).toBe(v0 + 1);
    expect(s.undo()).toEqual(expect.arrayContaining([byId(doc, 'r1'), byId(doc, 'c1')]));
    expect(canonical(doc)).toBe(b0);
    expect(doc.version).toBe(v0 + 2);
    s.redo();
    expect(canonical(doc)).toBe(b1);
    expect(doc.version).toBe(v0 + 3);
  });

  it('thao tác mới sau hoàn tác xóa phần làm lại', () => {
    const doc = open();
    const s = new UndoStack(doc);
    s.push(new SetAttr(byId(doc, 'r1'), 'x', '1'));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.push(new SetAttr(byId(doc, 'r1'), 'y', '1'));
    expect(s.canRedo).toBe(false);
  });

  it(`độ sâu ${SVG_UNDO_DEPTH}: bước 101 đẩy bước cũ nhất`, () => {
    const doc = open();
    const s = new UndoStack(doc);
    const r1 = byId(doc, 'r1');
    for (let i = 1; i <= 101; i++) s.push(new SetAttr(r1, 'x', String(i)));
    expect(s.undoSize).toBe(100);
    while (s.canUndo) s.undo();
    expect(doc.nodes.get(r1)!.attrs.get('x')).toBe('1');
  });

  it('gộp theo mergeKey trong một cử chỉ (kéo): một bước; endGesture tách', () => {
    const doc = open();
    const s = new UndoStack(doc);
    const b0 = canonical(doc);
    const r1 = byId(doc, 'r1');
    for (let i = 0; i < 50; i++)
      s.push(new Batch([new SetAttr(r1, 'x', String(10 + i))], { mergeKey: 'move' }));
    expect(s.undoSize).toBe(1);
    s.endGesture();
    s.push(new Batch([new SetAttr(r1, 'x', '1')], { mergeKey: 'move' }));
    expect(s.undoSize).toBe(2);
    s.undo();
    s.undo();
    expect(canonical(doc)).toBe(b0);
  });

  it('gộp chỉ khi cùng đích', () => {
    const doc = open();
    const s = new UndoStack(doc);
    s.push(new Batch([new SetAttr(byId(doc, 'r1'), 'x', '1')], { mergeKey: 'move' }));
    s.push(new Batch([new SetAttr(byId(doc, 'c1'), 'cx', '1')], { mergeKey: 'move' }));
    expect(s.undoSize).toBe(2);
  });

  it('gõ chữ gộp theo 1,5 s không gõ', () => {
    const doc = open();
    const s = new UndoStack(doc);
    const t = byId(doc, 't1');
    const type = (txt: string, time: number) =>
      s.push(new Batch([new SetText(t, txt)], { mergeKey: 'text' }), { time });
    type('B', 0);
    type('Bơ', 400);
    type('Bơm', 1800);
    type('Bơm 3', 3400); // cách 1.600 ms: bước mới
    expect(s.undoSize).toBe(2);
    s.undo();
    expect(textOf(doc, t)).toBe('Bơm');
    s.undo();
    expect(textOf(doc, t)).toBe('Bơm 1');
  });

  it('xóa phần tử có binding đi kèm lô khôi phục binding (FR-110)', () => {
    const doc = open();
    const bindings = new Map([['el_r1aaaaaaaa', { target: 'fill', tag: 'PUMP01.RUN' }]]);
    const s = new UndoStack(doc);
    const saved = bindings.get('el_r1aaaaaaaa')!;
    s.push(
      new Batch([
        new RemoveNode(byId(doc, 'r1')),
        new ExternalCommand(
          'binding.remove',
          () => bindings.delete('el_r1aaaaaaaa'),
          () => bindings.set('el_r1aaaaaaaa', saved),
        ),
      ]),
    );
    expect(bindings.size).toBe(0);
    expect(findById(doc, 'r1')).toBeNull();
    s.undo();
    expect(bindings.get('el_r1aaaaaaaa')).toBe(saved);
    expect(findById(doc, 'r1')).not.toBeNull();
    s.redo();
    expect(bindings.size).toBe(0);
  });

  it('ngân sách nút của cây con đã xóa: vượt thì bỏ bước cũ nhất và ghi "đã giảm độ sâu"', () => {
    const doc = open();
    const s = new UndoStack(doc, { nodeBudget: 10 });
    for (let i = 0; i < 4; i++) {
      const sub = buildSubtree(doc, {
        tag: 'g',
        children: [{ tag: 'rect' }, { tag: 'rect' }, { tag: 'rect' }],
      });
      s.push(new InsertNode(doc.root, 0, sub));
      s.push(new RemoveNode(sub.root));
    }
    expect(s.reduced).toBe(true);
    expect(s.retainedNodes).toBeLessThanOrEqual(10);
  });
});

// --- property test ------------------------------------------------------------------------------

describe('property test: 1.000 chuỗi lệnh (hạt cố định)', () => {
  it('hoàn tác hết ⇒ canonical bằng ban đầu; làm lại hết ⇒ bằng cuối', () => {
    let applied = 0;
    let rejected = 0;
    for (let seq = 0; seq < 1000; seq++) {
      const r = rng(1000 + seq);
      const doc = open();
      const s = new UndoStack(doc);
      const start = canonical(doc);
      const n = 1 + Math.floor(r() * 100);
      for (let i = 0; i < n; i++) {
        try {
          s.push(randomCommand(doc, r));
          applied++;
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          rejected++;
        }
      }
      const end = canonical(doc);
      while (s.canUndo) s.undo();
      expect(canonical(doc), `chuỗi ${seq}`).toBe(start);
      while (s.canRedo) s.redo();
      expect(canonical(doc), `chuỗi ${seq}`).toBe(end);
    }
    expect(applied).toBeGreaterThan(10_000);
    expect(rejected).toBeGreaterThan(0);
  }, 120_000);
});
