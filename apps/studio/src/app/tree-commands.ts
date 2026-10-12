// Lệnh trên cây project 0.2 (feature 006, T084, FR-043): Thêm, Đổi tên, Nhân bản, Xóa theo nút đang chọn. Kế hoạch sửa đổi
// do model/tree-ops.ts dựng (thuần); ở đây chỉ áp vào store thành MỘT bước hoàn tác, chọn nút mới và báo bằng thông báo.
import { t } from '../i18n/index.ts';
import {
  planAdd,
  planDuplicate,
  planRemove,
  planRename,
  currentName,
  type RenameResult,
} from '../model/tree-ops.ts';
import { refOfNode, type NodeRef } from '../model/tree.ts';
import type { StudioApp } from './app.ts';

/** Nút đang chọn trên cây dưới dạng đối tượng của project; `null` nếu nút không có thao tác. */
export const selectedRef = (app: StudioApp): NodeRef | null => {
  const id = app.ui.treeSel;
  return id ? refOfNode(id) : null;
};

export function treeAdd(app: StudioApp): void {
  const ref = selectedRef(app);
  if (!ref) return;
  const plan = planAdd(ref, app.store.state.outline);
  if (!plan.edits.length) return;
  app.store.edit(plan.edits);
  app.revealNode(plan.select);
  app.toast(t('tree.added'));
}

export function treeDuplicate(app: StudioApp): void {
  const ref = selectedRef(app);
  if (!ref) return;
  const plan = planDuplicate(ref, app.store.state.outline);
  if (!plan.edits.length) return;
  app.store.edit(plan.edits);
  app.revealNode(plan.select);
  app.toast(t('tree.duplicated'));
}

export function treeRemove(app: StudioApp): void {
  const ref = selectedRef(app);
  if (!ref) return;
  const outline = app.store.state.outline;
  const name = currentName(ref, outline);
  const plan = planRemove(ref, outline);
  if (!plan.edits.length) return;
  app.store.edit(plan.edits);
  app.toast(
    plan.orphanTags
      ? t('tree.removedOrphans', { name, count: plan.orphanTags })
      : t('tree.removed', { name }),
  );
}

/** Mở hộp thoại Đổi tên cho nút đang chọn. */
export function treeRename(app: StudioApp): void {
  if (selectedRef(app)) app.openDialog({ kind: 'rename' });
}

/** Tên hiện tại của nút đang chọn (điền sẵn vào hộp thoại). */
export function renameDraft(app: StudioApp): string {
  const ref = selectedRef(app);
  return ref ? currentName(ref, app.store.state.outline) : '';
}

/** Áp tên mới; trả lỗi (khóa chuỗi) nếu tên không hợp lệ, `null` khi xong. */
export function applyRename(app: StudioApp, name: string): RenameResult | null {
  const ref = selectedRef(app);
  if (!ref) return null;
  const r = planRename(ref, name, app.store.state.outline);
  if ('error' in r) return r;
  if (r.edits.length) {
    app.store.edit(r.edits);
    // Bảng giá trị đổi khóa thì nút mới cũng đổi id: chọn lại theo tên mới.
    if (ref.type === 'valueTable') app.revealNode(`valuetable:${name.trim()}`);
  }
  return null;
}
