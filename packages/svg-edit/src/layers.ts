// Lớp (contracts/svg-editor.md §6; FR-105): `<g data-mat-layer="<tên>">` con trực tiếp của gốc, tên ≤ 64 byte, duy
// nhất. Phần tử là con trực tiếp của gốc thuộc "Lớp mặc định" ảo (null). Ẩn và khóa là trạng thái soạn thảo ngoài tệp
// (apps/studio/src/model/svg-state.ts), không ở đây.
import { isLayerName } from '@mat/svg-renderer';
import { topLevel, type TransformResult } from './bake.ts';
import { Batch, CommandError, SetAttr, type Command } from './command.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { elementChildren } from './node.ts';
import { moveToParent } from './order.ts';
import { Sim, deleteNodes, insertSpec, isLayer, moveUnit, removeUnit } from './structure.ts';

export interface LayerInfo {
  name: string;
  id: NodeId;
}

/** Các lớp theo thứ tự vẽ (dưới lên trên). */
export function listLayers(doc: DrawDoc): LayerInfo[] {
  return elementChildren(doc, doc.root)
    .filter((id) => isLayer(doc, id))
    .map((id) => ({ name: doc.nodes.get(id)!.attrs.get('data-mat-layer')!, id }));
}

export function findLayer(doc: DrawDoc, name: string): NodeId | null {
  return listLayers(doc).find((l) => l.name === name)?.id ?? null;
}

/** Lớp chứa phần tử (null: lớp mặc định). */
export function layerOf(doc: DrawDoc, id: NodeId): string | null {
  let cur: NodeId | null = id;
  while (cur !== null && doc.nodes.get(cur)!.parent !== doc.root) cur = doc.nodes.get(cur)!.parent;
  return cur !== null && isLayer(doc, cur)
    ? doc.nodes.get(cur)!.attrs.get('data-mat-layer')!
    : null;
}

function checkName(doc: DrawDoc, name: string, except?: string): void {
  if (!isLayerName(name))
    throw new CommandError('SVG_INVALID', 'Tên lớp rỗng, quá 64 byte hoặc có ký tự điều khiển');
  if (name !== except && findLayer(doc, name) !== null)
    throw new CommandError('SVG_INVALID', `Lớp "${name}" đã có`);
}

function layerOrFail(doc: DrawDoc, name: string): NodeId {
  const id = findLayer(doc, name);
  if (id === null) throw new CommandError('SVG_INVALID', `Không có lớp "${name}"`);
  return id;
}

/** Tạo lớp mới trên cùng. */
export function createLayer(doc: DrawDoc, name: string): { batch: Batch; id: NodeId } {
  checkName(doc, name);
  const ins = insertSpec(doc, doc.root, { tag: 'g', attrs: [['data-mat-layer', name]] });
  return { batch: new Batch([ins.command], { label: 'Tạo lớp' }), id: ins.id };
}

export function renameLayer(doc: DrawDoc, name: string, newName: string): Batch {
  const id = layerOrFail(doc, name);
  checkName(doc, newName, name);
  return new Batch([new SetAttr(id, 'data-mat-layer', newName)], { label: 'Đổi tên lớp' });
}

/** Xóa lớp: `content` xóa cả nội dung, `move` chuyển nội dung sang lớp mặc định (tại vị trí lớp). */
export function deleteLayer(
  doc: DrawDoc,
  name: string,
  mode: 'content' | 'move',
): { batch: Batch; uids: string[] } {
  const id = layerOrFail(doc, name);
  if (mode === 'content') return deleteNodes(doc, [id]);
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  for (const c of elementChildren(doc, id)) cmds.push(...moveUnit(sim, c, doc.root, id));
  cmds.push(...removeUnit(sim, id));
  return { batch: new Batch(cmds, { label: 'Xóa lớp' }), uids: [] };
}

/** Chuyển phần tử sang lớp (null: lớp mặc định), lên trên cùng của lớp, giữ hiển thị. */
export function moveToLayer(
  doc: DrawDoc,
  ids: readonly NodeId[],
  name: string | null,
): TransformResult {
  const target = name === null ? doc.root : layerOrFail(doc, name);
  return moveToParent(doc, topLevel(doc, ids), target, null);
}

/** Đổi thứ tự lớp: `index` trong danh sách lớp (0 = dưới cùng). */
export function reorderLayer(doc: DrawDoc, name: string, index: number): Batch {
  const id = layerOrFail(doc, name);
  const others = listLayers(doc).filter((l) => l.id !== id);
  const i = Math.max(0, Math.min(index, others.length));
  const sim = new Sim(doc);
  const before = i < others.length ? others[i].id : null;
  return new Batch(moveUnit(sim, id, doc.root, before), { label: 'Đổi thứ tự lớp' });
}
