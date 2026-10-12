// Sinh project 500 Tag cho phép đo hiệu năng của Bảng Tag (feature 004, T081, SC-003): bản sao của
// projects/tank-demo, giữ 5 Tag gốc (màn hình và lưu trữ vẫn hợp lệ) và thêm 495 Tag mô phỏng.
// Chạy lại khi tank-demo đổi:  node tests/fixtures/studio/make-tags-500.mjs
// Kết quả nằm ở tests/fixtures/studio/tags-500/ và được commit; e2e đọc thư mục này.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const src = join(root, 'projects/tank-demo');
const out = join(here, 'tags-500');

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const project = JSON.parse(readFileSync(join(out, 'project.json'), 'utf8'));
project.projectId = 'tags-500';
project.projectName = 'Đo hiệu năng 500 Tag';
writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2) + '\n');

const tags = JSON.parse(readFileSync(join(out, 'tags.json'), 'utf8'));
const KINDS = [
  { suffix: 'LEVEL', type: 'FLOAT32', unit: '%', min: 0, max: 100, signal: 'tank.level' },
  { suffix: 'TEMP', type: 'FLOAT32', unit: '°C', min: 0, max: 80, signal: 'tank.temp' },
  { suffix: 'RUN', type: 'BOOL', signal: 'motor.run' },
  { suffix: 'SPEED', type: 'FLOAT32', unit: 'rpm', min: 0, max: 1500, signal: 'motor.speed' },
  { suffix: 'COUNT', type: 'UINT32', min: 0, max: 100000, signal: 'tank.inflow' },
];
for (let i = 0; tags.tags.length < 500; i++) {
  const k = KINDS[i % KINDS.length];
  const unit = String(Math.floor(i / KINDS.length) + 2).padStart(3, '0');
  const tag = { id: `AREA${unit}.${k.suffix}`, type: k.type, description: `Thiết bị ${unit} · ${k.suffix.toLowerCase()}` };
  if (k.unit) tag.unit = k.unit;
  if (k.min !== undefined) tag.min = k.min;
  if (k.max !== undefined) tag.max = k.max;
  tag.source = { kind: 'mock', signal: k.signal };
  tags.tags.push(tag);
}
writeFileSync(join(out, 'tags.json'), JSON.stringify(tags, null, 2) + '\n');
console.log(`tags-500: ${tags.tags.length} Tag → ${out}`);
