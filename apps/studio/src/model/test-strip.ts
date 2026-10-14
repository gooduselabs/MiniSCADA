// Thanh Thử giá trị (feature 008, T073 phần model; D28; contract studio-svg-editor §7). Đặt giá trị cho Tag trong SimEngine
// (chế độ nhập tay) chỉ cho item đang vào; Đặt lại hoặc thoát khôi phục giá trị ghi tay cũ. KHÔNG ghi vào project, KHÔNG
// tới thiết bị: lớp này chỉ biết SimEngine, không biết phiên Online hay luồng ghi.
import type { SimEngine, SimTagValue, WriteRefusal } from './sim-engine.ts';
import { tagClassOf04, tagRange } from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';

export type TestRefusal = 'not-entered' | 'not-in-item' | WriteRefusal;
export type TestResult = { ok: true } | { ok: false; reason: TestRefusal };

type Engine = Pick<SimEngine, 'write' | 'override' | 'clearOverride'>;
type Value = boolean | number | string;

export class TestStrip {
  private readonly engine: Engine;
  /** Item đang vào; `null` thì không đặt được gì. */
  private item: string | null = null;
  private tags: ReadonlySet<string> = new Set();
  /** Giá trị ghi tay trước khi thanh này đặt (undefined = chưa có). */
  private readonly saved = new Map<string, Value | undefined>();

  constructor(engine: Engine) {
    this.engine = engine;
  }

  /** Vào item: chỉ Tag trong `tagIds` (Tag của binding và sự kiện của item) đặt được. Đổi item thì khôi phục hết. */
  enter(itemId: string, tagIds: Iterable<string>): void {
    if (this.item !== itemId) this.resetAll();
    this.item = itemId;
    this.tags = new Set(tagIds);
  }

  /** Thoát item, bỏ chọn hoặc đóng editor: khôi phục giá trị mô phỏng cũ. */
  exit(): void {
    this.resetAll();
    this.item = null;
    this.tags = new Set();
  }

  set(tagId: string, value: Value): TestResult {
    if (this.item === null) return { ok: false, reason: 'not-entered' };
    if (!this.tags.has(tagId)) return { ok: false, reason: 'not-in-item' };
    const before = this.engine.override(tagId);
    const r = this.engine.write(tagId, value);
    if (!r.ok) return r;
    if (!this.saved.has(tagId)) this.saved.set(tagId, before);
    return { ok: true };
  }

  /** Đặt lại một Tag. Trả `true` khi có gì để khôi phục. */
  reset(tagId: string): boolean {
    if (!this.saved.has(tagId)) return false;
    const old = this.saved.get(tagId);
    this.saved.delete(tagId);
    if (old === undefined) this.engine.clearOverride(tagId);
    else this.engine.write(tagId, old);
    return true;
  }

  resetAll(): void {
    for (const id of [...this.saved.keys()]) this.reset(id);
  }

  /** Tag đang bị đặt giá trị thử. */
  get active(): readonly string[] {
    return [...this.saved.keys()];
  }
}

/** Điều khiển của thanh theo kiểu Tag (contract §7). */
export type TestControl =
  | { kind: 'switch' }
  | { kind: 'slider'; min: number; max: number; step: number }
  | { kind: 'select'; options: readonly { value: SimTagValue; text: string }[] }
  | { kind: 'text' };

/**
 * BOOL = công tắc; số = thanh trượt (khoảng `inMin`–`inMax` của binding nếu có, không thì `min`–`max` của Tag); Tag có bảng
 * giá trị = danh sách chọn (`entries` do bên gọi lấy từ bảng); chuỗi = ô chữ.
 */
export function controlFor(
  tag: TagInfo,
  opts: {
    range?: readonly [number, number];
    entries?: readonly { value: number | boolean; text: string }[];
  } = {},
): TestControl {
  const cls = tagClassOf04(tag.type);
  if (opts.entries !== undefined && opts.entries.length > 0)
    return { kind: 'select', options: opts.entries };
  if (cls === 'bool') return { kind: 'switch' };
  if (cls === 'string') return { kind: 'text' };
  const [min, max] = opts.range ?? tagRange(tag);
  const integer = !tag.type.startsWith('FLOAT');
  const span = max - min;
  return { kind: 'slider', min, max, step: integer && span >= 1 ? 1 : span / 100 };
}
