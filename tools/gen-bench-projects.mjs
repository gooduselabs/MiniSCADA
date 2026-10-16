// Sinh project đo của feature 011 (T072; FR-038, FR-039; contracts/test-protocols.md §1, §2), định dạng 0.6.0:
//   node tools/gen-bench-projects.mjs [--out <thư mục>] [--only bench-1000|soak-standard]
//   bench-1000     1.000 Tag mô phỏng SIM.T0001..SIM.T1000 (L2: `load-tester -tags 1000`), màn hình 250 item (L4).
//   soak-standard  500 Tag SIM.T0001..SIM.T0500 (450 mô phỏng, 50 tính toán; L1, S1: `load-tester -tags 500`), lưu trữ
//                  200 Tag theo thay đổi (một nhóm onChange), 3 màn hình (250 item, bảng Tag, xu hướng).
// Mặc định ghi vào <repo>/out/bench-projects/. Dữ liệu sinh lớn KHÔNG commit: `projects/bench-1000/`,
// `projects/soak-standard/` và `out/bench-projects/` đã có trong .gitignore (dùng `--out projects` khi cần đúng chỗ của
// tasks.md). Mỗi lần chạy xóa rồi viết lại đúng thư mục của project (không đụng phần khác của --out). Tất định: chạy lại
// cho cùng từng byte. Logic mẫu chưa sinh: logic chỉ có ở định dạng 1.0 và engine chưa tích hợp vào runtime (T136,
// T141); thêm khi có. Mã thoát: 0 xong, 2 dùng sai.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V = '0.6.0';
const NAMES = ['bench-1000', 'soak-standard'];

function usage(msg) {
  console.error(msg);
  console.error(
    'Dùng: node tools/gen-bench-projects.mjs [--out <thư mục>] [--only bench-1000|soak-standard]',
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

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const built = { 'bench-1000': bench1000, 'soak-standard': soakStandard };
const summary = [];
for (const name of only ? [only] : NAMES) {
  const { proj, tags, screens, logging } = built[name]();
  const dir = join(outDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'screens'), { recursive: true });
  writeFileSync(join(dir, 'project.json'), json(proj));
  writeFileSync(join(dir, 'tags.json'), json({ schemaVersion: V, tags }));
  if (logging) writeFileSync(join(dir, 'logging.json'), json(logging));
  for (const s of screens) writeFileSync(join(dir, 'screens', `${s.id}.screen.json`), json(s));
  summary.push({
    name,
    dir,
    tags: tags.length,
    logged: logging ? logging.groups.reduce((n, g) => n + g.tags.length, 0) : 0,
    screens: screens.length,
    logic: 'chưa sinh (T136, T141)',
  });
}
console.log(JSON.stringify(summary));
