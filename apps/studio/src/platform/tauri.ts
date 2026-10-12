// Lớp platform chạy trong Tauri (feature 004, contracts/tauri-commands.md). Ở chế độ build `e2e`, Vite thay
// file này bằng `mock.ts` (vite.config.ts), nên mọi chỗ trong Studio import `platform` từ đây.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  asReadFailure,
  asWriteFailure,
  ipcError,
  type AppInfo,
  type PickResult,
  type Platform,
  type ReadOutcome,
  type RecentEntry,
  type RecentFailure,
  type WriteOutcome,
} from './types.ts';

export const tauriPlatform: Platform = {
  kind: 'tauri',
  appInfo: () => invoke<AppInfo>('app_info'),
  pickProject: () => invoke<PickResult | null>('project_pick'),
  recentProjects: () => invoke<RecentEntry[]>('project_recent'),
  async openRecent(index) {
    try {
      return await invoke<PickResult>('project_open_recent', { index });
    } catch (e) {
      const code = ipcError(e)?.code;
      return { error: (code === 'no-such-entry' ? code : 'missing') as RecentFailure };
    }
  },
  async forgetRecent(index) {
    await invoke('project_forget_recent', { index });
  },
  async read(rel): Promise<ReadOutcome> {
    try {
      return await invoke<{ text: string; hash: string }>('project_read', { rel });
    } catch (e) {
      return { error: asReadFailure(e) };
    }
  },
  async write(rel, content, expectedHash, force): Promise<WriteOutcome> {
    try {
      return await invoke<{ hash: string }>('project_write', { rel, content, expectedHash, force });
    } catch (e) {
      return asWriteFailure(e);
    }
  },
  async openDeviceWeb(url) {
    await invoke('open_device_web', { url });
  },
  onCloseRequested(handler) {
    const win = getCurrentWindow();
    void win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await handler()) await win.destroy();
    });
  },
  async setTitle(title) {
    await getCurrentWindow().setTitle(title);
  },
};

export const platform: Platform = tauriPlatform;
