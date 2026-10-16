// e2e faceplate trên trang vận hành (feature 011, T170; US7, FR-123, FR-125; contracts/project-format-1.0.md §5): một
// popup có tham số `bom-chi-tiet` mở từ 20 nút bơm (args PUMP01…PUMP20). Popup hiện giá trị Tag đã thay đúng bơm; đổi bơm
// thay popup hiện tại và đổi đăng ký Tag (bỏ Tag bơm cũ); đóng popup hủy đăng ký; Tag đã thay không có trong project ⇒
// widget hiện "Tag không có", không đăng ký; args sai ⇒ không mở, có thông báo. Chạy qua HTTP (nút popup không cần phiên).
import { deepCount, deepEval, deepText, until, waitDeep } from './util.mjs';
import { PUMP_COUNT, faceplateDemo, flowOf, pumpId } from './faceplate-fixture.mjs';

export const options = { fixture: faceplateDemo, drift: false };

const lastSubscribe = (rt) => rt.log.subscribes.at(-1) ?? [];
const pumpTags = (rt) => lastSubscribe(rt).filter((t) => /^PUMP\d\d\./.test(t));
const dialogText = (page) => deepText(page, '[role="dialog"]');

/** Nhấp nút widget theo nhãn (nút thật trong Shadow DOM). */
const clickButton = (page, label) =>
  deepEval(
    page,
    'mat-w-button',
    `const e = els.find((x) => x.shadowRoot.querySelector('button')?.textContent.trim() === arg);
     if (!e) return false; e.shadowRoot.querySelector('button').click(); return true;`,
    label,
  );

/** Mở faceplate của bơm n, chờ popup hiện đúng lưu lượng và đăng ký đúng Tag của bơm đó. */
async function openPump(ctx, n) {
  const { page, rt } = ctx;
  const id = pumpId(n);
  const want = flowOf(n).toFixed(1);
  if (!(await clickButton(page, `Bơm ${n}`))) throw new Error(`không thấy nút Bơm ${n}`);
  await waitDeep(page, '[role="dialog"]', 1);
  await until(async () => (await dialogText(page))?.includes(want), `popup hiện ${want} (${id})`);
  await until(async () => {
    const p = pumpTags(rt).sort();
    return p.length === 2 && p[0] === `${id}.FLOW` && p[1] === `${id}.RUN`;
  }, `đăng ký đúng Tag ${id}`);
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  for (let n = 1; n <= PUMP_COUNT; n++) {
    rt.setValue(`${pumpId(n)}.FLOW`, flowOf(n));
    rt.setValue(`${pumpId(n)}.RUN`, n % 2 === 0);
  }
  await page.goto(`${ctx.url}/#/tram-bom`, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-button', PUMP_COUNT + 2);
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
  ctx.check('màn hình trạm có 20 nút bơm + 2 nút thử', true);
  ctx.check('chưa mở popup: không đăng ký Tag bơm nào', pumpTags(rt).length === 0);

  // ---- Mở faceplate của nhiều bơm: đúng giá trị, đúng nhãn đã thay ----
  for (const n of [1, 7, 13, 20]) {
    await openPump(ctx, n);
    const text = await dialogText(page);
    ctx.check(
      `bơm ${n}: popup hiện lưu lượng ${flowOf(n).toFixed(1)} và tiêu đề "Bơm ${n} lưu lượng"`,
      text.includes(flowOf(n).toFixed(1)) && text.includes(`Bơm ${n} lưu lượng`),
      text,
    );
    ctx.check(
      `bơm ${n}: đúng một popup (popup mới thay popup cũ)`,
      (await deepCount(page, '[role="dialog"]')) === 1,
    );
    ctx.check(
      `bơm ${n}: chỉ Tag của ${pumpId(n)} được đăng ký, Tag màn hình nền còn`,
      pumpTags(rt).every((t) => t.startsWith(`${pumpId(n)}.`)) &&
        lastSubscribe(rt).includes('TANK01.LEVEL'),
      lastSubscribe(rt).join(','),
    );
  }
  await ctx.shot('bom20');
  await ctx.axe('faceplate bơm 20');

  // ---- Giá trị sống đi vào popup đang mở ----
  rt.setValue('PUMP20.FLOW', 99.5);
  await until(async () => (await dialogText(page))?.includes('99.5'), 'delta PUMP20.FLOW');
  ctx.check('delta của Tag đã thay cập nhật popup', true);

  // ---- Đóng: hủy đăng ký Tag của popup ----
  await deepEval(page, '.popup-close', 'els[0].click(); return true;');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'đóng popup');
  await until(async () => pumpTags(rt).length === 0, 'hủy Tag bơm');
  ctx.check(
    'đóng popup: không còn Tag bơm nào được đăng ký',
    lastSubscribe(rt).includes('TANK01.LEVEL'),
  );

  // ---- Tag đã thay không có trong project: hiện lỗi, không đăng ký ----
  const subsBefore = rt.log.subscribes.length;
  await clickButton(page, 'Bơm 99');
  await waitDeep(page, '[role="dialog"]', 1);
  await until(async () => (await deepCount(page, '.tag-missing')) === 2, 'lỗi Tag không có');
  const t99 = await dialogText(page);
  ctx.check(
    'PUMP99: widget hiện "Tag không có: PUMP99.FLOW"',
    t99.includes('Tag không có: PUMP99.FLOW') && t99.includes('PUMP99.RUN'),
    t99,
  );
  ctx.check(
    'PUMP99: không gửi đăng ký nào có Tag PUMP99',
    rt.log.subscribes.slice(subsBefore).every((s) => !s.some((t) => t.startsWith('PUMP99'))),
  );
  // Mở bơm có thật từ trạng thái lỗi: lỗi biến mất.
  await deepEval(page, '.popup-close', 'els[0].click(); return true;');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'đóng popup PUMP99');
  await openPump(ctx, 5);
  ctx.check(
    'mở lại bơm 5 sau PUMP99: không còn lỗi Tag',
    (await deepCount(page, '.tag-missing')) === 0,
  );
  await deepEval(page, '.popup-close', 'els[0].click(); return true;');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'đóng popup bơm 5');

  // ---- args sai dạng: không mở, có thông báo ----
  await clickButton(page, 'Bơm lỗi');
  await until(
    async () => page.$eval('#app-notice', (e) => !e.hidden && e.textContent.includes('tham số')),
    'thông báo args sai',
  );
  ctx.check('args sai: có thông báo "tham số của cửa sổ sai"', true);
  ctx.check('args sai: popup không mở', (await deepCount(page, '[role="dialog"]')) === 0);
}
