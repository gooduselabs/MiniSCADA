/* global window, document, HTMLAnchorElement, FileReader */
// e2e trang báo cáo (feature 010, T105, T106; SC-015, SC-016, SC-017 phần giao diện, SC-020 của 007) trên runtime GIẢ
// (history-fake.mjs, dữ liệu tất định mỗi phút, tháng 31 ngày dựng sẵn bằng công thức). Kiểm: ba mẫu của history-demo
// (ngày, ca, tháng) và mẫu tháng 12 cột: 100 % ô khớp tham chiếu ĐỘC LẬP tools/history-ref (ô nào cũng so chữ, so số
// trong nửa đơn vị làm tròn); CSV (hai kiểu), XLSX, PDF khớp từng ô với bảng trên màn hình; không gọi runtime khi dựng
// file; thời gian dựng tháng 12 cột ≤ 5 s; tên mẫu/nhãn chứa HTML hiện dạng chữ, không chạy mã; bàn phím; axe sáng/tối.
// Số đo ghi docs/reports/010-reports-fake.json (số với runtime x64 thật: chờ runtime, 010-reports-x64.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { demoReports } from './history-projects.mjs';
import {
  lastMonth31,
  lastShiftDay,
  refReport,
  refText,
  viNumber,
  yesterday,
} from './report-ref.mjs';
import { axeBoth, sleep, until, waitDeep } from './util.mjs';

export const options = { project: 'reports', history: {} };

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const unxml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

async function login(ctx, user = 'xem1', pass = 'view-pass') {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập');
}

/** Bắt file tải về: chặn `a.click()` của trang, đọc Blob, lưu vào window.__dl (dataURL). */
async function hookDownloads(page) {
  await page.evaluateOnNewDocument(() => {
    window.__dl = [];
    const blobs = new Map();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = create(b);
      blobs.set(u, b);
      return u;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const b = this.download ? blobs.get(this.href) : null;
      if (!b) return click.call(this);
      const name = this.download;
      const r = new FileReader();
      r.onload = () => window.__dl.push({ name, type: b.type, data: String(r.result) });
      r.readAsDataURL(b);
    };
  });
}
const downloads = (page) => page.evaluate(() => window.__dl.length);
async function takeDownload(page, before) {
  await until(async () => (await downloads(page)) > before, 'tải file', 30000);
  const d = await page.evaluate((i) => window.__dl[i], before);
  return { name: d.name, type: d.type, bytes: Buffer.from(d.data.split(',')[1], 'base64') };
}

const readTable = (page) =>
  page.$eval('table.rpt', (t) => ({
    head: [...t.tHead.rows[0].cells].map((c) => c.textContent),
    rows: [...t.tBodies[0].rows].map((r) => ({
      total: r.classList.contains('total'),
      label: r.cells[0].textContent,
      cells: [...r.cells].slice(1).map((c) => c.textContent),
    })),
    coverage: document.querySelector('.coverage')?.textContent ?? '',
  }));

const reportBusy = (page) =>
  page.evaluate(
    () =>
      !document.querySelector('table.rpt') ||
      document.querySelector('.rpt-out [role="status"]') !== null,
  );

async function openReport(ctx, id, key, isMonth) {
  const { page } = ctx;
  await page.evaluate(
    (h) => {
      window.location.hash = h;
    },
    `#/report/${id}?${isMonth ? 'm' : 'd'}=${key}`,
  );
  await waitDeep(page, 'h2', 1).catch(() => undefined);
  await until(async () => !(await reportBusy(page)), `bảng báo cáo ${id}`, 30000);
}

/** Đọc XLSX: { rows: [{ r, cells: [{ col, text|num }] }] }. */
function readXlsx(bytes) {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['xl/worksheets/sheet1.xml']);
  const rows = [];
  for (const m of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/gs)) {
    const cells = [];
    for (const c of m[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
      const body = c[3] ?? '';
      const t = /<t[^>]*>(.*?)<\/t>/s.exec(body);
      const v = /<v>(.*?)<\/v>/s.exec(body);
      cells.push(t ? { text: unxml(t[1]) } : v ? { num: Number(v[1]) } : { text: '' });
    }
    rows.push({ r: Number(m[1]), cells });
  }
  return { rows, xml };
}

