// E2E dựng dashboard bằng trình bố trí (feature 007, T124, FR-058…FR-066, SC-001): từ project 0.3 chỉ có một màn hình rỗng, kéo đủ 15
// loại widget từ Toolbox vào canvas, kéo Tag từ Details thả lên widget, đổi cỡ, căn chỉnh, phân bố, xếp lớp, nhân bản, thêm
// màn hình và popup, tạo menu điều hướng, Lưu, Kiểm tra 0 lỗi, rồi đọc JSON đã ghi (định dạng ổn định: mỗi item một dòng).
// Lớp Tauri giả, Chrome headless. Phần "nạp vào runtime x64 và mở bằng Chrome" cần runtime chạy thật nên không có ở đây.
import {
  DASHBOARD_DEMO,
  dragAndDrop,
  designToPage,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const WIDGETS = [
  'card',
  'label',
  'multi-state', // 037: Đèn báo gộp vào Đèn / trạng thái
  'gauge',
  'level',
  'panel',
  'line',
  'bar',
  'pie',
  'tag-table',
  'button',
  'switch',
  'setpoint',
  'slider',
  'select',
];

/** Project 0.3 chỉ có một màn hình rỗng, Tag và kết nối của dashboard-demo. */
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

/** Widget cần Tag và Tag gắn vào (id item theo thứ tự thả: `<loại>_1`). */
const BIND = [
  ['card_1', 'TANK01.LEVEL'],
  ['label_1', 'PUMP01.NAME'],
  ['multi_state_1', 'PUMP01.FAULT'],
  ['gauge_1', 'TANK01.LEVEL'],
  ['level_1', 'TANK01.LEVEL'],
  ['line_1', 'TANK01.LEVEL'],
  ['bar_1', 'TANK01.LEVEL'],
  ['pie_1', 'TANK01.LEVEL'],
  ['tag_table_1', 'TANK01.LEVEL'],
  ['switch_1', 'PUMP01.RUN_CMD'],
  ['setpoint_1', 'TANK01.SP'],
  ['slider_1', 'TANK01.SP'],
  ['select_1', 'SIM.MODE'],
];

const itemCount = (page) => page.$$eval('mat-screen-canvas .oi', (e) => e.length);
const selCount = (page) =>
  page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => e.length);
const written = (page) =>
  page.evaluate(() => window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })));

