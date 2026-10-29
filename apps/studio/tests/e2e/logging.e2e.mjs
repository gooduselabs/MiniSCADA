// E2E editor Lưu trữ sửa được (feature 010, US7, T125, T126; contracts/studio-010.md §1, quickstart), lớp Tauri giả:
// - dựng cấu hình lưu trữ TỪ ĐẦU hoàn toàn bằng thao tác: tạo cấu hình, thêm bốn nhóm, đặt cả bốn chế độ (Chu kỳ, Thay đổi, Kết hợp,
//   Kích hoạt), thêm Tag bằng gõ tên có gợi ý, điền xuống (Ctrl+D), bật Tổng hợp và Tag kích hoạt ở inspector;
// - đổi chu kỳ 1 s → 1 ms: khung Ước tính chuyển mức trong ≤ 100 ms (đo bằng đồng hồ trong trang, SC-019);
// - sửa sai id: lỗi hiện tại ô trong ≤ 500 ms (FR-054), Ctrl+S vẫn lưu được khi còn lỗi;
// - (hộp thoại chặn mềm khi Nạp xuống: logging-budget.e2e.mjs, trên project hợp lệ);
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối cho editor và hộp thoại; 0 lỗi console.
import {
  HISTORY_DEMO,
  axeBoth,
  clickCell,
  gridCell,
  gridText,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  typeInCell,
  waitFor,
} from './util.mjs';

const ED = 'mat-logging-editor';
const G = `${ED} [data-grid="groups"]`;
const T = `${ED} [data-grid="tags"]`;
const cell = (host, r, c) => gridCell(host, r, c);

/** Project trắng: chỉ có Tag của history-demo, chưa có lưu trữ. */
function scratchProject() {
  const files = readProject(HISTORY_DEMO);
  const p = JSON.parse(files['project.json']);
  delete p.loggingFile;
  delete p.reportsFile;
  delete p.navigation;
  p.screens = ['tong-quan'];
  return {
    'project.json': JSON.stringify(p, null, 2) + '\n',
    'tags.json': files['tags.json'],
    'screens/tong-quan.screen.json': files['screens/tong-quan.screen.json'],
  };
}

/** Gõ vào ô của lưới rồi Enter. */
async function setCell(page, host, r, c, value) {
  await clickCell(page, host, r, c);
  await typeInCell(page, value);
  await sleep(60);
}

/**
 * Đo thời gian từ phím Enter tới khi phần tử `cond.selector` xuất hiện (và không có lớp `cond.notClass` nếu cho), bằng đồng hồ của
 * trang.
 */
