// E2E hiệu năng lưới alarm 2.000 dòng (feature 009, T086, FR-087, SC-016), Chrome headless trên lớp Tauri giả.
// Project: alarm-demo với alarms.json sinh trong bộ nhớ (2.000 alarm `limit`). Đo: mở ≤ 1 s; cuộn 2 giây bằng
// scrollTop mỗi khung hình, khung trung bình ≤ 16,7 ms (nhiễu máy: ghi số đo, ngưỡng cứng 33 ms); chỉ vẽ một cửa sổ dòng
// (ảo hóa). Số đo ghi vào tests/e2e/out/alarm-perf.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, axeBoth, expandNode, openAndWait, readProject, sleep, treeItem } from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export default async function alarmPerf({ page, check, axe }) {
  const files = readProject(resolve(REPO, 'projects/alarm-demo'));
  const alarms = JSON.parse(files['alarms.json']);
  const list = [];
  for (let i = 0; i < 2000; i++) {
    list.push({
      id: `PERF_${String(i).padStart(4, '0')}`,
      type: 'limit',
      name: `Mức thử ${i}`,
      area: 'bon',
      tag: 'TANK1.LEVEL',
      limits: { H: { value: 50 + (i % 40), class: 'minor' } },
      deadband: 1,
    });
  }
  alarms.alarms = list;
  files['alarms.json'] = JSON.stringify(alarms);
  await openAndWait(page, files, 'D:\\Projects\\alarm-2000');

  await expandNode(page, 'alarm');
  await sleep(100);
  const t0 = Date.now();
  await treeItem(page, 'Danh sách alarm');
  await page.waitForSelector('mat-alarm-grid [role="gridcell"]', { timeout: 20000 });
  const openMs = Date.now() - t0;
  const rendered = await page.$$eval('mat-alarm-grid [role="row"][data-r]', (r) => r.length);
  check(
    `mở lưới 2.000 alarm ≤ 1 s (đo ${openMs} ms; vẽ ${rendered} dòng)`,
    openMs <= 1000 && rendered < 120,
    `${openMs} ms, ${rendered} dòng`,
  );
  await sleep(1500);

  const frames = await page.evaluate(async () => {
    const root = document.querySelector('mat-alarm-grid');
    const sc = [...root.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 200);
    if (!sc) return { error: 'no scroller' };
    const dt = [];
    let last = performance.now();
    const end = last + 2000;
    await new Promise((done) => {
      const step = () => {
        const now = performance.now();
        dt.push(now - last);
        last = now;
        sc.scrollTop += 40;
        if (now < end) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return { dt: dt.slice(2), top: sc.scrollTop };
  });
  const dts = frames.dt ?? [];
  const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 999;
  const max = dts.length ? Math.max(...dts) : 999;
  check(
    `cuộn mượt: khung trung bình ${avg.toFixed(1)} ms (ngưỡng ≤ 33; mục tiêu 16,7)`,
    !frames.error && dts.length > 20 && avg <= 33,
    JSON.stringify({ n: dts.length, avg, max, top: frames.top, err: frames.error }),
  );
  await axeBoth(page, axe, 'Danh sách alarm 2.000 dòng');
  try {
    mkdirSync(join(here, 'out'), { recursive: true });
    writeFileSync(
      join(here, 'out', 'alarm-perf.json'),
      JSON.stringify({ openMs, rendered, frames: dts.length, avgFrameMs: avg, maxFrameMs: max }),
    );
  } catch {
    /* thư mục out là tiện ích */
  }
}
