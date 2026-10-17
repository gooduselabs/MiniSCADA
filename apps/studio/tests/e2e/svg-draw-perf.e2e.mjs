// E2E hiệu năng trình vẽ SVG (feature 011, T164; FR-114; SC-033; contracts/svg-editor.md §11): mở tài liệu 20.000 nút ≤ 3 s;
// tài liệu 2.000 phần tử: kéo một phần tử p95 ≤ 16,7 ms mỗi khung (khoảng cách requestAnimationFrame, cho phép một nhịp lệch
// của đồng hồ rAF như screen-perf; kèm thời gian xử lý mỗi lần di chuột), chọn bằng khung ≤ 50 ms, hoàn tác một bước ≤ 100 ms;
// kéo ≥ 200 nút dùng bản xem nhanh (hộp bao). Ghi docs/reports/011-svg-perf.json. Chrome headless, lớp Tauri giả; số đo phụ
// thuộc máy chạy (ghi cấu hình máy): số của máy dev, không thay số của Studio trên Windows/WebView2 hay của BL335.
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { REPO, expandNode, openAndWait, readProject, setTheme, sleep, treeNode } from './util.mjs';

const BUDGET = { open20000: 3000, frameP95: 16.7, marquee2000: 50, undo: 100 };
const REPORT = resolve(REPO, 'docs/reports/011-svg-perf.json');
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : NaN;
};
const r1 = (v) => Math.round(v * 10) / 10;

