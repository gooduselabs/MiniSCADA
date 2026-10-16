// Nhóm lưu trữ cho nguồn lịch sử mô phỏng (feature 010, US8): dựng `SimHistoryGroup` từ logging.json và danh sách Tag của project để
// xem trước báo cáo và widget lịch sử trong Studio mà chưa cần thiết bị. Mỗi Tag dùng bộ sinh `sim` của chính nó (hoặc bộ sinh mặc
// định theo kiểu, như Mô phỏng của Studio), nên số liệu cùng dạng với số Tag chạy mô phỏng.
import type { LoggingConfig, TagList } from '@mat/project-schema';
import { defaultSim, type SimConfig, type SimHistoryGroup, type TagDataType } from '@mat/tag-sim';

interface TagLike {
  id?: unknown;
  type?: unknown;
  unit?: unknown;
  min?: unknown;
  max?: unknown;
  sim?: unknown;
}

export function simHistoryGroups(
  logging: LoggingConfig | null | undefined,
  tags: TagList | { tags: readonly unknown[] } | null | undefined,
): SimHistoryGroup[] {
  const byId = new Map<string, TagLike>();
  for (const t of (tags?.tags ?? []) as TagLike[]) if (typeof t.id === 'string') byId.set(t.id, t);
  return (logging?.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    mode: g.mode === 'cyclic' ? 'cyclic' : g.mode === 'trigger' ? 'trigger' : 'onChange',
    timeZone: logging?.timeZone ?? '+07:00',
    ...(g.periodMs !== undefined ? { periodMs: g.periodMs } : {}),
    ...(g.minIntervalMs !== undefined ? { minIntervalMs: g.minIntervalMs } : {}),
    ...(g.maxIntervalMs !== undefined ? { maxIntervalMs: g.maxIntervalMs } : {}),
    aggregates: g.aggregates !== undefined,
    tags: g.tags.map((lt) => {
      const t = byId.get(lt.tagId);
      const type = (typeof t?.type === 'string' ? t.type : 'FLOAT32') as TagDataType;
      const sim: SimConfig =
        t && typeof t.sim === 'object' && t.sim !== null
          ? (t.sim as SimConfig)
          : defaultSim({
              id: lt.tagId,
              type,
              ...(typeof t?.min === 'number' ? { min: t.min } : {}),
              ...(typeof t?.max === 'number' ? { max: t.max } : {}),
            });
      return {
        tagId: lt.tagId,
        type,
        ...(typeof t?.unit === 'string' ? { unit: t.unit } : {}),
        sim,
        ...(lt.aggregate === false ? { aggregate: false } : {}),
      };
    }),
  }));
}

/** Mô tả và đơn vị của Tag cho tiêu đề cột báo cáo (`tagInfo` của `buildReport`). */
export function tagInfoOf(
  tags: TagList | { tags: readonly unknown[] } | null | undefined,
): (id: string) => { description?: string; unit?: string } | undefined {
  const byId = new Map<string, { description?: string; unit?: string }>();
  for (const t of (tags?.tags ?? []) as Array<TagLike & { description?: unknown }>) {
    if (typeof t.id !== 'string') continue;
    byId.set(t.id, {
      ...(typeof t.description === 'string' && t.description ? { description: t.description } : {}),
      ...(typeof t.unit === 'string' && t.unit ? { unit: t.unit } : {}),
    });
  }
  return (id) => byId.get(id);
}
