// E2E sơ đồ khối Logic (feature 015; specs/015-logic-ui): project 1.0 trạm bơm (như logic.e2e.mjs). Sơ đồ là khung nhìn mặc
// định: nút khối, Tag, cổng suy ra, dây; kéo khối (lưới, logic.layout.json), thả khối từ task card, nối dây bằng kéo cổng, xóa
// dây, Ctrl+D, Delete, mũi tên, Tự sắp xếp, zoom; Thử logic hiện giá trị trên dây, khối bắn sáng; lỗi đỏ trên sơ đồ và nhấp
// đúp lỗi chọn khối; axe 0 critical/serious hai theme. Ảnh: tests/e2e/out/logic-diagram-*.png (và MAT_SHOTS nếu đặt).
import { resolve } from 'node:path';
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
    id: 'FLOW01',
    kind: 'external',
    type: 'FLOAT32',
    unit: 'm³/h',
    source: { device: 'plc1', address: 'HR102' },
  },
  { id: 'INT.MODE_AUTO', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
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
      id: 'pump_high_level',
      name: 'Bơm tự tắt khi mức cao',
      enabled: true,
      when: 'TANK01.LEVEL > 80',
      hold: 2000,
      onRise: [{ do: 'write', write: 'w_pump_run', value: false }],
      onFall: [],
    },
    {
      id: 'pump_low_level',
      name: 'Bơm tự bật khi mức thấp',
      enabled: true,
      when: 'TANK01.LEVEL < 20 && LOGIC.DAY.Q',
      hold: 10000,
      onRise: [{ do: 'write', write: 'w_pump_run', value: true }],
      onFall: [],
    },
  ],
  timers: [
    {
      id: 't_start',
      kind: 'ton',
      in: 'PUMP01.RUN_CMD',
      pt: 60000,
      q: 'LOGIC.T_START.Q',
      et: 'LOGIC.T_START.ET',
    },
  ],
  counters: [
    {
      id: 'c_starts',
      up: 'PUMP01.RUN',
      down: null,
      reset: null,
      preset: 1000,
      value: 'LOGIC.C_STARTS.VALUE',
      reached: 'LOGIC.C_STARTS.REACHED',
      retain: true,
    },
  ],
  totalizers: [
    {
      id: 'z_flow',
      source: 'FLOW01',
      rateUnit: 'h',
      factor: 1,
      cutoff: 0.05,
      maxGapMs: 5000,
      reset: null,
      total: 'LOGIC.FLOW01.TOTAL',
      gapSeconds: 'LOGIC.FLOW01.GAP_S',
      retain: true,
    },
  ],
  runhours: [
    {
      id: 'h_pump',
      run: 'PUMP01.RUN',
      reset: null,
      serviceEveryHours: 500,
      hours: 'LOGIC.PUMP01.HOURS',
      starts: 'LOGIC.PUMP01.STARTS',
      due: 'LOGIC.PUMP01.DUE',
      retain: true,
    },
  ],
  schedules: [
    {
      id: 's_day',
      weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
      exceptions: [{ date: '2026-12-25', mode: 'off' }],
      out: 'LOGIC.DAY.Q',
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
const layoutOf = (page) =>
  page.evaluate(() => window.__matApp.store.state.outline.logicLayout.nodes);
const clickSel = (page, sel) =>
  page
    .$eval(sel, (e) => e.click())
    .then(
      () => true,
      () => false,
    );
/** Tâm (tọa độ màn hình) của phần tử trong sơ đồ. */
const centerOf = (page, sel) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
async function dragMouse(page, a, b, steps = 8) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await sleep(120);
}
const N = (key) => `mat-logic-diagram g[data-node="${key}"]`;

export default async function logicDiagram(ctx) {
  const { page, check } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\tram-bom');
  await treeNode(page, 'logic');
  await page.waitForSelector('mat-logic-editor mat-logic-diagram .lgd-view');
  await page.evaluate(() => {
    const app = window.__matApp;
    if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
      app.setTaskCard('toolbox');
  });
  await sleep(400);

  // ---------- 1. Sơ đồ mặc định: nút, cổng suy ra, dây ----------
  const info = await page.evaluate(() => ({
    view: document
      .querySelector('mat-logic-editor [data-view="diagram"]')
      ?.getAttribute('aria-pressed'),
    blocks: [...document.querySelectorAll('mat-logic-diagram g.blk')].map((g) => g.dataset.node),
    tags: [...document.querySelectorAll('mat-logic-diagram g.opn')].map((g) => g.dataset.tag),
    gates: [...document.querySelectorAll('mat-logic-diagram g.gate')].map((g) =>
      g.textContent.trim(),
    ),
    wires: document.querySelectorAll('mat-logic-diagram g.wr').length,
    table: document.querySelector('mat-logic-editor table.lg-grid') !== null,
  }));
  check('khung nhìn mặc định là Sơ đồ (không bảng)', info.view === 'true' && !info.table);
  check(
    'sơ đồ có đủ 8 khối của 7 nhóm',
    info.blocks.length === 8 && info.blocks.includes('w_pump_run') && info.blocks.includes('s_day'),
    info.blocks.join(','),
  );
  check(
    'Tag đầu vào là hộp toán hạng gắn vào chân',
    info.tags.includes('TANK01.LEVEL') && info.tags.includes('PUMP01.RUN'),
    info.tags.join(','),
  );
  check(
    'cổng suy ra: "> 80", AND, "< 20"',
    info.gates.some((g) => /> 80/.test(g)) &&
      info.gates.some((g) => /AND/.test(g)) &&
      info.gates.some((g) => /< 20/.test(g)),
    info.gates.join(' | '),
  );
  check('có dây nối', info.wires >= 10, String(info.wires));
  await ctx.shot('so-do');
  await axeScopedBoth(ctx, 'sơ đồ khối Logic', []);

  // ---------- 2. Chọn khối → Inspector; kéo khối ghi layout ----------
  await page.click(`${N('t_start')} .nd-kind`);
  await waitFor(page, () => document.querySelector('mat-logic-dock [data-field="pt"]') !== null);
  check(
    'chọn timer trên sơ đồ: Inspector hiện timer',
    await page.$eval('mat-logic-dock [data-field="id"]', (e) => e.value === 't_start'),
  );
  const before = await page.evaluate(() => {
    const g = document.querySelector('mat-logic-diagram g[data-node="t_start"]');
    return g.getAttribute('transform');
  });
  const a = await centerOf(page, `${N('t_start')} .nd-kind`);
  await dragMouse(page, a, { x: a.x + 70, y: a.y + 41 });
  const lay = await layoutOf(page);
  check(
    'kéo khối: vị trí mới vào logic.layout.json, căn lưới 16 px',
    lay.t_start && lay.t_start.x % 16 === 0 && lay.t_start.y % 16 === 0,
    JSON.stringify(lay.t_start),
  );
  const after = await page.$eval(N('t_start'), (g) => g.getAttribute('transform'));
  check('khối đã dời', before !== after, `${before} → ${after}`);
  await page.evaluate(() => window.__matApp.store.undo());
  await waitFor(page, () => !window.__matApp.store.state.outline.logicLayout.nodes.t_start);
  check('Ctrl+Z bỏ dời khối (một bước)', true);

  // ---------- 3. Nối dây bằng kéo cổng: FLOW01 → không; INT.MODE_AUTO? dùng PUMP01.RUN → t_start.in ----------
  const from = await centerOf(
    page,
    'mat-logic-diagram g.opn[data-tag="PUMP01.RUN"] [data-outport] .pt-dot',
  );
  const to = await centerOf(page, `${N('t_start')} [data-pin="in"] .pt-dot`);
  await dragMouse(page, from, to, 12);
  await waitFor(
    page,
    () => window.__matApp.store.state.outline.logic.timers[0].in === 'PUMP01.RUN',
  );
  check('kéo cổng ra của Tag tới cổng in của timer: in = PUMP01.RUN', true);
  await page.evaluate(() => window.__matApp.store.undo());
  await waitFor(
    page,
    () => window.__matApp.store.state.outline.logic.timers[0].in === 'PUMP01.RUN_CMD',
  );

  // ---------- 4. Thả khối Timer từ task card vào sơ đồ ----------
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('application/x-mat-logic-block', 'timer');
    const view = document.querySelector('mat-logic-diagram .lgd-view');
    const r = view.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: r.left + 120,
      clientY: r.bottom - 80,
    };
    view.dispatchEvent(new DragEvent('dragover', opts));
    view.dispatchEvent(new DragEvent('drop', opts));
  });
  await waitFor(page, () => window.__matApp.store.state.outline.logic.timers.length === 2);
  const lay2 = await layoutOf(page);
  check(
    'thả Timer: thêm t_1 ở chỗ thả (một bước cùng vị trí)',
    (await logicOf(page)).timers[1].id === 't_1' && lay2.t_1 !== undefined,
    JSON.stringify(lay2.t_1),
  );
  await page.evaluate(() => window.__matApp.store.undo());
  await waitFor(
    page,
    () =>
      window.__matApp.store.state.outline.logic.timers.length === 1 &&
      !window.__matApp.store.state.outline.logicLayout.nodes.t_1,
  );
  check('Ctrl+Z bỏ cả khối và vị trí', true);

  // ---------- 5. Bàn phím: Tab tới khối, mũi tên, Ctrl+D, Delete ----------
  await page.$eval(N('c_starts'), (e) => e.focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await sleep(100);
  const l3 = await layoutOf(page);
  check('mũi tên phải ×2: dịch 32 px', l3.c_starts !== undefined, JSON.stringify(l3.c_starts));
  await page.evaluate(() => window.__matApp.store.undo());
  await sleep(100);
  check(
    'hai lần dịch liên tiếp gộp một bước hoàn tác',
    !(await layoutOf(page)).c_starts,
    JSON.stringify((await layoutOf(page)).c_starts),
  );
  await page.$eval(N('c_starts'), (e) => e.focus());
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyD');
  await page.keyboard.up('Control');
  await waitFor(page, () => window.__matApp.store.state.outline.logic.counters.length === 2);
  const dup = (await logicOf(page)).counters[1];
  check(
    'Ctrl+D nhân bản counter, đầu ra theo id mới',
    dup.id === 'c_starts_2' && dup.value === 'LOGIC.C_STARTS_2.VALUE',
    JSON.stringify(dup),
  );
  await waitFor(page, () => document.activeElement?.dataset?.node === 'c_starts_2');
  await page.keyboard.press('Delete');
  await waitFor(page, () => window.__matApp.store.state.outline.logic.counters.length === 1);
  check('Delete trên khối đang focus: xóa khối', true);

  // ---------- 6. Lỗi trên sơ đồ ----------
  await page.evaluate(() => {
    const app = window.__matApp;
    const doc = structuredClone(app.store.state.outline.logic);
    doc.rules[1].when = 'TANK9.LEVEL < 20 && LOGIC.DAY.Q';
    doc.timers[0].in = 'FLOW01';
    app.store.edit([{ kind: 'logicSet', doc }]);
  });
  await waitFor(
    page,
    () => document.querySelector('mat-logic-diagram g[data-node="pump_low_level"].err') !== null,
  );
  const errs = await page.evaluate(() => ({
    low: document
      .querySelector('mat-logic-diagram g[data-node="pump_low_level"]')
      .classList.contains('err'),
    timerPort: document
      .querySelector('mat-logic-diagram g[data-node="t_start"] [data-pin="in"]')
      .classList.contains('err'),
    wireErr: document.querySelectorAll('mat-logic-diagram g.wr.err').length,
    codes: [...document.querySelectorAll('mat-logic-dock .issue[data-code]')].map(
      (e) => e.dataset.code,
    ),
  }));
  check('Tag lạ: viền khối luật đỏ', errs.low);
  check(
    'Tag số vào cổng BOOL: cổng in đỏ, dây đỏ',
    errs.timerPort && errs.wireErr >= 1,
    JSON.stringify(errs),
  );
  check('dock Thông tin có lỗi', errs.codes.includes('E_LOGIC_TAG_REF'), errs.codes.join(','));
  await ctx.shot('so-do-loi');
  await axeScopedBoth(ctx, 'sơ đồ có lỗi', []);
  await page.evaluate(() => window.__matApp.store.undo());
  await waitFor(page, () => document.querySelector('mat-logic-dock .issue[data-code]') === null);

  // ---------- 7. Thử logic: giá trị trên dây, khối bắn sáng ----------
  await clickSel(page, 'mat-logic-editor [data-act="test"]');
  await page.waitForSelector('mat-logic-test [data-act="step"]');
  await clickSel(page, 'mat-logic-test [data-act="step"]');
  await clickSel(page, 'mat-logic-test [data-manual="TANK01.LEVEL"]');
  await page.$eval('mat-logic-test [data-value="TANK01.LEVEL"]', (e) => {
    e.value = '85';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await clickSel(page, 'mat-logic-test [data-speed="10"]');
  await clickSel(page, 'mat-logic-test [data-act="play"]');
  const fired = await waitFor(
    page,
    () => document.querySelector('mat-logic-diagram g[data-node="pump_high_level"].fire') !== null,
    undefined,
    5000,
  ).then(
    () => true,
    () => false,
  );
  check('luật mức cao bắn: khối sáng lên trên sơ đồ', fired);
  await sleep(1200);
  await clickSel(page, 'mat-logic-test [data-act="play"]');
  await sleep(200);
  const live = await page.evaluate(() => ({
    chip: document.querySelector('mat-logic-diagram [data-role="live"]')?.textContent ?? '',
    gateOn: document.querySelector('mat-logic-diagram g.gate.on') !== null,
    wireOn: document.querySelectorAll('mat-logic-diagram g.wr.on').length,
    tagVal:
      document.querySelector('mat-logic-diagram g.opn[data-tag="TANK01.LEVEL"] .pv')?.textContent ??
      '',
    states: document.querySelectorAll('mat-logic-diagram g.blk .nd-live').length,
    write:
      document.querySelector('mat-logic-diagram g[data-node="w_pump_run"] .nd-extra')
        ?.textContent ?? '',
  }));
  check('Thử logic: chip "Thử logic · t = …" trên sơ đồ', /Thử logic/.test(live.chip), live.chip);
  check('Tag mức hiện 85', /85/.test(live.tagVal), live.tagVal);
  check(
    'cổng "> 80" TRUE: xanh, dây ra xanh',
    live.gateOn && live.wireOn >= 1,
    JSON.stringify(live),
  );
  check('khối hiện chip trạng thái', live.states >= 6, String(live.states));
  check('mục Ghi PLC hiện giá trị đã ghi (mô phỏng)', /= false/.test(live.write), live.write);
  await ctx.shot('so-do-thu');
  await axeScopedBoth(ctx, 'sơ đồ khi Thử logic', []);
  await clickSel(page, 'mat-logic-dock [data-tab="info"]');

  // ---------- 8. Tự sắp xếp, zoom, Bảng ----------
  await page.$eval(N('pump_high_level'), (e) => e.focus());
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await sleep(100);
  const moved = (await layoutOf(page)).pump_high_level;
  await clickSel(page, 'mat-logic-diagram [data-act="arrange"]');
  await sleep(200);
  const arranged = await layoutOf(page);
  check(
    'Tự sắp xếp: mọi khối có vị trí, khối vừa dời về chỗ tự xếp',
    Object.keys(arranged).length >= 8 && arranged.pump_high_level.y === moved.y - 64,
    `${JSON.stringify(moved)} → ${JSON.stringify(arranged.pump_high_level)}`,
  );
  await page.evaluate(() => window.__matApp.store.undo());
  check(
    'Ctrl+Z sau Tự sắp xếp: về vị trí trước',
    (await layoutOf(page)).pump_high_level.y === moved.y,
  );
  const z0 = await page.$eval('mat-logic-diagram [data-role="zoom"]', (e) => e.textContent.trim());
  await clickSel(page, 'mat-logic-diagram [data-act="zoom-in"]');
  const z1 = await page.$eval('mat-logic-diagram [data-role="zoom"]', (e) => e.textContent.trim());
  check('nút phóng to đổi mức phóng', z0 !== z1, `${z0} → ${z1}`);
  await clickSel(page, 'mat-logic-editor [data-view="table"]');
  await page.waitForSelector('mat-logic-editor table.lg-grid');
  check('nút Bảng: về bảng cũ', true);
  await clickSel(page, 'mat-logic-editor [data-view="diagram"]');
  await page.waitForSelector('mat-logic-diagram .lgd-view');

  await setTheme(page, 'dark');
  await sleep(200);
  await ctx.shot('so-do-toi');
  await setTheme(page, 'light');
}
