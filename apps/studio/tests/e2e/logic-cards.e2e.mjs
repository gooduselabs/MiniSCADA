// E2E khung nhìn "Luật" dạng thẻ (feature 043, "Logic dễ hiểu"): mặc định khi mở Logic; thẻ có màu/icon theo loại và đọc như
// câu; "+ Thêm luật" mở bộ chọn mẫu có hình; chọn mẫu → thẻ điền sẵn, chọn Tag bằng ô tìm hoặc kéo thả; sửa chip (giá trị, giữ
// liên tục, giờ) ghi đúng logic.json; Thử luật (giá trị giả, giờ giả lập) báo kích hoạt và việc sẽ ghi; luật nâng cao mở trình
// soạn đầy đủ; bật/tắt, nhân bản, nhóm, tìm; lỗi hiện bằng câu trong thẻ; axe 0 critical/serious ở hai theme.
// Ảnh chụp: tests/e2e/out/ và thư mục MAT_SHOTS (nếu đặt).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  REPO,
  axeScopedBoth,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

const EXTRA_TAGS = [
  {
    id: 'OVEN.TEMP',
    kind: 'external',
    type: 'FLOAT32',
    unit: '°C',
    description: 'Nhiệt độ lò',
    source: { device: 'plc1', address: 'HR120' },
  },
  {
    id: 'FAN.RUN',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    description: 'Quạt làm mát',
    source: { device: 'plc1', address: 'C121' },
  },
  {
    id: 'INT.MODE_AUTO',
    kind: 'internal',
    type: 'BOOL',
    access: 'RW',
    initial: false,
    description: 'Chế độ tự động',
  },
];

const LOGIC = {
  schemaVersion: '1.0.0',
  writes: [
    {
      id: 'w_pump_run',
      tag: 'PUMP01.RUN_CMD',
      allowed: { values: [true, false] },
      minIntervalMs: 30000,
      maxPerHour: 20,
    },
  ],
  rules: [
    {
      id: 'auto_on',
      name: 'Chọn tự động khi trạng thái = 1',
      when: 'PUMP01.STATE == 1',
      hold: 0,
      onRise: [{ do: 'setTag', tag: 'INT.MODE_AUTO', value: true }],
      onFall: [],
    },
    {
      id: 'pump_7h',
      name: 'Chạy bơm lúc 7 giờ',
      when: 'LOGIC.S_7H.Q',
      onRise: [{ do: 'write', write: 'w_pump_run', value: true }],
      onFall: [],
    },
    {
      id: 'pump_high_level',
      name: 'Tắt bơm khi mức cao liên tục',
      when: 'TANK01.LEVEL > 80',
      hold: 5000,
      onRise: [{ do: 'write', write: 'w_pump_run', value: false }],
      onFall: [],
    },
    {
      id: 'complex',
      name: 'Luật biểu thức phức tạp',
      when: 'TANK01.LEVEL * 2 > TANK01.SP + 5',
      hold: 1000,
      onRise: [{ do: 'setTag', tag: 'INT.MODE_AUTO', value: false }],
      onFall: [],
    },
  ],
  timers: [
    {
      id: 't_start',
      kind: 'ton',
      in: 'PUMP01.RUN_CMD',
      pt: 5000,
      q: 'LOGIC.T_START.Q',
      et: 'LOGIC.T_START.ET',
    },
  ],
  schedules: [
    {
      id: 's_7h',
      weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '07:00', to: '07:01' }],
      exceptions: [],
      out: 'LOGIC.S_7H.Q',
    },
  ],
};

