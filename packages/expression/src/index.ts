// @mat/expression: ngôn ngữ biểu thức của Tag tính toán và bảng giá trị (ADR-015).
// Cùng ngữ pháp, cùng ngữ nghĩa với core/expression (C++); bộ vector chung ở tests/expression-vectors.
// Không dùng eval hay Function (Constitution V).
import { MAX_CHARS, check, kindOfTag } from './checker.ts';
import { compileNode } from './compiler.ts';
import { messageOf } from './messages.ts';
import { utf8Length } from './number.ts';
import { parse } from './parser.ts';
import type { CompileEnv, CompileResult, ExprIssue } from './types.ts';

export * from './types.ts';
export { evaluate } from './vm.ts';
export { tokens } from './tokens.ts';
export { roundHalfAway, assignToTarget, utf8Length } from './number.ts';
export {
  lookupValueTable,
  validateValueTable,
  VT_MAX_ENTRIES,
  VT_MAX_TEXT,
} from './value-table.ts';
export type { VtIssue } from './value-table.ts';
export { buildCalcGraph, MAX_CHAIN_DEPTH } from './graph.ts';
export type { CalcGraph, CalcInput, GraphIssue } from './graph.ts';
export { MAX_CHARS, MAX_BYTES, MAX_INPUTS, MAX_STACK } from './checker.ts';

const issue = (code: string, span: [number, number]): ExprIssue => ({
  code,
  span,
  message: messageOf(code),
});

/**
 * Trần số ký tự được đem parse, cùng giá trị với bản C++ (`kMaxCharsParsed`, core/expression/expression.cpp): dài
 * hơn là E_EXPR_LIMIT ngay. Chặn độ sâu đệ quy của các lượt duyệt cây (chuỗi toán tử lệch trái thêm một mức mỗi
 * toán hạng); biểu thức thật còn xa mới tới ngưỡng này (giới hạn hợp lệ là 1.000 ký tự).
 */
export const MAX_CHARS_PARSED = 8192;

/** Biên dịch một biểu thức; trả lỗi đầu tiên (cú pháp, tên, số tham số, kiểu, giới hạn). */
export function compile(src: string, env: CompileEnv): CompileResult {
  const cps = Array.from(src);
  if (cps.length > MAX_CHARS_PARSED)
    return { ok: false, errors: [issue('E_EXPR_LIMIT', [MAX_CHARS, MAX_CHARS + 1])] };
  const parsed = parse(cps);
  if ('error' in parsed)
    return { ok: false, errors: [issue(parsed.error.code, parsed.error.span)] };
  const checked = check(
    parsed.root,
    parsed.limitIssue,
    { chars: cps.length, bytes: utf8Length(src) },
    env,
  );
  if (!checked.ok) return { ok: false, errors: [issue(checked.error.code, checked.error.span)] };
  const program = compileNode(parsed.root, checked.inputs, env.target, (id) => {
    const k = kindOfTag(env.tagType(id)!);
    return k === 'number' ? 0 : k === 'bool' ? 1 : 2;
  });
  return {
    ok: true,
    program,
    inputs: checked.inputs,
    warnings: checked.warnings.map((c) => issue(c, [0, cps.length])),
  };
}
