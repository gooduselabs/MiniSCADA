// ESLint cho mã TypeScript/JavaScript (Constitution: ESLint + Prettier + clang-format bắt buộc trong CI).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Chữ tiếng Việt có dấu: Latin-1 (à, é, ô…), Ă ă Đ đ Ĩ ĩ Ũ ũ Ơ ơ Ư ư, và khối Latin Extended Additional.
const VIETNAMESE =
  '[\\u00C0-\\u00FF\\u0102\\u0103\\u0110\\u0111\\u0128\\u0129\\u0168\\u0169\\u01A0\\u01A1\\u01AF\\u01B0\\u1EA0-\\u1EF9]';
const UI_TEXT_MESSAGE =
  'Chuỗi giao diện đặt trong apps/studio/src/i18n và lấy bằng t() (feature 004, FR-014)';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    'build/**',
    'third_party/**',
    'apps/studio/src-tauri/**',
    '**/dist-device/**',
    '**/dist-e2e*/**',
    // Mẫu vi phạm có chủ đích, chỉ dùng trong src/lint-rules.test.ts
    'apps/studio/tests/lint-fixtures/**',
    'tools/lint-fixtures-007/**',
    'tools/lint-fixtures-009/**',
    // Vector và kết quả sinh lúc chạy test (feature 005), không commit
    'tests/package-vectors/out/**',
    'tests/device-it/out/**',
    'tests/web-it/out/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Gồm cả script Node của tests/{project-vectors,package-vectors,discovery-vectors,device-it}.
    files: ['**/*.test.ts', '**/*.mjs', '**/vite.config.ts', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Script đo và test e2e điều khiển Chrome: callback của page.evaluate() chạy trong trình duyệt.
    files: [
      'tools/measure/**/*.mjs',
      'apps/studio/tests/e2e/**/*.mjs',
      'tests/device-it/**/*.mjs',
      'tests/web-it/**/*.mjs',
    ],
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
  {
    // Studio: không chèn HTML thô (Constitution V, ADR-009). Lit chỉ được gắn dữ liệu qua template.
    files: ['apps/studio/src/**/*.ts'],
    ignores: ['apps/studio/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['lit/directives/unsafe-*'],
              message: 'Không chèn HTML/SVG thô vào giao diện Studio (Constitution V, ADR-009)',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Dùng textContent hoặc template Lit (Constitution V)' },
        { property: 'outerHTML', message: 'Dùng textContent hoặc template Lit (Constitution V)' },
        { property: 'insertAdjacentHTML', message: 'Dùng template Lit (Constitution V)' },
      ],
    },
  },
  {
    // Studio: chuỗi giao diện tiếng Việt chỉ nằm trong src/i18n (FR-014). Chú thích thì được phép.
    files: ['apps/studio/src/**/*.ts'],
    ignores: [
      'apps/studio/src/**/*.test.ts',
      'apps/studio/src/i18n/**',
      // Dữ liệu giả và bộ điều hợp chỉ dùng trong test/e2e, không phải giao diện.
      'apps/studio/src/platform/mock-device-006.ts',
      'apps/studio/src/model/grid/test-adapter.ts',
      'apps/studio/src/model/alarm-fixtures.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=/${VIETNAMESE}/]`, message: UI_TEXT_MESSAGE },
        { selector: `TemplateElement[value.raw=/${VIETNAMESE}/]`, message: UI_TEXT_MESSAGE },
      ],
    },
  },
  {
    // Trang vận hành và thư viện widget (feature 007, FR-022, SC-020): không chèn HTML thô, không đánh giá chuỗi.
    files: ['apps/runtime-web/src/**/*.ts', 'packages/ui-components/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['lit/directives/unsafe-*'],
              message: 'Không chèn HTML/SVG thô vào trang vận hành (Constitution V, SC-020)',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Dùng textContent hoặc template Lit (SC-020)' },
        { property: 'outerHTML', message: 'Dùng textContent hoặc template Lit (SC-020)' },
        { property: 'insertAdjacentHTML', message: 'Dùng template Lit (SC-020)' },
        { object: 'document', property: 'write', message: 'Không dùng document.write (SC-020)' },
        {
          object: 'document',
          property: 'writeln',
          message: 'Không dùng document.writeln (SC-020)',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type='Literal']",
          message: 'Không truyền chuỗi cho setTimeout/setInterval (SC-020)',
        },
      ],
    },
  },
  {
    // Giao diện alarm (feature 009, T005, FR-067, SC-024): chuỗi tiếng Việt chỉ ở file i18n.
    // Khối này đặt sau khối của 007 nên lặp lại luật setTimeout (cùng khóa no-restricted-syntax).
    files: ['apps/runtime-web/src/alarm/**/*.ts', 'packages/ui-components/src/alarm/**/*.ts'],
    ignores: ['**/*.test.ts', '**/i18n/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type='Literal']",
          message: 'Không truyền chuỗi cho setTimeout/setInterval (SC-020)',
        },
        {
          selector: `Literal[value=/${VIETNAMESE}/]`,
          message: 'Chuỗi giao diện alarm đặt trong file i18n (FR-067, SC-024)',
        },
        {
          selector: `TemplateElement[value.raw=/${VIETNAMESE}/]`,
          message: 'Chuỗi giao diện alarm đặt trong file i18n (FR-067, SC-024)',
        },
      ],
    },
  },
]);
