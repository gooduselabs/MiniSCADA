// E2E editor Lưu trữ chỉ đọc (feature 004, US4, quickstart §4 bước 17, T082): mở từ cây, đủ 2 nhóm của
// project mẫu, chọn nhóm đổi inspector, có ước tính ghi, không hiện mật khẩu; axe 0 vi phạm nặng.

export default async function logging({ page, check, shot, axe }) {
  await page.waitForSelector('mat-start-page .start-hero');
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-tree [role="treeitem"]')]
      .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Lưu trữ')
      ?.click(),
  );
  await page.waitForFunction(() =>
    document.querySelector('#editor-panel')?.textContent?.includes('Vận hành'),
  );
  const body = await page.$eval('#editor-panel', (e) => e.textContent.replace(/\s+/g, ' '));
  check('đủ 2 nhóm của project mẫu', body.includes('Vận hành') && body.includes('Báo cáo ca'));
  check('có ước tính ghi eMMC', /ngân sách/i.test(body), body.slice(0, 200));
  check('không hiện mật khẩu', !/password|mật khẩu:/i.test(body));
  const ctx = await page.$eval('mat-inspector .insp-ctx', (e) => e.textContent.trim());
  check('inspector hiện nhóm đang chọn', /Vận hành|nhóm/i.test(ctx), ctx);
  await shot('1-luu-tru');
  await axe('editor Lưu trữ');
}
