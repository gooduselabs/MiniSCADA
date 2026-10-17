// Sinh project đo của feature 011 (T072; FR-038, FR-039; contracts/test-protocols.md §1, §2), định dạng 0.6.0:
//   node tools/gen-bench-projects.mjs [--out <thư mục>] [--only bench-1000|soak-standard]
//   bench-1000     1.000 Tag mô phỏng SIM.T0001..SIM.T1000 (L2: `load-tester -tags 1000`), màn hình 250 item (L4).
//   soak-standard  500 Tag SIM.T0001..SIM.T0500 (450 mô phỏng, 50 tính toán; L1, S1: `load-tester -tags 500`), lưu trữ
//                  200 Tag theo thay đổi (một nhóm onChange), 3 màn hình (250 item, bảng Tag, xu hướng).
// Mặc định ghi vào <repo>/out/bench-projects/. Dữ liệu sinh lớn KHÔNG commit: `projects/bench-1000/`,
// `projects/soak-standard/` và `out/bench-projects/` đã có trong .gitignore (dùng `--out projects` khi cần đúng chỗ của
// tasks.md). Mỗi lần chạy xóa rồi viết lại đúng thư mục của project (không đụng phần khác của --out). Tất định: chạy lại
// cho cùng từng byte. Mã thoát: 0 xong, 2 dùng sai.
//   logic-demo     (T141, định dạng 1.0) luật bơm tự bật ghi PLC qua giả lập Modbus (127.0.0.1:5020), counter khởi
//                  động, totalizer lưu lượng, giờ chạy, lịch ngày và reset nửa đêm.
//   logic-load     (T141, T147, định dạng 1.0) cấu hình logic tối đa của FR-095: 200 luật, 100 timer, 100 counter,
//                  50 totalizer, 50 giờ chạy, 50 lịch trên 100 Tag mô phỏng; không ghi PLC (setTag vào Tag nội bộ).
//   logic-l1       (T148) đúng logic.json của logic-load trên 500 Tag mô phỏng SIM.T0001..T0500 (như L1): đầu vào của
//                  `logic_bench` (server/bench/logic_bench.cpp).
//   Ba project 1.0 cần runtime ≥ 1.0.0 (minRuntimeVersion).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V = '0.6.0';
const NAMES = ['bench-1000', 'soak-standard', 'logic-demo', 'logic-load', 'logic-l1'];

function usage(msg) {
  console.error(msg);
  console.error(
    'Dùng: node tools/gen-bench-projects.mjs [--out <thư mục>] [--only bench-1000|soak-standard|logic-demo|logic-load|logic-l1]',
  );
  process.exit(2);
}

let outDir = join(root, 'out/bench-projects');
let only = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out' || a === '--only') {
    const v = args[++i];
    if (!v || v.startsWith('--')) usage(`thiếu giá trị của ${a}`);
    if (a === '--out') outDir = resolve(v);
    else if (!NAMES.includes(v)) usage(`--only: ${NAMES.join(' hoặc ')}`);
    else only = v;
  } else usage(`đối số không biết: ${a}`);
}

const tagId = (k) => `SIM.T${String(k).padStart(4, '0')}`;

/** Tag mô phỏng thứ k (1..): mỗi Tag thứ 20 là INT32 vuông, còn lại FLOAT64 sin; chu kỳ khác nhau để giá trị đổi lệch nhau. */
function simTag(k) {
  if (k % 20 === 0)
    return {
      id: tagId(k),
      kind: 'simulation',
      type: 'INT32',
      sim: { kind: 'square', periodMs: 20000 + 1000 * (k % 40), duty: 0.5 },
    };
  return {
    id: tagId(k),
    kind: 'simulation',
    type: 'FLOAT64',
    unit: 'u',
    min: 0,
    max: 200,
    sim: { kind: 'sine', center: 100, amplitude: 40, periodMs: 60000 + 1700 * (k % 100) },
  };
}

