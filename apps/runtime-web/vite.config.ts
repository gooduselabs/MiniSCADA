import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Hai bản build (Chromium >= 120 nên build thẳng ES2022):
//  - mặc định  → dist/        : trang runtime + lab.html (đo fixture Sprint 0, chỉ dùng dev/x64)
//  - --mode device → dist-device/ : CHỈ trang runtime, là thứ được đóng gói lên BL335 (T058)
// `npm run dev` proxy API/WebSocket tới mat-runtime chạy cục bộ (deployment/toolchain/run-x64.ps1).
export default defineConfig(({ mode }) => {
  const device = mode === 'device';
  const target = process.env.MAT_RUNTIME_URL ?? 'http://localhost:8080';
  return {
    base: './',
    build: {
      outDir: device ? 'dist-device' : 'dist',
      target: 'es2022',
      sourcemap: false,
      emptyOutDir: true,
      rollupOptions: {
        input: device
          ? { index: resolve(import.meta.dirname, 'index.html') }
          : {
              index: resolve(import.meta.dirname, 'index.html'),
              lab: resolve(import.meta.dirname, 'lab.html'),
            },
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
