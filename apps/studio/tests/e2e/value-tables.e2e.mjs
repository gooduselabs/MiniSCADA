// E2E Bảng giá trị và Tag giữ qua mất điện (feature 006, T192, US4-7, US4-8, US4-10, FR-046, FR-048, quickstart §5 bước 19), lớp
// Tauri giả và thiết bị giả:
// - Bảng giá trị TrangThaiBom: lưới mục và dòng mặc định, ô thử (1 → Chạy xanh lá; 12 → Bảo trì), hai khoảng chồng nhau báo
//   E_VT_OVERLAP tại ô kèm khối lỗi, bộ chọn màu, "Dùng ở đâu", Ctrl+Z;
// - Bảng theo dõi hiện "Chạy" màu xanh lá khi PUMP01.STATE = 1 (Online, thiết bị giả);
// - xem trước Nạp xuống có dòng "Tag giữ qua mất điện" liệt kê Tag đổi kiểu và Tag bị xóa, không có Tag cùng tên cùng kiểu;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  expandNode,
  goOnline,
  gridCell,
  openAndWait,
  press,
  readProject,
  sleep,
  text,
  treeNode,
  typeInto,
  waitFor,
} from './util.mjs';

const VT = 'mat-value-table-editor';
const WT = 'mat-watch-table-editor';
const DL = 'mat-download-dialog';

const cell = (r, c) => gridCell(VT, r, c);
const rowCount = (page) => page.$$eval(`${VT} [role="row"][data-r]`, (r) => r.length);

async function typeCell(page, r, c, value) {
  await page.click(cell(r, c));
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await sleep(120);
}

async function tryValue(page, v) {
  await typeInto(page, `${VT} input[data-role="try"]`, v);
  await sleep(120);
  return text(page, `${VT} [data-role="try-result"]`);
}

