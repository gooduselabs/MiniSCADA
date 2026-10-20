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
import { demoReports, reportAlarmHistory, reportLogicEvents } from './history-projects.mjs';
import {
  lastMonth31,
  lastShiftDay,
  refReport,
  refText,
  viNumber,
  yesterday,
} from './report-ref.mjs';
import { axeBoth, sleep, until, waitDeep } from './util.mjs';

export const options = {
  project: 'reports',
  history: {},
  alarmHistory: () => reportAlarmHistory(),
  logicEvents: () => reportLogicEvents(),
};

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

// Feature 015: bảng nằm trong shadow root của <mat-report-view> (cùng thành phần với xem trước Studio).
const readTable = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('mat-report-view').shadowRoot;
    const t = v.querySelector('table.rpt');
    const txt = (c) => c.textContent.trim();
    return {
      head: [...t.tHead.rows[0].cells].map(txt),
      rows: [...t.tBodies[0].rows].map((r) => ({
        total: r.classList.contains('total'),
        label: txt(r.cells[0]),
        cells: [...r.cells].slice(1).map(txt),
      })),
      coverage: v.querySelector('.coverage')?.textContent ?? '',
      tiles: v.querySelectorAll('.tile').length,
      chartTitle: v.querySelector('.chart .head')?.textContent ?? '',
      chartSvg: v.querySelectorAll('.chart .ec svg').length,
      sections: [...v.querySelectorAll('figure.section .head')].map(txt),
    };
  });

const reportBusy = (page) =>
  page.evaluate(
    () =>
      !document.querySelector('mat-report-view')?.shadowRoot?.querySelector('table.rpt') ||
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
    const csvHead = csv.findIndex((l) => l.startsWith('Thời gian'));
    let csvBad = 0;
    bodyRows.forEach((r, i) => {
      const cols = csv[csvHead + 1 + i].split(',');
      if (cols[0] !== (r.total ? 'Tổng' : r.label)) csvBad++;
      r.cells.forEach((c, k) => {
        if (Number(cols[k + 1]) !== viNumber(c)) csvBad++;
      });
    });
    ctx.check(`${id}: CSV chuẩn khớp từng ô của bảng`, csvBad === 0, `${csvBad} ô lệch`);
    // CSV Excel vi-VN
    const csvVi = files.csvVi.bytes.toString('utf8').replace(/^FEFF/, '').split('\r\n');
    const viHead = csvVi.findIndex((l) => l.startsWith('Thời gian'));
    let viBad = 0;
    bodyRows.forEach((r, i) => {
      const cols = csvVi[viHead + 1 + i].split(';');
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
  await page.focus('#rpt-d');
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
    (await page.evaluate(
      () => document.activeElement?.shadowRoot?.activeElement?.getAttribute('role') ?? '',
    )) === 'region',
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
    th: [...document.querySelector('mat-report-view').shadowRoot.querySelectorAll('table.rpt th')]
      .map((t) => t.textContent)
      .join('|'),
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

  // ---- feature 015: bố cục mới (thẻ, khung biểu đồ, hàng tổng), tuần, thiết bị, alarm, logic ----
  const shot = await (async () => {
    await openReport(ctx, 'dien-ngay', day, false);
    return readTable(page);
  })();
  ctx.check(
    '015: báo cáo ngày có thẻ tổng hợp, khung biểu đồ có tiêu đề và hình SVG',
    shot.tiles >= 2 && shot.chartTitle.length > 0,
    JSON.stringify({ tiles: shot.tiles, chart: shot.chartTitle }),
  );
  await until(
    async () =>
      page.evaluate(
        () =>
          document.querySelector('mat-report-view').shadowRoot.querySelectorAll('.chart .ec svg')
            .length > 0,
      ),
    'ECharts vẽ biểu đồ',
    15000,
  );
  ctx.check('015: biểu đồ ECharts (SVG) đã vẽ', true);

  const openSel = async (id, query) => {
    await page.evaluate((h) => (window.location.hash = h), `#/report/${id}?${query}`);
    await waitDeep(page, 'h2', 1).catch(() => undefined);
    await until(async () => !(await reportBusy(page)), `bảng ${id}`, 30000);
    return readTable(page);
  };
  const week = await page.evaluate(() => {
    const d = new Date(Date.now() - 7 * 86400000);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const n = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `${y}-W${String(n).padStart(2, '0')}`;
  });
  const wk = await openSel('dien-tuan', `w=${week}`);
  ctx.check(
    `015: báo cáo tuần ${week}: 7 hàng (T2…CN) và dòng tổng`,
    wk.rows.filter((r) => !r.total).length === 7 &&
      wk.rows[0].label.startsWith('T2') &&
      wk.rows.some((r) => r.total),
    JSON.stringify(wk.rows.map((r) => r.label)),
  );
  const eq = await openSel('van-hanh-bom', `d=${shiftDay}`);
  ctx.check(
    '015: báo cáo vận hành bơm: 3 ca, cột giờ chạy và số lần bật có số',
    eq.rows.filter((r) => !r.total).length === 3 &&
      eq.head.some((h) => h.includes('thời gian ON')) &&
      eq.head.some((h) => h.includes('số lần bật')) &&
      eq.rows.every((r) => r.cells.every((c) => /^[\d.,]+$/.test(c))),
    JSON.stringify(eq),
  );
  const al = await openSel('alarm-ngay', `d=${day}`);
  ctx.check(
    '015: báo cáo alarm: 24 hàng, 4 bảng phụ (mức, khu, top 10, danh sách), không có "Dữ liệu đủ"',
    al.rows.filter((r) => !r.total).length === 24 &&
      al.sections.length === 4 &&
      !al.coverage &&
      Number(al.rows.find((r) => r.total).cells[0]) > 0,
    JSON.stringify({ sections: al.sections, total: al.rows.at(-1) }),
  );
  await axeBoth(ctx, 'báo cáo alarm');
  const n3 = await downloads(page);
  await page.click('.rpt-bar button.pdf');
  const alPdf = await pdfText((await takeDownload(page, n3)).bytes);
  ctx.check(
    '015: PDF báo cáo alarm có tên đơn vị, bảng phụ và danh sách sự kiện',
    alPdf.includes('NHÀ MÁY NƯỚC BÌNH AN') &&
      alPdf.includes('Top 10 alarm') &&
      alPdf.includes('Mức bồn B1 cao'),
    alPdf.slice(0, 300),
  );
  const lg = await openSel('logic-ngay', `d=${day}`);
  ctx.check(
    '015: báo cáo logic: 24 lệnh ghi hôm qua, theo luật, danh sách',
    lg.rows.find((r) => r.total)?.cells.reduce((a, c) => a + Number(c), 0) === 24 &&
      lg.sections.length === 2,
    JSON.stringify(lg.rows.at(-1)),
  );
  await axeBoth(ctx, 'báo cáo logic');
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
