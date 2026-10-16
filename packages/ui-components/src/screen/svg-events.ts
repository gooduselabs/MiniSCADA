// Sự kiện click của phần tử SVG lúc chạy (contract svg-events.md §3, §4; ADR-025). Dùng cùng ControlController,
// ActionHost và hộp xác nhận với widget: không thêm đường ghi. Chỉ đặt thuộc tính lúc chạy (không lưu vào SVG).
import type { ElementAction } from '@mat/project-schema';
import type { MountedScreen } from '@mat/svg-renderer';
import { MatConfirmDialog } from '../control/confirm-dialog.ts';
import type { ControlController } from '../control/controller.ts';
import { defaultModalRegistry, type ModalRegistry } from '../control/modal-registry.ts';
import {
  isWriteAction,
  proposeSvgAction,
  svgActionController,
  type SvgWriteAction,
} from '../control/svg-action-controller.ts';
import type { ActionHost, TagSource } from '../host/types.ts';
import { resultView, SENDING_TEXT } from '../i18n/control-vi.ts';

export interface StatusSink {
  show(message: string, kind: 'info' | 'warn' | 'error' | 'ok'): void;
}

export interface SvgEventsDeps {
  screenId: string;
  mounted: MountedScreen;
  events: ReadonlyArray<{ elementUid: string; click: ElementAction }>;
  source: TagSource;
  host: ActionHost;
  /** Vùng `role="status"` của `<mat-screen>`. */
  status: StatusSink;
  mode: 'run' | 'edit';
  modal?: ModalRegistry;
  /** Id của vùng status trong CÙNG cây DOM với phần tử (để `aria-describedby`); vắng thì không đặt. */
  statusId?: string;
  now(): number;
  uuid(): string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATTRS = [
  'data-mat-clickable',
  'role',
  'tabindex',
  'aria-label',
  'aria-disabled',
  'aria-describedby',
  'data-mat-lock',
] as const;
const FOCUS_CSS =
  '[data-mat-clickable]:focus-visible{outline:2px solid var(--mat-focus,#1e88e5);outline-offset:2px}';
const LOCK_FILTER = 'grayscale(0.6)';

type Styled = Element & { style: CSSStyleDeclaration };

const isHidden = (el: Styled): boolean =>
  el.style.visibility === 'hidden' || el.style.display === 'none';

/** `<title data-mat-runtime>` do mã chèn (con trực tiếp của phần tử). */
function findTitle(el: Element): Element | null {
  for (const c of Array.from(el.children))
    if (c.localName === 'title' && c.hasAttribute('data-mat-runtime')) return c;
  return null;
}

function setStyle(el: Styled, prop: 'cursor' | 'pointerEvents' | 'filter', v: string): void {
  if (el.style[prop] !== v) el.style[prop] = v;
}

function setAttr(el: Element, name: string, v: string | null): void {
  if (v === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== v) {
    el.setAttribute(name, v);
  }
}

class Bound {
  readonly #el: Styled;
  readonly #d: SvgEventsDeps;
  readonly #click: ElementAction;
  readonly #label: string;
  readonly #ctl: ControlController | null;
  readonly #saved = new Map<string, string | null>();
  readonly #savedStyle: Record<'cursor' | 'pointerEvents' | 'filter', string>;
  readonly #mo: MutationObserver | null = null;
  #dialog: MatConfirmDialog | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #lastHidden = false;
  #prevPhase = '';
  #disposed = false;

