// E2E Tag tính toán (feature 006, T192, US4, FR-047, FR-049, SC-015, quickstart §5 bước 12–14), lớp Tauri giả và thiết bị giả:
// - mở Tag tính toán: danh sách, biểu thức, Tag đầu vào, xem trước (giá trị mô phỏng; Online thì giá trị sống);
// - gõ "tank01.le" → gợi ý TANK01.LEVEL ≤ 200 ms (project 2.000 Tag, từng phím); biểu thức sai → gạch đúng chỗ ≤ 500 ms
//   kèm lý do; vòng A ↔ B kèm đường vòng (SC-015); Enter/Tab nhận gợi ý;
// - đổi tên Tag: hộp thoại liệt kê chỗ sẽ đổi, xác nhận đổi hết, MỘT Ctrl+Z trả lại;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console. Số đo ghi vào tests/e2e/out/calc.json.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FULL_02,
  TAGS_2000,
  axeBoth,
  goOnline,
  openAndWait,
  press,
  readProject,
  runCommand,
  sleep,
  stats,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ED = 'mat-calc-tags-editor';
const TA = `${ED} mat-expression-input textarea`;

const listItems = (page) =>
  page.$$eval(`${ED} [data-role="calc-list"] [role="option"]`, (els) =>
    els.map((e) => e.querySelector('.cx-id')?.textContent.trim()),
  );

async function replaceExpression(page, value) {
  await page.click(TA);
  await press(page, 'Control+a');
  await page.keyboard.type(value);
}

/** Chọn một Tag tính toán trong danh sách của editor. */
async function selectCalc(page, id) {
  await page.evaluate(
    (want) =>
      [...document.querySelectorAll('mat-calc-tags-editor [data-role="calc-list"] [role="option"]')]
        .find((e) => e.querySelector('.cx-id')?.textContent.trim() === want)
        ?.click(),
    id,
  );
  await sleep(120);
}

/** Gõ chữ vào ô biểu thức (thay nội dung), đo từ phím cuối tới khi danh sách gợi ý có mục. */
const suggestMs = (page, typed) =>
  page.evaluate(async (v) => {
    const ta = document.querySelector('mat-expression-input textarea');
    ta.focus();
    ta.value = v;
    ta.setSelectionRange(v.length, v.length);
    const t0 = performance.now();
    ta.dispatchEvent(new InputEvent('input', { bubbles: true, data: v.slice(-1) }));
    const deadline = t0 + 2000;
    while (
      !document.querySelector('mat-expression-input [role="option"]') &&
      performance.now() < deadline
    )
      await new Promise((r) => requestAnimationFrame(r));
    return performance.now() - t0;
  }, typed);