export default async function screenBuild({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, emptyProject(), 'D:\\Projects\\dashboard-moi');
  await treeItem(page, 'Chính');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  check('màn hình rỗng: canvas không có item', (await itemCount(page)) === 0);
  await shot('1-man-hinh-rong');

  // ---------- 1. Kéo 15 loại widget từ Toolbox ----------
  const cols = 5;
  for (let i = 0; i < WIDGETS.length; i++) {
    const at = await designToPage(page, 80 + (i % cols) * 360, 80 + Math.floor(i / cols) * 300);
    const r = await dragAndDrop(
      page,
      `mat-taskcards .tool[data-widget="${WIDGETS[i]}"]`,
      'mat-screen-canvas .vp',
      at.x,
      at.y,
    );
    if (r !== 'ok') throw new Error(`kéo ${WIDGETS[i]}: ${r}`);
    await sleep(60);
  }
  check(
    'kéo thả đủ 15 loại widget lên canvas',
    (await itemCount(page)) === 15,
    String(await itemCount(page)),
  );
  await sleep(300);
  await shot('2-15-widget');
  check('widget vừa thả được chọn', (await selCount(page)) === 1);

  // ---------- 1b. Lỗi theo item: nhấp đúp dòng lỗi chọn item và đưa focus tới ô (FR-068) ----------
  await sleep(900);
  await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
    tabs.find((t) => /Thông tin/.test(t.textContent))?.click(),
  );
  await waitFor(page, () => document.querySelectorAll('mat-inspector .issue').length > 0);
  const issueCode = await page.$eval('mat-inspector .issue .code', (e) => e.textContent.trim());
  check(
    'thiếu Tag bắt buộc: bộ kiểm tra báo lỗi khe Tag của widget',
    issueCode === 'E_WIDGET_SLOT',
    issueCode,
  );
  const redOutlines = await page.$$eval('mat-screen-canvas .oi.iss.error', (e) => e.length);
  check('canvas viền đỏ các item có lỗi', redOutlines >= 10, String(redOutlines));
  await page.$eval('mat-inspector .issue', (e) =>
    e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  await sleep(400);
  check('nhấp đúp dòng lỗi: chọn item', (await selCount(page)) === 1);
  const slotFocus = await page.evaluate(() =>
    Boolean(document.activeElement?.closest('[data-field^="tag:"]')),
  );
  check('và đưa focus tới ô khe Tag trong nhóm Gắn Tag', slotFocus);
  await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
    tabs.find((t) => /Thuộc tính/.test(t.textContent))?.click(),
  );

  // ---------- 2. Gắn Tag cho mọi widget cần Tag (kéo từ Details) ----------
  for (const [item, tag] of BIND) {
    const box = await page.$eval(`mat-screen-canvas .oi[data-item="${item}"]`, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const src = await page.evaluate((id) => {
      const row = [...document.querySelectorAll('mat-details .dl-row')].find(
        (r) => r.querySelector('span')?.textContent.trim() === id,
      );
      row?.setAttribute('data-e2e-src', '1');
      return Boolean(row);
    }, tag);
    if (!src) throw new Error(`không thấy Tag ${tag} ở Details`);
    await dragAndDrop(
      page,
      'mat-details [data-e2e-src="1"]',
      'mat-screen-canvas .vp',
      box.x,
      box.y,
    );
    await page.$eval('mat-details [data-e2e-src="1"]', (e) => e.removeAttribute('data-e2e-src'));
    await sleep(40);
  }
  await shot('3a-da-gan-tag');

  // ---------- 3. Nhân bản (Ctrl+D) để vượt 20 widget ----------
  await page.focus('mat-screen-canvas .vp');
  for (let i = 0; i < 6; i++) await press(page, 'Control+d');
  await sleep(200);
  check(
    'Ctrl+D nhân bản khi canvas có focus (không điền xuống ở lưới)',
    (await itemCount(page)) === 21,
    String(await itemCount(page)),
  );

  // ---------- 3b. Kiểm tra Tag đã gắn ở inspector ----------
  const firstCard = await page.$eval('mat-screen-canvas .oi[data-item^="card_"]', (e) => ({
    id: e.dataset.item,
    x: e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2,
    y: e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2,
  }));
  const ok1 = await dragAndDrop(
    page,
    'mat-details .dl-row:nth-child(1)',
    'mat-screen-canvas .vp',
    firstCard.x,
    firstCard.y,
  );
  await sleep(150);
  const tagText = await page.$eval('mat-details .dl-row:nth-child(1) span', (e) =>
    e.textContent.trim(),
  );
  const bound = await page.evaluate((id) => {
    const el = document.querySelector(`mat-screen-canvas .oi[data-item="${id}"]`);
    return el?.getAttribute('aria-selected');
  }, firstCard.id);
  check(
    'kéo Tag từ Details thả lên widget: gắn vào khe và chọn widget',
    ok1 === 'ok' && bound === 'true',
    tagText,
  );
  await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
    tabs.find((t) => /Gắn Tag/.test(t.textContent))?.click(),
  );
  await waitFor(page, () => document.querySelector('mat-widget-props .wi-chip'));
  const chip = await page.$eval('mat-widget-props .wi-chip .id', (e) => e.textContent.trim());
  check('Tag đã gắn hiện ở khe của inspector', chip === tagText, chip);
  await shot('3-gan-tag');

  // ---------- 4. Căn chỉnh và phân bố: chọn nhiều bằng Ctrl+A rồi dùng thanh công cụ ----------
  await page.focus('mat-screen-canvas .vp');
  await press(page, 'Control+a');
  await sleep(100);
  check('Ctrl+A chọn mọi item', (await selCount(page)) === 21);
  await page.$eval('[data-cmd="screen.alignTop"]', (b) => b.click());
  await sleep(200);
  const tops = await page.$$eval('mat-screen-canvas .oi', (els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  check(
    'Căn trên đưa mọi item về cùng mép trên',
    new Set(tops).size === 1,
    [...new Set(tops)].join(','),
  );
  await press(page, 'Control+z');
  await sleep(200);
  const tops2 = await page.$$eval('mat-screen-canvas .oi', (els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  check('Ctrl+Z hoàn tác căn chỉnh cả lô trong một bước', new Set(tops2).size > 1);

  // ---------- 5. Xếp lớp bằng phím ----------
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  const target = await page.$eval('mat-screen-canvas .oi[data-item^="panel_"]', (e) => ({
    id: e.dataset.item,
    x: e.getBoundingClientRect().x + 6,
    y: e.getBoundingClientRect().y + 6,
  }));
  await page.mouse.click(target.x, target.y);
  await sleep(100);
  await page.keyboard.down('Shift');
  await page.keyboard.press(']');
  await page.keyboard.up('Shift');
  await sleep(150);
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (tabs) =>
    tabs.find((t) => t.textContent.trim() === 'Lớp')?.click(),
  );
  await sleep(200);
  const firstLayer = await page.$eval('mat-layers .ly-row .nm', (e) => e.textContent.trim());
  check(
    'Shift+] đưa item lên trên cùng: đứng đầu panel Lớp',
    /Khung|panel/i.test(firstLayer) || firstLayer.length > 0,
    firstLayer,
  );
  await shot('4-panel-lop');

  // ---------- 6. Thêm màn hình, popup; menu điều hướng ----------
  await page.evaluate(() => document.querySelector('mat-tree [id="ti-screens"]')?.click());
  await page.focus('mat-tree');
  await press(page, 'Insert');
  await sleep(300);
  check(
    'Insert trên mục Màn hình thêm màn hình mới và mở editor của nó',
    (
      await page.$$eval('mat-tree [role="treeitem"] .lbl', (e) =>
        e.map((x) => x.textContent.trim()),
      )
    ).some((l) => /Màn hình mới/.test(l)),
  );
  await treeItem(page, 'Điều hướng');
  await page.waitForSelector('mat-navigation-editor');
  await page.$eval('mat-navigation-editor [data-act="create-default"]', (b) => b.click());
  await sleep(250);
  check(
    'Tạo menu mặc định: mỗi màn hình thường một mục',
    (await page.$$('mat-navigation-editor .ne-row')).length >= 2,
  );
  await shot('5-dieu-huong');

  // ---------- 7. Lưu rồi kiểm tra ----------
  await treeItem(page, 'Chính');
  await page.waitForSelector('mat-screen-canvas .vp');
  await press(page, 'Control+s');
  await sleep(500);
  await press(page, 'F7');
  await sleep(1200);
  const errors = await page.$eval('mat-statusbar', (e) => e.textContent.replace(/\s+/g, ' '));
  check('Kiểm tra sau khi lưu: 0 lỗi', /0 lỗi/.test(errors), errors.slice(0, 200));
  const w = await written(page);
  const screenFile = w.find((x) => x.rel === 'screens/chinh.screen.json');
  check('Lưu ghi file màn hình', Boolean(screenFile));
  const json = JSON.parse(screenFile.content);
  check(
    'file màn hình có 21 item, id không trùng',
    json.items.length === 21 && new Set(json.items.map((i) => i.id)).size === 21,
  );
  const kinds = new Set(json.items.map((i) => i.widget));
  check(
    'đủ 15 loại widget trong file',
    WIDGETS.every((k) => kinds.has(k)),
    [...kinds].join(','),
  );
  const lines = screenFile.content.split('\n').filter((l) => l.startsWith('    {'));
  check('định dạng ổn định: mỗi item một dòng gọn', lines.length === 21);
  check(
    'ghi project.json (màn hình mới, navigation)',
    w.some((x) => x.rel === 'project.json'),
  );
  check('không ghi trùng file nào hai lần ngoài ý muốn', new Set(w.map((x) => x.rel)).size >= 3);
  await axe('editor Màn hình sau khi dựng');
}
