// E2E editor alarm (feature 009, T072, US2, FR-074..FR-080, FR-086, SC-016, SC-017), lớp Tauri giả, project 0.5 mẫu:
// - mở `projects/alarm-demo` (định dạng 0.5): mục Alarm trên cây đã mở khóa, Danh sách alarm hiện đủ alarm;
// - Lớp alarm: bốn lớp mặc định;
// - hộp "Tạo alarm cho Tag…" mở được từ bảng lệnh;
// - Thử alarm: panel mở được và có bảng alarm;
// - đo: mở bảng alarm (ms); axe 0 lỗi critical/serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  expandNode,
  openAndWait,
  readProject,
  runCommand,
  sleep,
  treeItem,
} from './util.mjs';
import { resolve } from 'node:path';
import { REPO } from './util.mjs';

const ALARM_DEMO = resolve(REPO, 'projects/alarm-demo');

export default async function alarmEditor({ page, check, shot, axe }) {
  void FULL_02;
  const files = readProject(ALARM_DEMO);
  await openAndWait(page, files, 'D:\\Projects\\alarm-demo');

  // ---------- 1. Mục Alarm đã mở khóa ----------
  const labels = await page.$$eval('mat-tree [role="treeitem"] .lbl', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check('cây có mục "Alarm"', labels.includes('Alarm'), labels.join(', '));
  const phase = await page.evaluate(
    () =>
      [...document.querySelectorAll('mat-tree [role="treeitem"]')]
        .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Alarm')
        ?.querySelector('.phase')?.textContent ?? null,
  );
  check('mục Alarm không còn nhãn giai đoạn', phase === null, String(phase));

  // ---------- 2. Danh sách alarm ----------
  await expandNode(page, 'alarm');
  await sleep(100);
  const t0 = Date.now();
  await treeItem(page, 'Danh sách alarm');
  await page.waitForSelector('mat-alarm-grid [role="gridcell"]', { timeout: 8000 });
  const openMs = Date.now() - t0;
  check('mở Danh sách alarm ≤ 1000 ms (SC-016)', openMs <= 1000, `${openMs} ms`);
  const count = await page.$eval('mat-alarm-grid [data-role="count"]', (e) => e.textContent.trim());
  check('bộ đếm cho biết 12 alarm', /12/.test(count), count);
  const heads = await page.$$eval('mat-alarm-grid [role="columnheader"]', (h) =>
    h.map((x) => x.textContent.trim()),
  );
  check('lưới có cột Tên và Loại', heads.includes('Tên') && heads.length >= 4, heads.join('|'));
  await shot('alarm-grid');
  await axeBoth(page, axe, 'Danh sách alarm');

  // ---------- 3. Lớp alarm ----------
  await treeItem(page, 'Lớp alarm');
  await page.waitForSelector('mat-alarm-classes [role="gridcell"]', { timeout: 8000 });
  await sleep(200);
  const classCount = await page.$eval('mat-alarm-classes [data-role="count"]', (e) =>
    e.textContent.trim(),
  );
  check('Lớp alarm có đủ bốn lớp mặc định', /4/.test(classCount), classCount);
  await axeBoth(page, axe, 'Lớp alarm');

  // ---------- 4. Hộp Tạo alarm cho Tag… ----------
  await runCommand(page, 'Tạo alarm cho Tag…');
  await page.waitForSelector('mat-alarm-quick-dialog', { timeout: 5000 });
  check('hộp "Tạo alarm cho Tag…" mở từ bảng lệnh', true);
  await page.keyboard.press('Escape');
  await sleep(150);

  // ---------- 5. Thử alarm ----------
  await runCommand(page, 'Thử alarm');
  await page.waitForSelector('mat-alarm-test', { timeout: 5000 });
  check('panel Thử alarm mở được', true);
  await shot('alarm-test');
  await axeBoth(page, axe, 'Thử alarm');
}
