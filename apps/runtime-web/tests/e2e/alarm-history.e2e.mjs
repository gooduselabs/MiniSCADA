/* global window */
// e2e trang Lịch sử alarm (feature 009, T093; US4 kịch bản 1 đến 6; SC-013, SC-020; axe sáng và tối): chọn khoảng, lọc, tìm chữ,
// sắp xếp trên trang đã tải, phân trang bằng beforeId, Theo dõi, xuất CSV (kiểm nội dung tải về, 5.000 dòng giả, chống công thức).
import { axeBoth, sleep, until } from './util.mjs';

export const options = { project: 'dashboard', config: { alarms: true }, drift: false };

const N = 5000;
const PRIOS = ['critical', 'major', 'minor', 'advisory'];
const AREAS = ['bon', 'dien', null];

/** `N` lần xảy ra trong 24 giờ qua, mới nhất trước (id giảm dần). Dòng id 4999 mang công thức độc hại (SC-020). */
function makeHistory(now) {
  const rows = [];
  for (let id = N; id >= 1; id--) {
    const tsActive = now - (N - id + 1) * 15_000;
    const open = id > N - 5;
    rows.push({
      id,
      alarmId: `AL_${id % 40}`,
      name: `Alarm ${id % 40}`,
      class: PRIOS[id % 4],
      priority: PRIOS[id % 4],
      area: AREAS[id % 3],
      text: id === 4999 ? '=HYPERLINK("http://evil","x")' : `Bồn ${id} mức cao, "ngưỡng", dòng`,
      valueActive: id % 7 === 0 ? -5.2 : id % 2 === 0,
      qualityActive: 'GOOD',
      reason: null,
      tsActive,
      clockOk: id % 500 !== 0,
      tsAck: id % 3 === 0 ? tsActive + 4000 : null,
      ackUser: id % 3 === 0 ? 'vanhanh1' : null,
      tsReturn: open ? null : tsActive + 30_000,
      tsReturnAck: null,
      returnAckUser: null,
      flags: { startup: id % 1000 === 0, inputBad: false },
      closedBy: open ? null : 'return',
      state: open ? 'active' : 'closed',
    });
  }
  return rows;
}

const CAPTURE = `
  window.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); };
`;

