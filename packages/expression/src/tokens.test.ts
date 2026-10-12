// tokens(): vị trí tên Tag, tên hàm, tên bảng (tô màu, gợi ý, đổi tên Tag; FR-047).
import { describe, expect, it } from 'vitest';
import { tokens } from './index.ts';

const kinds = (src: string) => tokens(src).map((t) => `${t.kind}:${t.text}`);

describe('tokens()', () => {
  it('classifies tags, functions, tables, numbers and operators', () => {
    expect(kinds('round(TANK01.LEVEL * 12.5, 1)')).toEqual([
      'function:round',
      'punctuation:(',
      'tag:TANK01.LEVEL',
      'operator:*',
      'number:12.5',
      'punctuation:,',
      'number:1',
      'punctuation:)',
    ]);
    expect(kinds('text(PUMP01.STATE, TrangThaiBom)')).toEqual([
      'function:text',
      'punctuation:(',
      'tag:PUMP01.STATE',
      'punctuation:,',
      'table:TrangThaiBom',
      'punctuation:)',
    ]);
  });
  it('a bare word after a comma is a table only inside text(...)', () => {
    expect(kinds('min(A, B)')).toContain('tag:B');
    expect(kinds('min(A, B)')).not.toContain('table:B');
    expect(kinds('text(A, T1)')).toContain('table:T1');
  });
  it('true and false are keywords; a dotted word is always a tag', () => {
    expect(kinds('true && x.false')).toEqual(['keyword:true', 'operator:&&', 'tag:x.false']);
  });
  it('strings keep their escapes in the source text', () => {
    expect(kinds('S == "a\\"b"')).toEqual(['tag:S', 'operator:==', 'string:"a\\"b"']);
  });
  it('spans are in Unicode characters', () => {
    const t = tokens('"😀" + Z');
    expect(t[0]!.span).toEqual([0, 3]);
    expect(t[2]).toMatchObject({ kind: 'tag', span: [6, 7] });
  });
  it('is tolerant: errors become error tokens and the rest is still classified', () => {
    const t = tokens('A @ B');
    expect(t.map((x) => x.kind)).toEqual(['tag', 'error', 'tag']);
    expect(tokens('"abc').map((x) => x.kind)).toEqual(['error']);
  });
  it('a lone parenthesis does not confuse the table rule', () => {
    expect(kinds('(A, B)').filter((k) => k.startsWith('table'))).toEqual([]);
    expect(kinds('text((A), T1)')).toContain('table:T1');
  });
  it('empty and whitespace-only input yield no tokens', () => {
    expect(tokens('')).toEqual([]);
    expect(tokens('   ')).toEqual([]);
  });
  it('a function name not in the six functions is still a function token (the checker reports it)', () => {
    expect(kinds('sqrt(A)')[0]).toBe('function:sqrt');
  });
});
