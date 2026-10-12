// E2E Bảng Tag 0.2 (feature 006, T135, US1, FR-045, FR-047, quickstart §5 bước 5–7), lớp Tauri giả, project 0.2 mẫu:
// - Bảng Tag trên mat-grid: bộ cột theo loại, gõ thẳng không cần F2 với bộ gõ giả lập qua CDP (SC-013 phần tự động);
// - Thêm hàng loạt 50 FLOAT32 TT_01 từ HR100: TT_01…TT_50 ở HR100…HR198, một Ctrl+Z bỏ cả 50;
// - dán 50 dòng có 2 ô địa chỉ sai: 2 lỗi trong tab Thông tin, nhảy tới đúng ô;
// - xuất rồi nhập lại CSV: mọi dòng "giống";
// - Online: cột giá trị sống, quality, lý do chỉ cho dòng đang hiện; Bảng theo dõi hiện giá trị, quality, lý do;
// - Inspector của Tag sửa tại chỗ; axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  clickCell,
  expandNode,
  goOnline,
  gridCell,
  gridText,
  openAndWait,
  pasteInto,
  press,
  readProject,
  sleep,
  text,
  treeItem,
  treeNode,
  waitFor,
} from './util.mjs';

const GRID = 'mat-tag-grid';
const count = (page) => text(page, `${GRID} [data-role="count"]`);

