// Gắn Tag vào khe của widget (feature 007, T114, FR-064; research R21): dùng chung cho kéo Tag thả lên widget trên canvas và
// thả vào ô khe của inspector. Kiểm kiểu và quyền bằng `canBind` của model/screen-catalog.ts; từ chối thì báo lý do, không đổi gì.
import { catalogWidget, type WidgetItem } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import { groupBindCheck, type GroupBindReason } from '../model/history-bind.ts';
import { tagTypesOf } from '../model/logging-doc.ts';
import { setTag } from '../model/screen-doc.ts';
import { canBindForAction, firstFreeSlot, type BindReason } from '../model/screen-catalog.ts';
import type { StudioApp } from './app.ts';

const REASON_TEXT: Readonly<Record<BindReason, MessageKey>> = {
  'type-mismatch': 'scr.bind.typeMismatch',
  'needs-write': 'scr.bind.needsWrite',
  calculated: 'scr.bind.calculated',
  simulation: 'scr.bind.simulation',
  'multi-full': 'scr.bind.multiFull',
  duplicate: 'scr.bind.duplicate',
  'unknown-tag': 'scr.bind.unknownTag',
};

const GROUP_TEXT: Readonly<Record<GroupBindReason, MessageKey>> = {
  'no-group': 'scr.bind.noGroup',
  'group-gone': 'scr.bind.groupGone',
  'not-in-group': 'scr.bind.notInGroup',
  'no-aggregate': 'scr.bind.noAggregate',
};

export const bindReasonText = (r: BindReason): string => t(REASON_TEXT[r]);

/** Giá trị mới của khe sau khi gắn `tagId` theo `mode`. */
function slotValue(
  item: WidgetItem,
  slot: string,
  tagId: string,
  mode: 'set' | 'append' | 'replace',
) {
  if (mode !== 'append') return tagId;
  const cur = item.tags?.[slot];
  const list = cur === undefined ? [] : typeof cur === 'string' ? [cur] : cur;
  return [...list, tagId];
}

/**
 * Gắn Tag vào widget. `slot` vắng: chọn khe đầu tiên chưa có Tag mà hợp kiểu (thả lên widget); có `slot` thì chỉ khe đó
 * (thả vào ô khe của inspector). Trả `true` khi đã gắn.
 */
export function bindTag(
  app: StudioApp,
  screenId: string,
  itemId: string,
  tagId: string,
  slot?: string,
): boolean {
  const doc = app.screenModel(screenId);
  const item = doc?.items.find((i) => i.id === itemId);
  if (!doc || !item || item.type !== 'widget') return false;
  const spec = catalogWidget(item.widget);
  const info = app.screens.tagInfos().get(tagId);
  if (!spec) return false;
  if (!info) {
    app.toast(bindReasonText('unknown-tag'));
    return false;
  }
  let target: { slot: string; mode: 'set' | 'append' | 'replace' } | null;
  if (slot === undefined) {
    target = firstFreeSlot(spec, item, info);
    if (!target) {
      // Không khe nào nhận được: nêu lý do của khe đầu tiên.
      const first = spec.slots[0];
      const why = first
        ? canBindForAction(info, first, item.events?.click ?? { action: 'closePopup' })
        : null;
      app.toast(why && !why.ok ? bindReasonText(why.reason) : t('scr.bind.noSlot'));
      return false;
    }
  } else {
    const s = spec.slots.find((x) => x.name === slot);
    if (!s) return false;
    const cur = item.tags?.[slot];
    const check = canBindForAction(
      info,
      s,
      item.events?.click ?? { action: 'closePopup' },
      s.multi ? cur : undefined,
    );
    if (!check.ok) {
      app.toast(bindReasonText(check.reason));
      return false;
    }
    target = {
      slot,
      mode: s.multi && cur !== undefined ? 'append' : cur !== undefined ? 'replace' : 'set',
    };
  }
  // Widget lịch sử (feature 010): Tag phải thuộc nhóm lưu trữ của widget (và có tổng hợp nếu khe đòi); báo ngay khi thả sai.
  const gate = groupBindCheck(
    spec.slots.find((x) => x.name === target.slot) ?? {},
    item.props,
    tagId,
    app.store.state.outline.logging,
    tagTypesOf(app.store.state.outline.tags),
  );
  if (gate !== null) {
    app.toast(t(GROUP_TEXT[gate], { tag: tagId, group: String(item.props?.group ?? '') }));
    return false;
  }
  const value = slotValue(item, target.slot, tagId, target.mode);
  const r = app.editScreen(screenId, (d) => setTag(d, itemId, target.slot, value));
  if (r && !r.rejected) {
    app.selectItems(screenId, [itemId]);
    return true;
  }
  return false;
}
