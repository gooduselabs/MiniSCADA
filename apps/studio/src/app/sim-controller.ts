// Điều phối Mô phỏng của StudioApp (feature 006, T204, FR-052): giữ một `SimEngine` dùng chung (Bảng Tag, Bảng theo dõi, xem
// trước biểu thức, xem trước màn hình), nạp lại khi Tag hay bảng giá trị đổi, chạy khi có ít nhất một bên cần (bật Mô phỏng
// của thanh công cụ, hoặc xem trước màn hình đang ở chế độ Mô phỏng). Không DOM, không mạng, không DeviceLink.
import type { ValueTable } from '@mat/expression';
import type { TagDefinition, TagV1 } from '@mat/project-schema';
import {
  SimEngine,
  simSnapshot,
  type SimEngineOptions,
  type SimEntry,
} from '../model/sim-engine.ts';
import type { ProjectOutline } from '../model/project-doc.ts';

export const GLOBAL_LEASE = 'global';

export interface SimControllerDeps {
  options?: SimEngineOptions;
  /** Giá trị của các Tag này đổi. */
  onValues(ids: readonly string[]): void;
  /** Bật, tắt hoặc nạp lại: giao diện vẽ lại. */
  onChange(): void;
}

export class SimController {
  readonly engine: SimEngine;
  private readonly deps: SimControllerDeps;
  private readonly leases = new Set<string>();
  private loaded: { tags: unknown; tables: readonly unknown[] } | null = null;

  constructor(deps: SimControllerDeps) {
    this.deps = deps;
    this.engine = new SimEngine(deps.options);
    this.engine.subscribe((changes) => deps.onValues(changes.map((c) => c.id)));
  }

  /** Mô phỏng toàn cục đang bật (thanh công cụ, dấu MÔ PHỎNG): khác với việc engine chạy cho xem trước. */
  get simulating(): boolean {
    return this.leases.has(GLOBAL_LEASE);
  }

  get running(): boolean {
    return this.engine.running;
  }

  /** Bật hoặc tắt một bên cần engine; engine chạy khi còn ít nhất một bên. */
  lease(owner: string, on: boolean): void {
    const had = this.leases.has(owner);
    if (on === had) return;
    if (on) this.leases.add(owner);
    else this.leases.delete(owner);
    if (this.leases.size > 0 && !this.engine.running) this.engine.start();
    else if (this.leases.size === 0 && this.engine.running) this.engine.stop();
    this.deps.onChange();
  }

  setGlobal(on: boolean): void {
    this.lease(GLOBAL_LEASE, on);
  }

  /** Tắt hết (đóng project). */
  stopAll(): void {
    if (this.leases.size === 0 && !this.engine.running) return;
    this.leases.clear();
    this.engine.stop();
    this.loaded = null;
    this.deps.onChange();
  }

  /** Nạp lại engine khi Tag hay bảng giá trị của project đổi (so theo đối tượng). */
  sync(outline: Pick<ProjectOutline, 'tags' | 'valueTables'>): void {
    const tables = outline.valueTables.map((v) => v.doc);
    const same =
      this.loaded !== null &&
      this.loaded.tags === outline.tags &&
      this.loaded.tables.length === tables.length &&
      this.loaded.tables.every((d, i) => d === tables[i]);
    if (same) return;
    this.loaded = { tags: outline.tags, tables };
    this.engine.load(
      (outline.tags?.tags ?? []) as unknown as (TagV1 | TagDefinition)[],
      tables.filter((d): d is NonNullable<typeof d> => d !== null) as unknown as ValueTable[],
    );
  }

  read(id: string): SimEntry | undefined {
    return this.engine.get(id);
  }

  /** Giá trị mô phỏng tại thời điểm `now` khi engine không chạy (xem trước biểu thức khi chưa bật Mô phỏng). */
  snapshot(
    outline: Pick<ProjectOutline, 'tags' | 'valueTables'>,
    now: number,
  ): ReadonlyMap<string, SimEntry> {
    return simSnapshot(
      (outline.tags?.tags ?? []) as unknown as (TagV1 | TagDefinition)[],
      outline.valueTables.flatMap((v) => (v.doc ? [v.doc as unknown as ValueTable] : [])),
      now,
    );
  }
}
