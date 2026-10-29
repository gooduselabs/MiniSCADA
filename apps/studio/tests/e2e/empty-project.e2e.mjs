// E2E sửa lỗi 039: project mới tạo từ Studio (mẫu Trống) có 0 lỗi; tạo cấu hình Lưu trữ rồi xóa nhóm cuối thì vẫn 0 lỗi (Studio
// bỏ logging.json thay vì ghi `groups: []` sai schema); lỗi E_SCHEMA ở tab Thông tin là câu tiếng Việt, không phải câu tiếng
// Anh thô của bộ kiểm tra. Ảnh: tests/e2e/out/empty-project-*.png.
import { press, setTheme, sleep, waitFor } from './util.mjs';

const errors = (page) =>
  page.evaluate(() =>
    window.__matApp.store.state.issues
      .filter((i) => i.code.startsWith('E_'))
      .map((i) => `${i.file} ${i.code} ${i.message}`),
  );

export default async function emptyProject({ page, check, shot }) {
  await setTheme(page, 'light');
  await page.waitForSelector('mat-start-page .start-actions');
  await press(page, 'Control+n');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]');
  await waitFor(page, () => Boolean(document.querySelector('mat-new-project-dialog .np-parent')));
  await page.keyboard.type('Project rỗng');
  await sleep(150);
  await page.click('mat-new-project-dialog [data-role="ok"]');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]', { hidden: true });
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await sleep(500);
  let errs = await errors(page);
  check('project mới tạo: 0 lỗi', errs.length === 0, errs.join(' | '));

  // ---- Lưu trữ: tạo cấu hình (một nhóm), xóa nhóm cuối ----
  await page.evaluate(() => document.querySelector('mat-tree [id="ti-logging"]')?.click());
  await page.waitForSelector('mat-logging-editor [data-act="create"]');
  await page.click('mat-logging-editor [data-act="create"]');
  await sleep(300);
  const groups = await page.evaluate(
    () => window.__matApp.store.state.outline.logging?.groups.length ?? -1,
  );
  check('Tạo cấu hình lưu trữ: có sẵn một nhóm', groups === 1, groups);
  // Nhóm chưa có Tag: lỗi là câu tiếng Việt ở tab Thông tin, không phải câu tiếng Anh thô.
  const raw = await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector .msg, mat-logging-editor li, .banner')]
      .map((e) => e.textContent)
      .filter((s) => /too few items|does not match/.test(s)),
  );
  check('không hiện câu tiếng Anh thô của E_SCHEMA', raw.length === 0, raw.join(' | '));
  await shot('1-mot-nhom');
  await page.evaluate(() => window.__matApp.select({ kind: 'group', index: 0 }));
  await sleep(150);
  await page.click('mat-logging-editor [data-act="del-group"]');
  await sleep(400);
  const state = await page.evaluate(() => ({
    file: window.__matApp.store.state.outline.loggingFile,
  }));
  check('xóa nhóm cuối: bỏ logging.json khỏi project', state.file === null, String(state.file));
  errs = await errors(page);
  check('xóa nhóm lưu trữ cuối: 0 lỗi', errs.length === 0, errs.join(' | '));
  await shot('2-xoa-nhom-cuoi');
  await press(page, 'Control+z');
  await sleep(300);
  const back = await page.evaluate(
    () => window.__matApp.store.state.outline.logging?.groups.length ?? -1,
  );
  check('Ctrl+Z: nhóm quay lại', back === 1, back);
}
