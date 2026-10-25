// e2e tab "API key" của trang Quản trị (feature 025, specs/025-data-api US1): bảng rỗng và hướng dẫn gọi API, kiểm
// form trước khi gửi (tên trống, địa chỉ sai), tạo key chỉ đọc (token hiện một lần, đóng hộp thì không còn trên
// trang), tạo key ghi được (hỏi lại mật khẩu: sai thì giữ hộp, đúng thì tạo), sửa nguồn cho phép, thu hồi có xác
// nhận; axe sáng và tối ở bảng, form, hộp token.
import { PASS, accessDemo, accessSeed, loginPage } from './access-fixture.mjs';
import { axeBoth, sleep, until } from './util.mjs';

export const options = {
  fixture: accessDemo,
  access: accessSeed({ auditSeed: 5 }),
  config: { viewerLogin: 'required' },
  drift: false,
};

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const press = (page, sel) =>
  until(() => page.$eval(sel, (e) => (e.click(), true)).catch(() => false), `bấm ${sel}`);
const setValue = (page, sel, v) =>
  page.$eval(
    sel,
    (e, val) => {
      e.value = val;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    v,
  );
const dlg = 'dialog.ad-dialog[open]';

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 400', 'status of 401', 'status of 403', 'status of 409');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${httpsUrl}/#/quan-tri/api-key`, { waitUntil: 'domcontentloaded' });
  await loginPage(page, 'quantri', PASS.quantri);
  await page.waitForSelector('#ad-tab-api-key[aria-selected="true"]');
  await page.waitForSelector('[data-apikeys] .ad-empty');
  const help = await text(page, '.ad-apikey-help');
  ctx.check(
    'hướng dẫn: lệnh curl với địa chỉ thiết bị và tài liệu',
    help.includes('Authorization: Bearer matk_') &&
      help.includes('/api/v1/data/values') &&
      help.includes('data-api'),
    help,
  );
  await axeBoth(ctx, 'tab API key (rỗng)');

  // Form: tên trống, rồi địa chỉ sai: trang chặn, không gửi.
  await press(page, '[data-add-apikey]');
  await page.waitForSelector(`${dlg} [data-apikey-name]`);
  await axeBoth(ctx, 'hộp tạo API key');
  await press(page, `${dlg} [data-apikey-save]`);
  await sleep(100);
  ctx.check('tên trống: báo lỗi', (await text(page, `${dlg} .ad-error`)).includes('Tên key'));
  await setValue(page, `${dlg} [data-apikey-name]`, 'ERP kho');
  await setValue(page, `${dlg} [data-apikey-allow]`, '192.0.2.0/24, 192.0.2.999');
  await press(page, `${dlg} [data-apikey-save]`);
  await sleep(100);
  ctx.check(
    'địa chỉ sai: báo lỗi đúng địa chỉ',
    (await text(page, `${dlg} .ad-error`)).includes('192.0.2.999'),
  );
  ctx.check(
    'chưa có POST apikeys',
    !rt.access.log.posts.some((p) => p.path.startsWith('/api/v1/admin/apikeys')),
  );

  // Key chỉ đọc: tạo ngay, token hiện một lần.
  await setValue(page, `${dlg} [data-apikey-allow]`, '192.0.2.0/24');
  await setValue(page, `${dlg} [data-apikey-rate]`, '120');
  await press(page, `${dlg} [data-apikey-save]`);
  await until(() => rt.access.apikeys.keys.length === 1, 'tạo key chỉ đọc');
  const k1 = rt.access.apikeys.keys[0];
  ctx.check(
    'key 1: viewer, chỉ đọc, nguồn, giới hạn',
    k1.role === 'viewer' &&
      k1.readOnly === true &&
      k1.allowFrom.join() === '192.0.2.0/24' &&
      k1.ratePerMin === 120,
    JSON.stringify(k1),
  );
  await page.waitForSelector(`${dlg} [data-apikey-token]`);
  const shown = await page.$eval(`${dlg} [data-apikey-token]`, (e) => e.value);
  ctx.check('token hiện đúng một lần', shown === rt.access.apikeys.tokens[0], shown);
  ctx.check(
    'không gửi reauth cho key chỉ đọc',
    rt.access.log.posts.at(-1).body.reauth === undefined,
  );
  await axeBoth(ctx, 'hộp token');
  await press(page, `${dlg} [data-apikey-done]`);
  await page.waitForSelector(`[data-apikey="${k1.id}"]`);
  const html = await page.content();
  ctx.check('đóng hộp: token không còn trên trang', !html.includes(shown));
  const row = await text(page, `[data-apikey="${k1.id}"]`);
  ctx.check(
    'dòng key: tên, tiền tố, chỉ đọc, nguồn',
    row.includes('ERP kho') &&
      row.includes(shown.slice(0, 12)) &&
      row.includes('chỉ đọc') &&
      row.includes('192.0.2.0/24'),
    row,
  );

  // Key ghi được: hỏi lại mật khẩu.
  await press(page, '[data-add-apikey]');
  await page.waitForSelector(`${dlg} [data-apikey-name]`);
  await setValue(page, `${dlg} [data-apikey-name]`, 'MES dây chuyền 2');
  await setValue(page, `${dlg} [data-apikey-role]`, 'operator');
  await page.$eval(`${dlg} [data-apikey-readonly]`, (e) => (e.checked = false));
  await press(page, `${dlg} [data-apikey-group="ca-a"]`);
  await press(page, `${dlg} [data-apikey-save]`);
  await page.waitForSelector(`${dlg} input[type="password"]`);
  await setValue(page, `${dlg} input[type="password"]`, 'sai-mat-khau-hoan-toan');
  await press(page, `${dlg} [data-confirm]`);
  await until(
    async () => (await text(page, `${dlg} .ad-error`).catch(() => '')).includes('không đúng'),
    'mật khẩu sai: giữ hộp',
  );
  ctx.check('mật khẩu sai: chưa tạo', rt.access.apikeys.keys.length === 1);
  await setValue(page, `${dlg} input[type="password"]`, PASS.quantri);
  await press(page, `${dlg} [data-confirm]`);
  await until(() => rt.access.apikeys.keys.length === 2, 'tạo key ghi được');
  const k2 = rt.access.apikeys.keys[1];
  ctx.check(
    'key 2: operator, ghi được, nhóm ca-a',
    k2.canWrite === true && k2.groups.join() === 'ca-a',
    JSON.stringify(k2),
  );
  await page.waitForSelector(`${dlg} [data-apikey-token]`);
  await press(page, `${dlg} [data-apikey-done]`);
  await page.waitForSelector(`[data-apikey="${k2.id}"]`);
  ctx.check(
    'dòng key 2: đọc + ghi',
    (await text(page, `[data-apikey="${k2.id}"]`)).includes('đọc + ghi'),
  );

  // Sửa nguồn của key 1 (không cần mật khẩu).
  await press(page, `[data-edit-apikey="${k1.id}"]`);
  await page.waitForSelector(`${dlg} [data-apikey-allow]`);
  await setValue(page, `${dlg} [data-apikey-allow]`, '198.51.100.7');
  await press(page, `${dlg} [data-apikey-save]`);
  await until(
    () => rt.access.apikeys.keys[0].allowFrom.join() === '198.51.100.7',
    'sửa nguồn key 1',
  );
  ctx.check('sửa nguồn: đã lưu', true);

  // Thu hồi key 2 có xác nhận.
  await press(page, `[data-revoke-apikey="${k2.id}"]`);
  await page.waitForSelector(`${dlg} [data-confirm]`);
  await axeBoth(ctx, 'hộp thu hồi');
  await press(page, `${dlg} [data-confirm]`);
  await until(() => rt.access.apikeys.keys.length === 1, 'thu hồi key 2');
  await until(async () => !(await page.$(`[data-apikey="${k2.id}"]`)), 'dòng key 2 biến mất');
  ctx.check('thu hồi: dòng biến mất', true);
  ctx.check(
    'không có token trong yêu cầu gửi đi',
    !JSON.stringify(rt.access.log.posts).includes('matk_'),
  );
  await axeBoth(ctx, 'tab API key sau khi thao tác');
  await ctx.shot('cuoi').catch(() => undefined);
}
