// Binding và sự kiện của item svg (feature 008, T064 và phần model của T081).
import { describe, expect, it } from 'vitest';
import type { BindingSet04, ElementAction } from '@mat/project-schema';
import { createHistory, HISTORY_LIMIT, recordEdit, undoEdit } from '../app/history.ts';
import { newBinding } from './animation-catalog.ts';
import {
  addBinding,
  applyToMany,
  checkEvent,
  clearEvent,
  copyBindings,
  emptyBindingSet,
  eventMinRole,
  removeBinding,
  renameTagInSet,
  setEvent,
  setEventMinRole,
  updateBinding,
  type BindCtx,
  type EventCtx,
} from './svg-binding-doc.ts';
import {
  applyDocEdits,
  loadDoc,
  restoreSnapshot,
  snapshotOf,
  withEditable,
  writtenText,
  isDirty,
  type ProjectDocs,
} from './project-doc.ts';
import type { TagInfo } from './screen-catalog.ts';

const tag = (id: string, type: string, extra: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type,
  access: 'R',
  kind: 'simulation',
  ...extra,
});
const LEVEL = tag('TANK.LEVEL', 'FLOAT32', { unit: '%', min: 0, max: 100 });
const RUN = tag('PUMP.RUN', 'BOOL');
const CMD = tag('PUMP.CMD', 'BOOL', { access: 'RW', kind: 'external' });
const ctx = (elementKind: BindCtx['elementKind'], t: TagInfo | undefined): BindCtx => ({
  elementKind,
  tag: t,
});
const set0 = (): BindingSet04 => emptyBindingSet('bon', 'svg_bon');
const fill = (t = RUN) => newBinding('fill', 'rect', t)!;
const text = (t = LEVEL) => newBinding('text', 'text', t)!;

describe('addBinding', () => {
  it('thêm, sinh id theo mục, không sửa đầu vào', () => {
    const base = Object.freeze(set0());
    const r = addBinding(base, 'el_a', fill(), ctx('rect', RUN));
    expect(r.rejected).toBeUndefined();
    expect(r.id).toBe('fill');
    expect(r.set.elements).toEqual([
      {
        elementUid: 'el_a',
        bindings: [expect.objectContaining({ id: 'fill', target: 'style.fill' })],
      },
    ]);
    expect(base.elements).toEqual([]);
  });

  it('id trùng trong file thì sinh id khác', () => {
    let s = addBinding(set0(), 'el_a', fill(), ctx('rect', RUN)).set;
    const r = addBinding(s, 'el_b', fill(), ctx('rect', RUN));
    expect(r.id).toBe('fill_2');
    s = r.set;
    expect(s.elements).toHaveLength(2);
  });

  it('từ chối Tag sai kiểu kèm lý do, trả đúng set cũ', () => {
    const s = set0();
    const lv = newBinding('level', 'rect', LEVEL)!;
    const r = addBinding(s, 'el_a', lv, ctx('rect', RUN));
    expect(r.rejected).toBe('tag-type');
    expect(r.set).toBe(s);
    expect(addBinding(s, 'el_a', lv, ctx('rect', undefined)).rejected).toBe('unknown-tag');
    expect(addBinding(s, 'el_a', lv, ctx('text', LEVEL)).rejected).toBe('element-kind');
    const lin = { ...lv, transform: { kind: 'valueTable', output: 'color' } as const };
    expect(addBinding(s, 'el_a', lin, ctx('rect', LEVEL)).rejected).toBe('transform');
  });

  it('hai binding cùng nhóm đích bị từ chối (level: levelPercent và clipLevel cùng nhóm)', () => {
    const s = addBinding(
      set0(),
      'el_a',
      newBinding('level', 'rect', LEVEL)!,
      ctx('rect', LEVEL),
    ).set;
    const clip = { ...newBinding('level', 'group', LEVEL)!, id: 'other' };
    const r = addBinding(s, 'el_a', clip, ctx('group', LEVEL));
    expect(r.rejected).toBe('duplicate-group');
    expect(r.set).toBe(s);
    // spin và rotate cùng nhóm quay
    const rot = addBinding(
      set0(),
      'el_a',
      newBinding('rotate', 'group', LEVEL)!,
      ctx('group', LEVEL),
    ).set;
    expect(
      addBinding(rot, 'el_a', newBinding('spin', 'group', LEVEL)!, ctx('group', LEVEL)).rejected,
    ).toBe('duplicate-group');
  });

  it('tối đa 16 binding mỗi phần tử', () => {
    let s = set0();
    const rows = [
      'text',
      'fill',
      'stroke',
      'level',
      'rotate',
      'translateX',
      'translateY',
      'scale',
      'blink',
      'flow',
      'visibility',
      'opacity',
    ] as const;
    expect(rows.length).toBe(12);
    for (const row of rows) {
      const b = newBinding(
        row,
        'rect',
        row === 'blink' || row === 'flow' || row === 'visibility' ? RUN : LEVEL,
      );
      if (b === null) continue;
      s = addBinding(
        s,
        'el_a',
        b,
        ctx('rect', row === 'blink' || row === 'flow' || row === 'visibility' ? RUN : LEVEL),
      ).set;
    }
    expect(s.elements[0]!.bindings!.length).toBeLessThanOrEqual(16);
  });
});

