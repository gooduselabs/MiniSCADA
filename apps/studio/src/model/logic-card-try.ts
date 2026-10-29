// "Thử luật" ngay trên thẻ (feature 043): chạy MỘT luật bằng bộ chạy Thử logic có sẵn (LogicSim = @mat/logic-engine bản TS,
// cùng vector với core/logic) với giá trị giả cho Tag điều kiện và giờ giả lập. Cách làm: điều kiện của luật được AND với một
// Tag cổng giả (`MAT_TRY.GATE`), quét đầu cổng tắt (trạng thái ổn định = sai), rồi bật cổng và quét đủ thời gian giữ: luật
// kích hoạt đúng như trên thiết bị khi điều kiện chuyển từ sai sang đúng. Không bao giờ ghi ra thiết bị.
import type { ActionOut } from '@mat/logic-engine';
import type { LogicDoc, TagV1 } from '@mat/project-schema';
import { LogicSim } from './logic-sim.ts';
import { wallFor } from './logic-cards.ts';

export const TRY_GATE = 'MAT_TRY.GATE';

export interface TryInput {
  /** Giá trị giả theo Tag (Tag không nhập thì lấy bộ mô phỏng). */
  values: Record<string, boolean | number | string>;
  /** Thứ 1 (T2) … 7 (CN). */
  day: number;
  /** Giờ địa phương HH:MM. */
  time: string;
}

export interface TryResult {
  /** Luật kích hoạt (cạnh lên) sau thời gian giữ. */
  fired: boolean;
  /** Hành động engine trả về (ghi, đặt Tag, bị chặn…). */
  actions: ActionOut[];
  /** Thời gian đã giả lập (ms). */
  ranMs: number;
  /** Logic còn lỗi nên không chạy được. */
  error: string | null;
}

export function tryRule(
  doc: LogicDoc,
  ruleId: string,
  tags: readonly TagV1[],
  input: TryInput,
): TryResult {
  const rule = (doc.rules ?? []).find((r) => r.id === ruleId);
  if (!rule) return { fired: false, actions: [], ranMs: 0, error: 'no rule' };
  const test: LogicDoc = {
    ...doc,
    rules: [
      {
        ...rule,
        enabled: true,
        when: `(${rule.when || 'false'}) && ${TRY_GATE}`,
        fireOnStart: false,
      },
    ],
  };
  const gate = {
    id: TRY_GATE,
    kind: 'internal',
    type: 'BOOL',
    access: 'RW',
    initial: false,
  } as TagV1;
  const sim = new LogicSim({ doc: test, tags: [...tags, gate] });
  if (sim.error) return { fired: false, actions: [], ranMs: 0, error: sim.error };
  for (const [tag, value] of Object.entries(input.values))
    sim.setManual(tag, { value, quality: 'GOOD' });
  sim.jumpWall(wallFor(input.day, input.time, sim.config.tzOffsetMin));
  sim.setManual(TRY_GATE, { value: false, quality: 'GOOD' });
  sim.step();
  sim.setManual(TRY_GATE, { value: true, quality: 'GOOD' });
  const hold = rule.hold ?? 0;
  const scans = Math.ceil(hold / sim.scanMs) + 2;
  const actions: ActionOut[] = [];
  let fired = false;
  for (let i = 0; i < scans && !fired; i++)
    for (const a of sim.step())
      if (a.rule === ruleId) {
        if (a.edge === 'rise') fired = true;
        actions.push(a);
      }
  return { fired, actions, ranMs: sim.t, error: null };
}
