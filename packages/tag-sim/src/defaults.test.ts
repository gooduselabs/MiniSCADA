// Mặc định cho Tag ngoài chưa có `sim` (contract §2.3) và các cam kết của mã nguồn (không Math.sin/random).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSim, fnv1a32, simValue } from './index.ts';

describe('defaultSim (FR-052)', () => {
  it('numeric tags: random over min..max, 2000 ms, seed = FNV-1a 32 of the id', () => {
    expect(defaultSim({ id: 'TANK01.LEVEL', type: 'FLOAT32', min: 0, max: 50 })).toEqual({
      kind: 'random',
      min: 0,
      max: 50,
      periodMs: 2000,
      seed: fnv1a32('TANK01.LEVEL'),
    });
  });
  it('numeric tags without a range use 0..100; a reversed range too', () => {
    expect(defaultSim({ id: 'A', type: 'INT16' })).toMatchObject({ min: 0, max: 100 });
    expect(defaultSim({ id: 'A', type: 'INT16', min: 5 })).toMatchObject({ min: 0, max: 100 });
    expect(defaultSim({ id: 'A', type: 'INT16', min: 10, max: 10 })).toMatchObject({
      min: 0,
      max: 100,
    });
  });
  it('BOOL: square 10000 ms duty 0.5', () => {
    expect(defaultSim({ id: 'B', type: 'BOOL' })).toEqual({
      kind: 'square',
      periodMs: 10000,
      duty: 0.5,
    });
  });
  it('STRING: const empty string', () => {
    expect(defaultSim({ id: 'S', type: 'STRING' })).toEqual({ kind: 'const', value: '' });
  });
  it('the default output of a numeric tag stays inside its range', () => {
    const sim = defaultSim({ id: 'X', type: 'FLOAT64', min: -10, max: 10 });
    for (let t = 0; t < 100000; t += 2000) {
      const v = simValue(sim, t, 'FLOAT64') as number;
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThan(10);
    }
  });
});

describe('fnv1a32', () => {
  it('known vectors of FNV-1a 32 bit', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
  it('hashes UTF-8 bytes', () => {
    expect(fnv1a32('Bơm')).not.toBe(fnv1a32('Bom'));
  });
});

describe('source rules', () => {
  const dir = resolve(__dirname);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  it('sinTurns and U do not call Math.sin or Math.random', () => {
    for (const f of ['sin-turns.ts', 'hash.ts', 'generators.ts']) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(/Math\.sin\s*\(/.test(text), `${f} Math.sin`).toBe(false);
      expect(/Math\.random\s*\(/.test(text), `${f} Math.random`).toBe(false);
    }
  });
  it('no source uses eval or new Function', () => {
    for (const f of sources) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(/\beval\s*\(/.test(text) || /new\s+Function\b/.test(text), f).toBe(false);
    }
  });
});
