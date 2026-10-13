// E2E nhập chữ có dấu bằng bộ gõ giả lập qua CDP (feature 007, T115, FR-071, US2-18, SC-015 phần tự động; ADR-016): ở ô Tên và
// ô Nhãn của inspector và ô tên của panel Lớp, 20 lần ghép từng bước kiểu Telex ("Bơm nước số 1") rồi chốt bằng insertText ra đúng
// chuỗi; giữa lúc ghép chữ không có gì ghi vào tài liệu (Esc và Enter lúc đang ghép không đổi tên). Kiểm tay trên Windows 11 thật
// (Telex của TSF, Unikey) là T130, cần người.
import { DASHBOARD_DEMO, openAndWait, readProject, setTheme, sleep, treeItem } from './util.mjs';

const TARGET = 'Bơm nước số 1';
const STEPS = [
  'B',
  'Bo',
  'Bơ',
  'Bơm',
  'Bơm n',
  'Bơm nu',
  'Bơm nuo',
  'Bơm nướ',
  'Bơm nước',
  'Bơm nước s',
  'Bơm nước so',
  'Bơm nước số',
  'Bơm nước số 1',
];

const labelOf = (page, id) =>
  page.$eval(`mat-screen-canvas .oi[data-item="${id}"]`, (e) => e.getAttribute('aria-label'));

async function compose(cdp, upTo = STEPS.length) {
  for (const part of STEPS.slice(0, upTo))
    await cdp.send('Input.imeSetComposition', {
      text: part,
      selectionStart: part.length,
      selectionEnd: part.length,
    });
}

export default async function screenIme({ page, check }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  const cdp = await page.createCDPSession();

  // Chọn một thẻ giá trị
  const box = await page.$eval('mat-screen-canvas .oi[data-item="card_level"]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await sleep(200);
  const original = await labelOf(page, 'card_level');

  // ---------- 1. Ô Tên của inspector: ghép dở không ghi gì; chốt ra đúng chuỗi ----------
  await page.$eval('mat-widget-props #wi-name', (e) => e.focus());
  await page.$eval('mat-widget-props #wi-name', (e) => e.select());
  await compose(cdp, 6);
  await sleep(150);
  check(
    'đang ghép chữ: tài liệu chưa đổi (không ghi từng phần)',
    (await labelOf(page, 'card_level')) === original,
  );
  await page.keyboard.press('Escape');
  await sleep(100);
  let ok = 0;
  let last = null;
  for (let i = 0; i < 20; i++) {
    await page.$eval('mat-widget-props #wi-name', (e) => {
      e.focus();
      e.select();
    });
    await compose(cdp);
    await cdp.send('Input.insertText', { text: TARGET });
    await sleep(60);
    const v = await page.$eval('mat-widget-props #wi-name', (e) => e.value);
    last = v;
    if (v === TARGET) ok++;
    await page.keyboard.press('Enter');
    await sleep(80);
    // đổi lại tên khác để lần sau có thay đổi thật
    await page.$eval('mat-widget-props #wi-name', (e) => {
      e.focus();
      e.select();
    });
    await page.keyboard.type(`Thẻ ${i}`);
    await page.keyboard.press('Enter');
    await sleep(60);
  }
  check(`ô Tên: ${ok}/20 lần ra đúng "${TARGET}"`, ok === 20, `${ok}/20, cuối: ${last}`);

  // ---------- 2. Ô Nhãn (thuộc tính chữ) ----------
  await page.$$eval('mat-widget-props [role="tab"]', (tabs) =>
    tabs.find((t) => t.textContent.trim() === 'Hiển thị')?.click(),
  );
  await sleep(150);
  let okLabel = 0;
  for (let i = 0; i < 20; i++) {
    await page.$eval('mat-widget-props #pf-label', (e) => {
      e.focus();
      e.select();
    });
    await compose(cdp);
    await cdp.send('Input.insertText', { text: TARGET });
    await sleep(60);
    if ((await page.$eval('mat-widget-props #pf-label', (e) => e.value)) === TARGET) okLabel++;
    await page.keyboard.press('Enter');
    await sleep(60);
  }
  check(`ô Nhãn: ${okLabel}/20 lần ra đúng "${TARGET}"`, okLabel === 20, `${okLabel}/20`);
  await sleep(200);
  const stored = await page.$eval('mat-widget-props #pf-label', (e) => e.value);
  check(
    'chuỗi đã chốt nằm trong tài liệu (ô hiện lại đúng sau khi vẽ lại)',
    stored === TARGET,
    stored,
  );

  // ---------- 3. Panel Lớp: đổi tên tại chỗ ----------
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (t) =>
    t.find((x) => x.textContent.trim() === 'Lớp')?.click(),
  );
  await sleep(200);
  await page.focus('mat-layers .ly-grid');
  await page.keyboard.press('F2');
  await page.waitForSelector('mat-layers .ly-name');
  await page.$eval('mat-layers .ly-name', (e) => e.select());
  await compose(cdp);
  await cdp.send('Input.insertText', { text: TARGET });
  const v = await page.$eval('mat-layers .ly-name', (e) => e.value);
  check('ô tên tại chỗ của panel Lớp ghép đúng chuỗi', v === TARGET, v);
  await page.keyboard.press('Enter');
  await sleep(200);
  const finalName = await labelOf(page, 'card_level');
  check('Enter chốt tên mới của item', finalName === TARGET, finalName);
}
