import { defineConfig } from 'vitest/config';

// jsdom chỉ cấp DOMParser cho cổng DOM của parse.ts (bộ lọc của feature 008); mô hình và lệnh không dùng DOM.
export default defineConfig({ test: { environment: 'jsdom', include: ['src/**/*.test.ts'] } });
