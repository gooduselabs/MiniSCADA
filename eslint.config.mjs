// ESLint cho mã TypeScript/JavaScript (Constitution: ESLint + Prettier + clang-format bắt buộc trong CI).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    'build/**',
    'third_party/**',
    'apps/studio/src-tauri/**',
    '**/dist-device/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.test.ts', '**/*.mjs', '**/vite.config.ts', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Script đo điều khiển Chrome: callback của page.evaluate() chạy trong trình duyệt.
    files: ['tools/measure/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      // Constitution V: không eval/new Function, không chạy script tùy ý.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
]);
