// Project của kịch bản access-data của web-it (feature 013, T023): bản sao projects/dashboard-demo (định dạng 1.0) vào
// tests/web-it/out/access-data, thêm một nhóm lưu trữ và hai alarm luôn bật:
//   WAVE_HIGH  — Tag DEMO.WAVE (sóng 25..75, ở màn hình tong-quan: vh1 xem được),
//   SPHI_HIGH  — Tag TANK01.SP_HI (nội, 85, chỉ ở màn hình bon-nuoc: kịch bản cấm vh1 xem bon-nuoc).
// Nhóm lưu trữ `song` (chu kỳ 1 s) ghi cả hai Tag. Không commit (tests/web-it/out/ bị bỏ qua).
//   node tests/web-it/make-access-data.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../projects/dashboard-demo');
const out = resolve(here, 'out/access-data');
rmSync(out, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
cpSync(src, out, { recursive: true });
for (const d of ['.mat-editor', '.mat-backup'])
  rmSync(join(out, d), { recursive: true, force: true });

const write = (name, doc) => writeFileSync(join(out, name), `${JSON.stringify(doc, null, 2)}\n`);
const pj = JSON.parse(readFileSync(join(out, 'project.json'), 'utf8'));
pj.projectId = 'access-data';
pj.alarmFile = 'alarms.json';
pj.alarmClassFile = 'alarm-classes.json';
pj.loggingFile = 'logging.json';
write('project.json', pj);
write('alarm-classes.json', {
  schemaVersion: pj.schemaVersion,
  classes: [
    { id: 'major', name: 'Quan trọng', priority: 'major', color: 'orange', sound: 'none' },
    { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'none' },
  ],
});
write('alarms.json', {
  schemaVersion: pj.schemaVersion,
  areas: [{ id: 'bon', name: 'Bồn' }],
  alarms: [
    {
      id: 'WAVE_HIGH',
      type: 'limit',
      name: 'Sóng thử cao',
      area: 'bon',
      tag: 'DEMO.WAVE',
      limits: { H: { value: 1, class: 'minor' } },
      deadband: 0.5,
    },
    {
      id: 'SPHI_HIGH',
      type: 'limit',
      name: 'Ngưỡng mức cao đặt cao',
      area: 'bon',
      tag: 'TANK01.SP_HI',
      limits: { H: { value: 10, class: 'major' } },
      deadband: 0.5,
    },
  ],
});
write('logging.json', {
  schemaVersion: pj.schemaVersion,
  timeZone: '+07:00',
  groups: [
    {
      id: 'song',
      name: 'Sóng và ngưỡng',
      mode: 'cyclic',
      periodMs: 1000,
      retentionDays: 1,
      tags: [{ tagId: 'DEMO.WAVE' }, { tagId: 'TANK01.SP_HI' }],
    },
  ],
});
console.log(out);
