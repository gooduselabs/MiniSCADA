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
  file.org = 'Nhà máy nước Bình An';
  file.reports.push(
    {
      id: 'thang-12c',
      name: 'Điện năng tháng 12 cột',
      group: 'dien',
      period: 'month',
      // A4 ngang, 12 cột: bắt hồi quy số bị PDF ngắt giữa số (T105; sửa ở report-export/pdf.ts: planLayout)
      paper: { size: 'A4', orientation: 'landscape' },
      totals: true,
      columns: [
        { tagId: 'METER1.KW', label: 'Công suất', unit: 'kW', decimals: 2, functions: SIX },
        { tagId: 'METER1.KWH', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: SIX },
      ],
    },
    // feature 015: tuần, thiết bị, alarm, logic
    {
      id: 'dien-tuan',
      name: 'Điện năng theo tuần',
      group: 'dien',
      period: 'week',
      title: 'BÁO CÁO ĐIỆN NĂNG THEO TUẦN',
      chart: 'bar',
      columns: [
        { tagId: 'METER1.KWH', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: ['delta'] },
        {
          tagId: 'METER1.KW',
          label: 'Công suất',
          unit: 'kW',
          decimals: 1,
          functions: ['avg', 'max'],
        },
      ],
    },
    {
      id: 'van-hanh-bom',
      name: 'Vận hành bơm',
      kind: 'equipment',
      group: 'ap-suat',
      period: 'shift',
      shifts: { count: 3, start: '06:00' },
      title: 'BÁO CÁO VẬN HÀNH BƠM THEO CA',
      columns: [
        {
          tagId: 'PUMP1.RUN',
          label: 'Bơm 1',
          unit: 'giờ',
          decimals: 2,
          functions: ['onTime', 'starts'],
        },
      ],
    },
    {
      id: 'alarm-ngay',
      name: 'Alarm theo ngày',
      kind: 'alarm',
      period: 'day',
      title: 'BÁO CÁO ALARM THEO NGÀY',
    },
    {
      id: 'logic-ngay',
      name: 'Logic theo ngày',
      kind: 'logic',
      period: 'day',
      title: 'BÁO CÁO GHI PLC CỦA LOGIC',
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
      { label: 'Báo cáo điện tuần', report: 'dien-tuan', icon: 'doc' },
      { label: 'Vận hành bơm', report: 'van-hanh-bom', icon: 'doc' },
      { label: 'Báo cáo alarm', report: 'alarm-ngay', icon: 'doc' },
      { label: 'Báo cáo logic', report: 'logic-ngay', icon: 'doc' },
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

// ---- feature 015: lịch sử alarm và nhật ký logic tất định (theo giờ địa phương +07:00) ------------------------------
const H = 3_600_000;
const TZ_MS = 7 * H;
/** Nửa đêm +07:00 của ngày chứa `t`. */
const dayStart = (t) => Math.floor((t + TZ_MS) / (24 * H)) * 24 * H - TZ_MS;
const ALARMS = [
  ['muc_cao', 'Mức bồn B1 cao', 'critical', 'bon', 'Mức bồn B1 vượt 90 %'],
  ['bom_loi', 'Bơm 1 lỗi', 'major', 'tram-bom', 'Bơm 1 báo lỗi quá dòng'],
  ['ap_thap', 'Áp suất đường ống thấp', 'minor', 'tram-bom', 'Áp suất dưới 2 bar'],
  ['cua_mo', 'Cửa tủ điện mở', 'advisory', null, 'Cửa tủ điện MCC mở'],
];

/** Lần xảy ra alarm của hôm qua và hôm nay (HistoryItem của device-api-1.3 §2.2), mới nhất trước. */
export function reportAlarmHistory(now = Date.now()) {
  const out = [];
  let id = 1;
  for (const d0 of [dayStart(now) - 24 * H, dayStart(now)])
    for (let h = 0; h < 24; h++) {
      const n = (h * 7 + 3) % 5; // 0..4 lần mỗi giờ
      for (let k = 0; k < n; k++) {
        const [alarmId, name, priority, area, text] = ALARMS[(h + k) % (k === 0 ? 2 : 4)];
        const tsActive = d0 + h * H + k * 11 * 60_000 + 90_000;
        if (tsActive >= now) continue;
        const acked = (h + k) % 6 !== 0;
        const tsAck = acked ? tsActive + ((h % 4) + 2) * 60_000 : null;
        const tsReturn = (h + k) % 5 !== 0 ? tsActive + 25 * 60_000 : null;
        out.push({
          id: id++,
          alarmId,
          name,
          class: 'process',
          priority,
          area,
          text,
          valueActive: true,
          qualityActive: 'GOOD',
          reason: null,
          tsActive,
          clockOk: true,
          tsAck: tsAck !== null && tsAck < now ? tsAck : null,
          ackUser: tsAck !== null && tsAck < now ? 'vanhanh1' : null,
          tsReturn: tsReturn !== null && tsReturn < now ? tsReturn : null,
          tsReturnAck: null,
          returnAckUser: null,
          flags: { startup: false, inputBad: false },
          closedBy: tsReturn !== null && tsReturn < now ? 'return' : null,
          state: tsReturn !== null && tsReturn < now ? 'closed' : 'active',
        });
      }
    }
  return out.sort((a, b) => b.id - a.id);
}

/** Bản ghi `logic.write*` của hôm qua và hôm nay (GET /api/v1/logic/events). */
export function reportLogicEvents(now = Date.now()) {
  const out = [];
  let id = 1;
  const rules = ['bom1_bat_muc_thap', 'bom1_tat_muc_cao', 'quat_thong_gio'];
  for (const d0 of [dayStart(now) - 24 * H, dayStart(now)])
    for (let h = 0; h < 24; h += 1) {
      const ts = d0 + h * H + 17 * 60_000;
      if (ts >= now) continue;
      const rule = rules[h % 3];
      const kind = h % 7 === 3 ? 'failed' : h % 9 === 5 ? 'suppressed' : 'ok';
      out.push({
        id: id++,
        ts,
        rule,
        action: kind === 'suppressed' ? 'logic.write.suppressed' : 'logic.write',
        tag: rule === 'quat_thong_gio' ? 'FAN1.CMD' : 'PUMP1.CMD',
        result: kind === 'suppressed' ? 'denied' : kind,
        code: kind === 'failed' ? 'TIMEOUT' : null,
        detail: JSON.stringify({ value: h % 2 === 0 }),
      });
    }
  return out;
}
