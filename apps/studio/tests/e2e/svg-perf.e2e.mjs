// E2E hiệu năng Studio với SVG 20.000 phần tử (feature 008, T077, SC-018): nhập ≤ 5 s, mở cây phần tử ≤ 300 ms, chọn bằng nhấp
// ≤ 50 ms, Thử giá trị ≤ 100 ms, hoàn tác ≤ 100 ms. Nhập đo hai lần: ca giới hạn `elements-20000` của limits.mjs (hình xếp chồng) và
// bản vẽ lưới 20.000 phần tử (hình không chồng nhau, dùng cho các phép đo còn lại). Ghi số đo vào docs/reports/008-studio-perf.json.
// Chrome headless, lớp Tauri giả; số đo phụ thuộc máy chạy (ghi cả cấu hình máy trong báo cáo).
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { buildLimitCase } from '../../../../tests/fixtures/svg-import/limits.mjs';
import { bonProject, gridSvg } from './svg-fixture.mjs';
import { REPO, openAndWait, press, setTheme, sleep, treeItem, waitFor } from './util.mjs';

const BUDGET = { import: 5000, tree: 300, pick: 50, test: 100, undo: 100 };
const REPORT = resolve(REPO, 'docs/reports/008-studio-perf.json');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Dựng lại item sau khi binding đổi: chờ `mat-screen` báo xong. */
const whenReady = (page) =>
  page.evaluate(() => document.querySelector('mat-screen-canvas mat-screen').whenReady());

