// E2E hộp thoại Nhập SVG (feature 008, T059, FR-011, SC-015): lớp Tauri giả có `svg_open` (window.__matMock.svgOpenResult),
// nhập từng loại fixture (4 file Inkscape thật, 3 Illustrator và 3 CorelDRAW mô phỏng), báo cáo hiện đúng mục, Lưu báo cáo,
// Hủy không đổi project, Nhập rồi Ctrl+Z / Ctrl+Y, file quá lớn và DTD bị từ chối đúng thông báo, nhập bằng bàn phím hoàn toàn,
// trang không lỗi console, axe 0 vi phạm critical/serious ở hai theme (xem trước, từ chối). Chrome headless.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DASHBOARD_DEMO,
  REPO,
  axeBoth,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const FIXTURES = resolve(REPO, 'tests/fixtures/svg-import');
const manifest = JSON.parse(readFileSync(resolve(FIXTURES, 'manifest.json'), 'utf8'));

/** Project 0.3 chỉ có một màn hình rỗng (như screen-build). */
function emptyProject() {
  const src = readProject(DASHBOARD_DEMO);
  const project = JSON.parse(src['project.json']);
  project.screens = ['chinh'];
  project.entryScreen = 'chinh';
  delete project.navigation;
  const files = {
    'project.json': JSON.stringify(project, null, 2) + '\n',
    'tags.json': src['tags.json'],
    'connections.json': src['connections.json'],
  };
  for (const [rel, text] of Object.entries(src))
    if (rel.startsWith('value-tables/')) files[rel] = text;
  files['screens/chinh.screen.json'] =
    JSON.stringify(
      {
        schemaVersion: '0.3.0',
        id: 'chinh',
        name: 'Chính',
        size: { width: 1920, height: 1080 },
        items: [],
      },
      null,
      2,
    ) + '\n';
  return files;
}

const setFile = (page, name, bytes) =>
  page.evaluate(
    (n, b) => {
      window.__matMock.svgOpenResult = { name: n, bytes: new Uint8Array(b) };
    },
    name,
    Array.from(bytes),
  );
const setError = (page, error) =>
  page.evaluate((e) => {
    window.__matMock.svgOpenResult = { error: e };
  }, error);
const itemCount = (page) => page.$$eval('mat-screen-canvas .oi', (e) => e.length);
const written = (page) =>
  page.evaluate(() => window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })));
const dialogGone = (page) =>
  waitFor(page, () => !document.querySelector('mat-import-svg-dialog [role="dialog"]'));
const dialogReady = (page) =>
  waitFor(
    page,
    () =>
      document.querySelector('mat-import-svg-dialog [data-role="ok"]:not([disabled])') ||
      document.querySelector('mat-import-svg-dialog [data-role="rejected"]'),
    undefined,
    15000,
  );

/** Mở hộp thoại bằng phím tắt rồi chờ xem trước (hoặc từ chối). */
async function openDialog(page) {
  await press(page, 'Control+Shift+I');
  await page.waitForSelector('mat-import-svg-dialog [role="dialog"]');
  await dialogReady(page);
}

/** Mã của cả ba tab báo cáo và số ở huy hiệu của từng tab. */
async function reportSummary(page) {
  const out = { codes: new Set(), badges: {} };
  for (const tab of ['removed', 'converted', 'warnings']) {
    await page.$eval(`mat-import-report button[data-tab="${tab}"]`, (b) => b.click());
    await sleep(40);
    const r = await page.evaluate(() => {
      const table = document.querySelector('mat-import-report [data-role="rep-table"]');
      const heads = [...table.querySelectorAll('th')].map((t) => t.textContent.trim());
      const col = heads.findIndex((h) => h === 'Mã');
      const codes = [...table.querySelectorAll('tbody tr')]
        .map((tr) => tr.children[col]?.textContent.trim())
        .filter((c) => c && /^[A-Z]_/.test(c));
      const badge = document
        .querySelector(`mat-import-report button[data-tab="${table.dataset.tab}"] .badge`)
        ?.textContent.trim();
      return { codes, badge: Number(badge) };
    });
    r.codes.forEach((c) => out.codes.add(c));
    out.badges[tab] = r.badge;
  }
  await page.$eval('mat-import-report button[data-tab="removed"]', (b) => b.click());
  return out;
}

