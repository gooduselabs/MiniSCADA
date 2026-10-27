// Sinh project mẫu `projects/svg-demo` (0.4.0; feature 008, T093; quickstart của 008):
//   node tools/svg-demo/generate.mjs [--out <thư mục>]
//   node tools/svg-demo/generate.mjs --standard --out <thư mục>     (màn hình chuẩn 3b cho T108, không commit)
// Mặc định: hai màn hình (Bồn nước, Tổng quan) và popup Bơm 1; đồ họa nhập từ fixture Inkscape thật bằng `importSvg`
// (UID sinh từ hạt giống cố định), ký hiệu bơm/van/bồn/motor/ống/quạt của tools/symbol-data; đủ 13 loại động hóa, 5 sự kiện.
// Tag, kết nối và bảng giá trị chép từ bản 0.3 đóng băng của `projects/dashboard-demo`
// (`tests/fixtures/dashboard-demo-0.3`; project mẫu đã lên 1.0 ở feature 011) (đổi sang 0.4.0). `--standard`: một màn hình ≈ 3.000 phần tử,
// 30 binding, 10 hoạt ảnh, 5 sự kiện và 103 Tag. Đầu ra tất định: chạy lại cho cùng từng byte (test: generate.test.mjs).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { formatProject03, formatScreen03, formatTagsFile } from '@mat/project-schema';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { importSvg, makeSeededUid } = await import('../../packages/svg-import/src/index.ts');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const V = '0.4.0';
const LIB = join(root, 'tools/symbol-data');

const args = process.argv.slice(2);
const standard = args.includes('--standard');
const outFlag = args.indexOf('--out');
const outArg = outFlag >= 0 ? args[outFlag + 1] : undefined;
if ((outFlag >= 0 && !outArg) || (standard && !outArg)) {
  console.error(
    'Dùng: node tools/svg-demo/generate.mjs [--standard] [--out <thư mục>] (--standard cần --out)',
  );
  process.exit(2);
}
const outDir = resolve(outArg ?? join(root, 'projects/svg-demo'));

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const to04 = (text) => text.replace(/("schemaVersion"\s*:\s*")0\.3\.\d+(")/, `$1${V}$2`);
// Bản 0.3 đóng băng của dashboard-demo (trước T175, feature 011): giữ đầu ra svg-demo không đổi khi dashboard-demo lên 1.0.
const DEMO03 = join(root, 'tests/fixtures/dashboard-demo-0.3');
const demo = (rel) => stripBom(readFileSync(join(DEMO03, rel), 'utf8'));

// ---------------- Thư viện ký hiệu ----------------
const manifest = JSON.parse(readFileSync(join(LIB, 'manifest.json'), 'utf8'));
const symbolDef = (id) => manifest.symbols.find((s) => s.id === id);
const files = {};

