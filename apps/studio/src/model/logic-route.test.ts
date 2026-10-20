// Dây hành động của sơ đồ Logic (feature 015): đi thẳng trong khe khi không vướng; vướng khối thì vòng qua kênh ngoài, không
// đoạn nào cắt khối; mỗi dây vòng một làn.
import { describe, expect, it } from 'vitest';
import type { LogicDoc } from '@mat/project-schema';
import { LOGIC_TAGS } from './logic-fixtures.ts';
import { buildLogicGraph } from './logic-graph.ts';
import { emptyLayout } from './logic-layout.ts';
import { actionRoute, roundedPath, type Rect } from './logic-route.ts';

/** Một đoạn thẳng (ngang hoặc dọc) có cắt phần trong của khối không. */
function segHits(a: [number, number], b: [number, number], r: Rect): boolean {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return x0 < r.x + r.w - 1 && x1 > r.x + 1 && y0 < r.y + r.h - 1 && y1 > r.y + 1;
}

describe('actionRoute', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 600 };
  it('không vướng: gấp khúc trong khe trước đích', () => {
    const r = actionRoute(100, 50, 400, 200, [], bounds, 0)!;
    expect(r.detour).toBe(false);
    expect(r.points).toEqual([
      [100, 50],
      [378, 50],
      [378, 200],
      [400, 200],
    ]);
    expect(roundedPath(r.points)).toMatch(/^M100 50L372 50Q378 50 378 56/);
  });

  it('vướng khối: vòng qua kênh trên hoặc dưới, không đoạn nào cắt khối; hai dây hai làn', () => {
    const block = { x: 200, y: 20, w: 120, h: 80 };
    const a = actionRoute(100, 60, 400, 120, [block], bounds, 0)!;
    expect(a.detour).toBe(true);
    for (let i = 1; i < a.points.length; i++)
      expect(segHits(a.points[i - 1]!, a.points[i]!, block)).toBe(false);
    const b = actionRoute(100, 60, 400, 120, [block], bounds, 1)!;
    expect(b.points[2]![1]).not.toBe(a.points[2]![1]);
    expect(actionRoute(400, 60, 100, 60, [], bounds, 0)).toBeNull();
  });

  it('10 luật gập cột: mọi dây tới Ghi PLC không cắt khối nào', () => {
    const doc: LogicDoc = {
      schemaVersion: '1.0.0',
      writes: [{ id: 'w_a', tag: 'PUMP01.RUN_CMD', allowed: { values: [true, false] } }],
      rules: Array.from({ length: 10 }, (_, i) => ({
        id: `r_${i}`,
        when: `TANK01.LEVEL > ${i * 10}`,
        hold: 1000,
        onRise: [{ do: 'write', write: 'w_a', value: true }],
      })),
    };
    const g = buildLogicGraph(doc, { tags: LOGIC_TAGS, layout: emptyLayout() });
    const rules = g.nodes.filter((n) => n.kind === 'rule' && n.type === 'block');
    expect(new Set(rules.map((n) => n.x)).size).toBeGreaterThan(1); // cột luật đã gập
    const w = g.byKey.get('w_a')!;
    let lane = 0;
    for (const r of rules) {
      const p = r.ports.find((x) => x.key === 'rise')!;
      const others = g.nodes.filter((n) => n !== r && n !== w);
      const route = actionRoute(
        r.x + p.dx,
        r.y + p.dy,
        w.x,
        w.y + w.ports[0]!.dy,
        others,
        g.bounds,
        lane,
      )!;
      if (route.detour) lane++;
      for (const o of others)
        for (let i = 1; i < route.points.length; i++)
          expect(segHits(route.points[i - 1]!, route.points[i]!, o), `${r.key} × ${o.key}`).toBe(
            false,
          );
    }
  });
});
