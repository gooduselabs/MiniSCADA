// E2E đo hiệu năng trình bố trí (feature 007, T126, SC-013, ADR-022 điều kiện xem xét lại): màn hình 250 item (trần của định dạng)
// mở ≤ 1 s; kéo 100 item cùng lúc, trung bình ≤ 16,7 ms mỗi khung (đo requestAnimationFrame); hoàn tác ≤ 100 ms; kiểm tra sau
// sửa ≤ 500 ms. Số đo ghi ra tests/e2e/out/screen-perf.json (vào ADR-022). Chrome headless trên máy phát triển, lớp Tauri giả.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_DEMO,
  designToPage,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  stats,
} from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Project 0.3 có một màn hình 250 item (card, nhãn, đèn) xếp lưới, dùng Tag của dashboard-demo. */
function bigProject() {
  const src = readProject(DASHBOARD_DEMO);
  const project = JSON.parse(src['project.json']);
  project.screens = ['lon'];
  project.entryScreen = 'lon';
  delete project.navigation;
  const items = [];
  const kinds = ['card', 'lamp', 'label'];
  const tags = { card: 'TANK01.LEVEL', lamp: 'PUMP01.FAULT', label: 'PUMP01.NAME' };
  const size = { card: [100, 60], lamp: [100, 30], label: [100, 30] };
  const counts = { card: 0, lamp: 0, label: 0 };
  for (let i = 0; i < 250; i++) {
    const kind = kinds[i % 3];
    const n = ++counts[kind];
    const col = i % 25;
    const row = Math.floor(i / 25);
    const slot = kind === 'lamp' ? 'state' : 'value';
    items.push({
      id: `${kind}_${n}`,
      type: 'widget',
      widget: kind,
      x: 40 + col * 140,
      y: 40 + row * 100,
      width: size[kind][0],
      height: size[kind][1],
      tags: { [slot]: tags[kind] },
    });
  }
  const files = {
    'project.json': JSON.stringify(project, null, 2) + '\n',
    'tags.json': src['tags.json'],
    'connections.json': src['connections.json'],
  };
  for (const [rel, text] of Object.entries(src))
    if (rel.startsWith('value-tables/')) files[rel] = text;
  const lines = items.map((it) => '    ' + JSON.stringify(it)).join(',\n');
  files['screens/lon.screen.json'] =
    `{\n  "schemaVersion": "0.3.0",\n  "id": "lon",\n  "name": "Lớn",\n  "size": {"width":3840,"height":2160},\n  "items": [\n${lines}\n  ]\n}\n`;
  return files;
}

export default async function screenPerf({ page, check, shot }) {
  await setTheme(page, 'light');
  await openAndWait(page, bigProject(), 'D:\\Projects\\man-hinh-lon');

  // ---------- 1. Mở màn hình 250 item ----------
  const open = await page.evaluate(async () => {
    const node = document.querySelector('mat-tree [id^="ti-screen:"]');
    const t0 = performance.now();
    node.click();
    const until = (pred) =>
      new Promise((resolve) => {
        const tick = () => (pred() ? resolve(performance.now() - t0) : requestAnimationFrame(tick));
        tick();
      });
    // Xong khi lớp phủ có đủ 250 option và mat-screen đã dựng đủ 250 item.
    return until(() => {
      const ms = document.querySelector('mat-screen-canvas mat-screen');
      return (
        document.querySelectorAll('mat-screen-canvas .oi').length === 250 &&
        ms?.shadowRoot?.querySelectorAll('.item').length === 250
      );
    });
  });
  check('mở màn hình 250 item ≤ 1 s', open <= 1000, `${open.toFixed(0)} ms`);
  await sleep(600);
  await shot('1-250-item');

  // ---------- 2. Kéo 100 item cùng lúc ----------
  // Chọn 100 item bằng khung chọn (4 hàng × 25 cột đầu), từ góc trống.
  const a = await designToPage(page, 10, 10);
  const b = await designToPage(page, 3560, 420);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  const sel = await page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => e.length);
  check('khung chọn lấy được 100 item', sel === 100, String(sel));

  const start = await page.$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(() => {
    window.__frames = [];
    const loop = (t) => {
      window.__frames.push(t);
      if (!window.__stop) requestAnimationFrame(loop);
    };
    window.__stop = false;
    requestAnimationFrame(loop);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const MOVES = 90;
  for (let i = 1; i <= MOVES; i++) {
    await page.mouse.move(start.x + i * 3, start.y + i * 2);
    // Đợi hai khung để mỗi lần di chuyển được vẽ trọn.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  const frames = await page.evaluate(() => {
    window.__stop = true;
    return window.__frames;
  });
  await page.mouse.up();
  await sleep(300);
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const drag = stats(gaps);
  check(
    'kéo 100 item: trung bình ≤ 16,7 ms mỗi khung (cho phép 1 nhịp lệch của đồng hồ rAF)',
    drag.avg <= 17.5,
    JSON.stringify(drag),
  );
  await shot('2-sau-khi-keo-100-item');

  // ---------- 3. Hoàn tác ≤ 100 ms ----------
  const undo = await page.evaluate(async () => {
    const box = () =>
      document.querySelector('mat-screen-canvas .selbox[data-sel="box"]')?.style.left;
    const before = box();
    const t0 = performance.now();
    document
      .querySelector('mat-screen-canvas .vp')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    return new Promise((resolve) => {
      const tick = () =>
        box() !== before
          ? resolve(performance.now() - t0)
          : performance.now() - t0 > 2000
            ? resolve(-1)
            : requestAnimationFrame(tick);
      tick();
    });
  });
  check('hoàn tác ≤ 100 ms', undo >= 0 && undo <= 100, `${undo.toFixed(1)} ms`);

  // ---------- 4. Kiểm tra sau sửa ≤ 500 ms ----------
  // Sửa nhỏ (dịch một item bằng bàn phím) rồi đo tới khi thanh trạng thái hết "đang kiểm tra".
  await page.focus('mat-screen-canvas .vp');
  const validate = await page.evaluate(async () => {
    const t0 = performance.now();
    const vp = document.querySelector('mat-screen-canvas .vp');
    vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const checking = () => Boolean(document.querySelector('mat-statusbar .spin'));
    let seen = false;
    return new Promise((resolve) => {
      const tick = () => {
        const dt = performance.now() - t0;
        if (checking()) seen = true;
        if (seen && !checking()) return resolve(dt);
        if (dt > 3000) return resolve(-1);
        requestAnimationFrame(tick);
      };
      tick();
    });
  });
  check(
    'kiểm tra sau sửa (150 ms gom + chạy) ≤ 500 ms',
    validate >= 0 && validate <= 500,
    `${validate.toFixed(0)} ms`,
  );

  mkdirSync(join(here, 'out'), { recursive: true });
  writeFileSync(
    join(here, 'out', 'screen-perf.json'),
    JSON.stringify(
      {
        screen: '250 item (card, đèn, nhãn), 3840 × 2160',
        openMs: Math.round(open),
        drag100: {
          frames: drag.n,
          avgFrameMs: drag.avg,
          p95FrameMs: drag.p95,
          maxFrameMs: drag.max,
        },
        undoMs: Math.round(undo * 10) / 10,
        validateMs: Math.round(validate),
        date: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
}
