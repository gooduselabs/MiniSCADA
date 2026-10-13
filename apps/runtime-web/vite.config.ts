import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Các bản build (Chromium >= 120 nên build thẳng ES2022):
//  - mặc định        → dist/        : trang runtime + lab.html (đo fixture Sprint 0, chỉ dùng dev/x64)
//  - --mode device   → dist-device/ : CHỈ trang runtime (index.html), là thứ được đóng gói lên BL335 (T058)
//  - --mode login    → dist-device/ : thêm login.html (feature 007, T072). Chạy SAU `--mode device` (không xóa thư mục).
//        Bundle riêng: rollup chia sẻ chunk giữa các đầu vào của cùng một lần build, mà trang `/login` phải chạy được với
//        nguồn không phiên khi `viewerAccess: private` (chỉ `/assets/login-*` được mở), nên login build lượt riêng và
//        mọi tệp mang tiền tố `login-`; package-web.mjs kiểm login.html chỉ tham chiếu `assets/login-*`.
//  - --mode e2e      → dist-e2e/    : như device, dùng cho test giao diện trên Chrome headless (tests/e2e).
// `npm run dev` proxy API/WebSocket tới mat-runtime chạy cục bộ (deployment/toolchain/run-x64.ps1).
export default defineConfig(({ mode }) => {
  const device = mode === 'device';
  const login = mode === 'login';
  const e2e = mode === 'e2e';
  const target = process.env.MAT_RUNTIME_URL ?? 'http://localhost:8080';
  const root = import.meta.dirname;
  return {
    base: './',
    build: {
      outDir: device || login ? 'dist-device' : e2e ? 'dist-e2e' : 'dist',
      target: 'es2022',
      sourcemap: false,
      emptyOutDir: !login,
      rollupOptions: {
        input: login
          ? { login: resolve(root, 'login.html') }
          : device || e2e
            ? { index: resolve(root, 'index.html') }
            : { index: resolve(root, 'index.html'), lab: resolve(root, 'lab.html') },
        ...(login
          ? {
              output: {
                entryFileNames: 'assets/login-[hash].js',
                chunkFileNames: 'assets/login-[name]-[hash].js',
                assetFileNames: 'assets/login-[hash][extname]',
              },
            }
          : {}),
      },
    },
    server: {
      proxy: {
        '/api/v1/live': { target: target.replace(/^http/, 'ws'), ws: true },
        '/api': target,
        '/project': target,
      },
    },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
  };
});
