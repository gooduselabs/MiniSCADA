// Test `tools/docs-check.mjs` (feature 011, T176; FR-130, SC-038).
//
// Thư mục mẫu `tools/docs-check-fixtures/broken/` là một "repo thu nhỏ" (server/, schemas/, tools/, deployment/,
// docs/, specs/) có đúng một tập lỗi đã biết: liên kết hỏng, neo hỏng, tệp không có, cờ CLI không có, tham số script
// không có, script không có, mã lỗi không có trong danh mục, tiêu đề lặp; cùng các dòng đúng phải không bị báo.
// Ca cuối chạy công cụ trên repo thật: tài liệu của repo phải sạch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { anchorsOf, checkTree, psParams, slugify } from './docs-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'docs-check-fixtures/broken');
const tool = join(here, 'docs-check.mjs');

test('neo kiểu GitHub giữ chữ có dấu, bỏ dấu câu và mã nội dòng', () => {
  assert.equal(slugify('Đăng nhập và khóa tạm'), 'đăng-nhập-và-khóa-tạm');
  assert.equal(slugify('5b. HTTPS, tài khoản (feature 005)'), '5b-https-tài-khoản-feature-005');
  assert.equal(slugify('Cờ `--user-add`'), 'cờ---user-add');
  const { anchors, duplicates } = anchorsOf(
    '# A\n\n## A\n\n```\n# không phải tiêu đề\n```\n<a id="x"></a>\n',
  );
  assert.deepEqual([...anchors].sort(), ['a', 'a-1', 'x']);
  assert.equal(duplicates.length, 1);
});

test('tham số PowerShell lấy từ khối param()', () => {
  const p = psParams(
    "# x\nparam([string]$BuildDir = '', [switch]$Clean, [int]$N = (1 + 2))\n$Other = 1",
  );
  assert.deepEqual([...p].sort(), ['builddir', 'clean', 'n']);
});

test('thư mục mẫu: báo đúng và đủ các lỗi đã cài, không báo dòng đúng', () => {
  const { findings } = checkTree(fixture);
  const got = findings.map((f) => `${f.file}:${f.line}:${f.kind}:${f.message}`).sort();
  const g = 'docs/user/guide.md';
  const expected = [
    `${g}:5:LINK:liên kết hỏng: khong-co.md`,
    `${g}:5:ANCHOR:không có tiêu đề cho neo #khong-co-neo trong docs/user/ok.md`,
    `${g}:9:FILE:tệp không có: tools/khong-co.mjs`,
    `${g}:11:CODE:mã E_KHONG_CO không có trong schemas/error-codes.json`,
    `${g}:11:CODE:mã KHONG_CO_MA không có trong schemas/error-codes.json`,
    `${g}:11:CODE:mã MA_LA không có trong schemas/error-codes.json`,
    `${g}:13:CLI:mat-runtime không có cờ --khong-co`,
    `${g}:17:CLI:mat-runtime không có cờ --bad-flag`,
    `${g}:20:CLI:mat-runtime không có cờ --test-only-flag`,
    `${g}:23:CLI:deploy.sh không có cờ --force`,
    `${g}:28:CLI:./tools/build-x.ps1 không có tham số -Fast`,
    `${g}:29:CLI:script ./tools/khong-co.ps1 không có trong repo`,
    `${g}:31:CLI:release.ps1 không có tham số -Sign`,
    `${g}:34:HEADING:tiêu đề lặp: "Mục A" (#mục-a)`,
    'specs/001-x/spec.md:3:LINK:liên kết hỏng: ../../docs/user/khong-co.md',
  ].sort();
  assert.deepEqual(got, expected);
});

test('mã thoát: 1 khi có lỗi, JSON đọc được', () => {
  const r = spawnSync(process.execPath, [tool, '--root', fixture, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.findings.length, 15);
  const bad = spawnSync(process.execPath, [tool, '--khong-co'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('tài liệu của repo sạch (FR-130)', () => {
  const r = spawnSync(process.execPath, [tool], { encoding: 'utf8', cwd: resolve(here, '..') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
