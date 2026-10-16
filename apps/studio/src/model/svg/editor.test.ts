// Bộ điều khiển của trình vẽ SVG (feature 011, T157 phần mô hình; FR-099, FR-101, FR-103, FR-104, FR-106, FR-107; contracts/
// svg-editor.md §5, §8, §9): công cụ tạo, chọn (Shift, khung, Ctrl sâu, nhấp đúp vào nhóm, Esc), tay nắm đổi cỡ và xoay, kéo
// có bắt dính, phím (bảng §9), lớp (khóa không chọn được trên canvas), inspector (nhập số, màu vào style), sửa nút (path
// đường cong bị khóa kèm lý do), nhóm, xếp lớp, sao chép uid mới, mỗi thao tác một bước hoàn tác.
import { describe, expect, it } from 'vitest';
import { findByUid, layerOf, listLayers, textOf, type NodeId } from '@mat/svg-edit';
import { SvgSession } from './session.ts';
import { SvgEditor, type EditorEnv } from './editor.ts';
import { resolveSvgKey, SVG_COMMANDS, SVG_KEYS } from './keys.ts';
import { propsOf, setProp } from './props.ts';
import type { LayerState } from '../svg-state.ts';

const HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" width="200" height="160">';

let counter = 0;
const uid = () => `el_new${++counter}`;

