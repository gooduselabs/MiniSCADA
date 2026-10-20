// `parseExpression` (feature 015, T002): cây cú pháp của parser sẵn có cho sơ đồ khối của Studio (cổng AND/OR/NOT/so sánh
// suy ra từ biểu thức). Chỉ xuất cây, không đổi ngữ nghĩa; lỗi cú pháp trả mã và vị trí như compile().
import { describe, expect, it } from 'vitest';
import { parseExpression } from './index.ts';

describe('parseExpression', () => {
  it('cây của && với so sánh và Tag, vị trí theo ký tự', () => {
    const r = parseExpression('TANK01.LEVEL < 20 && LOGIC.DAY.Q');
    expect('root' in r).toBe(true);
    if (!('root' in r)) return;
    expect(r.root.t).toBe('bin');
    if (r.root.t !== 'bin') return;
    expect(r.root.op).toBe('&&');
    expect(r.root.l.t).toBe('bin');
    expect(r.root.r).toMatchObject({ t: 'tag', id: 'LOGIC.DAY.Q', s: 21, e: 32 });
  });

  it('lỗi cú pháp: mã E_EXPR_SYNTAX và vị trí', () => {
    const r = parseExpression('A &&');
    expect(r).toEqual({ error: { code: 'E_EXPR_SYNTAX', span: [4, 4] } });
  });

  it('chuỗi quá dài: E_EXPR_LIMIT, không parse', () => {
    const r = parseExpression('A || '.repeat(3000) + 'A');
    expect('error' in r && r.error.code).toBe('E_EXPR_LIMIT');
  });
});
