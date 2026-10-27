/* global document */
// e2e tab "Thiết bị" của trang Quản trị (feature 027, FR-008): nguồn của giá trị, lưu không giảm bảo vệ (không hỏi mật
// khẩu), tắt bắt buộc đăng nhập phải nhập lại mật khẩu (sai thì giữ hộp), cảnh báo chứng chỉ không có IP, sinh lại có
// IP (vân tay đổi), tạo CSR, nhập chứng chỉ sai khóa bị từ chối có thông báo, axe sáng và tối.
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
    },
    v,
  );

async function confirmWith(page, pw) {
  await page.waitForSelector('dialog[open] input[type="password"]');
  await setValue(page, 'dialog[open] input[type="password"]', pw);
  await press(page, 'dialog[open] [data-confirm]');
}

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 400', 'status of 401', 'status of 403');
  const dev = rt.access.device;
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${httpsUrl}/#/quan-tri/thiet-bi`, { waitUntil: 'domcontentloaded' });
  await loginPage(page, 'quantri', PASS.quantri);
  await page.waitForSelector('#ad-tab-thiet-bi[aria-selected="true"]');
  await page.waitForSelector('[data-dev-save]');
  const general = await text(page, '.ad-device');
  ctx.check('nguồn của giá trị: theo runtime.json', general.includes('theo runtime.json'), general);
  ctx.check('cảnh báo chứng chỉ không có IP', general.includes('không có địa chỉ IP'), general);
  await axeBoth(ctx, 'tab Thiết bị');

  // Đổi tên, giới hạn: không giảm bảo vệ → không hỏi mật khẩu.
  await setValue(page, '[data-dev-name]', 'Trạm bơm 1');
  await setValue(page, '[data-dev-maxlive]', '4');
  await press(page, '[data-dev-save]');
  await until(() => dev.rev === 1, 'lưu thiết lập');
  ctx.check(
    'chỉ gửi khóa khác runtime.json',
    JSON.stringify(dev.settings) ===
      JSON.stringify({ maxLiveClientsPerSource: 4, deviceName: 'Trạm bơm 1' }),
    JSON.stringify(dev.settings),
  );
  await sleep(5300); // trang tải lại sau khi runtime khởi động lại

  // Tắt bắt buộc đăng nhập: hộp mật khẩu; sai thì giữ hộp.
  await press(page, '[data-dev-login]');
  await press(page, '[data-dev-save]');
  await confirmWith(page, 'sai-mat-khau');
  await page.waitForSelector('dialog[open] [role="alert"]');
  ctx.check('mật khẩu sai: chưa lưu', dev.rev === 1);
  await confirmWith(page, PASS.quantri);
  await until(() => dev.rev === 2, 'lưu sau khi xác nhận');
  ctx.check('viewerLogin off đã lưu', dev.settings.viewerLogin === 'off');
  await sleep(5300);

  // Chứng chỉ: sinh lại có IP thêm, vân tay đổi.
  await setValue(page, '[data-dev-san]', '10.0.0.5');
  await press(page, '[data-dev-regen]');
  await confirmWith(page, PASS.quantri);
  await until(() => dev.fingerprint === 'cd'.repeat(32), 'sinh lại chứng chỉ');
  await sleep(5300);
  const fp = await text(page, '.ad-dev-cert');
  ctx.check('vân tay mới hiện trên trang', fp.includes('CD:CD:CD'), fp);
  ctx.check('SAN có IP thêm', fp.includes('10.0.0.5'), fp);

  // CSR rồi nhập chứng chỉ không khớp khóa: thông báo lỗi của thiết bị.
  await press(page, '[data-dev-csr-make]');
  await page.waitForFunction(() =>
    document.querySelector('[data-dev-csr]')?.textContent?.includes('CERTIFICATE REQUEST'),
  );
  ctx.check('CSR hiện trên trang', dev.csr === 1);
  await setValue(
    page,
    '[data-dev-pem]',
    '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
  );
  await press(page, '[data-dev-import]');
  await confirmWith(page, PASS.quantri);
  await until(() => dev.imports === 1, 'nhập chứng chỉ');
  await page
    .waitForFunction(() => /khớp/.test(document.querySelector('.ad-toast')?.textContent ?? ''), {
      timeout: 3000,
    })
    .catch(() => {});
  const toast = await text(page, '.ad-toast').catch(() => '');
  ctx.check('nhập sai khóa: báo lỗi', /khớp|CERT_KEY_MISMATCH/.test(toast), toast);
  await axeBoth(ctx, 'tab Thiết bị sau thao tác');
}