  constructor(el: Styled, click: ElementAction, uid: string, d: SvgEventsDeps) {
    this.#el = el;
    this.#d = d;
    this.#click = click;
    this.#label = click.label || uid;
    for (const a of ATTRS) this.#saved.set(a, el.getAttribute(a));
    this.#savedStyle = {
      cursor: el.style.cursor,
      pointerEvents: el.style.pointerEvents,
      filter: el.style.filter,
    };
    if (isWriteAction(click)) {
      this.#ctl = svgActionController(
        click,
        { screen: d.screenId, uid, label: this.#label },
        {
          source: d.source,
          host: d.host,
          now: d.now,
          uuid: d.uuid,
          modal: d.modal ?? defaultModalRegistry,
        },
      );
      this.#ctl.onChange = () => this.sync();
    } else {
      this.#ctl = null;
    }
    el.addEventListener('click', this.#onClick);
    el.addEventListener('keydown', this.#onKey);
    if (typeof MutationObserver !== 'undefined') {
      this.#mo = new MutationObserver(() => {
        if (isHidden(this.#el) !== this.#lastHidden) this.apply();
      });
      this.#mo.observe(el, { attributes: true, attributeFilter: ['style'] });
    }
    setAttr(el, 'data-mat-clickable', '');
    setAttr(el, 'role', 'button');
    setAttr(el, 'aria-label', this.#label);
    this.sync();
  }

  get tag(): string | undefined {
    return isWriteAction(this.#click) ? this.#click.tag : undefined;
  }

  /** Cập nhật lại mọi thứ từ trạng thái hiện thời (khóa, hộp xác nhận, kết quả). */
  sync(): void {
    if (this.#disposed) return;
    this.apply();
    const ctl = this.#ctl;
    if (!ctl) return;
    const s = ctl.state;
    if (s.phase === 'sending' && this.#prevPhase !== 'sending')
      this.#d.status.show(SENDING_TEXT, 'info');
    if (s.phase === 'result' && this.#prevPhase !== 'result') {
      const v = resultView(s.outcome);
      const kind = v.severity === 'pending' ? 'info' : v.severity;
      this.#d.status.show(v.detail ? `${v.title} ${v.detail}` : v.title, kind);
    }
    this.#prevPhase = s.phase;
    this.#syncDialog();
    // Kết quả đã báo ở vùng status: về ready (UNKNOWN còn giữ thì ctl bỏ qua tới khi hết giữ).
    if (s.phase === 'result') ctl.dismissResult();
  }

  apply(): void {
    if (this.#disposed) return;
    const el = this.#el;
    const hidden = isHidden(el);
    this.#lastHidden = hidden;
    const lock = this.#lock();
    setAttr(el, 'data-mat-lock', lock?.code ?? null);
    setAttr(el, 'aria-disabled', lock ? 'true' : null);
    setStyle(el, 'cursor', lock ? 'not-allowed' : 'pointer');
    setStyle(el, 'filter', lock ? LOCK_FILTER : this.#savedStyle.filter);
    setAttr(el, 'aria-describedby', lock && this.#d.statusId ? this.#d.statusId : null);
    this.#syncTitle(lock?.message ?? null);
    // `visible`, không phải `all`: vẫn nhận nhấp ở hình `fill: none`, nhưng không nhận khi tổ tiên `visibility: hidden`
    // (`all` bỏ qua visibility nên nút trong nhóm bị binding ẩn vẫn bấm được, trái FR-049).
    setStyle(el, 'pointerEvents', hidden ? 'none' : 'visible');
    setAttr(el, 'tabindex', hidden ? '-1' : '0');
  }

  #lock(): { code: string; message: string } | null {
    const ctl = this.#ctl;
    if (!ctl) return null;
    const s = ctl.state;
    if (s.phase === 'locked') return { code: s.code, message: s.message };
    if (ctl.busyLock() === 'BUSY') return { code: 'BUSY', message: SENDING_TEXT };
    return null;
  }

  #syncTitle(message: string | null): void {
    const el = this.#el;
    let t = findTitle(el);
    if (message === null) {
      t?.remove();
      return;
    }
    if (!t) {
      t = el.ownerDocument.createElementNS(SVG_NS, 'title');
      t.setAttribute('data-mat-runtime', '');
      el.insertBefore(t, el.firstChild);
    }
    if (t.textContent !== message) t.textContent = message;
  }

  readonly #onClick = (e: Event): void => {
    e.stopPropagation(); // phần tử sâu nhất thắng
    this.#activate();
  };

  readonly #onKey = (e: Event): void => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
    e.stopPropagation();
    e.preventDefault();
    this.#activate();
  };

  #activate(): void {
    if (this.#disposed || isHidden(this.#el)) return;
    const a = this.#click;
    const ctl = this.#ctl;
    if (!ctl) {
      if (a.action === 'navigate') this.#d.host.navigate(a.screen);
      else if (a.action === 'popup') this.#d.host.openPopup(a.screen);
      else if (a.action === 'closePopup') this.#d.host.closePopup();
      return;
    }
    const lock = this.#lock();
    if (lock) {
      this.#d.status.show(lock.message, lock.code === 'BUSY' ? 'info' : 'warn');
      return;
    }
    if (ctl.state.phase !== 'ready') return;
    if (!proposeSvgAction(ctl, a as SvgWriteAction) && ctl.error) {
      this.#d.status.show(ctl.error, 'error');
    }
  }

  // ---- hộp xác nhận (như ControlWidget) ----

  #syncDialog(): void {
    const ctl = this.#ctl;
    const s = ctl?.state;
    if (!ctl || !s || s.phase !== 'confirming') {
      this.#closeDialog(true);
      return;
    }
    if (!this.#dialog) {
      const dlg = new MatConfirmDialog();
      dlg.onConfirm = () => ctl.confirm();
      dlg.onCancel = () => ctl.cancel();
      const layer = (this.#d.modal ?? defaultModalRegistry).layer ?? this.#el.ownerDocument.body;
      layer.append(dlg);
      this.#dialog = dlg;
      // Phiên hết hạn không có sự kiện: kiểm lại mỗi giây khi hộp đang mở.
      this.#poll = setInterval(() => ctl.recompute(), 1000);
    }
    const info = s.draft.info;
    this.#dialog.draft = s.draft;
    this.#dialog.account = this.#d.host.session()?.user ?? '';
    this.#dialog.lock = ctl.confirmLock();
    this.#dialog.limits = ctl.limits();
    this.#dialog.table =
      (info.valueTable ? this.#d.source.valueTable(info.valueTable) : undefined) ?? null;
  }

  #closeDialog(restoreFocus: boolean): void {
    if (this.#poll) clearInterval(this.#poll);
    this.#poll = null;
    if (!this.#dialog) return;
    this.#dialog.remove();
    this.#dialog = null;
    if (restoreFocus) (this.#el as unknown as { focus?: () => void }).focus?.();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#closeDialog(false);
    this.#ctl?.dispose();
    this.#disposed = true;
    this.#mo?.disconnect();
    const el = this.#el;
    el.removeEventListener('click', this.#onClick);
    el.removeEventListener('keydown', this.#onKey);
    findTitle(el)?.remove();
    for (const [a, v] of this.#saved) setAttr(el, a, v);
    setStyle(el, 'cursor', this.#savedStyle.cursor);
    setStyle(el, 'pointerEvents', this.#savedStyle.pointerEvents);
    setStyle(el, 'filter', this.#savedStyle.filter);
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }
}

export function bindSvgEvents(d: SvgEventsDeps): { refresh(): void; dispose(): void } {
  const bound: Bound[] = [];
  let style: HTMLStyleElement | null = null;
  let unsub: (() => void) | null = null;
  if (d.mode === 'run') {
    const missing: string[] = [];
    for (const ev of d.events) {
      const el = d.mounted.elements.get(ev.elementUid);
      if (!el || !('style' in el)) {
        missing.push(ev.elementUid);
        continue;
      }
      bound.push(new Bound(el as Styled, ev.click, ev.elementUid, d));
    }
    if (missing.length > 0)
      console.warn('elementUid của sự kiện không có trong SVG, bỏ qua:', missing);
    if (bound.length > 0) {
      style = d.mounted.root.ownerDocument.createElement('style');
      style.setAttribute('data-mat-runtime', '');
      style.textContent = FOCUS_CSS;
      d.mounted.root.append(style);
    }
    const tags = bound.map((b) => b.tag).filter((t): t is string => t !== undefined);
    if (tags.length > 0) unsub = d.source.subscribe(tags, () => refresh());
  }

  function refresh(): void {
    for (const b of bound) b.sync();
  }

  return {
    refresh,
    dispose(): void {
      unsub?.();
      unsub = null;
      for (const b of bound) b.dispose();
      bound.length = 0;
      style?.remove();
      style = null;
    },
  };
}
