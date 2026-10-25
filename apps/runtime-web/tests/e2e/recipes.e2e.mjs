/* global document, location */
// e2e trang Recipe (feature 024, specs/024-recipes/spec.md US2, US3) trên runtime GIẢ (recipes-fake.mjs): mục menu chỉ
// khi đã đăng nhập; bảng và ô khác PLC; tải xuống (hộp xác nhận liệt kê thay đổi, tiến trình, PLC đổi); lỗi giữa chừng
// (bỏ qua phần sau); đọc từ PLC thành bản mới; sửa (kiểm giới hạn phía trang) và xóa; CONFLICT; quyền theo vai trò;
// axe sáng/tối.
import { axeBoth, sleep, until } from './util.mjs';

export const options = { recipes: {} };

async function login(ctx, user, pass) {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập');
}

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const diffTags = (page) =>
  page.$$eval('.rc-page td.rc-diff', (tds) => tds.map((td) => td.closest('tr').dataset.tag));
const clickAct = (page, act, scope = '.rc-page') => page.click(`${scope} [data-act="${act}"]`);

export default async function run(ctx) {
  const { page, rt, check } = ctx;
  if (!ctx.httpsUrl) {
    check('có HTTPS (openssl) để chạy kịch bản recipe', false, 'không có openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 409', 'status of 400');
  await page.goto(`${ctx.httpsUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-nav');
  check(
    'chưa đăng nhập: không có mục Recipe',
    !(await page.$('#app-nav [data-screen="@recipes"]')),
  );
  await login(ctx, 'vanhanh1', 'op-pass');
  await page.waitForSelector('#app-nav [data-screen="@recipes"]');
  await page.click('#app-nav [data-screen="@recipes"]');
  await page.waitForSelector('.rc-table tbody tr');
  check('route #/recipes', (await page.evaluate(() => location.hash)).startsWith('#/recipes'));
  const rows = await page.$$eval('.rc-table tbody tr', (r) => r.length);
  check('bảng 5 tham số', rows === 5, rows);
  const cols = await page.$$eval('.rc-col', (b) => b.map((x) => x.textContent));
  check(
    '3 bản của project, huy hiệu nguồn',
    cols.length === 3 && cols[0].includes('Project'),
    cols,
  );
  await until(async () => (await diffTags(page)).length > 0, 'tô ô khác PLC');
  const d0 = await diffTags(page);
  check(
    'bản Bánh mì: các ô khác PLC được tô',
    d0.join() === 'OVEN.TEMP_SP,OVEN.TIME_SP,OVEN.FAN_SP,OVEN.STEAM,OVEN.NOTE',
    d0,
  );
  await page.click('[data-recipe="banh-quy"]');
  check('bản Bánh quy giống PLC: không ô nào tô', (await diffTags(page)).length === 0);
  check('trạng thái "Giống giá trị trên PLC"', (await text(page, '.rc-status')).includes('Giống'));
  await axeBoth(ctx, 'trang Recipe');
  await ctx.shot('bang');

  // ---- tải xuống ----
  await page.click('[data-recipe="banh-mi"]');
  await clickAct(page, 'download');
  await page.waitForSelector('dialog[open] .rc-changes');
  const changes = await page.$$eval('dialog[open] .rc-changes tbody tr', (r) =>
    r.map((tr) => [...tr.children].map((c) => c.textContent.trim())),
  );
  check(
    'hộp xác nhận liệt kê 5 thay đổi cũ → mới',
    changes.length === 5 && changes[0].join('|') === 'Nhiệt độ đặt|180.0|210.0 °C',
    JSON.stringify(changes),
  );
  await axeBoth(ctx, 'hộp xác nhận tải xuống');
  await ctx.shot('xac-nhan');
  await page.keyboard.press('Escape');
  await sleep(100);
  check(
    'Esc đóng hộp, không ghi',
    !(await page.$('dialog[open]')) && rt.recipes.state.jobs.size === 0,
  );
  await clickAct(page, 'download');
  await page.waitForSelector('dialog[open] [data-act="confirm"]');
  await page.click('dialog[open] [data-act="confirm"]');
  await page.waitForSelector('dialog[open].rc-progress[data-state="done"]', { timeout: 8000 });
  const st = await page.$$eval('dialog[open] .rc-steps li', (l) => l.map((x) => x.dataset.status));
  check('tiến trình: 5 tham số đã ghi', st.join() === 'ok,ok,ok,ok,ok', st);
  check('PLC giả nhận giá trị recipe', rt.recipes.plc.get('OVEN.TEMP_SP') === 210);
  await ctx.shot('tien-trinh');
  await page.keyboard.press('Escape');
  await until(async () => (await diffTags(page)).length === 0, 'sau tải: giống PLC');
  check('sau tải xuống: Bánh mì giống PLC', true);

  // ---- lỗi giữa chừng ----
  rt.recipes.state.failTag = 'OVEN.FAN_SP';
  await page.click('[data-recipe="say-hat"]');
  await clickAct(page, 'download');
  await page.click('dialog[open] [data-act="confirm"]');
  await page.waitForSelector('dialog[open].rc-progress[data-state="failed"]', { timeout: 8000 });
  const st2 = await page.$$eval('dialog[open] .rc-steps li', (l) => l.map((x) => x.dataset.status));
  check(
    'lỗi ở tham số 3: 2 đã ghi, 1 lỗi, 2 bỏ qua',
    st2.join() === 'ok,ok,failed,skipped,skipped',
    st2,
  );
  check('mã lỗi hiện trong hộp', (await text(page, 'dialog[open]')).includes('DEVICE_EXCEPTION'));
  await page.keyboard.press('Escape');
  rt.recipes.state.failTag = null;

  // ---- đọc từ PLC ----
  await clickAct(page, 'capture');
  await page.waitForSelector('dialog[open] input[data-field="name"]');
  await page.type('dialog[open] input[data-field="name"]', 'Mẻ chiều 25/10');
  await page.click('dialog[open] [data-act="confirm"]');
  await until(async () => (await page.$$('.rc-col')).length === 4, 'bản mới từ PLC');
  check(
    'bản mới từ PLC có huy hiệu Thiết bị, được chọn',
    (await text(page, '.rc-col[aria-pressed="true"]')).includes('Mẻ chiều 25/10Thiết bị'),
  );

  // ---- sửa: kiểm giới hạn phía trang, rồi lưu ----
  await clickAct(page, 'edit');
  await page.waitForSelector('input[data-edit="OVEN.TEMP_SP"]');
  await page.$eval('input[data-edit="OVEN.TEMP_SP"]', (i) => (i.value = ''));
  await page.type('input[data-edit="OVEN.TEMP_SP"]', '300');
  check(
    'giá trị 300 ngoài giới hạn: ô báo lỗi',
    await page.$eval('input[data-edit="OVEN.TEMP_SP"]', (i) => i.hasAttribute('aria-invalid')),
  );
  const saves0 = rt.recipes.state.log.filter((x) => x.path.endsWith('/save')).length;
  await page.click('.rc-tools .primary');
  await sleep(150);
  check(
    'không gửi khi còn lỗi',
    rt.recipes.state.log.filter((x) => x.path.endsWith('/save')).length === saves0,
  );
  await page.$eval('input[data-edit="OVEN.TEMP_SP"]', (i) => (i.value = ''));
  await page.type('input[data-edit="OVEN.TEMP_SP"]', '195');
  await page.click('.rc-tools .primary');
  await until(async () => !(await page.$('input[data-edit]')), 'lưu xong');
  const devRec = rt.recipes.state.device.get('lo-say')[0];
  check(
    'bản thiết bị đã lưu giá trị mới',
    devRec?.values['OVEN.TEMP_SP'] === 195,
    JSON.stringify(devRec),
  );

  // ---- CONFLICT ----
  rt.recipes.bump();
  await clickAct(page, 'edit');
  await page.waitForSelector('input[data-edit="OVEN.TIME_SP"]');
  await page.click('.rc-tools .primary');
  await until(async () => (await text(page, '.rc-status')).includes('người khác'), 'báo CONFLICT');
  check('CONFLICT: báo và tải lại', true);

  // ---- xóa ----
  await page.click(`[data-recipe="${devRec.id}"]`);
  await clickAct(page, 'remove');
  await page.waitForSelector('dialog[open] [data-act="confirm"]');
  await page.click('dialog[open] [data-act="confirm"]');
  await until(async () => (await page.$$('.rc-col')).length === 3, 'xóa bản');
  check('xóa bản thiết bị', rt.recipes.state.device.get('lo-say').length === 0);

  // ---- quyền: loại "Bồn trộn" cần engineer để tải ----
  await page.click('.rc-types li:nth-child(2) button');
  await until(async () => (await text(page, '.rc-head h1')) === 'Bồn trộn', 'chọn loại 2');
  check(
    'operator không có nút Tải xuống ở loại cần engineer',
    !(await page.$('[data-act="download"]')),
  );
  check('hash theo loại', (await page.evaluate(() => location.hash)) === '#/recipes/tron');
  await page.evaluate(() => document.activeElement?.blur());
}
