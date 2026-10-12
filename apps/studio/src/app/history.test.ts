// Lịch sử sửa (feature 004, T005, data-model §4, FR-021): snapshot, tối đa 100 bước, gộp bước gõ
// liên tục trong 1,2 s, sửa mới sau hoàn tác xóa future, lưu không xóa lịch sử.
import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  MERGE_MS,
  breakMerge,
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redoEdit,
  undoEdit,
  type EditHistory,
} from './history.ts';
import {
  applyDocEdits,
  isDirty,
  loadDoc,
  markSaved,
  restoreSnapshot,
  serialize,
  snapshotOf,
} from '../model/project-doc.ts';

/** Tài liệu giả: trạng thái là chuỗi, mỗi lần sửa ghi snapshot TRƯỚC khi sửa (như store). */
function editor() {
  let h: EditHistory<string> = createHistory<string>();
  let doc = 'v0';
  return {
    get doc() {
      return doc;
    },
    get history() {
      return h;
    },
    edit(next: string, now = 0, mergeKey?: string) {
      h = recordEdit(h, doc, now, mergeKey);
      doc = next;
    },
    undo(): boolean {
      const r = undoEdit(h, doc);
      if (!r) return false;
      h = r.history;
      doc = r.snapshot;
      return true;
    },
    redo(): boolean {
      const r = redoEdit(h, doc);
      if (!r) return false;
      h = r.history;
      doc = r.snapshot;
      return true;
    },
  };
}

describe('EditHistory', () => {
  it('hoàn tác, làm lại theo đúng thứ tự', () => {
    const e = editor();
    expect(canUndo(e.history)).toBe(false);
    e.edit('v1');
    e.edit('v2');
    e.edit('v3');
    expect(e.undo()).toBe(true);
    expect(e.doc).toBe('v2');
    expect(e.undo()).toBe(true);
    expect(e.doc).toBe('v1');
    expect(canRedo(e.history)).toBe(true);
    expect(e.redo()).toBe(true);
    expect(e.doc).toBe('v2');
    expect(e.redo()).toBe(true);
    expect(e.doc).toBe('v3');
    expect(e.redo()).toBe(false); // hết bước làm lại: không đổi gì
    expect(e.doc).toBe('v3');
    while (e.undo());
    expect(e.doc).toBe('v0');
    expect(canUndo(e.history)).toBe(false);
  });

  it('tối đa 100 bước, đầy thì bỏ bước cũ nhất', () => {
    expect(HISTORY_LIMIT).toBe(100);
    const e = editor();
    for (let i = 1; i <= 105; i++) e.edit(`v${i}`);
    expect(e.history.past).toHaveLength(100);
    let n = 0;
    while (e.undo()) n++;
    expect(n).toBe(100);
    expect(e.doc).toBe('v5'); // v0…v4 đã bị bỏ
    while (e.redo());
    expect(e.doc).toBe('v105');
    expect(e.history.future).toHaveLength(0);
    expect(e.history.past).toHaveLength(100);
  });

  it('gõ liên tục cùng mergeKey trong 1,2 s gộp một bước; quá 1,2 s thì tách', () => {
    expect(MERGE_MS).toBe(1200);
    const e = editor();
    e.edit('T', 0, 'settings:projectName');
    e.edit('Tr', 500, 'settings:projectName');
    e.edit('Trạ', 1000, 'settings:projectName');
    e.edit('Trạm', 2100, 'settings:projectName'); // cách lần trước 1,1 s: vẫn gộp
    expect(e.history.past).toHaveLength(1);
    e.edit('Trạm B', 3400, 'settings:projectName'); // cách 1,3 s: bước mới
    expect(e.history.past).toHaveLength(2);
    e.undo();
    expect(e.doc).toBe('Trạm');
    e.undo();
    expect(e.doc).toBe('v0');
  });

  it('khóa gộp khác hoặc không có khóa thì không gộp', () => {
    const e = editor();
    e.edit('a', 0, 'settings:projectName');
    e.edit('b', 100, 'settings:projectVersion');
    e.edit('c', 200);
    e.edit('d', 300);
    expect(e.history.past).toHaveLength(4);
  });

  it('sau hoàn tác hay breakMerge, lần sửa sau là bước mới dù cùng khóa', () => {
    const e = editor();
    e.edit('a', 0, 'k');
    e.edit('ab', 100, 'k');
    e.undo();
    e.edit('x', 200, 'k');
    e.edit('xy', 300, 'k');
    expect(e.history.past).toHaveLength(1);
    expect(e.history.past[0]).toBe('v0');
    // breakMerge (ví dụ khi rời ô): bước mới
    const h = breakMerge(e.history);
    expect(recordEdit(h, 'xy', 400, 'k').past).toHaveLength(2);
  });

  it('sửa mới sau hoàn tác xóa future', () => {
    const e = editor();
    e.edit('v1');
    e.edit('v2');
    e.undo();
    expect(canRedo(e.history)).toBe(true);
    e.edit('v2b');
    expect(canRedo(e.history)).toBe(false);
    expect(e.redo()).toBe(false);
    e.undo();
    expect(e.doc).toBe('v1');
  });

  it('trạng thái bất biến: hàm không sửa lịch sử cũ', () => {
    const h0 = createHistory<string>();
    const h1 = recordEdit(h0, 'a', 0);
    const r = undoEdit(h1, 'b');
    expect(h0.past).toEqual([]);
    expect(h1.past).toEqual(['a']);
    expect(h1.future).toEqual([]);
    expect(r?.history.future).toEqual(['b']);
  });
});

// Lưu không xóa lịch sử (data-model §4): hoàn tác sau khi lưu làm tài liệu chưa lưu trở lại.
describe('lịch sử với tài liệu project', () => {
  const PROJECT = serialize({ projectName: 'A', maxClients: 10 });
  const TAGS = serialize({ schemaVersion: '0.1.0', tags: [] });

  it('lưu không xóa lịch sử; hoàn tác sau khi lưu thì chưa lưu trở lại', () => {
    let docs = {
      'project.json': loadDoc('project.json', PROJECT, 'h0', true),
      'tags.json': loadDoc('tags.json', TAGS, 'h1', true),
    };
    let h = createHistory<string>();

    h = recordEdit(h, snapshotOf(docs), 0);
    docs = applyDocEdits(docs, [
      { kind: 'project', field: 'projectName', value: 'B' },
    ]) as typeof docs;
    expect(isDirty(docs['project.json'])).toBe(true);

    // Lưu: ghi file, cập nhật diskText/diskHash; lịch sử giữ nguyên.
    const written = serialize(docs['project.json'].value);
    docs = { ...docs, 'project.json': markSaved(docs['project.json'], written, 'h2') };
    expect(isDirty(docs['project.json'])).toBe(false);
    expect(canUndo(h)).toBe(true);

    const r = undoEdit(h, snapshotOf(docs));
    expect(r).not.toBeNull();
    docs = restoreSnapshot(docs, r!.snapshot) as typeof docs;
    expect((docs['project.json'].value as { projectName: string }).projectName).toBe('A');
    expect(isDirty(docs['project.json'])).toBe(true);
    expect(isDirty(docs['tags.json'])).toBe(false);

    // Làm lại về đúng nội dung đã lưu: hết chưa lưu.
    const r2 = redoEdit(r!.history, snapshotOf(docs));
    docs = restoreSnapshot(docs, r2!.snapshot) as typeof docs;
    expect(isDirty(docs['project.json'])).toBe(false);
  });
});
