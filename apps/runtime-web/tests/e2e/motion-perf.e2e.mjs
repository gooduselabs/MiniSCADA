/* global document, requestAnimationFrame, performance */
// Hiệu năng chuyển động (feature 037, review BL335): màn hình 20 Thiết bị đang chạy (rotor quay) và 10 bồn có gợn sóng trên
// project grid-demo của runtime giả. CPU giả lập chậm 4 lần (gần BL335). Đo trong 5 giây: số khung hình (rAF), thời gian
// script, số lần tính lại style và layout (Performance.getMetrics), so với khi project tắt chuyển động (`motion: off`).
// Ghi số liệu vào tests/e2e/out/motion-perf.json. Ngưỡng: khi tắt chuyển động, style/layout gần như không đổi; khi bật,
// không có layout mỗi khung (quay và sóng chỉ dùng transform) và vẫn ≥ 20 khung/giây.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, waitDeep } from './util.mjs';
import { gridDemoProject } from './grid-demo-fixture.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const SCREEN = 'perf-037';

function perfScreen() {
  const items = [];
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const cells = [];
    for (let c = 0; c < 4; c++) {
      const id = `eq${r * 4 + c}`;
      items.push({
        id,
        type: 'widget',
        widget: 'equipment',
        props: { label: `Bơm ${r * 4 + c + 1}`, kind: c % 2 ? 'fan' : 'pump' },
        tags: { state: 'PUMP01.RUN' },
      });
      cells.push({ id: `c${id}`, span: 3, item: id });
    }
    rows.push({ id: `r${r}`, height: 150, cells });
  }
  for (let r = 0; r < 2; r++) {
    const cells = [];
    for (let c = 0; c < 5; c++) {
      const id = `lv${r * 5 + c}`;
      items.push({
        id,
        type: 'widget',
        widget: 'level',
        props: { label: `Bồn ${r * 5 + c + 1}`, style: 'tank', wave: true },
        tags: { value: 'TANK01.LEVEL' },
      });
      cells.push({ id: `c${id}`, span: c === 4 ? 4 : 2, item: id });
    }
    rows.push({ id: `rl${r}`, height: 200, cells });
  }
  return {
    schemaVersion: '1.1.0',
    id: SCREEN,
    name: 'Hiệu năng chuyển động',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    layout: { mode: 'grid', columns: 12, gap: 8, padding: 8, rows },
    items,
  };
}

function fixture(motion) {
  const f = gridDemoProject();
  const file = `screens/${SCREEN}.screen.json`;
  f.files.set(file, { json: perfScreen() });
  f.active.project = {
    ...f.active.project,
    screens: [...f.active.project.screens, SCREEN],
    ...(motion === 'off' ? { motion: 'off' } : {}),
  };
  f.active.screens = [
    ...f.active.screens,
    { id: SCREEN, name: 'Hiệu năng chuyển động', kind: 'screen', file },
  ];
  return f;
}

export const options = { fixture: () => fixture('on') };

async function measure(page) {
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const get = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
    );
  await sleep(1000);
  const a = await get();
  const frames = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const end = performance.now() + 5000;
        const f = () => {
          n++;
          if (performance.now() < end) requestAnimationFrame(f);
          else res(n);
        };
        requestAnimationFrame(f);
      }),
  );
  const b = await get();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return {
    fps: Math.round((frames / 5) * 10) / 10,
    scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
    styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
    layouts: b.LayoutCount - a.LayoutCount,
    styleMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
    layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
  };
}

export default async function run(ctx) {
  const { page } = ctx;
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(ctx.url + `/#/${SCREEN}`, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-equipment', 20);
  await sleep(1500);
  const spinning = await page.evaluate(() => {
    const s = document.querySelector('mat-screen')?.shadowRoot;
    const eq = [...(s?.querySelectorAll('mat-w-equipment') ?? [])];
    return eq.filter((e) => e.shadowRoot?.querySelector('.sq.spin') && !e.hasAttribute('still'))
      .length;
  });
  ctx.check('20 thiết bị đang quay (không still)', spinning === 20, String(spinning));
  const on = await measure(page);
  ctx.check(
    'bật chuyển động: ≥ 20 khung/giây với CPU chậm 4 lần',
    on.fps >= 20,
    JSON.stringify(on),
  );

  // Tắt chuyển động như thiết lập project `motion: off` (setMotion của trang vận hành: thuộc tính + sự kiện mat-motion).
  await page.evaluate(() => {
    document.documentElement.dataset.matMotion = 'off';
    document.dispatchEvent(new Event('mat-motion'));
  });
  await sleep(500);
  const still = await page.evaluate(
    () =>
      [
        ...(document.querySelector('mat-screen')?.shadowRoot?.querySelectorAll('mat-w-equipment') ??
          []),
      ].filter((e) => e.hasAttribute('still')).length,
  );
  ctx.check('tắt chuyển động: 20 thiết bị đứng yên (still)', still === 20, String(still));
  const off = await measure(page);
  const report = { on, off, note: 'CPU giả lập chậm 4×, 5 s, 20 equipment chạy + 10 bồn có sóng' };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'motion-perf.json'), JSON.stringify(report, null, 2) + '
');
  ctx.check(
    'bật chuyển động: quay và sóng không tính lại style/layout mỗi khung (chạy trên compositor)',
    on.styleRecalcs < on.fps * 5 * 0.1 && on.layouts < on.fps * 5 * 0.2,
    JSON.stringify(on),
  );
  ctx.check(
    'tắt chuyển động: không tốn hơn khi bật',
    off.scriptMs <= on.scriptMs * 1.5 + 50,
    JSON.stringify(off),
  );
  console.log('motion-perf', JSON.stringify(report));
}
