// Lớp platform chạy trong Tauri (feature 004, contracts/tauri-commands.md). Ở chế độ build `e2e`, Vite thay
// file này bằng `mock.ts` (vite.config.ts), nên mọi chỗ trong Studio import `platform` từ đây.
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  asBackupFailure,
  asReadFailure,
  asRemoveFailure,
  asWriteFailure,
  ipcError,
  type AppInfo,
  type BackupOutcome,
  type CsvOpenOutcome,
  type CsvSaveOutcome,
  type PickResult,
  type Platform,
  type ReadOutcome,
  type RecentEntry,
  type RecentFailure,
  type RemoveOutcome,
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
  async projectBackup(files, label): Promise<BackupOutcome> {
    try {
      return await invoke<{ dir: string; abs: string }>('project_backup', { files, label });
    } catch (e) {
      return asBackupFailure(e);
    }
  },
  async projectRemove(rel, hash): Promise<RemoveOutcome> {
    try {
      await invoke('project_remove', { rel, hash });
      return { ok: true };
    } catch (e) {
      return asRemoveFailure(e);
    }
  },
  async csvOpen(): Promise<CsvOpenOutcome> {
    try {
      const r = await invoke<{ name: string; bytes: number[] } | null>('csv_open');
      return r ? { name: r.name, bytes: Uint8Array.from(r.bytes) } : null;
    } catch (e) {
      const err = ipcError(e);
      return err?.code === 'too-large'
        ? { error: 'too-large' }
        : { error: 'io', detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) };
    }
  },
  async csvSave(suggestedName, text): Promise<CsvSaveOutcome> {
    try {
      return await invoke<{ name: string } | null>('csv_save', { suggestedName, text });
    } catch (e) {
      const err = ipcError(e);
      return { error: 'io', detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) };
    }
  },
  async reportSave(suggestedName, bytes, ext): Promise<CsvSaveOutcome> {
    try {
      return await invoke<{ name: string } | null>('report_save', {
        suggestedName,
        bytes: Array.from(bytes),
        ext,
      });
    } catch (e) {
      const err = ipcError(e);
      return { error: 'io', detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) };
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