function project() {
  const files = readProject(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  const tags = JSON.parse(files['tags.json']);
  const have = new Set(tags.tags.map((t) => t.id));
  for (const t of EXTRA_TAGS) if (!have.has(t.id)) tags.tags.push(t);
  files['tags.json'] = JSON.stringify(tags, null, 2) + '\n';
  files['logic.json'] = JSON.stringify(LOGIC, null, 2) + '\n';
  return files;
}

const logicOf = (page) => page.evaluate(() => window.__matApp.store.state.outline.logic);
const click = (page, sel) => page.$eval(sel, (e) => e.click());
async function setValue(page, sel, value) {
  await page.$eval(
    sel,
    (e, v) => {
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );
}
/** Chọn Tag cho chip bằng ô tìm: bấm chip, gõ lọc, chọn dòng. */
async function pickTag(page, chipSel, tag) {
  await click(page, chipSel);
  await page.waitForSelector('mat-logic-cards .lgc-pick input');
  await setValue(page, 'mat-logic-cards .lgc-pick input', tag);
  await page.waitForSelector(`mat-logic-cards .lgc-pick [data-pick="${tag}"]`);
  await click(page, `mat-logic-cards .lgc-pick [data-pick="${tag}"]`);
  await sleep(120);
}

export default async function logicCards(ctx) {
  const { page, check } = ctx;
  const shotsDir = process.env.MAT_SHOTS;
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const shot = async (name) => {
    await ctx.shot(name);
    if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`) });
  };
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\lo-say');
  await treeNode(page, 'logic');
  await page.waitForSelector('mat-logic-cards .lgc-card');
  await page.evaluate(() => {
    const app = window.__matApp;
    if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
      app.setTaskCard('toolbox');
  });
  await sleep(300);

  // ---------- 1. Mặc định là Luật, thẻ theo loại ----------
  const cards = await page.$$eval('mat-logic-cards .lgc-card', (cs) =>
    cs.map((c) => `${c.dataset.card}:${c.dataset.cat}`),
  );
  check(
    'mặc định khung nhìn Luật, thẻ theo loại',
    cards.join(',') ===
      'auto_on:value,pump_7h:time,pump_high_level:value,complex:advanced,t_start:timer',
    cards.join(','),
  );
  const pressed = await page.$eval('mat-logic-editor [data-view="cards"]', (b) =>
    b.getAttribute('aria-pressed'),
  );
  check('nút "Luật" đang chọn', pressed === 'true');
  const sentence = await page.$eval('[data-card="pump_high_level"] .lgc-main', (e) =>
    e.innerText.replace(/\s+/g, ' '),
  );
  check(
    'thẻ đọc như câu (KHI … liên tục … THÌ Tắt …)',
    /KHI/.test(sentence) && /liên tục/.test(sentence) && /THÌ/.test(sentence),
    sentence,
  );
  const hold = await page.$eval('[data-card="pump_high_level"] .lgc-hold input', (e) => e.value);
  check('giữ liên tục 5 giây', hold === '5', hold);
  const at = await page.$eval('[data-card="pump_7h"] .lgc-time', (e) => e.value);
  check('thẻ Theo giờ: VÀO LÚC 07:00', at === '07:00', at);
  check(
    'luật phức tạp hiện "Luật nâng cao"',
    Boolean(await page.$('[data-card="complex"] [data-act="open-adv"]')),
  );
  await shot('01-luat-mac-dinh');

  // ---------- 2. Thêm từ mẫu "Vượt ngưỡng", chọn Tag, sửa chip ----------
  await click(page, 'mat-logic-cards [data-act="add-rule"]');
  await page.waitForSelector('mat-logic-cards .lgc-tpl [data-tpl="threshold"]');
  const tplCount = await page.$$eval('mat-logic-cards .lgc-tpl-item svg', (s) => s.length);
  check('bộ chọn mẫu có 8 mẫu có hình', tplCount === 8, tplCount);
  await shot('02-chon-mau');
  await click(page, 'mat-logic-cards [data-tpl="threshold"]');
  await waitFor(page, () => (window.__matApp.store.state.outline.logic.rules ?? []).length === 5);
  const nid = (await logicOf(page)).rules[4].id;
  await page.waitForSelector(`[data-card="${nid}"]`);
  const errs0 = await page.$eval(
    `[data-card="${nid}"]`,
    (c) => c.querySelector('.lgc-errs')?.innerText ?? '',
  );
  check('thẻ mới báo bằng câu: chưa chọn Tag', /Chưa chọn Tag/.test(errs0), errs0);
  await shot('03-the-moi-tu-mau');
  await pickTag(page, `[data-card="${nid}"] .lgc-tag[data-key="${nid}:c0"]`, 'OVEN.TEMP');
  await setValue(page, `[data-card="${nid}"] .lgc-val`, '90');
  await setValue(page, `[data-card="${nid}"] .lgc-hold input`, '3');
  await pickTag(page, `[data-card="${nid}"] .lgc-tag[data-key="${nid}:rise0"]`, 'FAN.RUN');
  await setValue(page, `[data-card="${nid}"] .lgc-verb`, 'on');
  await setValue(page, `[data-card="${nid}"] .lgc-name`, 'Bật quạt khi lò nóng');
  let doc = await logicOf(page);
  let r = doc.rules.find((x) => x.id === nid);
  check(
    'chip ghi đúng logic.json: when, hold',
    r.when === 'OVEN.TEMP > 90' && r.hold === 3000,
    JSON.stringify(r),
  );
  const w = doc.writes.find((x) => x.id === r.onRise[0]?.write);
  check(
    'Tag thiết bị: Studio tự khai mục writes',
    r.onRise[0]?.do === 'write' && r.onRise[0]?.value === true && w?.tag === 'FAN.RUN',
    JSON.stringify(r.onRise),
  );
  const errs1 = await page.$eval(
    `[data-card="${nid}"]`,
    (c) => c.querySelector('.lgc-errs')?.innerText ?? '',
  );
  check('chọn đủ Tag: hết lỗi trong thẻ', errs1 === '', errs1);

  // ---------- 3. Thử luật ----------
  await click(page, `[data-card="${nid}"] [data-act="try"]`);
  await page.waitForSelector(`[data-card="${nid}"] [data-role="try"]`);
  await setValue(page, `[data-card="${nid}"] [data-try="OVEN.TEMP"]`, '95');
  await click(page, `[data-card="${nid}"] [data-act="try-run"]`);
  await page.waitForSelector(`[data-card="${nid}"] .lgc-try-r`);
  const fired = await page.$eval(`[data-card="${nid}"] .lgc-try-r`, (e) => ({
    f: e.dataset.fired,
    t: e.innerText,
  }));
  check(
    'Thử: 95 > 90 liên tục 3 s → kích hoạt, ghi FAN.RUN = true',
    fired.f === 'true' && /FAN\.RUN/.test(fired.t),
    fired.t,
  );
  await shot('04-thu-luat');
  await setValue(page, `[data-card="${nid}"] [data-try="OVEN.TEMP"]`, '50');
  await click(page, `[data-card="${nid}"] [data-act="try-run"]`);
  await sleep(100);
  const nf = await page.$eval(`[data-card="${nid}"] .lgc-try-r`, (e) => e.dataset.fired);
  check('Thử: 50 không vượt ngưỡng → không làm gì', nf === 'false', nf);

  // thử luật theo giờ: 07:00 thứ Hai kích
  await click(page, '[data-card="pump_7h"] [data-act="try"]');
  await page.waitForSelector('[data-card="pump_7h"] [data-try="time"]');
  await setValue(page, '[data-card="pump_7h"] [data-try="time"]', '07:00');
  await click(page, '[data-card="pump_7h"] [data-act="try-run"]');
  await page.waitForSelector('[data-card="pump_7h"] .lgc-try-r');
  const f7 = await page.$eval('[data-card="pump_7h"] .lgc-try-r', (e) => e.dataset.fired);
  check('Thử giờ giả lập 07:00 → luật Theo giờ kích hoạt', f7 === 'true', f7);

  // ---------- 4. Sửa giờ; mẫu "Đến giờ" + kéo Tag từ task card thả vào chip ----------
  await setValue(page, '[data-card="pump_7h"] .lgc-time', '06:30');
  doc = await logicOf(page);
  check(
    'đổi giờ: Lịch thành 06:30–06:31',
    JSON.stringify(doc.schedules[0].weekly[0]) ===
      JSON.stringify({ days: [1, 2, 3, 4, 5, 6, 7], from: '06:30', to: '06:31' }),
    JSON.stringify(doc.schedules[0]),
  );
  await click(page, 'mat-logic-cards [data-act="add-rule"]');
  await page.waitForSelector('mat-logic-cards [data-tpl="at"]');
  await click(page, 'mat-logic-cards [data-tpl="at"]');
  await waitFor(page, () => window.__matApp.store.state.outline.logic.rules.length === 6);
  const aid = (await logicOf(page)).rules[5].id;
  await page.waitForSelector(`[data-card="${aid}"] .lgc-tag[data-key="${aid}:rise0"]`);
  await page.$eval(`[data-card="${aid}"] .lgc-tag[data-key="${aid}:rise0"]`, (el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'PUMP02.CMD');
    el.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await sleep(150);
  doc = await logicOf(page);
  r = doc.rules.find((x) => x.id === aid);
  const sched = doc.schedules.find((s) => s.out === r.when);
  check(
    'mẫu Đến giờ: Lịch 07:00 mỗi ngày, thả Tag vào chip → ghi PUMP02.CMD',
    sched?.weekly[0].from === '07:00' &&
      doc.writes.find((x) => x.id === r.onRise[0]?.write)?.tag === 'PUMP02.CMD',
    JSON.stringify({ r, sched }),
  );

  // ---------- 5. Bật/tắt, nhân bản, nhóm, tìm ----------
  await page.$eval('[data-card="auto_on"] [data-act="enabled"]', (e) => e.click());
  doc = await logicOf(page);
  check(
    'công tắc tắt luật → enabled false',
    doc.rules.find((x) => x.id === 'auto_on').enabled === false,
  );
  await click(page, '[data-card="auto_on"] [data-act="dup"]');
  await waitFor(page, () => window.__matApp.store.state.outline.logic.rules.length === 7);
  doc = await logicOf(page);
  check('nhân bản đặt ngay sau bản gốc', doc.rules[1].name.includes('bản sao'), doc.rules[1].name);
  await click(page, '[data-card="pump_high_level"] [data-act="group"]');
  await page.waitForSelector('mat-logic-cards .lgc-groupin');
  await page.$eval('mat-logic-cards .lgc-groupin', (e) => {
    e.value = 'Khu bồn';
    e.dispatchEvent(new Event('blur'));
  });
  await page.waitForSelector('mat-logic-cards [data-group="Khu bồn"]');
  check(
    'nhóm "Khu bồn" hiện thành mục riêng',
    Boolean(await page.$('[data-group="Khu bồn"] [data-card="pump_high_level"]')),
  );
  await setValue(page, 'mat-logic-cards [data-role="card-search"]', 'quạt');
  await sleep(100);
  const found = await page.$$eval('mat-logic-cards .lgc-card', (cs) =>
    cs.map((c) => c.dataset.card),
  );
  check('tìm "quạt" chỉ còn luật quạt', found.length === 1 && found[0] === nid, found.join(','));
  await setValue(page, 'mat-logic-cards [data-role="card-search"]', '');

  // ---------- 6. Lỗi bằng câu: Tag chỉ đọc ----------
  await pickTag(page, `[data-card="${nid}"] .lgc-tag[data-key="${nid}:rise0"]`, 'PUMP01.FAULT');
  await sleep(100);
  const ro = await page.$eval(
    `[data-card="${nid}"]`,
    (c) => c.querySelector('.lgc-errs')?.innerText ?? '',
  );
  check('Tag chỉ đọc → lỗi bằng câu trong thẻ', /chỉ đọc/.test(ro), ro);
  await pickTag(page, `[data-card="${nid}"] .lgc-tag[data-key="${nid}:rise0"]`, 'FAN.RUN');
  await shot('05-sau-khi-sua');

  // ---------- 7. Theme tối, trợ năng ----------
  await setTheme(page, 'dark');
  await sleep(150);
  await shot('06-theme-toi');
  await click(page, 'mat-logic-cards [data-act="add-rule"]');
  await page.waitForSelector('mat-logic-cards .lgc-tpl');
  await shot('07-chon-mau-toi');
  await page.$eval('mat-logic-cards .lgc-tpl .ibtn', (b) => b.click());
  await setTheme(page, 'light');
  await axeScopedBoth(ctx, 'khung nhìn Luật', ['mat-screen', 'mat-logic-diagram']);

  // ---------- 8. Nâng cao ----------
  await click(page, '[data-card="complex"] [data-act="open-adv"]');
  await page.waitForSelector('mat-logic-editor table.lg-grid');
  const sel = await page.evaluate(
    () =>
      document.querySelector('mat-logic-editor table.lg-grid tr[aria-selected="true"]')?.dataset
        .id ?? '',
  );
  check('"Mở trong trình soạn đầy đủ" → Bảng, chọn đúng luật', sel === 'complex', sel);
  await click(page, 'mat-logic-editor [data-view="cards"]');
  await page.waitForSelector('mat-logic-cards .lgc-card');
}