describe('updateBinding và removeBinding', () => {
  const base = addBinding(set0(), 'el_a', text(), ctx('text', LEVEL)).set;

  it('sửa tham số, bỏ khóa bằng undefined', () => {
    const r = updateBinding(base, 'el_a', 'text', { format: { decimals: 3 } }, ctx('text', LEVEL));
    expect(r.set.elements[0]!.bindings![0]!.format).toEqual({ decimals: 3 });
    const r2 = updateBinding(r.set, 'el_a', 'text', { format: undefined }, ctx('text', LEVEL));
    expect('format' in r2.set.elements[0]!.bindings![0]!).toBe(false);
  });

  it('không đổi gì thì trả đúng set; Tag đổi sang kiểu sai bị từ chối', () => {
    expect(updateBinding(base, 'el_a', 'text', {}, ctx('text', LEVEL)).set).toBe(base);
    const lv = addBinding(
      set0(),
      'el_a',
      newBinding('level', 'rect', LEVEL)!,
      ctx('rect', LEVEL),
    ).set;
    const r = updateBinding(
      lv,
      'el_a',
      'level',
      { source: { type: 'tag', tagId: 'PUMP.RUN' } },
      ctx('rect', RUN),
    );
    expect(r.rejected).toBe('tag-type');
    expect(updateBinding(base, 'el_x', 'text', {}, ctx('text', LEVEL)).rejected).toBe(
      'unknown-element',
    );
    expect(updateBinding(base, 'el_a', 'zz', {}, ctx('text', LEVEL)).rejected).toBe(
      'unknown-binding',
    );
  });

  it('xóa binding cuối thì phần tử biến mất; còn sự kiện thì phần tử ở lại', () => {
    expect(removeBinding(base, 'el_a', 'text').set.elements).toEqual([]);
    const ev: ElementAction = { action: 'closePopup' };
    const withEv = setEvent(base, 'el_a', ev, { screens: [] }).set;
    const r = removeBinding(withEv, 'el_a', 'text');
    expect(r.set.elements).toEqual([{ elementUid: 'el_a', events: { click: ev } }]);
    expect(removeBinding(base, 'el_a', 'zz').rejected).toBe('unknown-binding');
  });
});