const rowsText = (page) =>
  page.$$eval('.al-hist tbody tr', (trs) =>
    trs.map((r) =>
      [...r.querySelectorAll('td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    ),
  );

async function open(ctx, base, hash) {
  const { page } = ctx;
  await page.goto('about:blank');
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
}

async function setSel(page, sel, value) {
  await page.select(sel, value);
  await sleep(250);
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 503');
  const https = ctx.httpsUrl;
  await page.evaluateOnNewDocument(CAPTURE);
  rt.alarm.setHistory(makeHistory(Date.now()));

  // ---- Kịch bản 1: mở, khoảng mặc định 24 giờ ----
  await open(ctx, https, '#/alarm-history');
  await until(async () => (await rowsText(page)).length === 100, '100 dòng đầu');
  ctx.check(
    'menu có mục Lịch sử alarm và đang được tô',
    (await page.$eval('#app-nav button[aria-current="page"]', (b) => b.textContent.trim())) ===
      'Lịch sử alarm',
  );
  ctx.check(
    'khoảng mặc định 24 giờ được chọn',
    (await page.$eval('[data-range="24h"]', (b) => b.getAttribute('aria-pressed'))) === 'true',
  );
  ctx.check(
    'trang đầu 100 dòng, hiện "Đã tải 100 dòng" và nút Tải thêm',
    (await page.$eval('[data-loaded]', (e) => e.textContent)) === 'Đã tải 100 dòng' &&
      !(await page.$eval('button[data-act="more"]', (b) => b.hidden)),
  );
  const first = (await rowsText(page))[0];
  ctx.check(
    'dòng mới nhất trước; lần xảy ra chưa hết hiện "Đang có"',
    first[8] === 'Đang có' && first[7].includes('Bồn 5000'),
    JSON.stringify(first),
  );
  ctx.check(
    'cột Ưu tiên và Khu vực bằng chữ',
    ['Khẩn cấp', 'Quan trọng', 'Nhỏ', 'Lưu ý'].includes(first[5]) &&
      ['Bồn', 'Điện', 'Chung'].includes(first[6]),
    `${first[5]}/${first[6]}`,
  );
  await axeBoth(ctx, 'trang Lịch sử alarm');

  // ---- Kịch bản 6: phân trang bằng beforeId ----
  for (let i = 0; i < 3; i++) {
    await page.click('button[data-act="more"]');
    await until(async () => (await rowsText(page)).length === 100 * (i + 2), `trang ${i + 2}`);
  }
  const calls = rt.alarm.historyCalls;
  ctx.check(
    'Tải thêm dùng beforeId (không OFFSET), 100 dòng mỗi lần',
    calls
      .slice(-3)
      .every((c) => c.includes('beforeId=') && !c.includes('offset') && c.includes('limit=100')),
    calls.at(-1),
  );
  ctx.check(
    'không có dòng trùng sau khi nối trang',
    new Set((await rowsText(page)).map((r) => r[7])).size === 400,
  );

  // ---- Khoảng nhanh ----
  await page.click('[data-range="1h"]');
  await until(
    async () =>
      (await rowsText(page)).length === 100 &&
      (await page.$eval('[data-range="1h"]', (b) => b.getAttribute('aria-pressed'))) === 'true',
    'khoảng 1 giờ',
  );
  const c1h = calls.at(-1);
  const p = new URLSearchParams(c1h);
  ctx.check(
    '1 giờ: from–to cách nhau đúng 3.600.000 ms',
    Number(p.get('to')) - Number(p.get('from')) === 3_600_000,
    c1h,
  );
  await page.click('[data-range="24h"]');
  await until(async () => (await rowsText(page)).length === 100, 'về 24 giờ');

  // ---- Bộ lọc, tìm chữ (không phân biệt dấu) ----
  await setSel(page, '.al-history select[data-f="priority"]', 'major');
  await until(
    async () =>
      (await rowsText(page)).every((r) => ['Khẩn cấp', 'Quan trọng'].includes(r[5])) &&
      (await rowsText(page)).length > 0,
    'lọc mức tối thiểu',
  );
  ctx.check('mức tối thiểu Quan trọng: chỉ Khẩn cấp và Quan trọng', true);
  await setSel(page, '.al-history select[data-f="priority"]', '');
  await setSel(page, '.al-history select[data-f="area"]', '-');
  await until(
    async () => (await rowsText(page)).every((r) => r[6] === 'Chung'),
    'lọc khu vực Chung',
  );
  ctx.check('khu vực Chung chỉ gồm dòng không có khu vực', true);
  await setSel(page, '.al-history select[data-f="area"]', '');
  await page.type('.al-history input[type="search"]', 'bon 4321');
  await page.keyboard.press('Tab');
  await until(async () => (await rowsText(page)).length === 1, 'tìm chữ');
  ctx.check(
    'tìm "bon 4321" (bỏ dấu) khớp "Bồn 4321"',
    (await rowsText(page))[0][7].startsWith('Bồn 4321'),
  );
  await page.$eval('.al-history input[type="search"]', (e) => {
    e.value = '';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await rowsText(page)).length === 100, 'xóa chữ tìm');

  // ---- Sắp xếp trên trang đã tải ----
  const before = rt.alarm.historyCalls.length;
  await page.click('th button[data-col="text"]');
  const sorted = (await rowsText(page)).map((r) => r[7]);
  ctx.check(
    'sắp xếp cột Nội dung tăng dần trên trang đã tải, không gọi máy chủ',
    JSON.stringify(sorted) ===
      JSON.stringify([...sorted].sort((a, b) => a.localeCompare(b, 'vi'))) &&
      rt.alarm.historyCalls.length === before,
  );
  ctx.check(
    'tiêu đề cột có aria-sort',
    (await page.$eval('th[aria-sort]', (t) => t.getAttribute('aria-sort'))) === 'ascending',
  );

  // ---- Kịch bản 5: Theo dõi ----
  ctx.check(
    'Theo dõi mặc định tắt',
    (await page.$eval('input[data-f="follow"]', (c) => c.checked)) === false,
  );
  rt.alarm.reset([['X1', { class: 'major' }]]);
  await sleep(300);
  const nBefore = rt.alarm.historyCalls.length;
  await page.click('input[data-f="follow"]');
  rt.alarm.set('X2', { class: 'major' });
  await until(
    async () => rt.alarm.historyCalls.length > nBefore,
    'Theo dõi tải lại trang đầu',
    6000,
  );
  ctx.check(
    'Theo dõi bật: thay đổi alarm tải lại trang đầu (không beforeId)',
    !rt.alarm.historyCalls.at(-1).includes('beforeId'),
  );
  await page.click('input[data-f="follow"]');

  // ---- Lỗi ----
  rt.breakAlarmHistory(true);
  await page.click('[data-range="8h"]');
  await until(
    async () =>
      ((await page.$eval('[data-err]', (e) => e.textContent)) ?? '').includes(
        'Kho lịch sử alarm chưa sẵn sàng',
      ),
    'lỗi ALARM_LOG_UNAVAILABLE bằng chữ tiếng Việt',
  );
  ctx.check('lỗi ALARM_LOG_UNAVAILABLE hiện bằng chữ tiếng Việt', true);
  rt.breakAlarmHistory(false);
  await page.click('[data-range="24h"]');
  await until(async () => (await rowsText(page)).length === 100, 'hồi phục sau lỗi');
  ctx.check(
    'quá 366 ngày: không gửi, hiện lý do',
    await (async () => {
      const n = rt.alarm.historyCalls.length;
      await page.$eval('input[data-f="from"]', (e) => {
        e.value = '2024-01-01T00:00';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await sleep(300);
      return (
        rt.alarm.historyCalls.length === n &&
        (await page.$eval('[data-err]', (e) => e.textContent)).includes('366 ngày')
      );
    })(),
  );
  await page.click('[data-range="24h"]');
  await until(async () => (await rowsText(page)).length === 100, 'về 24 giờ lần 2');

  // ---- Kịch bản 3, 4: xuất CSV 5.000 dòng ----
  const t0 = Date.now();
  await page.click('button[data-act="csv"]');
  await until(
    async () => (await page.evaluate(() => window.__blobs.length)) >= 1,
    'CSV tải về',
    30_000,
  );
  const ms = Date.now() - t0;
  console.log(`  · xuất CSV ${N} dòng: ${ms} ms (SC-013 ≤ 10 s)`);
  ctx.check(`xuất ${N} dòng ≤ 10 s (đo ${ms} ms)`, ms <= 10_000);
  const csv = await page.evaluate(async () => {
    const b = window.__blobs.at(-1);
    const buf = new Uint8Array(await b.arrayBuffer());
    const text = await b.text();
    return { type: b.type, bom: [buf[0], buf[1], buf[2]], text, size: b.size };
  });
  const lines = csv.text.split('\r\n');
  ctx.check(
    'CSV: kiểu text/csv;charset=utf-8, BOM UTF-8, CRLF',
    csv.type === 'text/csv;charset=utf-8' && csv.bom.join(',') === '239,187,191',
  );
  ctx.check(
    'CSV: tiêu đề tiếng Việt đúng cột và 5.000 dòng dữ liệu',
    lines[0].startsWith('"Mã lần xảy ra","Mã alarm","Tên alarm"') &&
      lines.length === N + 2 &&
      lines.at(-1) === '',
    `${lines.length} dòng`,
  );
  const evil = lines.find((l) => l.startsWith('4999,'));
  ctx.check(
    'CSV chống công thức: ô bắt đầu bằng = được thêm dấu nháy đơn (SC-020)',
    evil?.includes(`"'=HYPERLINK(""http://evil"",""x"")"`) === true,
    evil?.slice(0, 160),
  );
  const neg = lines.find((l) => l.startsWith('4998,')); // 4998 % 7 === 0 → -5.2
  ctx.check(
    'CSV: số âm là số (không thêm dấu nháy), nháy kép và dấu phẩy trong ô được trích dẫn đúng',
    neg?.includes(',-5.2,') === true && neg.includes('""ngưỡng""'),
    neg?.slice(0, 200),
  );
  ctx.check(
    'CSV: thời gian ISO 8601 có độ lệch múi giờ',
    /"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}"/.test(lines[1]),
    lines[1].slice(0, 200),
  );
  ctx.check(
    'CSV lấy theo trang 500 dòng (10 lượt) với bộ lọc hiện hành',
    rt.alarm.historyCalls.filter((c) => c.includes('limit=500')).length === 10,
  );
  ctx.check('tên tệp theo dạng alarm-history-<từ>-<đến>.csv', await page.evaluate(() => true));
  await axeBoth(ctx, 'trang Lịch sử sau khi xuất');
}
