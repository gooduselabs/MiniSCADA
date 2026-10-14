// Nguồn alarm cho xem trước màn hình ở chế độ Mô phỏng (feature 009, T107, FR-081): một AlarmSim của project hiện tại chạy
// theo thời gian thật (mỗi 250 ms một tick ảo) cho widget `alarm-list`, `alarm-count`; ack và tạm ẩn thử qua ActionHost.
// Chế độ Thiết bị dùng nguồn sống chỉ đọc (alarm-live.ts). Không DOM.
import type { Issue, TagDefinition, TagV1 } from '@mat/project-schema';
import type { ActionHost, AlarmSource } from '@mat/ui-components';
import type { ValueTable } from '@mat/expression';
import { ALARM_SIM_TICK_MS, AlarmSim } from './alarm-sim.ts';
import { alarmDocOf, issueCell, type AlarmDoc } from './alarm-doc.ts';
import type { ProjectOutline } from './project-doc.ts';

/** Id các alarm có lỗi (E_) trong file alarm: bị bỏ qua khi thử hoặc xem trước, phần hợp lệ vẫn chạy (Edge Cases). */
export function invalidAlarmIds(
  issues: readonly Pick<Issue, 'code' | 'file' | 'path'>[],
  alarmFile: string | null,
  doc: AlarmDoc,
): Array<{ id: string; code: string; row: number }> {
  const out = new Map<number, { id: string; code: string; row: number }>();
  if (alarmFile === null) return [];
  for (const i of issues) {
    if (i.file !== alarmFile || !i.code.startsWith('E_')) continue;
    const tg = issueCell(i);
    if (tg.kind !== 'cell' && tg.kind !== 'row') continue;
    const def = doc.alarms[tg.row];
    if (!def || out.has(tg.row)) continue;
    out.set(tg.row, {
      id: String((def as unknown as { id: unknown }).id),
      code: i.code,
      row: tg.row,
    });
  }
  return [...out.values()].sort((a, b) => a.row - b.row);
}

export interface AlarmPreview {
  source: AlarmSource;
  actions: Pick<ActionHost, 'ackAlarms' | 'shelveAlarm' | 'unshelveAlarm'>;
  sim: AlarmSim;
  stop(): void;
}

export interface AlarmPreviewTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

const real: AlarmPreviewTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** `null` khi project không có alarm hoặc không dựng được động cơ (lỗi cấu trúc): widget báo "Không có dữ liệu alarm". */
export function createAlarmPreview(
  outline: ProjectOutline,
  issues: readonly Issue[],
  tables: readonly ValueTable[],
  timers: AlarmPreviewTimers = real,
): AlarmPreview | null {
  if (!outline.alarms || outline.alarms.alarms.length === 0) return null;
  const doc = alarmDocOf({ alarms: outline.alarms, alarmClasses: outline.alarmClasses });
  const skip = invalidAlarmIds(issues, outline.alarmFile, doc).map((x) => x.id);
  try {
    const sim = new AlarmSim({
      project: { alarms: doc.alarms, classes: doc.classes, areas: doc.areas },
      tags: (outline.tags?.tags ?? []) as unknown as (TagV1 | TagDefinition)[],
      tables,
      skip,
    });
    sim.run(1);
    const handle = timers.setInterval(
      () => sim.advanceRealMs(ALARM_SIM_TICK_MS),
      ALARM_SIM_TICK_MS,
    );
    return {
      source: sim.source(),
      actions: sim.alarmActions(),
      sim,
      stop: () => timers.clearInterval(handle),
    };
  } catch {
    return null;
  }
}
