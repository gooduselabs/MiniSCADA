// "Dùng ở đâu" của một Tag (feature 004, FR-006): phần tử màn hình và thuộc tính gắn với Tag, nhóm lưu
// trữ có Tag. Đọc từ binding và logging.json của project đang mở (outlineOf), kể cả khi project còn
// lỗi; phần tử hay file sai hình dạng thì bỏ qua, không ném lỗi.
import type { BindingTarget } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { Location } from './issue-map.ts';
import type { ProjectOutline } from './project-doc.ts';

export type XrefEntry =
  | {
      kind: 'binding';
      screen: string;
      screenName: string;
      element: string;
      elementName: string;
      target: string;
      bindingId: string;
    }
  | { kind: 'logging'; group: number; groupId: string; groupName: string };

const TARGET_LABEL: Readonly<Record<BindingTarget, MessageKey>> = {
  'style.fill': 'target.style.fill',
  'style.stroke': 'target.style.stroke',
  'style.opacity': 'target.style.opacity',
  'style.visibility': 'target.style.visibility',
  'text.content': 'target.text.content',
  'transform.rotate': 'target.transform.rotate',
  'transform.translateX': 'target.transform.translateX',
  'transform.translateY': 'target.transform.translateY',
  'transform.scale': 'target.transform.scale',
  'geometry.levelPercent': 'target.geometry.levelPercent',
  'component.state': 'target.component.state',
};

/** Tên thuộc tính của đích binding ("Màu nền"); đích lạ giữ nguyên. */
export function targetLabel(target: string): string {
  return Object.prototype.hasOwnProperty.call(TARGET_LABEL, target)
    ? t(TARGET_LABEL[target as BindingTarget])
    : target;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function whereUsed(
  outline: Pick<ProjectOutline, 'screens' | 'logging'>,
  tagId: string,
): XrefEntry[] {
  const out: XrefEntry[] = [];
  for (const s of outline.screens) {
    const names = new Map<string, string>();
    for (const e of list(s.screen?.elements))
      if (isObject(e) && typeof e.elementUid === 'string')
        names.set(e.elementUid, str(e.name, e.elementUid));
    for (const eb of list(s.bindings?.elements)) {
      if (!isObject(eb) || typeof eb.elementUid !== 'string') continue;
      for (const b of list(eb.bindings)) {
        if (!isObject(b) || !isObject(b.source) || b.source.tagId !== tagId) continue;
        out.push({
          kind: 'binding',
          screen: s.id,
          screenName: str(s.screen?.name, s.id),
          element: eb.elementUid,
          elementName: names.get(eb.elementUid) ?? eb.elementUid,
          target: String(b.target),
          bindingId: String(b.id),
        });
      }
    }
  }
  list(outline.logging?.groups).forEach((g, i) => {
    if (!isObject(g)) return;
    if (list(g.tags).some((x) => isObject(x) && x.tagId === tagId))
      out.push({
        kind: 'logging',
        group: i,
        groupId: String(g.id),
        groupName: str(g.name, String(g.id)),
      });
  });
  return out;
}

/** Một dòng của "Dùng ở đâu": "Bồn nước + bơm › Mức nước (Mức chất lỏng)", "Lưu trữ › Vận hành". */
export function xrefText(e: XrefEntry): string {
  return e.kind === 'binding'
    ? t('xref.binding', {
        screen: e.screenName,
        element: e.elementName,
        target: targetLabel(e.target),
      })
    : t('xref.logging', { group: e.groupName });
}

/** Editor mở khi nhấp một dòng (cùng kiểu chỗ tới với ánh xạ lỗi). */
export function xrefLocation(e: XrefEntry): Location {
  return e.kind === 'binding'
    ? { editor: 'screen', screen: e.screen, element: e.element }
    : { editor: 'logging', group: e.group };
}
