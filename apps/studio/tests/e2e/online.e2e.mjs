// E2E làm việc với thiết bị (feature 005, T085, US1, quickstart §5 bước 1–6, 16) với DeviceLink giả
// (platform/mock-device.ts, alias Vite chế độ e2e; điều khiển qua window.__matMock.device):
// - Online › Thiết bị trong mạng hiện hai thiết bị trong ≤ 3 s; chọn dòng hiện chi tiết; thêm theo địa chỉ;
// - Online lần đầu → xác nhận chứng chỉ; không xác nhận thì không đi tiếp;
// - đăng nhập kysu1 → viền cam, thanh trạng thái "kysu1 · engineer"; ô mật khẩu xóa ngay, mật khẩu không nằm
//   trong DOM, localStorage hay danh sách thiết bị đã lưu;
// - phiên hết hạn → hộp thoại đăng nhập lại; Tag đang sửa vẫn còn, chưa lưu;
// - chứng chỉ đổi → chặn, hiện fingerprint cũ và mới;
// - sai 5 lần → "tài khoản tạm khóa";
// - thiết bị runtime cũ → theo dõi chỉ đọc kèm "runtime cần cập nhật để nạp xuống";
// - axe-core ở cả ba hộp thoại, theme sáng và tối.
// T085a (FR-031): Ctrl+K khi project chưa gắn thiết bị mở Thiết bị trong mạng; chọn (Online) hoặc thêm thiết bị
// ở đó thì thiết bị gắn với project; Ctrl+K khi đã gắn chạy luồng Online (còn phiên Rust thì không hỏi đăng
// nhập; runtime cũ thì theo dõi chỉ đọc); thiết bị thêm theo địa chỉ mang tên thiết bị báo sau khi đăng nhập.
// Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomBytes } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const cell = (r, c) => `mat-tag-grid [role="gridcell"][data-r="${r}"][data-c="${c}"]`;
const HEX64 = /^[0-9a-f]{64}$/;
/** Chữ của khung fingerprint → 64 hex chữ thường (bỏ khoảng trắng, xuống dòng). */
const fpHex = (s) => s.replace(/\s/g, '').toLowerCase();

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