export default async function calc({ page, url, check, shot, axe }) {
  const files = readProject(FULL_02);
  await openAndWait(page, files, 'D:\\Projects\\full-02');
  await treeNode(page, 'calc');
  await page.waitForSelector(`${ED} mat-expression-input textarea`);

  // ---------- 1. Bố cục ----------
  const ids = await listItems(page);
  check(
    'danh sách 3 Tag tính toán của project mẫu',
    ids.join() === 'TANK01.VOLUME,TANK01.HIGH,PUMP01.STATE_TEXT',
    ids.join(),
  );
  check(
    'Tag đầu tiên được chọn, ô biểu thức hiện biểu thức của nó',
    (await page.$eval(TA, (t) => t.value)) === 'TANK01.LEVEL * 12.5',
  );
  const src = await text(page, `${ED} [data-role="preview-source"]`);
  check(
    'chưa Online, chưa Mô phỏng: xem trước dùng giá trị mô phỏng',
    /giá trị mô phỏng/.test(src ?? ''),
    src,
  );
  const res = await text(page, `${ED} [data-role="preview-result"]`);
  check('xem trước có kết quả GOOD', /GOOD/.test(res ?? ''), res);
  await shot('1-tag-tinh-toan');
  await axeBoth(page, axe, 'editor Tag tính toán');

  // ---------- 2. Gợi ý và nhận gợi ý ----------
  await page.click(TA);
  await press(page, 'Control+a');
  await page.keyboard.type('tank01.le');
  await waitFor(
    page,
    () =>
      /^TANK01.LEVEL/.test(
        document
          .querySelector('mat-calc-tags-editor mat-expression-input [role="option"]')
          ?.textContent.trim() ?? '',
      ),
    undefined,
    3000,
  ).catch(() => undefined);
  const first = await text(page, `${ED} mat-expression-input [role="option"]`);
  check(
    'gõ "tank01.le": mục đầu của gợi ý là TANK01.LEVEL',
    /^TANK01\.LEVEL/.test(first ?? ''),
    first,
  );
  check(
    'ô nhập là combobox: aria-expanded = true',
    (await page.$eval(TA, (t) => t.getAttribute('aria-expanded'))) === 'true',
  );
  await shot('2-goi-y');
  await axeBoth(page, axe, 'danh sách gợi ý đang mở');
  await page.keyboard.press('Tab');
  check('Tab nhận gợi ý đầu', (await page.$eval(TA, (t) => t.value)) === 'TANK01.LEVEL');

  // ---------- 3. Biểu thức sai: gạch đúng chỗ ≤ 500 ms ----------
  await replaceExpression(page, 'TANK9.LEVEL * 2');
  const t0 = Date.now();
  await waitFor(
    page,
    () =>
      document.querySelector('mat-calc-tags-editor .ei-hl .t-err')?.textContent === 'TANK9.LEVEL',
    undefined,
    3000,
  );
  const errMs = Date.now() - t0;
  const underlined = await text(page, `${ED} .ei-hl .t-err`);
  const reason = await text(page, `${ED} [data-role="msg"]`);
  check(
    `lỗi tên Tag gạch đúng đoạn "TANK9.LEVEL" (≤ 500 ms sau phím cuối, đo ${errMs} ms)`,
    underlined === 'TANK9.LEVEL' && errMs <= 500,
    `${underlined} / ${errMs} ms`,
  );
  check('lý do tiếng Việt nêu tên Tag', /Không có Tag “TANK9\.LEVEL”/.test(reason ?? ''), reason);
  check(
    'ô nhập báo lỗi cho trình đọc màn hình: aria-invalid và aria-describedby',
    await page.$eval(
      TA,
      (t) =>
        t.getAttribute('aria-invalid') === 'true' && Boolean(t.getAttribute('aria-describedby')),
    ),
  );
  await shot('3-loi-bieu-thuc');
  await axeBoth(page, axe, 'biểu thức có lỗi');
  await replaceExpression(page, 'TANK01.LEVEL * 12.5');
  await sleep(450);

  // ---------- 4. Vòng A ↔ B kèm đường vòng ----------
  await page.click(`${ED} [data-act="add"]`);
  await page.click(`${ED} [data-act="add"]`);
  await waitFor(
    page,
    () =>
      document.querySelectorAll('mat-calc-tags-editor [data-role="calc-list"] [role="option"]')
        .length === 5,
  );
  const all = await listItems(page);
  check(
    'thêm hai Tag tính toán CALC_1, CALC_2',
    all.includes('CALC_1') && all.includes('CALC_2'),
    all.join(),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-calc-tags-editor [data-role="calc-list"] [role="option"]')]
      .find((e) => e.querySelector('.cx-id')?.textContent.trim() === 'CALC_1')
      ?.click(),
  );
  await sleep(100);
  await replaceExpression(page, 'CALC_2 + 1');
  await sleep(450);
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-calc-tags-editor [data-role="calc-list"] [role="option"]')]
      .find((e) => e.querySelector('.cx-id')?.textContent.trim() === 'CALC_2')
      ?.click(),
  );
  await sleep(100);
  await replaceExpression(page, 'CALC_1 + 1');
  await waitFor(
    page,
    () =>
      /→/.test(document.querySelector('mat-calc-tags-editor [data-role="msg"]')?.textContent ?? ''),
    undefined,
    3000,
  );
  const cycle = await text(page, `${ED} [data-role="msg"]`);
  check(
    'vòng tham chiếu kèm đường vòng CALC_2 → CALC_1 → CALC_2',
    /CALC_2 → CALC_1 → CALC_2/.test(cycle ?? ''),
    cycle,
  );
  await shot('4-vong-tham-chieu');
  // Gỡ vòng: hai biểu thức hợp lệ (CALC_2 dùng TANK01.LEVEL) để bước đổi tên thấy project không còn lỗi.
  await replaceExpression(page, 'TANK01.LEVEL + 1');
  await sleep(450);
  await selectCalc(page, 'CALC_1');
  await replaceExpression(page, 'CALC_2 + 1');
  await sleep(450);

  // ---------- 5. Đổi tên Tag: danh sách chỗ sẽ đổi, một Ctrl+Z ----------
  await shot('5-doi-ten-bat-dau');

  // Đổi tên Tag đầu vào TANK01.LEVEL: hai biểu thức và binding.
  await treeNode(page, 'tags');
  await page.waitForSelector('mat-tag-grid [role="gridcell"][data-r="0"][data-c="id"]');
  await page.click('mat-tag-grid [role="gridcell"][data-r="0"][data-c="id"]');
  await runCommand(page, 'Đổi tên Tag');
  await page.waitForSelector('mat-rename-tag-dialog input[name="to"]');
  await page.$eval('mat-rename-tag-dialog input[name="to"]', (i) => i.select());
  await page.keyboard.type('TANK01.MUC');
  await page.waitForSelector('mat-rename-tag-dialog [data-role="hits"] li');
  await shot('5-doi-ten');
  await axeBoth(page, axe, 'hộp thoại Đổi tên Tag');
  const places = await page.$$eval('mat-rename-tag-dialog [data-role="hits"] li', (l) =>
    l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'đổi tên TANK01.LEVEL: liệt kê hai biểu thức và một binding',
    ['TANK01.VOLUME', 'TANK01.HIGH', 'CALC_2'].every((n) => places.some((p) => p.includes(n))) &&
      places.some((p) => /Main/.test(p)),
    places.join(' | '),
  );
  await page.keyboard.press('Enter');
  await waitFor(page, () => !document.querySelector('mat-rename-tag-dialog [role="dialog"]'));
  await treeNode(page, 'calc');
  await page.waitForSelector(TA);
  await selectCalc(page, 'TANK01.VOLUME');
  const renamed = await page.$eval(TA, (t) => t.value);
  check(
    'xác nhận đổi: biểu thức của TANK01.VOLUME dùng tên mới',
    renamed === 'TANK01.MUC * 12.5',
    renamed,
  );
  await sleep(600);
  const errCount = await page.evaluate(() =>
    Number((document.querySelector('mat-statusbar')?.textContent.match(/(\d+) lỗi/) ?? [])[1] ?? 0),
  );
  check('sau khi đổi tên không còn lỗi tham chiếu', errCount === 0, `${errCount} lỗi`);
  // Ctrl+Z ngoài ô nhập: một bước trả lại tên cũ ở mọi chỗ.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.click(`${ED} [data-role="calc-list"] [aria-selected="true"]`);
  await press(page, 'Control+z');
  await sleep(250);
  const undone = await page.$eval(TA, (t) => t.value);
  check(
    'một Ctrl+Z trả lại TANK01.LEVEL ở biểu thức của TANK01.VOLUME',
    undone === 'TANK01.LEVEL * 12.5',
    undone,
  );
  await selectCalc(page, 'CALC_2');
  check(
    'cùng một Ctrl+Z trả lại cả CALC_2',
    (await page.$eval(TA, (t) => t.value)) === 'TANK01.LEVEL + 1',
  );
  await selectCalc(page, 'TANK01.VOLUME');

  // ---------- 6. Online: xem trước bằng giá trị sống ----------
  await goOnline(page, 'kysu1', files);
  await page.evaluate(() =>
    window.__matMock.device.setTag('BL335-01', 'TANK01.LEVEL', { value: 40, quality: 'GOOD' }),
  );
  await waitFor(page, () =>
    /giá trị sống/.test(
      document.querySelector('mat-calc-tags-editor [data-role="preview-source"]')?.textContent ??
        '',
    ),
  );
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-calc-tags-editor [data-role="preview-result"] b')
        ?.textContent.trim() === '500',
    undefined,
    4000,
  );
  check('Online: xem trước dùng giá trị sống: 40 × 12,5 = 500', true);
  await shot('6-online');
  await axeBoth(page, axe, 'editor Tag tính toán Online');

  // ---------- 7. SC-015: 2.000 Tag, gợi ý ≤ 200 ms mỗi phím ----------
  await page.goto(`${url}?gate=off`, { waitUntil: 'networkidle0' });
  await openAndWait(page, readProject(TAGS_2000), 'D:\\Projects\\tags-2000');
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-tree [role="treeitem"] .cnt')].some(
        (c) => c.textContent.trim() === '2000',
      ),
    undefined,
    20000,
  );
  const o0 = Date.now();
  await treeNode(page, 'calc');
  await page.waitForSelector(TA);
  const openMs = Date.now() - o0;
  const calcRows = (await listItems(page)).length;
  check(
    `mở editor với ${calcRows} Tag tính toán (đo ${openMs} ms)`,
    calcRows >= 500 && openMs < 3000,
    `${calcRows} Tag, ${openMs} ms`,
  );
  const lat = [];
  const word = 'tank01.le';
  for (let n = 1; n <= word.length; n++) {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Escape');
    lat.push(await suggestMs(page, word.slice(0, n)));
  }
  const s = stats(lat);
  check(
    `SC-015: gợi ý tên Tag mỗi phím ≤ 200 ms với 2.000 Tag (lớn nhất ${s.max} ms)`,
    s.max <= 200,
    JSON.stringify(s),
  );
  const bad = [];
  for (let i = 0; i < 10; i++) {
    await page.click(TA);
    await press(page, 'Control+a');
    await page.keyboard.type(`KHONG.CO${i}`);
    const b0 = Date.now();
    await waitFor(
      page,
      (want) => document.querySelector('mat-calc-tags-editor .ei-hl .t-err')?.textContent === want,
      `KHONG.CO${i}`,
      3000,
    );
    bad.push(Date.now() - b0);
  }
  const sb = stats(bad);
  check(
    `SC-015: lỗi biểu thức hiện ≤ 500 ms sau khi ngừng gõ (lớn nhất ${sb.max} ms)`,
    sb.max <= 500,
    JSON.stringify(sb),
  );
  writeFileSync(
    join(here, 'out', 'calc.json'),
    JSON.stringify({ suggestMs: s, errorMs: sb, calcRows, openMs }, null, 2),
  );
}