/** Item `svg` của ký hiệu `id` (tệp chính hoặc biến thể `variant`) tại (x, y), kích thước mặc định nhân `k`. */
function symbolItem(screenId, id, itemId, x, y, k = 1, variant) {
  const s = symbolDef(id);
  const file = variant ? s.variants.find((v) => v.id === variant).file : s.file;
  const base = file.replace(/^.*\//, '');
  files[`graphics/symbols/${base}`] = readFileSync(join(LIB, file), 'utf8');
  const bindingFile = `screens/${screenId}.${itemId}.bindings.json`;
  return {
    item: {
      id: itemId,
      name: s.name,
      type: 'svg',
      x,
      y,
      width: Math.round(s.defaultSize[0] * k),
      height: Math.round(s.defaultSize[1] * k),
      svgFile: `graphics/symbols/${base}`,
      bindingFile,
      viewBox: s.viewBox,
      fit: 'contain',
      elements: s.parts.map((p) => ({ elementUid: p.uid, name: p.label })),
    },
    bindingFile,
    uid: (role) => s.parts.find((p) => p.role === role).uid,
  };
}

// ---------------- Binding: bộ dựng gọn cho 13 loại động hóa ----------------
let seq = 0;
const bid = (prefix) => `${prefix}_${++seq}`;
const src = (tagId) => ({ type: 'tag', tagId });
const B = {
  text: (tag, format, transform = { kind: 'direct' }) => ({
    id: bid('text'),
    target: 'text.content',
    source: src(tag),
    transform,
    format,
  }),
  fill: (tag, on, off) => ({
    id: bid('fill'),
    target: 'style.fill',
    source: src(tag),
    transform: {
      kind: 'discreteMap',
      cases: [
        { equals: true, value: on },
        { equals: false, value: off },
      ],
    },
  }),
  fillRange: (tag, ranges, dflt) => ({
    id: bid('fill'),
    target: 'style.fill',
    source: src(tag),
    transform: { kind: 'rangeMap', ranges, default: dflt },
  }),
  stroke: (tag, on, off) => ({
    id: bid('stroke'),
    target: 'style.stroke',
    source: src(tag),
    transform: {
      kind: 'discreteMap',
      cases: [
        { equals: true, value: on },
        { equals: false, value: off },
      ],
    },
  }),
  level: (tag, direction = 'up') => ({
    id: bid('level'),
    target: 'geometry.levelPercent',
    source: src(tag),
    transform: { kind: 'direct' },
    direction,
  }),
  clip: (tag, inMax = 100, direction = 'up') => ({
    id: bid('level'),
    target: 'geometry.clipLevel',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin: 0, outMax: 100, clamp: true },
    direction,
  }),
  rotate: (tag, inMax, outMax) => ({
    id: bid('rotate'),
    target: 'transform.rotate',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin: 0, outMax, clamp: true },
  }),
  spin: (tag, reverse = false) => ({
    id: bid('spin'),
    target: 'transform.rotate',
    source: src(tag),
    transform: { kind: 'direct' },
    animation: 'spin',
    ...(reverse ? { reverse: true } : {}),
  }),
  translateX: (tag, inMax, outMax) => ({
    id: bid('tx'),
    target: 'transform.translateX',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin: 0, outMax, clamp: true },
  }),
  translateY: (tag, inMax, outMax) => ({
    id: bid('ty'),
    target: 'transform.translateY',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin: 0, outMax, clamp: true },
  }),
  scale: (tag, inMax, outMax) => ({
    id: bid('scale'),
    target: 'transform.scale',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin: 1, outMax, clamp: true },
  }),
  blink: (tag, color = '#ef4444', mode = 'opacity') => ({
    id: bid('blink'),
    target: 'effect.blink',
    source: src(tag),
    transform: { kind: 'direct' },
    period: 800,
    mode,
    ...(mode === 'opacity' ? {} : { color }),
  }),
  flow: (tag, speed = 40) => ({
    id: bid('flow'),
    target: 'effect.flow',
    source: src(tag),
    transform: { kind: 'direct' },
    dash: '6 6',
    speed,
  }),
  visibility: (tag) => ({
    id: bid('vis'),
    target: 'style.visibility',
    source: src(tag),
    transform: { kind: 'direct' },
  }),
  opacity: (tag, inMax, outMin = 0.35) => ({
    id: bid('opa'),
    target: 'style.opacity',
    source: src(tag),
    transform: { kind: 'linearScale', inMin: 0, inMax, outMin, outMax: 1, clamp: true },
  }),
};
const ev = {
  toggle: (tag, label) => ({ action: 'toggle', tag, confirm: 'always', label }),
  write: (tag, value, label) => ({ action: 'write', tag, value, confirm: 'always', label }),
  pulse: (tag, label) => ({
    action: 'pulse',
    tag,
    value: true,
    durationMs: 500,
    confirm: 'always',
    label,
  }),
  navigate: (screen, label) => ({ action: 'navigate', screen, label }),
  popup: (screen, label) => ({ action: 'popup', screen, label }),
  closePopup: (label) => ({ action: 'closePopup', label }),
};

/** Bộ binding của một item: `entries` = [[uid, bindings[], click?]]. */
function bindingSet(screenId, itemId, entries) {
  return {
    schemaVersion: V,
    screenId,
    itemId,
    elements: entries.map(([elementUid, bindings, click]) => ({
      elementUid,
      ...(bindings.length ? { bindings } : {}),
      ...(click ? { events: { click } } : {}),
    })),
  };
}

