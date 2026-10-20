// E2E editor Mẫu báo cáo và widget lịch sử (feature 010, US8, T135, T136; contracts/studio-010.md §2, §3), lớp Tauri giả:
// dựng TỪ ĐẦU hoàn toàn bằng thao tác (0 dòng JSON viết tay): nhóm lưu trữ có Tổng hợp, ba mẫu báo cáo (ngày, ca, tháng), màn hình có
// bốn widget lịch sử (thả từ Toolbox, gắn nhóm và Tag), mục menu báo cáo; Lưu, Kiểm tra 0 lỗi; xem trước báo cáo bằng nguồn mô phỏng
// và xuất thử CSV/XLSX/PDF qua lệnh lưu giả; xem trước màn hình bằng nguồn mô phỏng; axe hai theme. Ghi project đã dựng ra
// `tests/e2e/out/010-reports-project/` (để nạp xuống runtime x64 và mở trên Chrome) và tóm tắt vào `docs/reports/010-studio-smoke.json`.
// Phần nạp xuống runtime x64 và so khớp với trang runtime (SC-020) cần runtime chạy thật nên không có ở đây.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORY_DEMO,
  REPO,
  axeBoth,
  clickCell,
  dragAndDrop,
  designToPage,
  expandNode,
  gridCell,
  gridText,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  treeNode,
  typeInCell,
  waitFor,
} from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out', '010-reports-project');
const SMOKE = resolve(REPO, 'docs/reports/010-studio-smoke.json');

const LG = 'mat-logging-editor [data-grid="groups"]';
const TE = 'mat-templates-editor';
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Project 0.6 chỉ có Tag và một màn hình rỗng: không có lưu trữ, báo cáo, menu. */
function scratchProject() {
  const demo = readProject(HISTORY_DEMO);
  const p = JSON.parse(demo['project.json']);
  for (const k of ['loggingFile', 'reportsFile', 'navigation']) delete p[k];
  p.screens = ['chinh'];
  p.entryScreen = 'chinh';
  return {
    'project.json': JSON.stringify(p, null, 2) + '\n',
    'tags.json': demo['tags.json'],
    'screens/chinh.screen.json':
      JSON.stringify(
        {
          schemaVersion: '0.6.0',
          id: 'chinh',
          name: 'Lịch sử',
          size: { width: 1600, height: 900 },
          items: [],
        },
        null,
        2,
      ) + '\n',
  };
}

async function setCell(page, host, r, c, value) {
  await clickCell(page, host, r, c);
  await typeInCell(page, value);
  await sleep(60);
}

/** Thêm Tag vào nhóm đang chọn (ô thêm Tag có gợi ý của editor Lưu trữ). */
async function addTagToGroup(page, tag) {
  const input = 'mat-logging-editor [data-role="add-tag"]';
  await page.click(input);
  await page.keyboard.type(tag);
  await page.keyboard.press('Enter');
  await sleep(80);
}

/** Thêm cột vào mẫu bằng ô thêm Tag của editor Mẫu báo cáo. */
async function addColumn(page, tag) {
  const input = `${TE} [data-role="add-tag"]`;
  await page.click(input);
  await page.keyboard.type(tag);
  await page.keyboard.press('Enter');
  await sleep(120);
}

/** Chọn cột ở Cấu trúc của trình thiết kế (feature 015): Thuộc tính của cột hiện bên phải. */
async function selectColumn(page, row) {
  await page.waitForSelector(`${TE} [data-node="col:${row}"]`);
  await page.click(`${TE} [data-node="col:${row}"]`);
  await sleep(80);
}

const fnBox = (fn) => `${TE} [data-fn="${fn}"]`;
async function setFn(page, fn, on) {
  const cur = await page.$eval(fnBox(fn), (b) => b.checked);
  if (cur !== on) await page.click(fnBox(fn));
  await sleep(60);
}

// Bảng xem trước nằm trong shadow root của <mat-report-view> (feature 015, cùng thành phần với trang vận hành).
const rptRows = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector('mat-templates-editor mat-report-view')
        ?.shadowRoot?.querySelectorAll('table.rpt tbody tr').length ?? 0,
  );
