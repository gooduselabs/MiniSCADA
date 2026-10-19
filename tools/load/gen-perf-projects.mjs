// Project đo của T055 (012, SC-005) và T032 (013, SC-006): bản sao projects/dashboard-demo (bố cục Tự do) và
// projects/grid-demo (bố cục Lưới), mỗi bản thêm 500 Tag mô phỏng SIM.T0001..SIM.T0500 (sin, như soak-standard của
// tools/gen-bench-projects.mjs) và 10 màn hình perf-01..perf-10, mỗi màn 50 card (màn s gắn SIM.T(50(s-1)+1..50s)):
// grid-demo dùng bố cục lưới 12 cột (4 card một hàng, span 3), dashboard-demo đặt cùng card theo x/y. Hai project có
// cùng Tag, cùng item và cùng binding; chỉ khác bố cục. Không commit (đầu ra nằm trong thư mục build).
//   node tools/load/gen-perf-projects.mjs --out <thư mục>     → <out>/perf-free, <out>/perf-grid
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const outDir = resolve(argv[argv.indexOf('--out') + 1] ?? join(root, 'out/perf-projects'));
if (!argv.includes('--out')) {
  console.error('Dùng: node tools/load/gen-perf-projects.mjs --out <thư mục>');
  process.exit(2);
}
export const SCREENS = 10;
export const PER_SCREEN = 50;
const tagId = (k) => `SIM.T${String(k).padStart(4, '0')}`;
const screenId = (s) => `perf-${String(s).padStart(2, '0')}`;

function simTag(k) {
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

function screen(s, version, grid) {
  const items = [];
  for (let i = 0; i < PER_SCREEN; i++) {
    const it = {
      id: `i${String(i).padStart(2, '0')}`,
      name: `Card ${i}`,
      type: 'widget',
      widget: 'card',
      props: { label: `V${i}` },
      tags: { value: tagId((s - 1) * PER_SCREEN + i + 1) },
    };
    if (!grid)
      Object.assign(it, {
        x: 16 + (i % 4) * 476,
        y: 16 + Math.floor(i / 4) * 120,
        width: 464,
        height: 108,
      });
    items.push(it);
  }
  const doc = {
    schemaVersion: version,
    id: screenId(s),
    name: `Đo tải ${s}`,
    size: { width: 1920, height: 1600 },
    items,
  };
  if (grid) {
    const rows = [];
    for (let r = 0; r * 4 < PER_SCREEN; r++) {
      const cells = [];
      for (let c = 0; c < 4 && r * 4 + c < PER_SCREEN; c++)
        cells.push({ id: `c${r * 4 + c}`, span: 3, item: items[r * 4 + c].id });
      rows.push({ id: `r${r}`, height: 'auto', cells });
    }
    doc.layout = { mode: 'grid', columns: 12, gap: 12, padding: 16, rows };
  }
  return doc;
}

function make(src, name, grid) {
  const out = join(outDir, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(src, out, { recursive: true });
  for (const d of ['.mat-editor', '.mat-backup'])
    rmSync(join(out, d), { recursive: true, force: true });
  const pj = JSON.parse(readFileSync(join(out, 'project.json'), 'utf8'));
  const tags = JSON.parse(readFileSync(join(out, 'tags.json'), 'utf8'));
  for (let k = 1; k <= SCREENS * PER_SCREEN; k++) tags.tags.push(simTag(k));
  writeFileSync(join(out, 'tags.json'), `${JSON.stringify(tags, null, 1)}\n`);
  for (let s = 1; s <= SCREENS; s++) {
    pj.screens.push(screenId(s));
    writeFileSync(
      join(out, 'screens', `${screenId(s)}.screen.json`),
      `${JSON.stringify(screen(s, pj.schemaVersion, grid), null, 1)}\n`,
    );
  }
  pj.projectId = name;
  pj.navigation.items.push({ label: 'Đo tải', screen: screenId(1), icon: 'chart' });
  writeFileSync(join(out, 'project.json'), `${JSON.stringify(pj, null, 2)}\n`);
  return out;
}

console.log(make(join(root, 'projects/dashboard-demo'), 'perf-free', false));
console.log(make(join(root, 'projects/grid-demo'), 'perf-grid', true));
