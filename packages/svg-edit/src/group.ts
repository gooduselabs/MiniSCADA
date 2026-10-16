// Nhóm và bỏ nhóm (contracts/svg-editor.md §4; FR-102): không đổi hiển thị, `data-mat-uid` của con giữ nguyên, nhóm
// mới có uid mới, nhóm rỗng tự bị xóa.
import { parseDeclarations, parseLocalUrl } from '@mat/svg-renderer';
import { applyLocal, topLevel } from './bake.ts';
import { presentation } from './bbox.ts';
import { Batch, CommandError, SetAttr, type Command } from './command.ts';
import { invert, isIdentity, multiply } from './matrix.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { documentOrder, elementChildren, isInDefinitions, isInsideOpaque } from './node.ts';
import { Sim, insertSpec, isLayer, moveUnit, pruneEmpty, removeUnit } from './structure.ts';
import { ctm, transformOf } from './transform.ts';

/** Thuộc tính trình bày kế thừa: chép từ nhóm xuống con chưa đặt khi bỏ nhóm. */
export const INHERITABLE: readonly string[] = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility',
  'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'text-anchor', 'text-decoration',
  'letter-spacing', 'word-spacing', 'direction', 'writing-mode', 'clip-rule', 'marker-start', 'marker-mid',
  'marker-end', 'paint-order', 'shape-rendering', 'text-rendering', 'image-rendering',
]; // prettier-ignore

/** Thuộc tính của nhóm không chép xuống con được mà vẫn giữ hiển thị. */
const BLOCKING = ['opacity', 'clip-path', 'mask', 'filter'];

const invalid = (msg: string): never => {
  throw new CommandError('SVG_INVALID', msg);
};

/** Phần tử chọn được để nhóm/biến đổi trên canvas (không gốc, không trong defs/khối giữ nguyên, không phải lớp). */
export function isDrawable(doc: DrawDoc, id: NodeId): boolean {
  return (
    id !== doc.root && !isInDefinitions(doc, id) && !isInsideOpaque(doc, id) && !isLayer(doc, id)
  );
}

export function groupNodes(doc: DrawDoc, ids: readonly NodeId[]): { batch: Batch; group: NodeId } {
  const order = documentOrder(doc);
  const sel = topLevel(doc, ids).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (sel.length === 0) invalid('Chưa chọn phần tử để nhóm');
  for (const id of sel)
    if (!isDrawable(doc, id)) invalid('Phần tử này không nhóm được (gốc, định nghĩa, lớp)');
  const top = sel[sel.length - 1];
  const sim = new Sim(doc);
  const P = sim.parent(top)!;
  const ins = insertSpec(doc, P, { tag: 'g', attrs: [['data-mat-uid', doc.uid()]] }, top, sim);
  const cmds: Command[] = [ins.command];
  const oldParents = new Set<NodeId>();
  const ctmP = ctm(doc, P);
  const ctmPi = invert(ctmP);
  for (const id of sel) {
    const op = sim.parent(id)!;
    if (op !== P) {
      if (!ctmPi) invalid('Cha có ma trận suy biến');
      const K = multiply(ctmPi!, ctm(doc, op));
      if (!isIdentity(K)) cmds.push(...applyLocal(doc, id, K, { noReplace: true }).commands);
      oldParents.add(op);
    }
    cmds.push(...moveUnit(sim, id, ins.id, null));
  }
  cmds.push(...pruneEmpty(doc, sim, oldParents));
  return { batch: new Batch(cmds, { label: 'Nhóm' }), group: ins.id };
}

/** Id của nút có được tham chiếu (url(#id), href="#id") ở đâu không. */
function isReferenced(doc: DrawDoc, idAttr: string): boolean {
  for (const n of doc.nodes.values())
    for (const [k, v] of n.attrs) {
      if ((k === 'href' || k === 'xlink:href') && v.trim() === '#' + idAttr) return true;
      if (v.indexOf('url(') >= 0) {
        for (let i = v.indexOf('url('); i >= 0; i = v.indexOf('url(', i + 4))
          if (parseLocalUrl(v.slice(i))?.id === idAttr) return true;
      }
    }
  return false;
}

export function ungroupNode(
  doc: DrawDoc,
  gid: NodeId,
): { batch: Batch; children: NodeId[]; removedUid: string | null } {
  const g = doc.nodes.get(gid);
  if (!g || g.tag !== 'g') return invalid('Chỉ bỏ nhóm phần tử g');
  if (!isDrawable(doc, gid)) invalid('Không bỏ nhóm lớp, định nghĩa hay khối giữ nguyên');
  for (const p of BLOCKING) {
    const v = presentation(g, p);
    if (v !== undefined && v !== 'none' && !(p === 'opacity' && Number(v) === 1))
      invalid(`Nhóm có ${p}: bỏ nhóm sẽ đổi hiển thị`);
  }
  const idAttr = g.attrs.get('id');
  if (idAttr !== undefined && isReferenced(doc, idAttr))
    invalid(`Nhóm "${idAttr}" đang được tham chiếu`);
  const Mg = transformOf(doc, gid);
  // `title` của nhóm đi theo nhóm (bị xóa); chỉ chuyển phần tử vẽ
  const kids = elementChildren(doc, gid).filter((c) => doc.nodes.get(c)!.tag !== 'title');
  const inheritedVals: Array<[string, string]> = [];
  for (const p of INHERITABLE) {
    const v = presentation(g, p);
    if (v !== undefined) inheritedVals.push([p, v]);
  }
  if (presentation(g, 'display') === 'none') inheritedVals.push(['display', 'none']);
  const sim = new Sim(doc);
  const P = sim.parent(gid)!;
  const cmds: Command[] = [];
  for (const c of kids) {
    const n = doc.nodes.get(c)!;
    if (!isIdentity(Mg)) cmds.push(...applyLocal(doc, c, Mg, { noReplace: true }).commands);
    const st = n.attrs.get('style');
    const styleProps = new Set(st === undefined ? [] : parseDeclarations(st).map((d) => d.prop));
    for (const [p, v] of inheritedVals)
      if (!n.attrs.has(p) && !styleProps.has(p)) cmds.push(new SetAttr(c, p, v));
  }
  for (const c of kids) cmds.push(...moveUnit(sim, c, P, gid));
  cmds.push(...removeUnit(sim, gid));
  cmds.push(...pruneEmpty(doc, sim, [P]));
  return {
    batch: new Batch(cmds, { label: 'Bỏ nhóm' }),
    children: kids,
    removedUid: g.attrs.get('data-mat-uid') ?? null,
  };
}
