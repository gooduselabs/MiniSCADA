// T079: gắn sự kiện click của phần tử SVG lúc chạy (contract svg-events.md §3, §4, §8).
import type { ElementAction } from '@mat/project-schema';
import { mountScreen, type MountedScreen } from '@mat/svg-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatConfirmDialog } from '../control/confirm-dialog.ts';
import { ModalRegistry } from '../control/modal-registry.ts';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import { bindSvgEvents, type StatusSink } from './svg-events.ts';

const RUN: TagInfo = { id: 'RUN', type: 'BOOL', access: 'RW', kind: 'external' };

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g data-mat-uid="el_outer"><rect data-mat-uid="el_inner" width="10" height="10"/></g>
  <rect data-mat-uid="el_btn" x="20" width="10" height="10"/>
  <rect data-mat-uid="el_plain" x="40" width="10" height="10"/>
</svg>`;

const UIDS = ['el_outer', 'el_inner', 'el_btn', 'el_plain'];

interface Rig {
  mounted: MountedScreen;
  source: MemoryTagSource;
  host: FakeActionHost;
  modal: ModalRegistry;
  messages: Array<[string, string]>;
  status: StatusSink;
  el(uid: string): Element;
  bind(
    events: Array<{ elementUid: string; click: ElementAction }>,
    mode?: 'run' | 'edit',
  ): ReturnType<typeof bindSvgEvents>;
}

function rig(): Rig {
  const holder = document.createElement('div');
  document.body.append(holder);
  const mounted = mountScreen(holder, SVG, {
    viewBox: [0, 0, 100, 100],
    fitMode: 'contain',
    elements: UIDS.map((elementUid) => ({ elementUid })),
  });
  const source = new MemoryTagSource({ tags: [RUN], now: 1000 });
  source.set('RUN', { value: false, quality: 'GOOD' });
  const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
  const modal = new ModalRegistry();
  const messages: Array<[string, string]> = [];
  const status: StatusSink = { show: (m, k) => messages.push([m, k]) };
  let n = 0;
  return {
    mounted,
    source,
    host,
    modal,
    messages,
    status,
    el: (uid) => mounted.elements.get(uid)!,
    bind: (events, mode = 'run') =>
      bindSvgEvents({
        screenId: 'bon-nuoc',
        mounted,
        events,
        source,
        host,
        status,
        mode,
        modal,
        now: () => Date.now(),
        uuid: () => `uuid-${++n}`,
      }),
  };
}

const nav = (screen: string, label?: string): ElementAction => ({
  action: 'navigate',
  screen,
  ...(label ? { label } : {}),
});
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const dialog = () => document.body.querySelector<MatConfirmDialog>('mat-confirm-dialog');
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('bindSvgEvents: thuộc tính và mode', () => {
  it('đặt thuộc tính nhấp được lúc chạy', () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: nav('s2', 'Sang màn 2') }]);
    const el = r.el('el_btn') as SVGElement;
    expect(el.hasAttribute('data-mat-clickable')).toBe(true);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Sang màn 2');
    expect(el.style.cursor).toBe('pointer');
    expect(el.style.pointerEvents).toBe('all');
    expect(r.el('el_plain').hasAttribute('role')).toBe(false);
  });

  it("mode 'edit' không gắn gì", () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: nav('s2') }], 'edit');
    const el = r.el('el_btn');
    expect(el.hasAttribute('data-mat-clickable')).toBe(false);
    click(el);
    expect(r.host.calls).toEqual([]);
  });

  it('uid không có trong SVG thì bỏ qua, không ném lỗi', () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => r.bind([{ elementUid: 'el_ghost', click: nav('s2') }])).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('thêm quy tắc focus-visible vào Shadow DOM của item, gỡ khi dispose', () => {
    const r = rig();
    const b = r.bind([{ elementUid: 'el_btn', click: nav('s2') }]);
    const css = r.mounted.root.querySelector('style[data-mat-runtime]');
    expect(css?.textContent).toContain('[data-mat-clickable]:focus-visible');
    b.dispose();
    expect(r.mounted.root.querySelector('style[data-mat-runtime]')).toBeNull();
  });
});

describe('bindSvgEvents: hành động không ghi', () => {
  it('nhấp, Enter, Space; phím khác không làm gì', () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: nav('s2') }]);
    const el = r.el('el_btn');
    click(el);
    key(el, 'Enter');
    key(el, ' ');
    key(el, 'a');
    expect(r.host.calls).toEqual(['navigate:s2', 'navigate:s2', 'navigate:s2']);
  });

  it('popup và closePopup', () => {
    const r = rig();
    r.bind([
      { elementUid: 'el_btn', click: { action: 'popup', screen: 'p1' } },
      { elementUid: 'el_plain', click: { action: 'closePopup' } },
    ]);
    click(r.el('el_btn'));
    click(r.el('el_plain'));
    expect(r.host.calls).toEqual(['popup:p1', 'closePopup']);
  });

  it('phần tử sâu nhất thắng', () => {
    const r = rig();
    r.bind([
      { elementUid: 'el_outer', click: nav('outer') },
      { elementUid: 'el_inner', click: nav('inner') },
    ]);
    click(r.el('el_inner'));
    expect(r.host.calls).toEqual(['navigate:inner']);
    key(r.el('el_inner'), 'Enter');
    expect(r.host.calls).toEqual(['navigate:inner', 'navigate:inner']);
    click(r.el('el_outer'));
    expect(r.host.calls.at(-1)).toBe('navigate:outer');
  });

  it('ẩn: bỏ nhấp, tabindex -1, pointer-events none; hiện lại thì khôi phục', () => {
    const r = rig();
    const b = r.bind([{ elementUid: 'el_btn', click: nav('s2') }]);
    const el = r.el('el_btn') as SVGElement;
    el.style.visibility = 'hidden';
    b.refresh();
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.style.pointerEvents).toBe('none');
    click(el);
    key(el, 'Enter');
    expect(r.host.calls).toEqual([]);
    el.style.visibility = 'visible';
    b.refresh();
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.style.pointerEvents).toBe('all');
    click(el);
    expect(r.host.calls).toEqual(['navigate:s2']);
  });

  it('dispose gỡ sạch thuộc tính, trình nghe và <title> chạy', () => {
    const r = rig();
    const el = r.el('el_btn') as SVGElement;
    el.setAttribute('aria-label', 'cũ');
    const b = r.bind([{ elementUid: 'el_btn', click: nav('s2', 'Mới') }]);
    b.dispose();
    for (const a of ['data-mat-clickable', 'role', 'tabindex', 'data-mat-lock', 'aria-disabled'])
      expect(el.hasAttribute(a)).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('cũ');
    expect(el.style.cursor).toBe('');
    expect(el.style.pointerEvents).toBe('');
    click(el);
    expect(r.host.calls).toEqual([]);
  });
});

describe('bindSvgEvents: hành động ghi', () => {
  const pulse: ElementAction = {
    action: 'pulse',
    tag: 'RUN',
    value: true,
    durationMs: 500,
    confirm: 'always',
    label: 'Khởi động bơm 1',
  };

  it('nhấp mở hộp xác nhận, xác nhận mới ghi, kết quả ra vùng status', async () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: pulse }]);
    click(r.el('el_btn'));
    expect(r.host.writes).toHaveLength(0);
    const d = dialog();
    expect(d).not.toBeNull();
    d!.onConfirm!();
    expect(r.host.writes).toHaveLength(1);
    expect(r.host.writes[0]).toMatchObject({
      kind: 'pulse',
      pulseMs: 500,
      context: { screen: 'bon-nuoc', widget: 'el_btn' },
    });
    expect(r.el('el_btn').getAttribute('data-mat-lock')).toBe('BUSY');
    expect(r.messages.some(([m]) => m.includes('Đang gửi'))).toBe(true);
    r.host.resolve({ status: 'CONFIRMED' });
    await flush();
    expect(r.messages.at(-1)).toEqual([expect.stringContaining('Đã ghi và xác nhận'), 'ok']);
    expect(dialog()).toBeNull();
  });

  it('hủy hộp: không ghi, trả focus về phần tử', () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: pulse }]);
    click(r.el('el_btn'));
    dialog()!.onCancel!();
    expect(r.host.writes).toHaveLength(0);
    expect(dialog()).toBeNull();
  });

  it('khóa: thuộc tính, <title data-mat-runtime>, nhấp và Enter hiện lý do, không gửi gì', () => {
    const r = rig();
    r.host.sessionInfo = { user: 'v', role: 'viewer' };
    const b = r.bind([{ elementUid: 'el_btn', click: pulse }]);
    const el = r.el('el_btn') as SVGElement;
    expect(el.getAttribute('data-mat-lock')).toBe('ROLE');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.style.cursor).toBe('not-allowed');
    expect(el.style.filter).toContain('grayscale');
    const title = el.querySelector('title[data-mat-runtime]');
    expect(title?.textContent).toContain('Cần quyền operator');
    click(el);
    key(el, 'Enter');
    expect(dialog()).toBeNull();
    expect(r.host.writes).toHaveLength(0);
    expect(r.messages).toEqual([
      ['Cần quyền operator', 'warn'],
      ['Cần quyền operator', 'warn'],
    ]);
    // Phiên đổi: refresh() cập nhật khóa
    r.host.sessionInfo = { user: 'o', role: 'operator' };
    b.refresh();
    expect(el.hasAttribute('data-mat-lock')).toBe(false);
    expect(el.hasAttribute('aria-disabled')).toBe(false);
    expect(el.querySelector('title[data-mat-runtime]')).toBeNull();
    expect(el.style.cursor).toBe('pointer');
  });

  it('Tag đổi chất lượng thì khóa tự cập nhật (đăng ký nguồn)', () => {
    const r = rig();
    r.bind([{ elementUid: 'el_btn', click: pulse }]);
    r.source.set('RUN', { quality: 'BAD' });
    expect(r.el('el_btn').getAttribute('data-mat-lock')).toBe('QUALITY_BAD');
    r.source.set('RUN', { quality: 'GOOD' });
    expect(r.el('el_btn').hasAttribute('data-mat-lock')).toBe(false);
  });

  it('dispose khi đang mở hộp thì đóng hộp', () => {
    const r = rig();
    const b = r.bind([{ elementUid: 'el_btn', click: pulse }]);
    click(r.el('el_btn'));
    expect(dialog()).not.toBeNull();
    b.dispose();
    expect(dialog()).toBeNull();
    expect(r.modal.holder).toBeNull();
  });
});