const screens = [];
const bindingFiles = {};
const addItem = (list, built, entries, screenId) => {
  list.push(built.item);
  bindingFiles[built.bindingFile] = json(bindingSet(screenId, built.item.id, entries));
};

// ---------------- Tag, kết nối, bảng giá trị ----------------
const baseTags = JSON.parse(demo('tags.json')).tags;
const stdTags = [];
if (standard) {
  for (let i = 1; i <= 50; i++)
    stdTags.push({
      id: `STD.T${String(i).padStart(2, '0')}`,
      kind: 'simulation',
      type: i % 2 === 0 ? 'BOOL' : 'FLOAT32',
      description: `Tag mô phỏng chuẩn ${i}`,
      ...(i % 2 === 0
        ? { sim: { kind: 'square', periodMs: 2000 + 500 * (i % 7) } }
        : {
            min: 0,
            max: 100,
            sim: { kind: 'sine', center: 50, amplitude: 40, periodMs: 10000 + 1000 * (i % 9) },
          }),
    });
}
const tagsText = formatTagsFile({ schemaVersion: V, tags: [...baseTags, ...stdTags] });

// ---------------- Đồ họa nhập từ fixture ----------------
function importFixture(rel, seed) {
  const r = importSvg(readFileSync(join(root, rel)), {
    fileName: rel.replace(/^.*\//, ''),
    uid: makeSeededUid(seed),
  });
  if (!r.ok) throw new Error(`importSvg ${rel}: ${r.error?.code}`);
  const byName = (name) => r.elements.find((e) => e.name === name).uid;
  return { r, byName };
}

function buildStandard() {
  // Một SVG ≈ 3.000 phần tử: 30 nhóm × 99 hình, thêm 5 chữ, nhập qua importSvg.
  let body = '';
  const groups = 30;
  const per = 99;
  let k = 0;
  for (let g = 0; g < groups; g++) {
    body += `<g data-name="Cụm ${g + 1}">`;
    for (let i = 0; i < per; i++, k++)
      body += `<rect ${i === 0 ? `data-name="Ô ${g + 1}" ` : ''}x="${(k % 100) * 18}" y="${Math.floor(k / 100) * 18}" width="16" height="16" fill="#4cc9db"/>`;
    body += '</g>';
  }
  for (let i = 0; i < 5; i++)
    body += `<text data-name="Số ${i + 1}" x="${40 + i * 300}" y="580" fill="#e5e7eb" font-size="26">0</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 600">${body}</svg>`;
  const r = importSvg(Buffer.from(svg), {
    fileName: 'chuan-3b.svg',
    uid: makeSeededUid('svg-demo-standard'),
  });
  if (!r.ok) throw new Error(`importSvg chuẩn: ${r.error?.code}`);
  const uid = (n) => r.elements.find((e) => e.name === n).uid;
  const nBool = (i) => `STD.T${String(2 * ((i % 25) + 1)).padStart(2, '0')}`;
  const nNum = (i) => `STD.T${String(2 * (i % 25) + 1).padStart(2, '0')}`;
  const entries = [];
  const add = (name, bindings, click) => entries.push([uid(name), bindings, click]);
  for (let i = 0; i < 7; i++) add(`Ô ${i + 1}`, [B.fill(nBool(i), '#22c55e', '#64748b')]);
  for (let i = 0; i < 5; i++) add(`Ô ${8 + i}`, [B.opacity(nNum(i), 100)]);
  for (let i = 0; i < 4; i++) add(`Ô ${13 + i}`, [B.spin(nBool(i + 3))]);
  for (let i = 0; i < 3; i++)
    add(`Ô ${17 + i}`, [B.blink(nBool(i + 9)), B.fill(nBool(i + 9), '#f59e0b', '#64748b')]);
  for (let i = 0; i < 3; i++) add(`Ô ${20 + i}`, [B.flow(nBool(i + 12))]);
  for (let i = 0; i < 5; i++) add(`Số ${i + 1}`, [B.text(nNum(i + 5), { decimals: 1 })]);
  const clicks = [
    ev.toggle('SIM.FAN_ON', 'Bật quạt'),
    ev.write('SIM.SP_FLOW', 50, 'Đặt lưu lượng 50'),
    ev.pulse('R.PULSE', 'Xung R.PULSE'),
    ev.toggle('PUMP01.RUN_CMD', 'Bật bơm'),
    ev.write('R.RUN', true, 'Chạy R.RUN'),
  ];
  clicks.forEach((c, i) => entries.push([uid(`Ô ${24 + i}`), [], c]));
  const itemId = 'chuan_3b';
  const bindingFile = `screens/chuan-3b.${itemId}.bindings.json`;
  files['graphics/chuan-3b.svg'] = r.svg;
  bindingFiles[bindingFile] = json(bindingSet('chuan-3b', itemId, entries));
  const bound = new Set(entries.map((e) => e[0]));
  const item = {
    id: itemId,
    name: 'Màn hình chuẩn 3b',
    type: 'svg',
    x: 60,
    y: 60,
    width: 1800,
    height: 600,
    svgFile: 'graphics/chuan-3b.svg',
    bindingFile,
    viewBox: r.viewBox,
    fit: 'contain',
    elements: r.elements
      .filter((e) => bound.has(e.uid))
      .map((e) => ({ elementUid: e.uid, name: e.name })),
  };
  screens.push({
    schemaVersion: V,
    id: 'chuan-3b',
    name: 'Màn hình chuẩn 3b',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    background: '#0f1b21',
    items: [item],
  });
  return { entry: 'chuan-3b', list: ['chuan-3b'], elementCount: r.elements.length };
}

function buildDemo() {
  // ---- Bồn nước ----
  const bon = [];
  const tank = symbolItem('bon-nuoc', 'tank-vertical', 'tank_vertical_1', 80, 100, 1.5);
  addItem(
    bon,
    tank,
    [
      [tank.uid('liquid'), [B.level('TANK01.LEVEL')]],
      [tank.uid('text'), [B.text('TANK01.LEVEL', { decimals: 1, suffix: ' %' })]],
      [
        tank.uid('body'),
        [
          B.fillRange(
            'TANK01.LEVEL',
            [
              { to: 20, value: '#ffcdd2' },
              { from: 20.01, to: 80, value: '#eceff1' },
              { from: 80.01, value: '#ffe0b2' },
            ],
            '#eceff1',
          ),
        ],
      ],
      [tank.uid('hit'), [], ev.navigate('tong-quan', 'Về Tổng quan')],
    ],
    'bon-nuoc',
  );
  const pipe1 = symbolItem('bon-nuoc', 'pipe-h', 'pipe_h_1', 230, 270, 2);
  addItem(
    bon,
    pipe1,
    [
      [pipe1.uid('flow'), [B.flow('PUMP01.RUN_CMD')]],
      [pipe1.uid('pipe'), [B.opacity('METER1.P', 10)]],
    ],
    'bon-nuoc',
  );
  const pump = symbolItem('bon-nuoc', 'pump-centrifugal', 'pump_centrifugal_1', 430, 210, 1.2);
  addItem(
    bon,
    pump,
    [
      [pump.uid('lamp'), [B.fill('PUMP01.RUN_CMD', '#2fbf63', '#9e9e9e')]],
      [pump.uid('impeller'), [B.spin('PUMP01.RUN_CMD')]],
      [
        pump.uid('body'),
        [B.stroke('PUMP01.FAULT', '#ef4444', '#37474f'), B.blink('PUMP01.FAULT')],
        ev.popup('bom1', 'Chi tiết Bơm 1'),
      ],
      [pump.uid('hit'), [], ev.toggle('PUMP01.RUN_CMD', 'Bật tắt Bơm 1')],
    ],
    'bon-nuoc',
  );
  const valve = symbolItem('bon-nuoc', 'valve-gate', 'valve_gate_1', 640, 240, 1.2);
  addItem(
    bon,
    valve,
    [
      [valve.uid('handwheel'), [B.rotate('TANK01.SP', 100, 360)]],
      [valve.uid('body'), [B.translateY('SIM.TEMP', 100, -6)]],
      [valve.uid('hit'), [], ev.write('R.SP', 50, 'Đặt R.SP = 50')],
    ],
    'bon-nuoc',
  );
  const pipe2 = symbolItem('bon-nuoc', 'pipe-h', 'pipe_h_2', 740, 270, 2);
  addItem(bon, pipe2, [[pipe2.uid('flow'), [B.flow('SIM.ALARM', 60)]]], 'bon-nuoc');
  const motor = symbolItem('bon-nuoc', 'motor-ac', 'motor_ac_1', 940, 230, 1.3);
  addItem(
    bon,
    motor,
    [
      [motor.uid('rotor'), [B.spin('R.RUN')]],
      [motor.uid('text'), [B.text('PUMP01.STATE_TEXT', {}), B.translateX('SIM.PRESS', 10, 8)]],
      [motor.uid('body'), [B.scale('SIM.FLOW', 120, 1.06)]],
      [motor.uid('lamp'), [B.visibility('PUMP01.RUN_CMD')]],
      [motor.uid('hit'), [], ev.pulse('R.PULSE', 'Xung R.PULSE')],
    ],
    'bon-nuoc',
  );
  // Đồ họa nhập từ Inkscape thật (fixture inkscape-02-motor-pump).
  const imp = importFixture('tests/fixtures/svg-import/inkscape-02-motor-pump.svg', 'svg-demo-bon');
  files['graphics/tram-bom.svg'] = imp.r.svg;
  const impBindings = `screens/bon-nuoc.tram_bom.bindings.json`;
  const named = ['Thân bơm', 'Dòng chảy', 'Chú thích', 'Motor M1'];
  bindingFiles[impBindings] = json(
    bindingSet('bon-nuoc', 'tram_bom', [
      [imp.byName('Thân bơm'), [B.fill('PUMP01.RUN_CMD', '#22c55e', '#64748b')]],
      [imp.byName('Dòng chảy'), [B.flow('PUMP01.RUN_CMD')]],
      [imp.byName('Chú thích'), [B.text('SIM.TEMP', { decimals: 1, suffix: ' °C' })]],
      [imp.byName('Motor M1'), [B.spin('R.RUN', true)]],
    ]),
  );
  bon.push({
    id: 'tram_bom',
    name: 'Trạm bơm (nhập từ Inkscape)',
    type: 'svg',
    x: 80,
    y: 460,
    width: 600,
    height: 200,
    svgFile: 'graphics/tram-bom.svg',
    bindingFile: impBindings,
    viewBox: imp.r.viewBox,
    fit: 'contain',
    elements: named.map((n) => ({ elementUid: imp.byName(n), name: n })),
  });
  screens.push({
    schemaVersion: V,
    id: 'bon-nuoc',
    name: 'Bồn nước',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    background: '#0f1b21',
    items: bon,
  });

  // ---- Tổng quan ----
  const tq = [];
  const tankH = symbolItem('tong-quan', 'tank-horizontal', 'tank_horizontal_1', 80, 80, 1.5);
  addItem(
    tq,
    tankH,
    [
      [tankH.uid('liquid'), [B.clip('SIM.TEMP')]],
      [tankH.uid('text'), [B.text('SIM.TEMP', { decimals: 0, suffix: ' °C' })]],
    ],
    'tong-quan',
  );
  const dosing = symbolItem('tong-quan', 'pump-dosing', 'pump_dosing_1', 400, 90, 1);
  addItem(
    tq,
    dosing,
    [
      [dosing.uid('plunger'), [B.translateX('SIM.PRESS', 10, 10)]],
      [dosing.uid('lamp'), [B.fill('SIM.ALARM', '#ef4444', '#9e9e9e')]],
      [dosing.uid('hit'), [], ev.navigate('bon-nuoc', 'Sang Bồn nước')],
    ],
    'tong-quan',
  );
  const fan = symbolItem('tong-quan', 'fan', 'fan_1', 560, 90, 1);
  addItem(
    tq,
    fan,
    [
      [fan.uid('blades'), [B.spin('SIM.FAN_ON')]],
      [fan.uid('lamp'), [B.fill('SIM.FAN_ON', '#2fbf63', '#9e9e9e')]],
    ],
    'tong-quan',
  );
  const ctrl = symbolItem('tong-quan', 'valve-control', 'valve_control_1', 720, 90, 1);
  addItem(
    tq,
    ctrl,
    [
      [ctrl.uid('stem'), [B.translateY('SIM.FLOW', 120, -10)]],
      [
        ctrl.uid('body'),
        [
          B.fillRange(
            'SIM.FLOW',
            [
              { to: 40, value: '#90caf9' },
              { from: 40.01, value: '#1e88e5' },
            ],
            '#90caf9',
          ),
        ],
      ],
    ],
    'tong-quan',
  );
  const elbow = symbolItem('tong-quan', 'pipe-elbow', 'pipe_elbow_ws_1', 840, 110, 1.5, 'ws');
  addItem(tq, elbow, [[elbow.uid('flow'), [B.flow('SIM.FAN_ON', 30)]]], 'tong-quan');
  const imp2 = importFixture('tests/fixtures/svg-import/inkscape-02-motor-pump.svg', 'svg-demo-tq');
  files['graphics/tong-quan.svg'] = imp2.r.svg;
  const f2 = 'screens/tong-quan.so_do.bindings.json';
  bindingFiles[f2] = json(
    bindingSet('tong-quan', 'so_do', [
      [imp2.byName('Chú thích'), [B.text('SIM.PRESS', { decimals: 1, suffix: ' bar' })]],
      [imp2.byName('Dòng chảy'), [B.flow('SIM.ALARM')]],
    ]),
  );
  tq.push({
    id: 'so_do',
    name: 'Sơ đồ trạm bơm',
    type: 'svg',
    x: 80,
    y: 360,
    width: 800,
    height: 267,
    svgFile: 'graphics/tong-quan.svg',
    bindingFile: f2,
    viewBox: imp2.r.viewBox,
    fit: 'contain',
    elements: ['Chú thích', 'Dòng chảy'].map((n) => ({ elementUid: imp2.byName(n), name: n })),
  });
  screens.push({
    schemaVersion: V,
    id: 'tong-quan',
    name: 'Tổng quan',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    background: '#0f1b21',
    items: tq,
  });

  // ---- Popup Bơm 1 ----
  const pp = [];
  const bigPump = symbolItem('bom1', 'pump-centrifugal', 'pump_centrifugal_1', 140, 60, 1.6);
  addItem(
    pp,
    bigPump,
    [
      [bigPump.uid('impeller'), [B.spin('PUMP01.RUN_CMD')]],
      [bigPump.uid('lamp'), [B.fill('PUMP01.RUN_CMD', '#2fbf63', '#9e9e9e')]],
      [bigPump.uid('hit'), [], ev.closePopup('Đóng')],
    ],
    'bom1',
  );
  screens.push({
    schemaVersion: V,
    id: 'bom1',
    name: 'Bơm 1',
    kind: 'popup',
    size: { width: 480, height: 320 },
    background: '#16262e',
    items: pp,
  });
  return { entry: 'bon-nuoc', list: ['bon-nuoc', 'tong-quan', 'bom1'] };
}

const built = standard ? buildStandard() : buildDemo();

const project = {
  format: 'matscada-project',
  schemaVersion: V,
  projectId: standard ? 'svg-demo-standard' : 'svg-demo',
  projectName: standard ? 'Demo đồ họa SVG (màn hình chuẩn 3b)' : 'Demo đồ họa SVG',
  projectVersion: '0.1.0',
  minRuntimeVersion: '0.7.0',
  entryScreen: built.entry,
  screens: built.list,
  tagFile: 'tags.json',
  connectionFile: 'connections.json',
  valueTables: ['TrangThaiBom'],
  maxClients: 10,
};

const out = {
  'project.json': formatProject03(project),
  'tags.json': tagsText,
  'connections.json': to04(demo('connections.json')),
  'value-tables/TrangThaiBom.json': to04(demo('value-tables/TrangThaiBom.json')),
  ...files,
  ...bindingFiles,
};
for (const s of screens) out[`screens/${s.id}.screen.json`] = formatScreen03(s);

if (existsSync(outDir))
  for (const n of readdirSync(outDir))
    if (n !== 'README.md') rmSync(join(outDir, n), { recursive: true, force: true });
for (const [rel, text] of Object.entries(out)) {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
console.log(
  `Đã sinh ${Object.keys(out).length} tệp ở ${outDir}${standard ? ` (chuẩn 3b: ${built.elementCount} phần tử)` : ''}`,
);
