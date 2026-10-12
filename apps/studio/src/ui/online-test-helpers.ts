// Thiết bị giả cho test giao diện của phần Online (feature 005, US1): StudioApp chạy trên DeviceLink giả
// (platform/mock-device.ts), mật khẩu thử sinh ngẫu nhiên mỗi lần chạy (không ghi vào repo). Không vào bản
// build: chỉ file *.test.ts import.
import { StudioApp } from '../app/app.ts';
import type { StorageLike } from '../app/workspace.ts';
import { isDeviceError, type KnownDevice } from '../platform/device-types.ts';
import { createMockDevice, type MockDevice } from '../platform/mock-device.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';

export const ACCOUNTS = ['kysu1', 'xem1', 'admin'] as const;

/** Chuỗi ngẫu nhiên cho mật khẩu thử (≥ 15 ký tự như luật mật khẩu của thiết bị). */
export function randomPassword(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `thu-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface OnlineEnv {
  app: StudioApp;
  platform: MockPlatform;
  dev: MockDevice;
  /** Mật khẩu của tài khoản giả. */
  pw(user: string): string;
}

/** Thiết lập cục bộ trong bộ nhớ (thay localStorage): xem được khóa và giá trị đã ghi. */
export function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** App có DeviceLink giả; mặc định đã mở project mẫu, không có thiết lập cục bộ. */
export async function newOnlineApp(
  opts: { open?: boolean; width?: number; storage?: StorageLike | null } = {},
): Promise<OnlineEnv> {
  const platform = createMockPlatform();
  const dev = createMockDevice({ latency: false });
  const base = randomPassword();
  const pw = (user: string) => `${base}-${user}`;
  for (const u of ACCOUNTS) dev.control.setPassword(u, pw(u));
  const app = new StudioApp({
    platform,
    link: dev,
    storage: opts.storage ?? null,
    windowWidth: opts.width ?? 1400,
  });
  await app.start();
  if (opts.open !== false) {
    await app.run('project.open');
    await app.store.idle();
  }
  return { app, platform, dev, pw };
}

/** Thiết bị giả đã lưu (tên như gói tìm) và đã ghim (như lần Online trước). */
export async function pinnedDevice(dev: MockDevice, name: string): Promise<KnownDevice> {
  const added = await dev.addDevice({ host: dev.control.device(name).ip, name });
  if (isDeviceError(added)) throw new Error(added.error);
  const p = await dev.probe(added.id);
  if (isDeviceError(p)) throw new Error(p.error);
  const pinned = await dev.pin(added.id, p.fingerprint);
  if (isDeviceError(pinned)) throw new Error(pinned.error);
  return pinned;
}

/** Nhập chữ vào ô như người dùng gõ (sự kiện input). */
export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const textOf = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  );
}
