// Hồi quy từ fuzz phía TS (feature 011, T058; FR-029; tools/fuzz/targets/expression.mjs). Mỗi ca là đầu vào đã rút gọn.
import { describe, expect, it } from 'vitest';
import { compile, type CompileEnv, type TagDataType } from './index.ts';

const tags: Record<string, TagDataType> = { A: 'FLOAT64', T: 'BOOL' };
const env = (target: TagDataType): CompileEnv => ({
  target,
  tagType: (id) => tags[id],
  hasTable: () => false,
});

describe('fuzz expression: chuỗi toán tử rất dài (cây lệch trái sâu)', () => {
  // Phát hiện: seed 20261017 ca 21568, `T&&T&&…&&T` 25.922 ký tự: compile ném RangeError (tràn ngăn xếp ở preorder
  // đệ quy của checker) hoặc chạy ~3 giây (yield* lồng nhau là O(n²)). Bản C++ chặn ở 8.192 ký tự trước khi parse.
  it('25.922 ký tự `T&&T…`: E_EXPR_LIMIT ở ký tự 1.001, không ném, nhanh', () => {
    const src = 'T&&'.repeat(8640) + 'TT';
    const t0 = performance.now();
    const r = compile(src, env('BOOL'));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect([r.errors[0]!.code, r.errors[0]!.span]).toEqual(['E_EXPR_LIMIT', [1000, 1001]]);
  });

  it('99.999 ký tự `A+A+…`: E_EXPR_LIMIT, không ném', () => {
    const src = 'A+'.repeat(49999) + 'A';
    const r = compile(src, env('FLOAT64'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.code).toBe('E_EXPR_LIMIT');
  });

  it('cùng ngưỡng 8.192 ký tự với bản C++: 8.193 ký tự là E_EXPR_LIMIT dù có Tag lạ', () => {
    const src = 'Q+' + 'A+'.repeat(4095) + 'A';
    expect(Array.from(src).length).toBe(8193);
    const r = compile(src, env('FLOAT64'));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect([r.errors[0]!.code, r.errors[0]!.span]).toEqual(['E_EXPR_LIMIT', [1000, 1001]]);
  });

  it('8.192 ký tự vẫn qua parse và kiểm tên trước giới hạn (lỗi tên đứng trước)', () => {
    const src = 'Q+' + 'A+'.repeat(4094) + 'AA';
    expect(Array.from(src).length).toBe(8192);
    const t0 = performance.now();
    const r = compile(src, env('FLOAT64'));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect([r.errors[0]!.code, r.errors[0]!.span]).toEqual(['E_EXPR_UNKNOWN_TAG', [0, 1]]);
  });
});
