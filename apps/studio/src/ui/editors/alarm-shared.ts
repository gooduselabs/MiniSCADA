// Phần dùng chung của các editor alarm (feature 009): chữ trạng thái sống, nhãn mức ưu tiên và biểu tượng, token màu của lớp.
import type { AlarmColor, AlarmPriority } from '@mat/project-schema';
import { t, type MessageKey } from '../../i18n/index.ts';

/** Chữ của trạng thái instance: trạng thái ISA, tạm ẩn hoặc vô hiệu. */
export const stateLabelOf = (key: string): string => t(`alarm.live.state.${key}` as MessageKey);

/** Màu CSS của token màu lớp alarm (token theme của gói ui-components: `--mat-alarm-<màu>`); dự phòng khi thiếu token. */
export const COLOR_VAR: Readonly<Record<AlarmColor, string>> = {
  red: 'var(--mat-alarm-red, var(--err))',
  orange: 'var(--mat-alarm-orange, var(--online))',
  amber: 'var(--mat-alarm-amber, var(--warn))',
  blue: 'var(--mat-alarm-blue, var(--info))',
  purple: 'var(--mat-alarm-purple, var(--sim))',
  teal: 'var(--mat-alarm-teal, var(--accent))',
  gray: 'var(--mat-alarm-gray, var(--off))',
  green: 'var(--mat-alarm-green, var(--ok))',
};

export const PRIORITY_NUM: Readonly<Record<AlarmPriority, number>> = {
  critical: 1,
  major: 2,
  minor: 3,
  advisory: 4,
};
