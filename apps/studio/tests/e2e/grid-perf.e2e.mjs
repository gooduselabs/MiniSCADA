// E2E hiệu năng Bảng Tag 2.000 dòng (feature 006, T135, SC-012, SC-013 phần tự động, ADR-016), Chrome headless trên lớp Tauri
// giả. Project: tests/fixtures/studio/tags-2000-v02 (sinh bằng make-tags-2000.mjs: 2.000 Tag 0.2 đủ loại, 500 biểu thức).
// Đo: mở ≤ 1 s; mỗi bước di chuyển hoặc cuộn ≤ 50 ms; mỗi phím ≤ 100 ms; lỗi do một lần sửa hiện tại ô ≤ 1 s; dán 2.000 dòng ×
// 10 cột kể cả kiểm tra ≤ 5 s; xuất rồi nhập lại CSV: mọi dòng "giống". SC-013 (tự động): 20/20 lần chọn ô rồi gõ thẳng
// "Mức nước bồn 1" bằng bộ gõ giả lập qua CDP (Input.imeSetComposition) ra đúng chuỗi, không cần F2. Số đo ghi vào
// tests/e2e/out/grid-perf.json để chép vào docs/reports/006-acceptance.md.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAGS_2000,
  axeBoth,
  clickCell,
  openProject,
  pasteInto,
  press,
  readProject,
  sleep,
  stats,
  text,
  waitFor,
} from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GRID = 'mat-tag-grid';