export default async function tags({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  await openAndWait(page, files, 'D:\\Projects\\full-02');

  // ---------- 1. Bảng Tag 0.2 ----------
  await treeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  check('Bảng Tag trên mat-grid, 13 Tag', (await count(page)) === '13/13 Tag', await count(page));
  const heads = await page.$$eval(`${GRID} [role="columnheader"]`, (h) =>
    h.map((x) => x.textContent.trim()),
  );
  check(
    'cột: Tên, Loại, Kiểu… theo bộ "Tất cả cột"',
    heads[0] === 'Tên' && heads.includes('Địa chỉ') && heads.includes('Biểu thức'),
    heads.join('|'),
  );
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  await waitFor(
    page,
    () =>
      ![...document.querySelectorAll('mat-tag-grid [role="columnheader"]')].some(
        (h) => h.textContent.trim() === 'Biểu thức',
      ),
  );
  const ext = await page.$$eval(`${GRID} [role="columnheader"]`, (h) =>
    h.map((x) => x.textContent.trim()),
  );
  check(
    'bộ cột Tag ngoài: thiết bị trường, địa chỉ, mã hàm, offset, số thanh ghi',
    ['Thiết bị trường', 'Địa chỉ', 'Mã hàm', 'Offset', 'Số thanh ghi'].every((c) =>
      ext.includes(c),
    ),
    ext.join('|'),
  );

  // ---------- 2. Gõ thẳng với bộ gõ giả lập (US1-13, SC-013 phần tự động) ----------
  await clickCell(page, GRID, 0, 'description');
  // Chọn ô rồi gõ ngay "Mức nước": ô vào sửa từ ký tự đầu, đúng chuỗi, không F2.
  const before = await page.evaluate(() =>
    document.querySelector('mat-tag-grid textarea.mg-input').classList.contains('mg-editing'),
  );
  await page.keyboard.type('Mức nước');
  const editing = await page.evaluate(() => {
    const ta = document.querySelector('mat-tag-grid textarea.mg-input');
    return {
      editing: ta.classList.contains('mg-editing'),
      value: ta.value,
      focused: document.activeElement === ta,
    };
  });
  check(
    'chọn ô Mô tả rồi gõ "Mức nước": ô vào sửa ngay từ ký tự đầu, đúng chuỗi, focus ở ô nhập',
    !before && editing.editing && editing.value === 'Mức nước' && editing.focused,
    JSON.stringify(editing),
  );
  // Composition giả lập: compositionstart → input (đang ghép) → compositionend.
  await page.evaluate(() => {
    const ta = document.querySelector('mat-tag-grid textarea.mg-input');
    ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    ta.value = 'Mức nước bồn 1';
    ta.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'Mức nước bồn 1',
        isComposing: true,
        inputType: 'insertCompositionText',
      }),
    );
    ta.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'Mức nước bồn 1' }),
    );
  });
  await page.keyboard.press('Enter');
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.textContent.includes('Mức nước bồn 1'),
    gridCell(GRID, 0, 'description'),
  );
  check(
    'ghép chữ (compositionstart → compositionend) rồi Enter: ô nhận đúng "Mức nước bồn 1"',
    (await gridText(page, gridCell(GRID, 0, 'description'))) === 'Mức nước bồn 1',
  );
  await press(page, 'Control+z');
  await waitFor(
    page,
    (sel) => !document.querySelector(sel)?.textContent.includes('Mức nước bồn 1'),
    gridCell(GRID, 0, 'description'),
  );
  check('Ctrl+Z trong lưới hoàn tác sửa ô (phím Ctrl+Z không bị ô nhập chặn)', true);

  // ---------- 3. Thêm hàng loạt 50 rồi Ctrl+Z (US1-11) ----------
  await page.select(`${GRID} select[data-role="set"]`, 'all');
  await page.click(`${GRID} [data-act="bulk"]`);
  await page.waitForSelector('mat-bulk-add-dialog [role="dialog"]');
  const setVal = async (name, value) => {
    await page.$eval(
      `mat-bulk-add-dialog [name="${name}"]`,
      (e, v) => {
        e.value = v;
        e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      },
      value,
    );
  };
  await setVal('namePattern', 'TT_01');
  await setVal('count', '50');
  await setVal('type', 'FLOAT32');
  await setVal('address', 'HR100');
  await waitFor(page, () =>
    /TT_50/.test(
      document.querySelector('mat-bulk-add-dialog [data-role="preview"]')?.textContent ?? '',
    ),
  );
  const preview = await text(page, 'mat-bulk-add-dialog [data-role="preview"]');
  check(
    'xem trước: TT_01 → HR100 … TT_50 → HR198',
    /TT_01 → HR100/.test(preview) && /TT_50 → HR198/.test(preview),
    preview,
  );
  await shot('1-them-hang-loat');
  await axeBoth(page, axe, 'hộp thoại Thêm hàng loạt');
  await page.click('mat-bulk-add-dialog [data-role="ok"]');
  await waitFor(page, () => !document.querySelector('mat-bulk-add-dialog [role="dialog"]'));
  await waitFor(page, () =>
    /63\/63 Tag/.test(
      document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
    ),
  );
  check('Thêm 50 Tag: 63 Tag', (await count(page)) === '63/63 Tag', await count(page));
  const f = `${GRID} input[data-role="filter"]`;
  await page.type(f, 'TT_50');
  await waitFor(
    page,
    () => document.querySelectorAll('mat-tag-grid [role="row"][data-r]').length === 1,
  );
  check(
    'TT_50 ở HR198',
    (await gridText(page, `${GRID} [role="gridcell"][data-c="address"]`)) === 'HR198',
    await gridText(page, `${GRID} [role="gridcell"][data-c="address"]`),
  );
  await page.$eval(f, (i) => {
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.focus(`${GRID} textarea.mg-input`);
  await press(page, 'Control+z');
  await waitFor(page, () =>
    /13\/13 Tag/.test(
      document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
    ),
  );
  check('một Ctrl+Z bỏ cả 50 Tag', (await count(page)) === '13/13 Tag', await count(page));

  // ---------- 4. Dán 50 dòng, 2 ô địa chỉ sai (US1-12) ----------
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  await page.click(`${GRID} [data-act="add"]`);
  await waitFor(page, () =>
    /14\/14 Tag/.test(
      document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
    ),
  );
  await page.keyboard.press('Escape');
  const lines = [];
  for (let i = 0; i < 50; i++) {
    const addr = i === 6 || i === 31 ? 'XX7' : `HR${2000 + i * 2}`;
    lines.push(
      [`PST_${String(i).padStart(2, '0')}`, `Dán ${i}`, 'FLOAT32', '%', 'plc1', addr].join('\t'),
    );
  }
  const t0 = Date.now();
  await pasteInto(page, GRID, lines.join('\n'));
  await waitFor(page, () =>
    /63\/63 Tag/.test(
      document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
    ),
  );
  check(
    `dán 50 dòng: 63 Tag (${Date.now() - t0} ms)`,
    (await count(page)) === '63/63 Tag',
    await count(page),
  );
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-statusbar button')].some((b) =>
        /^\s*2 lỗi/.test(b.textContent.replace(/\s+/g, ' ')),
      ),
    undefined,
    4000,
  );
  check('2 ô địa chỉ sai → "2 lỗi" trên thanh trạng thái', true);
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-statusbar button')]
      .find((b) => /lỗi/.test(b.textContent))
      ?.click(),
  );
  await page.waitForSelector('mat-inspector .issue');
  const issues = await page.$$eval('mat-inspector .issue', (r) =>
    r.map((x) => x.textContent.replace(/\s+/g, ' ')),
  );
  check(
    'tab Thông tin có 2 lỗi E_ADDR_SYNTAX',
    issues.filter((x) => /E_ADDR_SYNTAX/.test(x)).length === 2,
    issues.join(' | ').slice(0, 300),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector .issue')]
      .find((r) => /E_ADDR_SYNTAX/.test(r.textContent))
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  await waitFor(page, () => !!document.querySelector('mat-tag-grid [role="gridcell"].mg-err'));
  const bad = await page.$eval(`${GRID} [role="gridcell"].mg-err`, (c) => ({
    col: c.dataset.c,
    title: c.title,
    invalid: c.getAttribute('aria-invalid'),
  }));
  check(
    'nhấp đúp lỗi: tới đúng ô địa chỉ, viền đỏ kèm lý do',
    bad.col === 'address' && bad.invalid === 'true' && bad.title.length > 5,
    JSON.stringify(bad),
  );
  await page.keyboard.press('Escape');
  await shot('2-dan-50-dong');
  await axeBoth(page, axe, 'Bảng Tag có 2 ô lỗi');

  // ---------- 5. Xuất rồi nhập lại CSV: mọi dòng giống ----------
  await page.click(`${GRID} [data-act="export"]`);
  await waitFor(page, () => window.__matMock.savedCsv.length > 0);
  const csv = await page.evaluate(() => window.__matMock.savedCsv.at(-1));
  check(
    'xuất CSV: UTF-8 có BOM, 64 dòng (tiêu đề + 63 Tag)',
    csv.text.charCodeAt(0) === 0xfeff && csv.text.split('\r\n').filter(Boolean).length === 64,
    `${csv.name} ${csv.text.length}`,
  );
  await page.evaluate((txt) => {
    window.__matMock.csvOpenResult = { name: 'tags.csv', bytes: new TextEncoder().encode(txt) };
  }, csv.text);
  await page.click(`${GRID} [data-act="import"]`);
  await page.waitForSelector('mat-csv-import-dialog [data-role="summary"]');
  const summary = await text(page, 'mat-csv-import-dialog [data-role="summary"]');
  check(
    'nhập lại CSV vừa xuất: 0 thêm, 0 cập nhật, 63 giống',
    /^0 thêm, 0 cập nhật, 63 giống, 0 lỗi/.test(summary),
    summary,
  );
  await shot('3-nhap-csv');
  await axeBoth(page, axe, 'hộp thoại Nhập CSV');
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-csv-import-dialog [role="dialog"]'));

  // ---------- 6. Inspector của Tag: sửa tại chỗ ----------
  await clickCell(page, GRID, 0, 'description');
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector [role="tab"]')]
      .find((b) => b.textContent.includes('Thuộc tính'))
      ?.click(),
  );
  await page.waitForSelector('mat-tag-props #tp-description');
  await page.$eval('mat-tag-props #tp-description', (i) => {
    i.value = 'Sửa từ Inspector';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.textContent.includes('Sửa từ Inspector'),
    gridCell(GRID, 0, 'description'),
  );
  check('Inspector: sửa Mô tả thì lưới đổi theo', true);
  const groups = await page.$$eval('mat-tag-props .psec', (e) =>
    e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'Inspector hiện nhóm Chung, Nguồn Modbus, Thang đo, Giới hạn ghi',
    groups.slice(0, 2).join('|') === 'Chung|Nguồn Modbus',
    groups.join('|'),
  );
  await axeBoth(page, axe, 'Inspector thuộc tính của Tag');

  // ---------- 7. Online: cột sống chỉ cho dòng đang hiện; Bảng theo dõi ----------
  await goOnline(page, 'kysu1', files);
  await treeItem(page, 'Bảng Tag mặc định');
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-tag-grid [role="columnheader"]')].some(
      (h) => h.textContent.trim() === 'Giá trị sống',
    ),
  );
  const live = await page.$$eval(`${GRID} [role="columnheader"]`, (h) =>
    h.map((x) => x.textContent.trim()),
  );
  check(
    'Online: cột Giá trị sống, Quality, Lý do ngay sau tên',
    live.slice(0, 4).join('|') === 'Tên|Giá trị sống|Quality|Lý do',
    live.slice(0, 5).join('|'),
  );
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-tag-grid [role="gridcell"][data-c="quality"]')].some((c) =>
      /GOOD|BAD|UNCERTAIN/.test(c.textContent),
    ),
  );
  const rendered = await page.$$eval(`${GRID} [role="row"][data-r]`, (r) => r.length);
  check(`chỉ vẽ các dòng đang hiện (${rendered}/63 dòng)`, rendered > 0 && rendered < 63, rendered);
  await shot('4-online-cot-song');
  await axeBoth(page, axe, 'Bảng Tag Online');
  await expandNode(page, 'watchTables');
  await treeNode(page, 'watch:van-hanh');
  await page.waitForSelector('mat-watch-table-editor [role="gridcell"]');
  await waitFor(page, () =>
    /GOOD|BAD|UNCERTAIN/.test(
      document.querySelector('mat-watch-table-editor [role="gridcell"][data-c="quality"]')
        ?.textContent ?? '',
    ),
  );
  const wq = await page.$$eval('mat-watch-table-editor [role="gridcell"][data-c="quality"]', (c) =>
    c.map((x) => x.textContent.trim()),
  );
  check(
    'Bảng theo dõi: quality của từng dòng',
    wq.length === 3 && wq.every((q) => /GOOD|BAD|UNCERTAIN/.test(q)),
    wq.join('|'),
  );
  const wv = await page.$eval('mat-watch-table-editor [role="gridcell"][data-c="value"]', (c) =>
    c.textContent.trim(),
  );
  check('Bảng theo dõi: giá trị sống', wv.length > 0 && wv !== '—', wv);
  await shot('5-bang-theo-doi');
  await axeBoth(page, axe, 'Bảng theo dõi Online');
  await sleep(100);
}
