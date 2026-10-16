// Ngăn xếp hoàn tác (contracts/svg-editor.md §3; FR-098; research R26): tối đa SVG_UNDO_DEPTH lô; gộp lệnh cùng
// `mergeKey` và cùng đích trong một cử chỉ (đến `endGesture()`), hoặc gõ chữ cách nhau ≤ 1,5 s (khi truyền `time`);
// ngân sách nút của các cây con lưu trong ngăn xếp (vượt thì bỏ bước cũ nhất, `reduced = true`).
import { InsertNode, SetAttr, applyCommand, Batch, type Command } from './command.ts';
import { subtreeShape } from './build.ts';
import { SVG_TEXT_MERGE_MS, SVG_UNDO_DEPTH, SVG_UNDO_NODE_BUDGET } from './limits.ts';
import type { DrawDoc, NodeId } from './node.ts';

interface Entry {
  /** Lệnh áp để làm lại. */
  forward: Command;
  /** Lệnh áp để hoàn tác. */
  inverse: Command;
  mergeKey?: string;
  targets: string;
  open: boolean;
  time?: number;
  label?: string;
  weight: number;
}

export interface UndoOptions {
  depth?: number;
  nodeBudget?: number;
  mergeWindowMs?: number;
}

/** Số nút của các cây con mà lệnh giữ (InsertNode, kể cả đảo của RemoveNode). */
function weightOf(cmd: Command): number {
  if (cmd instanceof Batch) return cmd.commands.reduce((s, c) => s + weightOf(c), 0);
  if (cmd instanceof InsertNode) return subtreeShape(cmd.subtree).elements;
  return 0;
}

/**
 * Lô chỉ gồm SetAttr: mỗi (nút, tên) chỉ giữ lệnh áp sau cùng (kết quả như áp cả dãy). Với lô đảo `[đảo mới, đảo cũ]`
 * lệnh sau cùng là đảo cũ nhất: khôi phục giá trị và nguyên văn trước cả cử chỉ.
 */
function compact(cmd: Batch): Batch {
  const flat: Command[] = [];
  const stack: Command[] = [cmd];
  while (stack.length > 0) {
    const c = stack.pop()!;
    if (c instanceof Batch)
      for (let i = c.commands.length - 1; i >= 0; i--) stack.push(c.commands[i]);
    else flat.push(c);
  }
  if (!flat.every((c) => c instanceof SetAttr)) return cmd;
  const byKey = new Map<string, SetAttr>();
  for (const c of flat as SetAttr[]) {
    const k = c.node + '\u0000' + c.name;
    byKey.delete(k);
    byKey.set(k, c);
  }
  return new Batch([...byKey.values()], { mergeKey: cmd.mergeKey, label: cmd.label });
}

const targetKey = (cmd: Command): string =>
  [...new Set(cmd.targets())].sort((a, b) => a - b).join(',');

export class UndoStack {
  readonly doc: DrawDoc;
  private undos: Entry[] = [];
  private redos: Entry[] = [];
  private readonly depth: number;
  private readonly budget: number;
  private readonly window: number;
  /** Đã bỏ bước cũ vì ngân sách nút (giao diện ghi "đã giảm độ sâu"). */
  reduced = false;

  constructor(doc: DrawDoc, opts: UndoOptions = {}) {
    this.doc = doc;
    this.depth = opts.depth ?? SVG_UNDO_DEPTH;
    this.budget = opts.nodeBudget ?? SVG_UNDO_NODE_BUDGET;
    this.window = opts.mergeWindowMs ?? SVG_TEXT_MERGE_MS;
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }
  get canRedo(): boolean {
    return this.redos.length > 0;
  }
  get undoSize(): number {
    return this.undos.length;
  }
  get redoSize(): number {
    return this.redos.length;
  }
  get undoLabel(): string | undefined {
    return this.undos[this.undos.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redos[this.redos.length - 1]?.label;
  }
  /** Tổng số nút trong các cây con đang giữ. */
  get retainedNodes(): number {
    let n = 0;
    for (const e of this.undos) n += e.weight;
    for (const e of this.redos) n += e.weight;
    return n;
  }

  /**
   * Áp một thao tác (lệnh hoặc lô) và ghi một bước (hoặc gộp vào bước trước). Lệnh bị từ chối ném CommandError và
   * không vào ngăn xếp. `time` (ms) chỉ dùng cho gộp theo khoảng (gõ chữ). Trả các nút bị ảnh hưởng.
   */
  push(cmd: Command, opts: { time?: number } = {}): NodeId[] {
    const inverse = applyCommand(this.doc, cmd);
    const targets = targetKey(cmd);
    const top = this.undos[this.undos.length - 1];
    const label = cmd instanceof Batch ? cmd.label : undefined;
    this.redos = [];
    if (
      top &&
      top.open &&
      cmd.mergeKey !== undefined &&
      top.mergeKey === cmd.mergeKey &&
      top.targets === targets &&
      (opts.time === undefined || top.time === undefined || opts.time - top.time <= this.window)
    ) {
      top.forward = compact(
        new Batch([top.forward, cmd], { mergeKey: cmd.mergeKey, label: top.label }),
      );
      top.inverse = compact(new Batch([inverse, top.inverse], { label: top.label }));
      top.time = opts.time;
      top.weight = weightOf(top.inverse);
    } else {
      if (top) top.open = false;
      this.undos.push({
        forward: cmd,
        inverse,
        mergeKey: cmd.mergeKey,
        targets,
        open: true,
        time: opts.time,
        label,
        weight: weightOf(inverse),
      });
    }
    this.trim();
    return cmd.targets();
  }

  /** Kết thúc cử chỉ (thả chuột, nhả phím): lệnh sau không gộp vào bước hiện tại. */
  endGesture(): void {
    const top = this.undos[this.undos.length - 1];
    if (top) top.open = false;
  }

  undo(): NodeId[] | null {
    const e = this.undos.pop();
    if (!e) return null;
    e.forward = applyCommand(this.doc, e.inverse);
    e.open = false;
    e.weight = weightOf(e.forward);
    this.redos.push(e);
    this.trim();
    return e.inverse
      .targets()
      .concat(e.forward.targets())
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  redo(): NodeId[] | null {
    const e = this.redos.pop();
    if (!e) return null;
    e.inverse = applyCommand(this.doc, e.forward);
    e.weight = weightOf(e.inverse);
    this.undos.push(e);
    this.trim();
    return e.forward
      .targets()
      .concat(e.inverse.targets())
      .filter((v, i, a) => a.indexOf(v) === i);
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
    this.reduced = false;
  }

  private trim(): void {
    while (this.undos.length > this.depth) this.undos.shift();
    while (this.retainedNodes > this.budget && this.undos.length + this.redos.length > 0) {
      if (this.undos.length > 0) this.undos.shift();
      else this.redos.shift();
      this.reduced = true;
    }
  }
}
