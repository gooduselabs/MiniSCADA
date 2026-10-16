// E2E hộp thoại Nhập lại SVG / Đối chiếu lại (feature 008, T103, FR-028, FR-029, SC-009, SC-015): lớp Tauri giả có `svg_open`
// (window.__matMock.svgOpenResult), bảy cặp v1/v2 của T097 (tests/fixtures/svg-import/reimport), tóm tắt giữ / mới / cần chọn /
// mồ côi đúng số, 0 gán sai khi để mặc định "Mới", Hủy không đổi project, Áp dụng một bước hoàn tác, mồ côi "Giữ" để lại
// E_REF_UID (chặn Nạp xuống; nhấp đúp lỗi mở lại hộp thoại), UID giữ qua Lưu và mở lại, hai item chung một tệp (mặc định tách),
// làm hoàn toàn bằng bàn phím, axe 0 vi phạm critical/serious ở hai theme. Chrome headless.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { bonProject } from './svg-fixture.mjs';
import { REPO, axeBoth, openAndWait, press, setTheme, sleep, treeItem, waitFor } from './util.mjs';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { bindablePaths, parseXml } = await import('../../../../packages/svg-import/src/index.ts');

const PAIRS = resolve(REPO, 'tests/fixtures/svg-import/reimport');
const pairNames = readdirSync(PAIRS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const pairOf = (name) => ({
  v1: readFileSync(resolve(PAIRS, name, 'v1.svg'), 'utf8'),
  v2: readFileSync(resolve(PAIRS, name, 'v2.svg')),
  answer: JSON.parse(readFileSync(resolve(PAIRS, name, 'answer.json'), 'utf8')),
});

/** Số mong đợi theo bảy cặp (đo ở T100: pairs / added / ambiguous / orphans của match). */
const EXPECT = {
  '01-inkscape-resave': { kept: 38, added: 0, need: 0 },
  '02-inkscape-plain': { kept: 38, added: 0, need: 0 },
  '03-libreoffice-like': { kept: 38, added: 7, need: 0 },
  '04-move-regroup': { kept: 34, added: 1, need: 3 },
  '05-rename-add-delete': { kept: 40, added: 3, need: 2 },
  '06-identical-grid': { kept: 2, added: 0, need: 12 },
  '07-row-insert': { kept: 20, added: 1, need: 0 },
};
/** UID mồ côi thật của cặp (có binding trong project mẫu) và một UID khớp chắc chắn. */
const ORPHAN = { '05-rename-add-delete': 'el_smlzq3mmey', '07-row-insert': 'el_edo7hd6qpa' };
const KEPT = { '05-rename-add-delete': 'el_3gjandbmwr', '07-row-insert': null };

const uidsOf = (svg) => [...svg.matchAll(/data-mat-uid="([^"]+)"/g)].map((m) => m[1]);
const bindingOf = (uid, i) => ({
  elementUid: uid,
  bindings: [
    {
      id: `b${i}`,
      target: 'style.fill',
      source: { type: 'tag', tagId: 'TANK01.LEVEL' },
      transform: { kind: 'direct' },
    },
  ],
});

/** Project 0.4 với item `svg1` dùng v1 của cặp; binding gắn vào các UID `bound`; `shared` thêm item `svg2` dùng chung tệp. */
function projectOf(v1, bound, shared = false) {
  const uids = [...new Set([...uidsOf(v1).slice(0, 4), ...bound])];
  const files = bonProject({
    svg: v1,
    uids,
    bindings: {
      schemaVersion: '0.4.0',
      screenId: 'bon',
      itemId: 'svg1',
      elements: bound.map(bindingOf),
    },
  });
  if (shared) {
    const screen = JSON.parse(files['screens/bon.screen.json']);
    screen.items.push({
      ...screen.items[0],
      id: 'svg2',
      name: 'Sơ đồ bồn 2',
      x: 900,
      y: 40,
      width: 300,
      height: 200,
      bindingFile: 'screens/bon.svg2.bindings.json',
    });
    files['screens/bon.screen.json'] = JSON.stringify(screen, null, 2) + '\n';
    files['screens/bon.svg2.bindings.json'] =
      JSON.stringify(
        { schemaVersion: '0.4.0', screenId: 'bon', itemId: 'svg2', elements: [] },
        null,
        2,
      ) + '\n';
  }
  return files;
}

const setFile = (page, name, bytes) =>
  page.evaluate(
    (n, b) => {
      window.__matMock.svgOpenResult = { name: n, bytes: new Uint8Array(b) };
    },
    name,
    Array.from(bytes),
  );
const dirty = (page) => page.evaluate(() => window.__matApp.store.dirtyFiles().sort());
const svgText = (page, rel = 'graphics/bon.svg') =>
  page.evaluate((r) => window.__matApp.store.textOf(r), rel);
const dialogGone = (page) =>
  waitFor(page, () => !document.querySelector('mat-reimport-svg-dialog [role="dialog"]'));
const dialogReady = (page) =>
  waitFor(
    page,
    () =>
      document.querySelector('mat-reimport-svg-dialog [data-role="ok"]:not([disabled])') ||
      document.querySelector('mat-reimport-svg-dialog [data-role="rejected"]'),
    undefined,
    15000,
  );
const chipN = (page, role) =>
  page.$eval(`mat-reimport-svg-dialog [data-role="${role}"]`, (e) =>
    Number(e.textContent.match(/\d+/)?.[0] ?? NaN),
  );

/** Menu chuột phải của hàng lớp của item svg1 → "Nhập lại SVG…". */
async function openByContextMenu(page) {
  await page.waitForSelector('mat-layers .ly-row');
  const box = await page.$eval('mat-layers .ly-row', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForSelector('mat-layers .ctx-menu [data-cmd="import.reimport"]');
  await page.click('mat-layers .ctx-menu [data-cmd="import.reimport"]');
  await page.waitForSelector('mat-reimport-svg-dialog [role="dialog"]');
  await dialogReady(page);
}

/** Mở project của cặp, vào màn hình `Bồn nước`. */
async function openPair(page, files) {
  await page.reload({ waitUntil: 'load' });
  await openAndWait(page, files, 'D:\\Projects\\bon-nuoc');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (tabs) =>
    tabs.find((t) => t.textContent.trim() === 'Lớp')?.click(),
  );
  await page.waitForSelector('mat-layers .ly-row');
  await sleep(250);
}

/** Tab cho tới khi phần tử có focus thỏa `pred` (chạy trong trang); trả true nếu tới được. */
async function tabTo(page, pred, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(pred)) return true;
    await page.keyboard.press('Tab');
  }
  return page.evaluate(pred);
}

