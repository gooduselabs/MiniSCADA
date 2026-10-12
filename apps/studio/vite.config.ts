import { defineConfig } from 'vite';
import process from 'node:process';
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// Chế độ `e2e` (feature 004, research R14): lớp gọi Tauri (`platform/tauri.ts`) được thay bằng lớp giả
// (`platform/mock.ts`) có project mẫu trong bộ nhớ, để chạy giao diện trên Chrome headless không cần
// Rust. Bản build e2e nằm ở dist-e2e/, không vào bộ cài.
// Feature 005: lớp nói chuyện với thiết bị (`platform/tauri-device.ts`) được thay bằng thiết bị giả
// (`platform/mock-device.ts`, điều khiển qua `window.__matMock.device`).
export default defineConfig(({ mode }) => ({
  resolve:
    mode === 'e2e'
      ? {
          alias: [
            { find: /^(.*)\/platform\/tauri\.ts$/, replacement: '$1/platform/mock.ts' },
            {
              find: /^(.*)\/platform\/tauri-device\.ts$/,
              replacement: '$1/platform/mock-device.ts',
            },
          ],
        }
      : undefined,
  build:
    mode === 'e2e'
      ? { outDir: process.env.MAT_E2E_OUT || 'dist-e2e', emptyOutDir: true }
      : undefined,
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