/** Tag tính toán thứ k: từ hai Tag mô phỏng đầu (Tag tính toán của L1). */
function calcTag(k, nSim) {
  const a = tagId(((k * 7) % nSim) + 1);
  const b = tagId(((k * 13) % nSim) + 1);
  return {
    id: tagId(k),
    kind: 'calculated',
    type: 'FLOAT64',
    unit: 'u',
    expression: `${a} * 0.5 + ${b} * 0.25`,
  };
}

const item = (id, widget, x, y, width, height, props, tags) => ({
  id,
  name: id,
  type: 'widget',
  widget,
  x,
  y,
  width,
  height,
  ...(props ? { props } : {}),
  ...(tags ? { tags } : {}),
});

/** Màn hình 250 item (L4; cùng bố cục với tests/web-it/make-projects.mjs `lon`) trên 200 Tag đầu. */
function screen250(id, name) {
  const items = [];
  for (let k = 0; k < 250; k++) {
    const x = 20 + (k % 25) * 150;
    const y = 20 + Math.floor(k / 25) * 200;
    const t = tagId((k % 200) + 1);
    const kind = k % 5;
    if (kind === 0)
      items.push(item(`i${k}`, 'card', x, y, 140, 90, { label: `V${k}` }, { value: t }));
    else if (kind === 1) items.push(item(`i${k}`, 'label', x, y, 140, 40, { text: `Nhãn ${k}` }));
    else if (kind === 2)
      items.push(item(`i${k}`, 'lamp', x, y, 60, 60, { label: `L${k}` }, { state: t }));
    else if (kind === 3)
      items.push(
        item(`i${k}`, 'gauge', x, y, 140, 140, { label: `G${k}`, min: 0, max: 200 }, { value: t }),
      );
    else
      items.push(
        item(`i${k}`, 'level', x, y, 60, 180, { label: `M${k}`, min: 0, max: 200 }, { value: t }),
      );
  }
  return { schemaVersion: V, id, name, size: { width: 3840, height: 2160 }, items };
}

/** 10 bảng Tag × 25 dòng: 250 Tag (từ SIM.T0201), kèm card đầu mỗi bảng. */
function tableScreen() {
  const items = [];
  for (let k = 0; k < 10; k++) {
    const rows = [];
    for (let r = 0; r < 25; r++) rows.push(tagId(201 + k * 25 + r));
    items.push(
      item(
        `tbl_${k + 1}`,
        'tag-table',
        20 + (k % 5) * 380,
        20 + Math.floor(k / 5) * 520,
        360,
        500,
        { columns: ['label', 'value', 'unit', 'quality'], dense: true },
        { rows },
      ),
    );
  }
  return {
    schemaVersion: V,
    id: 'bang-tag',
    name: 'Bảng Tag',
    size: { width: 1920, height: 1080 },
    items,
  };
}

/** 4 biểu đồ đường × 8 đường trên Tag được lưu trữ. */
function trendScreen() {
  const items = [];
  for (let k = 0; k < 4; k++) {
    const series = [];
    for (let s = 0; s < 8; s++) series.push(tagId(1 + k * 8 + s));
    items.push(
      item(
        `line_${k + 1}`,
        'line',
        20 + (k % 2) * 940,
        20 + Math.floor(k / 2) * 520,
        920,
        500,
        { windowSec: 600, sampleMs: 1000 },
        { series },
      ),
    );
  }
  return {
    schemaVersion: V,
    id: 'xu-huong',
    name: 'Xu hướng',
    size: { width: 1920, height: 1080 },
    items,
  };
}

function project(id, name, screens) {
  return {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: id,
    projectName: name,
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.9.0',
    entryScreen: screens[0].id,
    screens: screens.map((s) => s.id),
    tagFile: 'tags.json',
    navigation: {
      position: 'left',
      items: screens.map((s, k) => ({
        label: s.name,
        screen: s.id,
        icon: k === 0 ? 'home' : 'chart',
      })),
    },
    maxClients: 10,
  };
}

