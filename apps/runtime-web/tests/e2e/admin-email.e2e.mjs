/* global location */
// e2e tab "Thông báo email" của trang Quản trị (feature 023, US1, US7, US8): trạng thái (hàng đợi, lỗi cuối), mật khẩu
// chỉ hiện "đã đặt", kiểm trước khi lưu (thiếu máy chủ, quy tắc không người nhận, địa chỉ sai), lưu cấu hình với quy
// tắc tới địa chỉ và nhóm, gửi thử (thành công, thất bại), email của người dùng (không đăng xuất), axe sáng và tối.
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

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 400', 'status of 401', 'status of 409');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${httpsUrl}/#/quan-tri/thong-bao-email`, { waitUntil: 'domcontentloaded' });
  await loginPage(page, 'quantri', PASS.quantri);
  await page.waitForSelector('#ad-tab-thong-bao-email[aria-selected="true"]');
  await page.waitForSelector('[data-email-save]');
  const status = await text(page, '.ad-email-status');
  ctx.check(
    'trạng thái: hàng đợi và lỗi cuối',
    status.includes('1') && status.includes('CONNECT'),
    status,
  );
  const pw = await text(page, '.ad-email-pw');
  ctx.check('mật khẩu chỉ hiện "đã đặt"', pw.includes('đã đặt'), pw);
  await axeBoth(ctx, 'tab Thông báo email');

  // Bật mà chưa có máy chủ: trang chặn trước khi gửi.
  await press(page, '[data-email-enabled]');
  await press(page, '[data-email-save]');
  await sleep(150);
  const msg1 = await text(page, '.ad-email > p[role="status"]');
  ctx.check('thiếu máy chủ: báo lỗi, không gửi', msg1.includes('máy chủ SMTP'), msg1);
  ctx.check(
    'chưa có POST email',
    !rt.access.log.posts.some((p) => p.path === '/api/v1/admin/email'),
  );

  await setValue(page, '[data-smtp-host]', 'smtp.example.com');
  await setValue(page, '[data-smtp-from]', 'scada@example.com');
  await press(page, '[data-add-rule]');
  await page.waitForSelector('[data-rule="r1"]');
  await press(page, '[data-email-save]');
  await sleep(150);
  const msg2 = await text(page, '.ad-email > p[role="status"]');
  ctx.check('quy tắc không người nhận: báo lỗi', msg2.includes('Quy tắc 1'), msg2);
  await setValue(page, '[data-rule="r1"] [data-rule-to]', 'sai-dia-chi');
  await press(page, '[data-email-save]');
  await sleep(150);
  ctx.check(
    'địa chỉ sai: báo lỗi',
    (await text(page, '.ad-email > p[role="status"]')).includes('sai-dia-chi'),
  );
  await setValue(page, '[data-rule="r1"] [data-rule-to]', 'truc@example.com, ky.su@example.com');
  await press(page, '[data-rule="r1"] [data-group="ca-a"]');
  await press(page, '[data-rule="r1"] [data-event="reminder"]');
  await press(page, '[data-email-save]');
  await until(() => rt.access.email.rev === 1, 'lưu cấu hình email');
  const c = rt.access.email.config;
  ctx.check('đã lưu: bật, máy chủ, địa chỉ gửi', c.enabled && c.smtp.host === 'smtp.example.com');
  const r1 = c.rules[0];
  ctx.check(
    'quy tắc: địa chỉ, nhóm, sự kiện, mức',
    r1 &&
      r1.to.join() === 'truc@example.com,ky.su@example.com' &&
      r1.groups.join() === 'ca-a' &&
      r1.events.join() === 'active,reminder' &&
      r1.priorities.join() === '1,2',
    JSON.stringify(r1),
  );
  ctx.check(
    'không có trường mật khẩu trong yêu cầu',
    !JSON.stringify(rt.access.log.posts).includes('"password"'),
  );

  // Gửi thử: thành công rồi thất bại.
  await page.waitForSelector('[data-test-to]');
  await setValue(page, '[data-test-to]', 't@example.com');
  await press(page, '[data-email-test]');
  await until(() => rt.access.email.tests.includes('t@example.com'), 'gửi thử');
  await until(
    async () => (await text(page, '.ad-email > p[role="status"]')).includes('Đã gửi email thử'),
    'báo gửi thử thành công',
  );
  ctx.check('gửi thử thành công', true);
  await setValue(page, '[data-test-to]', 'x@other.test');
  await press(page, '[data-email-test]');
  await until(
    async () => (await text(page, '.ad-email > p[role="status"]')).includes('thất bại'),
    'báo gửi thử thất bại',
  );
  ctx.check('gửi thử thất bại có lý do', true);
  await axeBoth(ctx, 'tab Thông báo email sau khi lưu');

  // Email của người dùng ở tab Người dùng: lưu, không đăng xuất.
  await page.evaluate(() => (location.hash = '#/quan-tri/nguoi-dung'));
  await page.waitForSelector('[data-user="vh1"]');
  await press(page, '[data-edit="vh1"]');
  await page.waitForSelector('dialog.ad-dialog[open] input[type="email"]');
  await setValue(page, 'dialog.ad-dialog[open] input[type="email"]', 'vh1@example.com');
  await axeBoth(ctx, 'hộp sửa người dùng có ô email');
  await press(page, 'dialog.ad-dialog[open] .ad-btn.primary');
  await until(() => rt.access.users.get('vh1')?.email === 'vh1@example.com', 'lưu email vh1');
  const post = [...rt.access.log.posts].reverse().find((p) => p.path === '/api/v1/admin/users/vh1');
  ctx.check(
    'chỉ gửi email (không đổi vai trò/nhóm)',
    post &&
      Object.keys(post.body)
        .filter((k) => post.body[k] !== undefined)
        .sort()
        .join() === 'email,rev',
    JSON.stringify(post?.body),
  );
  await ctx.shot('cuoi').catch(() => undefined);
}
