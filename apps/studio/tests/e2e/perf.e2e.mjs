// E2E hiệu năng Bảng Tag với 500 Tag (feature 004, T081, SC-003): thời gian từ phím tới khi ô cập nhật
// và vẽ xong (≤ 100 ms), từ sửa tới khi lỗi hiện ở ô và thanh trạng thái (≤ 1 s). Project:
// tests/fixtures/studio/tags-500 (sinh bằng make-tags-500.mjs), nạp vào lớp Tauri giả. Số đo ghi vào
// tests/e2e/out/perf.json để chép vào báo cáo nghiệm thu.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, '../../../../tests/fixtures/studio/tags-500');

function readTree(dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, out);
    else out[relative(fixture, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8');
  }
  return out;
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    avg: +avg.toFixed(1),
    p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
    max: +s.at(-1).toFixed(1),
  };
};

export default async function perf({ page, check, shot }) {
  const files = readTree(fixture);
  await page.waitForSelector('mat-start-page .start-hero');
  await page.evaluate((f) => window.__matMock.useProject(f, 'D:\\Projects\\tags-500'), files);
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
  await page.waitForFunction(() =>
    document.querySelector('mat-tree [role="treeitem"] .lbl')?.textContent.includes('500 Tag'),
  );
  const o0 = Date.now();
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-tree [role="treeitem"]')]
      .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Bảng Tag mặc định')
      ?.click(),
  );
  await page.waitForFunction(
    () => document.querySelectorAll('mat-tag-grid tbody tr').length === 500,
  );
  const openMs = Date.now() - o0;
  check('mở Bảng Tag 500 dòng', true, `${openMs} ms`);

  // Phím mũi tên: từ phím tới khi aria-activedescendant đổi và trình duyệt vẽ xong khung hình kế.
  const arrows = await page.evaluate(async () => {
    const grid = document.querySelector('mat-tag-grid table[role="grid"]');
    const host = document.querySelector('mat-tag-grid');
    grid.focus();
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const out = [];
    for (let i = 0; i < 40; i++) {
      const before = grid.getAttribute('aria-activedescendant');
      const t0 = performance.now();
      grid.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: i < 20 ? 'ArrowDown' : 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      );
      await host.updateComplete;
      await frame();
      if (grid.getAttribute('aria-activedescendant') !== before) out.push(performance.now() - t0);
    }
    return out;
  });
  const arrow = stats(arrows);
  check(
    'phím mũi tên ≤ 100 ms (500 Tag, SC-003)',
    arrow.n >= 20 && arrow.max <= 100,
    JSON.stringify(arrow),
  );

  // Gõ trong ô mô tả (F2 vào sửa): mỗi phím tới khi vẽ xong.
  const typing = await page.evaluate(async () => {
    const grid = document.querySelector('mat-tag-grid table[role="grid"]');
    const host = document.querySelector('mat-tag-grid');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    grid.focus();
    grid.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    await host.updateComplete;
    grid.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }),
    );
    await host.updateComplete;
    await frame();
    const input = host.querySelector('input.tg-edit');
    if (!input) return null;
    const out = [];
    for (const ch of 'kiem tra toc do go phim') {
      const t0 = performance.now();
      input.value += ch;
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }),
      );
      await host.updateComplete;
      await frame();
      out.push(performance.now() - t0);
    }
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await host.updateComplete;
    return out;
  });
  const type = typing ? stats(typing) : null;
  check('gõ trong ô ≤ 100 ms mỗi phím (SC-003)', type && type.max <= 100, JSON.stringify(type));

  // Sửa Max của dòng đầu thành -1: từ Enter tới khi ô đỏ và thanh trạng thái báo lỗi (≤ 1 s).
  const errorMs = await page.evaluate(async () => {
    const grid = document.querySelector('mat-tag-grid table[role="grid"]');
    const host = document.querySelector('mat-tag-grid');
    grid.focus();
    const key = async (k) => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      await host.updateComplete;
    };
    await key('Home');
    grid.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await host.updateComplete;
    while (host.querySelector('td.cur')?.dataset.c !== 'max') await key('ArrowRight');
    await key('F2');
    const input = host.querySelector('input.tg-edit');
    input.value = '-1';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const t0 = performance.now();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    return new Promise((resolve) => {
      const tick = () => {
        const bad = host.querySelector('td.bad[data-c="max"]');
        const status = document.querySelector('mat-statusbar')?.textContent ?? '';
        if (bad && /1 lỗi/.test(status)) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 5000) resolve(null);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  });
  check(
    'sửa tới khi lỗi hiện ở ô và thanh trạng thái ≤ 1 s (SC-003)',
    errorMs !== null && errorMs <= 1000,
    `${errorMs?.toFixed(0)} ms`,
  );
  await shot('1-500-tag');

  writeFileSync(
    join(here, 'out', 'perf.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        tags: 500,
        openGridMs: openMs,
        arrowMs: arrow,
        typingMs: type,
        editToErrorMs: errorMs,
      },
      null,
      2,
    ),
  );
}
