// Sinh project storm-200 cho kịch bản storm của feature 009 (T112 phần Node, T115): 200 alarm digital cùng một Tag nguồn
// (coil C0 của giả lập Modbus) để bật trong đúng một tick, cộng một alarm chập chờn trên coil C1 (SC-018, SC-019).
//   node tests/alarm-it/make-projects.mjs        → tests/alarm-it/projects/storm-200 (đầu ra được commit)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'projects', 'it-basic');
const out = join(here, 'projects', 'storm-200');
mkdirSync(join(out, 'screens'), { recursive: true });
for (const f of ['alarm-classes.json', 'connections.json'])
  copyFileSync(join(src, f), join(out, f));
copyFileSync(
  join(src, 'screens', 'tong-quan.screen.json'),
  join(out, 'screens', 'tong-quan.screen.json'),
);
const j = (v) => JSON.stringify(v, null, 2) + '\n';

const project = JSON.parse(
  (await import('node:fs'))
    .readFileSync(join(src, 'project.json'), 'utf8')
    .replace('alarm-it-basic', 'alarm-it-storm'),
);
writeFileSync(join(out, 'project.json'), j(project));
writeFileSync(
  join(out, 'tags.json'),
  j({
    schemaVersion: '0.5.0',
    tags: [
      {
        id: 'IT.LEVEL',
        kind: 'external',
        type: 'UINT16',
        unit: '%',
        min: 0,
        max: 100,
        source: { device: 'plc1', address: 'HR0' },
      },
      { id: 'STORM.GO', kind: 'external', type: 'BOOL', source: { device: 'plc1', address: 'C0' } },
      { id: 'STORM.CH', kind: 'external', type: 'BOOL', source: { device: 'plc1', address: 'C1' } },
    ],
  }),
);
const classes = ['critical', 'major', 'minor', 'advisory'];
const alarms = [];
for (let i = 1; i <= 200; i++) {
  alarms.push({
    id: `STORM_${String(i).padStart(3, '0')}`,
    type: 'digital',
    name: `Bão ${i}`,
    area: i % 2 ? 'bon' : 'bom',
    tag: 'STORM.GO',
    trigger: true,
    class: classes[i % 4],
    text: `Alarm bão số ${i} ({tag})`,
  });
}
alarms.push({
  id: 'CHATTER_1',
  type: 'digital',
  name: 'Chập chờn',
  area: 'bom',
  tag: 'STORM.CH',
  trigger: true,
  class: 'major',
});
writeFileSync(
  join(out, 'alarms.json'),
  j({
    schemaVersion: '0.5.0',
    areas: [
      { id: 'bon', name: 'Bồn' },
      { id: 'bom', name: 'Bơm' },
    ],
    alarms,
  }),
);
console.log(`đã sinh ${out}`);
