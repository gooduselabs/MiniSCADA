// Project giả của feature 010 cho e2e: màn hình Điện năng + báo cáo (T105, T113) và màn hình 4 biểu đồ lịch sử (T091).
// Dựa trên historyProject() (history-fake.mjs); mẫu báo cáo và màn hình lấy từ projects/history-demo.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyProject } from './history-fake.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readDemo = (p) => JSON.parse(readFileSync(resolve(REPO, 'projects/history-demo', p), 'utf8'));

const SIX = ['min', 'max', 'avg', 'sum', 'first', 'last'];

/** Ba mẫu của projects/history-demo (ngày, ca, tháng) + mẫu tháng 12 cột (T105) + mẫu tên/nhãn độc hại (T106). */
export function demoReports() {
  const file = readDemo('reports.json');
  file.reports.push(
    {
      id: 'thang-12c',
      name: 'Điện năng tháng 12 cột',
      group: 'dien',
      period: 'month',
      // A3 ngang: ở A4 ngang, số có chấm nghìn ở cột cuối bị PDF ngắt dòng giữa số (phát hiện của T105, báo cho chủ gói report-export)
      paper: { size: 'A3', orientation: 'landscape' },
      totals: true,
      columns: [
        { tagId: 'METER1.KW', label: 'Công suất', unit: 'kW', decimals: 2, functions: SIX },
        { tagId: 'METER1.KWH', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: SIX },
      ],
    },
    {
      id: 'doc-hai',
      name: '<script>window.__pwn=1</script> Mẫu',
      group: 'dien',
      period: 'day',
      rowMinutes: 60,
      columns: [
        {
          tagId: 'METER1.KW',
          label: '<img src=x onerror="window.__pwn=2">',
          decimals: 1,
          functions: ['avg'],
        },
      ],
    },
  );
  return file;
}

/** Project giả: màn hình `dien-nang` (history-bar, history-pie) và `reports.json` của history-demo. */
export function reportsProject() {
  const base = historyProject();
  const screen = readDemo('screens/dien-nang.screen.json');
  const file = 'screens/dien-nang.screen.json';
  base.files.set(file, { json: screen });
  base.files.set('reports.json', { json: demoReports() });
  const navigation = {
    position: 'left',
    items: [
      { label: 'Điện năng', screen: 'dien-nang', icon: 'bolt' },
      { label: 'Báo cáo điện ngày', report: 'dien-ngay', icon: 'doc' },
      { label: 'Báo cáo điện ca', report: 'dien-ca', icon: 'doc' },
      { label: 'Báo cáo điện tháng', report: 'dien-thang', icon: 'doc' },
    ],
  };
  const a = base.active;
  a.project = {
    ...a.project,
    projectId: 'reports-e2e',
    entryScreen: 'dien-nang',
    navigation,
    reportsFile: 'reports.json',
  };
  a.navigation = navigation;
  a.screens = [{ id: 'dien-nang', name: screen.name, kind: 'screen', file }];
  a.digest = 'sha256:e2e-reports';
  return base;
}

/** Project: một màn hình có 4 biểu đồ lịch sử và một card live (T091). */
export function history10Project() {
  const base = historyProject();
  const file = 'screens/bon-bieu-do.screen.json';
  const hw = (id, x, y, series, range) => ({
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
    schemaVersion: '0.3.0',
    id: 'bon-bieu-do',
    name: 'Bốn biểu đồ',
    kind: 'screen',
    size: { width: 1100, height: 720 },
    items: [
      hw('t1', 10, 10, ['LINE1.PRESS', 'LINE1.TEMP'], '24h'),
      hw('t2', 550, 10, ['LINE1.PRESS'], '8h'),
      hw('t3', 10, 320, ['LINE1.TEMP', 'PUMP1.RUN'], '1h'),
      hw('t4', 550, 320, ['LINE1.TEMP'], '24h'),
      {
        type: 'widget',
        id: 'live',
        widget: 'card',
        x: 10,
        y: 640,
        width: 260,
        height: 70,
        tags: { value: 'TANK01.LEVEL' },
        props: { label: 'Mức bồn', decimals: 1 },
      },
    ],
  };
  base.files.set(file, { json: screen });
  const a = base.active;
  a.project = { ...a.project, projectId: 'history10-e2e', entryScreen: 'bon-bieu-do' };
  a.screens = [{ id: 'bon-bieu-do', name: screen.name, kind: 'screen', file }];
  a.digest = 'sha256:e2e-history10';
  return base;
}
