// Feature 041: đích của "Xem tất cả alarm" (chuông). Menu do người dùng cấu hình (feature 030) có thể không có trang Alarm hệ
// thống; khi đó chuông mở màn hình có Bảng alarm (alarm-list hiện hành, ưu tiên kiểu Đầy đủ) có trong menu. Thứ tự:
//  1. màn hình trong menu có alarm-list `source` hiện hành, kiểu Đầy đủ; 2. như trên, kiểu Gọn;
//  3. trang hệ thống `alarms` (có trong menu hay không: luôn có chỗ xử lý alarm).
import type { ScreenModel } from '@mat/project-schema';
import type { MenuModel } from '../menu.ts';

/** Mức phù hợp của màn hình: 2 = có alarm-list hiện hành kiểu Đầy đủ, 1 = kiểu Gọn, 0 = không có. */
export function alarmListRank(screen: Pick<ScreenModel, 'items'>): 0 | 1 | 2 {
  let rank: 0 | 1 | 2 = 0;
  for (const it of screen.items ?? []) {
    const w = it as { type?: string; widget?: string; props?: Record<string, unknown> };
    if (w.type !== 'widget' || w.widget !== 'alarm-list') continue;
    if (w.props?.source === 'history') continue;
    if (w.props?.mode === 'full') return 2;
    rank = 1;
  }
  return rank;
}

/** Màn hình (không phải trang hệ thống) trong menu theo thứ tự hiện. */
export function menuScreens(menu: MenuModel | null): string[] {
  if (!menu) return [];
  const out: string[] = [];
  for (const e of menu.entries)
    for (const l of e.kind === 'item' ? [e] : e.items)
      if (l.system !== true && !l.screen.startsWith('@') && !out.includes(l.screen))
        out.push(l.screen);
  return out;
}

/** Route (id màn hình hoặc `alarms`) mà chuông mở. Màn hình không tải được thì bỏ qua. */
export async function bellTarget(
  menu: MenuModel | null,
  load: (id: string) => Promise<Pick<ScreenModel, 'items'>>,
): Promise<string> {
  let compact: string | null = null;
  for (const id of menuScreens(menu)) {
    let rank: 0 | 1 | 2;
    try {
      rank = alarmListRank(await load(id));
    } catch {
      continue;
    }
    if (rank === 2) return id;
    if (rank === 1 && compact === null) compact = id;
  }
  return compact ?? 'alarms';
}
