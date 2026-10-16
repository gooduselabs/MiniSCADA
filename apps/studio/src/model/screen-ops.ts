// Thao tác ở cấp project với màn hình 0.3 (feature 007, T109, FR-065, FR-066): sinh id và màn hình mới, nhân bản, liệt kê
// chỗ trỏ tới một màn hình (hộp thoại Xóa), đặt màn hình đầu. Hàm thuần trên cấu trúc project đọc được (outlineOf);
// trả danh sách sửa đổi để store áp thành MỘT bước hoàn tác.
import type { Action, BindingSet04, ScreenKind, ScreenModel } from '@mat/project-schema';
import type { ProjectEdit, ProjectOutline } from './project-doc.ts';

export const DEFAULT_SCREEN_SIZE = { width: 1920, height: 1080 } as const;
export const DEFAULT_POPUP_SIZE = { width: 640, height: 420 } as const;
/** Mẫu cỡ màn hình của hộp thoại Thuộc tính (FR-066). */
export const SIZE_PRESETS: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];
export const MAX_SCREENS = 64;

/** Id mới `man-hinh-<n>` hoặc `popup-<n>` (n nhỏ nhất chưa dùng), hợp tên file. */
export function newScreenId(taken: Iterable<string>, kind: ScreenKind): string {
  const used = new Set(taken);
  const base = kind === 'popup' ? 'popup' : 'man-hinh';
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Màn hình rỗng; `name` do tầng giao diện dịch. */
export function newScreen(kind: ScreenKind, id: string, name: string): ScreenModel {
  const size = kind === 'popup' ? DEFAULT_POPUP_SIZE : DEFAULT_SCREEN_SIZE;
  return {
    schemaVersion: '0.3.0',
    id,
    name,
    kind,
    size: { ...size },
    fitMode: 'contain',
    items: [],
  };
}

const screensOf = (o: Pick<ProjectOutline, 'screens'>): ScreenModel[] =>
  o.screens.flatMap((s) => (s.model ? [s.model] : []));

export const screenIds = (o: Pick<ProjectOutline, 'screens'>): string[] =>
  o.screens.map((s) => s.id);

/** Màn hình thêm bằng lệnh: id, sửa đổi và số thứ tự để đặt tên "Màn hình mới N". */
export function planAddScreen(
  o: Pick<ProjectOutline, 'screens'>,
  kind: ScreenKind,
  nameOf: (n: number) => string,
): { id: string; edits: ProjectEdit[] } | null {
  if (o.screens.length >= MAX_SCREENS) return null;
  const id = newScreenId(screenIds(o), kind);
  const n = Number(id.slice(id.lastIndexOf('-') + 1));
  return { id, edits: [{ kind: 'screenUpsert', screen: newScreen(kind, id, nameOf(n)) }] };
}

/**
 * Nhân bản: id `<gốc>-2`, tên có hậu tố. Item `svg` không nhân bản được (một file binding chỉ thuộc một item): bỏ
 * khỏi bản sao; `skippedSvg` cho giao diện báo.
 */
export function planDuplicateScreen(
  o: Pick<ProjectOutline, 'screens'>,
  id: string,
  copyName: (name: string) => string,
): { id: string; edits: ProjectEdit[]; skippedSvg: number } | null {
  const src = o.screens.find((s) => s.id === id)?.model;
  if (!src || o.screens.length >= MAX_SCREENS) return null;
  const taken = new Set(screenIds(o));
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  const nid = `${id}-${n}`;
  const items = src.items.filter((i) => i.type !== 'svg');
  const copy: ScreenModel = {
    ...JSON.parse(JSON.stringify(src)),
    id: nid,
    name: copyName(src.name),
    items: JSON.parse(JSON.stringify(items)),
  };
  return {
    id: nid,
    edits: [{ kind: 'screenUpsert', screen: copy }],
    skippedSvg: src.items.length - items.length,
  };
}

export type ScreenRef =
  /** Sự kiện nhấp của phần tử SVG (feature 008) chuyển tới hoặc mở popup là màn hình này. */
  | {
      kind: 'svgEvent';
      screen: string;
      screenName: string;
      item: string;
      itemName: string;
      element: string;
      elementName: string;
      action: 'navigate' | 'popup';
    }
  | { kind: 'entry' }
  | { kind: 'nav'; label: string }
  | {
      kind: 'action';
      screen: string;
      screenName: string;
      item: string;
      itemName: string;
      action: 'navigate' | 'popup';
    };

/** Mọi chỗ trỏ tới màn hình `id`: màn hình đầu, mục menu, hành động của nút. */
export function screenRefs(o: ProjectOutline, id: string): ScreenRef[] {
  const out: ScreenRef[] = [];
  if (o.project?.entryScreen === id) out.push({ kind: 'entry' });
  const walk = (
    items: readonly { label: string; screen?: string; items?: readonly unknown[] }[],
  ): void => {
    for (const it of items) {
      if (it.screen === id) out.push({ kind: 'nav', label: it.label });
      if (Array.isArray(it.items)) walk(it.items as never);
    }
  };
  walk(o.navigation?.items ?? []);
  for (const scr of screensOf(o)) {
    if (scr.id === id) continue;
    for (const item of scr.items) {
      if (item.type !== 'widget') continue;
      const a: Action | undefined = item.events?.click;
      if (a && (a.action === 'navigate' || a.action === 'popup') && a.screen === id)
        out.push({
          kind: 'action',
          screen: scr.id,
          screenName: scr.name,
          item: item.id,
          itemName: item.name ?? item.id,
          action: a.action,
        });
    }
  }
  for (const s of o.screens) {
    if (s.id === id) continue;
    for (const item of s.model?.items ?? []) {
      if (item.type !== 'svg') continue;
      const set = s.itemBindings[item.id] as unknown as BindingSet04 | undefined;
      for (const e of set?.elements ?? []) {
        const a = e.events?.click;
        if (a && (a.action === 'navigate' || a.action === 'popup') && a.screen === id)
          out.push({
            kind: 'svgEvent',
            screen: s.id,
            screenName: s.model?.name ?? s.id,
            item: item.id,
            itemName: item.name ?? item.id,
            element: e.elementUid,
            elementName:
              item.elements.find((x) => x.elementUid === e.elementUid)?.name ?? e.elementUid,
            action: a.action,
          });
      }
    }
  }
  return out;
}

/** Xóa màn hình: chỉ bỏ màn hình; chỗ trỏ tới nó thành lỗi kiểm tra (FR-065, người dùng đã được hỏi). */
export const planRemoveScreen = (id: string): ProjectEdit[] => [{ kind: 'screenRemove', id }];

/** Đặt màn hình đầu: chỉ màn hình `kind: screen`. */
export function planSetEntry(o: Pick<ProjectOutline, 'screens'>, id: string): ProjectEdit[] | null {
  const s = o.screens.find((x) => x.id === id)?.model;
  if (!s || s.kind === 'popup') return null;
  return [{ kind: 'project', field: 'entryScreen', value: id }];
}