function open(body: string, layers: Record<string, Partial<LayerState>> = {}) {
  const r = SvgSession.fromText(
    'graphics/t.svg',
    `${HEAD}${body}</svg>`,
    { text: `${HEAD}${body}</svg>`, hash: 'h', disk: null },
    { uid },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  const env: EditorEnv = {
    layer: (name) => ({ hidden: false, locked: false, ...(layers[name ?? ''] ?? {}) }),
  };
  const ed = new SvgEditor(r.session, env);
  ed.snap = { grid: false, gridSize: 10, objects: false, points: false, angle: true };
  return { ed, s: r.session, doc: () => r.session.doc };
}

const byUid = (ed: SvgEditor, u: string): NodeId => {
  const id = findByUid(ed.doc, `el_${u}`);
  if (id === null) throw new Error(`không có ${u}`);
  return id;
};
const attr = (ed: SvgEditor, u: string, name: string) =>
  ed.doc.nodes.get(byUid(ed, u))!.attrs.get(name);
const lastTag = (ed: SvgEditor) => ed.doc.nodes.get(ed.selection[0])!.tag;
const drag = (
  ed: SvgEditor,
  a: [number, number],
  b: [number, number],
  mods = {},
  hit: NodeId | null = null,
  handle?: Parameters<SvgEditor['pointerDown']>[3],
) => {
  ed.pointerDown({ x: a[0], y: a[1] }, hit, mods, handle);
  ed.pointerMove({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }, mods);
  ed.pointerMove({ x: b[0], y: b[1] }, mods);
  return ed.pointerUp({ x: b[0], y: b[1] }, mods);
};

describe('công cụ tạo (FR-099; contract §8)', () => {
  it('Hình chữ nhật: kéo tạo rect với mặc định của contract và uid mới; Shift vuông; Alt từ tâm; một bước hoàn tác', () => {
    const { ed, s } = open('');
    ed.setTool('rect');
    expect(drag(ed, [10, 10], [50, 30])?.ok).toBe(true);
    const r = ed.doc.nodes.get(ed.selection[0])!;
    expect(r.tag).toBe('rect');
    expect([...r.attrs]).toEqual([
      ['data-mat-uid', expect.stringMatching(/^el_/)],
      ['x', '10'],
      ['y', '10'],
      ['width', '40'],
      ['height', '20'],
      ['fill', '#cfd8dc'],
      ['stroke', '#37474f'],
      ['stroke-width', '2'],
    ]);
    drag(ed, [100, 100], [130, 110], { shift: true });
    expect(ed.doc.nodes.get(ed.selection[0])!.attrs.get('width')).toBe('30');
    expect(ed.doc.nodes.get(ed.selection[0])!.attrs.get('height')).toBe('30');
    drag(ed, [100, 100], [110, 105], { alt: true });
    const c = ed.doc.nodes.get(ed.selection[0])!;
    expect([
      c.attrs.get('x'),
      c.attrs.get('y'),
      c.attrs.get('width'),
      c.attrs.get('height'),
    ]).toEqual(['90', '95', '20', '10']);
    expect(s.undo.undoSize).toBe(3);
    s.undoStep();
    expect(s.undo.undoSize).toBe(2);
  });

  it('Ellipse: kéo tạo ellipse; Shift tạo circle; nhấp không kéo không tạo gì', () => {
    const { ed } = open('');
    ed.setTool('ellipse');
    drag(ed, [0, 0], [40, 20]);
    expect(lastTag(ed)).toBe('ellipse');
    expect(ed.doc.nodes.get(ed.selection[0])!.attrs.get('rx')).toBe('20');
    drag(ed, [0, 0], [40, 20], { shift: true });
    expect(lastTag(ed)).toBe('circle');
    expect(ed.doc.nodes.get(ed.selection[0])!.attrs.get('r')).toBe('20');
    const before = ed.doc.elementCount;
    ed.pointerDown({ x: 5, y: 5 }, null);
    ed.pointerUp({ x: 5, y: 5 });
    expect(ed.doc.elementCount).toBe(before);
  });

  it('Đường thẳng: Shift khóa góc 15°; nét không tô', () => {
    const { ed } = open('');
    ed.setTool('line');
    drag(ed, [0, 0], [100, 9], { shift: true });
    const l = ed.doc.nodes.get(ed.selection[0])!;
    expect(l.tag).toBe('line');
    expect(l.attrs.get('fill')).toBe('none');
    expect(Number(l.attrs.get('y2'))).toBeCloseTo(0, 3);
    drag(ed, [0, 0], [100, 30], { shift: true });
    const l2 = ed.doc.nodes.get(ed.selection[0])!;
    const ang =
      (Math.atan2(Number(l2.attrs.get('y2')), Number(l2.attrs.get('x2'))) * 180) / Math.PI;
    expect(ang).toBeCloseTo(15, 3);
  });

  it('Đa tuyến/Đa giác: nhấp từng điểm, Enter (xong) ra polyline; nhấp lại điểm đầu ra polygon; Esc khi chưa đủ điểm hủy', () => {
    const { ed } = open('');
    ed.zoom = 1;
    ed.setTool('poly');
    for (const [x, y] of [
      [0, 0],
      [50, 0],
      [50, 50],
    ])
      ed.pointerDown({ x, y }, null);
    expect(ed.preview?.kind).toBe('poly');
    ed.finishPoly();
    expect(lastTag(ed)).toBe('polyline');
    expect(ed.doc.nodes.get(ed.selection[0])!.attrs.get('points')).toBe('0,0 50,0 50,50');
    for (const [x, y] of [
      [0, 0],
      [50, 0],
      [50, 50],
      [2, 1],
    ])
      ed.pointerDown({ x, y }, null);
    expect(lastTag(ed)).toBe('polygon');
    ed.pointerDown({ x: 9, y: 9 }, null);
    expect(ed.escape()).toBe('cancel');
    expect(ed.polyPoints).toEqual([]);
  });

  it('Văn bản: nhấp mở ô nhập; xong tạo text một dòng với phông an toàn; rỗng không tạo; sửa chữ có sẵn là SetText', () => {
    const { ed, s } = open('<text data-mat-uid="el_t11" x="10" y="20">Cũ</text>');
    ed.setTool('text');
    ed.pointerDown({ x: 30, y: 40 }, null);
    expect(ed.textTarget).toMatchObject({ mode: 'new', x: 30, y: 40 });
    ed.commitText('Trạm bơm\n1');
    const t = ed.doc.nodes.get(ed.selection[0])!;
    expect(t.tag).toBe('text');
    expect(textOf(ed.doc, t.id)).toBe('Trạm bơm 1');
    expect(t.attrs.get('font-family')).toBe('sans-serif');
    ed.pointerDown({ x: 90, y: 90 }, null);
    expect(ed.commitText('   ')).toBeNull();
    ed.pointerDown({ x: 10, y: 20 }, byUid(ed, 't11'));
    expect(ed.textTarget?.mode).toBe('edit');
    expect(ed.textTarget?.text).toBe('Cũ');
    const n = s.undo.undoSize;
    ed.commitText('Mới');
    expect(textOf(ed.doc, byUid(ed, 't11'))).toBe('Mới');
    expect(s.undo.undoSize).toBe(n + 1);
  });

  it('lớp khóa: không vẽ vào được, báo lý do; vẽ vào lớp hiện tại', () => {
    const { ed } = open('<g data-mat-layer="Bơm"/><g data-mat-layer="Nền"/>', {
      Nền: { locked: true },
    });
    ed.currentLayer = 'Nền';
    ed.setTool('rect');
    expect(drag(ed, [0, 0], [10, 10])?.ok).toBe(false);
    expect(ed.message).toMatch(/khóa/);
    ed.currentLayer = 'Bơm';
    drag(ed, [0, 0], [10, 10]);
    expect(layerOf(ed.doc, ed.selection[0])).toBe('Bơm');
  });
});

const SCENE =
  '<g data-mat-layer="Bơm"><g data-mat-uid="el_grp"><rect data-mat-uid="el_body" x="10" y="10" width="40" height="20"/>' +
  '<circle data-mat-uid="el_fan" cx="30" cy="20" r="5"/></g><rect data-mat-uid="el_pipe" x="60" y="10" width="40" height="10"/></g>' +
  '<g data-mat-layer="Nhãn"><text data-mat-uid="el_lbl" x="10" y="60">P-01</text></g>';

describe('chọn (FR-101)', () => {
  it('nhấp chọn phần tử cấp trên cùng của lớp (nhóm chứ không phải con); Ctrl+nhấp chọn sâu; Shift thêm/bớt', () => {
    const { ed } = open(SCENE);
    ed.pointerDown({ x: 30, y: 20 }, byUid(ed, 'fan'));
    ed.pointerUp({ x: 30, y: 20 });
    expect(ed.selection).toEqual([byUid(ed, 'grp')]);
    ed.pointerDown({ x: 30, y: 20 }, byUid(ed, 'fan'), { ctrl: true });
    ed.pointerUp({ x: 30, y: 20 });
    expect(ed.selection).toEqual([byUid(ed, 'fan')]);
    ed.pointerDown({ x: 70, y: 15 }, byUid(ed, 'pipe'), { shift: true });
    ed.pointerUp({ x: 70, y: 15 }, { shift: true });
    expect(ed.selection).toEqual([byUid(ed, 'fan'), byUid(ed, 'pipe')]);
    ed.pointerDown({ x: 70, y: 15 }, byUid(ed, 'pipe'), { shift: true });
    ed.pointerUp({ x: 70, y: 15 }, { shift: true });
    expect(ed.selection).toEqual([byUid(ed, 'fan')]);
  });

  it('nhấp đúp vào nhóm: vào nhóm và chọn con dưới con trỏ; Esc thoát nhóm (chọn lại nhóm), Esc nữa bỏ chọn', () => {
    const { ed } = open(SCENE);
    expect(ed.doubleClick({ x: 30, y: 20 }, byUid(ed, 'fan'))).toBe('group');
    expect(ed.scope).toBe(byUid(ed, 'grp'));
    expect(ed.selection).toEqual([byUid(ed, 'fan')]);
    expect(ed.escape()).toBe('scope');
    expect(ed.selection).toEqual([byUid(ed, 'grp')]);
    expect(ed.escape()).toBe('clear');
    expect(ed.selection).toEqual([]);
  });

  it('khung chọn lấy phần tử nằm trọn trong khung; Shift cộng thêm', () => {
    const { ed } = open(SCENE);
    drag(ed, [0, 0], [55, 35]);
    expect(ed.selection).toEqual([byUid(ed, 'grp')]);
    drag(ed, [55, 5], [105, 25], { shift: true });
    expect(new Set(ed.selection)).toEqual(new Set([byUid(ed, 'grp'), byUid(ed, 'pipe')]));
  });

  it('Tab/Shift+Tab theo thứ tự tài liệu; Ctrl+A chọn hết ở cấp hiện tại; Enter vào nhóm', () => {
    const { ed } = open(SCENE);
    ed.selectNext();
    expect(ed.selection).toEqual([byUid(ed, 'grp')]);
    ed.selectNext();
    expect(ed.selection).toEqual([byUid(ed, 'pipe')]);
    ed.selectNext();
    expect(ed.selection).toEqual([byUid(ed, 'lbl')]);
    ed.selectNext(true);
    expect(ed.selection).toEqual([byUid(ed, 'pipe')]);
    ed.selectAll();
    expect(ed.selection.length).toBe(3);
    ed.select([byUid(ed, 'grp')]);
    expect(ed.enter()).toBe('group');
    expect(ed.selection).toEqual([byUid(ed, 'body')]);
    ed.selectAll();
    expect(ed.selection).toEqual([byUid(ed, 'body'), byUid(ed, 'fan')]);
  });

  it('lớp khóa không chọn được trên canvas (nhấp, Tab, khung) nhưng chọn được qua panel Lớp; lớp ẩn cũng vậy', () => {
    const { ed } = open(SCENE, { Nhãn: { locked: true } });
    ed.pointerDown({ x: 10, y: 60 }, byUid(ed, 'lbl'));
    expect(ed.selection).toEqual([]);
    ed.selectAll();
    expect(ed.selection).not.toContain(byUid(ed, 'lbl'));
    ed.selectFromPanel(byUid(ed, 'lbl'));
    expect(ed.selection).toEqual([byUid(ed, 'lbl')]);
    const rows = ed.layerRows();
    expect(rows.map((r) => [r.name, r.state.locked, r.children.length])).toEqual([
      ['Nhãn', true, 1],
      ['Bơm', false, 2],
    ]);
  });
});

describe('kéo, tay nắm, bắt dính (FR-101, FR-103)', () => {
  it('kéo phần tử: xem trước bằng ma trận (tài liệu chưa đổi), thả thì một bước "Di chuyển" (bake vào x, y)', () => {
    const { ed, s } = open(SCENE);
    const pipe = byUid(ed, 'pipe');
    ed.pointerDown({ x: 70, y: 15 }, pipe);
    ed.pointerMove({ x: 80, y: 20 });
    expect(ed.preview).toMatchObject({ kind: 'transform', quick: false });
    expect(attr(ed, 'pipe', 'x')).toBe('60');
    ed.pointerUp({ x: 80, y: 20 });
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'y')]).toEqual(['70', '15']);
    expect(s.undo.undoLabel).toBe('Di chuyển');
  });

  it('kéo với lưới 10 bắt cạnh trái/trên vào lưới; Alt tắt tạm; Shift khóa trục', () => {
    const { ed } = open(SCENE);
    ed.snap = { grid: true, gridSize: 10, objects: false, points: false, angle: true };
    drag(ed, [70, 15], [74, 22], {}, byUid(ed, 'pipe'));
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'y')]).toEqual(['60', '20']);
    drag(ed, [70, 25], [74, 28], { alt: true }, byUid(ed, 'pipe'));
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'y')]).toEqual(['64', '23']);
    ed.snap.grid = false;
    drag(ed, [70, 25], [90, 31], { shift: true }, byUid(ed, 'pipe'));
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'y')]).toEqual(['84', '23']);
  });

  it('bắt cạnh của phần tử khác (≤ 6 px màn hình) và hiện đường gióng', () => {
    const { ed } = open(SCENE);
    ed.snap = { grid: false, gridSize: 10, objects: true, points: false, angle: true };
    ed.pointerDown({ x: 70, y: 15 }, byUid(ed, 'pipe'));
    ed.pointerMove({ x: 63, y: 15 }); // cạnh trái pipe tới 53: cách cạnh phải của nhóm (50) 3 đơn vị ⇒ bắt
    expect(ed.guides.length).toBeGreaterThan(0);
    ed.pointerUp({ x: 63, y: 15 });
    expect(attr(ed, 'pipe', 'x')).toBe('50');
  });

  it('tay nắm se: đổi cỡ từ góc đối diện; Shift giữ tỉ lệ; rect bake vào width/height', () => {
    const { ed } = open(SCENE);
    ed.select([byUid(ed, 'pipe')]);
    drag(ed, [100, 20], [120, 30], {}, null, 'se');
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'width'), attr(ed, 'pipe', 'height')]).toEqual([
      '60',
      '60',
      '20',
    ]);
    drag(ed, [120, 30], [180, 31], { shift: true }, null, 'se');
    expect([attr(ed, 'pipe', 'width'), attr(ed, 'pipe', 'height')]).toEqual(['120', '40']);
    drag(ed, [60, 15], [70, 15], {}, null, 'w');
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'width')]).toEqual(['70', '110']);
  });

  it('tay nắm xoay: Shift bắt bội 15°; rect xoay 90° bake (đổi vai rộng/cao), góc khác ghi transform', () => {
    const { ed } = open('<rect data-mat-uid="el_rrr" x="0" y="0" width="40" height="20"/>');
    ed.select([byUid(ed, 'rrr')]);
    // tâm (20,10); kéo từ trên tâm sang phải tâm: +90°
    drag(ed, [20, -30], [62, 9], { shift: true }, null, 'rot');
    expect([
      attr(ed, 'rrr', 'width'),
      attr(ed, 'rrr', 'height'),
      attr(ed, 'rrr', 'transform'),
    ]).toEqual(['20', '40', undefined]);
    drag(ed, [20, -30], [40, -24], {}, null, 'rot');
    expect(attr(ed, 'rrr', 'transform')).toMatch(/^rotate\(/);
  });

  it('kéo ≥ 200 nút: bản xem nhanh (chỉ hộp bao)', () => {
    const body = Array.from(
      { length: 210 },
      (_, i) => `<rect x="${i}" y="0" width="1" height="1"/>`,
    ).join('');
    const { ed } = open(body);
    ed.selectAll();
    ed.pointerDown({ x: 0.5, y: 0.5 }, ed.selection[0]);
    ed.pointerMove({ x: 20, y: 20 });
    expect(ed.preview).toMatchObject({ kind: 'transform', quick: true });
    ed.pointerUp({ x: 20, y: 20 });
  });
});

