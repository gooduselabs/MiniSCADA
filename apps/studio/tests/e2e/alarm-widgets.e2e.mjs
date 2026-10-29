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

  // ---- Feature 041: Kiểu hiển thị Đầy đủ / Gọn, Hiển thị hiện hành / Lịch sử, preset "Lịch sử alarm" ----
  check(
    'Toolbox có mục "Lịch sử alarm" (preset của alarm-list)',
    tools.includes('alarm-list~history'),
    tools.join(','),
  );
  await page.$eval('mat-screen-canvas .oi[data-item^="alarm_list"]', (e) => {
    const r = e.getBoundingClientRect();
    e.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: r.x + 5,
        clientY: r.y + 5,
        pointerId: 1,
        button: 0,
      }),
    );
    e.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: r.x + 5,
        clientY: r.y + 5,
        pointerId: 1,
        button: 0,
      }),
    );
  });
  await sleep(200);
  const field = await page
    .$eval('mat-inspector [data-field="prop:mode"]', (e) => ({
      text: e.textContent.replace(/s+/g, ' '),
      value: e.querySelector('select')?.value ?? null,
      opts: [...e.querySelectorAll('option')].map((o) => o.textContent.trim()),
    }))
    .catch(() => null);
  check(
    'Inspector: ô "Kiểu hiển thị" Đầy đủ / Gọn kèm mô tả; bảng mới thả là Đầy đủ',
    !!field &&
      /Kiểu hiển thị/.test(field.text) &&
      /trang Alarm hệ thống/.test(field.text) &&
      field.value === 'full' &&
      field.opts.includes('Đầy đủ') &&
      field.opts.includes('Gọn'),
    JSON.stringify(field),
  );
  const src = await page
    .$eval('mat-inspector [data-field="prop:source"]', (e) =>
      [...e.querySelectorAll('option')].map((o) => o.textContent.trim()),
    )
    .catch(() => null);
  check(
    'Inspector: ô "Hiển thị" Alarm hiện hành / Lịch sử alarm',
    !!src && src.includes('Alarm hiện hành') && src.includes('Lịch sử alarm'),
    JSON.stringify(src),
  );
  await page.$eval('mat-screen-toolbar [data-mode="sim"]', (b) => b.click());
  let full = false;
  for (let i = 0; i < 30 && !full; i++) {
    await sleep(150);
    full = await page.evaluate(() => {
      const all = (root) => {
        const out = [];
        for (const e of root.querySelectorAll('*')) {
          if (e.tagName === 'MAT-W-ALARM-LIST') out.push(e);
          if (e.shadowRoot) out.push(...all(e.shadowRoot));
        }
        return out;
      };
      return all(document).some((w) => !!w.shadowRoot?.querySelector('.al-tabs'));
    });
  }
  check('Mô phỏng: Bảng alarm Đầy đủ hiện tab và bộ lọc như trang Alarm', full);
  await page.$eval('mat-screen-toolbar [data-mode="off"]', (b) => b.click());
  await sleep(200);
}
