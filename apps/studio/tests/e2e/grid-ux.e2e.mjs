// E2E feature 035 (trình soạn lưới dễ dùng): hàng trống mới thêm hiện rõ (≥ 110 px, viền nét đứt, chữ gợi ý), zoom chỉ
// hiển thị (nút, Ctrl+lăn chuột, Ctrl+0), kéo component sang hàng khác có chỉ báo vị trí thả, kéo tay nắm đổi thứ tự
// hàng, Ctrl+D và menu chuột phải nhân bản (hoàn tác được), Vùng màu của đồng hồ kim mỗi vùng một dòng có nhãn.
// Ảnh chụp: tests/e2e/out/grid-ux-*.png.
import { resolve } from 'node:path';
import {
  REPO,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const cellSel = (id) => `mat-grid-editor .ge-cell[data-cell="${id}"]`;
const rowsOf = (page) =>
  page.$eval('mat-grid-editor mat-screen', (s) =>
    [...s.shadowRoot.querySelectorAll('.row')].map((r) => r.dataset.rowId),
  );
const itemOf = (page, cell) =>
  page.$eval(
    'mat-grid-editor mat-screen',
    (s, c) => {
      const el = s.shadowRoot.querySelector(`.cell[data-cell-id="${c}"] .item`);
      return el ? el.dataset.itemId : null;
    },
    cell,
  );
const zoomText = (page) =>
  page.$eval('mat-grid-editor [data-act="zoom-100"]', (b) => b.textContent.trim());

/** Kéo thả HTML5 giả từ `from` tới `to` tại phần (fx, fy) của hộp đích; `stopBeforeDrop` chỉ rê để chụp chỉ báo. */
async function dragTo(page, from, to, fx, fy, stopBeforeDrop = false) {
  return page.evaluate(
    (a, b, x, y, stop) => {
      const src = document.querySelector(a);
      const dst = document.querySelector(b);
      if (!src || !dst) return 'missing';
      const r = dst.getBoundingClientRect();
      const dt = new DataTransfer();
      const o = () => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        clientX: r.left + r.width * x,
        clientY: r.top + r.height * y,
      });
      src.dispatchEvent(new DragEvent('dragstart', o()));
      dst.dispatchEvent(new DragEvent('dragenter', o()));
      dst.dispatchEvent(new DragEvent('dragover', o()));
      if (stop) {
        window.__gridDrag = { src, dst, dt, o };
        return 'over';
      }
      dst.dispatchEvent(new DragEvent('drop', o()));
      src.dispatchEvent(new DragEvent('dragend', o()));
      return 'ok';
    },
    from,
    to,
    fx,
    fy,
    stopBeforeDrop,
  );
}

