// @vitest-environment jsdom
// Trang xem dùng `valueTables` của GET /api/v1/projects/active (feature 006 T178; project-format-0.2
// §8, §11): bảng của binding và bảng của Tag, cùng kết quả với xem trước của Studio (cùng
// `@mat/expression`).
import { DomApplier } from '@mat/binding-engine';
import { lookupValueTable, type ValueTable } from '@mat/expression';
import type { ElementBindings02 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { tagValueTables, valueTablesOf } from './value-tables.ts';

const NS = 'http://www.w3.org/2000/svg';

const table: ValueTable = {
  entries: [
    { value: 0, text: 'Dừng', color: '#808080' },
    { value: 1, text: 'Chạy', color: '#2E7D32' },
    { from: 10, to: 20, text: 'Bảo trì', color: '#1565C0' },
  ],
  default: { text: 'Không rõ', color: '#B26A00' },
};

// Thân GET /api/v1/projects/active của project 0.2 (rút gọn).
const active = {
  project: { entryScreen: 'main' },
  tags: {
    tags: [
      { id: 'PUMP01.STATE', kind: 'external', type: 'INT16', valueTable: 'TrangThaiBom' },
      { id: 'TANK01.LEVEL', kind: 'external', type: 'FLOAT32' },
      { id: 'CALC.STATE', kind: 'calculated', type: 'INT16', valueTable: 'TrangThaiBom' },
    ],
  },
  valueTables: { TrangThaiBom: table },
};

const bindings: ElementBindings02[] = [
  {
    elementUid: 'el_txt',
    bindings: [
      {
        id: 'b-text',
        target: 'text.content',
        source: { type: 'tag', tagId: 'PUMP01.STATE' },
        transform: { kind: 'valueTable', output: 'text' },
      },
    ],
  },
  {
    elementUid: 'el_box',
    bindings: [
      {
        id: 'b-color',
        target: 'style.fill',
        source: { type: 'tag', tagId: 'CALC.STATE' },
        transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' },
      },
    ],
  },
];

/** Màu như DOM giữ sau khi ghi (jsdom đổi #rrggbb sang rgb(...)). */
function normalized(color: string): string {
  const probe = document.createElementNS(NS, 'rect') as SVGElement;
  probe.style.setProperty('fill', color);
  return probe.style.getPropertyValue('fill');
}

function mount() {
  const root = document.createElementNS(NS, 'svg');
  const mk = (tag: string, uid: string) => {
    const el = document.createElementNS(NS, tag);
    root.append(el);
    return [uid, el] as const;
  };
  return new Map<string, Element>([mk('text', 'el_txt'), mk('rect', 'el_box')]);
}

describe('bảng giá trị của trang xem', () => {
  it('lấy valueTables của projects/active; project 0.1 hay không có bảng thì rỗng', () => {
    expect(valueTablesOf(active)).toEqual({ TrangThaiBom: table });
    expect(valueTablesOf({ tags: { tags: [] } })).toEqual({});
    expect(valueTablesOf({ tags: { tags: [] }, valueTables: null })).toEqual({});
  });

  it('bảng của từng Tag theo `valueTable` trong tags.json', () => {
    expect(tagValueTables(active)).toEqual({
      'PUMP01.STATE': 'TrangThaiBom',
      'CALC.STATE': 'TrangThaiBom',
    });
    expect(tagValueTables({ tags: { tags: [{ id: 'A' }] } })).toEqual({});
  });

  it('chữ theo bảng của Tag và màu theo bảng của binding, như xem trước của Studio', () => {
    const els = mount();
    const frames: Array<() => void> = [];
    const ap = new DomApplier({
      elements: els,
      bindings,
      raf: (cb) => frames.push(cb),
      valueTables: valueTablesOf(active),
      tagValueTables: tagValueTables(active),
    });
    for (const x of [0, 1, 5, 10, 19, 20]) {
      ap.update([
        { id: 'PUMP01.STATE', value: x, quality: 'GOOD' },
        { id: 'CALC.STATE', value: x, quality: 'GOOD' },
      ]);
      frames.splice(0).forEach((f) => f());
      const want = lookupValueTable(table, x);
      expect(els.get('el_txt')!.textContent).toBe(want.text);
      expect((els.get('el_box') as SVGElement).style.getPropertyValue('fill')).toBe(
        normalized(want.color ?? ''),
      );
    }
    ap.dispose();
  });
});