function bench1000() {
  const tags = [];
  for (let k = 1; k <= 1000; k++) tags.push(simTag(k));
  const screens = [screen250('tong-quan', 'Tổng quan 250 item')];
  return { proj: project('bench-1000', 'Đo tải 1.000 Tag', screens), tags, screens };
}

function soakStandard() {
  const nSim = 450;
  const tags = [];
  for (let k = 1; k <= nSim; k++) tags.push(simTag(k));
  for (let k = nSim + 1; k <= 500; k++) tags.push(calcTag(k, nSim));
  const screens = [screen250('tong-quan', 'Tổng quan 250 item'), tableScreen(), trendScreen()];
  const proj = project('soak-standard', 'Soak chuẩn 500 Tag', screens);
  proj.loggingFile = 'logging.json';
  const logging = {
    schemaVersion: V,
    timeZone: '+07:00',
    groups: [
      {
        id: 'soak',
        name: 'Soak: 200 Tag theo thay đổi',
        mode: 'onChange',
        minIntervalMs: 1000,
        maxIntervalMs: 60000,
        // 7 ngày cho kỳ soak S1 7 ngày: ước tính lưu trữ (giới hạn trên 1 dòng/s) dưới ngân sách 2 GB, không W_LOG_SIZE_CAP.
        retentionDays: 7,
        aggregates: { minuteRetentionDays: 7, hourRetentionDays: 30 },
        tags: Array.from({ length: 200 }, (_, k) => ({ tagId: tagId(k + 1), deadband: 0.5 })),
      },
    ],
  };
  return { proj, tags, screens, logging };
}

// ---- logic v2 (T141): project 1.0 ----
const V10 = '1.0.0';
function project10(id, name, screens) {
  const p = project(id, name, screens);
  return { ...p, schemaVersion: V10, minRuntimeVersion: '1.0.0', logic: 'logic.json' };
}
const at10 = (s) => ({ ...s, schemaVersion: V10 });

