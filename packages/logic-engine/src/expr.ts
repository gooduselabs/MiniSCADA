// Biểu thức của logic: ADR-015 qua @mat/expression (cùng bộ vector với core/expression, không eval). Kết quả không
// GOOD là "unknown" (contract §2.1) với lý do: TIME_NOT_SYNCED nếu một đầu vào là đầu ra lịch chưa đồng bộ giờ,
// INPUT_BAD nếu một đầu vào không GOOD hoặc chưa có giá trị, còn lại EXPR_ERROR (chia 0, tràn, kẹp sai…).
import {
  compile,
  evaluate,
  type InputValue,
  type Program,
  type TableSet,
  type TagDataType,
} from '@mat/expression';
import type { LogicEnv } from '@mat/project-schema';
import type { ReadTag } from './types.ts';

export type Unknown = 'INPUT_BAD' | 'EXPR_ERROR' | 'TIME_NOT_SYNCED';
export type ExprResult =
  { ok: true; value: boolean | number | bigint | string } | { ok: false; reason: Unknown };

export class Expr {
  readonly program: Program;
  readonly src: string;
  constructor(src: string, target: TagDataType, env: LogicEnv, where: string) {
    const r = compile(src, { ...env, target });
    if (!r.ok)
      throw new Error(`logic: ${where}: biểu thức '${src}' không hợp lệ (${r.errors[0]!.code})`);
    this.program = r.program;
    this.src = src;
  }

  get inputs(): readonly string[] {
    return this.program.inputs;
  }

  eval(read: ReadTag, tables: TableSet): ExprResult {
    const vals: InputValue[] = this.program.inputs.map((id) => read(id));
    const r = evaluate(this.program, (i) => vals[i]!, tables);
    if (r.quality === 'GOOD' && r.value !== undefined) return { ok: true, value: r.value };
    if (vals.some((v) => v.quality === 'BAD' && v.reason === 'TIME_NOT_SYNCED'))
      return { ok: false, reason: 'TIME_NOT_SYNCED' };
    if (vals.some((v) => v.quality !== 'GOOD' || v.value === null))
      return { ok: false, reason: 'INPUT_BAD' };
    return { ok: false, reason: 'EXPR_ERROR' };
  }
}

/** Đánh giá BOOL; `undefined` khi unknown. */
export function evalBool(e: Expr, read: ReadTag, tables: TableSet): boolean | undefined {
  const r = e.eval(read, tables);
  return r.ok ? r.value === true : undefined;
}
