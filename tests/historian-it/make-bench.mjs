// Sinh project đo tải lưu trữ tests/historian-it/bench-500 (specs/003-data-logging T072, SC-001):
// tank-demo + 500 Tag FLOAT32 SIM.T0001…SIM.T0500 (signal sim.load: MockTagProvider dùng lại Tag
// đã khai báo khi runtime.json có "simLoad": true) + logging.json: 500 Tag mỗi giây chia 3 nhóm
// chu kỳ (schema cho tối đa 200 Tag mỗi nhóm) và một nhóm theo thay đổi.
//   node tests/historian-it/make-bench.mjs
// Ước tính: ghi ~1,4 GB/ngày (trong ngân sách 2 GiB/ngày), nhưng giữ 7 ngày cần ~2,8 GB > trần
// 2 GiB nên có cảnh báo W_LOG_SIZE_CAP (không chặn; đo SC-001 chỉ chạy 30 phút).
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'bench-500');
const demo = join(root, 'projects/tank-demo');

rmSync(out, { recursive: true, force: true });
cpSync(demo, out, { recursive: true, filter: (s) => !s.endsWith('README.md') });

const json = (file) => JSON.parse(readFileSync(join(out, file), 'utf8'));
const write = (file, value) =>
  writeFileSync(join(out, file), JSON.stringify(value, null, 2) + '\n');

const project = json('project.json');
project.projectId = 'bench-500';
project.projectName = 'Đo tải lưu trữ: 500 Tag mỗi giây';
project.loggingFile = 'logging.json';
write('project.json', project);

const tags = json('tags.json');
const sim = [];
for (let k = 1; k <= 500; k++) {
  const id = `SIM.T${String(k).padStart(4, '0')}`;
  sim.push(id);
  tags.tags.push({
    id,
    type: 'FLOAT32',
    description: `Tag tải ${k}`,
    source: { kind: 'mock', signal: 'sim.load' },
  });
}
write('tags.json', tags);

write('logging.json', {
  schemaVersion: '0.1.0',
  timeZone: '+07:00',
  groups: [
    ...[
      ['sim-a', 0, 200],
      ['sim-b', 200, 400],
      ['sim-c', 400, 500],
    ].map(([id, from, to]) => ({
      id,
      name: `Tải ${from + 1}–${to} mỗi giây`,
      mode: 'cyclic',
      periodMs: 1000,
      retentionDays: 7,
      tags: sim.slice(from, to).map((tagId) => ({ tagId })),
    })),
    {
      id: 'van-hanh',
      name: 'Vận hành',
      mode: 'onChange',
      minIntervalMs: 1000,
      maxIntervalMs: 60000,
      retentionDays: 7,
      tags: [
        { tagId: 'TANK01.LEVEL', deadband: 0.5 },
        { tagId: 'MOTOR01.RUN' },
        { tagId: 'MOTOR01.SPEED', deadband: 10 },
        { tagId: 'TANK01.TEMP' },
      ],
    },
  ],
});
console.log(`bench-500: ${tags.tags.length} Tag, 4 nhóm → ${out}`);
