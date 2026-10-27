// E2E "Thiết lập thiết bị" (feature 027, FR-007) với DeviceLink giả (platform/mock-device-settings.ts):
// - Online administrator: cây có Thiết bị › Thiết lập thiết bị; lưới thuộc tính có nguồn (runtime.json);
// - lưu tên thiết bị (không hỏi mật khẩu), tắt bắt buộc đăng nhập (hỏi mật khẩu, sai thì báo);
// - tab Chứng chỉ: cảnh báo không có IP, sinh lại có IP thêm, chờ khởi động lại, so vân tay rồi ghim lại, kết nối lại;
// - nhập chứng chỉ sai khóa: lỗi CERT_KEY_MISMATCH; tài khoản engineer không thấy nút trên cây;
// - axe-core sáng và tối. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy.
import { randomBytes } from 'node:crypto';

const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

async function setTheme(page, theme) {
  for (let i = 0; i < 3; i++) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme ?? 'system')) === theme)
      return;
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((b) => /Theo hệ thống|Sáng|Tối/.test(b.textContent))
        ?.click(),
    );
  }
}

async function axeBoth(page, axe, label) {
  await setTheme(page, 'light');
  await axe(`${label}, theme sáng`);
  await setTheme(page, 'dark');
  await axe(`${label}, theme tối`);
  await setTheme(page, 'light');
}

async function clickButton(page, scope, label) {
  const ok = await page.evaluate(
    (s, l) => {
      const b = [...document.querySelectorAll(`${s} button`)].find((x) =>
        x.textContent.includes(l),
      );
      b?.click();
      return Boolean(b);
    },
    scope,
    label,
  );
  if (!ok) throw new Error(`không thấy nút "${label}" trong ${scope}`);
}

async function waitFor(page, fn, arg, timeout = 8000) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, arg);
}

