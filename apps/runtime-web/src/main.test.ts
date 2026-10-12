// Trang xem (main.ts) khi thiết bị chưa có project hợp lệ (feature 005, T104a, Constitution IV): không mở WebSocket,
// để không chiếm 1 trong 10 phiên dữ liệu sống; hỏi lại /api/v1/projects/active mỗi 5 s cộng ngẫu nhiên 0–1 s; có
// project thì tải lại trang đúng một lần. Chạy main.ts thật trên DOM của index.html, với fetch, WebSocket, location
// và đồng hồ giả.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_MESSAGE, WAIT_BADGE, WAIT_MESSAGE } from './reload.ts';

const HTML = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');

/** DOM của index.html, bỏ thẻ script (main.ts do test nạp). */
function mountPage(): void {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  for (const s of doc.querySelectorAll('script')) s.remove();
  document.body.replaceWith(document.importNode(doc.body, true));
}

const byId = (id: string) => document.getElementById(id)!;
const text = (id: string) => byId(id).textContent ?? '';

interface Answer {
  status: number;
  body: unknown;
}

const NO_PROJECT: Answer = {
  status: 503,
  body: {
    error: 'NO_VALID_PROJECT',
    errors: [{ code: 'E_SCHEMA', file: 'project.json', path: '/entryScreen', message: 'lỗi thử' }],
  },
};
const PROJECT: Answer = {
  status: 200,
  body: {
    project: { projectId: 'tank-demo', projectVersion: '0.1.0', entryScreen: 'main' },
    tags: { tags: [] },
    screens: {},
  },
};

describe('trang xem khi thiết bị chưa có project hợp lệ (T104a)', () => {
  let answer: Answer = NO_PROJECT;
  let reloads = 0;
  const sockets: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    void url;
    const { status, body } = answer;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mountPage();
    answer = NO_PROJECT;
    reloads = 0;
    sockets.length = 0;
    fetchMock.mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(url: string) {
          sockets.push(url);
        }
        send() {}
        close() {}
      },
    );
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'bl335:8080',
      search: '',
      reload: () => reloads++,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('503: hiện lỗi, "Chờ project"; không mở WebSocket; hỏi lại mỗi 5–6 s; có project thì tải lại đúng một lần', async () => {
    await import('./main.ts');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/v1/projects/active']);
    expect(byId('app-errors').hidden).toBe(false);
    expect(text('app-errors-title')).toBe('Không có project hợp lệ trên thiết bị');
    expect(text('app-errors-list')).toContain('E_SCHEMA');
    expect(text('app-live')).toBe(WAIT_BADGE);
    expect(byId('app-reload').hidden).toBe(false);
    expect(text('app-reload')).toBe(WAIT_MESSAGE);
    expect(sockets).toEqual([]);

    // random 0,5 → mỗi lượt 5,5 s
    await vi.advanceTimersByTimeAsync(5499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every((c) => c[0] === '/api/v1/projects/active')).toBe(true);
    expect(sockets).toEqual([]);
    expect(reloads).toBe(0);

    answer = PROJECT;
    await vi.advanceTimersByTimeAsync(5500);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(reloads).toBe(1);
    expect(text('app-reload')).toBe(RELOAD_MESSAGE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(reloads).toBe(1);
    expect(sockets).toEqual([]);
  });
});
