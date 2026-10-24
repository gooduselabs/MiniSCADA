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
import { planAddScreen, planSetEntry, type ScreenLayoutKind } from '../model/screen-ops.ts';
import { refOfNode, type NodeRef } from '../model/tree.ts';
import type { ChannelKind } from '../model/connections.ts';
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
  if (!plan.edits.length) {
    if (plan.reason) app.toast(t(plan.reason));
    return;
  }
  app.store.edit(plan.edits);
  app.revealNode(plan.select);
  app.toast(t('tree.added'));
  if (plan.select.startsWith('screen:')) app.openEditor(plan.select as `screen:${string}`);
}

/** Thêm màn hình hoặc popup của project 0.3 và mở editor của nó (feature 007, FR-065). */
export function screenAdd(
  app: StudioApp,
  kind: 'screen' | 'popup',
  layout: ScreenLayoutKind = app.store.state.outline.format11 ? 'grid' : 'free',
): void {
  // feature 012: project 1.1 tạo màn hình lưới (mặc định, FR-015); `screen.addFree` chọn tự do
  const plan = planAddScreen(
    app.store.state.outline,
    kind,
    (n) => t(kind === 'popup' ? 'screen.newPopupName' : 'screen.newName', { n }),
    layout,
  );
  if (!plan) return;
  app.store.edit(plan.edits);
  app.revealNode(`screen:${plan.id}`);
  app.openEditor(`screen:${plan.id}`);
  app.toast(t('tree.added'));
}

/** Id màn hình đang làm việc: tab đang mở là màn hình, không thì nút màn hình đang chọn trên cây. */
export function currentScreenId(app: StudioApp): string | null {
  const active = app.store.state.active;
  if (active.startsWith('screen:')) return active.slice('screen:'.length);
  const ref = selectedRef(app);
  return ref?.type === 'screen' ? ref.id : null;
}

/** Đặt màn hình đang làm việc là màn hình đầu. */
export function screenSetEntry(app: StudioApp): void {
  const id = currentScreenId(app);
  if (id === null) return;
  const edits = planSetEntry(app.store.state.outline, id);
  if (!edits) return;
  app.store.edit(edits);
  app.toast(t('screen.entrySet', { name: app.editorTitle(`screen:${id}`) }));
}

/** Thêm kênh mới theo loại (nút Thêm kênh Modbus RTU, Siemens S7, Omron FINS, Mitsubishi MC, BACnet/IP, OPC UA của editor Kết nối); luôn thêm vào mục Kết nối. */
export function treeAddChannel(app: StudioApp, kind: ChannelKind): void {
  const plan = planAdd({ type: 'connections' }, app.store.state.outline, kind);
  if (!plan.edits.length) return;
  app.store.edit(plan.edits);
  app.revealNode(plan.select);
  app.toast(t('tree.added'));
}

export function treeDuplicate(app: StudioApp): void {
  const ref = selectedRef(app);
  if (!ref) return;
  const plan = planDuplicate(ref, app.store.state.outline);
  if (!plan.edits.length) {
    if (plan.reason) app.toast(t(plan.reason));
    return;
  }
  app.store.edit(plan.edits);
  app.revealNode(plan.select);
  app.toast(t('tree.duplicated'));
}

export function treeRemove(app: StudioApp): void {
  const ref = selectedRef(app);
  if (!ref) return;
  if (ref.type === 'screen') {
    // Màn hình có thể được trỏ tới: hỏi trước, liệt kê chỗ dùng (feature 007, FR-065).
    app.openDialog({ kind: 'deleteScreen', id: ref.id });
    return;
  }
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