async function openMenuItem(page, label) {
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  await page.waitForSelector('.menu-pop [role="menuitem"]');
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('.menu-pop [role="menuitem"]')].find((e) =>
      e.textContent.includes(l),
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục menu "${label}"`);
}

async function signIn(page, pw, user) {
  await ctrl(page, 'KeyK');
  // Lần đầu: Thiết bị trong mạng (project chưa gắn thiết bị), rồi ghim; các lần sau Ctrl+K đi thẳng tới đăng nhập.
  await page.waitForSelector(
    'mat-devices-dialog [role="dialog"], mat-pin-dialog [role="dialog"], mat-login-dialog [role="dialog"]',
  );
  if (await page.$('mat-devices-dialog [role="dialog"]')) {
    await waitFor(
      page,
      () => /Tìm xong/.test(document.querySelector('mat-devices-dialog .scan')?.textContent ?? ''),
      undefined,
      6000,
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')]
        .find((r) => r.textContent.includes('BL335-01'))
        ?.click(),
    );
    await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  }
  await page.waitForSelector('mat-pin-dialog [role="dialog"], mat-login-dialog [role="dialog"]');
  if (await page.$('mat-pin-dialog [role="dialog"]'))
    await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  // Ô tên giữ tài khoản của lần trước: chọn hết rồi gõ đè.
  await page.$eval('mat-login-dialog input[name="user"]', (e) => {
    e.focus();
    e.select();
  });
  await page.type('mat-login-dialog input[name="user"]', user);
  await page.type('mat-login-dialog input[name="password"]', `${pw}-${user}`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(
    page,
    (u) => new RegExp(`${u} · `).test(document.querySelector('mat-statusbar')?.textContent ?? ''),
    user,
  );
}

const DS = 'mat-device-settings';

async function signOut(page) {
  await openMenuItem(page, 'Đăng xuất');
  await waitFor(
    page,
    () => !/admin · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );
}

async function reauth(page, password) {
  await page.waitForSelector(`${DS} [data-role="reauth-password"]`);
  await page.$eval(`${DS} [data-role="reauth-password"]`, (e) => {
    e.value = '';
  });
  await page.type(`${DS} [data-role="reauth-password"]`, password);
  await page.click(`${DS} [data-role="reauth-ok"]`);
}

export default async function deviceSettings(ctx) {
  const { page } = ctx;
  await page.waitForSelector('mat-start-page .start-hero');
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  try {
    await scenario(ctx);
  } finally {
    await setTheme(page, theme).catch(() => undefined);
  }
}

async function scenario({ page, check, shot, axe }) {
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await page.evaluate((p) => {
    const c = window.__matMock.device;
    for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
  }, pw);
  await setTheme(page, 'light');
  await page.click('mat-start-page .start-hero [data-cmd="project.open"]');
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await signIn(page, pw, 'admin');

  // 1. Cây: Thiết bị › Thiết lập thiết bị (administrator).
  await page.waitForSelector('mat-tree [id="ti-deviceSettings"]');
  await page.click('mat-tree [id="ti-deviceSettings"]');
  await page.waitForSelector(`${DS} tr[data-key="deviceName"] input`);
  check(
    'cây có Thiết lập thiết bị; lưới có nguồn runtime.json',
    (await text(page, `${DS} tr[data-key="deviceName"]`)).includes('runtime.json'),
    await text(page, `${DS} tr[data-key="deviceName"]`),
  );
  await shot('1-thiet-lap');
  await axeBoth(page, axe, 'Thiết lập thiết bị, tab Chung');

  // 2. Đổi tên: không hỏi mật khẩu.
  await page.$eval(`${DS} tr[data-key="deviceName"] input`, (e) => {
    e.value = '';
  });
  await page.type(`${DS} tr[data-key="deviceName"] input`, 'Trạm bơm 1');
  await page.click(`${DS} [data-role="save"]`);
  await waitFor(
    page,
    () =>
      /Thiết lập thiết bị/.test(
        document.querySelector('mat-device-settings tr[data-key="deviceName"]')?.textContent ?? '',
      ),
    undefined,
    10000,
  );
  check(
    'đổi tên: lưu không cần mật khẩu, nguồn thành Thiết lập thiết bị',
    !(await page.$(`${DS} [data-role="reauth"]`)),
  );

  // 3. Tắt bắt buộc đăng nhập: hỏi mật khẩu; sai thì báo REAUTH_REQUIRED.
  await page.click(`${DS} tr[data-key="viewerLogin"] input`);
  await page.click(`${DS} [data-role="save"]`);
  await reauth(page, 'sai-mat-khau');
  await waitFor(page, () =>
    /REAUTH_REQUIRED/.test(
      document.querySelector('mat-device-settings [data-role="error"]')?.textContent ?? '',
    ),
  );
  check(
    'mật khẩu sai: thiết bị từ chối, hộp xác nhận còn',
    !!(await page.$(`${DS} [data-role="reauth"]`)),
  );
  await reauth(page, `${pw}-admin`);
  await waitFor(
    page,
    () =>
      /Thiết lập thiết bị/.test(
        document.querySelector('mat-device-settings tr[data-key="viewerLogin"]')?.textContent ?? '',
      ),
    undefined,
    10000,
  );
  check(
    'tắt bắt buộc đăng nhập sau khi nhập lại mật khẩu',
    !(await page.$(`${DS} [data-role="reauth"]`)),
  );

  // 4. Chứng chỉ: cảnh báo không có IP, sinh lại có IP, ghim lại có xác nhận.
  await page.click(`${DS} #ds-tab-cert`);
  await page.waitForSelector(`${DS} [data-role="cert"]`);
  check('cảnh báo TLS_NO_IP_SAN', !!(await page.$(`${DS} [data-warning="TLS_NO_IP_SAN"]`)));
  await axeBoth(page, axe, 'Thiết lập thiết bị, tab Chứng chỉ');
  const before = await text(page, `${DS} [data-cert="devset.cert.fingerprint"]`);
  await page.type(`${DS} [data-role="san"]`, '10.0.0.5');
  await page.click(`${DS} [data-role="regen"]`);
  await reauth(page, `${pw}-admin`);
  await page.waitForSelector(`${DS} [data-repin="confirm"]`, { timeout: 15000 });
  const expected = await text(page, `${DS} [data-role="fp-expected"]`);
  const seen = await text(page, `${DS} [data-role="fp-seen"]`);
  check(
    'vân tay thấy trùng vân tay thiết bị trả, khác vân tay cũ',
    expected === seen && expected !== before,
    `${before} → ${expected}`,
  );
  await shot('2-ghim-lai');
  await axeBoth(page, axe, 'Ghim lại chứng chỉ');
  await page.click(`${DS} [data-role="repin"]`);
  // Rust bỏ phiên khi gỡ ghim cũ: đăng nhập lại sau khi ghim chứng chỉ mới.
  await page.waitForSelector('mat-login-dialog [role="dialog"]', { timeout: 15000 });
  await page.$eval('mat-login-dialog input[name="user"]', (e) => {
    e.focus();
    e.select();
  });
  await page.type('mat-login-dialog input[name="user"]', 'admin');
  await page.type('mat-login-dialog input[name="password"]', `${pw}-admin`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(
    page,
    () => /admin · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
    undefined,
    15000,
  );
  await page.waitForSelector(`${DS} [data-role="cert"]`, { timeout: 15000 });
  check('ghim lại và Online lại', true);

  // 5. Nhập chứng chỉ sai khóa.
  if (!(await page.$(`${DS} [data-role="pem"]`))) await page.click(`${DS} #ds-tab-cert`);
  await page.waitForSelector(`${DS} [data-role="pem"]`);
  await page.type(
    `${DS} [data-role="pem"]`,
    '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  );
  await page.click(`${DS} [data-role="import"]`);
  await reauth(page, `${pw}-admin`);
  await waitFor(page, () =>
    /CERT_KEY_MISMATCH/.test(
      document.querySelector('mat-device-settings [data-role="error"]')?.textContent ?? '',
    ),
  );
  check('nhập chứng chỉ sai khóa: CERT_KEY_MISMATCH', true);

  // 6. Engineer không thấy Thiết lập thiết bị.
  await signOut(page);
  await signIn(page, pw, 'kysu1');
  check(
    'engineer: không có Thiết lập thiết bị trên cây',
    !(await page.$('mat-tree [id="ti-deviceSettings"]')),
  );
}
