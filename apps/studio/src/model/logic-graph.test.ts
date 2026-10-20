// Đồ thị của sơ đồ khối Logic (feature 015, T004; spec D1, D3, D5): nút khối, Tag đầu vào, Tag đích, cổng suy ra từ biểu
// thức, dây dữ liệu và dây hành động, cổng vào gắn chỗ sửa (`slot`), lỗi theo ô, sắp xếp tự động trái sang phải.
import { describe, expect, it } from 'vitest';
import type { LogicDoc } from '@mat/project-schema';
import { LOGIC_TAGS, pumpLogic } from './logic-fixtures.ts';
import { buildLogicGraph, type GNode, type LogicGraph } from './logic-graph.ts';
import { emptyLayout } from './logic-layout.ts';

const graph = (
  doc: LogicDoc = pumpLogic(),
  extra: Partial<Parameters<typeof buildLogicGraph>[1]> = {},
) => buildLogicGraph(doc, { tags: LOGIC_TAGS, layout: emptyLayout(), ...extra });
const node = (g: LogicGraph, key: string): GNode => {
  const n = g.nodes.find((x) => x.key === key);
  if (!n) throw new Error(`no node ${key}: ${g.nodes.map((x) => x.key).join(',')}`);
  return n;
};
const overlap = (a: GNode, b: GNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('buildLogicGraph: nút và cổng', () => {
  it('mỗi khối một nút với cổng vào (ô biểu thức) và cổng ra (Tag đầu ra)', () => {
    const g = graph();
    const blocks = g.nodes.filter((n) => n.type === 'block').map((n) => n.key);
    expect(blocks).toEqual([
      'pump_high_level',
      'pump_low_level',
      't_start',
      'c_starts',
      'z_flow',
      'h_pump',
      's_day',
      'w_pump_run',
    ]);
    const t = node(g, 't_start');
    expect(t.ports.filter((p) => p.side === 'in').map((p) => p.key)).toEqual(['in']);
    expect(t.ports.filter((p) => p.side === 'out').map((p) => [p.key, p.tag, p.type])).toEqual([
      ['q', 'LOGIC.T_START.Q', 'bool'],
      ['et', 'LOGIC.T_START.ET', 'num'],
    ]);
    const c = node(g, 'c_starts');
    expect(c.ports.filter((p) => p.side === 'in').map((p) => [p.key, p.optional ?? false])).toEqual(
      [
        ['up', false],
        ['down', true],
        ['reset', true],
      ],
    );
    expect(
      node(g, 'pump_high_level')
        .ports.filter((p) => p.side === 'out')
        .map((p) => p.key),
    ).toEqual(['rise', 'fall']);
    expect(node(g, 'w_pump_run').ports.map((p) => p.key)).toEqual(['cmd']);
    expect(node(g, 's_day').ports.map((p) => p.key)).toEqual(['out']);
  });

  it('Tag đầu vào là hộp toán hạng gắn vào chân (đi theo khối); Tag là đầu ra khối thì dây từ cổng ra của khối', () => {
    const g = graph();
    const ops = g.nodes.filter((n) => n.type === 'tag');
    expect(ops.map((n) => n.id).sort()).toEqual([
      'FLOW01',
      'PUMP01.RUN',
      'PUMP01.RUN',
      'PUMP01.RUN_CMD',
      'TANK01.LEVEL',
      'TANK01.LEVEL',
    ]);
    expect(ops.every((n) => !n.movable && n.owner && n.tagType)).toBe(true);
    const op = ops.find((n) => n.owner === 'c_starts')!;
    expect(op.x + op.w).toBeLessThan(node(g, 'c_starts').x);
    expect(op.slot).toEqual({ kind: 'counter', id: 'c_starts', field: 'up' });
    const fromDay = g.wires.filter((w) => w.from.node === 's_day' && w.from.port === 'out');
    expect(fromDay).toHaveLength(1);
    expect(node(g, fromDay[0]!.to.node).gate).toBe('and');
    expect(
      g.wires
        .filter((w) => w.tag === 'PUMP01.RUN')
        .map((w) => w.to.node)
        .sort(),
    ).toEqual(['c_starts', 'h_pump']);
  });
  it('cổng suy ra: so sánh với hằng là cổng một chân "> 80", && là AND với chân trỏ đúng đoạn nguồn', () => {
    const g = graph();
    const cmp = g.nodes.find((n) => n.owner === 'pump_high_level' && n.type === 'gate')!;
    expect(cmp).toMatchObject({ gate: 'cmp', title: '> 80' });
    expect(cmp.ports.filter((p) => p.side === 'in')).toHaveLength(1);
    expect(cmp.ports[0]!.slot).toEqual({
      kind: 'rule',
      id: 'pump_high_level',
      field: 'when',
      span: [0, 12],
    });
    const and = g.nodes.find((n) => n.owner === 'pump_low_level' && n.gate === 'and')!;
    expect(and.ports.filter((p) => p.side === 'in').map((p) => p.slot?.span)).toEqual([
      [0, 17],
      [21, 32],
    ]);
    // cổng đi theo khối: nằm bên trái khối chủ
    expect(and.x + and.w).toBeLessThanOrEqual(node(g, 'pump_low_level').x);
    // dây từ cổng so sánh lồng trong AND
    const inner = g.nodes.find((n) => n.owner === 'pump_low_level' && n.gate === 'cmp')!;
    expect(inner.title).toBe('< 20');
    expect(g.wires.some((w) => w.from.node === inner.key && w.to.node === and.key)).toBe(true);
    expect(g.wires.some((w) => w.from.node === and.key && w.to.node === 'pump_low_level')).toBe(
      true,
    );
  });

  it('hằng bên trái đảo chiều; hai Tag là cổng hai chân; NOT; OR gộp chuỗi; số học là nút Biểu thức', () => {
    const doc = pumpLogic();
    doc.rules![0]!.when = '80 < TANK01.LEVEL';
    doc.rules![1]!.when = '!PUMP01.RUN || TANK01.LEVEL >= FLOW01 || INT.MODE_AUTO';
    doc.timers![0]!.in = 'FLOW01 * 2 > 10';
    const g = graph(doc, { tags: [...LOGIC_TAGS] });
    expect(g.nodes.find((n) => n.owner === 'pump_high_level')?.title).toBe('> 80');
    const or = g.nodes.find((n) => n.owner === 'pump_low_level' && n.gate === 'or')!;
    expect(or.ports.filter((p) => p.side === 'in')).toHaveLength(3);
    expect(g.nodes.some((n) => n.owner === 'pump_low_level' && n.gate === 'not')).toBe(true);
    const two = g.nodes.find((n) => n.owner === 'pump_low_level' && n.gate === 'cmp')!;
    expect(two.title).toBe('>=');
    expect(two.ports.filter((p) => p.side === 'in')).toHaveLength(2);
    const ex = g.nodes.find((n) => n.owner === 't_start' && n.gate === 'expr')!;
    expect(ex.text).toBe('FLOW01 * 2');
    expect(ex.ports.filter((p) => p.side === 'in').map((p) => p.label)).toEqual(['FLOW01']);
  });

  it('ô rỗng, hằng và biểu thức hỏng: cổng vào hiện chữ, không dây', () => {
    const doc = pumpLogic();
    doc.rules![0]!.when = '';
    doc.rules![1]!.when = 'true';
    doc.timers![0]!.in = 'A &&';
    const g = graph(doc);
    const p = (k: string, f: string) => node(g, k).ports.find((x) => x.key === f)!;
    expect(p('pump_high_level', 'when').text).toBe('');
    expect(p('pump_low_level', 'when').text).toBe('true');
    expect(p('t_start', 'in')).toMatchObject({ text: 'A &&', broken: true });
    expect(g.wires.some((w) => w.to.node === 't_start')).toBe(false);
  });

  it('hành động: dây từ ↑ của luật tới mục Ghi PLC; setTag tới nút Tag đích', () => {
    const doc = pumpLogic();
    doc.rules![1]!.onFall = [{ do: 'setTag', tag: 'INT.MODE_AUTO', value: false }];
    const g = graph(doc);
    const acts = g.wires.filter((w) => w.kind === 'action');
    expect(acts.map((w) => `${w.from.node}.${w.from.port}>${w.to.node}`).sort()).toEqual([
      'pump_high_level.rise>w_pump_run',
      'pump_low_level.fall>out:INT.MODE_AUTO',
      'pump_low_level.rise>w_pump_run',
    ]);
    expect(acts.find((w) => w.to.node === 'out:INT.MODE_AUTO')?.action).toEqual({
      rule: 'pump_low_level',
      edge: 'onFall',
      index: 0,
    });
  });

  it('lỗi theo ô: cổng vào và viền khối đỏ', () => {
    const marks = new Map<string, 'e' | 'w'>([
      ['pump_low_level|when', 'e'],
      ['t_start|id', 'e'],
      ['c_starts|value', 'w'],
    ]);
    const g = graph(pumpLogic(), { marks });
    expect(node(g, 'pump_low_level').ports.find((p) => p.key === 'when')?.mark).toBe('e');
    expect(node(g, 'pump_low_level').mark).toBe('e');
    expect(node(g, 't_start').mark).toBe('e');
    expect(node(g, 'c_starts').ports.find((p) => p.key === 'value')?.mark).toBe('w');
    // cổng suy ra của ô lỗi cũng đỏ
    expect(g.nodes.filter((n) => n.owner === 'pump_low_level').every((n) => n.mark === 'e')).toBe(
      true,
    );
  });
});

describe('buildLogicGraph: sắp xếp', () => {
  it('tự sắp xếp: toán hạng bên trái cổng, khối theo hạng phụ thuộc, Ghi PLC bên phải, không chồng nhau', () => {
    const g = graph();
    const tag = g.nodes.find((n) => n.type === 'tag' && n.owner === 'pump_low_level')!;
    const day = node(g, 's_day');
    const low = node(g, 'pump_low_level');
    const w = node(g, 'w_pump_run');
    const cmp = g.nodes.find((n) => n.owner === 'pump_low_level' && n.gate === 'cmp')!;
    expect(tag.x + tag.w).toBeLessThanOrEqual(cmp.x);
    expect(day.x + day.w).toBeLessThan(tag.x);
    expect(day.x + day.w).toBeLessThan(low.x);
    expect(low.x + low.w).toBeLessThan(w.x);
    const all = g.nodes;
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        expect(overlap(all[i]!, all[j]!), `${all[i]!.key} / ${all[j]!.key}`).toBe(false);
    expect(g.nodes.filter((n) => n.movable).every((n) => n.x % 16 === 0 && n.y % 16 === 0)).toBe(
      true,
    );
  });

  it('vị trí trong layout được dùng; nút chưa có vị trí đặt dưới vùng đã đặt', () => {
    const layout = emptyLayout();
    layout.nodes = { pump_high_level: { x: 1000, y: 64 } };
    const g = graph(pumpLogic(), { layout });
    expect(node(g, 'pump_high_level')).toMatchObject({ x: 1000, y: 64 });
    const t = node(g, 't_start');
    expect(t.y).toBeGreaterThan(64);
  });

  it('vòng (A đọc đầu ra B, B đọc đầu ra A) vẫn dựng được', () => {
    const doc = pumpLogic();
    doc.timers![0]!.in = 'LOGIC.C_STARTS.REACHED';
    doc.counters![0]!.up = 'LOGIC.T_START.Q';
    const g = graph(doc);
    expect(g.wires.some((w) => w.from.node === 'c_starts' && w.to.node === 't_start')).toBe(true);
    expect(g.wires.some((w) => w.from.node === 't_start' && w.to.node === 'c_starts')).toBe(true);
  });

  it('550 khối (giới hạn FR-095) dựng dưới 200 ms', () => {
    const doc: LogicDoc = { schemaVersion: '1.0.0', rules: [], timers: [], counters: [] };
    for (let i = 0; i < 200; i++)
      doc.rules!.push({
        id: `r_${i}`,
        when: `TANK01.LEVEL > ${i} && LOGIC.T_${i % 100}.Q`,
        hold: 1000,
        onRise: [{ do: 'setTag', tag: 'INT.MODE_AUTO', value: true }],
      });
    for (let i = 0; i < 100; i++)
      doc.timers!.push({
        id: `t_${i}`,
        kind: 'ton',
        in: 'PUMP01.RUN',
        pt: 1000,
        q: `LOGIC.T_${i}.Q`,
      });
    for (let i = 0; i < 250; i++)
      doc.counters!.push({ id: `c_${i}`, up: `LOGIC.T_${i % 100}.Q`, value: `LOGIC.C_${i}.V` });
    const t0 = performance.now();
    const g = graph(doc);
    const ms = performance.now() - t0;
    expect(g.nodes.filter((n) => n.type === 'block')).toHaveLength(550);
    expect(ms).toBeLessThan(200);
  });
});