describe('copyBindings và applyToMany', () => {
  let src = addBinding(set0(), 'el_a', fill(), ctx('rect', RUN)).set;
  src = addBinding(src, 'el_a', newBinding('blink', 'rect', RUN)!, ctx('rect', RUN)).set;

  it('copyBindings là bản sao', () => {
    const c = copyBindings(src, 'el_a');
    expect(c).toHaveLength(2);
    c[0]!.id = 'zzz';
    expect(src.elements[0]!.bindings![0]!.id).toBe('fill');
    expect(copyBindings(src, 'none')).toEqual([]);
  });

  it('áp cho nhiều phần tử: thay binding cùng nhóm, id mới duy nhất, bỏ qua mục không hợp', () => {
    const payload = copyBindings(src, 'el_a');
    let dst = addBinding(src, 'el_b', fill(), ctx('rect', RUN)).set;
    const kindOf = (uid: string) => (uid === 'el_t' ? 'text' : 'rect');
    const r = applyToMany(dst, ['el_b', 'el_t'], payload, (uid, b) => ({
      elementKind: kindOf(uid),
      tag: b.source.tagId === 'PUMP.RUN' ? RUN : undefined,
    }));
    dst = r.set;
    // el_b: fill thay thế, blink thêm; el_t (text): fill được (text hợp fill), blink được
    const idsB = dst.elements.find((e) => e.elementUid === 'el_b')!.bindings!.map((b) => b.target);
    expect(idsB.sort()).toEqual(['effect.blink', 'style.fill']);
    const all = dst.elements.flatMap((e) => e.bindings!.map((b) => b.id));
    expect(new Set(all).size).toBe(all.length);
    expect(r.applied.length).toBe(4);
    expect(r.skipped).toEqual([]);
    const bad = applyToMany(
      src,
      ['el_t'],
      [newBinding('level', 'rect', LEVEL)!].map((b) => ({ ...b, id: 'l' })),
      () => ctx('text', LEVEL),
    );
    expect(bad.set).toBe(src);
    expect(bad.skipped[0]!.reason).toBe('element-kind');
  });
});

describe('renameTagInSet', () => {
  it('đổi ở binding và sự kiện ghi; không có chỗ nào thì trả đúng set', () => {
    let s = addBinding(set0(), 'el_a', fill(CMD), ctx('rect', CMD)).set;
    s = setEvent(s, 'el_a', { action: 'toggle', tag: 'PUMP.CMD' }, { screens: [], tag: CMD }).set;
    const r = renameTagInSet(s, 'PUMP.CMD', 'PUMP.START');
    expect(r.count).toBe(2);
    expect(r.set.elements[0]!.bindings![0]!.source.tagId).toBe('PUMP.START');
    expect((r.set.elements[0]!.events!.click as { tag: string }).tag).toBe('PUMP.START');
    expect(s.elements[0]!.bindings![0]!.source.tagId).toBe('PUMP.CMD');
    expect(renameTagInSet(s, 'NOPE', 'X').set).toBe(s);
  });
});

