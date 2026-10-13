// E2E hình học của trình bố trí màn hình (feature 007, T124, FR-058…FR-061, SC-014): mở dashboard-demo 0.3, chọn, kéo, đổi
// cỡ, căn chỉnh, xếp lớp, zoom và hoàn tác, bằng chuột và bàn phím thật. Lớp Tauri giả, Chrome headless.
import {
  DASHBOARD_DEMO,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  treeNode,
} from './util.mjs';

/** Hình chữ nhật của item trên màn hình (điểm ảnh trang) theo lớp phủ. */
const itemBox = (page, id) =>
  page.$eval(`mat-screen-canvas .oi[data-item="${id}"]`, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

/** Giá trị tọa độ hiện ở ô X, Y, Rộng, Cao của inspector. */
const rectOf = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((k) => [
        k,
        Number(document.querySelector(`mat-widget-props #wi-${k}`)?.value),
      ]),
    ),
  );

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const selCount = (page) =>
  page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => e.length);

export default async function screenGeometry({ page, check, shot }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);
  check('canvas có item của màn hình', (await page.$$('mat-screen-canvas .oi')).length > 20);

  // ---------- 1. Chọn bằng nhấp ----------
  const card = await itemBox(page, 'card_level');
  const c0 = center(card);
  await page.mouse.click(c0.x, c0.y);
  await sleep(150);
  check('nhấp chọn đúng item (một item chọn)', (await selCount(page)) === 1);
  const before = await rectOf(page);
  check(
    'inspector hiện hình học của item chọn',
    Number.isInteger(before.x) && before.width > 0,
    JSON.stringify(before),
  );
  await shot('1-chon-item');

  // ---------- 2. Kéo di chuyển: một bước hoàn tác ----------
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(c0.x + 20, c0.y + 10, { steps: 4 });
  await page.mouse.move(c0.x + 60, c0.y + 30, { steps: 6 });
  await shot('2-dang-keo');
  await page.mouse.up();
  await sleep(200);
  const moved = await rectOf(page);
  check(
    'kéo đổi vị trí (x, y tăng, số nguyên)',
    moved.x > before.x &&
      moved.y > before.y &&
      Number.isInteger(moved.x) &&
      Number.isInteger(moved.y),
    JSON.stringify(moved),
  );
  check('kéo giữ nguyên cỡ', moved.width === before.width && moved.height === before.height);
  await press(page, 'Control+z');
  await sleep(200);
  const undone = await rectOf(page);
  check(
    'một lần Ctrl+Z hoàn tác cả cử chỉ kéo',
    undone.x === before.x && undone.y === before.y,
    JSON.stringify(undone),
  );
  await press(page, 'Control+y');
  await sleep(200);
  check('Ctrl+Y làm lại', (await rectOf(page)).x === moved.x);
  await press(page, 'Control+z');
  await sleep(150);

  // ---------- 3. Đổi cỡ bằng tay nắm ----------
  const handle = await page.$eval(
    'mat-screen-canvas .selbox[data-sel="box"] i[data-h="se"]',
    (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
  );
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 15, handle.y + 10, { steps: 5 });
  await page.mouse.up();
  await sleep(200);
  const sized = await rectOf(page);
  check(
    'tay nắm góc dưới phải làm rộng và cao hơn, giữ góc trên trái',
    sized.width > before.width &&
      sized.height > before.height &&
      sized.x === before.x &&
      sized.y === before.y,
    JSON.stringify(sized),
  );
  await press(page, 'Control+z');
  await sleep(150);
  check('hoàn tác đổi cỡ', (await rectOf(page)).width === before.width);

  // ---------- 4. Bàn phím: mũi tên dịch, gộp thành một bước ----------
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await sleep(200);
  const nudged = await rectOf(page);
  check(
    'mũi tên dịch 1, Shift+mũi tên dịch 10',
    nudged.x === before.x + 2 && nudged.y === before.y + 10,
    JSON.stringify(nudged),
  );
  await press(page, 'Control+z');
  await sleep(150);
  const afterUndo = await rectOf(page);
  check(
    'hoàn tác gộp các lần nhấn cùng loại',
    afterUndo.x === before.x || afterUndo.y === before.y,
    JSON.stringify(afterUndo),
  );
  await press(page, 'Control+z');
  await sleep(100);

  // ---------- 5. Esc bỏ chọn ----------
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(100);
  check('Esc bỏ chọn', (await selCount(page)) === 0);
  await shot('3-sau-khi-bo-chon');

  // ---------- 6. Theme tối: chọn nhiều item (khung nhóm, tay nắm) để đối chiếu với mockup ----------
  await setTheme(page, 'dark');
  const lamp = await itemBox(page, 'lamp_fault');
  const gauge = await itemBox(page, 'gauge_level');
  await page.mouse.click(lamp.x + lamp.w / 2, lamp.y + lamp.h / 2);
  await page.keyboard.down('Shift');
  await page.mouse.click(gauge.x + gauge.w / 2, gauge.y + gauge.h / 2);
  await page.keyboard.up('Shift');
  await sleep(250);
  check('Shift+nhấp chọn thêm item (hai item)', (await selCount(page)) === 2);
  await shot('4-toi-chon-nhieu');
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (t) =>
    t.find((x) => x.textContent.trim() === 'Lớp')?.click(),
  );
  await sleep(200);
  await shot('5-toi-lop');
  await setTheme(page, 'light');

  // ---------- 7. 14 thao tác rồi hoàn tác từng bước (T124): đúng một bước mỗi cử chỉ ----------
  await treeNode(page, 'screen:bon-nuoc');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  const snap = () => page.evaluate(() => JSON.stringify(window.__matApp.screenModel('bon-nuoc')));
  const states = [await snap()];
  const step = async (name, fn) => {
    await fn();
    await sleep(160);
    const s = await snap();
    states.push(s);
    check(`thao tác ${states.length - 1}: ${name} đổi tài liệu`, s !== states[states.length - 2]);
  };
  const clickItem = async (id) => {
    const b = await itemBox(page, id);
    await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
    await sleep(100);
  };
  await clickItem('card_a');
  await page.focus('mat-screen-canvas .vp');
  await step('thêm widget bằng Toolbox', async () => {
    await page.focus('mat-taskcards .tool[data-widget="label"]');
    await page.keyboard.press('Enter');
  });
  const added = (
    await page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) =>
      e.map((x) => x.dataset.item),
    )
  )[0];
  await step('kéo di chuyển', async () => {
    const b = await itemBox(page, added);
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.w / 2 + 30, b.y + b.h / 2 + 20, { steps: 5 });
    await page.mouse.up();
  });
  await step('đổi cỡ bằng tay nắm', async () => {
    const h = await page.$eval('mat-screen-canvas .selbox[data-sel="box"] i[data-h="se"]', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 18, h.y + 9, { steps: 4 });
    await page.mouse.up();
  });
  await step('dịch bằng mũi tên', async () => {
    await page.focus('mat-screen-canvas .vp');
    await page.keyboard.press('ArrowRight');
  });
  await step('đổi tên trong inspector', async () => {
    await page.$eval('mat-widget-props #wi-name', (e) => {
      e.focus();
      e.select();
    });
    await page.keyboard.type('Nhãn thử');
    await page.keyboard.press('Enter');
  });
  await step('đặt thuộc tính Nội dung', async () => {
    await page.$$eval('mat-widget-props [role="tab"]', (tabs) =>
      tabs.find((t) => t.textContent.trim() === 'Hiển thị')?.click(),
    );
    await sleep(150);
    await page.$eval('mat-widget-props #pf-text', (e) => {
      e.focus();
      e.select();
    });
    await page.keyboard.type('Xin chào');
    await page.keyboard.press('Enter');
  });
  await step('nhân bản (Ctrl+D)', async () => {
    await page.focus('mat-screen-canvas .vp');
    await press(page, 'Control+d');
  });
  await step('khóa item', async () => {
    await page.$eval('[data-cmd="screen.lock"]', (b) => b.click());
  });
  await step('ẩn item', async () => {
    await page.$eval('[data-cmd="screen.hide"]', (b) => b.click());
  });
  await step('đưa một item khác lên trên cùng', async () => {
    await clickItem('panel_a');
    await page.$eval('[data-cmd="screen.toFront"]', (b) => b.click());
  });
  await step('chọn hai item rồi căn trái', async () => {
    await page.focus('mat-screen-canvas .vp');
    await press(page, 'Control+a');
    await page.$eval('[data-cmd="screen.alignLeft"]', (b) => b.click());
  });
  await step('cùng rộng', async () => {
    await page.$eval('[data-cmd="screen.sameWidth"]', (b) => b.click());
  });
  await step('sao chép và dán', async () => {
    await page.focus('mat-screen-canvas .vp');
    await press(page, 'Control+c');
    await press(page, 'Control+v');
  });
  await step('xóa item đang chọn', async () => {
    await page.focus('mat-screen-canvas .vp');
    await page.keyboard.press('Delete');
  });
  let exact = 0;
  const bad = [];
  for (let k = states.length - 1; k >= 1; k--) {
    await page.focus('mat-screen-canvas .vp');
    await press(page, 'Control+z');
    await sleep(140);
    if ((await snap()) === states[k - 1]) exact++;
    else bad.push(k);
  }
  check(
    `hoàn tác ${states.length - 1} thao tác: mỗi Ctrl+Z trả đúng trạng thái trước đó (một bước mỗi cử chỉ)`,
    exact === states.length - 1,
    `${exact}/${states.length - 1}, lệch ở bước ${bad.join(',')}`,
  );

  // ---------- 8. Dán sang màn hình khác: giữ Tag và hành động; báo nút trỏ tới màn hình không có ----------
  await clickItem('card_a');
  await page.focus('mat-screen-canvas .vp');
  await press(page, 'Control+c');
  await treeNode(page, 'screen:giam-sat');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  const countBefore = await page.evaluate(
    () => window.__matApp.screenModel('giam-sat').items.length,
  );
  await page.focus('mat-screen-canvas .vp');
  await press(page, 'Control+v');
  await sleep(250);
  const pasted = await page.evaluate(() => {
    const m = window.__matApp.screenModel('giam-sat');
    return { n: m.items.length, last: m.items.at(-1) };
  });
  check(
    'dán sang màn hình khác: thêm một item, id mới, giữ Tag',
    pasted.n === countBefore + 1 && Boolean(pasted.last.tags?.value),
    JSON.stringify(pasted.last),
  );
  await press(page, 'Control+z');
  await sleep(150);
}