describe('phím (contract §9; FR-115)', () => {
  const k = (key: string, m: Partial<{ ctrl: boolean; shift: boolean; code: string }> = {}) =>
    resolveSvgKey({
      key,
      code: m.code,
      ctrlKey: !!m.ctrl,
      shiftKey: !!m.shift,
      altKey: false,
      metaKey: false,
    });

  it('bảng phím: công cụ, mũi tên 1/10/lưới, Tab, Enter, Esc, Delete, Ctrl+D/C/X/V/G/A, Ctrl+Shift+G, [ ] Ctrl+[ ], +/-/0, Space, F2', () => {
    expect(['v', 'n', 'r', 'e', 'l', 'p', 't', 'h'].map((x) => k(x))).toEqual(
      [
        'svg.toolSelect',
        'svg.toolNode',
        'svg.toolRect',
        'svg.toolEllipse',
        'svg.toolLine',
        'svg.toolPoly',
        'svg.toolText',
        'svg.toolHand',
      ].map((id) => ({ kind: 'command', id })),
    );
    expect(k('ArrowLeft')).toEqual({ kind: 'nudge', dx: -1, dy: 0, grid: false });
    expect(k('ArrowDown', { shift: true })).toEqual({ kind: 'nudge', dx: 0, dy: 10, grid: false });
    expect(k('ArrowUp', { ctrl: true })).toEqual({ kind: 'nudge', dx: 0, dy: -1, grid: true });
    expect(k('Tab', { shift: true })).toEqual({ kind: 'tab', reverse: true });
    expect(k('Enter')).toEqual({ kind: 'enter' });
    expect(k('Escape')).toEqual({ kind: 'escape' });
    expect(k('Delete')).toEqual({ kind: 'command', id: 'svg.delete' });
    for (const [key, id] of [
      ['d', 'svg.duplicate'],
      ['c', 'svg.copy'],
      ['x', 'svg.cut'],
      ['v', 'svg.paste'],
      ['g', 'svg.group'],
      ['a', 'svg.selectAll'],
    ])
      expect(k(key, { ctrl: true })).toEqual({ kind: 'command', id });
    expect(k('G', { ctrl: true, shift: true })).toEqual({ kind: 'command', id: 'svg.ungroup' });
    expect(k(']', { code: 'BracketRight' })).toEqual({ kind: 'command', id: 'svg.forward' });
    expect(k('[', { code: 'BracketLeft' })).toEqual({ kind: 'command', id: 'svg.backward' });
    expect(k(']', { ctrl: true, code: 'BracketRight' })).toEqual({
      kind: 'command',
      id: 'svg.toFront',
    });
    expect(k('[', { ctrl: true, code: 'BracketLeft' })).toEqual({
      kind: 'command',
      id: 'svg.toBack',
    });
    expect(k('+')).toEqual({ kind: 'command', id: 'svg.zoomIn' });
    expect(k('-')).toEqual({ kind: 'command', id: 'svg.zoomOut' });
    expect(k('0')).toEqual({ kind: 'command', id: 'svg.zoomFit' });
    expect(k(' ')).toEqual({ kind: 'pan' });
    expect(k('F2')).toEqual({ kind: 'command', id: 'svg.rename' });
    // phím toàn cục nổi lên
    expect(k('s', { ctrl: true })).toBeNull();
    expect(k('z', { ctrl: true })).toBeNull();
    expect(k('y', { ctrl: true })).toBeNull();
  });

  it('mọi lệnh có trong danh sách của bảng lệnh; phím hiển thị không trùng nhau', () => {
    const keys = Object.values(SVG_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of Object.keys(SVG_KEYS)) expect(SVG_COMMANDS).toContain(id);
  });

  it('mũi tên giữ là một bước hoàn tác (gộp tới khi nhả phím)', () => {
    const { ed, s } = open(SCENE);
    ed.select([byUid(ed, 'pipe')]);
    for (let i = 0; i < 5; i++) ed.nudge(1, 0);
    ed.endNudge();
    ed.nudge(0, 10);
    ed.endNudge();
    expect(attr(ed, 'pipe', 'x')).toBe('65');
    expect(attr(ed, 'pipe', 'y')).toBe('20');
    expect(s.undo.undoSize).toBe(2);
    s.undoStep();
    s.undoStep();
    expect(attr(ed, 'pipe', 'x')).toBe('60');
  });
});

