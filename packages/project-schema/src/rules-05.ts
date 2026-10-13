// Luật liên file của bộ kiểm tra 0.5 (contracts/project-format-0.5.md §5, §6): luật 0.3 (Tag, kết nối, bảng,
// logging, màn hình, menu) với phiên bản 0.5 và runtime tối thiểu 0.8.0, cộng luật của hai file alarm.
import { runAlarmRules } from './alarm-rules.ts';
import type { Issue } from './codes.ts';
import { runRules03, type Rule03Input } from './rules-03.ts';
import type { Project05 } from './types-05.ts';

export interface Rule05Input extends Omit<Rule03Input, 'project' | 'schema'> {
  project: Project05;
  /** JSON đã parse của `alarmFile`, `alarmClassFile`; `undefined` khi không khai hoặc không đọc được. */
  alarmsDoc?: unknown;
  alarmClassesDoc?: unknown;
  /** Số byte của file alarm (trần 512 KiB). */
  alarmsBytes?: number;
}

export function runRules05(input: Rule05Input): { errors: Issue[]; warnings: Issue[] } {
  const { alarmsDoc, alarmClassesDoc, alarmsBytes, ...rest } = input;
  const base = runRules03({ ...rest, schema: '0.5' } as Rule03Input);
  const { project } = input;
  const a = runAlarmRules({
    ...(project.alarmFile !== undefined ? { alarmFile: project.alarmFile } : {}),
    ...(project.alarmClassFile !== undefined ? { alarmClassFile: project.alarmClassFile } : {}),
    schemaVersion: project.schemaVersion,
    alarmsDoc,
    alarmClassesDoc,
    ...(alarmsBytes !== undefined ? { alarmsBytes } : {}),
    ...(input.tags ? { tags: input.tags.tags } : {}),
    ...(input.connections ? { connections: input.connections } : {}),
    connectionsFailed: project.connectionFile !== undefined && input.connections === undefined,
  });
  return {
    errors: [...base.errors, ...a.errors],
    warnings: [...base.warnings, ...a.warnings],
  };
}