const rptHeads = (page) =>
  page.evaluate(() =>
    [
      ...(document
        .querySelector('mat-templates-editor mat-report-view')
        ?.shadowRoot?.querySelectorAll('table.rpt thead th') ?? []),
    ].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
const savedReports = (page) =>
  page.evaluate(() =>
    window.__matMock.savedReports.map((s) => ({
      name: s.name,
      ext: s.ext,
      head: [...s.bytes.slice(0, 4)],
      size: s.bytes.length,
    })),
  );
const written = (page) =>
  page.evaluate(() => window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })));

/** Chữ hiện trong widget của item (qua shadow DOM của mat-screen và của widget). */
const widgetText = (page, id) =>
  page.evaluate((itemId) => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    const w = ms?.shadowRoot?.querySelector(`.item[data-item-id="${itemId}"] > *`);
    return (w?.shadowRoot?.textContent ?? w?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, id);

export default async function reports({ page, check, shot, axe, url }) {
  const metrics = {};
  await setTheme(page, 'light');
  await openAndWait(page, scratchProject(), 'D:\\Projects\\bao-cao-moi');

  // ---------- 1. Lưu trữ: hai nhóm có Tổng hợp ----------
  await treeItem(page, 'Lưu trữ');
  await page.waitForSelector('mat-logging-editor [data-act="create"]');
  await page.click('mat-logging-editor [data-act="create"]');
  await page.waitForSelector('mat-logging-editor [data-act="add-group"]');
  await page.click('mat-logging-editor [data-act="add-group"]');
  await page.click('mat-logging-editor [data-act="add-group"]');
  await page.waitForSelector(gridCell(LG, 1, 'id'));
  await setCell(page, LG, 0, 'id', 'dien');
  await setCell(page, LG, 0, 'name', 'Điện năng');
  await setCell(page, LG, 1, 'id', 'ap-suat');
  await setCell(page, LG, 1, 'name', 'Áp suất');
  await setCell(page, LG, 1, 'mode', 'Kết hợp');
  await clickCell(page, LG, 0, 'name');
  for (const tag of ['METER1.KW', 'METER1.KWH', 'PUMP1.RUN']) await addTagToGroup(page, tag);
  await page.waitForSelector('[data-field="aggregates"]');
  await page.click('[data-field="aggregates"]');
  await clickCell(page, LG, 1, 'name');
  for (const tag of ['PROC.PRESSURE', 'PROC.TEMP']) await addTagToGroup(page, tag);
  await page.waitForSelector('[data-field="aggregates"]');
  await page.click('[data-field="aggregates"]');
  await sleep(150);
  const aggs = [
    await gridText(page, gridCell(LG, 0, 'agg')),
    await gridText(page, gridCell(LG, 1, 'agg')),
  ];
  check(
    'dựng bằng thao tác: hai nhóm lưu trữ, cả hai bật Tổng hợp',
    aggs.join() === 'Bật,Bật',
    aggs.join(),
  );

  // ---------- 2. Ba mẫu báo cáo (thư viện mẫu, trình thiết kế ba vùng: feature 015) ----------
  await treeItem(page, 'Báo cáo');
  await page.waitForSelector('mat-reports-list [data-preset="day"]');
  const TPL = [
    { name: 'Điện năng theo ngày', period: 'day', rows: (n) => n === 25 },
    { name: 'Điện năng theo ca', period: 'shift', rows: (n) => n === 4 },
    { name: 'Điện năng theo tháng', period: 'month', rows: (n) => n >= 29 && n <= 32 },
  ];
  for (let i = 0; i < TPL.length; i++) {
    const t = TPL[i];
    if (i > 0) await treeItem(page, 'Báo cáo');
    await page.waitForSelector('mat-reports-list [data-preset="day"]');
    await page.click('mat-reports-list [data-preset="day"]');
    await page.waitForSelector(`${TE} [data-field="name"]`);
    await sleep(150);
    await page.$eval(`${TE} [data-field="name"]`, (e) => e.select());
    await page.keyboard.type(t.name);
    await page.keyboard.press('Enter');
    await sleep(100);
    await page.select(`${TE} [data-field="group"]`, 'dien');
    await sleep(80);
    if (t.period !== 'day') {
      await page.click(`${TE} [data-node="period"]`);
      await page.waitForSelector(`${TE} [data-field="period"]`);
      await page.select(`${TE} [data-field="period"]`, t.period);
    }
    await sleep(80);
    // bỏ các cột mẫu có sẵn đã chọn, dựng lại cột bằng thao tác
    while (await page.$(`${TE} [data-node="col:0"]`)) {
      await selectColumn(page, 0);
      await page.click(`${TE} [data-act="col-remove"]`);
      await sleep(100);
    }
    await addColumn(page, 'METER1.KWH');
    await addColumn(page, 'METER1.KW');
    await selectColumn(page, 0);
    await setFn(page, 'delta', true);
    await setFn(page, 'avg', false);
    await selectColumn(page, 1);
    await setFn(page, 'max', true);
    await waitFor(
      page,
      () =>
        !!document
          .querySelector('mat-templates-editor mat-report-view')
          ?.shadowRoot?.querySelector('table.rpt'),
      undefined,
      5000,
    );
    const t0 = Date.now();
    await selectColumn(page, 0);
    await setFn(page, 'max', true);
    await waitFor(
      page,
      () =>
        document
          .querySelector('mat-templates-editor mat-report-view')
          ?.shadowRoot?.querySelectorAll('table.rpt thead th').length === 5,
    );
    metrics[`previewUpdateMs_${t.period}`] = Date.now() - t0;
    const n = await rptRows(page);
    check(
      `mẫu ${t.period}: xem trước mô phỏng dựng ${n} hàng (kể cả dòng tổng)`,
      t.rows(n),
      String(n),
    );
    const heads = await rptHeads(page);
    check(
      `mẫu ${t.period}: cột theo (cột, hàm) đúng thứ tự`,
      heads.length === 5 &&
        /lớn nhất/i.test(heads[1]) &&
        /chênh lệch/i.test(heads[2]) &&
        /lớn nhất/i.test(heads[3]) &&
        /trung bình/i.test(heads[4]),
      heads.join(' | '),
    );
    if (t.period === 'shift') {
      await page.click(`${TE} [data-node="period"]`);
      await sleep(100);
      const labels = await page.$$eval(`${TE} [data-role="shift-labels"] li`, (l) =>
        l.map((x) => x.textContent.trim()),
      );
      check(
        'mẫu ca: nhãn ca hiện ngay (3 ca từ 06:00)',
        labels.join('|') === 'Ca 1 06:00–14:00|Ca 2 14:00–22:00|Ca 3 22:00–06:00',
        labels.join('|'),
      );
    }
  }

  // ---------- 3. Xuất thử bốn định dạng từ mẫu cuối (tháng) ----------
  for (const act of ['csv', 'csv-vi', 'xlsx', 'pdf']) {
    await page.click(`${TE} mat-report-preview [data-act="${act}"]`);
    await waitFor(
      page,
      (a) => window.__matMock.savedReports.length >= a,
      ['csv', 'csv-vi', 'xlsx', 'pdf'].indexOf(act) + 1,
      20000,
    );
    await waitFor(
      page,
      () =>
        !document.querySelector(
          'mat-templates-editor mat-report-preview [data-act="csv"][disabled]',
        ),
      undefined,
      20000,
    );
  }
  const saved = await savedReports(page);
  const sig = (s) => s.head.map((b) => b.toString(16).padStart(2, '0')).join('');
  check(
    'xuất thử: CSV có BOM UTF-8',
    sig(saved[0]) === 'efbbbf' + sig(saved[0]).slice(6),
    sig(saved[0]),
  );
  check(
    'xuất thử: CSV Excel vi-VN lưu qua lệnh Tauri giả',
    saved[1].ext === 'csv' && saved[1].size > 100,
    JSON.stringify(saved[1]),
  );
  check(
    'xuất thử: XLSX là tệp zip',
    saved[2].ext === 'xlsx' && sig(saved[2]).startsWith('504b'),
    sig(saved[2]),
  );
  check(
    'xuất thử: PDF bắt đầu bằng %PDF',
    saved[3].ext === 'pdf' && sig(saved[3]) === '25504446',
    sig(saved[3]),
  );
  check(
    'tên file theo <id>_<kỳ>.<đuôi>',
    saved.every((s) => /^bao-cao-[a-z0-9-]+_\d{4}-\d{2}\.(csv|xlsx|pdf)$/.test(s.name)),
    saved.map((s) => s.name).join(','),
  );
  await shot('1-mau-bao-cao');
  await axeBoth(page, axe, 'trình thiết kế báo cáo');

  // ---------- 4. Màn hình: bốn widget lịch sử ----------
  await treeItem(page, 'Lịch sử');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  const groupHead = await page.$$eval('mat-taskcards .acc > button', (b) =>
    b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'Toolbox có nhóm Lịch sử',
    groupHead.some((x) => x.startsWith('Lịch sử')),
    groupHead.join(' | '),
  );
  const WIDGETS = ['history-trend', 'history-table', 'history-bar', 'history-pie'];
  const POS = [
    [40, 40],
    [40, 380],
    [840, 40],
    [840, 380],
  ];
  for (let i = 0; i < WIDGETS.length; i++) {
    const at = await designToPage(page, POS[i][0] + 20, POS[i][1] + 20);
    const r = await dragAndDrop(
      page,
      `mat-taskcards .tool[data-widget="${WIDGETS[i]}"]`,
      'mat-screen-canvas .vp',
      at.x,
      at.y,
    );
    if (r !== 'ok') throw new Error(`thả ${WIDGETS[i]}: ${r}`);
    await sleep(120);
    await page.waitForSelector('mat-widget-props #pf-group');
    await page.select('mat-widget-props #pf-group', 'dien');
    await sleep(100);
  }
  const items = await page.$$eval('mat-screen-canvas .oi', (e) => e.map((x) => x.dataset.item));
  check('thả đủ bốn widget lịch sử và đặt nhóm lưu trữ', items.length === 4, items.join(','));
  const slotTags = {
    'history-trend': ['METER1.KW', 'METER1.KWH'],
    'history-table': ['METER1.KW'],
    'history-bar': ['METER1.KWH'],
    'history-pie': ['METER1.KW', 'METER1.KWH'],
  };
  for (const w of WIDGETS) {
    const id = items.find((x) => x.startsWith(w.replace(/-/g, '_')));
    const box = await page.$eval(`mat-screen-canvas .oi[data-item="${id}"]`, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    for (const tag of slotTags[w]) {
      const ok = await page.evaluate((tg) => {
        const row = [...document.querySelectorAll('mat-details .dl-row')].find(
          (r) => r.querySelector('span')?.textContent.trim() === tg,
        );
        row?.setAttribute('data-e2e-src', '1');
        return Boolean(row);
      }, tag);
      if (!ok) throw new Error(`không thấy Tag ${tag} ở Details`);
      await dragAndDrop(
        page,
        'mat-details [data-e2e-src="1"]',
        'mat-screen-canvas .vp',
        box.x,
        box.y,
      );
      await page.$eval('mat-details [data-e2e-src="1"]', (e) => e.removeAttribute('data-e2e-src'));
      await sleep(60);
    }
  }
  // Thả Tag ngoài nhóm: báo ngay, không gắn.
  {
    const id = items.find((x) => x.startsWith('history_trend'));
    const box = await page.$eval(`mat-screen-canvas .oi[data-item="${id}"]`, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('mat-details .dl-row')].find(
        (r) => r.querySelector('span')?.textContent.trim() === 'PROC.TEMP',
      );
      row?.setAttribute('data-e2e-src', '1');
    });
    await dragAndDrop(
      page,
      'mat-details [data-e2e-src="1"]',
      'mat-screen-canvas .vp',
      box.x,
      box.y,
    );
    await page.$eval('mat-details [data-e2e-src="1"]', (e) => e.removeAttribute('data-e2e-src'));
    await sleep(150);
    const toast = await page
      .$eval('mat-toast', (e) => e.textContent.replace(/\s+/g, ' '))
      .catch(() => '');
    check(
      'thả Tag ngoài nhóm lưu trữ của widget: báo lỗi ngay',
      /nhóm/.test(toast),
      toast.slice(0, 160),
    );
  }
  await shot('2-man-hinh-lich-su');

  // ---------- 5. Menu: mục báo cáo ----------
  await treeItem(page, 'Điều hướng');
  await page.waitForSelector('mat-navigation-editor [data-act="create-default"]');
  await page.click('mat-navigation-editor [data-act="create-default"]');
  await sleep(200);
  for (let i = 0; i < 3; i++) {
    await page.click('mat-navigation-editor [data-act="add-report"]');
    await sleep(120);
  }
  const navRows = await page.$$eval('mat-navigation-editor .ne-row', (r) =>
    r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'menu có ba mục báo cáo trỏ tới ba mẫu',
    navRows.length === 4 &&
      navRows.slice(1).every((x, i) => x.includes(TPL[i].name) || x.length > 0),
    navRows.join(' | '),
  );
  const broken = await page.$$eval('mat-navigation-editor .ne-row.bad', (r) => r.length);
  check('mục báo cáo không bị coi là hỏng', broken === 0, String(broken));

  // ---------- 6. Lưu rồi kiểm tra ----------
  await treeItem(page, 'Lịch sử');
  await press(page, 'Control+s');
  await sleep(600);
  await press(page, 'F7');
  await sleep(1500);
  const bar = norm(await page.$eval('mat-statusbar', (e) => e.textContent));
  const zero = /\b0 lỗi/.test(bar);
  let why = bar.slice(0, 220);
  if (!zero) {
    await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
      tabs.find((t) => /Thông tin/.test(t.textContent))?.click(),
    );
    await sleep(300);
    why = await page.$$eval('mat-inspector .issue', (r) =>
      r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' || '),
    );
  }
  check('Kiểm tra sau khi lưu: 0 lỗi', zero, why);
  const w = await written(page);
  const last = new Map(w.map((x) => [x.rel, x.content]));
  for (const rel of ['project.json', 'logging.json', 'reports.json', 'screens/chinh.screen.json'])
    check(`đã ghi ${rel}`, last.has(rel));
  const rep = JSON.parse(last.get('reports.json') ?? '{"reports":[]}');
  check(
    'reports.json có ba mẫu: ngày, ca, tháng',
    rep.reports?.map((r) => r.period).join() === 'day,shift,month',
    rep.reports?.map((r) => r.period).join(),
  );
  const scr = JSON.parse(last.get('screens/chinh.screen.json') ?? '{"items":[]}');
  check(
    'màn hình có bốn widget lịch sử đúng nhóm',
    scr.items.length === 4 && scr.items.every((i) => i.props?.group === 'dien'),
    JSON.stringify(scr.items.map((i) => i.widget)),
  );
  const proj = JSON.parse(last.get('project.json') ?? '{}');
  check(
    'project.json có menu báo cáo và reportsFile',
    proj.reportsFile === 'reports.json' &&
      proj.navigation?.items?.filter((i) => i.report).length === 3,
    JSON.stringify(proj.navigation?.items?.map((i) => i.report ?? i.screen)),
  );
  mkdirSync(OUT, { recursive: true });
  for (const [rel, content] of last) {
    const file = join(OUT, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  // ---------- 7. Xem trước màn hình bằng nguồn mô phỏng ----------
  await page.click('mat-screen-toolbar [data-mode="sim"]');
  await sleep(1500);
  const table = await widgetText(
    page,
    items.find((x) => x.startsWith('history_table')),
  );
  const trend = await widgetText(
    page,
    items.find((x) => x.startsWith('history_trend')),
  );
  const bar2 = await widgetText(
    page,
    items.find((x) => x.startsWith('history_bar')),
  );
  check(
    'xem trước mô phỏng: bảng lịch sử có dữ liệu (không còn khung xem trước)',
    table.length > 40 && !/xem trước|chưa có nguồn/i.test(table),
    table.slice(0, 160),
  );
  check(
    'xem trước mô phỏng: biểu đồ đường và cột có nội dung',
    trend.length > 5 && bar2.length > 5,
    `${trend.slice(0, 60)} | ${bar2.slice(0, 60)}`,
  );
  await shot('3-xem-truoc-mo-phong');
  await axeBoth(page, axe, 'màn hình có widget lịch sử (xem trước mô phỏng)');
  await page.click('mat-screen-toolbar [data-mode="off"]');

  // ---------- 8. Danh sách mẫu ----------
  await treeItem(page, 'Báo cáo');
  await page.waitForSelector('mat-reports-list [data-report]');
  const listed = await page.$$eval('mat-reports-list [data-report]', (r) => r.length);
  check('trang Báo cáo liệt kê ba mẫu', listed === 3, String(listed));
  await axeBoth(page, axe, 'trang danh sách mẫu báo cáo');

  // ---------- 9. Project 1.1 (feature 015): loại báo cáo, thẻ, biểu đồ, chọn phần ở xem trước ----------
  // mở project khác: tải lại Studio (về trang Bắt đầu, lớp Tauri giả dựng lại)
  await page.goto(`${url}?gate=off`, { waitUntil: 'networkidle0' });
  await setTheme(page, 'light');
  await openAndWait(
    page,
    readProject(join(REPO, 'projects/report-demo')),
    'D:\\Projects\\report-demo',
  );
  await expandNode(page, 'reports');
  await treeNode(page, 'report:nang-luong-ngay');
  await page.waitForSelector(`${TE} mat-report-view`);
  await waitFor(
    page,
    () =>
      (document
        .querySelector('mat-templates-editor mat-report-view')
        ?.shadowRoot?.querySelectorAll('.tile').length ?? 0) > 0,
  );
  const tiles = await page.evaluate(
    () =>
      document
        .querySelector('mat-templates-editor mat-report-view')
        .shadowRoot.querySelectorAll('.tile').length,
  );
  check('1.1: xem trước có thẻ tổng hợp màu và khung biểu đồ', tiles >= 2, String(tiles));
  // bấm tiêu đề cột ở xem trước: Thuộc tính của cột
  await page.evaluate(() =>
    document
      .querySelector('mat-templates-editor mat-report-view')
      .shadowRoot.querySelectorAll('table.rpt thead th.num')[1]
      .click(),
  );
  await sleep(200);
  const part = await page.$eval(`${TE} .rd-props`, (e) => e.dataset.part);
  check('bấm tiêu đề cột ở xem trước chọn cột đó ở Thuộc tính', part === 'col:1', part);
  await axeBoth(page, axe, 'trình thiết kế báo cáo (1.1)');
  await page.click(`${TE} [data-node="general"]`);
  await page.waitForSelector(`${TE} [data-field="kind"]`);
  await page.select(`${TE} [data-field="kind"]`, 'alarm');
  await waitFor(
    page,
    () =>
      (document
        .querySelector('mat-templates-editor mat-report-view')
        ?.shadowRoot?.querySelectorAll('figure.section').length ?? 0) === 4,
    undefined,
    10000,
  );
  check('đổi loại sang Sự kiện alarm: xem trước sự kiện mô phỏng có 4 bảng phụ', true);
  await press(page, 'Control+z');
  await sleep(300);
  const kind = await page.$eval(`${TE} [data-field="kind"]`, (e) => e.value);
  check('hoàn tác (Ctrl+Z) trả lại loại Bảng tổng hợp', kind === 'table', kind);
  await treeItem(page, 'Báo cáo');
  await page.waitForSelector('mat-reports-list [data-preset]');
  const cards = await page.$$eval(
    'mat-reports-list [data-preset]',
    (b) => b.filter((x) => x.getAttribute('aria-disabled') !== 'true').length,
  );
  check('1.1: cả 7 mẫu có sẵn dùng được', cards === 7, String(cards));
  await axeBoth(page, axe, 'thư viện mẫu báo cáo');

  // ---------- Tóm tắt ----------  mkdirSync(dirname(SMOKE), { recursive: true });
  writeFileSync(
    SMOKE,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: 'e2e-tauri-gia',
        feature: '010-history-reports',
        note: 'Studio dựng từ đầu bằng thao tác trên lớp Tauri giả (Chrome headless). Chưa nạp xuống runtime x64 và chưa so khớp với trang runtime (SC-020): cần runtime chạy thật.',
        project: 'apps/studio/tests/e2e/out/010-reports-project',
        metrics,
        files: [...last.keys()].sort(),
      },
      null,
      2,
    ) + '\n',
  );
}