export default async function importE2e({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, emptyProject(), 'D:\\Projects\\dashboard-moi');
  await treeItem(page, 'Chính');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  check('màn hình rỗng: canvas không có item', (await itemCount(page)) === 0);

  // ---------- 1. Từng loại fixture: xem trước, báo cáo đúng mục, Hủy không đổi project ----------
  let shown = 0;
  for (const fx of manifest.fixtures) {
    const bytes = readFileSync(resolve(FIXTURES, fx.file));
    await setFile(page, fx.file, bytes);
    await openDialog(page);
    const ok = await page.$('mat-import-svg-dialog [data-role="ok"]');
    const sum = ok ? await reportSummary(page) : null;
    const expect = fx.expectCodes ?? [];
    const missing = sum ? expect.filter((c) => !sum.codes.has(c)) : expect;
    check(
      `${fx.file} (${fx.real ? 'thật' : 'mô phỏng'}): xem trước và báo cáo có đủ mã dự kiến`,
      ok !== null && missing.length === 0,
      `thiếu: ${missing.join(', ')}; có: ${[...(sum?.codes ?? [])].join(', ')}`,
    );
    if (ok) {
      const previews = await page.evaluate(() =>
        ['before', 'after'].map(
          (w) =>
            document
              .querySelector(`mat-import-svg-dialog [data-pv="${w}"]`)
              ?.shadowRoot?.querySelector('svg') !== null,
        ),
      );
      check(`${fx.file}: hai khung xem trước dựng được`, previews.every(Boolean), previews.join());
      if (shown++ === 0) await shot('1-xem-truoc');
    }
    await press(page, 'Escape');
    await dialogGone(page);
  }
  check('Hủy sau mọi lần xem trước: canvas vẫn rỗng', (await itemCount(page)) === 0);
  check('Hủy: không ghi gì xuống đĩa', (await written(page)).length === 0);

  // ---------- 2. Báo cáo của Inkscape: chi tiết, sắp xếp, Tối ưu, Lưu báo cáo ----------
  const tank = 'inkscape-01-tank-process.svg';
  await setFile(page, tank, readFileSync(resolve(FIXTURES, tank)));
  await openDialog(page);
  const info = await page.$eval('mat-import-svg-dialog .imp-info', (e) =>
    e.textContent.replace(/\s+/g, ' '),
  );
  check(
    'hiện tên file, phần mềm nhận diện và đích graphics/<slug>.svg',
    /inkscape-01-tank-process\.svg/.test(info) &&
      /Inkscape/.test(info) &&
      info.includes('graphics/inkscape-01-tank-process.svg'),
    info,
  );
  const stats = await page.$eval('[data-role="stats"]', (e) => e.textContent.replace(/\s+/g, ' '));
  check(
    'hiện số phần tử, UID, độ sâu, cỡ và viewBox',
    /Phần tử.*→/.test(stats) && /viewBox/.test(stats),
    stats,
  );
  const th = await page.$$eval('mat-import-report th[scope="col"]', (hs) =>
    hs.map((h) => h.textContent.trim()),
  );
  check(
    'bảng báo cáo có tiêu đề cột Loại, Tên, SL, Mã, Lý do, Vị trí ví dụ',
    ['Loại', 'Tên', 'SL', 'Mã', 'Lý do', 'Vị trí ví dụ'].every((c, i) => th[i]?.startsWith(c)),
    th.join('|'),
  );
  await page.$eval('mat-import-report button.th-sort[data-col="code"]', (b) => b.click());
  await sleep(60);
  const sorted = await page
    .$eval('mat-import-report th[aria-sort="ascending"]', (e) => e.textContent.trim())
    .catch(() => null);
  check(
    'bấm tiêu đề cột Mã: sắp xếp (aria-sort=ascending)',
    sorted === 'Mã ▲' || sorted?.startsWith('Mã'),
    String(sorted),
  );

  await page.$eval('[data-role="optimize"]', (c) => c.click());
  await waitFor(page, () =>
    /Đã gộp/.test(document.querySelector('[data-role="optimize-help"]')?.textContent ?? ''),
  );
  check('bật Tối ưu: chạy lại và hiện kết quả gộp', true);
  await page.$eval('[data-role="optimize"]', (c) => c.click());
  await waitFor(
    page,
    () => !/Đã gộp/.test(document.querySelector('[data-role="optimize-help"]')?.textContent ?? ''),
  );

  await page.$eval('[data-role="save-report"]', (b) => b.click());
  await waitFor(page, () => window.__matMock.savedCsv.length === 1);
  const rep = await page.evaluate(() => window.__matMock.savedCsv[0]);
  check(
    'Lưu báo cáo: csv_save tên <file>.import-report.json, đuôi json, JSON hợp lệ',
    rep.name === 'inkscape-01-tank-process.import-report.json' &&
      rep.extension === 'json' &&
      JSON.parse(rep.text).file.name === tank,
    rep.name,
  );
  await press(page, 'Control+s');
  await sleep(100);
  check(
    'Ctrl+S trong hộp thoại: lưu báo cáo, không lưu project',
    (await page.evaluate(() => window.__matMock.savedCsv.length)) === 2 &&
      (await written(page)).length === 0,
  );
  await page.select('[data-role="format"]', 'md');
  await page.$eval('[data-role="save-report"]', (b) => b.click());
  await waitFor(page, () => window.__matMock.savedCsv.length === 3);
  const md = await page.evaluate(() => window.__matMock.savedCsv[2]);
  check(
    'Lưu báo cáo Markdown: đuôi md và có tiêu đề',
    md.extension === 'md' && md.text.startsWith('# Báo cáo nhập SVG'),
    md.name,
  );

  await axeBoth(page, axe, 'hộp thoại Nhập SVG (xem trước)');
  await press(page, 'Escape');
  await dialogGone(page);

  // ---------- 3. SVG độc hại: báo cáo nêu script, không chạy gì ----------
  const evil = resolve(FIXTURES, 'malicious/m01-script.svg');
  await setFile(page, 'm01-script.svg', readFileSync(evil));
  await openDialog(page);
  const evilSum = await reportSummary(page);
  check(
    'm01-script: báo cáo có R_SCRIPT',
    evilSum.codes.has('R_SCRIPT'),
    [...evilSum.codes].join(),
  );
  const pwned = await page.evaluate(() => ({
    w: window.__pwned ?? null,
    s: document.querySelectorAll('mat-import-svg-dialog script').length,
  }));
  check(
    'm01-script: không chạy mã (window.__pwned rỗng, không có <script> trong hộp thoại)',
    pwned.w === null && pwned.s === 0,
    JSON.stringify(pwned),
  );
  const hostScripts = await page.evaluate(() =>
    ['before', 'after'].reduce(
      (n, w) =>
        n +
        (document.querySelector(`[data-pv="${w}"]`)?.shadowRoot?.querySelectorAll('script')
          .length ?? 0),
      0,
    ),
  );
  check(
    'm01-script: hai khung xem trước đã lọc hết script',
    hostScripts === 0,
    String(hostScripts),
  );
  await press(page, 'Escape');
  await dialogGone(page);

  // ---------- 4. Từ chối: DTD, file quá lớn, sai đuôi ----------
  await setFile(
    page,
    'm14.svg',
    readFileSync(resolve(FIXTURES, 'malicious/m14-dtd-billion-laughs.svg')),
  );
  await openDialog(page);
  const dtd = await page.evaluate(() => ({
    code: document.querySelector('[data-role="code"]')?.textContent,
    hint: document.querySelector('[data-role="hint"]')?.textContent,
    text: document
      .querySelector('mat-import-svg-dialog [role="alert"]')
      ?.textContent.replace(/\s+/g, ' '),
    ok: document.querySelector('[data-role="ok"]') !== null,
    changed: document.querySelector('mat-import-svg-dialog .kvs')?.textContent.replace(/\s+/g, ' '),
  }));
  check(
    'DTD: từ chối với mã E_IMPORT_DTD kèm hướng dẫn Plain SVG',
    dtd.code === 'E_IMPORT_DTD' && /Plain SVG/.test(dtd.hint) && !dtd.ok,
    JSON.stringify(dtd),
  );
  check(
    'DTD: nói rõ chưa đổi project',
    /Đã thay đổi project.*Không/.test(dtd.changed ?? ''),
    dtd.changed,
  );
  await shot('2-tu-choi-dtd');
  await axeBoth(page, axe, 'hộp thoại Nhập SVG (từ chối)');
  // "Chọn file khác…" chạy lại bằng file tốt.
  await setFile(page, tank, readFileSync(resolve(FIXTURES, tank)));
  await page.$eval('[data-role="another"]', (b) => b.click());
  await dialogReady(page);
  check(
    'Chọn file khác…: từ chối chuyển sang xem trước',
    (await page.$('[data-role="ok"]')) !== null,
  );
  await press(page, 'Escape');
  await dialogGone(page);

  await setError(page, 'too-large');
  await openDialog(page);
  const big = await page.evaluate(() => ({
    code: document.querySelector('[data-role="code"]')?.textContent,
    hint: document.querySelector('[data-role="hint"]')?.textContent,
  }));
  check(
    'file quá lớn (> 5 MiB): E_IMPORT_LIMIT và nêu giới hạn 5 MiB',
    big.code === 'E_IMPORT_LIMIT' && /5 MiB/.test(big.hint),
    JSON.stringify(big),
  );
  await press(page, 'Escape');
  await dialogGone(page);
  await setError(page, 'bad-extension');
  await openDialog(page);
  check(
    'sai đuôi: E_IMPORT_EXT',
    (await page.$eval('[data-role="code"]', (e) => e.textContent)) === 'E_IMPORT_EXT',
  );
  await press(page, 'Escape');
  await dialogGone(page);
  await page.evaluate(() => {
    window.__matMock.svgOpenResult = null;
  });
  await press(page, 'Control+Shift+I');
  await dialogGone(page);
  check(
    'hủy hộp thoại chọn file: không mở gì, project không đổi',
    (await itemCount(page)) === 0 && (await written(page)).length === 0,
  );

  // ---------- 5. Nhập hoàn toàn bằng bàn phím, Ctrl+Z / Ctrl+Y, Lưu ----------
  await setFile(page, tank, readFileSync(resolve(FIXTURES, tank)));
  await press(page, 'Control+Shift+I');
  await page.waitForSelector('mat-import-svg-dialog [role="dialog"]');
  await dialogReady(page);
  const focusIn = async () =>
    page.evaluate(() =>
      Boolean(document.activeElement?.closest('mat-import-svg-dialog [role="dialog"]')),
    );
  check(
    'mở hộp thoại: focus vào nút Nhập',
    await page.evaluate(() => document.activeElement?.dataset.role === 'ok'),
  );
  let trapped = true;
  for (let i = 0; i < 40; i++) {
    await press(page, 'Tab');
    trapped &&= await focusIn();
  }
  for (let i = 0; i < 12; i++) {
    await press(page, 'Shift+Tab');
    trapped &&= await focusIn();
  }
  check('Tab và Shift+Tab: focus không ra khỏi hộp thoại (bẫy focus)', trapped);
  await page.$eval('[data-role="ok"]', (b) => b.focus());
  await press(page, 'Enter');
  await dialogGone(page);
  await waitFor(page, () => document.querySelectorAll('mat-screen-canvas .oi').length === 1);
  check(
    'Enter: thêm đúng một item svg vào màn hình và chọn nó',
    (await itemCount(page)) === 1 &&
      (await page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => e.length)) === 1,
  );
  await sleep(300);
  await shot('3-da-nhap');
  await press(page, 'Control+z');
  await waitFor(page, () => document.querySelectorAll('mat-screen-canvas .oi').length === 0);
  check('Ctrl+Z gỡ item (một bước)', (await itemCount(page)) === 0);
  await press(page, 'Control+y');
  await waitFor(page, () => document.querySelectorAll('mat-screen-canvas .oi').length === 1);
  check('Ctrl+Y làm lại', (await itemCount(page)) === 1);

  await press(page, 'Control+s');
  await waitFor(page, () => window.__matMock.writes.length >= 3);
  const files = await written(page);
  const byRel = Object.fromEntries(files.map((f) => [f.rel, f.content]));
  const svgRel = 'graphics/inkscape-01-tank-process.svg';
  check(
    'Lưu: ghi file SVG, file binding rỗng và màn hình, đúng đường dẫn',
    svgRel in byRel &&
      'screens/chinh.svg_1.bindings.json' in byRel &&
      'screens/chinh.screen.json' in byRel,
    Object.keys(byRel).join(),
  );
  check(
    'SVG đã ghi: có data-mat-uid, không namespace sodipodi/inkscape, không script, không onclick',
    /data-mat-uid="el_/.test(byRel[svgRel] ?? '') &&
      !/sodipodi|inkscape|<script|onclick/.test(byRel[svgRel] ?? ''),
  );
  const binding = JSON.parse(byRel['screens/chinh.svg_1.bindings.json'] ?? '{}');
  check(
    'file binding rỗng, đúng màn hình và item',
    binding.elements?.length === 0 && binding.screenId === 'chinh' && binding.itemId === 'svg_1',
    JSON.stringify(binding),
  );
  const screen = JSON.parse(byRel['screens/chinh.screen.json'] ?? '{}');
  const item = screen.items?.[0];
  check(
    'item svg ở (0, 0), trỏ đúng file, viewBox của file',
    item?.type === 'svg' &&
      item.x === 0 &&
      item.y === 0 &&
      item.svgFile === svgRel &&
      item.viewBox?.length === 4,
    JSON.stringify(item).slice(0, 160),
  );
  await press(page, 'F7');
  await sleep(700);
  const errors = await page.$eval('mat-statusbar', (e) => e.textContent.replace(/\s+/g, ' '));
  check('Kiểm tra sau khi nhập và lưu: 0 lỗi', /0 lỗi/.test(errors), errors.slice(0, 200));

  // ---------- 6. Nhập lần hai cùng tên: -2 ----------
  await setFile(page, tank, readFileSync(resolve(FIXTURES, tank)));
  await press(page, 'Control+Shift+I');
  await dialogReady(page);
  const target2 = await page.$eval('[data-role="target"]', (e) => e.textContent);
  check(
    'nhập lần hai cùng tên file: đích thêm -2',
    target2.includes('graphics/inkscape-01-tank-process-2.svg'),
    target2,
  );
  await press(page, 'Escape');
  await dialogGone(page);

  await axe('màn hình sau khi đóng hộp thoại');
}
