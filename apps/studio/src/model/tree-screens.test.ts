// Cây project và thao tác cây của màn hình 0.3 (feature 007, T109, FR-065, FR-066): nút Màn hình có biểu tượng screen hoặc popup,
// nhãn "màn hình đầu", mục Điều hướng; thêm, đổi tên, nhân bản, xóa theo NodeRef; project 0.1 và 0.2 không đổi.
import { describe, expect, it } from 'vitest';
import {
  filesOf,
  loadDoc,
  outlineOf,
  withEditable,
  applyDocEdits,
  type ProjectDocs,
} from './project-doc.ts';
import { planAdd, planDuplicate, planRemove, planRename } from './tree-ops.ts';
import { buildTree, findNode, refOfNode } from './tree.ts';
import { dashboardDemo, full02 } from './test-fixtures.ts';

function docsOf(files: Record<string, string>): ProjectDocs {
  const out: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(files)) out[rel] = loadDoc(rel, text, 'h', false);
  return withEditable(out);
}

const treeOf = (files: Record<string, string>) =>
  buildTree({
    folderName: 'demo',
    outline: outlineOf(filesOf(docsOf(files))),
    device: { address: null, state: 'idle' },
  });

describe('cây của project 0.3', () => {
  const root = treeOf(dashboardDemo());

  it('nhóm Màn hình: mục Điều hướng đứng đầu, màn hình theo thứ tự project.json, popup có biểu tượng riêng và nhãn', () => {
    const screens = findNode(root, 'screens')!;
    expect(screens.count).toBe(4);
    expect(screens.children!.map((c) => c.id)).toEqual([
      'navigation',
      'screen:tong-quan',
      'screen:bon-nuoc',
      'screen:giam-sat',
      'screen:bom1',
    ]);
    const nav = findNode(root, 'navigation')!;
    expect(nav).toMatchObject({ editor: 'navigation', icon: 'menu' });
    expect(nav.count).toBeGreaterThan(0);
    expect(findNode(root, 'screen:tong-quan')).toMatchObject({
      label: 'Tổng quan',
      icon: 'screen',
      sub: 'màn hình đầu',
      editor: 'screen:tong-quan',
    });
    expect(findNode(root, 'screen:bom1')).toMatchObject({
      label: 'Bơm 1',
      icon: 'popup',
      sub: 'popup',
    });
  });

  it('refOfNode: mục Màn hình và từng màn hình', () => {
    expect(refOfNode('screens')).toEqual({ type: 'screens' });
    expect(refOfNode('screen:bom1')).toEqual({ type: 'screen', id: 'bom1' });
  });
});

describe('project 0.2: cây không có mục Điều hướng', () => {
  it('giữ nguyên cấu trúc cũ', () => {
    const root = treeOf(full02());
    expect(findNode(root, 'navigation')).toBeUndefined();
    expect(findNode(root, 'screens')!.children!.every((c) => c.icon === 'screen')).toBe(true);
  });
});

describe('thao tác cây với màn hình', () => {
  const docs = docsOf(dashboardDemo());
  const o = outlineOf(filesOf(docs));

  it('thêm: màn hình mới (id nhỏ nhất chưa dùng) và chọn nút mới', () => {
    const p = planAdd({ type: 'screens' }, o);
    expect(p.select).toBe('screen:man-hinh-1');
    expect(p.edits).toHaveLength(1);
    const next = outlineOf(filesOf(applyDocEdits(docs, p.edits)));
    expect(next.screens.map((s) => s.id)).toContain('man-hinh-1');
  });

  it('đổi tên: tên hiển thị, không đổi id; tên rỗng và quá dài bị từ chối', () => {
    const r = planRename({ type: 'screen', id: 'bon-nuoc' }, 'Bồn nước phụ', o);
    expect('edits' in r && r.edits).toEqual([
      {
        kind: 'screenUpsert',
        screen: expect.objectContaining({ id: 'bon-nuoc', name: 'Bồn nước phụ' }),
      },
    ]);
    expect(planRename({ type: 'screen', id: 'bon-nuoc' }, '  ', o)).toEqual({
      error: 'tree.err.empty',
    });
    expect(planRename({ type: 'screen', id: 'bon-nuoc' }, 'x'.repeat(81), o)).toEqual({
      error: 'tree.err.tooLong',
    });
  });

  it('nhân bản: id mới, tên có hậu tố; xóa: bỏ màn hình khỏi project', () => {
    const d = planDuplicate({ type: 'screen', id: 'bon-nuoc' }, o);
    expect(d.select).toBe('screen:bon-nuoc-2');
    const rm = planRemove({ type: 'screen', id: 'giam-sat' }, o);
    expect(rm.edits).toEqual([{ kind: 'screenRemove', id: 'giam-sat' }]);
  });

  it('project 0.2: thêm, nhân bản, xóa màn hình không làm gì (màn hình 0.2 chưa là tài liệu sửa được)', () => {
    const o2 = outlineOf(filesOf(docsOf(full02())));
    expect(planAdd({ type: 'screens' }, o2).edits).toEqual([]);
    expect(planDuplicate({ type: 'screen', id: o2.screens[0]!.id }, o2).edits).toEqual([]);
    expect(planRemove({ type: 'screen', id: o2.screens[0]!.id }, o2).edits).toEqual([]);
  });
});