/** Đếm kết quả đúng / gán sai của SVG sau khi áp theo đáp án của cặp. */
function judge(svg, answer, oldUids) {
  const p = parseXml(svg);
  if (!p.ok) return { correct: 0, wrong: 0, fresh: 0, ok: false };
  const byPath = new Map(
    bindablePaths(p.root).map((b) => [b.path, b.el.getAttribute('data-mat-uid')]),
  );
  let correct = 0;
  let wrong = 0;
  let fresh = 0;
  for (const a of answer.answers) {
    const got = byPath.get(a.new);
    if (got === undefined) continue;
    if (a.old !== null && got === a.old) correct++;
    else if (oldUids.has(got))
      wrong++; // nhận UID cũ khác đáp án: gán sai
    else fresh++;
  }
  return { correct, wrong, fresh, ok: true };
}

export default async function reimportE2e({ page, check, shot, axe }) {
  await setTheme(page, 'light');

  // ---------- 1. Bảy cặp của T097: tóm tắt đúng số; mặc định "Mới" không gán sai (SC-009) ----------
  let wrongTotal = 0;
  let keptTotal = 0;
  for (const name of pairNames) {
    const { v1, v2, answer } = pairOf(name);
    await openPair(page, projectOf(v1, [ORPHAN[name], KEPT[name]].filter(Boolean)));
    await setFile(page, 'v2.svg', v2);
    await openByContextMenu(page);
    const n = {
      kept: await chipN(page, 'n-kept'),
      added: await chipN(page, 'n-added'),
      need: await chipN(page, 'n-need'),
    };
    const want = EXPECT[name];
    check(
      `${name}: tóm tắt giữ ${want.kept} / mới ${want.added} / cần chọn ${want.need}`,
      n.kept === want.kept && n.added === want.added && n.need === want.need,
      JSON.stringify(n),
    );
    if (name === '05-rename-add-delete') await shot('1-doi-chieu');
    const before = await svgText(page);
    const oldUids = new Set(uidsOf(before));
    await page.click('mat-reimport-svg-dialog [data-role="ok"]');
    await dialogGone(page);
    const res = judge(await svgText(page), answer, oldUids);
    wrongTotal += res.wrong;
    keptTotal += res.correct;
    check(
      `${name}: Áp dụng mặc định, 0 gán sai (đúng ${res.correct}, mới ${res.fresh})`,
      res.ok && res.wrong === 0 && res.correct >= want.kept,
      JSON.stringify(res),
    );
  }
  check(`SC-009: tổng 0 gán sai trên bảy cặp (giữ đúng ${keptTotal})`, wrongTotal === 0);

  // ---------- 2. Hủy không đổi project; không có ghi xuống đĩa ----------
  const p5 = pairOf('05-rename-add-delete');
  const files5 = projectOf(p5.v1, ['el_smlzq3mmey', 'el_3gjandbmwr']);
  await openPair(page, files5);
  const svg0 = await svgText(page);
  await setFile(page, 'v2.svg', p5.v2);
  await openByContextMenu(page);
  await press(page, 'Escape');
  await dialogGone(page);
  check(
    'Hủy (Esc): SVG không đổi, không có file chờ ghi',
    (await svgText(page)) === svg0 && (await dirty(page)).length === 0,
    String(await dirty(page)),
  );
  check(
    'Hủy: không ghi xuống đĩa',
    (await page.evaluate(() => window.__matMock.writes.length)) === 0,
  );

  // ---------- 3. Chỉ bàn phím: chọn ứng viên, Giữ mồ côi, Enter áp dụng ----------
  await page.focus('mat-layers .ly-grid');
  await page.keyboard.press('ContextMenu');
  await page.waitForSelector('mat-layers .ctx-menu [data-cmd="import.reimport"]');
  check(
    'phím Menu mở menu ngữ cảnh; focus ở mục "Nhập lại SVG…"',
    await page.evaluate(
      () => document.activeElement?.getAttribute('data-cmd') === 'import.reimport',
    ),
  );
  await press(page, 'Escape');
  await page.waitForFunction(() => !document.querySelector('mat-layers .ctx-menu'));
  await page.focus('mat-layers .ly-grid');
  await page.keyboard.press('ContextMenu');
  await page.waitForSelector('mat-layers .ctx-menu [data-cmd="import.reimport"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-reimport-svg-dialog [role="dialog"]');
  await dialogReady(page);
  const focusOk = await page.evaluate(
    () =>
      document.activeElement?.getAttribute('role') === 'option' &&
      document.activeElement.closest('mat-reimport-svg-dialog') !== null,
  );
  check('mở hộp thoại: focus vào mục cần chọn đầu tiên (option)', focusOk);
  check(
    'mục cần chọn mặc định là "Mới"',
    await page.$$eval(
      'mat-reimport-svg-dialog [role="option"] [data-role="state"]',
      (els) => els.length === 2 && els.every((e) => e.textContent.trim() === 'Mới'),
    ),
  );
  check(
    'mặc định chọn radio "Mới: không gán UID cũ"',
    await page.$eval('mat-reimport-svg-dialog [data-role="pick-new"]', (e) => e.checked),
  );
  await page.keyboard.press('ArrowDown');
  await sleep(80);
  check(
    'ArrowDown chuyển sang mục cần chọn thứ hai',
    await page.evaluate(
      () =>
        document
          .querySelectorAll('mat-reimport-svg-dialog [role="option"]')[1]
          ?.getAttribute('aria-selected') === 'true',
    ),
  );
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  // Tab tới radio ứng viên cũ đầu tiên rồi Space để chọn.
  const gotRadio = await tabTo(
    page,
    () => document.activeElement?.getAttribute('data-role') === 'pick-new',
  );
  check('Tab tới nhóm radio (ô đang chọn)', gotRadio);
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  check(
    'ArrowUp chọn ứng viên: chip của mục thành "Nhận UID cũ"',
    await page.$eval(
      'mat-reimport-svg-dialog [role="option"][aria-selected="true"] [data-role="state"]',
      (e) => e.textContent.trim() === 'Nhận UID cũ',
    ),
  );
  await shot('2-chon-ung-vien');
  // Tab tới nút "Giữ mồ côi" của mồ côi có binding rồi Space.
  const gotKeep = await page.evaluate(() => {
    const b = document.querySelector('mat-reimport-svg-dialog [data-orphan][data-mode="keep"]');
    return b !== null;
  });
  check('có dòng mồ côi có binding với nút "Giữ mồ côi"', gotKeep);
  await page.focus('mat-reimport-svg-dialog [data-orphan][data-mode="keep"]');
  await page.keyboard.press('Space');
  await sleep(80);
  check(
    'chọn "Giữ mồ côi": hiện cảnh báo E_REF_UID',
    await page.$eval('mat-reimport-svg-dialog [data-role="keep-warn"]', (e) =>
      e.textContent.includes('E_REF_UID'),
    ),
  );
  await shot('3-giu-mo-coi');

  // axe hai theme trên hộp thoại ở trạng thái chọn
  await axeBoth(page, axe, 'hộp thoại Nhập lại SVG');

  await page.focus('mat-reimport-svg-dialog [role="option"]');
  await page.keyboard.press('Enter'); // Enter ở option chỉ chọn, không áp dụng
  await sleep(100);
  check(
    'Enter trên mục danh sách không áp dụng',
    (await page.$('mat-reimport-svg-dialog [role="dialog"]')) !== null,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await dialogGone(page);
  const applied = await svgText(page);
  check(
    'Áp dụng bằng bàn phím: SVG đổi và có file chờ ghi',
    applied !== svg0 && (await dirty(page)).includes('graphics/bon.svg'),
    String(await dirty(page)),
  );

  // ---------- 4. Mồ côi "Giữ": E_REF_UID chặn Nạp xuống; nhấp đúp lỗi mở lại hộp thoại ----------
  await waitFor(page, () => window.__matApp.store.state.issues.some((i) => i.code === 'E_REF_UID'));
  check('Giữ mồ côi: còn lỗi E_REF_UID', true);
  check(
    'E_REF_UID chặn Nạp xuống (lý do "Project còn lỗi")',
    (await page.evaluate(() => window.__matApp.enabled('online.download'))) ===
      'reason.projectErrors',
  );
  await page.evaluate(() => window.__matApp.setInspectorTab('info'));
  await page.waitForSelector('mat-inspector .issue');
  await shot('4-loi-e-ref-uid');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('mat-inspector .issue')].find((r) =>
      r.textContent.includes('E_REF_UID'),
    );
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await page.waitForSelector('mat-reimport-svg-dialog [role="dialog"]');
  check('nhấp đúp lỗi E_REF_UID mở hộp thoại Nhập lại SVG', true);
  await press(page, 'Escape');
  await dialogGone(page);

  // ---------- 5. Một bước hoàn tác; UID qua Lưu và mở lại (FR-029) ----------
  await press(page, 'Control+z');
  await sleep(200);
  check(
    'Ctrl+Z một lần: trả lại cả SVG và binding, hết file chờ ghi',
    (await svgText(page)) === svg0 && (await dirty(page)).length === 0,
    String(await dirty(page)),
  );
  await press(page, 'Control+y');
  await sleep(200);
  check('Ctrl+Y làm lại', (await svgText(page)) === applied);
  await press(page, 'Control+s');
  await waitFor(page, () => window.__matMock.writes.some((w) => w.rel === 'graphics/bon.svg'));
  const writes = await page.evaluate(() =>
    window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })),
  );
  const savedSvg = writes.find((w) => w.rel === 'graphics/bon.svg').content;
  check('Lưu: file SVG ghi đúng nội dung đã áp dụng', savedSvg === applied);
  const reopened = { ...files5 };
  for (const w of writes) reopened[w.rel] = w.content;
  await openPair(page, reopened);
  check(
    'mở lại project đã lưu: UID giữ nguyên',
    JSON.stringify(uidsOf(await svgText(page))) === JSON.stringify(uidsOf(applied)),
  );

  // ---------- 6. Hai item chung một tệp: hỏi áp cho mọi thể hiện hay tách, mặc định tách ----------
  const p7 = pairOf('07-row-insert');
  await openPair(page, projectOf(p7.v1, [], true));
  await setFile(page, 'v2.svg', p7.v2);
  await openByContextMenu(page);
  check(
    'tệp dùng chung: có câu hỏi áp cho mọi thể hiện hay tách; mặc định tách',
    await page.$eval('mat-reimport-svg-dialog [data-role="share-split"]', (e) => e.checked),
  );
  await shot('5-dung-chung');
  await axeBoth(page, axe, 'Nhập lại SVG, câu hỏi tệp dùng chung (T114)');
  await page.click('mat-reimport-svg-dialog [data-role="ok"]');
  await dialogGone(page);
  const d = await dirty(page);
  check(
    'tách: tệp SVG mới được tạo, tệp cũ không đổi',
    d.some((f) => /^graphics\/.+\.svg$/.test(f) && f !== 'graphics/bon.svg') &&
      (await svgText(page)) === p7.v1,
    d.join(),
  );

  // ---------- 7. File bị từ chối: không đổi gì ----------
  await openPair(page, projectOf(p7.v1, []));
  await page.evaluate(() => {
    window.__matMock.svgOpenResult = { error: 'too-large' };
  });
  await openByContextMenuRejected(page);
  check(
    'file quá lớn: từ chối mã E_IMPORT_LIMIT, project không đổi',
    (await page.$eval('mat-reimport-svg-dialog [data-role="code"]', (e) =>
      e.textContent.trim(),
    )) === 'E_IMPORT_LIMIT' && (await dirty(page)).length === 0,
  );
  await axeBoth(page, axe, 'Nhập lại SVG bị từ chối');
  await press(page, 'Escape');
  await dialogGone(page);

  // Lệnh có trong bảng lệnh (không phím tắt) và bị khóa khi không chọn item.
  const why = await page.evaluate(() => window.__matApp.enabled('import.reimport'));
  check('bảng lệnh: Nhập lại SVG… có và đã chọn item thì dùng được', why === true, String(why));
}

async function openByContextMenuRejected(page) {
  await page.waitForSelector('mat-layers .ly-row');
  const box = await page.$eval('mat-layers .ly-row', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.click('mat-layers .ctx-menu [data-cmd="import.reimport"]');
  await page.waitForSelector('mat-reimport-svg-dialog [role="dialog"]');
  await dialogReady(page);
}