describe('nhóm, xếp lớp, sao chép, xóa (FR-102, FR-104, FR-109, FR-110)', () => {
  it('Ctrl+G nhóm (uid mới), Ctrl+Shift+G bỏ nhóm giữ uid con', () => {
    const { ed } = open(SCENE);
    ed.select([byUid(ed, 'pipe'), byUid(ed, 'grp')]);
    expect(ed.group()?.ok).toBe(true);
    const g = ed.selection[0];
    expect(ed.doc.nodes.get(g)!.tag).toBe('g');
    expect(ed.doc.nodes.get(g)!.attrs.get('data-mat-uid')).toMatch(/^el_/);
    ed.ungroup();
    expect(new Set(ed.selection)).toEqual(new Set([byUid(ed, 'pipe'), byUid(ed, 'grp')]));
  });

  it('xóa trả uid của cả cây con (để cảnh báo binding) và chỉ áp khi gọi applyDelete', () => {
    const { ed } = open(SCENE);
    ed.select([byUid(ed, 'grp')]);
    const plan = ed.planDelete()!;
    expect(new Set(plan.uids)).toEqual(new Set(['el_grp', 'el_body', 'el_fan']));
    expect(findByUid(ed.doc, 'el_grp')).not.toBeNull();
    ed.applyDelete(plan.batch);
    expect(findByUid(ed.doc, 'el_grp')).toBeNull();
  });

  it('Ctrl+D nhân bản lệch 20 với uid mới; sao chép rồi dán sang tài liệu khác giữ hình, uid mới', () => {
    const { ed } = open(SCENE);
    ed.select([byUid(ed, 'pipe')]);
    ed.duplicate();
    const copy = ed.doc.nodes.get(ed.selection[0])!;
    expect([copy.attrs.get('x'), copy.attrs.get('y')]).toEqual(['80', '30']);
    expect(copy.attrs.get('data-mat-uid')).not.toBe('el_pipe');
    ed.select([byUid(ed, 'pipe')]);
    const clip = ed.copy()!;
    const other = open('');
    other.ed.paste(clip, 0);
    const pasted = other.ed.doc.nodes.get(other.ed.selection[0])!;
    expect(pasted.attrs.get('x')).toBe('60');
    expect(pasted.attrs.get('data-mat-uid')).not.toBe('el_pipe');
  });

  it('dán SVG dạng chữ: phần tử độc bị loại kèm báo cáo, phần còn lại dán vào một bước', () => {
    const { ed, s } = open('');
    const r = ed.pasteText(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5" onclick="x()"/></svg>',
    );
    expect(r?.ok).toBe(true);
    if (r?.ok)
      expect(r.report.removedElements + r.report.removedAttributes).toBeGreaterThanOrEqual(2);
    expect(ed.doc.nodes.get(ed.selection[0])!.tag).toBe('rect');
    expect(s.undo.undoSize).toBe(1);
  });

  it('] [ Ctrl+] Ctrl+[ đổi thứ tự trong cùng cha; căn trái 2 phần tử; phân bố cần ≥ 3', () => {
    const { ed } = open(SCENE);
    const kids = () => ed.layerRows().find((r) => r.name === 'Bơm')!.children;
    ed.select([byUid(ed, 'grp')]);
    ed.order('front');
    expect(kids()[0]).toBe(byUid(ed, 'grp'));
    ed.order('backward');
    expect(kids()[1]).toBe(byUid(ed, 'grp'));
    ed.select([byUid(ed, 'pipe'), byUid(ed, 'lbl')]);
    ed.align('left');
    expect(attr(ed, 'pipe', 'x')).toBe('10');
    expect(ed.distribute('h')).toBeNull();
    expect(ed.message).toMatch(/3/);
  });
});

