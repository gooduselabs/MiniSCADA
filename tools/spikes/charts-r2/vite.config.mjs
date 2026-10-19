// Spike R2 (feature 012, T037): build trang mẫu biểu đồ. Ra thư mục tạm do run.mjs truyền (MAT_R2_OUT), không commit.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: process.env.MAT_R2_OUT ?? 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        uplot: resolve(import.meta.dirname, 'uplot-bench.html'),
      },
    },
  },
});
