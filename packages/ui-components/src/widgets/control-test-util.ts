// Công cụ dùng chung cho test widget điều khiển (không thuộc bản phát hành).
import type { WidgetItem } from '@mat/project-schema';
import { expect } from 'vitest';
import type { MatConfirmDialog } from '../control/confirm-dialog.ts';
import { ModalRegistry } from '../control/modal-registry.ts';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';

export const SP: TagInfo = {
  id: 'SP',
  type: 'FLOAT32',
  access: 'RW',
  kind: 'external',
  unit: 'bar',
  description: 'Áp suất đặt',
  limits: { min: 0, max: 100 },
  deviceName: 'PLC1',
};
export const RUN: TagInfo = {
  id: 'RUN',
  type: 'BOOL',
  access: 'RW',
  kind: 'external',
  description: 'Chạy bơm',
};
export const MODE: TagInfo = {
  id: 'MODE',
  type: 'UINT16',
  access: 'RW',
  kind: 'external',
  valueTable: 'MODE',
  description: 'Chế độ',
};

export interface Env {
  source: MemoryTagSource;
  host: FakeActionHost;
  modal: ModalRegistry;
}

export function makeEnv(): Env {
  const source = new MemoryTagSource({
    tags: [SP, RUN, MODE],
    tables: {
      MODE: {
        entries: [
          { value: 0, text: 'Dừng' },
          { value: 1, text: 'Chạy' },
          { value: 2, text: 'Tự động' },
        ],
      },
    },
    now: 1000,
  });
  source.set('SP', { value: 10, quality: 'GOOD' });
  source.set('RUN', { value: false, quality: 'GOOD' });
  source.set('MODE', { value: 1, quality: 'GOOD' });
  const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
  return { source, host, modal: new ModalRegistry() };
}

export interface MountOpts {
  tag?: string;
  props?: WidgetItem['props'];
  events?: WidgetItem['events'];
  security?: WidgetItem['security'];
  mode?: 'run' | 'edit';
  noTarget?: boolean;
}

export async function mount<E extends HTMLElement>(
  env: Env,
  name: string,
  o: MountOpts = {},
): Promise<E> {
  const el = document.createElement(`mat-w-${name}`);
  const set = (k: string, v: unknown) => void ((el as unknown as Record<string, unknown>)[k] = v);
  const item: WidgetItem = {
    id: 'w1',
    type: 'widget',
    widget: name,
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    ...(o.noTarget ? {} : { tags: { target: o.tag ?? 'SP' } }),
    ...(o.props ? { props: o.props } : {}),
    ...(o.events ? { events: o.events } : {}),
    ...(o.security ? { security: o.security } : {}),
  };
  set('item', item);
  set('source', env.source);
  set('host', env.host);
  set('modal', env.modal);
  set('mode', o.mode ?? 'run');
  set('context', { screen: 's1', widget: 'w1' });
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as E;
}

export const settle = async (el?: HTMLElement): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete?: Promise<unknown> } | undefined)?.updateComplete;
};

export const dialog = (): MatConfirmDialog | null =>
  document.body.querySelector('mat-confirm-dialog');
export const dialogBtn = (which: 'ok' | 'cancel'): HTMLButtonElement =>
  dialog()!.shadowRoot!.querySelector<HTMLButtonElement>(
    which === 'ok' ? '[data-ok]' : '[data-cancel]',
  )!;

export const bannerText = (el: HTMLElement): string =>
  el.shadowRoot!.querySelector('mat-result-banner')!.shadowRoot!.textContent ?? '';

export const lockText = (el: HTMLElement): string =>
  el.shadowRoot!.querySelector('.lockmsg')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Các lý do khóa: [tên, dựng điều kiện trước khi mount, chữ mong đợi]. */
export function lockScenarios(tag: string): Array<[string, (e: Env) => void, string]> {
  const info = (e: Env) => e.source.info(tag)!;
  return [
    ['NO_SESSION', (e) => void (e.host.sessionInfo = null), 'Đăng nhập để điều khiển'],
    [
      'ROLE',
      (e) => void (e.host.sessionInfo = { user: 'v', role: 'viewer' }),
      'Cần quyền operator',
    ],
    [
      'INSECURE',
      (e) => void (e.host.blocked = { code: 'INSECURE', message: 'Mở bằng HTTPS để điều khiển' }),
      'Mở bằng HTTPS để điều khiển',
    ],
    [
      'HTTPS_DOWN',
      (e) => void (e.host.blocked = { code: 'HTTPS_DOWN', message: 'HTTPS không chạy' }),
      'HTTPS không chạy',
    ],
    [
      'SESSION_EXPIRED',
      (e) => void (e.host.blocked = { code: 'SESSION_EXPIRED', message: 'Phiên đã hết hạn' }),
      'Phiên đã hết hạn',
    ],
    ['LIVE_LOST', (e) => e.source.setConnection('stale'), 'Mất kết nối dữ liệu'],
    ['TAG_UNKNOWN', (e) => e.source.set(tag, { quality: 'UNKNOWN' }), 'Tag không có trên thiết bị'],
    ['TAG_READONLY', (e) => e.source.define({ ...info(e), access: 'R' }), 'Tag chỉ đọc'],
    ['QUALITY_BAD', (e) => e.source.set(tag, { quality: 'BAD' }), 'Quality BAD'],
    ['QUALITY_STALE', (e) => e.source.set(tag, { quality: 'STALE' }), 'Quality STALE'],
    ['NO_VALUE', (e) => e.source.set(tag, { value: null }), 'Chưa có giá trị'],
  ];
}

export function expectLiveRegion(el: HTMLElement): void {
  const b = el.shadowRoot!.querySelector('mat-result-banner');
  expect(b).not.toBeNull();
  expect(b!.shadowRoot!.querySelector('[aria-live="polite"]')).not.toBeNull();
}
