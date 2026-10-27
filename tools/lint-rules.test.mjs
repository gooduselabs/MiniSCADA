// Kiểm luật lint an toàn DOM của trang vận hành và @mat/ui-components (feature 007, T008, SC-020).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

async function ids(fixture, asPath) {
  const code = readFileSync(resolve(ROOT, 'tools/lint-fixtures-007', fixture), 'utf8');
  const [r] = await eslint.lintText(code, { filePath: resolve(ROOT, asPath) });
  return r.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

// 007: trang vận hành và ui-components; 008 (T009, SC-021): bốn package xử lý SVG.
for (const where of [
  'apps/runtime-web/src/x.ts',
  'packages/ui-components/src/x.ts',
  'packages/svg-import/src/x.ts',
  'packages/svg-renderer/src/x.ts',
  'packages/binding-engine/src/x.ts',
  // 011 (T014, SC-034): logic v2.
  'apps/studio/src/ui/logic/x.ts',
  'packages/logic-engine/src/x.ts',
]) {
  test(`bắt mẫu vi phạm ở ${where}`, async () => {
    const r = await ids('bad.ts', where);
    assert.equal(r.filter((x) => x === 'no-restricted-properties').length, 4);
    assert.ok(r.includes('no-eval'));
    assert.ok(r.includes('no-new-func'));
    assert.ok(r.includes('no-implied-eval') || r.includes('no-restricted-syntax'));
    assert.ok((await ids('unsafe.ts', where)).includes('no-restricted-imports'));
  });
  test(`mẫu hợp lệ qua ở ${where}`, async () => {
    assert.deepEqual(await ids('good.ts', where), []);
  });
}
