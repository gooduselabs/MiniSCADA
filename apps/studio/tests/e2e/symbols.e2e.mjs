// E2E Toolbox Ký hiệu SVG, dính điểm gắn và Gắn nhanh (feature 008, T091, T092, T094; SC-017). Lớp Tauri giả, Chrome headless.
// Kéo thả HTML5 giả bằng DataTransfer dùng chung (như dragAndDrop của util.mjs) nhưng tách dragover khỏi drop để đọc chấm điểm gắn.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bonProject } from './svg-fixture.mjs';
import {
  REPO,
  axeBoth,
  designToPage,
  openAndWait,
  runCommand,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const LIB = resolve(REPO, 'packages/symbol-library');
const MANIFEST = JSON.parse(readFileSync(resolve(LIB, 'manifest.json'), 'utf8'));
const json = (v) => JSON.stringify(v, null, 2) + '\n';

/** Mọi tệp ký hiệu: khóa (tên tệp bỏ đuôi), ký hiệu, tệp. */
const FILES = MANIFEST.symbols.flatMap((s) =>
  (s.variants ?? [{ file: s.file }]).map((v) => ({
    key: v.file.replace(/^.*\//, '').replace(/\.svg$/, ''),
    symbol: s,
    file: v.file,
  })),
);

/** Project 0.4 có màn hình `bon` rỗng và màn hình `chinh` rỗng; `items` (nếu có) đặt vào `bon`. */
function project(items = []) {
  const files = bonProject();
  delete files['graphics/bon.svg'];
  delete files['screens/bon.svg1.bindings.json'];
  const bon = JSON.parse(files['screens/bon.screen.json']);
  bon.items = items;
  files['screens/bon.screen.json'] = json(bon);
  for (const it of items) {
    const f = FILES.find((x) => it.svgFile.endsWith(`/${x.key}.svg`));
    files[it.svgFile] = readFileSync(resolve(LIB, f.file), 'utf8');
    files[it.bindingFile] = json({
      schemaVersion: '0.4.0',
      screenId: 'bon',
      itemId: it.id,
      elements: [],
    });
  }
  return files;
}

/** `n` item van cổng xếp lưới (đủ ký hiệu có bộ phận) cho ca hiệu năng và trần. */
function manyItems(n) {
  const sym = MANIFEST.symbols.find((s) => s.id === 'valve-gate');
  return Array.from({ length: n }, (_, i) => ({
    id: `valve_gate_${i + 1}`,
    name: sym.name,
    type: 'svg',
    x: 10 + (i % 13) * 96,
    y: 10 + Math.floor(i / 13) * 70,
    width: 60,
    height: 60,
    svgFile: 'graphics/symbols/valve-gate.svg',
    bindingFile: `screens/bon.valve_gate_${i + 1}.bindings.json`,
    viewBox: sym.viewBox,
    fit: 'contain',
    elements: sym.parts.map((p) => ({ elementUid: p.uid, name: p.label })),
  }));
}

const itemIds = (page) =>
  page.evaluate(() => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    return [...(ms?.shadowRoot?.querySelectorAll('.item[data-item-id]') ?? [])].map(
      (e) => e.dataset.itemId,
    );
  });

const tiles = (page) => page.$$eval('.tc-body .sym', (els) => els.map((e) => e.dataset.symbol));

async function openToolbox(page) {
  if (!(await page.$('.tc-panel'))) await page.click('.tc-strip [data-tc="toolbox"]');
  else if ((await page.$('.tc-strip [data-tc="toolbox"][aria-selected="true"]')) === null)
    await page.click('.tc-strip [data-tc="toolbox"]');
  await page.waitForSelector('.tc-body [data-group="symbols"]');
  const open = await page.$eval('.tc-body [data-group="symbols"] > button', (b) =>
    b.getAttribute('aria-expanded'),
  );
  if (open !== 'true') await page.click('.tc-body [data-group="symbols"] > button');
  await page.waitForSelector('.tc-body .sym');
}

/** Kéo ký hiệu `key` tới điểm thiết kế (dx, dy): dragstart ở ô Toolbox rồi dragenter, dragover; `drop` thêm drop và dragend. */
async function drag(page, key, dx, dy, { alt = false, drop = true } = {}) {
  const p = await designToPage(page, dx, dy);
  return page.evaluate(
    (k, x, y, a, doDrop) => {
      const src = document.querySelector(`.sym[data-symbol="${k}"]`);
      const dst = document.querySelector('mat-screen-canvas .vp');
      if (!src || !dst) return 'missing';
      const dt = new DataTransfer();
      window.__dt = dt;
      const o = () => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
        altKey: a,
      });
      src.dispatchEvent(new DragEvent('dragstart', o()));
      dst.dispatchEvent(new DragEvent('dragenter', o()));
      dst.dispatchEvent(new DragEvent('dragover', o()));
      if (doDrop) {
        dst.dispatchEvent(new DragEvent('drop', o()));
        src.dispatchEvent(new DragEvent('dragend', o()));
        window.__dt = null;
      }
      return 'ok';
    },
    key,
    p.x,
    p.y,
    alt,
    drop,
  );
}

