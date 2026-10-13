/* global document */
// e2e tương thích (feature 007, US1 kịch bản 1): project 0.1 (projects/tank-demo, một màn hình SVG, thân đầy đủ như runtime 0.5)
// chạy qua bộ chuyển sang mô hình v1: không menu thừa, đồ họa dựng, giá trị binding cập nhật theo dữ liệu sống.
import { axeBoth, deepCount, sleep, until, waitDeep } from './util.mjs';

export const options = { project: 'tank', drift: false };

export default async function run(ctx) {
  const { page, rt } = ctx;
  await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, '[data-mat-uid]', 1);
  ctx.check(
    'project một màn hình: không hiện menu',
    (await page.$eval('#app-nav', (n) => n.hidden)) &&
      (await page.$eval('#app-menu-btn', (b) => b.hidden)),
  );
  ctx.check(
    'đồ họa SVG dựng (phần tử có data-mat-uid)',
    (await deepCount(page, '[data-mat-uid]')) >= 8,
  );
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
  ctx.check(
    'thanh trên: tên project',
    (await page.$eval('#app-title', (e) => e.textContent)).includes('Trạm bơm nước'),
  );
  const sub = rt.log.subscribes.at(-1) ?? [];
  ctx.check(
    'đăng ký đúng Tag của binding',
    ['TANK01.LEVEL', 'MOTOR01.RUN', 'MOTOR01.SPEED'].every((t) => sub.includes(t)),
    sub.join(','),
  );
  // Giá trị binding: chữ mức nước theo Tag
  rt.setValue('TANK01.LEVEL', 33.3);
  await sleep(700);
  const txt = await page.evaluate(() => {
    const host = document.querySelector('mat-screen');
    const svgHost = host.shadowRoot.querySelector('.svg-host');
    const el = svgHost.shadowRoot
      ? svgHost.shadowRoot.querySelector('[data-mat-uid="el_txt_level"]')
      : null;
    return el ? el.textContent : null;
  });
  ctx.check(
    'binding text.content hiện giá trị mới của Tag',
    typeof txt === 'string' && txt.includes('33'),
    String(txt),
  );
  await axeBoth(ctx, 'tank-demo 0.1');
}
