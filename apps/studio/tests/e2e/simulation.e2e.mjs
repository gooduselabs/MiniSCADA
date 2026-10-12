// E2E Mô phỏng trong Studio (feature 006, T205, US6, FR-052, SC-017, quickstart §5 bước 16–17), lớp Tauri giả và thiết bị giả.
// Đồng hồ của trang cố định ở t = 1791601205123 (ghi đè Date.now, như đặt đồng hồ qua CDP) để so với tests/sim-vectors:
// - bật Mô phỏng từ thanh công cụ: dấu MÔ PHỎNG (tím, nét đứt) ở khung và thanh trạng thái, khác viền cam của Online;
// - giá trị bộ sinh (sine, ramp, square, random) và Tag tính toán trong Bảng Tag khớp vector ở cùng t;
// - 0 request ra ngoài (page.on('request')) và DeviceLink giả có 0 lời gọi trong lúc Mô phỏng;
// - ghi tay từ Bảng theo dõi áp ngay (không đăng nhập, ghi rõ "mô phỏng"), Tag tính toán phụ thuộc cập nhật;
// - chuyển Mô phỏng ↔ Online có hỏi (Hủy giữ nguyên; Chuyển thì ngắt hoặc tắt bên kia), không bao giờ chạy cùng lúc;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FULL_02,
  REPO,
  axeBoth,
  expandNode,
  goOnline,
  openAndWait,
  press,
  readProject,
  sleep,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

const T = 1791601205123;
const SIM = 'button[data-cmd="tools.simulate"]';

const vector = (kind) => {
  const { suites } = JSON.parse(
    readFileSync(join(REPO, 'tests/sim-vectors', `${kind}.json`), 'utf8'),
  );
  const s = suites.find((x) => x.type === 'FLOAT64');
  return { sim: s.sim, value: s.cases.find((c) => c.t === T).value };
};

const num = (s) =>
  Number(
    String(s ?? '')
      .replace(/\s*[^\d,.-].*$/, '')
      .replace(/\./g, '')
      .replace(',', '.'),
  );

/** Chữ của ô giá trị sống theo id Tag trong Bảng Tag. */
const liveOf = (page, id) =>
  page.evaluate((want) => {
    const idCell = [
      ...document.querySelectorAll('mat-tag-grid [role="gridcell"][data-c="id"]'),
    ].find((c) => c.textContent.includes(want));
    if (!idCell) return null;
    const v = document.querySelector(
      `mat-tag-grid [role="gridcell"][data-r="${idCell.dataset.r}"][data-c="value"]`,
    );
    return v ? v.textContent.replace(/\s+/g, ' ').trim() : null;
  }, id);

const mockCalls = (page) => page.evaluate(() => window.__matMock.device.calls.length);

async function toolbarPressed(page) {
  return page.$eval(SIM, (b) => b.getAttribute('aria-pressed'));
}