function logicDemo() {
  const tags = [
    {
      id: 'TANK01.LEVEL',
      kind: 'simulation',
      type: 'FLOAT64',
      unit: '%',
      min: 0,
      max: 100,
      sim: { kind: 'sine', center: 50, amplitude: 45, periodMs: 120000 },
    },
    {
      id: 'FLOW01',
      kind: 'simulation',
      type: 'FLOAT64',
      unit: 'm3/h',
      sim: { kind: 'sine', center: 30, amplitude: 10, periodMs: 60000 },
    },
    {
      id: 'PUMP01.RUN_CMD',
      kind: 'external',
      type: 'BOOL',
      access: 'RW',
      source: { device: 'plc1', address: 'C10' },
    },
    {
      id: 'PUMP01.RUN',
      kind: 'external',
      type: 'BOOL',
      source: { device: 'plc1', address: 'DI10' },
    },
  ];
  const connections = {
    schemaVersion: V10,
    scanGroups: { fast: 250, normal: 1000, slow: 5000 },
    channels: [
      {
        id: 'plc1',
        name: 'Giả lập Modbus',
        kind: 'modbus-tcp',
        tcp: { host: '127.0.0.1', port: 5020 },
        devices: [{ id: 'plc1', name: 'Giả lập Modbus', unitId: 1 }],
      },
    ],
  };
  const logic = {
    schemaVersion: V10,
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
        id: 'pump_low_level',
        name: 'Bơm tự bật khi mức thấp',
        when: 'TANK01.LEVEL < 20',
        hold: 10000,
        onRise: [{ do: 'write', write: 'w_pump_run', value: true }],
      },
      {
        id: 'pump_high_level',
        name: 'Bơm tự tắt khi mức cao',
        when: 'TANK01.LEVEL > 80',
        hold: 5000,
        onRise: [{ do: 'write', write: 'w_pump_run', value: false }],
      },
    ],
    timers: [
      {
        id: 't_start',
        kind: 'ton',
        in: 'PUMP01.RUN',
        pt: 5000,
        q: 'LOGIC.T_START.Q',
        et: 'LOGIC.T_START.ET',
      },
    ],
    counters: [
      {
        id: 'c_starts',
        up: 'PUMP01.RUN',
        reset: 'LOGIC.RESET_DAILY.Q',
        preset: 1000,
        value: 'LOGIC.C_STARTS.VALUE',
        reached: 'LOGIC.C_STARTS.REACHED',
      },
    ],
    totalizers: [
      {
        id: 'z_flow',
        source: 'FLOW01',
        rateUnit: 'h',
        cutoff: 0.05,
        maxGapMs: 5000,
        reset: 'LOGIC.RESET_DAILY.Q',
        total: 'LOGIC.FLOW01.TOTAL',
        gapSeconds: 'LOGIC.FLOW01.GAP_S',
      },
    ],
    runhours: [
      {
        id: 'h_pump',
        run: 'PUMP01.RUN',
        serviceEveryHours: 500,
        hours: 'LOGIC.PUMP01.HOURS',
        starts: 'LOGIC.PUMP01.STARTS',
        due: 'LOGIC.PUMP01.DUE',
      },
    ],
    schedules: [
      {
        id: 's_day',
        weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
        out: 'LOGIC.DAY.Q',
      },
      {
        id: 's_midnight',
        weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '00:01' }],
        out: 'LOGIC.RESET_DAILY.Q',
      },
    ],
  };
  const screen = at10({
    id: 'tong-quan',
    name: 'Logic mẫu',
    size: { width: 1280, height: 720 },
    items: [
      item(
        'muc',
        'gauge',
        20,
        20,
        200,
        200,
        { label: 'Mức', min: 0, max: 100 },
        { value: 'TANK01.LEVEL' },
      ),
      item('bom', 'lamp', 240, 20, 80, 80, { label: 'Bơm' }, { state: 'PUMP01.RUN' }),
      item(
        'dem',
        'card',
        340,
        20,
        200,
        90,
        { label: 'Số lần khởi động' },
        { value: 'LOGIC.C_STARTS.VALUE' },
      ),
      item(
        'tong',
        'card',
        560,
        20,
        200,
        90,
        { label: 'Lưu lượng cộng dồn' },
        { value: 'LOGIC.FLOW01.TOTAL' },
      ),
      item('gio', 'card', 780, 20, 200, 90, { label: 'Giờ chạy' }, { value: 'LOGIC.PUMP01.HOURS' }),
    ],
  });
  const proj = {
    ...project10('logic-demo', 'Logic mẫu', [screen]),
    connectionFile: 'connections.json',
  };
  return { proj, tags, screens: [screen], logic, connections, version: V10 };
}

