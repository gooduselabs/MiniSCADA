// Project 0.6 của các phép đo truy vấn lịch sử (feature 010: T073, T139, T140): một nhóm `bench` với N Tag
// mô phỏng, chu kỳ 5 s, có tổng hợp; cột trùng tên cột của `historian_tool fill-agg` (T0001…, S0020…).
//   node tools/bench-project.mjs <thư mục> [--tags 200]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const i = process.argv.indexOf('--tags');
const n = i >= 0 ? Number(process.argv[i + 1]) : 200;
if (!dir) {
  console.error('cần thư mục đích');
  process.exit(2);
}
const col = (k) => `${k % 20 === 19 ? 'S' : 'T'}${String(k + 1).padStart(4, '0')}`;
mkdirSync(join(dir, 'screens'), { recursive: true });
const tags = [];
const logged = [];
for (let k = 0; k < n; k++) {
  const isInt = k % 20 === 19;
  const id = `BENCH.${col(k)}`;
  tags.push({
    id,
    kind: 'simulation',
    type: isInt ? 'INT32' : 'FLOAT64',
    unit: isInt ? '' : 'u',
    sim: isInt
      ? { kind: 'square', periodMs: 60000 + 1000 * k, duty: 0.5 }
      : { kind: 'sine', center: 100, amplitude: 40, periodMs: 300000 + 17000 * k },
  });
  logged.push({ tagId: id, column: col(k) });
}
const write = (name, obj) => writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
write('project.json', {
  format: 'matscada-project',
  schemaVersion: '0.6.0',
  projectId: 'bench-history',
  projectName: 'Đo truy vấn lịch sử',
  projectVersion: '0.1.0',
  minRuntimeVersion: '0.9.0',
  entryScreen: 'tong-quan',
  screens: ['tong-quan'],
  tagFile: 'tags.json',
  loggingFile: 'logging.json',
  maxClients: 10,
});
write('tags.json', { schemaVersion: '0.6.0', tags });
write('logging.json', {
  schemaVersion: '0.6.0',
  timeZone: '+07:00',
  groups: [
    {
      id: 'bench',
      name: 'Đo hiệu năng',
      mode: 'cyclic',
      periodMs: 5000,
      retentionDays: 3650,
      aggregates: { minuteRetentionDays: 365, hourRetentionDays: 3650 },
      tags: logged,
    },
  ],
});
write('screens/tong-quan.screen.json', {
  schemaVersion: '0.6.0',
  id: 'tong-quan',
  name: 'Tổng quan',
  size: { width: 640, height: 360 },
  items: [
    {
      id: 'card_1',
      name: 'T0001',
      type: 'widget',
      widget: 'card',
      x: 40,
      y: 40,
      width: 200,
      height: 110,
      props: { label: 'T0001' },
      tags: { value: 'BENCH.T0001' },
    },
  ],
});
console.log(JSON.stringify({ dir, tags: n }));