describe('lớp (FR-105)', () => {
  it('thêm lớp (tên kế tiếp), đổi tên, chuyển phần tử sang lớp, đổi thứ tự, xóa lớp chuyển nội dung về lớp mặc định', () => {
    const { ed } = open(SCENE);
    ed.addLayer();
    expect(listLayers(ed.doc).map((l) => l.name)).toEqual(['Bơm', 'Nhãn', 'Lớp 1']);
    expect(ed.renameLayer('Lớp 1', 'Van').ok).toBe(true);
    expect(ed.renameLayer('Van', 'Bơm').ok).toBe(false);
    ed.select([byUid(ed, 'pipe')]);
    ed.moveSelectionToLayer('Van');
    expect(layerOf(ed.doc, byUid(ed, 'pipe'))).toBe('Van');
    ed.moveLayer('Van', -2);
    expect(listLayers(ed.doc).map((l) => l.name)).toEqual(['Van', 'Bơm', 'Nhãn']);
    const plan = ed.planDeleteLayer('Van', 'move');
    if (typeof plan === 'string') throw new Error(plan);
    ed.applyDelete(plan.batch);
    expect(listLayers(ed.doc).map((l) => l.name)).toEqual(['Bơm', 'Nhãn']);
    expect(layerOf(ed.doc, byUid(ed, 'pipe'))).toBeNull();
  });
});

