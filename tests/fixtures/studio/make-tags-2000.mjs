// Sinh project 0.2 có 2.000 Tag đủ loại cho phép đo hiệu năng của lưới (feature 006, T135, SC-012): bản sao của
// tests/project-vectors/v02-valid-full (giữ 13 Tag gốc để màn hình, bảng giá trị, bảng theo dõi vẫn hợp lệ), thêm 1.987 Tag:
// 1.000 Tag ngoài (Modbus TCP), 497 Tag tính toán (tổng 500 biểu thức), 290 Tag nội bộ, 200 Tag mô phỏng.
// Chạy lại khi bộ vector đổi:  node tests/fixtures/studio/make-tags-2000.mjs
// Kết quả nằm ở tests/fixtures/studio/tags-2000-v02/ và được commit; e2e đọc thư mục này.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const src = join(root, 'tests/project-vectors/v02-valid-full');
const out = join(here, 'tags-2000-v02');

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
rmSync(join(out, 'expected.json'), { force: true });

const project = JSON.parse(readFileSync(join(out, 'project.json'), 'utf8'));
project.projectId = 'tags-2000';
project.projectName = 'Đo hiệu năng 2.000 Tag';
writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2) + '\n');

const doc = JSON.parse(readFileSync(join(out, 'tags.json'), 'utf8'));
const pad = (n) => String(n).padStart(4, '0');
const ext = [];
for (let i = 0; i < 1000; i++)
  ext.push({
    id: `EXT_${pad(i)}`,
    kind: 'external',
    type: 'FLOAT32',
    description: `Tag ngoài ${pad(i)} · đo mức bồn`,
    unit: 'm',
    min: 0,
    max: 100,
    source: { device: 'plc1', address: `HR${1000 + i * 2}` },
  });
const calc = [];
for (let i = 0; i < 497; i++)
  calc.push({
    id: `CALC_${pad(i)}`,
    kind: 'calculated',
    type: 'FLOAT32',
    description: `Tính toán ${pad(i)}`,
    expression: `EXT_${pad(i)} * 2 + 1`,
  });
const internal = [];
for (let i = 0; i < 290; i++)
  internal.push({
    id: `INT_${pad(i)}`,
    kind: 'internal',
    type: 'INT16',
    description: `Nội bộ ${pad(i)}`,
    access: 'RW',
    limits: { min: 0, max: 1000 },
    initial: i % 100,
  });
const sim = [];
for (let i = 0; i < 200; i++)
  sim.push({
    id: `SIM_${pad(i)}`,
    kind: 'simulation',
    type: 'FLOAT64',
    description: `Mô phỏng ${pad(i)}`,
    sim: { kind: 'sine', center: 50, amplitude: 25, periodMs: 20000 },
  });
doc.tags.push(...ext, ...calc, ...internal, ...sim);
writeFileSync(join(out, 'tags.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(`tags-2000-v02: ${doc.tags.length} Tag → ${out}`);
