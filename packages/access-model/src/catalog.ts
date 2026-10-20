// Danh mục tài nguyên từ project đã nạp (feature 013, T005; contracts/access-model.md §2, §3, §7): đầu vào của
// computeAccess. Đọc tài liệu project do validateProject của @mat/project-schema trả (LoadedProject03/05/10 đều khớp
// CatalogProjectInput). Bản C++ tương ứng: core/auth/access_catalog.cpp (dựng từ LoadedProject).
//
// Quy ước (ghi để bản C++ làm giống):
// - Màn hình và popup theo thứ tự khóa của `screens` (thứ tự project.json); `popup` = `kind: "popup"`.
// - `view` của màn hình = `security.view`, thiếu = viewer. Item: `view` = `security.view`, thiếu = viewer; item
//   thao tác được (isOperableItem của project-schema: widget nhóm `control`, svg có sự kiện ghi) có `operate` =
//   `security.operate`, thiếu = `security.minRole`, thiếu nữa = operator; item khác không có `operate`.
// - Tag của item: widget = mọi giá trị của `tags` (mọi khe, kể cả widget lịch sử); svg = `source.tagId` của mọi binding
//   và `tag` của sự kiện click trong tệp binding của item. Popup có `params` (faceplate): item được thay `{param}` theo
//   từng bộ `args` của mọi chỗ gọi popup đó (nút và sự kiện SVG có hành động `popup`; không chỗ gọi nào thì dùng bộ
//   rỗng, tức giá trị `default`); chuỗi còn `{`/`}` sau khi thay bị bỏ. Mảng Tag sắp theo chuỗi, không trùng.
// - Nhóm lưu trữ: `logging.groups[]` (`tags[].tagId`); mẫu báo cáo: `reports.reports[]` (`columns[].tagId`); alarm:
//   `alarms.alarms[]` có `tag` (alarm chất lượng theo `device` không có Tag nguồn, không vào danh mục).
import { isOperableItem, substituteParams, type ParamDecl } from '@mat/project-schema';
import type { CatalogItem, CatalogScreen, ResourceCatalog, Role } from './types.ts';

/** Phần của project đã nạp mà danh mục cần (cấu trúc; LoadedProject03/05/10 gán được). */
export interface CatalogProjectInput {
  screens: Record<string, { screen: unknown; bindings: Record<string, unknown> }>;
  logging?: { groups: ReadonlyArray<{ id: string; tags: ReadonlyArray<{ tagId: string }> }> };
  reports?: { reports: ReadonlyArray<{ id: string; columns?: ReadonlyArray<{ tagId: string }> }> };
  alarms?: { alarms: ReadonlyArray<{ id: string; tag?: string }> };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const sortedTags = (xs: Iterable<string>): string[] =>
  [...new Set(xs)]
    .filter((t) => !t.includes('{') && !t.includes('}'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Hành động click của một item widget hoặc của các phần tử trong tệp binding của item svg. */
function clicks(item: Obj, bindings: unknown): Obj[] {
  if (item.type === 'widget') {
    const c = isObj(item.events) ? item.events.click : undefined;
    return isObj(c) ? [c] : [];
  }
  const out: Obj[] = [];
  for (const e of arr(isObj(bindings) ? bindings.elements : undefined)) {
    const c = isObj(e) && isObj(e.events) ? e.events.click : undefined;
    if (isObj(c)) out.push(c);
  }
  return out;
}

function itemTags(item: Obj, bindings: unknown, out: Set<string>): void {
  if (item.type === 'widget') {
    if (!isObj(item.tags)) return;
    for (const v of Object.values(item.tags))
      for (const t of Array.isArray(v) ? v : [v]) if (typeof t === 'string') out.add(t);
    return;
  }
  for (const e of arr(isObj(bindings) ? bindings.elements : undefined)) {
    if (!isObj(e)) continue;
    for (const b of arr(e.bindings)) {
      const t = isObj(b) && isObj(b.source) ? str(b.source.tagId) : undefined;
      if (t !== undefined) out.add(t);
    }
  }
  for (const c of clicks(item, bindings)) {
    const t = str(c.tag);
    if (t !== undefined) out.add(t);
  }
}

export function catalogFromProject(project: CatalogProjectInput): ResourceCatalog {
  const entries = Object.entries(project.screens);

  // bộ args của mọi chỗ gọi mỗi popup
  const calls = new Map<string, unknown[]>();
  for (const [, { screen, bindings }] of entries)
    for (const item of arr(isObj(screen) ? screen.items : undefined)) {
      if (!isObj(item)) continue;
      const b = item.type === 'svg' ? bindings[String(item.id)] : undefined;
      for (const c of clicks(item, b)) {
        const target = str(c.screen);
        if (c.action !== 'popup' || target === undefined) continue;
        const list = calls.get(target) ?? [];
        list.push(c.args ?? {});
        calls.set(target, list);
      }
    }

  const screens: CatalogScreen[] = [];
  for (const [id, { screen, bindings }] of entries) {
    if (!isObj(screen)) continue;
    const params = arr(screen.params) as ParamDecl[];
    const argSets = params.length > 0 ? (calls.get(id) ?? [{}]) : null;
    const items: CatalogItem[] = [];
    for (const raw of arr(screen.items)) {
      if (!isObj(raw)) continue;
      const b = raw.type === 'svg' ? bindings[String(raw.id)] : undefined;
      const tags = new Set<string>();
      if (argSets === null) itemTags(raw, b, tags);
      else
        for (const args of argSets) {
          const it = substituteParams(raw, params, args);
          const bs = b === undefined ? undefined : substituteParams(b, params, args);
          if (it.ok) itemTags(it.value, bs?.ok ? bs.value : b, tags);
        }
      const sec = isObj(raw.security) ? raw.security : {};
      const operable = isOperableItem(raw, b);
      const head = { id: String(raw.id), operable, view: (str(sec.view) ?? 'viewer') as Role };
      // thứ tự khóa như §7: id, operable, view, operate, tags
      items.push(
        operable
          ? {
              ...head,
              operate: (str(sec.operate) ?? str(sec.minRole) ?? 'operator') as Role,
              tags: sortedTags(tags),
            }
          : { ...head, tags: sortedTags(tags) },
      );
    }
    const ssec = isObj(screen.security) ? screen.security : {};
    screens.push({
      id,
      popup: screen.kind === 'popup',
      view: (str(ssec.view) ?? 'viewer') as Role,
      items,
    });
  }

  return {
    screens,
    historyGroups: (project.logging?.groups ?? []).map((g) => ({
      id: g.id,
      tags: sortedTags(g.tags.map((t) => t.tagId)),
    })),
    reports: (project.reports?.reports ?? []).map((r) => ({
      id: r.id,
      tags: sortedTags((r.columns ?? []).map((c) => c.tagId)),
    })),
    alarms: (project.alarms?.alarms ?? []).map((a) => ({
      id: a.id,
      tag: typeof a.tag === 'string' ? a.tag : null,
    })),
  };
}
