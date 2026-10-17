// Test `tools/build-docs.mjs` (feature 011, T178; FR-133): tài liệu HTML đi kèm bộ cài không dẫn ra ngoài, nhúng ảnh
// nội bộ, đổi liên kết `.md` thành `.html`, thoát HTML lạ; dựng trên tài liệu thật của repo mọi liên kết nội bộ trỏ tới
// trang có thật.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { buildDocs } from './build-docs.mjs';

// PNG 1×1 trong suốt
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('chuyển Markdown mẫu: liên kết, ảnh, bảng, mã, HTML lạ', () => {
  const root = mkdtempSync(join(tmpdir(), 'mat-build-docs-'));
  try {
    mkdirSync(join(root, 'docs/user/img'), { recursive: true });
    mkdirSync(join(root, 'docs/training'), { recursive: true });
    writeFileSync(join(root, 'docs/user/img/a.png'), PNG);
    writeFileSync(join(root, 'docs/training/operator.md'), '# Vận hành\n\n## Bài 1\n');
    writeFileSync(
      join(root, 'docs/user/README.md'),
      [
        '# Tài liệu',
        '',
        '<!-- chú thích không ra HTML -->',
        'Xem [vận hành](../training/operator.md#bài-1), [web](https://example.com/x), [mã](../../server/main.cpp).',
        '',
        '![sơ đồ](img/a.png) ![ngoài](https://example.com/a.png)',
        '',
        '| Mã | Ý nghĩa |',
        '|---|---|',
        '| `A\\|B` | **đậm** và *nghiêng* |',
        '',
        '- mục 1',
        '  - mục con',
        '- [x] đã làm',
        '',
        '1. bước một',
        '2. bước hai',
        '',
        '   ```sh',
        '   ls',
        '   ```',
        '',
        '3. bước ba',
        '',
        '```sh',
        'mat-runtime --user-list <tên>',
        '```',
        '',
        '<script>alert(1)</script>',
        '',
        '## Tài liệu',
      ].join('\n'),
    );
    const out = join(root, 'out');
    const written = buildDocs({ root, outDir: out, sources: ['docs/user', 'docs/training'] });
    assert.deepEqual(written.sort(), ['training/operator.html', 'user/index.html']);
    const html = readFileSync(join(out, 'user/index.html'), 'utf8');
    assert.match(html, /<a href="\.\.\/training\/operator\.html#bài-1">vận hành<\/a>/);
    assert.doesNotMatch(html, /href="https?:/);
    assert.doesNotMatch(html, /src="https?:/);
    assert.match(html, /web <span class="ext">\(https:\/\/example\.com\/x\)<\/span>/);
    assert.match(html, /trong kho mã nguồn: <code>server\/main\.cpp<\/code>/);
    assert.match(html, /<img alt="sơ đồ" src="data:image\/png;base64,/);
    assert.match(html, /\[ảnh: ngoài\]/);
    assert.match(
      html,
      /<td><code>A\|B<\/code><\/td><td><strong>đậm<\/strong> và <em>nghiêng<\/em><\/td>/,
    );
    assert.match(
      html,
      /<ul><li>mục 1<ul><li>mục con<\/li><\/ul><\/li><li><input type="checkbox" disabled checked> đã làm<\/li><\/ul>/,
    );
    assert.match(html, /<ol><li>bước một<\/li><li>bước hai<\/li><\/ol>/);
    assert.match(html, /<ol start="3"><li>bước ba<\/li><\/ol>/);
    assert.match(html, /mat-runtime --user-list &lt;tên&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /chú thích không ra HTML/);
    assert.match(html, /<h1 id="tài-liệu">/);
    assert.match(html, /<h2 id="tài-liệu-1">/);
    assert.match(html, /<title>Tài liệu · mAT SCADA<\/title>/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tài liệu thật: không liên kết ra ngoài, mọi liên kết nội bộ tới trang có thật', () => {
  const out = mkdtempSync(join(tmpdir(), 'mat-docs-html-'));
  try {
    const written = buildDocs({ outDir: out });
    assert.ok(written.includes('user/index.html'), 'thiếu trang mục lục user/index.html');
    for (const f of walk(out)) {
      const html = readFileSync(f, 'utf8');
      assert.doesNotMatch(html, /(href|src)="(https?:)?\/\//, f);
      assert.doesNotMatch(html, /<script/i, f);
      for (const m of html.matchAll(/href="([^"#]+)(#[^"]*)?"/g)) {
        assert.ok(
          existsSync(resolve(dirname(f), decodeURIComponent(m[1]))),
          `${f}: liên kết hỏng ${m[1]}`,
        );
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('thư mục ra có sẵn: giữ tệp chấm (tệp bỏ qua của docs-html), xóa trang cũ', () => {
  const out = mkdtempSync(join(tmpdir(), 'mat-docs-keep-'));
  const keep = '.' + 'gitignore';
  try {
    writeFileSync(join(out, keep), '*\n');
    writeFileSync(join(out, 'cu.html'), 'cũ');
    buildDocs({ outDir: out });
    assert.ok(existsSync(join(out, keep)), `mất ${keep}`);
    assert.ok(!existsSync(join(out, 'cu.html')), 'còn trang cũ');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('Trợ giúp của Studio (F1): mọi trang và neo trong help-topics.json có trong HTML dựng ra', () => {
  const topics = JSON.parse(
    readFileSync(new URL('../apps/studio/src/app/help-topics.json', import.meta.url), 'utf8'),
  );
  const out = mkdtempSync(join(tmpdir(), 'mat-docs-help-'));
  try {
    buildDocs({ outDir: out });
    const all = [topics.default, ...topics.topics];
    assert.ok(all.length >= 10);
    for (const { page, anchor } of all) {
      const f = join(out, page);
      assert.ok(existsSync(f), `thiếu trang ${page}`);
      assert.match(readFileSync(f, 'utf8'), new RegExp(`id="${anchor}"`), `${page}#${anchor}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('tauri.conf.json đưa docs-html/ vào gói và dựng tài liệu trước khi build', () => {
  const conf = JSON.parse(
    readFileSync(new URL('../apps/studio/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(conf.bundle.resources, { 'docs-html/': 'docs-html/' });
  assert.match(conf.build.beforeBuildCommand, /build:docs/);
  const pkg = JSON.parse(
    readFileSync(new URL('../apps/studio/package.json', import.meta.url), 'utf8'),
  );
  assert.match(pkg.scripts['build:docs'], /tools\/build-docs\.mjs --out src-tauri\/docs-html/);
});
