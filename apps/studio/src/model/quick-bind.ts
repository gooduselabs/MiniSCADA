// Gắn nhanh (feature 008, T092; FR-058): với item `svg` dùng tệp ký hiệu mẫu cũ (`graphics/symbols/`), liệt kê bộ phận
// kèm gợi ý (`parts[].suggest`) và chỉ ra nơi mở trong inspector khi bấm. Hàm thuần; không ghi gì vào project (người dùng vẫn tự
// chọn Tag và chấp nhận).
import type { BindingSet04, Item } from '@mat/project-schema';
import { symbolPartsOf } from '../i18n/symbol-parts.ts';

export interface QuickPart {
  uid: string;
  role: string;
  label: string;
  /** Mục động hóa gợi ý theo thứ tự (`click` là sự kiện nhấp). */
  suggest: readonly string[];
  /** Số binding đã có trên bộ phận. */
  bound: number;
  hasEvent: boolean;
}

export interface QuickTarget {
  tab: 'bind' | 'events';
  /** Dòng Gắn Tag cần mở (mục gợi ý đầu tiên); vắng khi nhóm Sự kiện hoặc không có gợi ý. */
  rowId?: string;
  /** Ô nhận focus (`screens.jump.field`). */
  field: string;
}

/** Danh sách bộ phận của item nếu nó dùng tệp ký hiệu mẫu; `null` khi không. */
export function quickParts(item: Item, set: BindingSet04 | undefined): QuickPart[] | null {
  const parts = item.type === 'svg' ? symbolPartsOf(item.svgFile) : undefined;
  if (parts === undefined) return null;
  return parts.map((p) => {
    const entry = set?.elements.find((e) => e.elementUid === p.uid);
    return {
      uid: p.uid,
      role: p.role,
      label: p.label,
      suggest: p.suggest,
      bound: entry?.bindings?.length ?? 0,
      hasEvent: entry?.events?.click !== undefined,
    };
  });
}

/** Nơi mở khi bấm bộ phận: dòng gợi ý đầu tiên của Gắn Tag, hoặc nhóm Sự kiện khi gợi ý đầu là `click`. */
export function quickTarget(part: QuickPart): QuickTarget {
  const first = part.suggest[0];
  if (first === 'click') return { tab: 'events', field: 'action' };
  if (first === undefined) return { tab: 'bind', field: 'tag' };
  return { tab: 'bind', rowId: first, field: 'tag' };
}