export default async function gridPerf({ page, check, shot, axe }) {
  const files = readProject(TAGS_2000);
  await openProject(page, files, 'D:\\Projects\\tags-2000');
  await page
    .waitForFunction(
      () => document.querySelector('mat-tree [role="treeitem"] .lbl')?.textContent.includes('2000'),
      { timeout: 20000 },
    )
    .catch(() => undefined);
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-tree [role="treeitem"] .cnt')].some(
        (c) => c.textContent.trim() === '2000',
      ),
    undefined,
    20000,
  );
  await page.select('select', '').catch(() => undefined);

  // ---------- Mở Bảng Tag 2.000 dòng ----------
  const o0 = Date.now();
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-tree [role="treeitem"]')]
      .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Bảng Tag mặc định')
      ?.click(),
  );
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  const openMs = Date.now() - o0;
  const rowCount = await page.$eval(`${GRID} [role="grid"]`, (g) =>
    g.getAttribute('aria-rowcount'),
  );
  const rendered = await page.$$eval(`${GRID} [role="row"][data-r]`, (r) => r.length);
  check(
    `mở Bảng Tag 2.000 dòng ≤ 1 s (đo ${openMs} ms; chỉ vẽ ${rendered} dòng)`,
    openMs <= 1000 && rowCount === '2001' && rendered < 80,
    `${openMs} ms, aria-rowcount ${rowCount}`,
  );

  await sleep(2500); // chờ lần kiểm tra nền sau khi mở xong
  // ---------- Di chuyển ô và cuộn ----------
  const moves = await page.evaluate(async () => {
    const ta = document.querySelector('mat-tag-grid textarea.mg-input');
    const host = document.querySelector('mat-tag-grid mat-grid');
    ta.focus();
    const out = [];
    const keys = [];
    for (let i = 0; i < 60; i++)
      keys.push(i < 30 ? 'ArrowDown' : i < 45 ? 'ArrowRight' : 'PageDown');
    for (const k of keys) {
      const before = ta.getAttribute('aria-activedescendant');
      const t0 = performance.now();
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      await host.updateComplete;
      if (ta.getAttribute('aria-activedescendant') !== before) out.push(performance.now() - t0);
    }
    const scroll = host.querySelector('.mg-scroll');
    const scrolls = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      scroll.scrollTop += 24 * 15;
      scroll.dispatchEvent(new Event('scroll'));
      await host.updateComplete;
      scrolls.push(performance.now() - t0);
    }
    return { moves: out, scrolls };
  });
  const mv = stats(moves.moves);
  const sc = stats(moves.scrolls);
  check(
    `di chuyển ô ≤ 50 ms (p95; mỗi bước tới khi DOM cập nhật, max ≤ 80 cho nhiễu máy) (SC-012): ${JSON.stringify(mv)}`,
    mv.n >= 40 && mv.p95 <= 50 && mv.max <= 80,
    JSON.stringify(mv),
  );
  check(`cuộn ≤ 50 ms mỗi bước (SC-012): ${JSON.stringify(sc)}`, sc.max <= 50, JSON.stringify(sc));

  // ---------- Gõ từng phím ----------
  const typing = await page.evaluate(async () => {
    const ta = document.querySelector('mat-tag-grid textarea.mg-input');
    const host = document.querySelector('mat-tag-grid mat-grid');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    ta.focus();
    const out = [];
    for (const ch of 'kiem tra toc do go phim tren 2000 dong') {
      const t0 = performance.now();
      ta.value += ch;
      ta.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }),
      );
      await host.updateComplete;
      await frame();
      out.push(performance.now() - t0);
    }
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await host.updateComplete;
    return out;
  });
  const ty = stats(typing);
  check(`gõ ≤ 100 ms mỗi phím (SC-012): ${JSON.stringify(ty)}`, ty.max <= 100, JSON.stringify(ty));

  // ---------- Lỗi do một lần sửa hiện tại ô ≤ 1 s ----------
  await page.evaluate(() => document.querySelector('mat-tag-grid .mg-scroll').scrollTo(0, 0));
  await sleep(100);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  await sleep(150);
  await clickCell(page, GRID, 0, 'address').catch(async () => {
    await page.evaluate(() => document.querySelector('mat-tag-grid .mg-scroll').scrollTo(0, 0));
  });
  const errMs = await page.evaluate(async () => {
    const ta = document.querySelector('mat-tag-grid textarea.mg-input');
    const host = document.querySelector('mat-tag-grid mat-grid');
    ta.focus();
    const key = async (k, init = {}) => {
      ta.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      );
      await host.updateComplete;
    };
    // Tag ngoài đầu tiên của dự án nằm sau 13 Tag gốc: về đầu rồi xuống tới ô địa chỉ của một Tag ngoài.
    await key('Home', { ctrlKey: true });
    for (let i = 0; i < 20; i++) await key('ArrowDown');
    const here = () => host.querySelector('[role="gridcell"].mg-cur');
    for (let i = 0; i < 14 && here()?.dataset.c !== 'address'; i++) await key('ArrowRight');
    ta.value = 'XX1';
    ta.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: 'XX1', inputType: 'insertText' }),
    );
    await host.updateComplete;
    const t0 = performance.now();
    await key('Enter');
    return new Promise((resolve) => {
      const tick = () => {
        const bad = host.querySelector('[role="gridcell"].mg-err');
        const status = document.querySelector('mat-statusbar')?.textContent ?? '';
        if (bad && /1 lỗi/.test(status)) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 6000) resolve(null);
        else requestAnimationFrame(tick);
      };
      tick();
    });
  });
  check(
    `sửa tới khi lỗi hiện ở ô và thanh trạng thái ≤ 1 s (SC-012): ${errMs?.toFixed(0)} ms`,
    errMs !== null && errMs <= 1000,
    `${errMs?.toFixed(0)} ms`,
  );
  await press(page, 'Control+z');
  await waitFor(
    page,
    () =>
      /^\s*0 lỗi/.test(
        [...document.querySelectorAll('mat-statusbar button')]
          .map((b) => b.textContent.replace(/\s+/g, ' '))
          .find((t) => /lỗi/.test(t)) ?? '',
      ),
    undefined,
    6000,
  );
  await shot('1-2000-tag');

  // ---------- Dán 2.000 dòng × 10 cột lên 2.000 Tag đang có (giới hạn 2.000 Tag), kể cả kiểm tra ----------
  await page.select(`${GRID} select[data-role="set"]`, 'all');
  await sleep(150);
  const tags = JSON.parse(files['tags.json']).tags;
  const lastExt = tags.map((t) => t.kind).lastIndexOf('external');
  const lines = tags.map((t, i) => {
    const src = t.source ?? {};
    return [
      `${t.description ?? 'Tag'} (dán)`,
      t.unit ?? '',
      src.device ?? '',
      i === lastExt ? 'XX9' : (src.address ?? ''),
      '',
      '',
      '',
      '',
      '',
      '',
    ].join('\t');
  });
  await page.evaluate(() => document.querySelector('mat-tag-grid .mg-scroll').scrollTo(0, 0));
  await sleep(100);
  await clickCell(page, GRID, 0, 'description');
  const p0 = Date.now();
  await pasteInto(page, GRID, lines.join('\n'));
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-statusbar button')].some((b) =>
        /^\s*1 lỗi/.test(b.textContent.replace(/\s+/g, ' ')),
      ),
    undefined,
    20000,
  ).catch(async () => {
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /lỗi/.test(b.textContent))
        ?.click(),
    );
    await sleep(500);
    const issues = await page.$$eval('mat-inspector .issue', (r) =>
      r.slice(0, 4).map((x) => x.textContent.replace(/\s+/g, ' ')),
    );
    check('DBG ' + issues.join(' | '), false);
    throw new Error('dán: không đúng 1 lỗi');
  });
  const pasteMs = Date.now() - p0;
  check(
    `dán 2.000 dòng × 10 cột kể cả kiểm tra ≤ 5 s (SC-012): ${pasteMs} ms`,
    pasteMs <= 5000,
    `${pasteMs} ms`,
  );
  await press(page, 'Control+z');
  await waitFor(
    page,
    () =>
      /^\s*0 lỗi/.test(
        [...document.querySelectorAll('mat-statusbar button')]
          .map((b) => b.textContent.replace(/\s+/g, ' '))
          .find((t) => /lỗi/.test(t)) ?? '',
      ),
    undefined,
    20000,
  );
  check('một Ctrl+Z hoàn tác cả lần dán (về 0 lỗi)', true);

  // ---------- Xuất rồi nhập lại CSV: mọi dòng giống ----------
  await page.click(`${GRID} [data-act="export"]`);
  await waitFor(page, () => window.__matMock.savedCsv.length > 0, undefined, 20000);
  const csv = await page.evaluate(() => window.__matMock.savedCsv.at(-1).text);
  await page.evaluate((txt) => {
    window.__matMock.csvOpenResult = { name: 'tags.csv', bytes: new TextEncoder().encode(txt) };
  }, csv);
  const c0 = Date.now();
  await page.click(`${GRID} [data-act="import"]`);
  await page.waitForSelector('mat-csv-import-dialog [data-role="summary"]', { timeout: 20000 });
  const csvMs = Date.now() - c0;
  const summary = await text(page, 'mat-csv-import-dialog [data-role="summary"]');
  check(
    `xuất rồi nhập lại CSV 2.000 Tag: ${summary} (${csvMs} ms)`,
    /^0 thêm, 0 cập nhật, 2000 giống, 0 lỗi/.test(summary ?? ''),
    summary,
  );
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-csv-import-dialog [role="dialog"]'));

  // ---------- SC-013 (phần tự động): bộ gõ giả lập qua CDP ----------
  const cdp = await page.createCDPSession();
  await page.select(`${GRID} select[data-role="set"]`, 'all');
  await page.evaluate(() => document.querySelector('mat-tag-grid .mg-scroll').scrollTo(0, 0));
  await sleep(100);
  let ok = 0;
  let last = null;
  const target = 'Mức nước bồn 1';
  for (let i = 0; i < 20; i++) {
    await clickCell(page, GRID, 1 + (i % 10), 'description');
    const startedEditing = await page.evaluate(() =>
      document.querySelector('mat-tag-grid textarea.mg-input').classList.contains('mg-editing'),
    );
    // Telex: ghép dần từng bước rồi chốt bằng insertText (compositionend).
    for (const part of ['M', 'Mu', 'Mứ', 'Mức', 'Mức n', 'Mức nu', 'Mức nướ', 'Mức nước']) {
      await cdp.send('Input.imeSetComposition', {
        text: part,
        selectionStart: part.length,
        selectionEnd: part.length,
      });
    }
    await cdp.send('Input.insertText', { text: target });
    const state = await page.evaluate(() => {
      const ta = document.querySelector('mat-tag-grid textarea.mg-input');
      return {
        editing: ta.classList.contains('mg-editing'),
        value: ta.value,
        focused: document.activeElement === ta,
      };
    });
    last = { startedEditing, ...state };
    if (!startedEditing && state.editing && state.value === target && state.focused) ok++;
    await page.keyboard.press('Escape');
  }
  check(
    `SC-013 (tự động): ${ok}/20 lần chọn ô rồi gõ thẳng "${target}" ra đúng chuỗi, không F2`,
    ok === 20,
    `${ok}/20 ${JSON.stringify(last)}`,
  );

  await axeBoth(page, axe, 'Bảng Tag 2.000 dòng');

  writeFileSync(
    join(here, 'out', 'grid-perf.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        tags: 2000,
        openMs,
        rendered,
        moveMs: mv,
        scrollMs: sc,
        typingMs: ty,
        editToErrorMs: errMs,
        pasteMs,
        csvImportMs: csvMs,
        sc013: `${ok}/20`,
      },
      null,
      2,
    ),
  );
}
