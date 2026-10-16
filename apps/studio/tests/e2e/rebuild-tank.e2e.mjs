// E2E dựng lại màn hình bồn nước + motor bằng giao diện (feature 008, T095, SC-004; contract studio-svg-editor §14): từ project rỗng
// có Tag của tank-demo, dựng bằng ký hiệu (bồn, ống, motor), nhập đồ họa Inkscape thật (inkscape-02), gắn mức, chữ, đèn theo bảng giá
// trị, quay motor, dòng chảy và sự kiện xung; `validate` không lỗi; lưu; ghi số thao tác của người dùng. Phần so với runtime x64 là
// tools/svg-demo/compare-tank.mjs (cần Docker, chạy riêng). Lớp Tauri giả, Chrome headless.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bonProject } from './svg-fixture.mjs';
import { REPO, designToPage, openAndWait, press, sleep, treeItem, waitFor } from './util.mjs';

const TAGS = [
  [
    'TANK01.LEVEL',
    'FLOAT32',
    'Mức nước bồn',
    '%',
    0,
    100,
    { kind: 'sine', center: 50, amplitude: 40, periodMs: 20000 },
  ],
  [
    'MOTOR01.RUN',
    'BOOL',
    'Bơm đang chạy',
    undefined,
    undefined,
    undefined,
    { kind: 'square', periodMs: 8000 },
  ],
  [
    'MOTOR01.SPEED',
    'FLOAT32',
    'Tốc độ bơm',
    'rpm',
    0,
    1500,
    { kind: 'ramp', from: 0, to: 1500, periodMs: 30000 },
  ],
  [
    'TANK01.INFLOW',
    'FLOAT32',
    'Lưu lượng vào bồn',
    'm3/h',
    0,
    20,
    { kind: 'sine', center: 10, amplitude: 8, periodMs: 15000 },
  ],
  [
    'TANK01.TEMP',
    'FLOAT32',
    'Nhiệt độ nước',
    '°C',
    0,
    100,
    { kind: 'sine', center: 40, amplitude: 20, periodMs: 25000 },
  ],
].map(([id, type, description, unit, min, max, sim]) => ({
  id,
  kind: 'simulation',
  type,
  description,
  ...(unit ? { unit } : {}),
  ...(min !== undefined ? { min, max } : {}),
  sim,
}));
TAGS.push(
  {
    id: 'MOTOR01.STATE',
    kind: 'simulation',
    type: 'INT16',
    description: 'Trạng thái bơm',
    valueTable: 'TrangThaiBom',
    sim: { kind: 'ramp', from: 0, to: 2, periodMs: 9000 },
  },
  {
    id: 'MOTOR01.PULSE',
    kind: 'simulation',
    type: 'BOOL',
    description: 'Lệnh xung bơm',
    access: 'RW',
    sim: { kind: 'manual', initial: false },
  },
);

/** Project 0.4 rỗng: một màn hình `bon` không có item, Tag của tank-demo (dạng mô phỏng 0.4) cộng bảng giá trị. */
function emptyTankProject() {
  const files = bonProject();
  delete files['graphics/bon.svg'];
  delete files['screens/bon.svg1.bindings.json'];
  const scr = JSON.parse(files['screens/bon.screen.json']);
  scr.items = [];
  files['screens/bon.screen.json'] = JSON.stringify(scr, null, 2) + '\n';
  files['tags.json'] = JSON.stringify({ schemaVersion: '0.4.0', tags: TAGS }, null, 2) + '\n';
  return files;
}

let ops = 0;
/** Một thao tác của người dùng (nhấp, kéo thả, chọn, gõ một ô). */
const op = async (fn) => {
  ops++;
  return fn();
};

const rowSel = (id) => `mat-svg-bind [data-row="${id}"]`;
const dropTag = (page, sel, tagId) =>
  page.evaluate(
    (s, tg) => {
      const el = document.querySelector(s);
      const dt = new DataTransfer();
      dt.setData('application/x-mat-tag', tg);
      const o = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
      el.dispatchEvent(new DragEvent('dragenter', o));
      el.dispatchEvent(new DragEvent('dragover', o));
      el.dispatchEvent(new DragEvent('drop', o));
    },
    sel,
    tagId,
  );

async function dragSymbol(page, key, dx, dy) {
  const p = await designToPage(page, dx, dy);
  await page.evaluate(
    (k, x, y) => {
      const src = document.querySelector(`.sym[data-symbol="${k}"]`);
      const dst = document.querySelector('mat-screen-canvas .vp');
      const dt = new DataTransfer();
      const o = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
      };
      src.dispatchEvent(new DragEvent('dragstart', o));
      dst.dispatchEvent(new DragEvent('dragenter', o));
      dst.dispatchEvent(new DragEvent('dragover', o));
      dst.dispatchEvent(new DragEvent('drop', o));
      src.dispatchEvent(new DragEvent('dragend', o));
    },
    key,
    p.x,
    p.y,
  );
  await sleep(250);
}

