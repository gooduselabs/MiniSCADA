// Test của tools/gen-widget-docs.mjs (feature 007, T140): README sinh từ danh mục, cùng danh mục thì cùng byte, và
// README đã commit không lệch danh mục.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'tools/gen-widget-docs.mjs');

test('README đã commit khớp danh mục (--check)', () => {
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('README có đủ 17 widget của danh mục', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'schemas/widgets.catalog.json'), 'utf8'));
  const text = readFileSync(join(root, 'packages/ui-components/README.md'), 'utf8');
  assert.equal(catalog.widgets.length, 17);
  for (const w of catalog.widgets) assert.ok(text.includes(`### \`${w.id}\``), w.id);
});
