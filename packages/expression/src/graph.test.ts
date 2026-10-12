// Đồ thị phụ thuộc của Tag tính toán (T030): thứ tự tô-pô tất định, vòng, độ sâu, Tag phía sau.
import { describe, expect, it } from 'vitest';
import { buildCalcGraph, type CalcInput } from './index.ts';

const c = (id: string, ...inputs: string[]): CalcInput => ({ id, inputs });

describe('topological order', () => {
  it('Kahn; ties go in tags.json order', () => {
    const g = buildCalcGraph([c('C', 'B'), c('B', 'A'), c('D', 'X'), c('E', 'X', 'Y')]);
    expect(g.issues).toEqual([]);
    // B không phụ thuộc Tag tính toán nào: tầng 1; "C" phụ thuộc B
    expect(g.order).toEqual(['B', 'C', 'D', 'E']);
  });
  it('is deterministic and independent of Map iteration', () => {
    const calcs = [c('K3', 'K1', 'K2'), c('K1', 'P'), c('K2', 'K1'), c('K4', 'P')];
    const a = buildCalcGraph(calcs).order;
    const b = buildCalcGraph(calcs).order;
    expect(a).toEqual(b);
    expect(a).toEqual(['K1', 'K2', 'K3', 'K4']);
  });
  it('ignores non-calculated inputs and duplicate inputs', () => {
    const g = buildCalcGraph([c('A', 'X', 'X'), c('B', 'A', 'A')]);
    expect(g.order).toEqual(['A', 'B']);
  });
});

describe('cycles (E_EXPR_CYCLE)', () => {
  it('self reference', () => {
    const g = buildCalcGraph([c('A', 'A')]);
    expect(g.issues).toEqual([
      { code: 'E_EXPR_CYCLE', id: 'A', message: 'circular reference: A -> A', cycle: ['A', 'A'] },
    ]);
    expect(g.order).toEqual([]);
  });
  it('A <-> B is reported at both tags with the path', () => {
    const g = buildCalcGraph([c('A', 'B'), c('B', 'A')]);
    expect(g.issues.map((i) => [i.code, i.id, i.cycle])).toEqual([
      ['E_EXPR_CYCLE', 'A', ['A', 'B', 'A']],
      ['E_EXPR_CYCLE', 'B', ['A', 'B', 'A']],
    ]);
    expect(g.issues[0]!.message).toBe('circular reference: A -> B -> A');
  });
  it('an indirect cycle of three tags is reported at every tag in it', () => {
    const g = buildCalcGraph([c('X', 'Z'), c('Y', 'X'), c('Z', 'Y'), c('OK', 'P')]);
    expect(g.issues.map((i) => i.id)).toEqual(['X', 'Y', 'Z']);
    expect(g.issues[0]!.cycle).toEqual(['X', 'Z', 'Y', 'X']);
    expect(g.order).toEqual(['OK']);
  });
  it('a tag that merely depends on a cycle is not reported as in the cycle', () => {
    const g = buildCalcGraph([c('A', 'B'), c('B', 'A'), c('D', 'A')]);
    expect(g.issues.map((i) => i.id)).toEqual(['A', 'B']);
  });
  it('two separate cycles', () => {
    const g = buildCalcGraph([c('A', 'B'), c('B', 'A'), c('M', 'N'), c('N', 'M')]);
    expect(g.issues.map((i) => i.id)).toEqual(['A', 'B', 'M', 'N']);
    expect(g.issues[2]!.cycle).toEqual(['M', 'N', 'M']);
  });
});

describe('depth (E_EXPR_DEPTH)', () => {
  const chain = (n: number): CalcInput[] =>
    Array.from({ length: n }, (_, i) => (i === 0 ? c('T1', 'RAW') : c(`T${i + 1}`, `T${i}`)));
  it('level 1 depends on no calculated tag; 16 levels are valid', () => {
    const g = buildCalcGraph(chain(16));
    expect(g.issues).toEqual([]);
    expect(g.levels.get('T1')).toBe(1);
    expect(g.levels.get('T16')).toBe(16);
  });
  it('17 levels is E_EXPR_DEPTH at the 17th tag', () => {
    const g = buildCalcGraph(chain(17));
    expect(g.issues.map((i) => [i.code, i.id])).toEqual([['E_EXPR_DEPTH', 'T17']]);
  });
  it('level is 1 + the deepest calculated input', () => {
    const g = buildCalcGraph([c('A', 'RAW'), c('B', 'A'), c('C', 'A', 'B')]);
    expect([...g.levels]).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });
});

describe('downstream', () => {
  const g = buildCalcGraph([c('B', 'A'), c('C', 'B'), c('D', 'A', 'C'), c('E', 'Z')]);
  it('lists every calculated tag that depends on a tag, directly or not, in calculation order', () => {
    expect(g.downstream('A')).toEqual(['B', 'C', 'D']);
    expect(g.downstream('B')).toEqual(['C', 'D']);
    expect(g.downstream('Z')).toEqual(['E']);
  });
  it('is empty for a tag nothing depends on, or an unknown tag', () => {
    expect(g.downstream('D')).toEqual([]);
    expect(g.downstream('NOPE')).toEqual([]);
  });
});
