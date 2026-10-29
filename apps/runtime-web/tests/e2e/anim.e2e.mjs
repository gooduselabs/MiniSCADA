/* global document, getComputedStyle */
// e2e hoạt ảnh và biến đổi của binding 0.4 trên Chrome thật (feature 008, T067; ADR-024, contract binding-animation §7):
// clipLevel trên path cong và nhóm (đọc điểm ảnh), quay quanh gốc kim, dời giữ M0, co giãn, quay liên tục, nhấp nháy,
// dòng chảy, tab ẩn, prefers-reduced-motion (CDP). Runtime giả phục vụ anim-fixture.mjs. Đối chiếu spike T006.
import { decodePng } from '../../../../tools/svg-import/png-decode.mjs';
import { sleep, until, waitDeep } from './util.mjs';

export const options = { project: 'anim', drift: false };

const num = (s) => Number.parseFloat(s);

/**
 * axe ở hai theme mà giữ nguyên `prefers-reduced-motion` (emulateMediaFeatures thay cả danh sách đã đặt, nên phải đặt lại cả hai):
 * `axeBoth` chung sẽ trả giảm chuyển động về mặc định của máy và gỡ hoạt ảnh đang chạy.
 */
async function axeMotion(ctx, label, motion) {
  for (const [scheme, name] of [
    ['light', 'sáng'],
    ['dark', 'tối'],
  ]) {
    await ctx.page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: motion },
    ]);
    await sleep(80);
    await ctx.axe(`${label}, theme ${name}`);
  }
  await ctx.page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: motion },
  ]);
}

