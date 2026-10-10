// ProjectSource đọc qua lệnh Rust `project_read` (chỉ trong thư mục người dùng đã chọn).
import { invoke } from '@tauri-apps/api/core';
import type { ProjectSource } from '@mat/project-schema';

export class TauriProjectSource implements ProjectSource {
  async readText(rel: string): Promise<string | null> {
    try {
      return await invoke<string | null>('project_read', { rel });
    } catch {
      return null; // đường dẫn bị từ chối hoặc lỗi đọc: bộ kiểm tra báo E_FILE_MISSING/E_PATH
    }
  }
}

export const pickProject = () => invoke<string | null>('project_pick');
export const writeProjectFile = (rel: string, content: string) =>
  invoke<void>('project_write', { rel, content });
export const openDeviceWeb = (url: string) => invoke<void>('open_device_web', { url });