async function clickTreeItem(page, label) {
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('mat-tree [role="treeitem"]')].find(
      (e) => e.querySelector('.lbl')?.textContent.trim() === l,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục cây "${label}"`);
}

/** Nhấp nút có chữ `label` trong `scope` (qua DOM: không bị lớp phủ chặn). */
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

/** Chờ chữ trong `sel` khớp `re`; trả thời gian chờ (ms) hoặc -1 nếu quá hạn. */
async function waitText(page, sel, re, timeout = 5000) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(
      (s, src, flags) =>
        new RegExp(src, flags).test(
          (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' '),
        ),
      { timeout, polling: 50 },
      sel,
      re.source,
      re.flags,
    );
    return Date.now() - t0;
  } catch {
    return -1;
  }
}

const dialogKind = (page) =>
  page.evaluate(() => {
    for (const tag of ['mat-devices-dialog', 'mat-pin-dialog', 'mat-login-dialog'])
      if (document.querySelector(`${tag} [role="dialog"]`)) return tag;
    return document.querySelector('mat-dialog [role="dialog"]') ? 'mat-dialog' : null;
  });

async function waitDialog(page, tag, timeout = 5000) {
  await page.waitForSelector(`${tag} [role="dialog"]`, { timeout });
}

const rowTexts = (page) =>
  page.$$eval('mat-devices-dialog tbody tr[data-key]', (rows) =>
    rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  );

async function selectRow(page, needle) {
  const ok = await page.evaluate((n) => {
    const row = [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')].find((r) =>
      r.textContent.includes(n),
    );
    row?.click();
    return Boolean(row);
  }, needle);
  if (!ok) throw new Error(`không thấy dòng "${needle}"`);
}

/** Mở Online › Thiết bị trong mạng… bằng menu; chờ lượt quét xong. */
async function openDevices(page) {
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  await page.waitForSelector('.menu-pop [role="menuitem"]');
  await page.evaluate(() =>
    [...document.querySelectorAll('.menu-pop [role="menuitem"]')]
      .find((e) => e.textContent.includes('Thiết bị trong mạng'))
      ?.click(),
  );
  await waitDialog(page, 'mat-devices-dialog');
}

async function waitScanDone(page) {
  return waitText(page, 'mat-devices-dialog .scan', /Tìm xong/, 6000);
}

/** Gõ tài khoản, mật khẩu, bấm Đăng nhập; trả giá trị ô mật khẩu ngay sau khi bấm. */
async function login(page, user, password) {
  await page.$eval('mat-login-dialog input[name="user"]', (i) => {
    i.value = '';
  });
  await page.type('mat-login-dialog input[name="user"]', user);
  await page.type('mat-login-dialog input[name="password"]', password);
  return page.evaluate(() => {
    [...document.querySelectorAll('mat-login-dialog .dlg-f button')]
      .find((b) => b.textContent.includes('Đăng nhập'))
      ?.click();
    return document.querySelector('mat-login-dialog input[name="password"]')?.value ?? null;
  });
}

const calls = (page, cmd) =>
  page.evaluate((c) => window.__matMock.device.calls.filter((x) => x.cmd === c).length, cmd);

export default async function online(ctx) {
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
    for (const u of ['kysu1', 'xem1', 'admin']) window.__matMock.device.setPassword(u, `${p}-${u}`);
  }, pw);
  await setTheme(page, 'light');
  await page.click('mat-start-page .start-hero [data-cmd="project.open"]');
  await page.waitForSelector('mat-tree [role="treeitem"]');

  // 1. Thiết bị trong mạng: hai thiết bị trong ≤ 3 s (US1-1, quickstart §5 bước 1). Mở bằng Ctrl+K: project
  //    chưa gắn thiết bị (T085a, FR-031); menu Online › Thiết bị trong mạng… dùng ở bước 6, 7, 10.
  const t0 = Date.now();
  await ctrl(page, 'KeyK');
  await waitDialog(page, 'mat-devices-dialog');
  check(
    'Ctrl+K khi project chưa gắn thiết bị: mở Thiết bị trong mạng, chưa dò chứng chỉ thiết bị nào',
    (await calls(page, 'device_probe')) === 0 && (await page.$('.win.online')) === null,
  );
  await page.waitForFunction(
    () => document.querySelectorAll('mat-devices-dialog tbody tr[data-key]').length >= 2,
    { timeout: 4000, polling: 50 },
  );
  const firstTwo = Date.now() - t0;
  console.log(`    · đo: hai thiết bị hiện sau ${firstTwo} ms`);
  const done = await waitScanDone(page);
  const rows = await rowTexts(page);
  check(
    'Thiết bị trong mạng: hai thiết bị trong ≤ 3 s, kèm địa chỉ, runtime, project, trạng thái',
    firstTwo <= 3000 &&
      rows.length === 2 &&
      /BL335-01/.test(rows[0]) &&
      /192\.168\.1\.110/.test(rows[0]) &&
      /0\.4\.0/.test(rows[0]) &&
      /Trạm bơm nước \(demo Sprint 1\) 0\.1\.0/.test(rows[0]) &&
      /Đang chạy/.test(rows[0]) &&
      /BL335-02/.test(rows[1]) &&
      /Chưa có project/.test(rows[1]),
    `${firstTwo} ms: ${rows.join(' | ')}`,
  );
  check(
    'lượt quét xong và báo số thiết bị trả lời',
    done >= 0 && /2 thiết bị trả lời/.test(await text(page, 'mat-devices-dialog .scan')),
    await text(page, 'mat-devices-dialog .scan'),
  );
  const vpn = await page.$$eval('mat-devices-dialog select#dev-nic option', (opts) =>
    opts.map((o) => ({ text: o.textContent.trim(), disabled: o.disabled })),
  );
  check(
    'card VPN hiện mờ kèm gợi ý Thêm theo địa chỉ',
    vpn.some((o) => /WireGuard/.test(o.text) && o.disabled && /Thêm theo địa chỉ/.test(o.text)),
    JSON.stringify(vpn),
  );
  await selectRow(page, 'BL335-02');
  const detail = await text(page, 'mat-devices-dialog .devdetail');
  check(
    'chọn dòng: model, MAC, cổng HTTPS, fingerprint',
    /BL335/.test(detail) &&
      /02:4E:1C:5A:33:02/.test(detail) &&
      /192\.168\.1\.111:8443/.test(detail) &&
      /5C E0 2B 71/.test(detail),
    detail,
  );
  await selectRow(page, 'BL335-01');
  await shot('1-thiet-bi-trong-mang');
  await axeBoth(page, axe, 'Thiết bị trong mạng');

  // 2. Thêm theo địa chỉ (quickstart §5 bước 2)
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Thêm theo địa chỉ');
  await page.waitForSelector('mat-devices-dialog input[name="addr"]');
  await page.type('mat-devices-dialog input[name="addr"]', '10.8.0.21:8443');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')].some(
        (r) => r.textContent.includes('10.8.0.21') && r.textContent.includes('Đang chạy'),
      ),
    { timeout: 4000 },
  );
  const saved = await page.evaluate(() =>
    window.__matMock.device.saved().map((d) => `${d.host}:${d.httpsPort}`),
  );
  check(
    'Thêm theo địa chỉ: thiết bị vào danh sách đã lưu, kiểm được runtime và trạng thái',
    saved.includes('10.8.0.21:8443'),
    saved.join(', '),
  );
  const added = await page.evaluate(() => {
    const d = window.__matMock.device.saved().find((x) => x.host === '10.8.0.21');
    return {
      name: d?.name,
      bound: (localStorage.getItem('mat-studio.projectDevices') ?? '').includes(d?.id ?? '-'),
      writes: window.__matMock.writes.length,
    };
  });
  check(
    'Thêm theo địa chỉ: tên tạm là địa chỉ; thiết bị vừa thêm gắn với project (thiết lập cục bộ, không ghi file project)',
    added.name === '10.8.0.21' && added.bound && added.writes === 0,
    JSON.stringify(added),
  );

  // 3. Online lần đầu → xác nhận chứng chỉ; chưa xác nhận thì không đi tiếp (US1-3, FR-008)
  await selectRow(page, 'BL335-01');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await waitDialog(page, 'mat-pin-dialog');
  const expectedFp = await page.evaluate(
    () => window.__matMock.device.device('BL335-01').fingerprint,
  );
  const fpText = await page.$eval('mat-pin-dialog .fp', (e) => e.textContent);
  const pinBody = await text(page, 'mat-pin-dialog .dlg-b');
  check(
    'xác nhận chứng chỉ: fingerprint SHA-256 đủ 64 ký tự, nhóm theo cặp, hướng dẫn so với thiết bị',
    HEX64.test(fpHex(fpText)) &&
      fpHex(fpText) === expectedFp &&
      /^([0-9A-F]{2} ){7}[0-9A-F]{2}\n/.test(fpText) &&
      /mat-runtime --cert-fingerprint/.test(pinBody),
    fpText,
  );
  await sleep(1500);
  check(
    'không xác nhận thì không đi tiếp (không ghim, không hỏi đăng nhập)',
    (await dialogKind(page)) === 'mat-pin-dialog' && (await calls(page, 'device_pin')) === 0,
    String(await dialogKind(page)),
  );
  await shot('2-xac-nhan-chung-chi');
  await axeBoth(page, axe, 'Xác nhận chứng chỉ');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await waitDialog(page, 'mat-login-dialog');

  // 4. Đăng nhập kysu1 → viền cam, "kysu1 · engineer" (US1-5, quickstart §5 bước 4)
  await page.type('mat-login-dialog input[name="user"]', 'kysu1');
  await page.type('mat-login-dialog input[name="password"]', `${pw}-kysu1`);
  await shot('3-dang-nhap');
  await axeBoth(page, axe, 'Đăng nhập');
  const left = await page.evaluate(() => {
    [...document.querySelectorAll('mat-login-dialog .dlg-f button')]
      .find((b) => b.textContent.includes('Đăng nhập'))
      ?.click();
    return document.querySelector('mat-login-dialog input[name="password"]')?.value ?? null;
  });
  check('ô mật khẩu xóa ngay khi gửi', left === '', String(left));
  let dt = await waitText(page, 'mat-statusbar', /kysu1 · engineer/, 5000);
  const sb = await text(page, 'mat-statusbar');
  check(
    'đăng nhập kysu1: viền cam, thanh trạng thái có thiết bị và "kysu1 · engineer"',
    dt >= 0 &&
      (await page.$('.win.online')) !== null &&
      /BL335-01/.test(sb) &&
      /192\.168\.1\.110:8443/.test(sb),
    sb,
  );
  check(
    'chip Online trên hàng menu',
    (await text(page, '.online-chip')) === 'Online: BL335-01',
    await text(page, '.online-chip'),
  );
  const leak = await page.evaluate(
    (p) => ({
      dom: document.documentElement.outerHTML.includes(p),
      storage: Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes(p)),
      saved: JSON.stringify(window.__matMock.device.saved()).includes(p),
    }),
    pw,
  );
  check(
    'mật khẩu không nằm trong DOM, localStorage, danh sách thiết bị đã lưu',
    !leak.dom && !leak.storage && !leak.saved,
    JSON.stringify(leak),
  );
  await shot('4-online');
  await axe('Online, thanh trạng thái có tài khoản, theme sáng');

  // 5. Phiên hết hạn → đăng nhập lại; Tag đang sửa vẫn còn, chưa lưu (US1-8, FR-031, quickstart §5 bước 6)
  await clickTreeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector(cell(0, 'description'));
  await page.click(cell(0, 'description'), { count: 2 });
  await page.waitForSelector('mat-tag-grid textarea.mg-input.mg-editing');
  await ctrl(page, 'KeyA');
  await page.keyboard.type('Mức bồn (sửa khi online)');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.textContent.includes('sửa khi online'),
    {},
    cell(0, 'description'),
  );
  await page.evaluate(() => window.__matMock.device.expireSession('BL335-01'));
  const tExp = Date.now();
  await waitDialog(page, 'mat-login-dialog', 8000);
  console.log(`    · đo: hỏi đăng nhập lại sau ${Date.now() - tExp} ms`);
  const relogin = {
    title: await text(page, 'mat-login-dialog .dlg-h'),
    body: await text(page, 'mat-login-dialog .dlg-b'),
    user: await page.$eval('mat-login-dialog input[name="user"]', (i) => i.value),
  };
  const kept = await page.evaluate(
    (sel) => ({
      cell: document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim(),
      writes: window.__matMock.writes.length,
      dirty: document.title.startsWith('● '),
      online: Boolean(document.querySelector('.win.online')),
    }),
    cell(0, 'description'),
  );
  check(
    'phiên hết hạn: hộp thoại đăng nhập lại, tài khoản điền sẵn',
    /Đăng nhập lại · BL335-01/.test(relogin.title) &&
      /Phiên đăng nhập đã hết hạn/.test(relogin.body) &&
      relogin.user === 'kysu1',
    JSON.stringify(relogin),
  );
  check(
    'phiên hết hạn: Tag đang sửa vẫn còn, chưa lưu; vẫn làm việc với thiết bị',
    /sửa khi online/.test(kept.cell ?? '') && kept.writes === 0 && kept.dirty && kept.online,
    JSON.stringify(kept),
  );
  await shot('5-dang-nhap-lai');
  await axeBoth(page, axe, 'Đăng nhập lại');
  await page.type('mat-login-dialog input[name="password"]', `${pw}-kysu1`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await page.waitForFunction(() => !document.querySelector('mat-login-dialog [role="dialog"]'), {
    timeout: 5000,
  });
  dt = await waitText(page, 'mat-statusbar', /kysu1 · engineer/, 5000);
  check(
    'đăng nhập lại: về Online, thay đổi chưa lưu vẫn giữ',
    dt >= 0 &&
      (await page.evaluate(() => window.__matMock.writes.length)) === 0 &&
      (await page.title()).startsWith('● '),
    await page.title(),
  );

  // 5b. Ctrl+K khi project đã gắn thiết bị (BL335-01, chọn ở bước 3): luồng Online; Rust còn phiên nên không
  //     hỏi đăng nhập; dữ liệu sống qua wss theo id (T085a, FR-031)
  await ctrl(page, 'KeyM');
  await page.waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 });
  const probesBefore = await calls(page, 'device_probe');
  const loginsBefore5 = await calls(page, 'device_login');
  await ctrl(page, 'KeyK');
  dt = await waitText(page, 'mat-statusbar', /kysu1 · engineer/, 5000);
  const relive = await page.evaluate(() => ({
    target: window.__matMock.device.calls.filter((c) => c.cmd === 'live_open').at(-1)?.args.target,
    bound: window.__matMock.device.saved().find((d) => d.name === 'BL335-01')?.id,
  }));
  check(
    'Ctrl+K khi project đã gắn thiết bị: dò chứng chỉ, khớp ghim, còn phiên Rust nên không hỏi đăng nhập; dữ liệu sống qua wss theo id',
    dt >= 0 &&
      (await calls(page, 'device_probe')) === probesBefore + 1 &&
      (await calls(page, 'device_login')) === loginsBefore5 &&
      relive.target?.id === relive.bound &&
      (await dialogKind(page)) === null &&
      (await page.$('.win.online')) !== null,
    JSON.stringify(relive),
  );

  // 6. Chứng chỉ đổi → chặn, hiện fingerprint cũ và mới (US1-4, quickstart §5 bước 5)
  await ctrl(page, 'KeyM');
  await page.waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 });
  const newFp = await page.evaluate(() => window.__matMock.device.rotateCert('BL335-01'));
  const loginsBefore = await calls(page, 'device_login');
  await openDevices(page);
  await waitScanDone(page);
  await selectRow(page, 'BL335-01');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await waitDialog(page, 'mat-pin-dialog');
  await waitText(page, 'mat-pin-dialog .dlg-h', /Chứng chỉ đã đổi/, 3000);
  const fps = await page.$$eval('mat-pin-dialog .fp', (els) => els.map((e) => e.textContent));
  const mismatch = await text(page, 'mat-pin-dialog .dlg-b');
  check(
    'chứng chỉ đổi: chặn, hiện fingerprint đã ghim và fingerprint mới, nói rõ nguy cơ',
    fps.length === 2 &&
      fpHex(fps[0]) === expectedFp &&
      fpHex(fps[1]) === newFp &&
      /Studio đã chặn kết nối/.test(mismatch) &&
      /giả làm thiết bị/.test(mismatch) &&
      // Bị chặn trước bước đăng nhập: mật khẩu không được gửi tới máy có chứng chỉ lạ.
      (await calls(page, 'device_login')) === loginsBefore,
    `${fps.map(fpHex).join(' / ')} · ${mismatch.slice(0, 120)}`,
  );
  const unpinLocked = await page.evaluate(
    () =>
      [...document.querySelectorAll('mat-pin-dialog .dlg-f button')].find((b) =>
        b.textContent.includes('Gỡ ghim'),
      )?.disabled,
  );
  check('gỡ ghim chỉ khi xác nhận rõ (nút khóa tới khi đánh dấu)', unpinLocked === true);
  await shot('6-chung-chi-doi');
  await axeBoth(page, axe, 'Chứng chỉ đã đổi');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Đóng');
  dt = await waitText(page, 'mat-statusbar', /chứng chỉ của thiết bị khác chứng chỉ đã ghim/, 3000);
  check('thanh trạng thái nói lý do chặn', dt >= 0, await text(page, 'mat-statusbar'));

  // 7. Sai 5 lần → "tài khoản tạm khóa" (US1-6, FR-013)
  await openDevices(page);
  await waitScanDone(page);
  await selectRow(page, 'BL335-02');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await waitDialog(page, 'mat-pin-dialog');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await waitDialog(page, 'mat-login-dialog');
  const messages = [];
  for (let i = 0; i < 5; i++) {
    await login(page, i % 2 ? 'khongco' : 'xem1', `sai-mat-khau-${i}-dai-hon-15`);
    await waitText(page, 'mat-login-dialog [role="alert"]', /không đúng/, 3000);
    messages.push(await text(page, 'mat-login-dialog [role="alert"]'));
  }
  check(
    'sai tên hay sai mật khẩu: cùng một câu, không nói sai ở đâu',
    new Set(messages).size === 1 && messages[0] === 'Tên tài khoản hoặc mật khẩu không đúng.',
    messages.join(' | '),
  );
  await login(page, 'xem1', `${pw}-xem1`);
  dt = await waitText(page, 'mat-login-dialog [role="alert"]', /tài khoản tạm khóa/i, 3000);
  check(
    'sai 5 lần: lần 6 (đúng mật khẩu) vẫn bị từ chối, "tài khoản tạm khóa" kèm thời gian còn lại',
    dt >= 0 && /\d+ phút \d+ giây/.test(await text(page, 'mat-login-dialog [role="alert"]')),
    await text(page, 'mat-login-dialog [role="alert"]'),
  );
  await shot('7-tam-khoa');
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Quay lại');
  await waitDialog(page, 'mat-devices-dialog');

  // 8. Thiết bị runtime cũ → theo dõi chỉ đọc (FR-035, quickstart §5 bước 16)
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Thêm theo địa chỉ');
  await page.waitForSelector('mat-devices-dialog input[name="addr"]');
  await page.type('mat-devices-dialog input[name="addr"]', '192.168.1.117');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('mat-devices-dialog tbody tr[data-key]')].some(
        (r) => r.textContent.includes('192.168.1.117') && r.textContent.includes('0.3.0'),
      ),
    { timeout: 4000 },
  );
  await selectRow(page, '192.168.1.117');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  dt = await waitText(
    page,
    'mat-statusbar',
    /Đang theo dõi.*runtime cần cập nhật để nạp xuống/,
    6000,
  );
  const oldSb = await text(page, 'mat-statusbar');
  check(
    'thiết bị runtime cũ: theo dõi chỉ đọc kèm "runtime cần cập nhật để nạp xuống"',
    dt >= 0 &&
      /runtime 0\.3\.0/.test(oldSb) &&
      (await page.$('.win.online')) !== null &&
      (await dialogKind(page)) === null &&
      /chỉ theo dõi chỉ đọc/.test(await text(page, 'mat-toast')),
    oldSb,
  );
  await shot('8-runtime-cu');
  await ctrl(page, 'KeyM');
  await page.waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 });

  // 9. Ctrl+K khi project đã gắn thiết bị runtime cũ (BL335-07, thêm và chọn ở bước 8): HTTPS không trả lời, HTTP
  //    là runtime 0.3.0 → theo dõi chỉ đọc kèm runtime-old, không mở hộp thoại (T085a, FR-031, FR-035)
  await ctrl(page, 'KeyK');
  dt = await waitText(
    page,
    'mat-statusbar',
    /Đang theo dõi.*192\.168\.1\.117.*runtime cần cập nhật để nạp xuống/,
    6000,
  );
  check(
    'Ctrl+K khi project đã gắn thiết bị runtime cũ: theo dõi chỉ đọc kèm "runtime cần cập nhật để nạp xuống", không mở hộp thoại',
    dt >= 0 && (await dialogKind(page)) === null,
    await text(page, 'mat-statusbar'),
  );
  await ctrl(page, 'KeyM');
  await page.waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 });

  // 10. Thiết bị thêm theo địa chỉ ở bước 2 (TRAM-XA, tên tạm là địa chỉ): đăng nhập xong mang tên thiết bị báo
  //     (device/identity), cả trên thanh trạng thái lẫn danh sách đã lưu (T085a)
  await openDevices(page);
  await waitScanDone(page);
  await selectRow(page, '10.8.0.21');
  await clickButton(page, 'mat-devices-dialog .dlg-f', 'Online');
  await waitDialog(page, 'mat-pin-dialog');
  await clickButton(page, 'mat-pin-dialog .dlg-f', 'Ghim và tiếp tục');
  await waitDialog(page, 'mat-login-dialog');
  const loginTitle = await text(page, 'mat-login-dialog .dlg-h');
  await login(page, 'kysu1', `${pw}-kysu1`);
  dt = await waitText(page, 'mat-statusbar', /TRAM-XA.*kysu1 · engineer/, 5000);
  const renamed = await page.evaluate(
    () => window.__matMock.device.saved().find((d) => d.host === '10.8.0.21')?.name,
  );
  check(
    'thiết bị thêm theo địa chỉ: tên tạm là địa chỉ tới khi đăng nhập; đăng nhập xong mang tên thiết bị báo (TRAM-XA)',
    /10\.8\.0\.21/.test(loginTitle) && dt >= 0 && renamed === 'TRAM-XA',
    `${loginTitle} → ${renamed}: ${await text(page, 'mat-statusbar')}`,
  );
  await ctrl(page, 'KeyM');
  await page.waitForFunction(() => !document.querySelector('.win.online'), { timeout: 3000 });
}
