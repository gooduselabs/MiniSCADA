// E2E Người dùng và quyền trong Studio (feature 027) với DeviceLink giả (platform/mock-device.ts + mock-admin.ts, điều
// khiển qua window.__matMock.device):
// - chưa Online, rồi Online bằng engineer: editor nói rõ cần tài khoản quản trị, có nút Online/Đăng xuất;
// - Online bằng administrator: tạo người dùng (mật khẩu sinh hiện một lần), tạo nhóm, gán nhóm ở Inspector, quyền theo
//   trang (bản nháp → Lưu lên thiết bị), quyền theo component chọn trên xem trước của project đang mở (báo digest khác),
//   hạ vai trò cần xác nhận lại mật khẩu (sai → báo trong hộp thoại), 409 khi dữ liệu trên thiết bị vừa đổi, email gửi
//   thử, tạo/thu hồi API key (token hiện một lần), xem với tư cách;
// - axe-core 0 vi phạm critical/serious ở mọi trang (theme sáng và tối, trừ nội dung widget của xem trước).
// Ảnh: tests/e2e/out/ và, nếu đặt MAT_ADMIN_SHOTS, thư mục đó (ảnh chụp cho tài liệu).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DASHBOARD_DEMO,
  axeScopedBoth,
  clickButton,
  expandNode,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

const ED = 'mat-admin-editor';
const DLG = 'mat-admin-dialog';
const shotsDir = process.env.MAT_ADMIN_SHOTS ?? null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

/** Tài nguyên của project dashboard-demo như máy chủ dựng (màn hình và item), cho API quản trị giả. */
function resources() {
  const dir = join(DASHBOARD_DEMO, 'screens');
  const out = [];
  const operable = /button|switch|toggle|slider|input|setpoint|pump|valve|motor/i;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.screen.json'))) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const id = f.replace('.screen.json', '');
    if (!Array.isArray(s.items)) continue;
    out.push({
      id: `screen:${id}`,
      kind: s.kind === 'popup' ? 'popup' : 'screen',
      title: s.name ?? id,
      levels: ['view'],
      defaults: { view: 'viewer' },
    });
    for (const it of s.items) {
      const op = operable.test(`${it.widget ?? ''} ${it.type ?? ''}`);
      out.push({
        id: `item:${id}/${it.id}`,
        kind: 'item',
        title: it.title ?? it.label ?? it.id,
        screen: id,
        widget: it.widget ?? it.type,
        levels: op ? ['view', 'operate'] : ['view'],
        defaults: op ? { view: 'viewer', operate: 'operator' } : { view: 'viewer' },
      });
    }
  }
  return out;
}

async function shot(ctx, name) {
  await ctx.shot(name);
  if (shotsDir) await ctx.page.screenshot({ path: join(shotsDir, `${name}.png`) });
}

