// Spike R2 (feature 012, T037): build trang mẫu biểu đồ. Ra thư mục tạm do run.mjs truyền (MAT_R2_OUT), không commit.
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
  },
});
