// Nguồn giá trị của canvas ở chế độ chỉnh sửa khi có thanh Thử giá trị (feature 008, T073; contract studio-svg-editor §7).
// Mặc định canvas chỉnh sửa chỉ có thông tin Tag (đơn vị, bảng giá trị), không có giá trị. Khi người dùng đặt giá trị thử cho
// một Tag thì Tag đó (và chỉ Tag đó) lấy giá trị từ `SimEngine`; mọi Tag khác vẫn không có giá trị. Không bao giờ chạm thiết bị.
import type { ValueTable } from '@mat/expression';
import type { TagInfo, TagSource, TagState } from '@mat/ui-components';
import type { SimEngine } from './sim-engine.ts';

export interface EditTestDeps {
  /** Nguồn thông tin Tag của chế độ chỉnh sửa (dựng lại khi danh sách Tag đổi). */
  base: () => TagSource;
  engine: SimEngine;
  /** Tag đang bị đặt giá trị thử. */
  active: () => readonly string[];
  tables: () => readonly ValueTable[];
  clock?: () => number;
}

export class EditTestSource implements TagSource {
  readonly connection = 'live' as const;
  private readonly deps: EditTestDeps;
  /** Tag đã trả giá trị thử và chưa báo lại sau khi hết thử (để canvas trở về trạng thái không có giá trị). */
  private readonly shown = new Set<string>();

  constructor(deps: EditTestDeps) {
    this.deps = deps;
  }

  info(id: string): TagInfo | undefined {
    return this.deps.base().info(id);
  }

  get(id: string): TagState {
    if (!this.deps.active().includes(id)) return this.deps.base().get(id);
    this.shown.add(id);
    const e = this.deps.engine.get(id);
    return e
      ? {
          value: e.value as TagState['value'],
          quality: e.quality,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
          updatedAt: e.ts,
        }
      : { value: null, quality: 'UNKNOWN' };
  }

  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void {
    const want = new Set(ids);
    return this.deps.engine.subscribe((changes) => {
      const active = this.deps.active();
      const hit: string[] = [];
      for (const c of changes) {
        if (!want.has(c.id)) continue;
        if (active.includes(c.id) || this.shown.delete(c.id)) hit.push(c.id);
      }
      if (hit.length > 0) onChange(hit);
    });
  }

  now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  valueTable(name: string): ValueTable | undefined {
    return this.deps.tables().find((t) => (t as { name?: string }).name === name);
  }
}