export default async function run(ctx) {
  const { page, rt } = ctx;

  /** Thông tin phần tử trong Shadow DOM của item svg: hộp màn hình, biến đổi, kiểu tính toán, hoạt ảnh. */
  const probe = (uid) =>
    page.evaluate((u) => {
      const root = document
        .querySelector('mat-screen')
        .shadowRoot.querySelector('.svg-host').shadowRoot;
      const el = root.querySelector(`[data-mat-uid="${u}"]`);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const m = root.querySelector('svg').getScreenCTM();
      return {
        l: r.left,
        t: r.top,
        r: r.right,
        b: r.bottom,
        k: m.a,
        ox: m.e,
        oy: m.f,
        transform: cs.transform,
        opacity: cs.opacity,
        dash: cs.strokeDashoffset,
        clipPath: cs.clipPath,
        attrTransform: el.getAttribute('transform'),
        states: el.getAnimations().map((a) => a.playState),
      };
    }, uid);
  const clipRect = () =>
    page.evaluate(() => {
      const root = document
        .querySelector('mat-screen')
        .shadowRoot.querySelector('.svg-host').shadowRoot;
      const out = {};
      for (const cp of root.querySelectorAll('clipPath')) {
        const r = cp.querySelector('rect');
        out[cp.id] = ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a)));
      }
      return out;
    });
  const animCount = () =>
    page.evaluate(() => document.querySelector('mat-screen').animationCount());
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
  /** Màu điểm ảnh tại tọa độ người dùng (ux, uy) của SVG (chụp viewport, deviceScaleFactor 1). */
  const pixelAt = async (ux, uy) => {
    const { k, ox, oy } = await probe('el_curve');
    const shot = decodePng(await page.screenshot({ type: 'png' }));
    return shot.at(Math.round(ux * k + ox), Math.round(uy * k + oy));
  };
  const isRed = (c) => c[0] > 200 && c[1] < 100 && c[2] < 100;
  const isBlue = (c) => c[2] > 200 && c[0] < 100;
  const isDark = (c) => c[0] < 40 && c[1] < 50 && c[2] < 80;

  // Máy chạy có thể đang bật giảm chuyển động của hệ điều hành: đặt rõ trước khi mở trang.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, '[data-mat-uid="el_curve"]', 1);
  rt.setValue('TANK01.LEVEL', 50);
  rt.setValue('TANK01.INFLOW', 10);
  rt.setValue('TANK01.SP', 90);
  rt.setValue('TANK02.SP', 100);
  rt.setValue('TANK03.SP', 2);
  rt.setValue('PUMP1.SPEED_SP', 0);
  rt.setValue('MOTOR01.RUN', true);
  rt.setValue('MOTOR01.SPEED', 600);
  await until(async () => (await clipRect())['mat-clip-el_curve']?.[3] < 75, 'clipLevel đã áp');
  await sleep(300);

  // ---- clipLevel ----
  const cr = await clipRect();
  ctx.check(
    'clipLevel path cong: rect cắt 50% theo hộp bao (y 25..100)',
    near(cr['mat-clip-el_curve'][1], 62.5, 0.6) && near(cr['mat-clip-el_curve'][3], 37.5, 0.6),
    JSON.stringify(cr['mat-clip-el_curve']),
  );
  const curve = await probe('el_curve');
  ctx.check(
    'clip-path phân giải trong Shadow DOM',
    curve.clipPath.includes('mat-clip-el_curve'),
    curve.clipPath,
  );
  ctx.check(
    'clipPath được tạo một lần mỗi phần tử',
    Object.keys(cr).length === 2,
    Object.keys(cr).join(','),
  );
  const lowPoint = await pixelAt(20 + 50, 20 + 90); // phần dưới của path: còn hiện
  const highPoint = await pixelAt(20 + 50, 20 + 40); // phần trên: bị cắt
  ctx.check(
    'điểm ảnh path cong: dưới mức đỏ, trên mức nền tối',
    isRed(lowPoint) && isDark(highPoint),
    `${lowPoint} | ${highPoint}`,
  );
  const gLeft = await pixelAt(150 + 25, 20 + 50);
  const gRight = await pixelAt(150 + 85, 20 + 50);
  ctx.check(
    'clipLevel trên nhóm (hướng phải 50%): nửa trái hiện, nửa phải cắt',
    isBlue(gLeft) && isDark(gRight),
    `${gLeft} | ${gRight}`,
  );

  // ---- quay quanh gốc kim ----
  const needle = await probe('el_needle');
  const px = 300 * needle.k + needle.ox;
  const py = 150 * needle.k + needle.oy;
  ctx.check(
    'kim quay 90 độ quanh gốc: đầu kim chỉ sang phải, gốc đứng yên',
    near(needle.l, px, 4) &&
      needle.r > px + 40 * needle.k &&
      near((needle.t + needle.b) / 2, py, 4),
    JSON.stringify({ l: needle.l, r: needle.r, px, py }),
  );
  ctx.check(
    'M0 của kim giữ nguyên trong DOM',
    needle.attrTransform === 'translate(300 150)',
    needle.attrTransform,
  );

  // ---- dời giữ M0, co giãn ----
  const mover = await probe('el_mover');
  ctx.check(
    'dời +100: hộp ở x = 50 (M0) + 100 đơn vị',
    near(mover.l, (50 + 100) * mover.k + mover.ox, 1.5),
    `${mover.l} vs ${150 * mover.k + mover.ox}`,
  );
  const scaler = await probe('el_scaler');
  ctx.check(
    'co giãn 2 quanh góc trái trên: rộng gấp đôi, góc trái giữ',
    near(scaler.r - scaler.l, 40 * scaler.k, 1.5) &&
      near(scaler.l, 100 * scaler.k + scaler.ox, 1.5),
    JSON.stringify({ w: scaler.r - scaler.l, l: scaler.l }),
  );
  const xf0 = await probe('el_xfrot');
  ctx.check(
    'phần tử có transform gốc: quay 0 độ giữ đúng vị trí M0',
    near(xf0.l, 250 * xf0.k + xf0.ox, 1.5) && xf0.attrTransform === 'translate(250 250)',
    `${xf0.l} vs ${250 * xf0.k + xf0.ox}`,
  );
  rt.setValue('PUMP1.SPEED_SP', 45);
  await until(async () => (await probe('el_xfrot')).transform.includes('0.7071'), 'quay 45 độ');
  const xf1 = await probe('el_xfrot');
  ctx.check(
    'quay 45 độ quanh tâm hộp bao: tâm đứng yên, hộp rộng ra',
    near((xf1.l + xf1.r) / 2, (xf0.l + xf0.r) / 2, 1.5) && xf1.r - xf1.l > (xf0.r - xf0.l) * 1.3,
    JSON.stringify({ c0: (xf0.l + xf0.r) / 2, c1: (xf1.l + xf1.r) / 2 }),
  );

  // ---- hoạt ảnh vô hạn ----
  ctx.check(
    'animationCount = 3 (quay, nhấp nháy, dòng chảy)',
    (await animCount()) === 3,
    String(await animCount()),
  );
  const ops = [];
  const offs = [];
  const mats = [];
  for (let i = 0; i < 40; i++) {
    const [bl, pipe, fan] = [
      await probe('el_blink'),
      await probe('el_pipe'),
      await probe('el_fan'),
    ];
    ops.push(num(bl.opacity));
    offs.push(num(pipe.dash));
    mats.push(fan.transform);
    await sleep(40);
  }
  ctx.check(
    'nhấp nháy đổi opacity giữa bật và tắt',
    ops.some((o) => o > 0.95) && ops.some((o) => o < 0.3),
    [...new Set(ops)].join(','),
  );
  ctx.check(
    'dòng chảy: strokeDashoffset đổi theo thời gian',
    new Set(offs).size > 5,
    `${offs[0]} .. ${offs[offs.length - 1]}`,
  );
  ctx.check(
    'quay liên tục: ma trận đổi theo thời gian',
    new Set(mats).size > 5,
    `${new Set(mats).size} giá trị`,
  );

  // ---- tab ẩn ----
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenStates = [
    ...(await probe('el_blink')).states,
    ...(await probe('el_pipe')).states,
    ...(await probe('el_fan')).states,
  ];
  ctx.check(
    'tab ẩn: mọi hoạt ảnh tạm dừng',
    hiddenStates.length === 3 && hiddenStates.every((s) => s === 'paused'),
    hiddenStates.join(','),
  );
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const shownStates = [
    ...(await probe('el_blink')).states,
    ...(await probe('el_pipe')).states,
    ...(await probe('el_fan')).states,
  ];
  ctx.check(
    'tab hiện lại: hoạt ảnh chạy lại',
    shownStates.every((s) => s === 'running'),
    shownStates.join(','),
  );

  // ---- giảm chuyển động (CDP): ADR 056 — hoạt ảnh trạng thái vẫn chạy, chỉ thiết lập project tắt được ----
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sleep(300);
  const reducedStates = [
    ...(await probe('el_fan')).states,
    ...(await probe('el_blink')).states,
    ...(await probe('el_pipe')).states,
  ];
  ctx.check(
    'prefers-reduced-motion: reduce, motion Bật: quay/nhấp nháy/dòng chảy vẫn running',
    (await animCount()) === 3 &&
      reducedStates.length === 3 &&
      reducedStates.every((s) => s === 'running'),
    reducedStates.join(','),
  );
  const setMotion = (v) =>
    page.evaluate((m) => {
      document.documentElement.dataset.matMotion = m;
      document.dispatchEvent(new Event('mat-motion'));
    }, v);
  await setMotion('off');
  await until(async () => (await animCount()) === 0, 'motion Tắt gỡ hoạt ảnh');
  const rb = [];
  const rp = [];
  for (let i = 0; i < 6; i++) {
    rb.push(num((await probe('el_blink')).opacity));
    rp.push(num((await probe('el_pipe')).dash));
    await sleep(60);
  }
  ctx.check(
    'giảm chuyển động: nhấp nháy tĩnh ở trạng thái bật (opacity 1)',
    rb.every((o) => o === 1),
    rb.join(','),
  );
  ctx.check('giảm chuyển động: dòng chảy đứng yên', new Set(rp).size === 1, rp.join(','));
  await axeMotion(ctx, 'trang có hoạt ảnh, giảm chuyển động (T114)', 'reduce');
  await setMotion('on');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await until(async () => (await animCount()) === 3, 'motion Bật dựng lại hoạt ảnh');
  ctx.check('motion Bật lại: hoạt ảnh trở lại', true);
  await axeMotion(
    ctx,
    'trang có hoạt ảnh đang chạy: quay, nhấp nháy, dòng chảy (T114)',
    'no-preference',
  );

  // ---- mất giá trị tốt: dừng ----
  rt.setValue('MOTOR01.RUN', true, 'BAD', 'TIMEOUT');
  await until(
    async () => (await probe('el_blink')).states.length === 0,
    'chất lượng xấu tắt nhấp nháy',
  );
  ctx.check(
    'chất lượng xấu: nhấp nháy tắt, dòng chảy dừng',
    (await probe('el_pipe')).states[0] === 'paused',
  );
  await ctx.shot('cuoi');
}
