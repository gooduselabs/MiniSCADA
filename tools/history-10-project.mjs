// Dựng project cho `tools/web-it.ps1 -Scenario history-10` trên runtime x64 thật (T091): copy projects/history-demo và thêm
// màn hình `bon-bieu-do` (4 biểu đồ lịch sử của nhóm ap-suat và một card live), đặt làm màn hình vào.
//   node tools/history-10-project.mjs <thư-mục-đích>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node tools/history-10-project.mjs <dest>');
  process.exit(2);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(join(root, 'projects/history-demo'), dest, { recursive: true });

const widget = (id, x, y, series, range) => ({
  type: 'widget',
  id,
  widget: 'history-trend',
  x,
  y,
  width: 520,
  height: 300,
  tags: { series },
  props: { group: 'ap-suat', range, follow: false },
});
const screen = {
  schemaVersion: '0.6.0',
  id: 'bon-bieu-do',
  name: 'Bốn biểu đồ',
  kind: 'screen',
  size: { width: 1100, height: 720 },
  items: [
    widget('t1', 10, 10, ['PROC.PRESSURE', 'PROC.TEMP'], '24h'),
    widget('t2', 550, 10, ['PROC.PRESSURE'], '8h'),
    widget('t3', 10, 320, ['PROC.TEMP'], '1h'),
    widget('t4', 550, 320, ['PROC.TEMP'], '24h'),
    {
      type: 'widget',
      id: 'live',
      widget: 'card',
      x: 10,
      y: 640,
      width: 260,
      height: 70,
      tags: { value: 'PROC.PRESSURE' },
      props: { label: 'Áp suất', decimals: 1 },
    },
  ],
};
writeFileSync(join(dest, 'screens/bon-bieu-do.screen.json'), JSON.stringify(screen, null, 2) + '\n');
const pPath = join(dest, 'project.json');
const project = JSON.parse(readFileSync(pPath, 'utf8'));
project.screens.push('bon-bieu-do');
project.entryScreen = 'bon-bieu-do';
writeFileSync(pPath, JSON.stringify(project, null, 2) + '\n');
console.log(`project history-10 -> ${dest}`);
