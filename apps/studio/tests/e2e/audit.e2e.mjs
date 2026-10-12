// E2E Chẩn đoán đầy đủ và Audit (feature 005, US4, T147–T149, FR-032; quickstart §5 bước 14–15) với DeviceLink giả
// (platform/mock-device.ts, điều khiển qua window.__matMock.device):
// - Online (admin): tab Chẩn đoán có CPU (trung bình 1 phút), RAM runtime và hệ thống, dung lượng trống, thời gian chạy,
//   số phiên đăng nhập, độ lệch giờ; số liệu đổi sau ≤ 5 s;
// - Audit (Online › Audit của thiết bị): bản ghi mới nhất trước có đăng nhập thất bại và truy cập bị từ chối; lọc theo
//   tài khoản và hành động; Tải thêm; tài khoản engineer thấy "không đủ quyền";
// - axe-core ở Chẩn đoán và Audit, theme sáng và tối.
// Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
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

const metricText = (page, label) =>
  page.evaluate((l) => {
    const m = [...document.querySelectorAll('mat-inspector .metric')].find(
      (x) => x.querySelector('.l')?.textContent.trim() === l,
    );
    return m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
  }, label);

const AU = 'mat-audit-view';

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

export default async function audit(ctx) {
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
  await page.click('mat-start-page .start-hero .btn.primary');
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await signIn(page, pw, 'admin');

  // 1. Tab Chẩn đoán: số liệu đủ; cập nhật trong ≤ 5 s.
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector [role="tab"]')]
      .find((b) => b.textContent.includes('Chẩn đoán'))
      ?.click(),
  );
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-inspector .metric .l')].some(
      (l) => l.textContent.trim() === 'RAM hệ thống',
    ),
  );
  const cpu = await metricText(page, 'CPU');
  const ramRuntime = await metricText(page, 'RAM runtime');
  const ramSystem = await metricText(page, 'RAM hệ thống');
  const disk = await metricText(page, 'Dung lượng trống');
  const uptime = await metricText(page, 'Thời gian chạy runtime');
  const logins = await metricText(page, 'Phiên đăng nhập');
  const clock = await metricText(page, 'Giờ thiết bị');
  check(
    'Chẩn đoán: CPU trung bình 1 phút, RAM runtime và hệ thống, dung lượng trống, thời gian chạy, phiên, giờ',
    /11,7 % hệ thống/.test(cpu) &&
      /trung bình 1 phút/.test(cpu) &&
      /9,4 MB/.test(ramRuntime) &&
      /993,0 MB/.test(ramSystem) &&
      /6,1 GB \/ 6,8 GB/.test(disk) &&
      /1 giờ 0 phút/.test(uptime) &&
      /1/.test(logins) &&
      /lệch/.test(clock),
    [cpu, ramRuntime, ramSystem, disk, uptime, logins, clock].join(' | '),
  );
  await page.evaluate(() =>
    window.__matMock.device.setDiagnostics('BL335-01', {
      cpu: { systemPct1m: 61.3, runtimePct1m: 7.9, loadAvg1: 1.2, cores: 2 },
    }),
  );
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-inspector .metric')].some((m) =>
        /61,3 % hệ thống/.test(m.textContent),
      ),
    undefined,
    7000,
  );
  check('Chẩn đoán cập nhật sau ≤ 5 s khi số liệu trên thiết bị đổi', true);
  await shot('1-chan-doan');
  await axeBoth(page, axe, 'Chẩn đoán đầy đủ');

  // 2. Audit của administrator.
  await openMenuItem(page, 'Audit của thiết bị');
  await page.waitForSelector(`${AU} tr[data-id]`);
  const rows = await page.$$eval(`${AU} tr[data-id]`, (r) =>
    r.map((x) => ({ id: Number(x.dataset.id), action: x.dataset.action, user: x.dataset.user })),
  );
  const ids = rows.map((r) => r.id);
  check(
    'Audit: mới nhất trước, có đăng nhập thất bại và truy cập bị từ chối',
    ids.every((v, i) => i === 0 || ids[i - 1] > v) &&
      (await text(page, `${AU} tbody`)).includes('AUTH_FAILED') &&
      rows.some((r) => r.action === 'access.denied'),
    `${rows.length} dòng`,
  );
  await shot('2-audit');
  await axeBoth(page, axe, 'Audit');

  // Lọc theo tài khoản và hành động.
  await page.type(`${AU} [data-role="filter-user"]`, 'kysu1');
  await page.select(`${AU} [data-role="filter-action"]`, 'project.');
  await page.click(`${AU} [data-role="apply"]`);
  await waitFor(
    page,
    () => {
      const r = [...document.querySelectorAll('mat-audit-view tr[data-id]')];
      return (
        r.length > 0 &&
        r.every((x) => x.dataset.user === 'kysu1' && x.dataset.action.startsWith('project.'))
      );
    },
    undefined,
    5000,
  );
  check('Audit: lọc theo tài khoản và hành động', true);

  // Tải thêm.
  await page.evaluate(() =>
    window.__matMock.device.addAudit(
      'BL335-01',
      Array.from({ length: 120 }, () => ({ action: 'project.read', result: 'ok', user: 'kysu1' })),
    ),
  );
  await page.click(`${AU} [data-role="clear"]`);
  await waitFor(page, () => document.querySelectorAll('mat-audit-view tr[data-id]').length === 100);
  await page.click(`${AU} [data-role="more"]`);
  await waitFor(page, () => document.querySelectorAll('mat-audit-view tr[data-id]').length > 100);
  check('Audit: Tải thêm nối bản ghi cũ hơn', true);

  // 3. Engineer: "không đủ quyền".
  await openMenuItem(page, 'Đăng xuất');
  await waitFor(
    page,
    () => !/admin · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );
  await signIn(page, pw, 'kysu1');
  await openMenuItem(page, 'Audit của thiết bị');
  await page.waitForSelector(`${AU} [data-role="forbidden"]`);
  check(
    'engineer mở Audit: "không đủ quyền", không có bảng',
    /không đủ quyền/.test(await text(page, `${AU} [data-role="forbidden"]`)) &&
      !(await page.$(`${AU} table`)),
    await text(page, `${AU} [data-role="forbidden"]`),
  );
  await shot('3-khong-du-quyen');
  await axeBoth(page, axe, 'Audit, không đủ quyền');
}