async function ctrl(page, key) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/** Ctrl+K: lần đầu qua Thiết bị trong mạng và ghim; sau đó thẳng tới đăng nhập. */
async function signIn(page, pw, user) {
  await ctrl(page, 'KeyK');
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

/** Chạy `fn(điều khiển API quản trị giả của BL335-01, arg)` trong trang. */
async function admin(page, fn, arg) {
  const h = await page.evaluateHandle(() => window.__matMock.device.admin('BL335-01'));
  try {
    return await h.evaluate(fn, arg);
  } finally {
    await h.dispose();
  }
}

async function open(page, key) {
  await expandNode(page, 'users');
  await page.waitForSelector(`mat-tree [id="ti-admin:${key}"]`);
  await treeNode(page, `admin:${key}`);
  await page.waitForSelector(`${ED} .adm[data-page="${key}"]`);
  await sleep(150);
}

async function row(page, table, key) {
  const sel = `${ED} [data-table="${table}"] tr[data-key="${key}"]`;
  await page.waitForSelector(sel);
  await page.click(sel);
  await sleep(100);
}

async function dialogOk(page) {
  await page.click(`${DLG} [data-role="ok"]`);
}

const text = (page, sel) =>
  page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

export default async function adminScenario(ctx) {
  const { page } = ctx;
  await page.waitForSelector('mat-start-page .start-hero');
  try {
    await scenario(ctx);
  } finally {
    await setTheme(page, 'light').catch(() => undefined);
  }
}

async function scenario(ctx) {
  const { page, check } = ctx;
  const pw = `thu-${randomBytes(12).toString('hex')}`;
  await page.evaluate((p) => {
    const c = window.__matMock.device;
    for (const u of ['kysu1', 'xem1', 'admin']) c.setPassword(u, `${p}-${u}`);
    c.setRuntime('BL335-01', '0.5.0');
  }, pw);
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO));

  // 1. Chưa Online: trạng thái rõ và nút Online.
  await open(page, 'users');
  const gate0 = await text(page, `${ED} [data-role="gate"]`);
  check(
    'chưa Online: "Kết nối thiết bị với tài khoản quản trị để quản lý người dùng" + nút Online',
    gate0.includes('Kết nối thiết bị với tài khoản quản trị để quản lý người dùng') &&
      (await page.$(`${ED} [data-gate="offline"] [data-role="gate-login"]`)) !== null,
    gate0,
  );
  await shot(ctx, 'studio-admin-0-chua-online');
  await axeScopedBoth(ctx, 'Người dùng, chưa Online');

  // 2. Online bằng engineer: không phải administrator.
  await signIn(page, pw, 'kysu1');
  await page.waitForSelector(`${ED} [data-gate="notAdmin"]`);
  const gate1 = await text(page, `${ED} [data-role="gate"]`);
  check(
    'engineer: báo chỉ administrator quản lý được, nút đổi tài khoản',
    /kysu1/.test(gate1) && /administrator/.test(gate1),
    gate1,
  );
  const calls1 = await admin(page, (c) => c.requests.length);
  check('engineer: không gọi API quản trị', calls1 === 0, calls1);
  await page.click(`${ED} [data-role="gate-login"]`);
  await waitFor(
    page,
    () => !/kysu1 · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );

  // 3. Online bằng administrator.
  await admin(page, (c, r) => c.setResources(r), resources());
  await signIn(page, pw, 'admin');
  await page.waitForSelector(`${ED} [data-table="users"] tr[data-key="admin"]`);
  check('administrator: danh sách người dùng của thiết bị', true);
  // Ảnh gọn: thu task card (Toolbox không dùng ở các editor quản trị), như người dùng làm bằng Xem › Task card.
  await page.evaluate(() => window.__matApp.run('view.taskCards'));
  await sleep(150);

  // 3a. Tạo nhóm Ca A.
  await open(page, 'groups');
  await page.click(`${ED} [data-role="add-group"]`);
  await page.waitForSelector(`${DLG} [data-dialog="createGroup"]`);
  await page.type(`${DLG} [data-role="group-name"]`, 'Ca A');
  const gid = await page.$eval(`${DLG} [data-role="group-id"]`, (i) => i.value);
  check('mã nhóm gợi ý từ tên: ca-a', gid === 'ca-a', gid);
  await dialogOk(page);
  await page.waitForSelector(`${ED} [data-table="groups"] tr[data-key="ca-a"]`);

  // 3b. Tạo người dùng vh3, mật khẩu sinh hiện một lần.
  await open(page, 'users');
  await page.click(`${ED} [data-role="add-user"]`);
  await page.waitForSelector(`${DLG} [data-dialog="createUser"]`);
  await page.type(`${DLG} [data-role="name"]`, 'vh3');
  await page.select(`${DLG} [data-role="role"]`, 'operator');
  await page.type(`${DLG} [data-role="email"]`, 'vh3@example.com');
  await shot(ctx, 'studio-admin-1-them-nguoi-dung');
  await axeScopedBoth(ctx, 'hộp thoại Thêm người dùng');
  await dialogOk(page);
  await page.waitForSelector(`${DLG} [data-dialog="secret"]`);
  const secret = await page.$eval(`${DLG} [data-role="secret"]`, (i) => i.value);
  check('mật khẩu sinh hiện một lần', secret.length >= 8, secret.length);
  await dialogOk(page);
  await page.waitForSelector(`${ED} [data-table="users"] tr[data-key="vh3"]`);
  const req = await admin(page, (c) =>
    c.requests.find((r) => r.method === 'POST' && r.path === '/api/v1/admin/users'),
  );
  check(
    'POST /api/v1/admin/users: rev, tên, vai trò, generate, email',
    req?.body?.rev === 1 &&
      req.body.name === 'vh3' &&
      req.body.generate === true &&
      req.body.email === 'vh3@example.com',
    JSON.stringify(req?.body),
  );

  // 3c. Gán nhóm ở Inspector (Người dùng → nhóm Ca A).
  await row(page, 'users', 'vh3');
  await page.waitForSelector('mat-admin-user-props [data-group="ca-a"]');
  await page.click('mat-admin-user-props [data-group="ca-a"]');
  await page.click('mat-admin-user-props [data-role="insp-apply"]');
  await waitFor(page, () =>
    document
      .querySelector('mat-admin-editor [data-table="users"] tr[data-key="vh3"]')
      ?.textContent.includes('Ca A'),
  );
  check('gán nhóm Ca A cho vh3 (Inspector → Áp dụng)', true);
  await shot(ctx, 'studio-admin-2-nguoi-dung');
  await axeScopedBoth(ctx, 'Người dùng, Inspector');

  // 3d. Hạ vai trò: xác nhận lại; sai mật khẩu báo trong hộp thoại.
  await page.select('mat-admin-user-props [data-role="insp-role"]', 'viewer');
  await page.click('mat-admin-user-props [data-role="insp-apply"]');
  await page.waitForSelector(`${DLG} [data-dialog="reauth"]`);
  await page.type(`${DLG} [data-role="reauth"]`, 'sai-mat-khau');
  await dialogOk(page);
  await page.waitForSelector(`${DLG} [data-role="dialog-error"]`);
  const reErr = await text(page, `${DLG} [data-role="dialog-error"]`);
  check(
    'reauth sai: "Mật khẩu xác nhận không đúng." trong hộp thoại',
    reErr.includes('Mật khẩu xác nhận không đúng'),
    reErr,
  );
  await shot(ctx, 'studio-admin-3-xac-nhan-lai');
  await page.$eval(`${DLG} [data-role="reauth"]`, (i) => (i.value = ''));
  await page.type(`${DLG} [data-role="reauth"]`, `${pw}-admin`);
  await dialogOk(page);
  await waitFor(page, () =>
    document
      .querySelector('mat-admin-editor [data-table="users"] tr[data-key="vh3"]')
      ?.textContent.includes('Người xem'),
  );
  check('reauth đúng: vh3 thành Người xem', true);

  // 4. Quyền theo trang: bản nháp → Lưu lên thiết bị.
  await open(page, 'pages');
  await row(page, 'pages', 'page:alarms');
  await page.waitForSelector(
    'mat-admin-rule-props [data-grantee="group:ca-a"][data-level="operate"]',
  );
  await page.click('mat-admin-rule-props [data-grantee="group:ca-a"][data-level="operate"]');
  await page.waitForSelector(`${ED} [data-role="pending"]`);
  check(
    'bản nháp: dải "1 thay đổi quyền chưa lưu"',
    /1 thay đổi/.test(await text(page, `${ED} [data-role="pending"]`)),
  );
  await shot(ctx, 'studio-admin-4-quyen-trang');
  await axeScopedBoth(ctx, 'Quyền theo trang');
  await page.click(`${ED} [data-role="save-rules"]`);
  await waitFor(page, () => !document.querySelector('mat-admin-editor [data-role="pending"]'));
  const rules = await admin(page, (c) => c.rules());
  check(
    'lưu quy tắc: page:alarms|operate gồm group:ca-a',
    (rules['page:alarms|operate'] ?? []).includes('group:ca-a'),
    JSON.stringify(rules),
  );

  // 5. Quyền theo component: chọn trên xem trước của project đang mở; digest khác thì báo.
  await open(page, 'components');
  await page.waitForSelector(`${ED} mat-admin-preview [data-pick]`, { timeout: 10000 });
  check('xem trước có lớp chọn component', true);
  const digest = await text(page, `${ED} [data-banner="digest"]`);
  check(
    'báo project đang mở khác project đang chạy (digest)',
    /digest|chưa lưu/.test(digest),
    digest,
  );
  const pick = await page.$eval(`${ED} mat-admin-preview [data-pick]`, (b) => b.dataset.pick);
  await page.click(`${ED} mat-admin-preview [data-pick="${pick}"]`);
  await page.waitForSelector(
    'mat-admin-rule-props [data-props="rule"], mat-admin-rule-props [data-props="rule-missing"]',
  );
  const hasRule = (await page.$('mat-admin-rule-props [data-props="rule"]')) !== null;
  check('chọn component: Inspector hiện quyền xem/thao tác của item', hasRule, pick);
  if (hasRule) {
    await page.click('mat-admin-rule-props [data-grantee="role:operator"][data-level="view"]');
    await page.waitForSelector('mat-admin-rule-props table[data-table="who"]');
    await shot(ctx, 'studio-admin-5-quyen-component');
    await axeScopedBoth(ctx, 'Quyền theo component');
    await page.click(`${ED} [data-role="save-rules"]`);
    await waitFor(page, () => !document.querySelector('mat-admin-editor [data-role="pending"]'));
    const r2 = await admin(page, (c) => c.rules());
    const key = Object.keys(r2).find((k) => k.startsWith('item:') && k.endsWith('|view'));
    check('lưu quyền xem của component', Boolean(key), JSON.stringify(r2));
  }

  // 6. 409: dữ liệu trên thiết bị vừa đổi.
  await open(page, 'groups');
  await admin(page, (c) => c.bumpRev());
  await page.click(`${ED} [data-role="add-group"]`);
  await page.waitForSelector(`${DLG} [data-dialog="createGroup"]`);
  await page.type(`${DLG} [data-role="group-name"]`, 'Bảo trì');
  await dialogOk(page);
  await page.waitForSelector(`${ED} [data-banner="conflict"]`);
  check('409: dải "Dữ liệu trên thiết bị vừa đổi", đã tải lại', true);
  await shot(ctx, 'studio-admin-6-xung-dot');
  await page.click(`${ED} [data-banner="conflict"] button`);

  // 7. Email cảnh báo: sửa, lưu, gửi thử.
  await open(page, 'email');
  await page.type(`${ED} #em-host`, 'smtp.example.com');
  await page.type(`${ED} #em-from`, 'scada@example.com');
  await page.click(`${ED} [data-role="email-enabled"]`);
  await page.click(`${ED} [data-role="email-rule-add"]`);
  await page.waitForSelector('mat-admin-email-rule-props [data-role="rule-to"]');
  await page.type('mat-admin-email-rule-props [data-role="rule-to"]', 'truongca@example.com');
  await page.$eval('mat-admin-email-rule-props [data-role="rule-to"]', (i) =>
    i.dispatchEvent(new Event('change')),
  );
  await shot(ctx, 'studio-admin-7-email');
  await axeScopedBoth(ctx, 'Email cảnh báo');
  await page.click(`${ED} [data-role="email-save"]`);
  await waitFor(
    page,
    () => document.querySelector('mat-admin-editor [data-role="email-save"]')?.disabled === true,
  );
  const saved = await admin(
    page,
    (c) =>
      c.requests.filter((r) => r.path === '/api/v1/admin/email' && r.method === 'POST').at(-1)
        ?.body,
  );
  check(
    'lưu email: SMTP và quy tắc lên thiết bị',
    saved?.config?.smtp?.host === 'smtp.example.com' &&
      saved.config.rules?.[0]?.to?.[0] === 'truongca@example.com',
    JSON.stringify(saved?.config?.smtp),
  );
  await page.click(`${ED} [data-role="email-test"]`);
  await page.waitForSelector(`${DLG} [data-role="test-to"]`);
  await page.type(`${DLG} [data-role="test-to"]`, 'kysu@example.com');
  await dialogOk(page);
  await page.waitForSelector(`${DLG} [data-role="test-result"]`);
  const res = await text(page, `${DLG} [data-role="test-result"]`);
  check('gửi thử: máy chủ SMTP đã nhận', /đã nhận thư gửi tới kysu@example.com/.test(res), res);
  await shot(ctx, 'studio-admin-8-gui-thu');
  await page.keyboard.press('Escape');

  // 8. API key: tạo (token một lần), thu hồi.
  await open(page, 'apikeys');
  await page.click(`${ED} [data-role="add-key"]`);
  await page.waitForSelector(`${DLG} [data-dialog="createKey"]`);
  await page.type(`${DLG} [data-role="key-name"]`, 'MES');
  await dialogOk(page);
  await page.waitForSelector(`${DLG} [data-dialog="secret"]`);
  const token = await page.$eval(`${DLG} [data-role="secret"]`, (i) => i.value);
  check('token API key hiện một lần (matk_…)', token.startsWith('matk_'), token.slice(0, 5));
  await dialogOk(page);
  await page.waitForSelector(`${ED} [data-table="apikeys"] tbody tr`);
  await shot(ctx, 'studio-admin-9-api-key');
  await axeScopedBoth(ctx, 'API key');
  await page.click('mat-admin-key-props [data-role="insp-key-revoke"]');
  await page.waitForSelector(`${DLG} [data-dialog="revokeKey"]`);
  await dialogOk(page);
  await waitFor(
    page,
    () => !document.querySelector('mat-admin-editor [data-table="apikeys"] tbody tr'),
  );
  check('thu hồi API key', true);

  // 9. Xem với tư cách vh3.
  await open(page, 'viewAs');
  await page.select(`${ED} [data-role="view-as-user"]`, 'vh3');
  await page.waitForSelector(`${ED} [data-banner="view-as"]`);
  const va = await text(page, `${ED} [data-banner="view-as"]`);
  check('xem với tư cách vh3: banner chỉ đọc', /vh3/.test(va) && /Chỉ đọc/.test(va), va);
  const logged = await admin(page, (c) =>
    c.audit.some((r) => r.action === 'admin.view-as' && r.target === 'vh3'),
  );
  check('máy chủ ghi admin.view-as', logged);
  await shot(ctx, 'studio-admin-10-xem-voi-tu-cach');
  await axeScopedBoth(ctx, 'Xem với tư cách');

  // 10. Bảng lệnh có lệnh quản trị.
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('mat-palette input');
  await page.type('mat-palette input', 'quan tri them nguoi');
  await sleep(150);
  const pal = await text(page, 'mat-palette');
  check(
    'bảng lệnh: "Quản trị: Thêm người dùng…"',
    pal.includes('Quản trị: Thêm người dùng'),
    pal.slice(0, 120),
  );
  await page.keyboard.press('Escape');
}
