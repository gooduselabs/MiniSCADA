// E2E chặn mềm khi Nạp xuống cấu hình lưu trữ vượt ngân sách (feature 010, US7, T122, T125, FR-048), lớp Tauri giả:
// project history-demo hợp lệ → đặt chu kỳ 100 ms cho các nhóm bằng thao tác → Online → Ctrl+L: hộp thoại "vượt ngân sách ghi"
// hiện TRƯỚC bước nạp, focus ở Hủy; Hủy không mở hộp thoại Nạp xuống và không đổi project; "Tôi hiểu, vẫn nạp" đi tiếp tới hộp
// thoại Nạp xuống, lần sau cùng số ước tính không hỏi lại; axe hai theme cho hộp thoại.
import {
  HISTORY_DEMO,
  axeBoth,
  clickButton,
  clickCell,
  goOnline,
  gridCell,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeItem,
  typeInCell,
} from './util.mjs';

const ED = 'mat-logging-editor';
const G = `${ED} [data-grid="groups"]`;
const DLG = 'mat-budget-confirm-dialog [role="dialog"]';

async function setCell(page, r, c, value) {
  await clickCell(page, G, r, c);
  await typeInCell(page, value);
  await sleep(80);
}

async function ctrlL(page) {
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyL');
  await page.keyboard.up('Control');
}

export default async function loggingBudget({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(HISTORY_DEMO), 'D:\\Projects\\history-demo');
  await treeItem(page, 'Lưu trữ');
  await page.waitForSelector(cell(0, 'id'));
  const level0 = await page.$eval(`${ED} mat-estimate-panel .est`, (e) => e.className);
  check('project mẫu trong ngân sách ghi', /lv-ok/.test(level0), level0);

  await setCell(page, 0, 'interval', '100 ms – 1 s');
  await setCell(page, 2, 'interval', '100 ms');
  await setCell(page, 3, 'interval', '100 ms');
  const level1 = await page.$eval(`${ED} mat-estimate-panel .est`, (e) => e.className);
  check('đặt chu kỳ 100 ms: khung Ước tính rời mức xanh', !/lv-ok/.test(level1), level1);

  await goOnline(page, 'kysu1');
  await ctrlL(page);
  await page.waitForSelector(DLG, { timeout: 5000 }).catch(() => undefined);
  const bar = await page.$eval('mat-statusbar', (e) =>
    e.textContent.replace(/\s+/g, ' ').slice(0, 200),
  );
  const open = await page.$(DLG).then(Boolean);
  check('Nạp xuống cấu hình vượt ngân sách: hộp thoại chặn mềm hiện trước bước nạp', open, bar);
  if (!open) return;
  const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-role'));
  check('focus ban đầu ở nút Hủy', focus === 'cancel', String(focus));
  const body = await page.$eval('mat-budget-confirm-dialog .dlg-b', (e) =>
    e.textContent.replace(/\s+/g, ' '),
  );
  check(
    'hộp thoại nêu số ước tính, nhóm lớn nhất và hậu quả',
    /GB/.test(body) && /mòn/.test(body) && /Nhóm đóng góp/.test(body),
    body.slice(0, 160),
  );
  await shot('1-chan-mem');
  await axeBoth(page, axe, 'hộp thoại chặn mềm');

  await clickButton(page, 'mat-budget-confirm-dialog .dlg-f', 'Hủy');
  await sleep(150);
  const goneAfterCancel = !(await page.$(DLG));
  const downloadOpen = await page.$('mat-download-dialog [role="dialog"]').then(Boolean);
  check('Hủy: đóng hộp thoại, không mở Nạp xuống', goneAfterCancel && !downloadOpen);

  await ctrlL(page);
  await page.waitForSelector(DLG, { timeout: 4000 });
  await clickButton(page, 'mat-budget-confirm-dialog .dlg-f', 'Tôi hiểu, vẫn nạp');
  await page
    .waitForSelector('mat-download-dialog [role="dialog"]', { timeout: 6000 })
    .catch(() => undefined);
  const downloadAfter = await page.$('mat-download-dialog [role="dialog"]').then(Boolean);
  check('Tôi hiểu, vẫn nạp: đi tiếp tới hộp thoại Nạp xuống', downloadAfter);
  await page.keyboard.press('Escape');
  await sleep(200);
  await ctrlL(page);
  await sleep(300);
  const again = await page.$(DLG).then(Boolean);
  check('cùng số ước tính: không hỏi lại', !again);
}

function cell(r, c) {
  return gridCell(G, r, c);
}
