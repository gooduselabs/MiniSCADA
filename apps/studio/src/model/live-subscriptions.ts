// Đăng ký dữ liệu sống theo nơi dùng (feature 006, T120, data-model §13.5, R22). Mỗi nơi cần giá trị (Bảng theo
// dõi, xem trước màn hình, các dòng đang hiện của Bảng Tag) khai một tập Tag kèm ưu tiên; ở đây hợp lại, cắt ở
// 1.000 Tag theo ưu tiên và chỉ gọi `apply` sau 300 ms yên lặng (cuộn nhanh không làm bão `subscribe`).

/** Ưu tiên của từng nơi khai (số lớn thắng khi phải cắt). */
export const PRIORITY = { watch: 3, preview: 2, tagTable: 1, base: 0 } as const;
/** Trần số Tag một đăng ký live (contract live 1.2.0). */
export const MAX_SUBSCRIBED = 1000;
/** Thời gian yên lặng trước khi gửi `subscribe`. */
export const QUIET_MS = 300;

interface Declaration {
  tags: readonly string[];
  priority: number;
}

export class LiveSubscriptions {
  private readonly owners = new Map<string, Declaration>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last: string[] | null = null;
  private cut = 0;

  private readonly apply: (tags: string[]) => void;

  constructor(apply: (tags: string[]) => void) {
    this.apply = apply;
  }

  /** Số Tag bị cắt do vượt trần ở lần hợp gần nhất. */
  get truncated(): number {
    return this.cut;
  }

  /** Nơi `owner` khai (thay thế khai cũ) tập Tag với ưu tiên; làm mới đồng hồ yên lặng. */
  declare(owner: string, tags: readonly string[], priority: number): void {
    this.owners.set(owner, { tags: [...tags], priority });
    this.schedule();
  }

  /** Nơi `owner` không cần nữa. */
  release(owner: string): void {
    if (this.owners.delete(owner)) this.schedule();
  }

  /** Tập hợp hiện tại: ưu tiên giảm dần, cùng ưu tiên theo thứ tự khai; Tag trùng lấy ưu tiên cao nhất. */
  merged(): string[] {
    const best = new Map<string, number>();
    const order: string[] = [];
    for (const { tags, priority } of this.owners.values()) {
      for (const id of tags) {
        const cur = best.get(id);
        if (cur === undefined) {
          best.set(id, priority);
          order.push(id);
        } else if (priority > cur) best.set(id, priority);
      }
    }
    const rank = new Map(order.map((id, i) => [id, i]));
    order.sort((a, b) => best.get(b)! - best.get(a)! || rank.get(a)! - rank.get(b)!);
    this.cut = Math.max(0, order.length - MAX_SUBSCRIBED);
    return order.slice(0, MAX_SUBSCRIBED);
  }

  /** Gửi ngay (không đợi yên lặng), vẫn bỏ qua nếu tập không đổi. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.merged();
    const prev = this.last;
    if (prev && prev.length === next.length && prev.every((t, i) => t === next[i])) return;
    if (!prev && !next.length) return;
    this.last = next;
    this.apply(next);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.owners.clear();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), QUIET_MS);
  }
}