describe('inspector (FR-106)', () => {
  it('Hình học: X, Y, Rộng, Cao (khóa tỉ lệ), bo góc; số sai báo lý do và không đổi gì', () => {
    const { ed, s } = open(SCENE);
    ed.select([byUid(ed, 'pipe')]);
    expect(propsOf(ed).box).toEqual({ x: 60, y: 10, width: 40, height: 10 });
    setProp(ed, 'x', '70');
    setProp(ed, 'y', '5');
    expect([attr(ed, 'pipe', 'x'), attr(ed, 'pipe', 'y')]).toEqual(['70', '5']);
    setProp(ed, 'w', '80', { lockRatio: true });
    expect([attr(ed, 'pipe', 'width'), attr(ed, 'pipe', 'height')]).toEqual(['80', '20']);
    setProp(ed, 'rx', '3');
    expect(attr(ed, 'pipe', 'rx')).toBe('3');
    const n = s.undo.undoSize;
    expect(setProp(ed, 'w', 'abc')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/số/),
    });
    expect(setProp(ed, 'w', '-1')).toMatchObject({ ok: false });
    expect(s.undo.undoSize).toBe(n);
  });

  it('Hiển thị: màu ghi vào style khi phần tử khai màu trong style; kéo thanh màu gộp một bước; độ mờ 0–1', () => {
    const { ed, s } = open(
      '<rect data-mat-uid="el_aaa" width="5" height="5" style="fill:#ff0000;stroke:#000"/><rect data-mat-uid="el_bbb" width="5" height="5" fill="red"/>',
    );
    ed.select([byUid(ed, 'aaa'), byUid(ed, 'bbb')]);
    expect(propsOf(ed).fill).toBe('#ff0000');
    for (const c of ['#00ff00', '#00ee00', '#00dd00'])
      setProp(ed, 'fill', c, { mergeKey: 'color:fill' });
    ed.session.endGesture();
    expect(attr(ed, 'aaa', 'style')).toBe('fill:#00dd00;stroke:#000');
    expect(attr(ed, 'bbb', 'fill')).toBe('#00dd00');
    expect(s.undo.undoSize).toBe(1);
    expect(setProp(ed, 'opacity', '1.5')).toMatchObject({ ok: false });
    setProp(ed, 'stroke-dasharray', '4 2');
    expect(attr(ed, 'bbb', 'stroke-dasharray')).toBe('4 2');
  });

  it('Văn bản: nội dung, phông (cảnh báo W_SVG_FONT khi ngoài danh sách an toàn), in đậm, canh giữa', () => {
    const { ed } = open('<text data-mat-uid="el_ttt" x="1" y="10" font-family="Tahoma">A</text>');
    ed.select([byUid(ed, 'ttt')]);
    expect(propsOf(ed).text).toMatchObject({ content: 'A', family: 'Tahoma', fontWarning: true });
    setProp(ed, 'text', 'Bơm 1');
    setProp(ed, 'font-family', 'Arial');
    setProp(ed, 'font-weight', 'bold');
    setProp(ed, 'text-anchor', 'middle');
    expect(propsOf(ed).text).toMatchObject({
      content: 'Bơm 1',
      family: 'Arial',
      fontWarning: false,
      bold: true,
      anchor: 'middle',
    });
  });

  it('Chung: id kiểm cú pháp và trùng; tên hiển thị là data-mat-name', () => {
    const { ed } = open(
      '<rect data-mat-uid="el_aaa" id="x1" width="5" height="5"/><rect data-mat-uid="el_bbb" width="5" height="5"/>',
    );
    ed.select([byUid(ed, 'bbb')]);
    expect(setProp(ed, 'id', '1abc')).toMatchObject({ ok: false });
    expect(setProp(ed, 'id', 'x1').ok).toBe(false);
    setProp(ed, 'name', 'Thân bơm');
    expect(attr(ed, 'bbb', 'data-mat-name')).toBe('Thân bơm');
    expect(ed.label(byUid(ed, 'bbb'))).toBe('Thân bơm');
  });
});

