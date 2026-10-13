/* global document, window, location, getComputedStyle */
// e2e trang vận hành nhiều màn hình (feature 007, T040, US1 kịch bản 3, 4, 5, 6, 9, 11, 12, 14, 15; SC-015 axe sáng và tối).
// Runtime giả phục vụ project 0.3 mẫu (fixture-project.mjs). Chạy: `npm run e2e -w @mat/runtime-web`.
import {
  axeBoth,
  bodyText,
  deepClick,
  deepCount,
  deepEval,
  deepText,
  setTheme,
  sleep,
  until,
  waitDeep,
} from './util.mjs';

export const options = { project: 'dashboard' };

const menuItems = (page) =>
  page.$$eval('#app-nav button', (bs) => bs.map((b) => b.textContent.trim()));
const hash = (page) => page.evaluate(() => location.hash);
const current = (page) =>
  page.$eval('#app-nav button[aria-current="page"]', (b) => b.textContent.trim()).catch(() => null);
const lastSubscribe = (rt) => rt.log.subscribes.at(-1) ?? [];

/** Mở trang từ trạng thái trắng (goto cùng tài liệu chỉ đổi hash, không tải lại). */
async function openApp(ctx, path = '/', wait = 'mat-w-card') {
  await ctx.page.goto('about:blank');
  await ctx.page.goto(ctx.url + path, { waitUntil: 'domcontentloaded' });
  await waitDeep(ctx.page, wait, 1);
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  ctx.allowConsole.push('status of 500'); // màn hình hỏng cố ý (kịch bản 14)

  // ---- Kịch bản 3: màn hình đầu ≤ 2 s, menu đúng thứ tự, mục đang mở được tô ----
  const t0 = Date.now();
  await openApp(ctx);
  const firstMs = Date.now() - t0;
  ctx.check(`màn hình đầu hiện trong ≤ 2 s (đo ${firstMs} ms)`, firstMs <= 2000);
  console.log(`  · màn hình đầu: ${firstMs} ms`);
  ctx.check(
    'menu đúng thứ tự navigation',
    JSON.stringify(await menuItems(page)) ===
      JSON.stringify(['Tổng quan', 'Bơm 1', 'Bồn nước', 'Màn hình hỏng']),
    JSON.stringify(await menuItems(page)),
  );
  ctx.check(
    'nhóm "Giám sát" có tiêu đề',
    (await page.$eval('#app-nav .grp', (e) => e.textContent.trim())) === 'Giám sát',
  );
  ctx.check('mục Tổng quan đang được tô (aria-current)', (await current(page)) === 'Tổng quan');
  ctx.check(
    'thanh trên: tên project',
    (await page.$eval('#app-title', (e) => e.textContent)) === 'Trạm bơm e2e',
  );
  ctx.check(
    'thanh trên: tên màn hình',
    (await page.$eval('#app-screen-name', (e) => e.textContent)) === 'Tổng quan',
  );
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'trạng thái Trực tuyến',
  );
  ctx.check('thanh trên: trạng thái kết nối Trực tuyến', true);
  ctx.check('URL tự đặt #/tong-quan', (await hash(page)) === '#/tong-quan', await hash(page));
  ctx.check('HTTP: dải "Chế độ chỉ xem"', (await bodyText(page)).includes('Chế độ chỉ xem'));
  ctx.check(
    'HTTP: có nút Đăng nhập? không (HTTP không đăng nhập được)',
    (await page.$eval('#app-login-btn', (b) => b.hidden)) === true,
  );

  // ---- Giá trị sống và quality (kịch bản 8, 9 phần hiển thị) ----
  await until(async () => /\d/.test((await deepText(page, 'mat-w-card')) ?? ''), 'card có số');
  const cardTexts = await deepEval(
    page,
    'mat-w-card',
    'return els.map(e => e.shadowRoot.textContent.replace(/\\s+/g, " ").trim());',
  );
  ctx.check(
    'card Mức bồn hiện giá trị và đơn vị %',
    cardTexts.some((t) => t.includes('Mức bồn') && /\d/.test(t) && t.includes('%')),
    cardTexts.join(' | '),
  );
  ctx.check(
    'Tag BAD: card hiện nhãn BAD',
    cardTexts.some((t) => t.includes('Nhiệt độ') && t.includes('BAD')),
    cardTexts.join(' | '),
  );
  ctx.check(
    'Tag lạ với thiết bị: card hiện "?"',
    cardTexts.some((t) => t.includes('Tag lạ') && t.includes('?')),
    cardTexts.join(' | '),
  );
  ctx.check(
    'nhãn XSS hiện dạng chữ, không dựng thẻ, không thực thi',
    (await deepEval(page, 'img', 'return els.length')) === 0 &&
      (await page.evaluate(() => window.__xss)) === undefined &&
      (await deepText(page, 'mat-w-label')).includes('<img'),
  );

  // ---- Kịch bản 12: đăng ký Tag theo màn hình ----
  const sub1 = lastSubscribe(rt);
  ctx.check(
    'màn hình Tổng quan chỉ đăng ký Tag của nó',
    sub1.includes('TANK01.LEVEL') &&
      sub1.includes('MOTOR01.RUN') &&
      !sub1.includes('PUMP1.RUN_CMD') &&
      !sub1.includes('MOTOR01.SPEED'),
    sub1.join(','),
  );
  const sockets0 = rt.log.wsOpened;

  // ---- Kịch bản 4: đổi màn hình, URL, Back, F5 ----
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Bồn nước')).click(),
  );
  await until(async () => (await hash(page)) === '#/bon-nuoc', 'URL #/bon-nuoc');
  await waitDeep(page, '[data-mat-uid]', 1);
  ctx.check('Bồn nước: item svg dựng đồ họa', (await deepCount(page, '[data-mat-uid]')) > 0);
  ctx.check('Bồn nước: mục đang mở được tô', (await current(page)) === 'Bồn nước');
  await until(
    async () =>
      lastSubscribe(rt).includes('TANK01.LEVEL') && !lastSubscribe(rt).includes('PUMP1.RUN_CMD'),
    'đăng ký đổi theo màn hình',
  );
  ctx.check(
    'đăng ký đổi trên CÙNG kết nối (không mở socket mới)',
    rt.log.wsOpened === sockets0,
    `${rt.log.wsOpened} so với ${sockets0}`,
  );
  await page.goBack();
  await until(async () => (await hash(page)) === '#/tong-quan', 'Back về #/tong-quan');
  await waitDeep(page, 'mat-w-card', 1);
  ctx.check('Back quay lại Tổng quan, menu theo', (await current(page)) === 'Tổng quan');
  await page.goForward();
  await until(async () => (await hash(page)) === '#/bon-nuoc', 'Forward');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitDeep(page, '[data-mat-uid]', 1);
  ctx.check(
    'F5 ở Bồn nước giữ nguyên màn hình và URL',
    (await hash(page)) === '#/bon-nuoc' && (await current(page)) === 'Bồn nước',
  );

  // ---- Kịch bản 14: màn hình lỗi riêng lẻ ----
  rt.cfg.brokenFiles.add('screens/hong.screen.json');
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Màn hình hỏng')).click(),
  );
  await until(
    async () => !(await page.$eval('.screen-failed', (e) => e.hidden)),
    'lỗi màn hình hiện',
  );
  ctx.check(
    'màn hình hỏng: hiện lỗi cụ thể (tên và HTTP 500)',
    (await page.$eval('.screen-failed', (e) => e.textContent)).includes('500'),
  );
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Tổng quan')).click(),
  );
  await waitDeep(page, 'mat-w-card', 1);
  ctx.check(
    'menu và màn hình khác vẫn dùng được sau lỗi',
    (await page.$eval('.screen-failed', (e) => e.hidden)) && (await current(page)) === 'Tổng quan',
  );

  // ---- Kịch bản 5: id lạ ----
  await openApp(ctx, '/#/khong-co');
  ctx.check(
    'id lạ: URL sửa về màn hình đầu',
    (await hash(page)) === '#/tong-quan',
    await hash(page),
  );
  ctx.check(
    'id lạ: thông báo "Không có màn hình khong-co"',
    await page.$eval('#app-notice', (e) => !e.hidden && e.textContent.includes('khong-co')),
  );

  // ---- Kịch bản 11: popup ----
  await openApp(ctx, '/#/tong-quan');
  const baseSub = lastSubscribe(rt).slice();
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Mở cửa sổ bơm")).shadowRoot.querySelector("button").click();',
  );
  await waitDeep(page, '[role="dialog"]', 1);
  ctx.check('popup mở, hash không đổi', (await hash(page)) === '#/tong-quan');
  await until(
    async () => lastSubscribe(rt).includes('MOTOR01.SPEED'),
    'Tag của popup được đăng ký thêm',
  );
  ctx.check(
    'Tag của popup được đăng ký thêm (có cả Tag màn hình nền)',
    lastSubscribe(rt).includes('MOTOR01.SPEED') && lastSubscribe(rt).includes('TANK01.LEVEL'),
  );
  const focusInside = await deepEval(
    page,
    '[role="dialog"]',
    'let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return els[0].contains(a) || els[0].getRootNode().host.shadowRoot.contains(a) && els[0].contains(a);',
  );
  ctx.check('focus nằm trong popup', focusInside);
  await page.keyboard.press('Escape');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'Esc đóng popup');
  ctx.check('Esc đóng popup', true);
  await until(async () => !lastSubscribe(rt).includes('MOTOR01.SPEED'), 'đăng ký trở về như cũ');
  ctx.check(
    'đóng popup: đăng ký Tag trở về như cũ',
    JSON.stringify([...lastSubscribe(rt)].sort()) === JSON.stringify([...baseSub].sort()),
  );
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Mở cửa sổ bơm")).shadowRoot.querySelector("button").click();',
  );
  await waitDeep(page, '[role="dialog"]', 1);
  await deepClick(page, '.popup-close');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'nút Đóng');
  ctx.check('nút Đóng đóng popup', true);
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Mở cửa sổ bơm")).shadowRoot.querySelector("button").click();',
  );
  await waitDeep(page, '[role="dialog"]', 1);
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Đóng") && e.closest("[role=dialog]") !== null || e.shadowRoot.textContent.trim() === "Đóng").shadowRoot.querySelector("button").click();',
  );
  await until(
    async () => (await deepCount(page, '[role="dialog"]')) === 0,
    'nút Đóng của widget trong popup (closePopup)',
  );
  ctx.check('nút "Đóng" là widget button (hành động closePopup) đóng popup', true);
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Mở cửa sổ bơm")).shadowRoot.querySelector("button").click();',
  );
  await waitDeep(page, '[role="dialog"]', 1);
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Bồn nước')).click(),
  );
  await until(
    async () => (await deepCount(page, '[role="dialog"]')) === 0,
    'chuyển màn hình đóng popup',
  );
  ctx.check('chuyển màn hình đóng popup', true);

  // ---- Kịch bản 6: co theo cửa sổ ----
  await openApp(ctx, '/#/tong-quan');
  const frameInfo = () =>
    page.evaluate(() => {
      const host = document.querySelector('mat-screen');
      const f = host.shadowRoot.querySelector('.frame').getBoundingClientRect();
      const s = document.querySelector('#app-screen').getBoundingClientRect();
      return { fw: f.width, fh: f.height, sw: s.width, sh: s.height, fx: f.x - s.x, fy: f.y - s.y };
    });
  for (const [w, h] of [
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const ts = Date.now();
    await page.setViewport({ width: w, height: h });
    await sleep(120);
    const r = await frameInfo();
    const ratio = r.fw / r.fh;
    ctx.check(
      `${w}×${h}: khung vừa vùng màn hình, giữ tỉ lệ 16:9 (contain)`,
      r.fw <= r.sw + 1 &&
        r.fh <= r.sh + 1 &&
        Math.abs(ratio - 1280 / 720) < 0.01 &&
        (Math.abs(r.fw - r.sw) < 2 || Math.abs(r.fh - r.sh) < 2),
      JSON.stringify(r),
    );
    console.log(
      `  · ${w}×${h}: khung ${Math.round(r.fw)}×${Math.round(r.fh)} (đợi ${Date.now() - ts} ms gồm 120 ms chờ)`,
    );
  }
  await page.setViewport({ width: 1366, height: 768 });

  // ---- Menu thu gọn < 900 px ----
  await page.setViewport({ width: 800, height: 700 });
  await sleep(150);
  ctx.check(
    '< 900 px: nút menu hiện, menu ẩn',
    (await page.$eval('#app-menu-btn', (b) => b.offsetParent !== null)) &&
      (await page.$eval(
        '#app-nav',
        (n) => n.getBoundingClientRect().right <= 1 || getComputedStyle(n).visibility === 'hidden',
      )),
  );
  await page.click('#app-menu-btn');
  await sleep(250);
  ctx.check(
    '< 900 px: bấm nút menu mở ngăn kéo (aria-expanded)',
    (await page.$eval('#app-menu-btn', (b) => b.getAttribute('aria-expanded'))) === 'true' &&
      (await page.$eval('#app-nav', (n) => getComputedStyle(n).visibility)) === 'visible',
  );
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Bơm 1')).click(),
  );
  await until(async () => (await hash(page)) === '#/bom1', 'chọn mục trong ngăn kéo');
  ctx.check(
    '< 900 px: chọn mục đóng ngăn kéo',
    (await page.$eval('#app-menu-btn', (b) => b.getAttribute('aria-expanded'))) === 'false',
  );
  await page.setViewport({ width: 1366, height: 768 });

  // ---- Trợ năng: axe sáng và tối (SC-015) ----
  await openApp(ctx, '/#/tong-quan');
  await sleep(400);
  await axeBoth(ctx, 'Tổng quan');
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Bơm 1')).click(),
  );
  await waitDeep(page, 'mat-w-setpoint', 1);
  await sleep(400);
  await axeBoth(ctx, 'Bơm 1');
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Bồn nước')).click(),
  );
  await waitDeep(page, '[data-mat-uid]', 1);
  await sleep(300);
  await axeBoth(ctx, 'Bồn nước');

  // ---- Kịch bản 15: kiosk ----
  await openApp(ctx, '/?kiosk=1#/bon-nuoc', '[data-mat-uid]');
  const barHidden = await page.$eval('#app-bar', (b) => getComputedStyle(b).display === 'none');
  const navHidden = await page.$eval(
    '#app-nav',
    (n) => n.hidden || getComputedStyle(n).display === 'none',
  );
  ctx.check(
    'kiosk: ẩn thanh trên và menu, #/bon-nuoc vẫn chọn màn hình',
    barHidden && navHidden && (await hash(page)) === '#/bon-nuoc',
  );
  ctx.check(
    'kiosk: còn chấm trạng thái kết nối',
    await until(
      async () =>
        page
          .$eval('#app-kiosk-dot', (d) => !d.hidden && /ok|warn|bad/.test(d.className))
          .catch(() => false),
      'chấm kiosk',
    ),
  );
  await setTheme(page, 'light');
}
