// Tiện ích cho test thành phần giao diện (Vitest + jsdom). Không vào bản build: chỉ file *.test.ts import.
import { StudioApp } from '../app/app.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import type { AppElement } from './base.ts';

export async function newApp(
  opts: { open?: boolean; width?: number; versionGate?: boolean } = {},
): Promise<{ app: StudioApp; platform: MockPlatform }> {
  const platform = createMockPlatform();
  const app = new StudioApp({
    platform,
    storage: null,
    windowWidth: opts.width ?? 1400,
    versionGate: opts.versionGate ?? false,
  });
  await app.start();
  if (opts.open !== false) {
    await app.run('project.open');
    await app.store.idle();
  }
  return { app, platform };
}

/** Gắn thành phần vào document và chờ vẽ xong. */
export async function mount<T extends AppElement>(tag: string, app: StudioApp): Promise<T> {
  const el = document.createElement(tag) as T;
  el.app = app;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Chờ mọi thành phần Lit trong cây vẽ xong (sau khi app báo đổi). */
export async function settled(root: ParentNode = document): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const els = [root, ...root.querySelectorAll('*')].filter(
      (e): e is AppElement => e instanceof HTMLElement && 'updateComplete' in e,
    );
    await Promise.all(els.map((e) => e.updateComplete));
  }
}

export function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): boolean {
  return target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

export function cleanup(): void {
  document.body.replaceChildren();
}

/** Như `newApp`, nhưng mở project 0.2 đầy đủ của bộ vector chung (kênh TCP và RTU, 13 Tag, bảng giá trị, bảng theo dõi). */
export async function newApp02(
  opts: {
    width?: number;
    files?: Record<string, string>;
    session?: ConstructorParameters<typeof StudioApp>[0]['session'];
    storage?: ConstructorParameters<typeof StudioApp>[0]['storage'];
  } = {},
): Promise<{ app: StudioApp; platform: MockPlatform }> {
  const { full02 } = await import('../model/test-fixtures.ts');
  const platform = createMockPlatform();
  platform.control.useProject(opts.files ?? full02(), 'D:/Projects/full-02');
  const app = new StudioApp({
    platform,
    storage: opts.storage ?? null,
    windowWidth: opts.width ?? 1400,
    versionGate: false,
    ...(opts.session ? { session: opts.session } : {}),
  });
  await app.start();
  await app.run('project.open');
  await app.store.idle();
  return { app, platform };
}