describe('sự kiện (setEvent, clearEvent)', () => {
  const screens: EventCtx['screens'] = [
    { id: 'chinh', kind: 'screen' },
    { id: 'bom', kind: 'popup' },
  ];
  const e = (a: ElementAction, tg?: TagInfo) => setEvent(set0(), 'el_h', a, { screens, tag: tg });

  it('chuyển màn hình chỉ tới màn hình, popup chỉ tới popup', () => {
    expect(e({ action: 'navigate', screen: 'chinh' }).rejected).toBeUndefined();
    expect(e({ action: 'navigate', screen: 'bom' }).rejected).toBe('wrong-screen-kind');
    expect(e({ action: 'popup', screen: 'chinh' }).rejected).toBe('wrong-screen-kind');
    expect(e({ action: 'popup', screen: 'bom' }).rejected).toBeUndefined();
    expect(e({ action: 'popup', screen: 'khong' }).rejected).toBe('bad-screen');
    expect(e({ action: 'closePopup' }).rejected).toBeUndefined();
  });

  it('ghi cần Tag RW không calculated; toggle và pulse cần BOOL', () => {
    const w: ElementAction = { action: 'write', tag: 'PUMP.CMD', value: true };
    expect(e(w, CMD).rejected).toBeUndefined();
    expect(e(w, { ...CMD, access: 'R' }).rejected).toBe('not-writable');
    expect(e(w, { ...CMD, kind: 'calculated' }).rejected).toBe('not-writable');
    expect(e(w, { ...CMD, kind: 'simulation', sim: { kind: 'sine' } }).rejected).toBe(
      'not-writable',
    );
    expect(e(w, { ...CMD, kind: 'simulation', sim: { kind: 'manual' } }).rejected).toBeUndefined();
    expect(e(w).rejected).toBe('bad-tag');
    const num = tag('SP', 'INT16', { access: 'RW', kind: 'external', min: 0, max: 100 });
    expect(e({ action: 'toggle', tag: 'SP' }, num).rejected).toBe('not-bool');
    expect(e({ action: 'write', tag: 'SP', value: 50 }, num).rejected).toBeUndefined();
    expect(e({ action: 'write', tag: 'SP', value: 500 }, num).rejected).toBe('bad-value');
    expect(e({ action: 'write', tag: 'SP', value: 'x' }, num).rejected).toBe('bad-value');
  });

  it('durationMs 100-10000, xác nhận none chỉ BOOL, minRole và nhãn', () => {
    const p = (d: number): ElementAction => ({
      action: 'pulse',
      tag: 'PUMP.CMD',
      value: true,
      durationMs: d,
    });
    expect(e(p(500), CMD).rejected).toBeUndefined();
    expect(e(p(99), CMD).rejected).toBe('bad-duration');
    expect(e(p(10001), CMD).rejected).toBe('bad-duration');
    expect(e(p(500.5), CMD).rejected).toBe('bad-duration');
    const num = tag('SP', 'INT16', { access: 'RW', kind: 'external' });
    expect(e({ action: 'write', tag: 'SP', value: 1, confirm: 'none' }, num).rejected).toBe(
      'bad-confirm',
    );
    expect(e({ action: 'toggle', tag: 'PUMP.CMD', confirm: 'none' }, CMD).rejected).toBeUndefined();
    expect(e({ action: 'toggle', tag: 'PUMP.CMD', minRole: 'viewer' as never }, CMD).rejected).toBe(
      'bad-role',
    );
    expect(e({ action: 'navigate', screen: 'chinh', label: 'a'.repeat(81) }).rejected).toBe(
      'bad-label',
    );
    expect(
      e({ action: 'navigate', screen: 'chinh', label: 'a'.repeat(80) }).rejected,
    ).toBeUndefined();
  });

  it('khóa undefined bị bỏ; đặt lại cùng nội dung trả đúng set; clearEvent', () => {
    const r = e({ action: 'toggle', tag: 'PUMP.CMD', label: undefined, confirm: 'always' }, CMD);
    expect(r.set.elements[0]!.events!.click).toEqual({
      action: 'toggle',
      tag: 'PUMP.CMD',
      confirm: 'always',
    });
    expect(
      setEvent(
        r.set,
        'el_h',
        { action: 'toggle', tag: 'PUMP.CMD', confirm: 'always' },
        { screens, tag: CMD },
      ).set,
    ).toBe(r.set);
    expect(clearEvent(r.set, 'el_h').set.elements).toEqual([]);
    expect(clearEvent(r.set, 'zz').rejected).toBe('unknown-element');
  });

  it('minRole đồng bộ với nhóm Bảo mật', () => {
    const r = e({ action: 'toggle', tag: 'PUMP.CMD' }, CMD);
    const c = { screens, tag: CMD };
    const s = setEventMinRole(r.set, 'el_h', 'engineer', c);
    expect(eventMinRole(s.set, 'el_h')).toBe('engineer');
    expect(eventMinRole(setEventMinRole(s.set, 'el_h', undefined, c).set, 'el_h')).toBeUndefined();
    expect(setEventMinRole(set0(), 'el_h', 'engineer', c).rejected).toBe('bad-action');
    expect(checkEvent({ action: 'closePopup' }, c)).toBeNull();
  });
});

