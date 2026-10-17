// E2E "Cập nhật runtime" (OTA, feature 011, T119; FR-068): thiết bị giả runtime 1.0 báo `update.supported`; administrator Online
// thấy task card trong trang Thiết bị; hộp Cập nhật runtime: chọn file, tải lên, kế hoạch (phiên bản, tương thích, thời gian
// ngừng, người ký), nhập mật khẩu, theo dõi qua lúc dịch vụ chạy lại tới committed; thanh trạng thái thấy runtime mới; "Quay về
// bản trước" hỏi mật khẩu. axe 0 critical/serious ở hai theme cho từng bước.
import {
  FULL_02,
  axeScopedBoth,
  clickButton,
  goOnline,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

const clickSel = (page, sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s);
    b?.click();
    return Boolean(b);
  }, sel);

export default async function ota(ctx) {
  const { page, check } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, readProject(FULL_02), 'D:\\Projects\\full-02');
  const pw = await goOnline(page, 'admin');
  await page.evaluate(() => {
    const c = window.__matMock.device;
    c.setRuntime('BL335-01', '1.0.0');
    c.setUpdate('BL335-01', { enabled: true, previous: { version: '0.9.5', available: true } });
  });
  await treeNode(page, 'device');
  await waitFor(
    page,
    () => document.querySelector('mat-device-page [data-act="ota-open"]') !== null,
    undefined,
    15000,
  );
  check(
    'trang Thiết bị có task card Cập nhật runtime (administrator, update.supported)',
    /Cập nhật runtime/.test(
      await page.$eval('mat-device-page [data-role="ota"]', (e) => e.textContent),
    ),
  );
  await clickSel(page, 'mat-device-page [data-act="ota-open"]');
  await page.waitForSelector('mat-update-wizard [role="dialog"]');
  await waitFor(page, () =>
    Boolean(document.querySelector('mat-update-wizard [data-step="pick"]')),
  );
  await axeScopedBoth(ctx, 'hộp Cập nhật runtime: chọn file', []);
  await clickSel(page, 'mat-update-wizard [data-act="pick"]');
  await waitFor(page, () =>
    /matupdate/.test(document.querySelector('mat-update-wizard [data-role="file"]')?.textContent),
  );
  await clickSel(page, 'mat-update-wizard [data-act="upload"]');
  await waitFor(page, () =>
    Boolean(document.querySelector('mat-update-wizard [data-step="plan"]')),
  );
  const plan = await page.$eval('mat-update-wizard [data-role="plan"]', (e) =>
    e.textContent.replace(/\s+/g, ' '),
  );
  check(
    'kế hoạch: phiên bản, tương thích, thời gian ngừng, người ký',
    ['1.0.0', '1.0.1', 'Tương thích', '25 s', 'release-primary', 'sha256:'].every((s) =>
      plan.includes(s),
    ),
    plan,
  );
  check(
    'nút Cập nhật khóa khi chưa nhập mật khẩu',
    await page.$eval('mat-update-wizard [data-act="apply"]', (b) => b.disabled),
  );
  await ctx.shot('ke-hoach');
  await axeScopedBoth(ctx, 'hộp Cập nhật runtime: kế hoạch', []);
  await page.type('mat-update-wizard input[type="password"]', `${pw}-admin`);
  await sleep(50);
  await clickSel(page, 'mat-update-wizard [data-act="apply"]');
  await waitFor(page, () =>
    Boolean(document.querySelector('mat-update-wizard [data-step="following"]')),
  );
  check(
    'theo dõi: vùng trạng thái, không đóng được',
    await page.$eval(
      'mat-update-wizard',
      (d) =>
        d.querySelector('[data-role="following"]')?.getAttribute('role') === 'status' &&
        d.querySelector('.dlg-h .ibtn')?.disabled === true,
    ),
  );
  await axeScopedBoth(ctx, 'hộp Cập nhật runtime: theo dõi', []);
  await waitFor(
    page,
    () => Boolean(document.querySelector('mat-update-wizard [data-step="result"]')),
    undefined,
    20000,
  );
  check(
    'kết quả committed kèm phiên bản mới',
    await page.$eval(
      'mat-update-wizard .result',
      (r) => r.dataset.outcome === 'committed' && /1\.0\.1/.test(r.textContent),
    ),
  );
  check(
    'mật khẩu không vào nhật ký lệnh của thiết bị giả',
    !(await page.evaluate(
      (p) => JSON.stringify(window.__matMock.device.calls).includes(p),
      `${pw}-admin`,
    )),
  );
  await ctx.shot('ket-qua');
  await axeScopedBoth(ctx, 'hộp Cập nhật runtime: kết quả', []);
  await waitFor(
    page,
    () => /1\.0\.1/.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
    undefined,
    10000,
  );
  check('thanh trạng thái thấy runtime 1.0.1', true);

  // Quay về bản trước: hỏi mật khẩu.
  await clickSel(page, 'mat-update-wizard [data-act="rollback"]');
  await waitFor(page, () =>
    Boolean(document.querySelector('mat-update-wizard [data-step="confirm-rollback"]')),
  );
  check(
    'Quay về bản trước: có ô mật khẩu, nút khóa tới khi nhập',
    await page.$eval(
      'mat-update-wizard',
      (d) =>
        Boolean(d.querySelector('input[type="password"]')) &&
        d.querySelector('[data-act="rollback-go"]').disabled,
    ),
  );
  await axeScopedBoth(ctx, 'hộp Quay về bản trước', []);
  await clickButton(page, 'mat-update-wizard .dlg-f', 'Hủy');
  await waitFor(page, () => !document.querySelector('mat-update-wizard [role="dialog"]'));
}