export default async function valueTables({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  // Máy có thêm Tag giữ qua mất điện: RET1 INT16, KEEP FLOAT32; thiết bị có RET1 FLOAT32, GONE, KEEP.
  const tags = JSON.parse(files['tags.json']);
  const internal = (id, type) => ({ id, kind: 'internal', type, retain: true, initial: 0 });
  const local = {
    ...files,
    'tags.json': JSON.stringify({
      ...tags,
      tags: [...tags.tags, internal('RET1', 'INT16'), internal('KEEP', 'FLOAT32')],
    }),
  };
  const device = {
    ...files,
    'tags.json': JSON.stringify({
      ...tags,
      tags: [
        ...tags.tags,
        internal('RET1', 'FLOAT32'),
        internal('GONE', 'FLOAT32'),
        internal('KEEP', 'FLOAT32'),
      ],
    }),
  };
  await openAndWait(page, local, 'D:\\Projects\\full-02');

  // ---------- 1. Bảng giá trị ----------
  await expandNode(page, 'valueTables');
  await treeNode(page, 'valuetable:TrangThaiBom');
  await page.waitForSelector(`${VT} [role="gridcell"]`);
  check(
    'lưới 4 mục và dòng mặc định ở cuối (5 dòng)',
    (await rowCount(page)) === 5,
    String(await rowCount(page)),
  );
  check(
    'dòng mặc định có nhãn "(mặc định)"',
    /mặc định/.test((await text(page, cell(4, 'value'))) ?? ''),
  );
  const swatch = await page.$eval(
    `${cell(1, 'color')} .mg-swatch`,
    (e) => getComputedStyle(e).backgroundColor,
  );
  check('mục "Chạy" có ô màu xanh lá kèm mã #2E7D32', swatch === 'rgb(46, 125, 50)', swatch);
  await shot('1-bang-gia-tri');
  await axeBoth(page, axe, 'editor Bảng giá trị');

  // ---------- 2. Ô thử ----------
  const one = await tryValue(page, '1');
  check('ô thử 1 → Chạy (mục 2) kèm ô màu', /Chạy/.test(one ?? '') && /mục 2/.test(one ?? ''), one);
  const sw = await page
    .$eval(`${VT} [data-role="try-result"] .vt-swatch`, (e) => getComputedStyle(e).backgroundColor)
    .catch(() => null);
  check('ô thử 1: ô màu xanh lá', sw === 'rgb(46, 125, 50)', String(sw));
  const twelve = await tryValue(page, '12');
  check(
    'ô thử 12 → Bảo trì (mục 4)',
    /Bảo trì/.test(twelve ?? '') && /mục 4/.test(twelve ?? ''),
    twelve,
  );
  const def = await tryValue(page, '20');
  check(
    'ô thử 20 (ngoài khoảng [10, 20)) → mặc định "Không rõ"',
    /Không rõ/.test(def ?? '') && /mặc định/.test(def ?? ''),
    def,
  );
  await shot('2-o-thu');

  // ---------- 3. Hai khoảng chồng nhau ----------
  await page.click(`${VT} [data-act="add"]`);
  await waitFor(
    page,
    () => document.querySelectorAll('mat-value-table-editor [role="row"][data-r]').length === 6,
  );
  await typeCell(page, 4, 'value', '[15, 25)');
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-value-table-editor [role="gridcell"][data-r="4"][data-c="value"]')
        ?.getAttribute('aria-invalid') === 'true',
    undefined,
    3000,
  );
  const title = await page.$eval(cell(4, 'value'), (e) => e.getAttribute('title'));
  check(
    'hai khoảng chồng nhau: ô khóa của mục sau báo E_VT_OVERLAP kèm mục bị chồng',
    /E_VT_OVERLAP/.test(title ?? '') && /mục 4/.test(title ?? ''),
    title,
  );
  const issues = await text(page, `${VT} [data-role="issues"]`);
  check('khối lỗi liệt kê E_VT_OVERLAP', /E_VT_OVERLAP/.test(issues ?? ''), issues);
  await shot('3-chong-nhau');
  await axeBoth(page, axe, 'Bảng giá trị có lỗi chồng nhau');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.click(cell(0, 'text'));
  await press(page, 'Control+z');
  await press(page, 'Control+z');
  await sleep(200);
  check(
    'Ctrl+Z hai lần trả lại bảng 4 mục',
    (await rowCount(page)) === 5,
    String(await rowCount(page)),
  );

  // ---------- 4. Bộ chọn màu ----------
  await page.click(cell(2, 'text'));
  await page.$eval(`${VT} input[type="color"]`, (i) => {
    i.value = '#ff0000';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(150);
  const red = await page.$eval(
    `${cell(2, 'color')} .mg-swatch`,
    (e) => getComputedStyle(e).backgroundColor,
  );
  check('bộ chọn màu đổi màu của dòng đang chọn', red === 'rgb(255, 0, 0)', red);
  await press(page, 'Control+z');
  await sleep(150);
  const back = await page.$eval(
    `${cell(2, 'color')} .mg-swatch`,
    (e) => getComputedStyle(e).backgroundColor,
  );
  check('Ctrl+Z trả lại màu cũ', back === 'rgb(198, 40, 40)', back);

  // ---------- 5. Dùng ở đâu ----------
  const used = await page.$$eval(`${VT} .xref li button`, (b) =>
    b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    '"Dùng ở đâu": Tag có valueTable, biểu thức text() và hai binding',
    used.length === 4 &&
      used.some((u) => /PUMP01\.STATE \(bảng giá trị của Tag\)/.test(u)) &&
      used.some((u) => /Biểu thức của PUMP01\.STATE_TEXT/.test(u)),
    used.join(' | '),
  );

  // ---------- 6. Bảng theo dõi: "Chạy" xanh lá khi PUMP01.STATE = 1 (US4-7) ----------
  await goOnline(page, 'kysu1', device);
  await page.evaluate(() =>
    window.__matMock.device.setTag('BL335-01', 'PUMP01.STATE', { value: 1, quality: 'GOOD' }),
  );
  await expandNode(page, 'watchTables');
  await treeNode(page, 'watch:van-hanh');
  await page.waitForSelector(`${WT} [role="gridcell"]`);
  await waitFor(
    page,
    () =>
      /Chạy/.test(
        document.querySelector(
          'mat-watch-table-editor [role="gridcell"][data-r="1"][data-c="text"]',
        )?.textContent ?? '',
      ),
    undefined,
    6000,
  );
  const chip = await page.$eval(
    `${WT} [role="gridcell"][data-r="1"][data-c="text"] .ww-sw`,
    (e) => getComputedStyle(e).backgroundColor,
  );
  check(
    'Bảng theo dõi hiện "Chạy" với chấm màu xanh lá khi PUMP01.STATE = 1',
    chip === 'rgb(46, 125, 50)',
    chip,
  );
  await shot('4-bang-theo-doi-chay');
  await axeBoth(page, axe, 'Bảng theo dõi có chữ và màu theo bảng giá trị');

  // ---------- 7. Xem trước Nạp xuống: Tag giữ qua mất điện ----------
  await press(page, 'Control+l');
  await page.waitForSelector(`${DL} tr[data-row="device"]`, { timeout: 10000 });
  await waitFor(
    page,
    () =>
      !/Đang/.test(
        document.querySelector('mat-download-dialog tr[data-row="retain"]')?.textContent ?? 'Đang',
      ),
    undefined,
    8000,
  );
  const retain = await text(page, `${DL} tr[data-row="retain"]`);
  const replaceRow = await page.$$eval(`${DL} tr[data-row]`, (r) =>
    r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' || '),
  );
  check(
    'dòng "Tag giữ qua mất điện" có trong xem trước',
    /Tag giữ qua mất điện/.test(retain ?? ''),
    retain,
  );
  check(
    'liệt kê RET1 (đổi kiểu FLOAT32 → INT16) và GONE (bị xóa)',
    /RET1 \(đổi kiểu FLOAT32 → INT16\)/.test(retain ?? '') && /GONE \(bị xóa\)/.test(retain ?? ''),
    `${retain} | ${replaceRow}`,
  );
  check(
    'Tag cùng tên, cùng kiểu (KEEP) không có trong danh sách',
    !/KEEP/.test(retain ?? ''),
    retain,
  );
  await shot('5-nap-xuong-giu-qua-mat-dien');
  await axeBoth(page, axe, 'xem trước Nạp xuống có dòng Tag giữ qua mất điện');
}
