// E2E editor Recipe (feature 024, US1), lớp Tauri giả: project 1.1 (report-demo không có recipe), tạo loại từ cây, kéo Tag ghi
// được vào lưới (Tag chỉ đọc bị từ chối), thêm bản, gõ giá trị như bảng tính, giá trị ngoài giới hạn tô đỏ, xuất rồi nhập CSV,
// Lưu → recipes.json và recipesFile, Kiểm tra 0 lỗi; axe hai theme.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  clickCell,
  gridCell,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeNode,
  typeInCell,
  waitFor,
} from './util.mjs';

const ED = 'mat-recipes-editor';
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

function project() {
  const files = readProject(resolve(REPO, 'projects/report-demo'));
  const p = JSON.parse(files['project.json']);
  delete p.recipesFile;
  files['project.json'] = JSON.stringify(p, null, 2) + '\n';
  delete files['recipes.json'];
  return files;
}

const dropTag = (page, id) =>
  page.evaluate(
    (sel, tag) => {
      const dst = document.querySelector(sel);
      const dt = new DataTransfer();
      dt.setData('application/x-mat-tag', tag);
      for (const type of ['dragenter', 'dragover', 'drop'])
        dst.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
    },
    `${ED} [data-role="drop"]`,
    id,
  );

const recipes = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('mat-recipes-editor');
    return el?.app?.store.state.outline.recipes ?? null;
  });

async function setCell(page, r, c, v) {
  await clickCell(page, ED, r, c);
  await typeInCell(page, v);
  await sleep(80);
}

export default async function recipesE2e({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, project());

  // ---------- 1. Tạo loại từ cây ----------
  await treeNode(page, 'recipes');
  await page.waitForSelector(`${ED} [data-role="empty"]`);
  await page.click(`${ED} [data-act="add-type"]`);
  await page.waitForSelector(`${ED} [data-role="dropzone"]`);
  check('tạo loại recipe mới: vùng thả Tag hiện ra', true);

  // ---------- 2. Kéo Tag ----------
  for (const tag of ['DRYER.TEMP_SP', 'DRYER.TIME_MIN', 'DRYER.FAN_PCT', 'DRYER.STEAM']) {
    await dropTag(page, tag);
    await sleep(120);
  }
  await dropTag(page, 'PROC.TEMP');
  await sleep(120);
  const rc = await recipes(page);
  check(
    'kéo 4 Tag ghi được thành tham số; Tag mô phỏng chỉ đọc bị từ chối',
    rc?.types[0]?.params.map((p) => p.tagId).join() ===
      'DRYER.TEMP_SP,DRYER.TIME_MIN,DRYER.FAN_PCT,DRYER.STEAM',
    JSON.stringify(rc?.types[0]?.params),
  );

  // ---------- 3. Bản và giá trị như bảng tính ----------
  await page.click(`${ED} [data-act="add-recipe"]`);
  await sleep(150);
  await page.click(`${ED} [data-act="add-recipe"]`);
  await sleep(150);
  await page.waitForSelector(gridCell(ED, 0, 'r1'));
  await setCell(page, 0, 'r0', '85');
  await setCell(page, 1, 'r0', '45');
  await setCell(page, 3, 'r0', '1');
  await setCell(page, 0, 'r1', '150');
  await setCell(page, 1, 'r1', '700');
  await sleep(300);
  const red = await page.$eval(gridCell(ED, 1, 'r1'), (c) => /err/.test(c.className));
  check('giá trị 700 phút ngoài giới hạn Tag (≤ 600) tô đỏ', red);
  await shot('1-luoi');
  await axeBoth(page, axe, 'editor Recipe');
  await setCell(page, 1, 'r1', '20');

  // ---------- 4. CSV ----------
  await page.click(`${ED} [data-act="export"]`);
  await sleep(300);
  const csv = await page.evaluate(() => window.__matMock.savedCsv.at(-1)?.text ?? '');
  check(
    'xuất CSV: dòng tagId và tên bản',
    /^tagId,/.test(csv) && csv.includes('DRYER.TEMP_SP,85,150'),
    csv.slice(0, 120),
  );
  const changed = csv.replace('DRYER.FAN_PCT,0,0', 'DRYER.FAN_PCT,60,80');
  await page.evaluate((txt) => {
    window.__matMock.csvOpenResult = { name: 'lo.csv', bytes: new TextEncoder().encode(txt) };
  }, changed);
  await page.click(`${ED} [data-act="import"]`);
  await sleep(400);
  const after = await recipes(page);
  check(
    'nhập CSV: giá trị quạt 60 / 80',
    after?.types[0]?.recipes.map((r) => r.values['DRYER.FAN_PCT']).join() === '60,80',
    JSON.stringify(after?.types[0]?.recipes.map((r) => r.values)),
  );

  // ---------- 5. Lưu, kiểm tra ----------
  await press(page, 'Control+s');
  await sleep(700);
  await press(page, 'F7');
  await sleep(1500);
  const bar = norm(await page.$eval('mat-statusbar', (e) => e.textContent));
  check('Kiểm tra sau khi lưu: 0 lỗi', /\b0 lỗi/.test(bar), bar.slice(0, 200));
  const w = await page.evaluate(() =>
    window.__matMock.writes.map((x) => ({ rel: x.rel, content: x.content })),
  );
  const last = new Map(w.map((x) => [x.rel, x.content]));
  const proj = JSON.parse(last.get('project.json') ?? '{}');
  const rj = JSON.parse(last.get('recipes.json') ?? '{"types":[]}');
  check('project.json có recipesFile', proj.recipesFile === 'recipes.json');
  check(
    'recipes.json: 1.1.0, 1 loại, 4 tham số, 2 bản',
    rj.schemaVersion === '1.1.0' &&
      rj.types.length === 1 &&
      rj.types[0].params.length === 4 &&
      rj.types[0].recipes.length === 2,
    JSON.stringify(rj).slice(0, 200),
  );
  await waitFor(page, () => true);
  await setTheme(page, 'dark');
  await shot('2-toi');
  await setTheme(page, 'light');
}