export default async function simulation({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  const tags = JSON.parse(files['tags.json']);
  const sine = vector('sine');
  const ramp = vector('ramp');
  const square = vector('square');
  const random = vector('random');
  const simTag = (id, v) => ({ id, kind: 'simulation', type: 'FLOAT64', sim: v.sim });
  const extra = [
    simTag('S_SINE', sine),
    simTag('S_RAMP', ramp),
    simTag('S_SQUARE', square),
    simTag('S_RANDOM', random),
    { id: 'C_DOUBLE', kind: 'calculated', type: 'FLOAT64', expression: 'S_SINE * 2' },
    { id: 'C_SP', kind: 'calculated', type: 'FLOAT64', expression: 'TANK01.SP * 2' },
  ];
  await openAndWait(
    page,
    { ...files, 'tags.json': JSON.stringify({ ...tags, tags: [...tags.tags, ...extra] }) },
    'D:\\Projects\\sim',
  );
  // Đồng hồ cố định: mọi lượt Mô phỏng của Studio lấy t này.
  await page.evaluate((t) => {
    window.__realDateNow = Date.now.bind(Date);
    Date.now = () => t;
  }, T);

  await treeNode(page, 'tags');
  await page.waitForSelector('mat-tag-grid [role="gridcell"]');
  check(
    'trước khi bật: nút Mô phỏng chưa nhấn, không có dấu MÔ PHỎNG',
    (await toolbarPressed(page)) === 'false' && !(await page.$('.sim-chip')),
  );

  // ---------- 1. Bật Mô phỏng, đo mạng ----------
  const requests = [];
  const onRequest = (r) => requests.push(r.url());
  page.on('request', onRequest);
  const calls0 = await mockCalls(page);
  await page.click(SIM);
  await page.waitForSelector('.sim-chip');
  check('nút Mô phỏng được nhấn (aria-pressed)', (await toolbarPressed(page)) === 'true');
  const chip = await text(page, '.sim-chip');
  check('dấu MÔ PHỎNG ở khung có chữ', /MÔ PHỎNG/.test(chip ?? ''), chip);
  check(
    'thanh trạng thái có dấu MÔ PHỎNG',
    /MÔ PHỎNG/.test((await text(page, 'mat-statusbar [data-role="sim"]')) ?? ''),
  );
  const frame = await page.$eval('.win', (w) => w.className);
  check(
    'khung có lớp sim, không có lớp online (viền tím nét đứt, khác viền cam)',
    /\bsim\b/.test(frame) && !/\bonline\b/.test(frame),
    frame,
  );
  const border = await page
    .$eval('.win.sim .center', (e) => getComputedStyle(e, '::after').borderTopStyle)
    .catch(() => null);
  check('viền khung là nét đứt', border === 'dashed', String(border));
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-tag-grid [role="gridcell"][data-c="value"]')].some((c) =>
        /\d/.test(c.textContent),
      ),
    undefined,
    4000,
  );
  await sleep(800);

  // ---------- 2. Giá trị khớp vector ở cùng t ----------
  const got = {
    S_SINE: num(await liveOf(page, 'S_SINE')),
    S_RAMP: num(await liveOf(page, 'S_RAMP')),
    S_SQUARE: num(await liveOf(page, 'S_SQUARE')),
    S_RANDOM: num(await liveOf(page, 'S_RANDOM')),
    C_DOUBLE: num(await liveOf(page, 'C_DOUBLE')),
  };
  const near = (a, b) => Math.abs(a - b) <= 0.0006;
  check(
    `sine khớp vector tại t (${sine.value} ≈ ${got.S_SINE})`,
    near(got.S_SINE, sine.value),
    JSON.stringify(got),
  );
  check(`ramp khớp vector tại t (${ramp.value} ≈ ${got.S_RAMP})`, near(got.S_RAMP, ramp.value));
  check(
    `square khớp vector tại t (${square.value} ≈ ${got.S_SQUARE})`,
    near(got.S_SQUARE, square.value),
  );
  check(
    `random khớp vector tại t (${random.value} ≈ ${got.S_RANDOM})`,
    near(got.S_RANDOM, random.value),
  );
  check(
    `Tag tính toán S_SINE * 2 khớp (${sine.value * 2} ≈ ${got.C_DOUBLE})`,
    near(got.C_DOUBLE, sine.value * 2),
  );
  await shot('1-mo-phong-bang-tag');
  await axeBoth(page, axe, 'Bảng Tag khi Mô phỏng');

  // ---------- 3. Ghi tay từ Bảng theo dõi ----------
  await expandNode(page, 'watchTables');
  await treeNode(page, 'watch:van-hanh');
  await page.waitForSelector('mat-watch-table-editor [role="gridcell"]');
  await page.click('mat-watch-table-editor [role="gridcell"][data-r="0"][data-c="tag"]');
  const lock = await page.$eval('mat-watch-table-editor [data-act="write"]', (b) =>
    b.getAttribute('aria-disabled'),
  );
  check('khi Mô phỏng lệnh Ghi bật, không cần Online hay đăng nhập', lock === null, String(lock));
  await page.click('mat-watch-table-editor [data-act="write"]');
  await waitFor(
    page,
    () =>
      /mô phỏng/i.test(
        document.querySelector(
          'mat-watch-table-editor [role="gridcell"][data-r="0"][data-c="result"]',
        )?.textContent ?? '',
      ),
    undefined,
    4000,
  );
  check(
    'không có hộp xác nhận ghi: kết quả ghi rõ "mô phỏng"',
    !(await page.$('mat-write-confirm-dialog [role="dialog"]')),
    (await text(page, 'mat-watch-table-editor [role="gridcell"][data-r="0"][data-c="result"]')) ??
      '',
  );
  await waitFor(
    page,
    () =>
      /^75/.test(
        document
          .querySelector('mat-watch-table-editor [role="gridcell"][data-r="0"][data-c="value"]')
          ?.textContent.trim() ?? '',
      ),
    undefined,
    4000,
  );
  check('ghi tay áp ngay: TANK01.SP = 75', true);
  await treeNode(page, 'tags');
  await page.waitForSelector('mat-tag-grid [role="gridcell"]');
  await waitFor(page, () => document.querySelector('mat-tag-grid') !== null, undefined, 1000);
  await sleep(300);
  const csp = num(await liveOf(page, 'C_SP'));
  check(`Tag tính toán phụ thuộc cập nhật ngay: C_SP = 150 (đo ${csp})`, csp === 150);
  await shot('2-ghi-tay');

  // ---------- 4. 0 request, 0 lời gọi DeviceLink ----------
  await sleep(2500);
  page.off('request', onRequest);
  check(
    `0 request ra ngoài trong lúc Mô phỏng (đo ${requests.length})`,
    requests.length === 0,
    requests.slice(0, 3).join(' | '),
  );
  const calls1 = await mockCalls(page);
  check(
    'DeviceLink giả có 0 lời gọi trong lúc Mô phỏng',
    calls1 === calls0,
    `${calls0} → ${calls1}`,
  );

  // ---------- 5. Mô phỏng → Online: hỏi ----------
  await press(page, 'Control+k');
  await page.waitForSelector('mat-dialog .dlg-simSwitch');
  const ask = await text(page, 'mat-dialog .dlg-simSwitch');
  check(
    'đang Mô phỏng mà bật Online: hỏi rồi mới chuyển',
    /Mô phỏng/.test(ask ?? '') && /tắt Mô phỏng/.test(ask ?? ''),
    ask,
  );
  await shot('3-hoi-chuyen');
  await axeBoth(page, axe, 'hộp thoại Chuyển chế độ');
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-dialog .dlg-simSwitch'));
  check(
    'Hủy: vẫn Mô phỏng, chưa mở Thiết bị trong mạng',
    (await toolbarPressed(page)) === 'true' &&
      !(await page.$('mat-devices-dialog [role="dialog"]')),
  );

  // Chuyển thật: tắt Mô phỏng khi chọn Chuyển rồi Online.
  await press(page, 'Control+k');
  await page.waitForSelector('mat-dialog .dlg-simSwitch');
  await page.click('mat-dialog .dlg-simSwitch button[data-choice="ok"]');
  await waitFor(page, () => !document.querySelector('mat-dialog .dlg-simSwitch'));
  check(
    'Chuyển: Mô phỏng tắt, dấu MÔ PHỎNG mất',
    (await toolbarPressed(page)) === 'false' && !(await page.$('.sim-chip')),
  );
  await page.keyboard.press('Escape');

  // ---------- 6. Online → Mô phỏng: hỏi, ngắt Online ----------
  await goOnline(page, 'kysu1', files);
  const onlineFrame = await page.$eval('.win', (w) => w.className);
  check(
    'Online: khung có viền cam (lớp online), không có lớp sim',
    /\bonline\b/.test(onlineFrame) && !/\bsim\b/.test(onlineFrame),
    onlineFrame,
  );
  await page.click(SIM);
  await page.waitForSelector('mat-dialog .dlg-simSwitch');
  const askOnline = await text(page, 'mat-dialog .dlg-simSwitch');
  check(
    'đang Online mà bật Mô phỏng: hỏi, nói sẽ ngắt kết nối thiết bị',
    /ngắt kết nối/.test(askOnline ?? ''),
    askOnline,
  );
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-dialog .dlg-simSwitch'));
  check(
    'Hủy: vẫn Online',
    /\bonline\b/.test(await page.$eval('.win', (w) => w.className)) &&
      (await toolbarPressed(page)) === 'false',
  );
  await page.click(SIM);
  await page.waitForSelector('mat-dialog .dlg-simSwitch');
  await page.click('mat-dialog .dlg-simSwitch button[data-choice="ok"]');
  await waitFor(
    page,
    () => document.querySelector('.win')?.classList.contains('sim'),
    undefined,
    6000,
  );
  const final = await page.$eval('.win', (w) => w.className);
  check(
    'Chuyển: ngắt Online, bật Mô phỏng; không bao giờ cùng lúc',
    /\bsim\b/.test(final) && !/\bonline\b/.test(final),
    final,
  );
  const status = await text(page, 'mat-statusbar');
  check(
    'thanh trạng thái: không kết nối + MÔ PHỎNG',
    /Không kết nối/.test(status ?? '') && /MÔ PHỎNG/.test(status ?? ''),
    status,
  );
  await shot('4-sau-chuyen');
  await axeBoth(page, axe, 'sau khi chuyển Online sang Mô phỏng');
  await page.evaluate(() => {
    if (window.__realDateNow) Date.now = window.__realDateNow;
  });
}
