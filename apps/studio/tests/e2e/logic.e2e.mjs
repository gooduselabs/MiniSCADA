// E2E editor Logic (feature 011, T132/T144; FR-094, FR-096, FR-082, FR-083; mockup studio-logic.html đã duyệt ở T007):
// project 1.0 (vector v10-valid-full + Tag trạm bơm + logic.json mẫu): nút Logic trên cây, một tab đổi nhóm, bảng khối,
// Inspector (nhóm ≥ 360 px hoặc xếp dọc), ô biểu thức kiểm khi gõ (E_LOGIC_TAG_REF ở Thông tin, nhấp đúp tới ô), thêm và đổi
// id khối, Lịch; Thử logic (một quét, đặt tay, ×100, đường thời gian SVG, nhật ký); Online runtime 1.0 (thiết bị giả): chip
// Ghi PLC, cột trạng thái sống, Nạp xuống liệt kê ghi tự động và bắt tích "Tôi đã xem danh sách", "Dừng ghi của logic"
// (administrator, không nhập lại mật khẩu) đổi chip thành "dừng"; axe 0 critical/serious ở hai theme.
import { resolve } from 'node:path';
import {
  REPO,
  axeScopedBoth,
  expandNode,
  goOnline,
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
  {
    id: 'VALVE02.SP',
    kind: 'external',
    type: 'FLOAT32',
    access: 'RW',
    source: { device: 'plc1', address: 'HR210' },
  },
  { id: 'INT.MODE_REQ', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
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
      hold: 5000,
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
      pt: 5000,
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
const rows = (page) =>
  page.$$eval('mat-logic-editor table.lg-grid tbody tr[data-id]', (rs) =>
    rs.map((r) => r.dataset.id),
  );
const clickSel = (page, sel) =>
  page
    .$eval(sel, (e) => e.click())
    .then(
      () => true,
      () => false,
    );
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

export default async function logic(ctx) {
  const { page, check } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:\\Projects\\tram-bom');

  // ---------- 1. Cây và bảng khối ----------
  check('cây có nút Logic', Boolean(await page.$('mat-tree [id="ti-logic"]')));
  await treeNode(page, 'logic');
  // Feature 015: khung nhìn mặc định là Sơ đồ; kịch bản này kiểm bảng của 011.
  await page.waitForSelector('mat-logic-editor [data-view="table"]');
  await page.$eval('mat-logic-editor [data-view="table"]', (b) => b.click());
  await page.waitForSelector('mat-logic-editor table.lg-grid');
  await expandNode(page, 'logic');
  await waitFor(page, () => document.querySelector('mat-tree [id="ti-logic:timer"]') !== null);
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll('mat-tree [id^="ti-logic:"]')].map((e) => e.id.slice(3)),
  );
  check(
    'bảy nhóm dưới Logic theo thứ tự',
    groups.join(',') ===
      'logic:rule,logic:timer,logic:counter,logic:totalizer,logic:runhours,logic:schedule,logic:writes',
    groups.join(','),
  );
  check('bảng Luật có hai luật', (await rows(page)).join(',') === 'pump_high_level,pump_low_level');

  // ---------- 1b. Task card "Khối / Tag" (T144, mockup cảnh 1) thay Toolbox widget ----------
  await page.evaluate(() => {
    const app = window.__matApp;
    if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
      app.setTaskCard('toolbox');
  });
  await page.waitForSelector('mat-taskcards .tc-logic [data-block="rule"]');
  const tc = await page.evaluate(() => ({
    title: document.querySelector('mat-taskcards .tc-panel .pane-h')?.textContent ?? '',
    blocks: document.querySelectorAll('mat-taskcards .tc-logic [data-block]').length,
    widgets: document.querySelectorAll('mat-taskcards [data-widget]').length,
    tags: document.querySelectorAll('mat-taskcards .tc-logic [data-tag]').length,
  }));
  check(
    'task card "Khối / Tag": 7 khối, có Tag, không có widget',
    /Khối \/ Tag/.test(tc.title) && tc.blocks === 7 && tc.tags > 5 && tc.widgets === 0,
    JSON.stringify(tc),
  );
  const nTimers = (await logicOf(page)).timers.length;
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('application/x-mat-logic-block', 'timer');
    const ed = document.querySelector('mat-logic-editor .lg-ed');
    ed.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
    ed.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await waitFor(page, () => window.__matApp.store.state.outline.logic.timers.length === 2);
  check(
    'thả khối Timer từ task card vào bảng: thêm một timer',
    (await logicOf(page)).timers.length === nTimers + 1,
  );
  await ctx.shot('khoi-tag');
  await axeScopedBoth(ctx, 'task card Khối / Tag', []);
  await page.evaluate(() => window.__matApp.store.undo());
  await waitFor(page, () => window.__matApp.store.state.outline.logic.timers.length === 1);
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="rule"]');
  await treeNode(page, 'logic:timer');
  await waitFor(
    page,
    () => document.querySelector('mat-logic-editor tr[data-id="t_start"]') !== null,
  );
  const tabs = await page.$$eval(
    'mat-tabs [role="tab"]',
    (ts) => ts.filter((t) => /Logic/.test(t.textContent)).length,
  );
  check('nhóm khác mở cùng một tab Logic', tabs === 1, String(tabs));
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="rule"]');
  await waitFor(
    page,
    () => document.querySelector('mat-logic-editor tr[data-id="pump_low_level"]') !== null,
  );

  // ---------- 2. Inspector ở khung dưới (trái), ≥ 360 px mỗi nhóm ----------
  await clickSel(page, 'mat-logic-editor tr[data-id="pump_low_level"]');
  await page.waitForSelector('mat-logic-dock .lg-dock-l .igrp');
  const layout = await page.evaluate(() => {
    const l = document.querySelector('mat-logic-dock .lg-dock-l')?.getBoundingClientRect();
    const r = document.querySelector('mat-logic-dock .lg-dock-r')?.getBoundingClientRect();
    const g = [...document.querySelectorAll('mat-logic-dock .igrp')].map((e) =>
      e.getBoundingClientRect(),
    );
    return {
      leftOfInfo: l && r ? l.right <= r.left + 1 : false,
      widths: g.map((x) => Math.round(x.width)),
      tops: g.map((x) => Math.round(x.top)),
    };
  });
  check('Inspector bên trái, Thông tin bên phải (T007 quyết định 3)', layout.leftOfInfo);
  check(
    'mỗi nhóm của Inspector rộng ≥ 360 px (hẹp thì xếp dọc)',
    layout.widths.length === 3 && layout.widths.every((w) => w >= 359),
    `${layout.widths.join(',')} / top ${layout.tops.join(',')}`,
  );
  // Cửa sổ hẹp: nhóm vẫn ≥ 360 px, xếp thành hàng dọc (điểm chỉnh của T007).
  await page.setViewport({ width: 1100, height: 860 });
  await sleep(300);
  const narrow = await page.$$eval('mat-logic-dock .igrp', (gs) =>
    gs.map((g) => ({
      w: Math.round(g.getBoundingClientRect().width),
      x: Math.round(g.getBoundingClientRect().left),
    })),
  );
  check(
    'cửa sổ hẹp: nhóm Inspector xếp dọc, mỗi nhóm vẫn ≥ 360 px',
    narrow.every((g) => g.w >= 359) && new Set(narrow.map((g) => g.x)).size === 1,
    JSON.stringify(narrow),
  );
  await page.setViewport({ width: 1400, height: 860 });
  await sleep(300);
  await setValue(page, 'mat-logic-dock [data-field="hold"]', '2000');
  check('sửa hold trong Inspector đổi logic.json', (await logicOf(page)).rules[1].hold === 2000);

  // ---------- 3. Kiểm khi gõ: Tag lạ trong when ----------
  await page.click('mat-logic-dock mat-expression-input[data-field="when"] textarea');
  await page.keyboard.press('End');
  await page.keyboard.type(' && TANK9.X');
  await waitFor(
    page,
    () => document.querySelector('mat-logic-dock .issue[data-code="E_LOGIC_TAG_REF"]') !== null,
  );
  check(
    'ô Khi của dòng có lỗi tô đỏ trên bảng',
    await page.$eval('mat-logic-editor tr[data-id="pump_low_level"] td[data-f="when"]', (td) =>
      td.classList.contains('cerr'),
    ),
  );
  await ctx.shot('editor-loi');
  await axeScopedBoth(ctx, 'editor Logic, Inspector, Thông tin có lỗi', []);
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="timer"]');
  await page.$eval('mat-logic-dock .issue[data-code="E_LOGIC_TAG_REF"]', (e) =>
    e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-logic-editor .lg-seg button[data-kind="rule"]')
        ?.getAttribute('aria-pressed') === 'true',
  );
  check(
    'nhấp đúp lỗi: về nhóm Luật, chọn đúng khối, focus ô biểu thức',
    await page.evaluate(
      () =>
        document
          .querySelector('mat-logic-editor tr[data-id="pump_low_level"]')
          ?.classList.contains('sel') &&
        document.activeElement?.closest('mat-expression-input')?.dataset.field === 'when',
    ),
  );
  // F8 ở bất kỳ đâu trong editor (focus trên bảng khối, không ở danh sách lỗi): về khối có lỗi.
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="timer"]');
  await page.click('mat-logic-editor tr[data-id="t_start"] td.rn');
  await page.keyboard.press('F8');
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-logic-editor .lg-seg button[data-kind="rule"]')
        ?.getAttribute('aria-pressed') === 'true' &&
      document
        .querySelector('mat-logic-editor tr[data-id="pump_low_level"]')
        ?.classList.contains('sel'),
  );
  check('F8 khi focus ở bảng khối: tới lỗi kế (nhóm Luật, khối pump_low_level)', true);
  await page.evaluate(() => {
    const app = window.__matApp;
    while (app.store.state.outline.logic.rules[1].when !== 'TANK01.LEVEL < 20 && LOGIC.DAY.Q')
      app.store.undo();
  });
  await waitFor(page, () => document.querySelector('mat-logic-dock .issue[data-code]') === null);
  check('hoàn tác hết lỗi', true);

  // ---------- 4. Thêm khối, đổi id cập nhật tham chiếu, Lịch ----------
  await clickSel(page, 'mat-logic-editor [data-act="add"]');
  await page.waitForSelector('mat-logic-editor [role="menu"] [data-add="writes"]');
  await clickSel(page, 'mat-logic-editor [role="menu"] [data-add="writes"]');
  await waitFor(
    page,
    () => document.querySelector('mat-logic-editor tr[data-id="w_1"].sel') !== null,
  );
  check(
    'thêm mục Ghi PLC: id gợi ý w_1, dòng mới được chọn',
    (await logicOf(page)).writes.length === 2,
  );
  await page.click('mat-logic-editor tr[data-id="w_1"] td.rn');
  await page.keyboard.press('Delete');
  await waitFor(page, () => window.__matApp.store.state.outline.logic.writes.length === 1);
  await clickSel(page, 'mat-logic-editor tr[data-id="w_pump_run"]');
  await setValue(page, 'mat-logic-dock [data-field="id"]', 'w_pump');
  const renamed = await logicOf(page);
  check(
    'đổi id mục writes: mọi hành động trỏ theo',
    renamed.writes[0].id === 'w_pump' && renamed.rules.every((r) => r.onRise[0].write === 'w_pump'),
  );
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="schedule"]');
  await page.waitForSelector('mat-logic-dock [data-day="0:6"]');
  await clickSel(page, 'mat-logic-dock [data-day="0:6"]');
  check(
    'Lịch: bỏ Thứ Bảy khỏi khung',
    (await logicOf(page)).schedules[0].weekly[0].days.join(',') === '1,2,3,4,5',
  );
  await clickSel(page, 'mat-logic-dock [data-day="0:6"]');

  // ---------- 5. Thử logic ----------
  await clickSel(page, 'mat-logic-editor [data-act="test"]');
  await page.waitForSelector('mat-logic-test [data-act="step"]');
  await clickSel(page, 'mat-logic-test [data-act="step"]');
  await waitFor(
    page,
    () => document.querySelector('mat-logic-test [data-role="scans"]')?.textContent.trim() === '1',
  );
  await clickSel(page, 'mat-logic-test [data-manual="TANK01.LEVEL"]');
  await setValue(page, 'mat-logic-test [data-value="TANK01.LEVEL"]', '85');
  await clickSel(page, 'mat-logic-test [data-speed="100"]');
  await clickSel(page, 'mat-logic-test [data-act="play"]');
  await sleep(1500);
  await clickSel(page, 'mat-logic-test [data-act="play"]');
  const sim = await page.evaluate(() => ({
    scans: Number(document.querySelector('mat-logic-test [data-role="scans"]')?.textContent),
    lanes: document.querySelectorAll('mat-logic-test svg.tlsvg [data-lane]').length,
    marks: document.querySelectorAll('mat-logic-test svg.tlsvg [data-mark="write"]').length,
    log: document.querySelector('mat-logic-test [data-role="log"]')?.textContent ?? '',
  }));
  check('×100: hơn 500 lần quét trong 1,5 s thật', sim.scans > 500, String(sim.scans));
  check('đường thời gian SVG có ≥ 6 làn', sim.lanes >= 6, String(sim.lanes));
  check(
    'mức 85 %: luật mức cao ghi false (mô phỏng), có dấu trên đường thời gian',
    /pump_high_level/.test(sim.log) && sim.marks >= 1,
    `${sim.marks} ${sim.log.slice(0, 120)}`,
  );
  const tl = await page.evaluate(() => {
    const wrap = document.querySelector('mat-logic-test .tlwrap');
    const svgEl = document.querySelector('mat-logic-test svg.tlsvg');
    const lane = document.querySelector(
      'mat-logic-test svg.tlsvg [data-lane="TANK01.LEVEL"] path.tl-a',
    );
    const sb = svgEl.getBoundingClientRect();
    const lb = lane?.getBoundingClientRect();
    return {
      wrapW: wrap.clientWidth,
      svgW: Math.round(sb.width),
      tlW: Math.round(sb.width),
      laneRight: lb ? Math.round(lb.right - sb.left) : 0,
      editorW: Math.round(document.querySelector('mat-logic-test').getBoundingClientRect().width),
    };
  });
  check(
    'đường thời gian rộng bằng vùng chứa (không tràn, không hẹp hơn)',
    Math.abs(tl.svgW - tl.wrapW) <= 4,
    JSON.stringify(tl),
  );
  check(
    'đường thời gian chiếm ≥ 55 % bề ngang panel Thử logic',
    tl.wrapW >= tl.editorW * 0.55,
    JSON.stringify(tl),
  );
  check(
    'tín hiệu trải tới gần mép phải (khoảng hiển thị theo thời gian đã chạy)',
    tl.laneRight >= tl.svgW * 0.8,
    JSON.stringify(tl),
  );
  await ctx.shot('thu-logic');
  await axeScopedBoth(ctx, 'Thử logic', []);
  await clickSel(page, 'mat-logic-dock [data-tab="info"]');

  // ---------- 6. Online runtime 1.0: chip, cột sống, Nạp xuống, Dừng ghi ----------
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Control');
  await sleep(300);
  await goOnline(page, 'admin');
  await page.evaluate(() => {
    const c = window.__matMock.device;
    c.setRuntime('BL335-01', '1.0.0');
    c.setLogic('BL335-01', {
      writes: 'on',
      blocks: [
        {
          id: 'pump_low_level',
          kind: 'rule',
          state: 'OK',
          lastFired: '2026-10-16T08:12:03+07:00',
          fired: 14,
          reason: null,
        },
        { id: 'pump_high_level', kind: 'rule', state: 'THROTTLED', fired: 15, reason: null },
      ],
    });
  });
  await waitFor(
    page,
    () =>
      /Ghi PLC: bật/.test(document.querySelector('mat-logic-chip button.chip')?.textContent ?? ''),
    undefined,
    12000,
  );
  check(
    'chip Ghi PLC: bật (xanh lá, có biểu tượng)',
    await page.$eval(
      'mat-logic-chip button.chip',
      (b) => b.classList.contains('ok') && b.querySelector('svg') !== null,
    ),
  );
  await clickSel(page, 'mat-logic-editor .lg-seg button[data-kind="rule"]');
  await waitFor(
    page,
    () =>
      document.querySelector('mat-logic-editor tr[data-id="pump_high_level"] td.live-col .chip') !==
      null,
    undefined,
    8000,
  );
  check(
    'cột trạng thái sống: THROTTLED màu thông tin kèm chữ',
    await page.$eval(
      'mat-logic-editor tr[data-id="pump_high_level"] td.live-col .chip',
      (c) => c.classList.contains('st-THROTTLED') && /THROTTLED/.test(c.textContent),
    ),
  );
  await ctx.shot('online');

  // Nạp xuống: dòng ghi tự động, bắt tích xác nhận.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyL');
  await page.keyboard.up('Control');
  await page.waitForSelector('mat-download-dialog tr[data-row="logic"]', { timeout: 15000 });
  const dl = await page.evaluate(() => ({
    title: document
      .querySelector('mat-download-dialog tr[data-row="logic"]')
      ?.textContent.replace(/\s+/g, ' '),
    tags: [
      ...document.querySelectorAll(
        'mat-download-dialog table[data-role="logic-writes"] tbody td:first-child',
      ),
    ].map((x) => x.textContent.trim()),
    disabled: document.querySelector('mat-download-dialog [data-role="deploy"]')?.disabled,
  }));
  check(
    'Nạp xuống: "Logic sẽ tự động ghi 1 Tag xuống PLC"',
    /Logic sẽ tự động ghi 1 Tag xuống PLC/.test(dl.title ?? ''),
    dl.title,
  );
  check(
    'Nạp xuống: bảng liệt kê PUMP01.RUN_CMD',
    dl.tags.join(',') === 'PUMP01.RUN_CMD',
    dl.tags.join(','),
  );
  check('Nạp xuống khóa tới khi tích "Tôi đã xem danh sách"', dl.disabled === true);
  await ctx.shot('nap-xuong');
  await axeScopedBoth(ctx, 'Nạp xuống có ghi tự động', []);
  await clickSel(page, 'mat-download-dialog [data-role="logic-ack"]');
  await clickSel(page, 'mat-download-dialog [data-role="ack"]');
  await sleep(100);
  check(
    'tích xác nhận thì Nạp xuống mở khóa',
    await page.$eval('mat-download-dialog [data-role="deploy"]', (b) => !b.disabled),
  );
  await clickSel(page, 'mat-download-dialog [data-role="cancel"]');
  await waitFor(page, () => !document.querySelector('mat-download-dialog [role="dialog"]'));

  // Dừng ghi của logic (administrator, không nhập lại mật khẩu).
  await clickSel(page, 'mat-logic-chip button.chip');
  await page.waitForSelector('mat-logic-chip [role="menu"]');
  check(
    '"Bật ghi PLC" khóa kèm LOGIC_ENABLE_ROOT_ONLY',
    await page.$eval(
      'mat-logic-chip [role="menu"]',
      (m) =>
        m.querySelector('[data-act="enable"]').getAttribute('aria-disabled') === 'true' &&
        /LOGIC_ENABLE_ROOT_ONLY/.test(m.textContent),
    ),
  );
  await axeScopedBoth(ctx, 'menu chip Ghi PLC', []);
  await clickSel(page, 'mat-logic-chip [data-act="stop"]');
  await page.waitForSelector('mat-logic-stop-dialog [role="dialog"]');
  check(
    'hộp Dừng ghi không có ô mật khẩu',
    !(await page.$('mat-logic-stop-dialog input[type="password"]')),
  );
  check(
    'nút Dừng ghi khóa tới khi tích xác nhận',
    await page.$eval('mat-logic-stop-dialog [data-act="stop-go"]', (b) => b.disabled),
  );
  await ctx.shot('dung-ghi');
  await axeScopedBoth(ctx, 'hộp Dừng ghi của logic', []);
  await clickSel(page, 'mat-logic-stop-dialog [data-role="stop-ack"]');
  await sleep(50);
  await clickSel(page, 'mat-logic-stop-dialog [data-act="stop-go"]');
  await waitFor(
    page,
    () =>
      /Ghi PLC: dừng/.test(document.querySelector('mat-logic-chip button.chip')?.textContent ?? ''),
    undefined,
    10000,
  );
  check(
    'sau khi dừng: chip "Ghi PLC: dừng" màu đỏ',
    await page.$eval('mat-logic-chip button.chip', (b) => b.classList.contains('err')),
  );
  check(
    'thiết bị nhận đúng một lệnh dừng {"enabled": false}',
    await page.evaluate(
      () => window.__matMock.device.calls.filter((c) => c.cmd === 'logic_writes_stop').length === 1,
    ),
  );

  // Theme tối: ảnh chụp để đối chiếu mockup.
  await setTheme(page, 'dark');
  await ctx.shot('online-toi');
  await setTheme(page, 'light');
}