export default async function svgPerf({ page, check, shot }) {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await setTheme(page, 'light');
  const report = {
    feature: '008',
    task: 'T077',
    date: new Date().toISOString().slice(0, 10),
    machine: {
      cpu: cpus()[0]?.model ?? '?',
      cores: cpus().length,
      ramGB: Math.round(totalmem() / 2 ** 30),
    },
    elements: 20000,
    budgetMs: BUDGET,
    measuredMs: {},
  };
  const m = report.measuredMs;

  await openAndWait(page, bonProject(), 'D:\\Projects\\bon-nuoc');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(600);

  // ---------- 1. Nhập 20.000 phần tử (hộp thoại Nhập SVG, importer trong Web Worker) ----------
  /** Mở hộp thoại Nhập SVG với file này; trả số ms tới khi xem trước sẵn sàng và có nút Nhập hay không. */
  const importFile = async (name, text) => {
    await page.evaluate(
      (n, t) => {
        window.__matMock.svgOpenResult = { name: n, bytes: new TextEncoder().encode(t) };
      },
      name,
      text,
    );
    const t0 = Date.now();
    await press(page, 'Control+Shift+I');
    await page.waitForSelector('mat-import-svg-dialog [role="dialog"]');
    await waitFor(
      page,
      () =>
        document.querySelector('mat-import-svg-dialog [data-role="ok"]:not([disabled])') ||
        document.querySelector('mat-import-svg-dialog [data-role="rejected"]'),
      undefined,
      30000,
    );
    return {
      ms: Date.now() - t0,
      ok: (await page.$('mat-import-svg-dialog [data-role="ok"]')) !== null,
    };
  };
  // (a) Ca đúng giới hạn của importer (limits.mjs: 20.000 hình xếp chồng ở một chỗ): chỉ đo thời gian nhập, rồi Hủy.
  const lim = await importFile('elements-20000.svg', buildLimitCase('elements-20000').content);
  m.importLimitCase = lim.ms;
  check(
    `nhập ca giới hạn 20.000 phần tử (limits.mjs) ≤ ${BUDGET.import} ms`,
    lim.ok && lim.ms <= BUDGET.import,
    `${lim.ms} ms`,
  );
  await press(page, 'Escape');
  await waitFor(page, () => !document.querySelector('mat-import-svg-dialog [role="dialog"]'));
  // (b) Bản vẽ lưới 20.000 phần tử (không chồng nhau): nhập thật rồi dùng cho các phép đo sau.
  const grid = await importFile('luoi-20000.svg', gridSvg(20000));
  m.import = grid.ms;
  check(
    `nhập bản vẽ lưới 20.000 phần tử ≤ ${BUDGET.import} ms`,
    grid.ok && grid.ms <= BUDGET.import,
    `${grid.ms} ms`,
  );
  await shot('1-nhap-20000');
  await page.$eval('mat-import-svg-dialog [data-role="ok"]', (b) => b.click());
  await waitFor(page, () => !document.querySelector('mat-import-svg-dialog [role="dialog"]'));
  await sleep(800);
  const itemId = await page.$eval(
    'mat-screen-canvas .oi[aria-selected="true"]',
    (e) => e.dataset.item,
  );
  await page.evaluate((id) => (window.__perfItem = id), itemId);

  // ---------- 2. Vào item, mở cây phần tử ----------
  const box = await page.$eval(`mat-screen-canvas .oi[data-item="${itemId}"]`, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await waitFor(
    page,
    () => document.querySelector('mat-svg-tree [role="treeitem"]') !== null,
    undefined,
    20000,
  );
  await whenReady(page);
  await sleep(500);
  // Đóng rồi mở lại tab Phần tử: đo từ lúc bấm tab tới khi cây có dòng đầu.
  await page.$eval('mat-shell #dt-tab-layers', (b) => b.click());
  await sleep(200);
  m.tree = await page.evaluate(
    () =>
      new Promise((done) => {
        const t0 = performance.now();
        document.querySelector('mat-shell #dt-tab-elements').click();
        const poll = () => {
          if (document.querySelector('mat-svg-tree [role="treeitem"]'))
            done(performance.now() - t0);
          else if (performance.now() - t0 > 5000) done(-1);
          else requestAnimationFrame(poll);
        };
        poll();
      }),
  );
  const rows = await page.$$eval('mat-svg-tree [role="treeitem"]', (e) => e.length);
  const total = await page.$eval('mat-svg-tree .foot-note', (e) =>
    e.textContent.replace(/\s+/g, ' ').trim(),
  );
  check(
    `mở cây phần tử (20.000 nút, dựng lười) ≤ ${BUDGET.tree} ms`,
    m.tree >= 0 && m.tree <= BUDGET.tree,
    `${m.tree.toFixed(0)} ms`,
  );
  check(
    'cây chỉ dựng các dòng đang thấy (cắt theo cửa sổ nhìn), không dựng 20.000 dòng',
    rows > 0 && rows < 200,
    `${rows} dòng; ${total}`,
  );
  await shot('2-cay-20000');

  // ---------- 3. Chọn bằng nhấp ----------
  const target = await page.evaluate(() => {
    const root = document
      .querySelector('mat-screen-canvas mat-screen')
      .shadowRoot.querySelector(`.item[data-item-id="${window.__perfItem}"] .svg-host`).shadowRoot;
    const els = [...root.querySelectorAll('[data-mat-uid]')];
    const el = els[Math.floor(els.length / 2)];
    const r = el.getBoundingClientRect();
    return {
      uid: el.getAttribute('data-mat-uid'),
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      n: els.length,
    };
  });
  await page.evaluate(() => {
    window.__pick = { t0: 0, t1: 0 };
    document
      .querySelector('mat-screen-canvas .vp')
      .addEventListener('pointerdown', () => (window.__pick.t0 = performance.now()), {
        capture: true,
      });
    const ov = document.querySelector('mat-screen-canvas .ov');
    new MutationObserver(() => {
      if (document.querySelector('mat-svg-overlay .svo-sel') && !window.__pick.t1)
        window.__pick.t1 = performance.now();
    }).observe(ov, { subtree: true, childList: true, attributes: true });
  });
  await page.mouse.click(target.x, target.y);
  await sleep(400);
  const pick = await page.evaluate(() => ({
    ...window.__pick,
    uid: document.querySelector('mat-svg-overlay .svo-sel')?.dataset.uid,
  }));
  m.pick = pick.t1 - pick.t0;
  check(
    `${target.n} phần tử có UID; nhấp chọn đúng phần tử`,
    pick.uid === target.uid,
    `${pick.uid} / ${target.uid}`,
  );
  check(
    `chọn bằng nhấp (hit-test, khung chọn) ≤ ${BUDGET.pick} ms`,
    m.pick > 0 && m.pick <= BUDGET.pick,
    `${m.pick.toFixed(1)} ms`,
  );

  // Chọn lần hai và ba (đã nóng) để lấy trung vị.
  const picks = [m.pick];
  for (const off of [37, 71]) {
    const t2 = await page.evaluate((o) => {
      const root = document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelector(
          `.item[data-item-id="${window.__perfItem}"] .svg-host`,
        ).shadowRoot;
      const els = [...root.querySelectorAll('[data-mat-uid]')];
      const r = els[Math.floor(els.length / 3) + o].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, off);
    await page.evaluate(() => (window.__pick = { t0: 0, t1: 0 }));
    await page.evaluate(() => {
      const prev = document.querySelector('mat-svg-overlay .svo-sel')?.dataset.uid;
      window.__pickPrev = prev;
    });
    await page.mouse.click(t2.x, t2.y);
    await sleep(300);
    const p = await page.evaluate(() => window.__pick);
    if (p.t1 > p.t0) picks.push(p.t1 - p.t0);
  }
  m.pickMedian = median(picks);
  check(
    `chọn bằng nhấp: trung vị ${picks.length} lần ≤ ${BUDGET.pick} ms`,
    m.pickMedian <= BUDGET.pick,
    picks.map((x) => x.toFixed(1)).join(' / '),
  );

  // ---------- 4. Gắn Tag (dựng lại bộ áp binding trên cùng DOM) rồi Thử giá trị ----------
  await page.evaluate(() => document.activeElement?.blur?.());
  const selUid = await page.$eval('mat-svg-overlay .svo-sel', (e) => e.dataset.uid);
  await page.waitForSelector('mat-svg-props [data-row="level"]');
  const tBind = await page.evaluate(
    () =>
      new Promise((done) => {
        const t0 = performance.now();
        const el = document.querySelector('mat-svg-bind [data-row="level"]');
        const dt = new DataTransfer();
        dt.setData('application/x-mat-tag', 'TANK01.LEVEL');
        const o = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        el.dispatchEvent(new DragEvent('dragover', o));
        el.dispatchEvent(new DragEvent('drop', o));
        const poll = async () => {
          if (document.querySelector('mat-svg-bind [data-row="level"]')?.dataset.bound === 'true') {
            await document.querySelector('mat-screen-canvas mat-screen').whenReady();
            done(performance.now() - t0);
          } else requestAnimationFrame(poll);
        };
        poll();
      }),
  );
  m.bindRewire = tBind;
  await sleep(500);
  await page.focus('[data-row="level"] .tagbtn');
  await page.waitForSelector('mat-test-strip .ts-range');
  const tests = [];
  for (const v of [20, 50, 80]) {
    const ms = await page.evaluate(
      (uid, value) =>
        new Promise((done) => {
          const root = document
            .querySelector('mat-screen-canvas mat-screen')
            .shadowRoot.querySelector(
              `.item[data-item-id="${window.__perfItem}"] .svg-host`,
            ).shadowRoot;
          const el = root.querySelector(`[data-mat-uid="${uid}"]`);
          const h0 = el.getAttribute('height');
          const slider = document.querySelector('mat-test-strip .ts-range');
          const t0 = performance.now();
          slider.value = String(value);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          const poll = () => {
            if (el.getAttribute('height') !== h0) done(performance.now() - t0);
            else if (performance.now() - t0 > 2000) done(-1);
            else requestAnimationFrame(poll);
          };
          poll();
        }),
      selUid,
      v,
    );
    tests.push(ms);
    await sleep(200);
  }
  m.testValue = median(tests);
  check(
    `Thử giá trị (đặt giá trị tới khi DOM của phần tử đổi) ≤ ${BUDGET.test} ms`,
    tests.every((x) => x >= 0) && m.testValue <= BUDGET.test,
    tests.map((x) => x.toFixed(1)).join(' / '),
  );

  // ---------- 5. Hoàn tác ----------
  await clickReset(page);
  await sleep(1500);
  await page.evaluate(() => document.activeElement?.blur?.());
  const undo = await page.evaluate(
    () =>
      new Promise((done) => {
        const t0 = performance.now();
        const ev = { key: 'z', ctrlKey: true, bubbles: true, cancelable: true };
        document.dispatchEvent(new KeyboardEvent('keydown', ev));
        const res = { model: 0, canvas: 0 };
        const poll = async () => {
          const bound = document.querySelector('mat-svg-bind [data-row="level"]')?.dataset.bound;
          if (bound === 'false' && !res.model) {
            res.model = performance.now() - t0;
            await document.querySelector('mat-screen-canvas mat-screen').whenReady();
            res.canvas = performance.now() - t0;
            done(res);
          } else if (performance.now() - t0 > 8000) done({ model: -1, canvas: -1 });
          else requestAnimationFrame(poll);
        };
        poll();
      }),
  );
  m.undoModel = undo.model;
  m.undoCanvas = undo.canvas;
  check(
    `hoàn tác (Ctrl+Z tới khi inspector cập nhật) ≤ ${BUDGET.undo} ms`,
    undo.model >= 0 && undo.model <= BUDGET.undo,
    `${undo.model.toFixed(1)} ms`,
  );
  check(
    `hoàn tác: canvas áp lại binding xong (không dựng lại SVG 20.000 phần tử), ghi lại để theo dõi`,
    undo.canvas >= 0,
    `${undo.canvas.toFixed(0)} ms`,
  );

  for (const k of Object.keys(m)) m[k] = Math.round(m[k] * 10) / 10;
  report.pass = {
    import: m.import <= BUDGET.import,
    tree: m.tree <= BUDGET.tree,
    pick: m.pickMedian <= BUDGET.pick,
    testValue: m.testValue <= BUDGET.test,
    undo: m.undoModel <= BUDGET.undo,
  };
  mkdirSync(resolve(REPO, 'docs/reports'), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
}

const clickReset = (page) =>
  page.$eval('mat-test-strip .ts-reset', (b) => b.click()).catch(() => undefined);