/** Thả tiếp lần kéo đang dở (sau `drag(..., { drop: false })`). */
async function dropNow(page, dx, dy, alt = false) {
  const p = await designToPage(page, dx, dy);
  await page.evaluate(
    (x, y, a) => {
      const dst = document.querySelector('mat-screen-canvas .vp');
      const o = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: window.__dt,
        clientX: x,
        clientY: y,
        altKey: a,
      };
      dst.dispatchEvent(new DragEvent('drop', o));
      window.__dt = null;
    },
    p.x,
    p.y,
    alt,
  );
}

const hitDots = (page) => page.$$eval('mat-svg-overlay .svo-port.hit', (e) => e.length);
const allDots = (page) => page.$$eval('mat-svg-overlay .svo-port', (e) => e.length);

async function save(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await sleep(700);
}

const written = (page, rel) =>
  page.evaluate(
    (r) => window.__matMock.writes.filter((w) => w.rel === r).at(-1)?.content ?? null,
    rel,
  );

export default async function symbols({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\ky-hieu');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);

  // ---------- T091: Toolbox ----------
  await openToolbox(page);
  const all = await tiles(page);
  check(
    'Toolbox Ký hiệu SVG: đủ 15 tệp ký hiệu (12 ký hiệu, cút 4 biến thể)',
    all.length === 15,
    String(all.length),
  );
  const cats = await page.$$eval('.tc-body [data-group="symbols"] .sym-cat', (e) =>
    e.map((x) => x.getAttribute('aria-label')),
  );
  check(
    'Toolbox: năm nhóm Bồn, Bơm, Van, Motor, Ống',
    cats.join() === 'Bồn,Bơm,Van,Motor,Ống',
    cats.join(),
  );
  await page.type('.tc-sym-find', 'bơm');
  await sleep(150);
  const pumps = await tiles(page);
  check(
    'Ô tìm "bơm": chỉ còn hai ký hiệu bơm',
    pumps.join() === 'pump-centrifugal,pump-dosing',
    pumps.join(),
  );
  await page.$eval('.tc-sym-find', (e) => {
    e.value = 'khongco';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(150);
  check(
    'Ô tìm không khớp: báo không có ký hiệu',
    (await tiles(page)).length === 0 && (await page.$('.tc-body .help')) !== null,
  );
  await page.$eval('.tc-sym-find', (e) => {
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(150);
  check('Xóa ô tìm: đủ 15 ký hiệu trở lại', (await tiles(page)).length === 15);
  await shot('1-toolbox');

  // Lời nhắc nguồn gốc ký hiệu (mockup cảnh 4) và bàn phím: Enter trên thẻ ký hiệu thả ký hiệu vào màn hình (SC-015).
  const origin = await page.$eval('.tc-body [data-role="sym-origin"]', (e) => e.textContent ?? '');
  check(
    'Toolbox: lời nhắc nguồn gốc ký hiệu (CC0, do dự án vẽ)',
    /CC0/.test(origin) && /do dự án vẽ/.test(origin),
    origin,
  );
  const before = (await itemIds(page)).length;
  await page.focus('.tc-body .sym[data-symbol="pump-centrifugal"]');
  await page.keyboard.press('Enter');
  await sleep(500);
  const afterEnter = await itemIds(page);
  check(
    'Enter trên thẻ ký hiệu (chỉ bàn phím): thả một item svg vào màn hình',
    afterEnter.length === before + 1,
    `${before} -> ${afterEnter.length}`,
  );
  await page.evaluate(() => window.__matApp.run('edit.undo'));
  await sleep(300);
  check('Hoàn tác thả bằng Enter: màn hình trở lại trống', (await itemIds(page)).length === before);

  // ---------- T090, T094: thả từng ký hiệu ----------
  const sizes = {};
  for (let i = 0; i < FILES.length; i++) {
    const f = FILES[i];
    sizes[f.key] = f.symbol.defaultSize;
    const dx = 100 + (i % 5) * 220;
    const dy = 100 + Math.floor(i / 5) * 200;
    await drag(page, f.key, dx, dy);
    await sleep(60);
  }
  await sleep(500);
  const ids = await itemIds(page);
  check('Thả đủ 15 tệp: 15 item svg trên màn hình', ids.length === 15, ids.join());
  check(
    'Id item ≤ 32 ký tự, dạng <ký hiệu>_<số>',
    ids.every((id) => id.length <= 32 && /^[a-z][a-z0-9_]*_\d+$/.test(id)),
    ids.join(),
  );
  await save(page);
  const scr = JSON.parse((await written(page, 'screens/bon.screen.json')) ?? '{"items":[]}');
  check(
    'Lưu: màn hình có 15 item svg',
    scr.items.length === 15 && scr.items.every((i) => i.type === 'svg'),
  );
  check(
    'Item cỡ defaultSize của ký hiệu, giữ viewBox',
    scr.items.every((i) => {
      const f = FILES.find((x) => i.svgFile.endsWith(`/${x.key}.svg`));
      return (
        i.width === f.symbol.defaultSize[0] &&
        i.height === f.symbol.defaultSize[1] &&
        (i.fit ?? 'contain') === 'contain' &&
        i.viewBox.join() === f.symbol.viewBox.join()
      );
    }),
  );
  const svgsWritten = await page.evaluate(() =>
    [
      ...new Set(
        window.__matMock.writes.map((w) => w.rel).filter((r) => r.startsWith('graphics/symbols/')),
      ),
    ].sort(),
  );
  check(
    'Tệp sao vào graphics/symbols/: 15 tệp, mỗi tệp một lần cho mọi thể hiện',
    svgsWritten.length === 15 &&
      svgsWritten.every((r) => FILES.some((f) => r === `graphics/symbols/${f.key}.svg`)),
    svgsWritten.join(),
  );
  const bindFiles = await page.evaluate(() => [
    ...new Set(
      window.__matMock.writes
        .map((w) => w.rel)
        .filter((r) => /^screens\/bon\..+\.bindings\.json$/.test(r)),
    ),
  ]);
  check(
    'Mỗi item có file binding riêng (15 file rỗng)',
    bindFiles.length === 15,
    String(bindFiles.length),
  );
  const emptyBind = JSON.parse((await written(page, bindFiles[0])) ?? 'null');
  check(
    'File binding mới: schemaVersion 0.4.0, elements rỗng',
    emptyBind?.schemaVersion === '0.4.0' && emptyBind.elements.length === 0,
  );

  // Thể hiện thứ hai cùng ký hiệu dùng chung một tệp.
  const writes1 = await page.evaluate(
    () => window.__matMock.writes.filter((w) => w.rel === 'graphics/symbols/fan.svg').length,
  );
  await drag(page, 'fan', 1100, 600);
  await sleep(300);
  await save(page);
  const writes2 = await page.evaluate(
    () => window.__matMock.writes.filter((w) => w.rel === 'graphics/symbols/fan.svg').length,
  );
  const idsAfter = await itemIds(page);
  check(
    'Thả lần hai cùng ký hiệu: item mới, tệp SVG không sao lại',
    idsAfter.length === 16 && writes2 === writes1,
    `${idsAfter.length} item; ghi ${writes1} -> ${writes2}`,
  );

  // Một bước hoàn tác cho mỗi lần thả.
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await sleep(400);
  check(
    'Ctrl+Z một lần: gỡ đúng ký hiệu vừa thả (còn 15 item)',
    (await itemIds(page)).length === 15,
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  await sleep(400);
  check('Ctrl+Y: dựng lại ký hiệu (16 item)', (await itemIds(page)).length === 16);
  await shot('2-da-tha');

  // ---------- Dính điểm gắn trên màn hình `chinh` ----------
  await treeItem(page, 'Chính');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(400);
  await drag(page, 'pipe-h', 400, 300);
  await sleep(300);
  await save(page);
  let chinh = JSON.parse((await written(page, 'screens/chinh.screen.json')) ?? '{"items":[]}');
  const a = chinh.items.find((i) => i.svgFile.endsWith('pipe-h.svg'));
  check(
    'Thả ống ngang: item đặt dính lưới (bội của 20)',
    a !== undefined && a.x % 20 === 0 && a.y % 20 === 0,
    JSON.stringify(a),
  );
  // Ống thứ hai: điểm west cách điểm east của ống thứ nhất vài điểm.
  const cx = a.x + a.width + a.width / 2 + 4;
  const cy = a.y + a.height / 2 + 3;
  await drag(page, 'pipe-h', cx, cy, { drop: false });
  await sleep(100);
  const hits = await hitDots(page);
  const dots = await allDots(page);
  check(
    'Kéo gần điểm gắn: hiện chấm xanh ở cặp sắp dính (2 chấm) trong các chấm điểm gắn',
    hits === 2 && dots >= 4,
    `${hits} / ${dots}`,
  );
  await shot('3-dinh-diem-gan');
  await dropNow(page, cx, cy);
  await sleep(300);
  await save(page);
  chinh = JSON.parse((await written(page, 'screens/chinh.screen.json')) ?? '{"items":[]}');
  const pipes = chinh.items.filter((i) => i.svgFile.endsWith('pipe-h.svg'));
  const b = pipes.find((i) => i.id !== a.id);
  check(
    'Thả: ống thứ hai dính điểm gắn (west trùng east của ống thứ nhất)',
    b !== undefined && b.x === a.x + a.width && b.y === a.y,
    JSON.stringify([a, b]),
  );
  // Ống thứ ba cùng cách, giữ Alt: không dính.
  const cx3 = b.x + b.width + b.width / 2 + 4;
  const cy3 = b.y + b.height / 2 + 3;
  await drag(page, 'pipe-h', cx3, cy3, { alt: true, drop: false });
  await sleep(100);
  check('Giữ Alt: không có chấm xanh (tắt dính)', (await hitDots(page)) === 0);
  await dropNow(page, cx3, cy3, true);
  await sleep(300);
  await save(page);
  chinh = JSON.parse((await written(page, 'screens/chinh.screen.json')) ?? '{"items":[]}');
  const c = chinh.items
    .filter((i) => i.svgFile.endsWith('pipe-h.svg'))
    .find((i) => i.id !== a.id && i.id !== b.id);
  check(
    'Alt: item đặt đúng điểm thả (làm tròn), không dính lưới, không dính điểm gắn',
    c !== undefined &&
      Math.abs(c.x - Math.round(cx3 - c.width / 2)) <= 1 &&
      Math.abs(c.y - Math.round(cy3 - c.height / 2)) <= 1 &&
      c.x !== b.x + b.width &&
      (c.x % 20 !== 0 || c.y % 20 !== 0),
    JSON.stringify(c),
  );
  // Hướng cùng phía không dính: ống thả sao cho west gần west của ống a.
  await drag(page, 'pipe-h', a.x + a.width / 2 - 3, a.y + 40, { drop: false });
  await sleep(100);
  check('Hai điểm cùng hướng gần nhau: không dính', (await hitDots(page)) === 0);
  await page.evaluate(() => {
    const dst = document.querySelector('mat-screen-canvas .vp');
    dst.dispatchEvent(new DragEvent('dragleave', { bubbles: true, composed: true }));
  });
  await sleep(100);
  check('Rời canvas: chấm điểm gắn biến mất', (await allDots(page)) === 0);

  // ---------- T092: Gắn nhanh ----------
  await drag(page, 'pump-centrifugal', 900, 500);
  await sleep(500);
  await page.waitForSelector('mat-svg-quick .qb-row');
  const rows = await page.$$eval('mat-svg-quick .qb-row', (e) => e.map((x) => x.dataset.part));
  check(
    'Gắn nhanh: item bơm liệt kê bốn bộ phận',
    rows.join() === 'body,impeller,lamp,hit',
    rows.join(),
  );
  const portRows = await page.$$eval('mat-svg-quick .qb-port', (e) => e.map((x) => x.dataset.port));
  check(
    'Gắn nhanh: liệt kê hai điểm gắn của bơm (in, out)',
    portRows.join() === 'in,out',
    portRows.join(),
  );
  const lampChip = await page.$eval('mat-svg-quick [data-part="lamp"] .chip', (e) =>
    e.textContent.trim(),
  );
  check(
    'Bộ phận đèn gợi ý Màu nền và Nhấp nháy',
    /Màu nền/.test(lampChip) && /nháy/.test(lampChip),
    lampChip,
  );
  await axeBoth(page, axe, 'Gắn nhanh');
  await page.click('mat-svg-quick [data-quick="lamp"]');
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(500);
  const sel = await page.$$eval('mat-svg-overlay .svo-sel', (e) => e.map((x) => x.dataset.uid));
  check(
    'Bấm "Gắn…" của đèn: vào item và chọn đúng phần tử đèn',
    sel.join() === 'el_pump_centrifugal_lamp',
    sel.join(),
  );
  const tab = await page.$eval('#svp-tab-bind', (e) => e.getAttribute('aria-selected'));
  check('Mở nhóm Gắn Tag', tab === 'true');
  const rowFocus = await page.evaluate(
    () => document.activeElement?.closest('[data-row]')?.dataset.row ?? '',
  );
  check(
    'Mở đúng dòng gợi ý đầu tiên (Màu nền) và đưa focus vào dòng',
    rowFocus === 'fill',
    rowFocus,
  );
  await shot('4-gan-nhanh');
  // Thoát item rồi gắn nhanh vùng nhấp: mở nhóm Sự kiện.
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.waitForSelector('mat-svg-quick [data-quick="hit"]');
  await page.click('mat-svg-quick [data-quick="hit"]');
  await waitFor(
    page,
    () => document.querySelector('#svp-tab-events')?.getAttribute('aria-selected') === 'true',
  );
  check('Bộ phận vùng nhấp: mở nhóm Sự kiện', true);
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(200);

  // ---------- Hai theme ----------
  await openToolbox(page);
  await axeBoth(page, axe, 'Toolbox Ký hiệu SVG');

  // ---------- 40 item svg: đo thời gian dựng ----------
  await openAndWait(page, project(manyItems(40)), 'D:\\Projects\\ky-hieu-40').catch(
    () => undefined,
  );
  await page.evaluate(() => window.location.reload());
  await page.waitForSelector('mat-start-page .start-hero');
  await openAndWait(page, project(manyItems(40)), 'D:\\Projects\\ky-hieu-40');
  const t0 = Date.now();
  await treeItem(page, 'Bồn nước');
  await waitFor(
    page,
    () => {
      const hosts = document
        .querySelector('mat-screen-canvas mat-screen')
        ?.shadowRoot?.querySelectorAll('.item .svg-host');
      return (
        hosts && hosts.length === 40 && [...hosts].every((h) => h.shadowRoot?.querySelector('svg'))
      );
    },
    undefined,
    30000,
  );
  const ms = Date.now() - t0;
  check(
    '40 item svg trên một màn hình: mở được, dựng hết trong 5 giây (đo thật)',
    ms < 5000,
    `${ms} ms`,
  );
  console.log(`  [đo] 40 item svg dựng xong sau ${ms} ms`);
  const errs40 = await page.evaluate(
    () => document.querySelector('mat-statusbar')?.textContent ?? '',
  );
  check('40 item svg: không báo lỗi giới hạn', !/[1-9]\d* lỗi/.test(errs40), errs40.slice(-60));

  // ---------- 65 item: E_LIMIT ----------
  await page.evaluate(() => window.location.reload());
  await page.waitForSelector('mat-start-page .start-hero');
  await openAndWait(page, project(manyItems(65)), 'D:\\Projects\\ky-hieu-65');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(1500);
  await page.$$eval('mat-inspector [role="tab"]', (tabs) =>
    tabs.find((x) => /Thông tin/.test(x.textContent))?.click(),
  );
  const limit = await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-inspector .issue .code')].some(
        (c) => c.textContent.trim() === 'E_LIMIT',
      ),
    undefined,
    15000,
  ).then(
    () => true,
    () => false,
  );
  check('65 item svg: bộ kiểm tra báo E_LIMIT', limit);
  // Với 64 item, thả thêm bị từ chối, không thêm item.
  await page.evaluate(() => window.location.reload());
  await page.waitForSelector('mat-start-page .start-hero');
  await openAndWait(page, project(manyItems(64)), 'D:\\Projects\\ky-hieu-64');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(1500);
  await openToolbox(page);
  await drag(page, 'pipe-h', 1100, 650);
  await sleep(400);
  const toast = await page.evaluate(() => document.body.innerText);
  check(
    'Đủ 64 item: thả ký hiệu thứ 65 bị từ chối kèm lý do, không thêm item',
    /đủ 64 đồ họa SVG/.test(toast) && (await itemIds(page)).length === 64,
    String((await itemIds(page)).length),
  );
  void runCommand;
}
