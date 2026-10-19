import { defineConfig } from 'vitest/config';

// css.include: nội dung thật của `styles/**/*.css?raw` (token, chủ đề) trong test (feature 012, themes.test.ts); mặc định
// Vitest thay mọi CSS bằng chuỗi rỗng.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    css: { include: [/src[/\\]styles[/\\]/] },
  },
});
