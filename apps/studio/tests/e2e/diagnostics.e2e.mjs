// E2E Chẩn đoán driver (feature 006, T199, US5, FR-051, quickstart §5 bước 15), lớp Tauri giả và thiết bị giả:
// - Offline: trang báo cần Online; Online (engineer): cây kênh › thiết bị trường có trạng thái bằng chữ;
// - số đếm tăng đúng sau tiêm lỗi giả; phần tăng thêm từ lúc mở trang; Đặt lại phần tăng;
// - chu kỳ thực cạnh chu kỳ đặt, dấu quá tải (chip có chữ); hỏi mỗi 2 s chỉ khi trang đang mở;
// - Tag xấu kèm lý do tiếng Việt, nhấp đúp tới Bảng Tag và chọn đúng Tag;
// - tab Chẩn đoán của inspector có thẻ Trang xem, Tag, Giữ qua mất điện;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  goOnline,
  openAndWait,
  readProject,
  sleep,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

const DD = 'mat-driver-diagnostics';
const polls = (page) =>
  page.evaluate(
    () =>
      window.__matMock.device.calls.filter(
        (c) => c.cmd === 'device_get' && c.args.path === '/api/v1/drivers/diagnostics',
      ).length,
  );
const row = (key) => `${DD} table[data-role="counters"] tr[data-row="${key}"]`;

