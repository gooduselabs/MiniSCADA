// Đổi tên Tag với binding 0.4 (T018; FR-047): `bindings[].source.tagId` và `events.click.tag` đổi trong MỘT bước.
import { describe, expect, it } from 'vitest';
import { renameTag } from './index.ts';

const tags = {
  schemaVersion: '0.4.0',
  tags: [
    { id: 'A.LEVEL', kind: 'internal', type: 'FLOAT32', initial: 0 },
    { id: 'A.RUN', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
  ],
} as never;
const set = {
  schemaVersion: '0.4.0',
  screenId: 'main',
  itemId: 'svg1',
  elements: [
    {
      elementUid: 'el_aaa',
      bindings: [
        {
          id: 'lvl',
          target: 'geometry.clipLevel',
          source: { type: 'tag', tagId: 'A.LEVEL' },
          transform: { kind: 'direct' },
        },
        {
          id: 'col',
          target: 'style.fill',
          source: { type: 'tag', tagId: 'A.RUN' },
          transform: { kind: 'rangeMap', ranges: [{ from: 0, value: '#fff' }] },
        },
      ],
      events: { click: { action: 'toggle', tag: 'A.RUN' } },
    },
    {
      elementUid: 'el_bbb',
      events: { click: { action: 'pulse', tag: 'A.RUN', value: true, durationMs: 500 } },
    },
    { elementUid: 'el_ccc', events: { click: { action: 'closePopup' } } },
  ],
} as never;

type Out = {
  elements: Array<{
    bindings?: Array<{ source: { tagId: string } }>;
    events?: { click: { tag?: string } };
  }>;
};

describe('renameTag với binding 0.4', () => {
  it('binding và Tag của sự kiện (cả phần tử chỉ có events) đổi cùng lúc; hành động không Tag giữ nguyên', () => {
    const r = renameTag({ tags, bindings: { 'main/svg1': set } }, 'A.RUN', 'A.PUMP');
    if (!r.ok) throw new Error(r.message);
    const out = r.project.bindings['main/svg1'] as unknown as Out;
    expect(out.elements[0]!.bindings![0]!.source.tagId).toBe('A.LEVEL');
    expect(out.elements[0]!.bindings![1]!.source.tagId).toBe('A.PUMP');
    expect(out.elements[0]!.events!.click.tag).toBe('A.PUMP');
    expect(out.elements[1]!.events!.click.tag).toBe('A.PUMP');
    expect(out.elements[2]!.events!.click.tag).toBeUndefined();
    expect(r.hits).toContainEqual({ kind: 'event', screen: 'main/svg1', element: 'el_aaa' });
    expect(r.hits).toContainEqual({ kind: 'event', screen: 'main/svg1', element: 'el_bbb' });
    expect(r.hits.filter((h) => h.kind === 'event')).toHaveLength(2);
    expect(r.hits).toContainEqual({
      kind: 'binding',
      screen: 'main/svg1',
      element: 'el_aaa',
      binding: 'col',
    });
  });
  it('không đổi đầu vào; Tag chỉ ở binding thì không có chỗ sự kiện', () => {
    const before = JSON.stringify(set);
    renameTag({ tags, bindings: { x: set } }, 'A.RUN', 'A.PUMP');
    expect(JSON.stringify(set)).toBe(before);
    const r = renameTag({ tags, bindings: { x: set } }, 'A.LEVEL', 'A.LVL2');
    if (!r.ok) throw new Error(r.message);
    expect(r.hits.filter((h) => h.kind === 'event')).toHaveLength(0);
  });
});
