// Kiểm gắn Tag cho khe của widget lịch sử (feature 010, US8, contracts/widget-catalog-010.md §1): khe có cờ `inGroup` chỉ nhận Tag của
// nhóm lưu trữ đặt ở thuộc tính tương ứng (`E_WIDGET_HISTORY_TAG`); cờ `needsAggregate` đòi nhóm bật Tổng hợp và Tag có tổng hợp
// (`E_WIDGET_HISTORY_AGG`). Studio báo NGAY khi thả Tag sai thay vì chờ bộ kiểm tra. Hàm thuần.
import type { LoggingConfig, SlotSpec, TagDataType } from '@mat/project-schema';

export type GroupBindReason = 'no-group' | 'group-gone' | 'not-in-group' | 'no-aggregate';

export function groupBindCheck(
  slot: Pick<SlotSpec, 'inGroup' | 'needsAggregate'>,
  props: Readonly<Record<string, unknown>> | undefined,
  tagId: string,
  logging: LoggingConfig | null | undefined,
  types: ReadonlyMap<string, TagDataType> | null,
): GroupBindReason | null {
  if (slot.inGroup === undefined) return null;
  const gid = props?.[slot.inGroup];
  if (typeof gid !== 'string' || gid === '') return 'no-group';
  const g = logging?.groups.find((x) => x.id === gid);
  if (!g) return 'group-gone';
  const lt = g.tags.find((x) => x.tagId === tagId);
  if (!lt) return 'not-in-group';
  if (slot.needsAggregate === true) {
    if (g.aggregates === undefined || lt.aggregate === false || types?.get(tagId) === 'STRING')
      return 'no-aggregate';
  }
  return null;
}