describe('tích hợp project-doc: dirty, một bước hoàn tác, tới 100 bước', () => {
  const FILE = 'screens/bon.svg_bon.bindings.json';
  const docs = (): ProjectDocs => {
    const raw: Record<string, unknown> = {
      'project.json': { schemaVersion: '0.4.0', screens: ['bon'] },
      'tags.json': { schemaVersion: '0.4.0', tags: [] },
      'screens/bon.screen.json': {
        schemaVersion: '0.4.0',
        id: 'bon',
        name: 'Bon',
        kind: 'screen',
        size: { width: 100, height: 100 },
        items: [
          {
            id: 'svg_bon',
            type: 'svg',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            svgFile: 'graphics/a.svg',
            bindingFile: FILE,
            viewBox: [0, 0, 10, 10],
            elements: [],
          },
        ],
      },
      [FILE]: set0(),
    };
    const d: Record<string, ReturnType<typeof loadDoc>> = {};
    for (const [rel, v] of Object.entries(raw))
      d[rel] = loadDoc(rel, JSON.stringify(v, null, 2) + '\n', null, false);
    return withEditable(d);
  };

  it('file binding của item sửa được; sửa thì dirty, về như cũ thì hết dirty', () => {
    const d = docs();
    expect(d[FILE]!.editable).toBe(true);
    expect(isDirty(d[FILE]!)).toBe(false);
    const r = addBinding(set0(), 'el_a', fill(), ctx('rect', RUN));
    const d2 = applyDocEdits(d, [{ kind: 'svgBindings', file: FILE, set: r.set }]);
    expect(isDirty(d2[FILE]!)).toBe(true);
    expect(JSON.parse(writtenText(d2[FILE]!)).elements).toHaveLength(1);
    const d3 = applyDocEdits(d2, [{ kind: 'svgBindings', file: FILE, set: set0() }]);
    expect(isDirty(d3[FILE]!)).toBe(false);
  });

  it('file chưa có được tạo; xóa thì bỏ (chưa từng lưu)', () => {
    const d = docs();
    const NEW = 'screens/bon.svg_bon2.bindings.json';
    const screen = d['screens/bon.screen.json']!;
    const v = JSON.parse(JSON.stringify(screen.value)) as { items: Array<Record<string, unknown>> };
    v.items.push({ ...v.items[0]!, id: 'svg_bon2', bindingFile: NEW });
    const d1 = applyDocEdits(d, [{ kind: 'svgBindings', file: NEW, set: undefined }]);
    expect(d1[NEW]).toBeUndefined();
    const withItem = { ...d, 'screens/bon.screen.json': { ...screen, value: v } };
    const d2 = applyDocEdits(withItem, [
      { kind: 'svgBindings', file: NEW, set: emptyBindingSet('bon', 'svg_bon2') },
    ]);
    expect(d2[NEW]!.created).toBe(true);
    expect(isDirty(d2[NEW]!)).toBe(true);
  });

  it('mỗi thao tác một bước; 105 thao tác chỉ hoàn tác được 100 bước', () => {
    let cur = docs();
    let h = createHistory<string>();
    let t = 0;
    let s = set0();
    for (let i = 0; i < 105; i++) {
      const r = addBinding(s, `el_${i}`, fill(), ctx('rect', RUN));
      s = r.set;
      const before = snapshotOf(cur);
      cur = applyDocEdits(cur, [{ kind: 'svgBindings', file: FILE, set: s }]);
      h = recordEdit(h, before, (t += 5000));
    }
    expect(JSON.parse(writtenText(cur[FILE]!)).elements).toHaveLength(105);
    let undone = 0;
    for (;;) {
      const step = undoEdit(h, snapshotOf(cur));
      if (!step) break;
      h = step.history;
      cur = restoreSnapshot(cur, step.snapshot);
      undone++;
    }
    expect(undone).toBe(HISTORY_LIMIT);
    expect(JSON.parse(writtenText(cur[FILE]!)).elements).toHaveLength(5);
  });
});
