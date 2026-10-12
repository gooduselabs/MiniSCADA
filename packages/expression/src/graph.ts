// Đồ thị phụ thuộc của Tag tính toán (T030/T031): thứ tự tô-pô tất định, vòng, độ sâu, Tag phía sau.
// Bản C++ (core/tag-engine/calc_graph) theo cùng thuật toán và cùng thứ tự để cho cùng kết quả.

export const MAX_CHAIN_DEPTH = 16;

export interface CalcInput {
  /** Id Tag tính toán, theo thứ tự trong tags.json. */
  id: string;
  /** Id các Tag đầu vào (theo thứ tự xuất hiện trong biểu thức). Tag không tính toán được bỏ qua. */
  inputs: readonly string[];
}

export interface GraphIssue {
  code: 'E_EXPR_CYCLE' | 'E_EXPR_DEPTH';
  /** Tag chịu lỗi. */
  id: string;
  message: string;
  /** Với E_EXPR_CYCLE: đường vòng, ví dụ ["A", "B", "A"]. */
  cycle?: string[];
}

export interface CalcGraph {
  /** Thứ tự tính (Kahn; hòa thì theo thứ tự trong `calcs`). Không có Tag nằm trong vòng. */
  order: string[];
  /** Tầng của từng Tag (1 là không phụ thuộc Tag tính toán nào). Không có Tag nằm trong vòng. */
  levels: ReadonlyMap<string, number>;
  issues: GraphIssue[];
  /** Mọi Tag tính toán phụ thuộc (trực tiếp hoặc gián tiếp) vào `id`, theo thứ tự tính. `id` có thể là bất kỳ Tag. */
  downstream(id: string): string[];
}

export function buildCalcGraph(calcs: readonly CalcInput[]): CalcGraph {
  const index = new Map<string, number>();
  calcs.forEach((c, i) => index.set(c.id, i));
  const n = calcs.length;
  // cạnh: đầu vào -> Tag tính toán (chỉ khi đầu vào là Tag tính toán); giữ thứ tự khóa theo `inputs`.
  const deps: number[][] = calcs.map((c) => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of c.inputs) {
      const j = index.get(id);
      if (j !== undefined && !seen.has(j)) {
        seen.add(j);
        out.push(j);
      }
    }
    return out;
  });
  const users: number[][] = Array.from({ length: n }, () => []);
  deps.forEach((ds, i) => ds.forEach((j) => users[j]!.push(i)));

  // Kahn: hòa thì theo chỉ số nhỏ nhất.
  const indeg = deps.map((d) => d.length);
  const ready: number[] = [];
  indeg.forEach((d, i) => d === 0 && ready.push(i));
  const orderIdx: number[] = [];
  const level = new Array<number>(n).fill(0);
  while (ready.length > 0) {
    let k = 0;
    for (let q = 1; q < ready.length; q++) if (ready[q]! < ready[k]!) k = q;
    const i = ready.splice(k, 1)[0]!;
    orderIdx.push(i);
    level[i] = 1 + Math.max(0, ...deps[i]!.map((j) => level[j]!));
    for (const u of users[i]!) if (--indeg[u]! === 0) ready.push(u);
  }

  const issues: GraphIssue[] = [];
  const inOrder = new Set(orderIdx);
  // vòng: mọi nút không vào được thứ tự nằm trong vòng hoặc phụ thuộc vào vòng. Chỉ báo nút nằm TRONG vòng.
  const cyclic = [...Array(n).keys()].filter((i) => !inOrder.has(i));
  if (cyclic.length > 0) {
    const sccs = stronglyConnected(cyclic, deps);
    const reportable: { members: number[]; path: number[] }[] = [];
    for (const comp of sccs) {
      const selfLoop = comp.length === 1 && deps[comp[0]!]!.includes(comp[0]!);
      if (comp.length === 1 && !selfLoop) continue;
      const members = [...comp].sort((a, b) => a - b);
      reportable.push({ members, path: cyclePath(members[0]!, new Set(members), deps) });
    }
    const byTag = new Map<number, number[]>();
    for (const r of reportable) for (const m of r.members) byTag.set(m, r.path);
    for (const i of [...byTag.keys()].sort((a, b) => a - b)) {
      const names = byTag.get(i)!.map((j) => calcs[j]!.id);
      issues.push({
        code: 'E_EXPR_CYCLE',
        id: calcs[i]!.id,
        message: `circular reference: ${names.join(' -> ')}`,
        cycle: names,
      });
    }
  }
  for (const i of orderIdx) {
    if (level[i]! > MAX_CHAIN_DEPTH)
      issues.push({
        code: 'E_EXPR_DEPTH',
        id: calcs[i]!.id,
        message: `dependency chain has ${level[i]} levels (max ${MAX_CHAIN_DEPTH})`,
      });
  }

  const pos = new Map<number, number>();
  orderIdx.forEach((i, p) => pos.set(i, p));
  const levels = new Map<string, number>();
  for (const i of orderIdx) levels.set(calcs[i]!.id, level[i]!);

  return {
    order: orderIdx.map((i) => calcs[i]!.id),
    levels,
    issues,
    downstream(id: string): string[] {
      // đầu vào trực tiếp: mọi Tag tính toán có `id` trong inputs
      const direct: number[] = [];
      calcs.forEach((c, i) => c.inputs.includes(id) && direct.push(i));
      const seen = new Set<number>();
      const stack = [...direct];
      while (stack.length > 0) {
        const i = stack.pop()!;
        if (seen.has(i)) continue;
        seen.add(i);
        for (const u of users[i]!) stack.push(u);
      }
      return [...seen]
        .filter((i) => pos.has(i))
        .sort((a, b) => pos.get(a)! - pos.get(b)!)
        .map((i) => calcs[i]!.id);
    },
  };
}

/** Tarjan trên tập con `nodes`, cạnh i -> deps[i]. */
function stronglyConnected(nodes: number[], deps: number[][]): number[][] {
  const inSet = new Set(nodes);
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  const visit = (v: number): void => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps[v]!) {
      if (!inSet.has(w)) continue;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: number[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      out.push(comp);
    }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}

/** Đường vòng ngắn nhất qua `start` (BFS, hòa theo thứ tự đầu vào); trả [start, …, start]. */
function cyclePath(start: number, members: Set<number>, deps: number[][]): number[] {
  // deps[i] = các Tag mà i đọc. Đường vòng theo chiều "i đọc j": start -> j -> … -> start.
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (const j of deps[start]!) {
    if (!members.has(j)) continue;
    if (j === start) return [start, start];
    if (!prev.has(j)) {
      prev.set(j, start);
      queue.push(j);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]!;
    for (const w of deps[v]!) {
      if (!members.has(w)) continue;
      if (w === start) {
        const path = [start, v];
        let u = v;
        while (prev.get(u) !== start) {
          u = prev.get(u)!;
          path.splice(1, 0, u);
        }
        path.push(start);
        return path;
      }
      if (!prev.has(w)) {
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start];
}