describe('sửa nút (FR-107)', () => {
  it('path có đường cong: khóa sửa nút kèm lý do; path M L Z kéo được nút, nhấp đúp cạnh thêm nút, Delete xóa nút', () => {
    const { ed, s } = open(
      '<path data-mat-uid="el_ccc" d="M0 0 C10 10 20 10 30 0"/><path data-mat-uid="el_ppp" d="M0 0 L40 0 L40 40 Z"/>',
    );
    ed.setTool('node');
    ed.select([byUid(ed, 'ccc')]);
    expect(ed.points()).toBeNull();
    expect(ed.nodeLockReason()).toMatch(/cong/);
    expect(propsOf(ed).notes).toContain('curves');
    ed.select([byUid(ed, 'ppp')]);
    expect(ed.points()).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ]);
    const n = s.undo.undoSize;
    ed.pointerDown({ x: 40, y: 40 }, null, {}, { point: 2 });
    ed.pointerMove({ x: 45, y: 40 });
    ed.pointerMove({ x: 50, y: 45 });
    ed.pointerUp({ x: 50, y: 45 });
    expect(attr(ed, 'ppp', 'd')).toBe('M0 0 L40 0 L50 45 Z');
    expect(s.undo.undoSize).toBe(n + 1);
    expect(ed.doubleClick({ x: 20, y: 0.5 }, null)).toBe('point');
    expect(ed.points()!.length).toBe(4);
    ed.activePoint = 1;
    ed.deleteActivePoint();
    expect(ed.points()!.length).toBe(3);
  });
});