const entered = (page) => page.$('mat-screen-canvas .vp.entered').then((e) => e !== null);

async function enterAt(page, dx, dy) {
  const at = await designToPage(page, dx, dy);
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(500);
}

async function leave(page) {
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(250);
}

/** Chọn phần tử trong cây, mở nhóm Gắn Tag và thả Tag lên dòng `row`. */
async function bindRow(page, uid, row, tag) {
  await op(() => page.click(`mat-svg-tree [data-uid="${uid}"]`));
  await page.waitForSelector('#svp-tab-bind');
  if ((await page.$eval('#svp-tab-bind', (e) => e.getAttribute('aria-selected'))) !== 'true')
    await op(() => page.click('#svp-tab-bind'));
  await page.waitForSelector(rowSel(row));
  await op(() => dropTag(page, rowSel(row), tag));
  await waitFor(
    page,
    (a) => document.querySelector(`[data-row="${a[0]}"] .tagbtn`)?.textContent.includes(a[1]),
    [row, tag],
  );
  await sleep(150);
}

export default async function rebuildTank({ page, check, shot }) {
  const files = emptyTankProject();
  await openAndWait(page, files, 'D:\\Projects\\bon-nuoc-dung-lai');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);
  if (!(await page.$('.tc-panel'))) await page.click('.tc-strip [data-tc="toolbox"]');
  await page.waitForSelector('.tc-body .sym');

  // ---------- Dựng bằng ký hiệu ----------
  await op(() => dragSymbol(page, 'tank-vertical', 190, 260));
  await op(() => dragSymbol(page, 'pipe-h', 330, 300));
  await op(() => dragSymbol(page, 'motor-ac', 520, 300));
  await op(() => dragSymbol(page, 'pipe-h', 660, 300));
  const ids = await page.evaluate(() =>
    [
      ...document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelectorAll('.item[data-item-id]'),
    ].map((e) => e.dataset.itemId),
  );
  check('dựng bằng ký hiệu: bồn, hai ống, motor trên màn hình', ids.length === 4, ids.join());
  await shot('1-dung-bang-ky-hieu');

  // ---------- Bồn: mức và chữ ----------
  const item = (id) =>
    page.evaluate((i) => {
      const e = document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelector(`.item[data-item-id="${i}"]`);
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
  const clickAt = async (id, count) => {
    const c = await item(id);
    await page.mouse.click(c.x, c.y);
    await page.mouse.click(c.x, c.y, { count });
  };
  void enterAt;
  await op(() => clickAt('tank_vertical_1', 2));
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(500);
  await bindRow(page, 'el_tank_vertical_liquid', 'level', 'TANK01.LEVEL');
  const levelTarget = await page.$eval(`${rowSel('level')} .nm i`, (e) => e.textContent.trim());
  check(
    'Mức chất lỏng của bồn: đích levelPercent, Tag TANK01.LEVEL',
    levelTarget === 'geometry.levelPercent',
    levelTarget,
  );
  await bindRow(page, 'el_tank_vertical_text', 'text', 'TANK01.LEVEL');
  await op(() => leave(page));

  // ---------- Motor: quay, đèn theo bảng, chữ tốc độ, sự kiện xung ----------
  await op(() => clickAt('motor_ac_1', 2));
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(500);
  await bindRow(page, 'el_motor_ac_rotor', 'spin', 'MOTOR01.RUN');
  await bindRow(page, 'el_motor_ac_lamp', 'fill', 'MOTOR01.STATE');
  await op(() => page.select(`${rowSel('fill')} select.xf`, 'valueTable'));
  await sleep(250);
  const xf = await page.$eval(`${rowSel('fill')} select.xf`, (s) =>
    s.selectedOptions[0].textContent.trim(),
  );
  check('đèn trạng thái: phép Bảng giá trị (TrangThaiBom)', /Bảng giá trị/.test(xf), xf);
  await bindRow(page, 'el_motor_ac_text', 'text', 'MOTOR01.SPEED');
  await op(() => page.click('mat-svg-tree [data-uid="el_motor_ac_hit"]'));
  await op(() => page.click('#svp-tab-events'));
  await page.waitForSelector('mat-svg-events #sve-action');
  await op(() => page.select('#sve-action', 'pulse'));
  await page.waitForSelector('#sve-tag');
  await op(() => page.click('#sve-tag'));
  await page.waitForSelector('mat-svg-events mat-tag-chooser input');
  await op(async () => {
    await page.keyboard.type('MOTOR01.PULSE');
    await page.keyboard.press('Enter');
  });
  await waitFor(page, () =>
    document.querySelector('#sve-tag')?.textContent.includes('MOTOR01.PULSE'),
  );
  await sleep(200);
  await shot('2-su-kien-xung');
  await op(() => leave(page));

  // ---------- Ống: dòng chảy ----------
  await op(() => clickAt('pipe_h_1', 2));
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  await sleep(500);
  await bindRow(page, 'el_pipe_h_flow', 'flow', 'MOTOR01.RUN');
  await op(() => leave(page));

  // ---------- Nhập đồ họa Inkscape thật ----------
  const bytes = readFileSync(resolve(REPO, 'tests/fixtures/svg-import/inkscape-02-motor-pump.svg'));
  await page.evaluate(
    (n, b) => {
      window.__matMock.svgOpenResult = { name: n, bytes: new Uint8Array(b) };
    },
    'inkscape-02-motor-pump.svg',
    Array.from(bytes),
  );
  await op(() => press(page, 'Control+Shift+I'));
  await page.waitForSelector('mat-import-svg-dialog [data-role="ok"]:not([disabled])', {
    timeout: 15000,
  });
  await op(() => page.click('mat-import-svg-dialog [data-role="ok"]'));
  await waitFor(page, () => !document.querySelector('mat-import-svg-dialog [role="dialog"]'));
  await sleep(500);
  const idsAfter = await page.evaluate(() =>
    [
      ...document
        .querySelector('mat-screen-canvas mat-screen')
        .shadowRoot.querySelectorAll('.item[data-item-id]'),
    ].map((e) => e.dataset.itemId),
  );
  check('nhập inkscape-02: thêm một item svg', idsAfter.length === 5, idsAfter.join());
  await shot('3-sau-khi-nhap');

  // ---------- Lưu và kiểm ----------
  await op(async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await press(page, 'Control+s');
    await sleep(800);
  });
  const writes = await page.evaluate(() =>
    window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })),
  );
  const latest = new Map();
  for (const w of writes) latest.set(w.rel, w.content);
  const status = await page.evaluate(
    () => document.querySelector('mat-statusbar')?.textContent ?? '',
  );
  check(
    'thanh trạng thái: không có lỗi sau khi lưu',
    !/[1-9]\d* lỗi/.test(status),
    status.slice(-60),
  );

  const tmp = mkdtempSync(join(tmpdir(), 'mat-rebuild-tank-'));
  try {
    const merged = { ...files };
    for (const [rel, content] of latest) merged[rel] = content;
    for (const [rel, text] of Object.entries(merged)) {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      writeFileSync(join(tmp, rel), text);
    }
    const v = spawnSync(
      process.execPath,
      [resolve(REPO, 'tools/project-validator/validate.mjs'), tmp],
      { encoding: 'utf8' },
    );
    const r = JSON.parse(v.stdout);
    check(
      'validate (bộ kiểm tra TS) của project đã dựng lại: 0 lỗi',
      r.valid === true && r.errors.length === 0,
      JSON.stringify(r.errors).slice(0, 300),
    );

    // Đích binding so với tank-demo gốc: mức, chữ, màu theo trạng thái, quay, dòng chảy, sự kiện xung.
    const targets = new Set();
    let events = 0;
    for (const rel of Object.keys(merged).filter((x) => x.endsWith('.bindings.json')))
      for (const e of JSON.parse(merged[rel]).elements) {
        for (const b of e.bindings ?? []) targets.add(b.animation === 'spin' ? 'spin' : b.target);
        if (e.events?.click?.action === 'pulse') events++;
      }
    const want = ['geometry.levelPercent', 'text.content', 'style.fill', 'spin', 'effect.flow'];
    check(
      'đích binding phủ: mức, chữ, đèn (fill), quay motor (spin), dòng chảy, và có sự kiện xung',
      want.every((t) => targets.has(t)) && events === 1,
      `${[...targets].join()}; xung ${events}`,
    );
    const lampBinding = Object.entries(merged)
      .filter(([rel]) => rel.endsWith('.bindings.json'))
      .flatMap(([, t]) => JSON.parse(t).elements)
      .find((e) => e.elementUid === 'el_motor_ac_lamp')?.bindings?.[0];
    check(
      'đèn gắn Bảng giá trị TrangThaiBom (INT16)',
      lampBinding?.transform?.kind === 'valueTable' && lampBinding.source.tagId === 'MOTOR01.STATE',
      JSON.stringify(lampBinding?.transform),
    );
    // Sao lưu project đã dựng cho compare-tank.mjs.
    if (process.env.MAT_REBUILD_OUT) {
      for (const [rel, text] of Object.entries(merged)) {
        mkdirSync(dirname(join(process.env.MAT_REBUILD_OUT, rel)), { recursive: true });
        writeFileSync(join(process.env.MAT_REBUILD_OUT, rel), text);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`  [đo] dựng lại màn hình bồn nước + motor: ${ops} thao tác của người dùng`);
  check('số thao tác dựng lại được ghi (≤ 60)', ops > 0 && ops <= 60, `${ops} thao tác`);
  void entered;
}