async function latencyAfterEnter(page, cond) {
  await page.evaluate((c) => {
    const test = () => {
      const e = document.querySelector(c.selector);
      return !!e && (c.notClass === undefined || !e.classList.contains(c.notClass));
    };
    window.__lat = { t0: 0, t1: 0 };
    const onKey = (e) => {
      if (e.key === 'Enter' && !window.__lat.t0) window.__lat.t0 = performance.now();
    };
    window.addEventListener('keydown', onKey, true);
    const mo = new MutationObserver(() => {
      if (window.__lat.t0 && !window.__lat.t1 && test()) window.__lat.t1 = performance.now();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.__latStop = () => {
      window.removeEventListener('keydown', onKey, true);
      mo.disconnect();
    };
  }, cond);
  await page.keyboard.press('Enter');
  await waitFor(page, () => window.__lat.t1 > 0, undefined, 4000).catch(() => undefined);
  const r = await page.evaluate(() => {
    window.__latStop();
    return { ms: window.__lat.t1 ? window.__lat.t1 - window.__lat.t0 : -1 };
  });
  return r.ms;
}

export default async function logging({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, scratchProject(), 'D:\\Projects\\luu-tru');
  await treeItem(page, 'Lưu trữ');

  // ---------- 1. Từ đầu: tạo cấu hình, thêm bốn nhóm ----------
  await page.waitForSelector(`${ED} [data-act="create"]`);
  check('project chưa có lưu trữ: hướng dẫn và nút Tạo cấu hình', true);
  await page.click(`${ED} [data-act="create"]`);
  await page.waitForSelector(`${ED} [data-act="add-group"]`);
  for (let i = 0; i < 4; i++) {
    await page.click(`${ED} [data-act="add-group"]`);
    await waitFor(page, (n) => document.querySelectorAll(`${n} [role="row"]`).length >= 0, G);
    await sleep(60);
  }
  await page.waitForSelector(cell(G, 3, 'id'));
  const ids = [];
  for (let r = 0; r < 4; r++) ids.push(await gridText(page, cell(G, r, 'id')));
  check('thêm bốn nhóm bằng nút Thêm nhóm (id duy nhất)', new Set(ids).size === 4, ids.join(','));

  // ---------- 1b (042). Bảng rỗng: gợi ý + nút Thêm Tag…, chu kỳ mặc định 10 s ----------
  const iv0 = await gridText(page, cell(G, 0, 'interval'));
  check('bảng mới: chu kỳ mặc định 10 s', iv0 === '10 s', iv0);
  await page.waitForSelector(`${ED} [data-role="no-tags"] [data-act="pick-tags-empty"]`);
  check('bảng 0 Tag: khung gợi ý có nút Thêm Tag…', true);
  await page.click(`${ED} [data-act="pick-tags-empty"]`);
  await page.waitForSelector(`${ED} [data-role="tag-picker"]`);
  await page.click(`${ED} [data-act="pick-cancel"]`);
  await waitFor(page, (n) => !document.querySelector(`${n} [data-role="tag-picker"]`), ED);

  // ---------- 2. Bốn chế độ ----------
  await setCell(page, G, 0, 'name', 'Chu kỳ 1 s');
  await setCell(page, G, 1, 'mode', 'Thay đổi');
  await setCell(page, G, 2, 'mode', 'Kết hợp');
  await setCell(page, G, 3, 'mode', 'Kích hoạt');
  const modes = [];
  for (let r = 0; r < 4; r++) modes.push(await gridText(page, cell(G, r, 'mode')));
  check(
    'bốn chế độ đặt bằng gõ ô: Chu kỳ, Thay đổi, Kết hợp, Kích hoạt',
    modes.join('|') === 'Chu kỳ|Thay đổi|Kết hợp|Kích hoạt',
    modes.join('|'),
  );

  // ---------- 3. Điền xuống thời hạn lưu ----------
  await clickCell(page, G, 0, 'retention');
  await typeInCell(page, '90');
  await clickCell(page, G, 0, 'retention');
  for (let i = 0; i < 3; i++)
    await page.keyboard
      .down('Shift')
      .then(() => page.keyboard.press('ArrowDown'))
      .then(() => page.keyboard.up('Shift'));
  await press(page, 'Control+d');
  await sleep(80);
  const days = [];
  for (let r = 0; r < 4; r++) days.push(await gridText(page, cell(G, r, 'retention')));
  check(
    'điền xuống (Ctrl+D) chép thời hạn lưu xuống bốn nhóm',
    days.join(',') === '90,90,90,90',
    days.join(','),
  );

  // ---------- 4. Tag của nhóm: gõ tên có gợi ý và dán danh sách ----------
  await clickCell(page, G, 0, 'name');
  await page.click(`${ED} [data-role="add-tag"]`);
  await page.keyboard.type('PROC.PRES');
  await page.waitForSelector(`${ED} .le-suggest li`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitFor(
    page,
    (t) => document.querySelectorAll(`${t} [role="gridcell"][data-c="tag"]`).length >= 1,
    T,
  );
  const first = await gridText(page, cell(T, 0, 'tag'));
  check('thêm Tag bằng gõ tên có gợi ý', first === 'PROC.PRESSURE', String(first));
  await clickCell(page, G, 1, 'name');
  await page.evaluate(() => {
    const input = document.querySelector('mat-logging-editor [data-role="add-tag"]');
    input.focus();
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', {
      value: { getData: () => 'PROC.PRESSURE\nPROC.TEMP\nPUMP1.RUN' },
    });
    input.dispatchEvent(e);
  });
  await waitFor(
    page,
    (t) => document.querySelectorAll(`${t} [role="gridcell"][data-c="tag"]`).length >= 3,
    T,
  );
  const deadbandMuted = await page.$eval(cell(T, 2, 'deadband'), (e) =>
    e.getAttribute('aria-readonly'),
  );
  check(
    'dán danh sách Tag; ô deadband mờ cho Tag BOOL',
    deadbandMuted === 'true',
    String(deadbandMuted),
  );

  // ---------- 5. Inspector: Tag kích hoạt và Tổng hợp ----------
  await clickCell(page, G, 3, 'name');
  await page.waitForSelector('[data-field="trigger.tagId"]');
  await page.click('[data-field="trigger.tagId"]');
  await page.keyboard.type('BATCH.DONE');
  await page.keyboard.press('Enter');
  await sleep(100);
  const trg = await gridText(page, cell(G, 3, 'interval'));
  check(
    'inspector đặt Tag kích hoạt, lưới hiện "cạnh lên của BATCH.DONE"',
    /BATCH\.DONE/.test(trg ?? ''),
    String(trg),
  );
  await clickCell(page, G, 0, 'name');
  await page.waitForSelector('[data-field="aggregates"]');
  await page.click('[data-field="aggregates"]');
  await sleep(100);
  const agg = await gridText(page, cell(G, 0, 'agg'));
  check('bật Tổng hợp ở inspector: ô Tổng hợp của lưới là Bật', agg === 'Bật', String(agg));

  // ---------- 6. Ước tính ≤ 100 ms (SC-019) ----------
  await page.waitForSelector(`${ED} mat-estimate-panel .est`);
  const lv0 = await page.$eval(`${ED} mat-estimate-panel .est`, (e) => e.className);
  await clickCell(page, G, 0, 'interval');
  await page.keyboard.type('1 ms');
  const ms = await latencyAfterEnter(page, {
    selector: 'mat-logging-editor mat-estimate-panel .est',
    notClass: 'lv-ok',
  });
  check(
    'đổi chu kỳ 1 s → 1 ms: khung Ước tính chuyển cảnh báo trong ≤ 100 ms',
    ms >= 0 && ms <= 100,
    `mức đầu "${lv0}", ${ms.toFixed(1)} ms`,
  );
  const badge = await page.$eval(`${ED} mat-estimate-panel .est-badge`, (e) =>
    e.textContent.trim(),
  );
  check('mức mới có nhãn chữ (không chỉ màu)', /ngân sách|cực lớn/.test(badge), badge);
  await shot('1-luu-tru-uoc-tinh');

  // ---------- 7. Lỗi theo ô ≤ 500 ms; lưu được khi còn lỗi (FR-054) ----------
  await clickCell(page, G, 2, 'id');
  await page.keyboard.type('Nhóm Sai!');
  const errMs = await latencyAfterEnter(page, {
    selector:
      'mat-logging-editor [data-grid="groups"] [role="gridcell"][data-r="2"][data-c="id"][aria-invalid="true"]',
  });
  check(
    'sửa sai id: lỗi hiện tại ô trong ≤ 500 ms',
    errMs >= 0 && errMs <= 500,
    `${errMs.toFixed(1)} ms`,
  );
  const before = await page.evaluate(() => window.__matMock.writes.length);
  await press(page, 'Control+s');
  await waitFor(page, (n) => window.__matMock.writes.length > n, before, 4000).catch(
    () => undefined,
  );
  const wrote = await page.evaluate(() => window.__matMock.writes.map((w) => w.rel));
  check('Ctrl+S lưu logging.json dù còn lỗi', wrote.includes('logging.json'), wrote.join(','));
  await setCell(page, G, 2, 'id', 'ket-hop');

  // ---------- 8. Kết nối DB ngoài: không có ô mật khẩu ----------
  await page.click(`${ED} [data-act="add-conn"]`);
  await page.waitForSelector(`${ED} .le-conn`);
  const pw = await page.$(`${ED} input[type="password"]`);
  const secretNote = await page.$eval(`${ED} [data-role="connections"]`, (e) =>
    /--set-secret/.test(e.textContent),
  );
  check('form kết nối không có ô mật khẩu, có chú thích --set-secret', !pw && secretNote);

  // ---------- 9. Trợ năng (T126) ----------
  await clickCell(page, G, 0, 'name');
  await axeBoth(page, axe, 'editor Lưu trữ');
  await page.click(`${ED} [data-act="del-conn"]`);
  await sleep(100);
}