async function pdfText(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return norm(text.join(' '));
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không có openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 429', 'status of 403');
  const measures = {};
  const templates = new Map(demoReports().reports.map((t) => [t.id, t]));
  const day = yesterday();
  const shiftDay = lastShiftDay();
  const month = lastMonth31();
  await hookDownloads(page);
  await page.goto(`${ctx.httpsUrl}/#/report/dien-ngay?d=${day}`, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'h2', 1).catch(() => undefined);
  await login(ctx);

  // ---- Chưa đăng nhập đã kiểm ở history.e2e; ở đây: mỗi mẫu so 100 % ô với tham chiếu ----
  const cases = [
    ['dien-ngay', { d: day }, false],
    ['dien-ca', { d: shiftDay }, false],
    ['dien-thang', { m: month }, true],
    ['thang-12c', { m: month }, true],
  ];
  let totalCells = 0;
  let badCells = 0;
  let maxRel = 0;
  for (const [id, sel, isMonth] of cases) {
    const tpl = templates.get(id);
    await openReport(ctx, id, isMonth ? sel.m : sel.d, isMonth);
    const screen = await readTable(page);
    const { table } = refReport(tpl, sel);
    ctx.check(
      `${id}: số hàng và cột khớp tham chiếu (${table.rows.length} hàng, ${table.columns.length} cột)`,
      screen.rows.filter((r) => !r.total).length === table.rows.length &&
        screen.head.length === table.columns.length + 1,
      JSON.stringify([screen.rows.length, screen.head.length]),
    );
    let bad = 0;
    let cells = 0;
    table.rows.forEach((r, i) => {
      const s = screen.rows[i];
      if (!s || s.label !== r.label) bad++;
      r.cells.forEach((v, k) => {
        cells++;
        const dec = table.columns[k].decimals;
        const want = refText(v, dec);
        const got = s?.cells[k];
        if (got !== want) bad++;
        else if (v !== null) {
          const rel = Math.abs(viNumber(got) - v) / Math.max(1, Math.abs(v));
          // sai số do làm tròn hiển thị ≤ nửa đơn vị cuối
          if (Math.abs(viNumber(got) - v) > 0.5 * 10 ** -dec + 1e-9) bad++;
          maxRel = Math.max(maxRel, rel);
        }
      });
    });
    const tot = screen.rows.find((r) => r.total);
    if (table.totals) {
      table.totals.forEach((v, k) => {
        cells++;
        if (tot?.cells[k] !== refText(v, table.columns[k].decimals)) bad++;
      });
    }
    totalCells += cells;
    badCells += bad;
    ctx.check(
      `${id}: ${cells} ô (kể cả dòng tổng) khớp tham chiếu độc lập 100 %`,
      bad === 0,
      `${bad} ô lệch`,
    );
    ctx.check(`${id}: độ phủ dữ liệu 100,0 %`, screen.coverage.includes('100,0'), screen.coverage);

    // ---- Xuất file: không gọi runtime, khớp từng ô với bảng trên màn hình (SC-016, SC-017) ----
    const req0 = rt.log.requests.length;
    const files = {};
    for (const [cls, key] of [
      ['csv', 'csv'],
      ['csv-vi', 'csvVi'],
      ['xlsx', 'xlsx'],
      ['pdf', 'pdf'],
    ]) {
      const n = await downloads(page);
      const t0 = Date.now();
      await page.click(`.rpt-bar button.${cls}`);
      files[key] = await takeDownload(page, n);
      measures[`${id}.${key}.ms`] = Date.now() - t0;
    }
    const during = rt.log.requests.slice(req0).filter((r) => r.includes('/api/v1/history/'));
    ctx.check(
      `${id}: dựng CSV, XLSX, PDF không gọi API lịch sử (0 yêu cầu)`,
      during.length === 0,
      during.join(' | '),
    );
    ctx.check(
      `${id}: tên file theo mẫu và kỳ`,
      Object.values(files).every(
        (f) => f.name.startsWith(id) && f.name.includes(isMonth ? sel.m : sel.d),
      ),
      Object.values(files)
        .map((f) => f.name)
        .join(', '),
    );

    const bodyRows = screen.rows;
    // CSV chuẩn
    const csv = files.csv.bytes.toString('utf8').replace(/^FEFF/, '').split('\r\n');
    let csvBad = 0;
    bodyRows.forEach((r, i) => {
      const cols = csv[3 + i].split(',');
      if (cols[0] !== (r.total ? 'Tổng' : r.label)) csvBad++;
      r.cells.forEach((c, k) => {
        if (Number(cols[k + 1]) !== viNumber(c)) csvBad++;
      });
    });
    ctx.check(`${id}: CSV chuẩn khớp từng ô của bảng`, csvBad === 0, `${csvBad} ô lệch`);
    // CSV Excel vi-VN
    const csvVi = files.csvVi.bytes.toString('utf8').replace(/^FEFF/, '').split('\r\n');
    let viBad = 0;
    bodyRows.forEach((r, i) => {
      const cols = csvVi[3 + i].split(';');
      r.cells.forEach((c, k) => {
        if (cols[k + 1] !== c.replace(/\./g, '')) viBad++;
      });
    });
    ctx.check(`${id}: CSV Excel (vi-VN) khớp từng ô của bảng`, viBad === 0, `${viBad} ô lệch`);
    // XLSX
    const { rows: xr } = readXlsx(files.xlsx.bytes);
    let xBad = 0;
    bodyRows.forEach((r) => {
      const row = xr.find((x) => x.cells[0]?.text === (r.total ? 'Tổng' : r.label));
      if (!row) return void xBad++;
      r.cells.forEach((c, k) => {
        const cell = row.cells[k + 1];
        if (cell?.num === undefined || Math.abs(cell.num - viNumber(c)) > 1e-9) xBad++;
      });
    });
    ctx.check(`${id}: XLSX khớp từng ô của bảng (ô số là số)`, xBad === 0, `${xBad} ô lệch`);
    // PDF
    const text = await pdfText(files.pdf.bytes);
    // Mọi nhãn hàng có trong PDF và số lần xuất hiện của từng giá trị ô trong PDF ≥ trong bảng (trích chữ PDF không
    // giữ thứ tự cột khi bảng rộng, nên so theo tập; bảng ≤ 8 cột còn so cả thứ tự trong hàng).
    const want = new Map();
    for (const r of bodyRows) for (const c of r.cells) want.set(c, (want.get(c) ?? 0) + 1);
    const have = new Map();
    for (const tok of text.split(' ')) have.set(tok, (have.get(tok) ?? 0) + 1);
    let pBad = bodyRows.filter((r) => !r.total && !text.includes(norm(r.label))).length;
    const missing = [];
    for (const [c, k] of want)
      if ((have.get(c) ?? 0) < k) {
        pBad++;
        missing.push(`${c} (${have.get(c) ?? 0}/${k})`);
      }
    if (screen.head.length <= 9)
      for (const r of bodyRows)
        if (!text.includes(norm(`${r.total ? 'Tổng' : r.label} ${r.cells.join(' ')}`))) pBad++;
    ctx.check(
      `${id}: PDF có mọi nhãn hàng và mọi ô của bảng (${want.size} giá trị khác nhau)`,
      pBad === 0,
      `${pBad} lệch: ${missing.slice(0, 8).join(', ')}; hàng đầu PDF: ${text.slice(text.indexOf(bodyRows[0].label), text.indexOf(bodyRows[1].label))}; bảng: ${bodyRows[0].cells.join(' ')}`,
    );
    ctx.check(
      `${id}: PDF có đầu "%PDF-"`,
      files.pdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-',
    );

    // ---- Thời gian dựng bảng (bấm Xem tới khi có bảng) ----
    const t0 = Date.now();
    await page.click('.rpt-bar button.view');
    await sleep(20);
    await until(async () => !(await reportBusy(page)), 'dựng lại', 30000);
    measures[`${id}.buildMs`] = Date.now() - t0;
  }
  ctx.check(
    `tổng ${totalCells} ô của 4 mẫu khớp tham chiếu độc lập (SC-015), lệch tương đối lớn nhất do làm tròn ${maxRel.toExponential(1)}`,
    badCells === 0,
    `${badCells} ô lệch`,
  );
  ctx.check(
    `thời gian dựng báo cáo tháng 12 cột ≤ 5 s (đo ${measures['thang-12c.buildMs']} ms)`,
    measures['thang-12c.buildMs'] <= 5000,
  );

  // ---- Bàn phím (T106): kỳ -> Xem -> bốn nút xuất, Enter kích hoạt ----
  await openReport(ctx, 'dien-ngay', day, false);
  await page.focus('#rpt-period');
  const order = [];
  // ô ngày/tháng của trình duyệt có nhiều đoạn con: Tab tới khi vào nút Xem, rồi ghi bốn nút xuất và vùng bảng
  for (let i = 0; i < 12 && !order.length; i++) {
    await page.keyboard.press('Tab');
    const c = await page.evaluate(() => document.activeElement?.className ?? '');
    if (c.includes('view')) order.push(c);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.className ?? ''));
  }
  ctx.check(
    'bàn phím: Tab đi qua Xem, CSV, CSV Excel, XLSX, PDF theo thứ tự',
    ['view', 'csv', 'csv-vi', 'xlsx', 'pdf'].every((c, i) => order[i]?.includes(c)),
    order.join(' > '),
  );
  ctx.check(
    'bàn phím: sau nút PDF tới vùng cuộn của bảng (tabindex 0)',
    (await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '')) === 'region',
    order[5],
  );
  const n = await downloads(page);
  await page.focus('.rpt-bar button.csv');
  await page.keyboard.press('Enter');
  await takeDownload(page, n);
  ctx.check('bàn phím: Enter ở nút CSV tải được file', true);
  await axeBoth(ctx, 'trang báo cáo có bảng');

  // ---- An toàn: tên mẫu và nhãn cột chứa HTML hiện dạng chữ (T106) ----
  await openReport(ctx, 'doc-hai', day, false);
  const safe = await page.evaluate(() => ({
    h2: document.querySelector('.page-pane h2')?.textContent,
    th: [...document.querySelectorAll('table.rpt th')].map((t) => t.textContent).join('|'),
    pwn: window.__pwn ?? null,
    img: document.querySelectorAll('img[src="x"], .page-pane script').length,
    nav: [...document.querySelectorAll('#app-nav button')].map((b) => b.textContent).join('|'),
  }));
  ctx.check(
    'tên mẫu chứa <script> hiện nguyên chữ trên tiêu đề',
    safe.h2?.includes('<script>window.__pwn=1</script>'),
    safe.h2,
  );
  ctx.check(
    'nhãn cột chứa <img onerror> hiện nguyên chữ, không tạo phần tử, không chạy mã',
    safe.th.includes('<img src=x onerror="window.__pwn=2">') && safe.img === 0 && safe.pwn === null,
    JSON.stringify(safe),
  );
  const n2 = await downloads(page);
  await page.click('.rpt-bar button.xlsx');
  const hostile = await takeDownload(page, n2);
  const hx = readXlsx(hostile.bytes);
  ctx.check(
    'XLSX của mẫu độc hại: nhãn được thoát XML (không có thẻ <img> thô)',
    !hx.xml.includes('<img') && hx.xml.includes('&lt;img'),
  );
  await axeBoth(ctx, 'trang báo cáo tên độc hại');

  mkdirSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/reports'), {
    recursive: true,
  });
  writeFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/reports/010-reports-fake.json'),
    JSON.stringify(
      {
        note: 'Đo trên runtime GIẢ (tests/e2e/history-fake.mjs) với Chrome headless; so với tham chiếu độc lập tools/history-ref. Số với runtime x64 thật: chờ runtime (010-reports-x64.json).',
        date: new Date().toISOString(),
        day,
        month,
        cellsCompared: totalCells,
        cellsMismatched: badCells,
        maxRelativeRoundingDiff: maxRel,
        measures,
      },
      null,
      2,
    ) + '\n',
  );
}
