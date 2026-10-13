// Kiểm luật lint chuỗi cứng và an toàn DOM của giao diện alarm (feature 009, T005, FR-067, SC-024, SC-020).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

async function ids(dir, fixture, asPath) {
  const code = readFileSync(resolve(ROOT, dir, fixture), 'utf8');
  const [r] = await eslint.lintText(code, { filePath: resolve(ROOT, asPath) });
  return r.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}
const bad = (where) => ids('tools/lint-fixtures-009', 'bad-text.ts', where);
const good = (where) => ids('tools/lint-fixtures-009', 'good-text.ts', where);

const GUARDED = [
  'apps/runtime-web/src/alarm/x.ts',
  'packages/ui-components/src/alarm/x.ts',
  'apps/studio/src/ui/editors/alarm-grid.ts',
];

for (const where of GUARDED) {
  test(`bắt chuỗi tiếng Việt cứng ở ${where}`, async () => {
    const r = await bad(where);
    assert.equal(r.filter((x) => x === 'no-restricted-syntax').length, 4);
  });
  test(`mẫu hợp lệ qua ở ${where}`, async () => {
    assert.deepEqual(await good(where), []);
  });
}

test('file i18n của trang và gói được phép chứa chuỗi tiếng Việt', async () => {
  for (const where of [
    'apps/runtime-web/src/alarm/i18n/x.ts',
    'apps/runtime-web/src/i18n/vi.ts',
    'packages/ui-components/src/i18n/alarm-vi.ts',
    'apps/studio/src/i18n/vi.ts',
  ]) {
    assert.deepEqual(await bad(where), [], where);
  }
});

test('luật an toàn DOM của 007 vẫn áp cho thư mục alarm', async () => {
  const r = await ids('tools/lint-fixtures-007', 'bad.ts', 'apps/runtime-web/src/alarm/x.ts');
  assert.equal(r.filter((x) => x === 'no-restricted-properties').length, 4);
  assert.ok(r.includes('no-eval'));
  assert.ok(r.includes('no-restricted-syntax'), 'setTimeout chuỗi vẫn bị bắt');
});
