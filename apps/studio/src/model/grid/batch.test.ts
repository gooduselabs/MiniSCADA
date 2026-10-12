// Thao tác hàng loạt thành một sửa đổi (feature 006, T085, data-model §13.1): thêm, điền, dán, nhập là một bước hoàn tác.
import { describe, expect, it } from 'vitest';
import { batchOf, flattenEdits } from './index.ts';
import type { ProjectEdit } from '../project-doc.ts';

const e = (index: number): ProjectEdit => ({ kind: 'tagRemove', index });

describe('batchOf', () => {
  it('không có gì thì rỗng; một sửa đổi giữ nguyên; nhiều thì gộp một batch', () => {
    expect(batchOf([])).toEqual([]);
    expect(batchOf([e(1)])).toEqual([e(1)]);
    expect(batchOf([e(1), e(2)])).toEqual([{ kind: 'batch', edits: [e(1), e(2)] }]);
  });

  it('batch lồng nhau được trải phẳng', () => {
    const nested: ProjectEdit[] = [
      e(1),
      { kind: 'batch', edits: [e(2), { kind: 'batch', edits: [e(3)] }] },
    ];
    expect(flattenEdits(nested)).toEqual([e(1), e(2), e(3)]);
    expect(batchOf(nested)).toEqual([{ kind: 'batch', edits: [e(1), e(2), e(3)] }]);
  });
});
