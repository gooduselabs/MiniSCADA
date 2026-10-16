// E2E widget alarm trong trình bố trí Studio (feature 009, T103 phía Studio, US5, FR-068, SC-014), lớp Tauri giả:
// project alarm-demo (0.5), màn hình "Tổng quan": Toolbox có nhóm Alarm với `alarm-list`, `alarm-count`; kéo cả hai lên canvas;
// widget vừa thả được chọn và inspector hiện thuộc tính của danh mục; axe 0 lỗi critical/serious sáng/tối; 0 lỗi console.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  designToPage,
  dragAndDrop,
  openAndWait,
  readProject,
  sleep,
  treeItem,
} from './util.mjs';

const itemCount = (page) => page.$$eval('mat-screen-canvas .oi', (e) => e.length);

export default async function alarmWidgets({ page, check, shot, axe }) {
  const files = readProject(resolve(REPO, 'projects/alarm-demo'));
  await openAndWait(page, files, 'D:\\Projects\\alarm-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  const before = await itemCount(page);

  const tools = await page.$$eval('mat-taskcards .tool[data-widget]', (t) =>
    t.map((x) => x.getAttribute('data-widget')),
  );
  check(
    'Toolbox có alarm-list và alarm-count',
    tools.includes('alarm-list') && tools.includes('alarm-count'),
    tools.join(','),
  );

  for (const [i, w] of ['alarm-list', 'alarm-count'].entries()) {
    const at = await designToPage(page, 360 + i * 420, 60);
    const r = await dragAndDrop(
      page,
      `mat-taskcards .tool[data-widget="${w}"]`,
      'mat-screen-canvas .vp',
      at.x,
      at.y,
    );
    if (r !== 'ok') throw new Error(`kéo ${w}: ${r}`);
    await sleep(120);
  }
  const after = await itemCount(page);
  check('kéo thả hai widget alarm lên canvas', after === before + 2, `${before} → ${after}`);
  const selected = await page.$$eval(
    'mat-screen-canvas .oi[aria-selected="true"]',
    (e) => e.length,
  );
  check('widget vừa thả được chọn', selected === 1, String(selected));
  const inspector = await page.$eval('mat-inspector', (e) => e.textContent ?? '');
  check(
    'inspector hiện thuộc tính của widget alarm',
    inspector.length > 20,
    inspector.slice(0, 80),
  );
  await shot('alarm-widgets');
  await axeBoth(page, axe, 'Màn hình có widget alarm');
}