/** Lưới n hình chữ nhật (không chồng nhau) trong một lớp; tổng số phần tử = n + 2 (gốc, lớp). */
function gridSvg(n, cols) {
  const rows = Math.ceil(n / cols);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 12;
    const y = Math.floor(i / cols) * 12;
    parts.push(
      `<rect data-mat-uid="el_p${i.toString(36).padStart(4, '0')}" x="${x}" y="${y}" width="10" height="10" fill="#9fb4c7"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * 12} ${rows * 12}" width="${cols * 12}" height="${rows * 12}">\n<g data-mat-layer="Lưới">\n${parts.join('\n')}\n</g>\n</svg>\n`;
}

function project() {
  const files = readProject(resolve(REPO, 'projects/svg-demo'));
  files['graphics/perf-2000.svg'] = gridSvg(1998, 50);
  files['graphics/perf-20000.svg'] = gridSvg(19998, 200);
  return files;
}

/** Mở tệp qua cây, trả thời gian (ms) từ lúc nhấp tới khi canvas dựng xong DOM và vẽ một khung. */
async function timedOpen(page, rel, minNodes) {
  await expandNode(page, 'graphics');
  return page.evaluate(
    (r, min) =>
      new Promise((resolveOpen, reject) => {
        const t0 = performance.now();
        document.querySelector(`mat-tree [id="ti-svgfile:${r}"]`).click();
        const tick = () => {
          const cv = document.querySelector('mat-svg-canvas');
          const doc = cv?.shadowRoot?.querySelector('svg.doc');
          if (doc && cv.built >= min && window.__matApp.store.state.active === `svgdraw:${r}`)
            requestAnimationFrame(() => resolveOpen(performance.now() - t0));
          else if (performance.now() - t0 > 20000) reject(new Error('mở quá 20 s'));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    rel,
    minNodes,
  );
}

/** Kéo bằng chuột thật từ tâm phần tử `uid`; trả khoảng cách giữa các khung rAF và thời gian xử lý mỗi lần di chuột. */
async function dragFrames(page, from, moves) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__stop = false;
    const loop = (t) => {
      window.__frames.push(t);
      if (!window.__stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.querySelector('mat-svg-editor').moveTimes.length = 0;
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(from.x + i * 2, from.y + i);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  const { frames, handler, preview } = await page.evaluate(() => {
    window.__stop = true;
    const ov = document.querySelector('mat-svg-canvas').shadowRoot.querySelector('[data-preview]');
    return {
      frames: window.__frames,
      handler: [...document.querySelector('mat-svg-editor').moveTimes],
      preview: ov?.getAttribute('data-preview') ?? null,
    };
  });
  await page.mouse.up();
  await sleep(200);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  return {
    gapP95: r1(p95(gaps)),
    gapAvg: r1(gaps.reduce((a, b) => a + b, 0) / gaps.length),
    handlerP95: r1(p95(handler)),
    frames: gaps.length,
    preview,
  };
}

const centerOf = (page, uid) =>
  page.evaluate((u) => {
    const app = window.__matApp;
    const ed = app.svg.editor(app.store.state.active.slice('svgdraw:'.length));
    const id = [...ed.doc.nodes.values()].find((n) => n.attrs.get('data-mat-uid') === u).id;
    const b = ed.boxOf(id);
    const cv = document.querySelector('mat-svg-canvas');
    const r = cv.getBoundingClientRect();
    const m = cv.viewMap();
    return { x: r.left + m.x(b.x + b.width / 2), y: r.top + m.y(b.y + b.height / 2) };
  }, uid);

/** Chọn bằng khung (qua bộ điều khiển, như kéo chuột): ms của lần thả (tính hộp bao, lọc, chọn) và số phần tử chọn. */
const marquee = (page, cold) =>
  page.evaluate((isCold) => {
    const app = window.__matApp;
    const rel = app.store.state.active.slice('svgdraw:'.length);
    const ed = app.svg.editor(rel);
    if (isCold) ed.session.boxes.clear();
    const vb = ed.doc.viewBox;
    ed.select([]);
    ed.pointerDown({ x: vb.x - 1, y: vb.y - 1 }, null, {});
    ed.pointerMove({ x: vb.x + vb.width + 1, y: vb.y + vb.height + 1 }, {});
    const t0 = performance.now();
    ed.pointerUp({ x: vb.x + vb.width + 1, y: vb.y + vb.height + 1 }, {});
    const ms = performance.now() - t0;
    app.requestRender();
    return { ms, n: ed.selection.length };
  }, cold);

/** Hoàn tác một bước (dịch một phần tử): ms tới khi DOM đã cập nhật và vẽ một khung. */
const undoOnce = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const app = window.__matApp;
        const rel = app.store.state.active.slice('svgdraw:'.length);
        const ed = app.svg.editor(rel);
        ed.select([ed.selectableInScope()[0]]);
        const r = ed.nudge(5, 0);
        ed.endNudge();
        app.svg.changed(rel, r.targets);
        const t0 = performance.now();
        void app
          .run('edit.undo')
          .then(() => requestAnimationFrame(() => done(performance.now() - t0)));
      }),
  );

export default async function svgDrawPerf({ page, check, shot }) {
  await setTheme(page, 'light');
  const report = {
    feature: '011',
    task: 'T164',
    date: new Date().toISOString().slice(0, 10),
    note: 'Máy dev (macOS, Chrome headless-shell, lớp Tauri giả): không phải Studio trên Windows/WebView2, không phải BL335',
    machine: {
      os: `${platform()} ${arch()}`,
      cpu: cpus()[0]?.model ?? '?',
      cores: cpus().length,
      ramGB: Math.round(totalmem() / 2 ** 30),
    },
    budgetMs: BUDGET,
    measuredMs: {},
  };
  const m = report.measuredMs;
  await openAndWait(page, project(), 'D:\\Projects\\svg-perf');

  // ---------- 20.000 nút: mở ----------
  m.open20000 = r1(await timedOpen(page, 'graphics/perf-20000.svg', 19999));
  check(
    `mở tài liệu 20.000 nút ≤ ${BUDGET.open20000} ms`,
    m.open20000 <= BUDGET.open20000,
    `${m.open20000} ms`,
  );
  await shot('20000');
  const mq20 = await marquee(page, true);
  m.marquee20000Cold = r1(mq20.ms);
  check('khung chọn 20.000 nút (đo, không có ngân sách)', mq20.n === 19998, JSON.stringify(mq20));
  m.undo20000 = r1(await undoOnce(page));
  check(
    `hoàn tác một bước trên 20.000 nút ≤ ${BUDGET.undo} ms`,
    m.undo20000 <= BUDGET.undo,
    `${m.undo20000} ms`,
  );
  await page.evaluate(() => {
    const app = window.__matApp;
    app.svg.editor(app.store.state.active.slice('svgdraw:'.length)).select([]);
    app.requestRender();
  });
  const d20 = await dragFrames(page, await centerOf(page, 'el_p0a00'), 40);
  m.drag20000 = d20;
  check('kéo một phần tử trong tài liệu 20.000 nút (đo)', d20.frames > 10, JSON.stringify(d20));

  // ---------- 2.000 phần tử ----------
  await treeNode(page, 'start');
  m.open2000 = r1(await timedOpen(page, 'graphics/perf-2000.svg', 1999));
  const d2 = await dragFrames(page, await centerOf(page, 'el_p00a0'), 60);
  m.drag2000 = d2;
  check(
    `2.000 phần tử: kéo một phần tử p95 ≤ ${BUDGET.frameP95} ms mỗi khung (cho phép một nhịp lệch rAF: ≤ 17,5)`,
    d2.gapP95 <= 17.5 && d2.handlerP95 <= BUDGET.frameP95 && d2.preview === 'dom',
    JSON.stringify(d2),
  );
  const cold = await marquee(page, true);
  const warm = await marquee(page, false);
  m.marquee2000Cold = r1(cold.ms);
  m.marquee2000Warm = r1(warm.ms);
  check(
    `chọn bằng khung 2.000 phần tử ≤ ${BUDGET.marquee2000} ms (đệm hộp bao trống)`,
    cold.ms <= BUDGET.marquee2000 && cold.n === 1998,
    JSON.stringify({ cold, warm }),
  );
  m.undo2000 = r1(await undoOnce(page));
  check(`hoàn tác một bước ≤ ${BUDGET.undo} ms`, m.undo2000 <= BUDGET.undo, `${m.undo2000} ms`);

  // ---------- kéo ≥ 200 nút: bản xem nhanh ----------
  await page.evaluate(() => {
    const app = window.__matApp;
    const ed = app.svg.editor(app.store.state.active.slice('svgdraw:'.length));
    ed.select(ed.selectableInScope().slice(0, 500));
    app.requestRender();
  });
  await sleep(100);
  const dq = await dragFrames(page, await centerOf(page, 'el_p0078'), 40);
  m.drag500Quick = dq;
  check(
    'kéo 500 nút: bản xem nhanh (hộp bao), khung ≤ 17,5 ms',
    dq.preview === 'quick' && dq.gapP95 <= 17.5,
    JSON.stringify(dq),
  );
  const after = await page.evaluate(() => {
    const app = window.__matApp;
    const s = app.svg.session(app.store.state.active.slice('svgdraw:'.length));
    const ed = app.svg.editor(app.store.state.active.slice('svgdraw:'.length));
    return { label: s.undo.undoLabel, sel: ed.selection.length, msg: ed.message };
  });
  check(
    'thả: 500 nút dời trong một bước "Di chuyển"',
    after.label === 'Di chuyển' && after.sel === 500,
    JSON.stringify(after),
  );

  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  check('ghi docs/reports/011-svg-perf.json', true, JSON.stringify(m));
}