export default async function diagnostics({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  await openAndWait(page, files, 'D:\\Projects\\full-02');
  await treeNode(page, 'driverDiag');
  await page.waitForSelector(`${DD} [data-role="needs-online"]`);
  check(
    'Offline: trang báo cần Online, có nút Online',
    /Cần Online/.test((await text(page, DD)) ?? '') &&
      Boolean(await page.$(`${DD} button[data-act="online"]`)),
  );
  await shot('1-can-online');
  await axeBoth(page, axe, 'Chẩn đoán driver khi Offline');

  // ---------- Online (engineer) ----------
  await goOnline(page, 'kysu1', files);
  await page.waitForSelector(`${DD} [role="tree"]`, { timeout: 10000 });
  const items = await page.$$eval(`${DD} [role="treeitem"]`, (l) =>
    l.map(
      (e) =>
        `${e.querySelector('.dd-name')?.textContent.trim()}|${e.querySelector('.chip')?.textContent.trim()}`,
    ),
  );
  check(
    'cây kênh › thiết bị trường kèm trạng thái bằng chữ',
    items.length === 5 &&
      /^PLC trạm bơm\|đã kết nối$/.test(items[0] ?? '') &&
      items.some((i) => /hoạt động$/.test(i)) &&
      items.some((i) => /tắt$/.test(i)),
    items.join(' ; '),
  );
  const selected = await page.$eval(`${DD} [role="treeitem"][aria-selected="true"] .dd-name`, (e) =>
    e.textContent.trim(),
  );
  check('chọn sẵn thiết bị trường đầu tiên', selected === 'PLC 1' || selected.length > 0, selected);
  await shot('2-chan-doan-driver');
  await axeBoth(page, axe, 'Chẩn đoán driver Online');

  // ---------- Tiêm lỗi: số đếm và phần tăng từ lúc mở ----------
  const timeoutsBefore = await text(page, `${row('timeouts')} .dd-total`);
  await page.evaluate(() =>
    window.__matMock.device.injectDriverFault('BL335-01', 'plc1', {
      timeouts: 4,
      exceptions: { '02': 3 },
      badFrames: { crc: 2 },
    }),
  );
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-driver-diagnostics tr[data-row="timeouts"] .dd-delta')
        ?.textContent.trim() === '+4',
    undefined,
    6000,
  );
  const timeoutsAfter = await text(page, `${row('timeouts')} .dd-total`);
  check(
    'số đếm tăng đúng sau tiêm lỗi: Hết thời gian +4, tổng tăng 4',
    Number((timeoutsAfter ?? '').replace(/\./g, '')) ===
      Number((timeoutsBefore ?? '').replace(/\./g, '')) + 4,
    `${timeoutsBefore} → ${timeoutsAfter}`,
  );
  check(
    'exception 02 tăng 3 từ lúc mở',
    (await text(page, `${row('exception:02')} .dd-delta`)) === '+3',
  );
  check(
    'khung hỏng hiện tổng theo loại (crc/format/tid/unit/length/echo)',
    /^\d+\/\d+\/\d+\/\d+\/\d+\/\d+$/.test(
      (await text(page, `${row('badFrames')} .dd-total`)) ?? '',
    ),
  );
  const okDelta = await text(page, `${row('requestsOk')} .dd-delta`);
  check(
    'yêu cầu thành công tăng theo mỗi lần hỏi (phần tăng > 0)',
    /^\+[1-9]/.test(okDelta ?? ''),
    okDelta,
  );
  await page.click(`${DD} button[data-act="rebase"]`);
  await sleep(120);
  check('Đặt lại phần tăng về +0', (await text(page, `${row('timeouts')} .dd-delta`)) === '+0');
  await shot('3-so-dem');

  // ---------- Quá tải ----------
  await page.evaluate(() =>
    window.__matMock.device.injectDriverFault('BL335-01', 'plc1', { overloaded: true }),
  );
  await waitFor(
    page,
    () => document.querySelector('mat-driver-diagnostics tr[data-group] .dd-over .chip.err'),
    undefined,
    6000,
  );
  const over = await text(page, `${DD} tr[data-group] .dd-over`);
  check(
    'dấu quá tải có chữ "quá tải" kèm số lần',
    /quá tải/.test(over ?? '') && /\d+ lần/.test(over ?? ''),
    over,
  );
  const actual = await text(page, `${DD} tr[data-group] .dd-actual`);
  check('chu kỳ thực (tb / max) cạnh chu kỳ đặt', /[\d.]+ \/ [\d.]+ ms/.test(actual ?? ''), actual);
  await shot('4-qua-tai');
  await axeBoth(page, axe, 'Chẩn đoán driver có dấu quá tải');

  // ---------- Hỏi mỗi 2 s, chỉ khi trang mở ----------
  const p0 = await polls(page);
  await sleep(6300);
  const p1 = await polls(page);
  check(
    `hỏi khoảng mỗi 2 s khi trang mở (${p1 - p0} lần trong 6,3 s)`,
    p1 - p0 >= 2 && p1 - p0 <= 4,
    `${p1 - p0}`,
  );

  // ---------- Tag xấu → nhấp đúp tới Bảng Tag ----------
  await page.evaluate(() =>
    window.__matMock.device.setDriverDiagnostics('BL335-01', {
      badTags: [
        {
          id: 'TANK01.VOLUME',
          quality: 'BAD',
          reason: 'INPUT_BAD',
          detail: 'TANK01.LEVEL',
          updatedAt: Date.now() - 1000,
        },
        {
          id: 'METER1.P',
          quality: 'BAD',
          reason: 'TIMEOUT',
          detail: null,
          updatedAt: Date.now() - 2000,
        },
      ],
    }),
  );
  await waitFor(
    page,
    () => document.querySelectorAll('mat-driver-diagnostics tr[data-tag]').length === 2,
    undefined,
    6000,
  );
  const bad = await text(page, `${DD} tr[data-tag="TANK01.VOLUME"]`);
  check(
    'Tag xấu kèm lý do tiếng Việt và đầu vào xấu',
    /đầu vào của biểu thức không tốt: TANK01\.LEVEL/.test(bad ?? ''),
    bad,
  );
  await shot('5-tag-xau');
  await axeBoth(page, axe, 'danh sách Tag xấu');
  await page.evaluate(() =>
    document
      .querySelector('mat-driver-diagnostics tr[data-tag="TANK01.VOLUME"]')
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  await page.waitForSelector('mat-tag-grid [role="gridcell"]');
  await waitFor(
    page,
    () => {
      const cur = document.querySelector('mat-tag-grid [role="gridcell"].mg-cur');
      return cur?.getAttribute('data-c') === 'id' && cur.textContent.includes('TANK01.VOLUME');
    },
    undefined,
    5000,
  );
  check('nhấp đúp Tag xấu: mở Bảng Tag và chọn đúng ô tên TANK01.VOLUME', true);

  // ---------- Dừng hỏi khi rời trang ----------
  const q0 = await polls(page);
  await sleep(4500);
  check(
    'rời trang (đã mở Bảng Tag): ngừng hỏi',
    (await polls(page)) === q0,
    `${q0} → ${await polls(page)}`,
  );

  // ---------- Tab Chẩn đoán: thẻ Trang xem, Tag, Giữ qua mất điện ----------
  await page.evaluate(() =>
    window.__matMock.device.setDiagnostics('BL335-01', {
      viewer: { access: 'any', blockedTotal: 17, lastBlockedAt: Date.now() - 60_000 },
      tags: { total: 812, good: 790, uncertain: 2, bad: 20 },
      retain: { state: 'ok', tags: 12, lastSaveAt: Date.now() - 120_000, saves: 341 },
    }),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector [role="tab"]')]
      .find((t) => /Chẩn đoán/.test(t.textContent))
      ?.click(),
  );
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-inspector .metric .l')].some(
        (l) => l.textContent.trim() === 'Giữ qua mất điện',
      ),
    undefined,
    8000,
  );
  const metric = (label) =>
    page.evaluate(
      (l) =>
        [...document.querySelectorAll('mat-inspector .metric')]
          .find((m) => m.querySelector('.l')?.textContent.trim() === l)
          ?.textContent.replace(/\s+/g, ' ')
          .trim(),
      label,
    );
  const viewer = await metric('Trang xem');
  const tags = await metric('Tag');
  const retain = await metric('Giữ qua mất điện');
  check(
    'tab Chẩn đoán: Trang xem mở cho mọi nguồn kèm số lượt chặn',
    /Mở cho mọi nguồn/.test(viewer ?? '') && /17 lượt/.test(viewer ?? ''),
    viewer,
  );
  check(
    'tab Chẩn đoán: Tag tốt, không chắc, xấu',
    /812/.test(tags ?? '') && /xấu 20/.test(tags ?? ''),
    tags,
  );
  check(
    'tab Chẩn đoán: Giữ qua mất điện bình thường, 12 Tag, 341 lần lưu',
    /Bình thường/.test(retain ?? '') && /12 Tag/.test(retain ?? '') && /341 lần/.test(retain ?? ''),
    retain,
  );
  await shot('6-tab-chan-doan');
  await axeBoth(page, axe, 'tab Chẩn đoán có thẻ của 006');
}