export default async function gridUx({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(
    page,
    readProject(resolve(REPO, 'projects/grid-demo')),
    'D:/Projects/grid-demo',
  );
  await treeItem(page, 'Bảng điều khiển');
  await page.waitForSelector('mat-grid-editor .ge-cell');
  await sleep(500);

  // 1. Thêm hàng 12 cột sau hàng 1: ô trống cao rõ, có chữ gợi ý và số cột
  await page.click(cellSel('c1'));
  await page.click('mat-grid-editor [data-quick="12"]');
  await waitFor(
    page,
    () => document.querySelectorAll('mat-grid-editor .ge-cell.empty').length === 1,
  );
  await sleep(300);
  const empty = await page.$eval('mat-grid-editor .ge-cell.empty', (e) => ({
    id: e.dataset.cell,
    h: e.getBoundingClientRect().height,
    text: e.textContent.replace(/\s+/g, ' ').trim(),
    border: getComputedStyle(e).borderTopStyle,
  }));
  // chiều cao theo px thiết kế (trang xem trước đang thu theo Vừa khung)
  const k = parseInt(await zoomText(page), 10) / 100;
  check(
    'hàng mới: ô trống cao ≥ 110 px (px thiết kế) trong editor',
    empty.h / k >= 110,
    `${(empty.h / k).toFixed(0)} px ở ${k * 100} %`,
  );
  check(
    'ô trống có chữ gợi ý và số cột',
    empty.text.includes('Kéo component từ Toolbox vào đây') && empty.text.includes('12/12'),
    empty.text,
  );
  check('ô trống chọn sẵn: viền liền màu nhấn', empty.border === 'solid', empty.border);
  await page.click(cellSel('c5'));
  await page.hover(cellSel(empty.id));
  await sleep(200);
  await shot('1-hang-trong');
  await axe('trình soạn lưới có hàng trống');

  // 2. Zoom chỉ hiển thị
  const z0 = await zoomText(page);
  const w0 = await page.$eval('mat-grid-editor .ge-page', (p) => p.getBoundingClientRect().width);
  await page.click('mat-grid-editor [data-act="zoom-in"]');
  await sleep(200);
  const w1 = await page.$eval('mat-grid-editor .ge-page', (p) => p.getBoundingClientRect().width);
  check('nút + phóng to trang', w1 > w0 * 1.1, `${z0} → ${await zoomText(page)}`);
  const stage = await page.$eval('mat-grid-editor .ge-stage', (s) => {
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(stage.x, stage.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: 300 });
  await page.keyboard.up('Control');
  await sleep(200);
  const w2 = await page.$eval('mat-grid-editor .ge-page', (p) => p.getBoundingClientRect().width);
  check('Ctrl+lăn chuột thu nhỏ', w2 < w1, `${await zoomText(page)}`);
  await page.focus(cellSel('c2'));
  await press(page, 'Control+0');
  await sleep(200);
  const fit = await page.$eval('mat-grid-editor [data-act="zoom-fit"]', (b) =>
    b.getAttribute('aria-pressed'),
  );
  check('Ctrl+0: Vừa khung', fit === 'true' && (await zoomText(page)) === z0, await zoomText(page));
  await page.click('mat-grid-editor [data-act="zoom-out"]');
  await sleep(200);
  await shot('2-zoom');
  await page.click('mat-grid-editor [data-act="zoom-fit"]');
  await sleep(200);

  // 3. Kéo component sang hàng khác: chỉ báo "đặt vào ô", thả vào ô trống của hàng mới
  const over = await dragTo(page, cellSel('c1'), cellSel(empty.id), 0.5, 0.5, true);
  await sleep(150);
  const ind = await page.$eval(cellSel(empty.id), (e) => e.classList.contains('drop-into'));
  check('rê component lên giữa ô: chỉ báo đặt vào ô', over === 'over' && ind);
  await shot('3-chi-bao-tha');
  await page.evaluate(() => {
    const g = window.__gridDrag;
    g.dst.dispatchEvent(new DragEvent('drop', g.o()));
    g.src.dispatchEvent(new DragEvent('dragend', g.o()));
  });
  await sleep(300);
  check(
    'thả: component sang ô của hàng khác, ô cũ trống',
    (await itemOf(page, empty.id)) !== null && (await itemOf(page, 'c1')) === null,
  );
  // chỉ báo chèn bên trái khi rê ở mép trái
  await dragTo(page, cellSel('c2'), cellSel('c6'), 0.1, 0.5, true);
  await sleep(150);
  check(
    'rê ở mép trái ô: chỉ báo chèn trước',
    await page.$eval(cellSel('c6'), (e) => e.classList.contains('drop-before')),
  );
  await shot('4-chen-truoc');
  await page.evaluate(() => {
    const g = window.__gridDrag;
    g.src.dispatchEvent(new DragEvent('dragend', g.o()));
  });
  await press(page, 'Control+z');
  await sleep(300);
  check('Ctrl+Z hoàn tác lần dời', (await itemOf(page, 'c1')) !== null);

  // 4. Kéo tay nắm hàng: hàng cuối lên đầu
  const rows0 = await rowsOf(page);
  const lastRow = rows0.at(-1);
  const firstCellOfLast = await page.$eval(
    'mat-grid-editor mat-screen',
    (s) => [...s.shadowRoot.querySelectorAll('.row')].at(-1).querySelector('.cell').dataset.cellId,
  );
  await dragTo(page, `${cellSel(firstCellOfLast)} .ge-rowgrip`, cellSel('c1'), 0.5, 0.2, true);
  await sleep(150);
  check(
    'rê hàng ở nửa trên: chỉ báo chèn trên',
    await page.$eval(cellSel('c1'), (e) => e.classList.contains('drop-above')),
  );
  await shot('5-keo-hang');
  await page.evaluate(() => {
    const g = window.__gridDrag;
    g.dst.dispatchEvent(new DragEvent('drop', g.o()));
    g.src.dispatchEvent(new DragEvent('dragend', g.o()));
  });
  await sleep(300);
  const rows1 = await rowsOf(page);
  check('kéo hàng cuối lên đầu', rows1[0] === lastRow, rows1.join(','));

  // 5. Ctrl+D nhân bản đồng hồ kim, menu chuột phải nhân bản hàng
  const items0 = await page.$eval(
    'mat-grid-editor mat-screen',
    (s) => s.shadowRoot.querySelectorAll('.cell .item').length,
  );
  await page.click(cellSel('c13'));
  await press(page, 'Control+d');
  await sleep(300);
  const items1 = await page.$eval(
    'mat-grid-editor mat-screen',
    (s) => s.shadowRoot.querySelectorAll('.cell .item').length,
  );
  check('Ctrl+D nhân bản component', items1 === items0 + 1, `${items0} → ${items1}`);
  await press(page, 'Control+z');
  await sleep(300);
  await page.click(cellSel('c13'), { button: 'right' });
  await page.waitForSelector('.se-ctx [data-cmd="grid.duplicateRow"]');
  await sleep(150);
  await shot('6-menu');
  const nRows = (await rowsOf(page)).length;
  await page.click('.se-ctx [data-cmd="grid.duplicateRow"]');
  await sleep(300);
  check('menu chuột phải: Nhân bản hàng', (await rowsOf(page)).length === nRows + 1);
  await press(page, 'Control+z');
  await sleep(300);

  // 6. Vùng màu của đồng hồ kim
  await page.click(cellSel('c13'));
  await page.waitForSelector('#wi-tab-display');
  await page.click('#wi-tab-display');
  await page.waitForSelector('.pf-zones');
  const nz = await page.$$eval('.pf-zone', (e) => e.length);
  for (let i = nz; i < 2; i++) {
    await page.click('.pf-zadd');
    await sleep(150);
  }
  await sleep(200);
  const zone = await page.$eval('.pf-zone', (z) => {
    const x = z.querySelector('[data-act="zone-remove"]').getBoundingClientRect();
    return {
      labels: [...z.querySelectorAll('.pf-zl > span')].map((s) => s.textContent.trim()),
      xw: x.width,
      xh: x.height,
      tip: z.querySelector('[data-act="zone-remove"]').title,
      h: z.getBoundingClientRect().height,
    };
  });
  check(
    'Vùng màu: nhãn Từ/Đến, nút xóa ≥ 24 px, tooltip "Xoá vùng"',
    zone.labels.join('/') === 'Từ/Đến' && zone.xw >= 24 && zone.xh >= 24 && zone.tip === 'Xoá vùng',
    JSON.stringify(zone),
  );
  await page.$eval('.pf-zones', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await shot('7-vung-mau');
  await axe('khung Thuộc tính tab Hiển thị đồng hồ kim');

  // 8. (036) phần cột còn trống cuối hàng: vùng "+ Thêm ô (n cột)" thả component từ Toolbox vào được, nhấp thêm ô
  await page.click(cellSel('c1'));
  const free0 = await page.$$eval('mat-grid-editor .ge-free', (e) => e.length);
  await page.click('mat-grid-editor [data-act="mini-narrow"]');
  await waitFor(
    page,
    (n) => document.querySelectorAll('mat-grid-editor .ge-free').length === n + 1,
    free0,
  );
  const freeSel = await page.$$eval('mat-grid-editor .ge-free', (els) => {
    const e = els.find((x) => x.textContent.includes('1 cột'));
    const r = e?.getBoundingClientRect();
    return e ? { row: e.dataset.free, text: e.textContent.trim(), w: r.width, h: r.height } : null;
  });
  check(
    'hàng thiếu cột: hiện vùng "Thêm ô (1 cột)" có kích thước',
    !!freeSel && freeSel.w > 20 && freeSel.h > 20,
    JSON.stringify(freeSel),
  );
  await shot('8-vung-cot-trong');
  const cellsBefore = await page.$$eval('mat-grid-editor .ge-cell', (e) => e.length);
  const tool = 'mat-taskcards .tool[data-widget="multi-state"]';
  const hasTool = await page.$(tool);
  if (!hasTool) await page.click('mat-taskcards [role="tab"]').catch(() => {});
  const res = await dragTo(
    page,
    tool,
    `mat-grid-editor .ge-free[data-free="${freeSel?.row}"]`,
    0.5,
    0.5,
  );
  await sleep(300);
  const cellsAfter = await page.$$eval('mat-grid-editor .ge-cell', (e) => e.length);
  check(
    'thả component Toolbox vào vùng cột trống: thêm ô mới có component',
    res === 'ok' && cellsAfter === cellsBefore + 1,
    `${res} ${cellsBefore}→${cellsAfter}`,
  );
  await shot('9-tha-vao-cot-trong');
}
