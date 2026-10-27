// Mẫu có sẵn của lệnh "Thêm báo cáo" (feature 015, FR-007): ca, ngày, tháng, năng lượng, alarm, vận hành thiết bị, ghi PLC
// của logic. Hàm thuần: dựng một ReportTemplate từ nhóm lưu trữ có tổng hợp và kiểu Tag của project (chọn Tag hợp lý, kỹ sư
// chỉnh tiếp ở trình thiết kế). Mẫu cần định dạng 1.1 (loại báo cáo, onTime) bị khóa ở project cũ.
import type {
  LoggingConfig,
  ReportColumn,
  ReportKind,
  ReportTemplate,
  TagDataType,
} from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { eligibleGroups, eligibleTags } from './reports-doc.ts';

export type PresetId =
  'shift' | 'day' | 'month' | 'energy' | 'energyMonth' | 'alarm' | 'equipment' | 'logic';

export interface ReportPreset {
  id: PresetId;
  kind: ReportKind;
  /** Cần định dạng 1.1. */
  needs11: boolean;
  icon: IconName;
}

export const REPORT_PRESETS: readonly ReportPreset[] = [
  { id: 'shift', kind: 'table', needs11: false, icon: 'timer' },
  { id: 'day', kind: 'table', needs11: false, icon: 'report' },
  { id: 'month', kind: 'table', needs11: false, icon: 'cal' },
  { id: 'energy', kind: 'table', needs11: false, icon: 'bar' },
  // Feature 029: điện năng theo tháng (mỗi hàng một ngày, hiệu số, tổng, biểu đồ cột)
  { id: 'energyMonth', kind: 'table', needs11: false, icon: 'bar' },
  { id: 'alarm', kind: 'alarm', needs11: true, icon: 'bell' },
  { id: 'equipment', kind: 'equipment', needs11: true, icon: 'pump' },
  { id: 'logic', kind: 'logic', needs11: true, icon: 'logic' },
];

export interface PresetContext {
  logging: LoggingConfig | null;
  types: ReadonlyMap<string, TagDataType> | null;
  /** Đơn vị và mô tả Tag (chọn Tag năng lượng theo đơn vị). */
  info: (tagId: string) => { unit?: string; description?: string } | undefined;
  format11: boolean;
}

const NAME: Record<PresetId, MessageKey> = {
  shift: 'rpt.preset.nameShift',
  day: 'rpt.preset.nameDay',
  month: 'rpt.preset.nameMonth',
  energy: 'rpt.preset.nameEnergy',
  energyMonth: 'rpt.preset.nameEnergyMonth',
  alarm: 'rpt.preset.nameAlarm',
  equipment: 'rpt.preset.nameEquipment',
  logic: 'rpt.preset.nameLogic',
};
const ID: Record<PresetId, string> = {
  shift: 'bao-cao-ca',
  day: 'bao-cao-ngay',
  month: 'bao-cao-thang',
  energy: 'nang-luong-ngay',
  energyMonth: 'dien-nang-thang',
  alarm: 'alarm-ngay',
  equipment: 'van-hanh-thiet-bi',
  logic: 'logic-ngay',
};

const ENERGY = /^(k|M)?Wh$/;
const POWER = /^(k|M)?W$/;

/** Nhóm và Tag dùng được (nhóm có tổng hợp đầu tiên có Tag hợp với mẫu). */
function pick(
  ctx: PresetContext,
  want: (id: string) => boolean,
): { group: string; tags: string[] } | null {
  for (const g of eligibleGroups(ctx.logging)) {
    const tags = eligibleTags(ctx.logging, g.id, ctx.types).filter(want);
    if (tags.length > 0) return { group: g.id, tags };
  }
  return null;
}

/** Lý do mẫu chưa dùng được (null: dùng được). */
export function presetBlocked(p: ReportPreset, ctx: PresetContext): string | null {
  if (p.needs11 && !ctx.format11) return t('rpt.ds.need11');
  if (p.kind === 'alarm' || p.kind === 'logic') return null;
  const bool = (id: string) => ctx.types?.get(id) === 'BOOL';
  if (p.kind === 'equipment') return pick(ctx, bool) ? null : t('rpt.preset.needBool');
  return pick(ctx, () => true) ? null : t('rpt.preset.needGroup');
}

const col = (
  tagId: string,
  ctx: PresetContext,
  functions: ReportColumn['functions'],
): ReportColumn => {
  const i = ctx.info(tagId);
  const c: ReportColumn = { tagId, functions };
  if (i?.description) c.label = i.description;
  if (i?.unit) c.unit = i.unit;
  c.decimals = 1;
  return c;
};

/** Mẫu dựng sẵn; null khi chưa dùng được (presetBlocked). */
export function presetTemplate(id: PresetId, ctx: PresetContext): ReportTemplate | null {
  const p = REPORT_PRESETS.find((x) => x.id === id)!;
  if (presetBlocked(p, ctx)) return null;
  const base = { id: ID[id], name: t(NAME[id]), title: t(NAME[id]).toUpperCase() };
  const numeric = (x: string) => ctx.types?.get(x) !== 'BOOL';
  switch (id) {
    case 'alarm':
      return { ...base, kind: 'alarm', period: 'day' };
    case 'logic':
      return { ...base, kind: 'logic', period: 'day' };
    case 'equipment': {
      const g = pick(ctx, (x) => ctx.types?.get(x) === 'BOOL')!;
      return {
        ...base,
        kind: 'equipment',
        group: g.group,
        period: 'shift',
        shifts: { count: 3, start: '06:00' },
        totals: true,
        columns: g.tags.slice(0, 6).map((tagId) => ({
          ...col(tagId, ctx, ['onTime', 'starts']),
          unit: t('rpt.unit.hour'),
          decimals: 2,
        })),
      };
    }
    case 'energy':
    case 'energyMonth': {
      const g = pick(ctx, numeric)!;
      const energy = g.tags.filter((x) => ENERGY.test(ctx.info(x)?.unit ?? ''));
      const power = g.tags.filter((x) => POWER.test(ctx.info(x)?.unit ?? ''));
      const columns: ReportColumn[] = [
        ...(energy.length ? energy : g.tags.slice(0, 1))
          .slice(0, 3)
          .map((x) => col(x, ctx, ['delta'])),
        ...power.slice(0, 3).map((x) => col(x, ctx, ['avg', 'max'])),
      ];
      return {
        ...base,
        group: g.group,
        ...(id === 'energyMonth'
          ? { period: 'month' as const }
          : { period: 'day' as const, rowMinutes: 60 as const }),
        totals: true,
        ...(ctx.format11 ? { chart: 'bar' as const } : {}),
        columns,
      };
    }
    default: {
      const g = pick(ctx, numeric) ?? pick(ctx, () => true)!;
      const columns = g.tags.slice(0, 3).map((x) => col(x, ctx, ['avg', 'max']));
      const period =
        id === 'shift'
          ? { period: 'shift' as const, shifts: { count: 3, start: '06:00' } }
          : id === 'day'
            ? { period: 'day' as const, rowMinutes: 60 as const }
            : { period: 'month' as const };
      return { ...base, group: g.group, ...period, totals: true, columns };
    }
  }
}
