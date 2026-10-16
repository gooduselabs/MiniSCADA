// Widget ảo cho sự kiện click của phần tử SVG (contract svg-events.md §3): dựng WidgetItem `button` rồi dùng
// đúng ControlController của 007 (khóa, hộp xác nhận, "đang gửi", kết quả, không gửi lại). Không thêm đường ghi.
import type { Action, ElementAction, WidgetItem } from '@mat/project-schema';
import type { WriteKind } from '../host/types.ts';
import { ControlController, type ControlDeps } from './controller.ts';

/** Hành động ghi của phần tử SVG (`write`, `toggle`, `pulse`). */
export type SvgWriteAction = Extract<ElementAction, { action: 'write' | 'toggle' | 'pulse' }>;

export function isWriteAction(a: ElementAction): a is SvgWriteAction {
  return a.action === 'write' || a.action === 'toggle' || a.action === 'pulse';
}

export interface SvgActionContext {
  screen: string;
  /** `elementUid` của phần tử (làm `context.widget` ở audit). */
  uid: string;
  /** Nhãn đọc cho trình đọc màn hình; hiện ở hộp xác nhận (`confirmText`). */
  label: string;
}

export function svgActionController(
  a: SvgWriteAction,
  ctx: SvgActionContext,
  deps: Omit<ControlDeps, 'item' | 'context'>,
): ControlController {
  const click: Action =
    a.action === 'toggle'
      ? { action: 'toggle' }
      : a.action === 'pulse'
        ? { action: 'pulse', value: a.value, durationMs: a.durationMs }
        : { action: 'write', value: a.value };
  const item: WidgetItem = {
    id: ctx.uid,
    type: 'widget',
    widget: 'button',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    tags: { target: a.tag },
    props: { confirm: a.confirm ?? 'always', ...(ctx.label ? { confirmText: ctx.label } : {}) },
    events: { click },
    security: { minRole: a.minRole ?? 'operator' },
  };
  return new ControlController({ ...deps, item, context: { screen: ctx.screen, widget: ctx.uid } });
}

/** Đề nghị ghi theo hành động (mở hộp xác nhận hoặc gửi ngay khi `confirm: none` và Tag BOOL). */
export function proposeSvgAction(ctl: ControlController, a: SvgWriteAction): boolean {
  const kind: WriteKind = a.action;
  if (a.action === 'toggle') return ctl.propose(kind, false);
  if (a.action === 'pulse') return ctl.propose(kind, a.value, { pulseMs: a.durationMs });
  return ctl.propose(kind, a.value);
}