function logicLoad(simCount = 100, id = 'logic-load', title = 'Tải logic tối đa') {
  const n = 100;
  const tags = [];
  for (let k = 1; k <= simCount; k++) tags.push(simTag(k));
  for (let k = 1; k <= 200; k++)
    tags.push({
      id: `INT.R${String(k).padStart(3, '0')}`,
      kind: 'internal',
      type: 'BOOL',
      initial: false,
    });
  const sim = (k) => tagId(((k - 1) % n) + 1);
  const isNum = (k) => (((k - 1) % n) + 1) % 20 !== 0;
  const pad = (k) => String(k).padStart(3, '0');
  const rules = [];
  for (let k = 1; k <= 200; k++)
    rules.push({
      id: `r${pad(k)}`,
      when: isNum(k) ? `${sim(k)} > 100` : `${sim(k)} > 0`,
      hold: 1000,
      onRise: [{ do: 'setTag', tag: `INT.R${pad(k)}`, value: true }],
      onFall: [{ do: 'setTag', tag: `INT.R${pad(k)}`, value: false }],
    });
  const timers = [];
  for (let k = 1; k <= 100; k++)
    timers.push({
      id: `t${pad(k)}`,
      kind: ['ton', 'tof', 'tp'][k % 3],
      in: `INT.R${pad(k)}`,
      pt: 2000,
      q: `LOGIC.T${pad(k)}.Q`,
      et: `LOGIC.T${pad(k)}.ET`,
    });
  const counters = [];
  for (let k = 1; k <= 100; k++)
    counters.push({
      id: `c${pad(k)}`,
      up: `INT.R${pad(k + 100)}`,
      preset: 100,
      value: `LOGIC.C${pad(k)}.VALUE`,
      reached: `LOGIC.C${pad(k)}.REACHED`,
    });
  const totalizers = [];
  for (let k = 1; k <= 50; k++) {
    const src = isNum(k) ? sim(k) : sim(k + 1);
    totalizers.push({
      id: `z${pad(k)}`,
      source: src,
      rateUnit: 'h',
      total: `LOGIC.Z${pad(k)}.TOTAL`,
      gapSeconds: `LOGIC.Z${pad(k)}.GAP`,
    });
  }
  const runhours = [];
  for (let k = 1; k <= 50; k++)
    runhours.push({
      id: `h${pad(k)}`,
      run: `INT.R${pad(k + 50)}`,
      hours: `LOGIC.H${pad(k)}.HOURS`,
      starts: `LOGIC.H${pad(k)}.STARTS`,
    });
  const schedules = [];
  for (let k = 1; k <= 50; k++)
    schedules.push({
      id: `s${pad(k)}`,
      weekly: [
        { days: [1, 2, 3, 4, 5], from: '06:00', to: `${String(7 + (k % 12)).padStart(2, '0')}:30` },
      ],
      exceptions: [{ date: '2026-12-25', mode: 'off' }],
      out: `LOGIC.S${pad(k)}.Q`,
    });
  const logic = { schemaVersion: V10, rules, timers, counters, totalizers, runhours, schedules };
  const screen = at10({
    id: 'tong-quan',
    name: 'Tải logic',
    size: { width: 1280, height: 720 },
    items: [
      item('c1', 'card', 20, 20, 200, 90, { label: 'Counter 1' }, { value: 'LOGIC.C001.VALUE' }),
    ],
  });
  return {
    proj: project10(id, title, [screen]),
    tags,
    screens: [screen],
    logic,
    version: V10,
  };
}

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const built = {
  'bench-1000': bench1000,
  'soak-standard': soakStandard,
  'logic-demo': logicDemo,
  'logic-load': () => logicLoad(),
  'logic-l1': () => logicLoad(500, 'logic-l1', 'Tải logic tối đa trên 500 Tag'),
};
const summary = [];
for (const name of only ? [only] : NAMES) {
  const { proj, tags, screens, logging, logic, connections, version } = built[name]();
  const dir = join(outDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'screens'), { recursive: true });
  writeFileSync(join(dir, 'project.json'), json(proj));
  writeFileSync(join(dir, 'tags.json'), json({ schemaVersion: version ?? V, tags }));
  if (logging) writeFileSync(join(dir, 'logging.json'), json(logging));
  if (logic) writeFileSync(join(dir, 'logic.json'), json(logic));
  if (connections) writeFileSync(join(dir, 'connections.json'), json(connections));
  for (const s of screens) writeFileSync(join(dir, 'screens', `${s.id}.screen.json`), json(s));
  summary.push({
    name,
    dir,
    tags: tags.length,
    logged: logging ? logging.groups.reduce((n, g) => n + g.tags.length, 0) : 0,
    screens: screens.length,
    logic: logic
      ? ['rules', 'timers', 'counters', 'totalizers', 'runhours', 'schedules'].reduce(
          (n, k) => n + (logic[k] ?? []).length,
          0,
        )
      : 0,
  });
}
console.log(JSON.stringify(summary));
