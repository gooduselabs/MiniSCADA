/* global document, window */
// e2e bố cục lưới trên trang vận hành (feature 012, T022; US2, FR-025 đến FR-028, SC-002): hàng và cột đúng tỷ lệ 12 cột ở
// 1920 và 1366 px, widget điền đầy ô, có giá trị sống; dưới 768 px các ô xếp chồng, không cuộn ngang; giao diện atscada (theme cũ bỏ qua) đặt
// trên :root. Ảnh chụp: tests/e2e/out/grid-*.png.
import { deepEval, sleep, until, waitDeep } from './util.mjs';
import { gridDemo } from './grid-fixture.mjs';

export const options = { fixture: gridDemo, drift: false };

/** Hộp (x, y, rộng, cao) của các ô theo id, đo trong trang (Shadow DOM của mat-screen). */
const cellBoxes = (page) =>
  deepEval(
    page,
    'mat-screen',
    `const s = els[0]; const out = {};
     for (const c of s.shadowRoot.querySelectorAll('.cell')) {
       const r = c.getBoundingClientRect(); out[c.dataset.cellId] = [r.x, r.y, r.width, r.height];
     }
     return out;`,
  );

async function open(ctx, width) {
  const { page } = ctx;
  await page.setViewport({ width, height: 900 });
  await page.goto('about:blank');
  await page.goto(ctx.url + '/#/luoi', { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-card', 3);
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
  await sleep(600);
}

export default async function run(ctx) {
  const { page } = ctx;
  for (const width of [1920, 1366]) {
    await open(ctx, width);
    const b = await cellBoxes(page);
    const near = (a, x) => Math.abs(a - x) <= 2;
    const w4 = [b.c1, b.c2, b.c3, b.c4].map((x) => x[2]);
    ctx.check(
      `${width}: hàng 1 bốn ô bằng nhau`,
      w4.every((x) => near(x, w4[0])),
      w4.join(','),
    );
    ctx.check(
      `${width}: bốn ô cùng một dòng`,
      [b.c2, b.c3, b.c4].every((x) => near(x[1], b.c1[1])),
    );
    ctx.check(
      `${width}: ô 8 cột rộng gấp đôi ô 4 cột (cộng khoảng cách)`,
      near(b.c5[2], 2 * b.c6[2] + 12),
      `${b.c5[2]} vs ${b.c6[2]}`,
    );
    ctx.check(`${width}: hàng 2 cao 300 px`, near(b.c5[3], 300), b.c5[3]);
    ctx.check(`${width}: ô 12 cột chiếm cả hàng`, near(b.c7[2], b.c5[2] + b.c6[2] + 12), b.c7[2]);
    await ctx.shot(`${width}`);
  }
  const text = await deepEval(
    page,
    '.item[data-item-id="muc"] mat-w-card',
    'return els[0]?.shadowRoot.textContent ?? "";',
  );
  ctx.check('thẻ Mức bồn có giá trị sống', /62[,.]5/.test(text), text);
  const theme = await page.evaluate(() => document.documentElement.dataset.matTheme);
  // feature 029: một giao diện, theme cũ của project bị bỏ qua (không đặt data-mat-theme)
  ctx.check('không còn data-mat-theme trên :root', theme === undefined, theme);

  await open(ctx, 600);
  const n = await cellBoxes(page);
  const xs = Object.values(n).map((x) => x[0]);
  ctx.check(
    '600 px: mọi ô cùng lề trái (xếp chồng)',
    xs.every((x) => Math.abs(x - xs[0]) <= 2),
    xs.join(','),
  );
  ctx.check('600 px: ô 2 nằm dưới ô 1', n.c2[1] > n.c1[1] + n.c1[3] - 1);
  ctx.check(
    '600 px: ô của hàng cao cố định không bị bẹp (đồng hồ ≥ 280 px)',
    n.c6[3] >= 280,
    n.c6[3],
  );
  const hscroll = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  ctx.check('600 px: không cuộn ngang', !hscroll);
  await ctx.shot('600');
}
