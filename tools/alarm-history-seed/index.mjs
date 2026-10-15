// Nạp dữ liệu thử cho kịch bản lịch sử alarm (feature 009 T096, T099, T131; SC-013):
//   node tools/alarm-history-seed/index.mjs --out <alarm.db> [--rows 100000] [--days 30] [--seed 1] [--end-ms <ms>]
//        [--manifest <file.json>]
// Sinh `alarm.db` (lược đồ 1 của core/alarm/alarm_store.cpp, đóng sạch: clean = 1) với `--rows` lần xảy ra phân bố thực tế:
// 200 alarm, 4 lớp, 5 khu vực, trải đều theo giờ trong `--days` ngày kết thúc ở `--end-ms` (mặc định: hiện tại), 70 % đã xác
// nhận, 95 % đã hết, vài alarm chập chờn. Tất định theo `--seed`. Không cần gói ngoài: dùng `node:sqlite` của Node >= 22.13.
// Bản kê (`--manifest`) ghi số dòng kỳ vọng cho các truy vấn mẫu, tính độc lập từ dữ liệu sinh ra (oracle cho tools/alarm-it).
import { writeFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alarm_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alarm_occurrence(
  id INTEGER PRIMARY KEY, alarm_id TEXT NOT NULL, fingerprint TEXT NOT NULL, ts_active_ms INTEGER NOT NULL,
  clock_ok INTEGER NOT NULL CHECK(clock_ok IN (0, 1)), ts_ack_ms INTEGER, ack_user TEXT, ts_return_ms INTEGER,
  ts_return_ack_ms INTEGER, return_ack_user TEXT, priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 4),
  class TEXT NOT NULL, area TEXT, text TEXT NOT NULL, text_fold TEXT NOT NULL, value_active REAL,
  quality_active TEXT NOT NULL CHECK(quality_active IN ('GOOD', 'UNCERTAIN', 'BAD')), reason TEXT,
  flags INTEGER NOT NULL DEFAULT 0 CHECK(flags BETWEEN 0 AND 3), repeat_count INTEGER NOT NULL DEFAULT 1 CHECK(repeat_count >= 1),
  closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0, 1)),
  closed_by TEXT CHECK(closed_by IS NULL OR closed_by IN ('return', 'config', 'disabled', 'restart-lost')),
  CHECK((closed = 0) = (closed_by IS NULL)));
CREATE INDEX IF NOT EXISTS alarm_occ_ts ON alarm_occurrence(ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_alarm_ts ON alarm_occurrence(alarm_id, ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_prio_ts ON alarm_occurrence(priority, ts_active_ms);
CREATE INDEX IF NOT EXISTS alarm_occ_open ON alarm_occurrence(alarm_id) WHERE closed = 0;
CREATE TABLE IF NOT EXISTS alarm_override(
  alarm_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('shelve', 'disable')), user TEXT NOT NULL, reason TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0 CHECK(system IN (0, 1)), ts_start_ms INTEGER NOT NULL, clock_ok INTEGER NOT NULL CHECK(clock_ok IN (0, 1)),
  ts_end_ms INTEGER, PRIMARY KEY(alarm_id, kind), CHECK((kind = 'shelve') = (ts_end_ms IS NOT NULL))) WITHOUT ROWID;
`;

export const CLASSES = [
  { id: 'critical', priority: 1, share: 0.1 },
  { id: 'major', priority: 2, share: 0.25 },
  { id: 'minor', priority: 3, share: 0.4 },
  { id: 'advisory', priority: 4, share: 0.25 },
];
export const AREAS = [
  { id: 'bon', name: 'Bồn' },
  { id: 'bom', name: 'Bơm' },
  { id: 'dien', name: 'Điện' },
  { id: 'nhiet', name: 'Nhiệt' },
  { id: null, name: 'Chung' },
];
const PHRASES = [
  'Mức bồn quá cao',
  'Áp suất đường ống vượt ngưỡng',
  'Nhiệt độ nồi hơi cao',
  'Bơm báo lỗi quá tải',
  'Mất tín hiệu cảm biến',
  'Rò rỉ nước khu vực',
  'Điện áp thấp',
  'Dừng khẩn cấp được nhấn',
];

/** Giống foldText của core/alarm: hạ chữ, bỏ dấu tiếng Việt. */
export function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedAlarmDb({
  out,
  rows = 100000,
  days = 30,
  seed = 1,
  endMs = Date.now(),
  manifest,
} = {}) {
  const rand = rng(seed);
  for (const suffix of ['', '-wal', '-shm']) rmSync(out + suffix, { force: true });
  const db = new DatabaseSync(out);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;');
  db.exec(SCHEMA);
  // 200 alarm: lớp theo `share`, khu vực đều, một số ít (6 %) chập chờn có tỷ trọng lớn.
  const alarms = [];
  for (let i = 1; i <= 200; i++) {
    const r = rand();
    let acc = 0;
    let cls = CLASSES.at(-1);
    for (const c of CLASSES) {
      acc += c.share;
      if (r < acc) {
        cls = c;
        break;
      }
    }
    const area = AREAS[Math.floor(rand() * AREAS.length)];
    const phrase = PHRASES[Math.floor(rand() * PHRASES.length)];
    alarms.push({
      id: `ALM_${String(i).padStart(3, '0')}`,
      cls,
      area,
      phrase,
      weight: i % 17 === 0 ? 8 : 1,
      fp: (0x9e3779b97f4a7c15n * BigInt(i)).toString(16).slice(0, 16).padEnd(16, '0'),
    });
  }
  const weights = alarms.map((a) => a.weight);
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = rand() * total;
    for (let i = 0; i < alarms.length; i++) {
      r -= weights[i];
      if (r < 0) return alarms[i];
    }
    return alarms.at(-1);
  };
  const spanMs = days * 86400000;
  const startMs = endMs - spanMs;
  const users = ['vh1', 'vh2', 'vh3'];
  const ins = db.prepare(
    `INSERT INTO alarm_occurrence(id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, ack_user, ts_return_ms,
      ts_return_ack_ms, return_ack_user, priority, class, area, text, text_fold, value_active, quality_active, reason, flags,
      repeat_count, closed, closed_by) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  );
  // ts tăng theo id (mã tăng theo thời điểm bật, FR-024)
  const stamps = Array.from({ length: rows }, () => startMs + Math.floor(rand() * spanMs)).sort(
    (a, b) => a - b,
  );
  const data = [];
  db.exec('BEGIN');
  for (let n = 0; n < rows; n++) {
    const id = n + 1;
    const a = pick();
    const ts = stamps[n];
    const value = Math.round(rand() * 1000) / 10;
    const text = `${a.phrase}: ${value} (${a.id})`;
    const isLast = n >= rows - 150; // 150 lần xảy ra cuối còn mở
    const closed = isLast && rand() < 0.5 ? 0 : 1;
    const acked = rand() < 0.7;
    const tsAck = acked ? ts + 2000 + Math.floor(rand() * 120000) : null;
    const tsRet = closed ? ts + 5000 + Math.floor(rand() * 600000) : null;
    const ackUser = acked ? users[Math.floor(rand() * users.length)] : null;
    const tsRetAck = closed && a.cls.priority <= 2 && acked ? tsRet + 3000 : null;
    const quality = rand() < 0.05 ? 'BAD' : 'GOOD';
    const row = [
      id,
      a.id,
      a.fp,
      ts,
      tsAck,
      ackUser,
      tsRet,
      tsRetAck,
      tsRetAck ? ackUser : null,
      a.cls.priority,
      a.cls.id,
      a.area.id,
      text,
      fold(`${text} ${a.id} ${a.area.name}`),
      value,
      quality,
      quality === 'BAD' ? 'TIMEOUT' : null,
      0,
      closed,
      closed ? 'return' : null,
    ];
    ins.run(...row);
    data.push({
      id,
      alarmId: a.id,
      ts,
      priority: a.cls.priority,
      cls: a.cls.id,
      area: a.area.id,
      areaName: a.area.name,
      text,
      closed,
      acked,
      fold: row[13],
    });
  }
  db.exec('COMMIT');
  const high = rows;
  db.prepare('INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?, ?)').run('schema', '1');
  db.prepare('INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?, ?)').run('clean', '1');
  db.prepare('INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?, ?)').run(
    'high_water',
    String(high),
  );
  db.prepare('INSERT OR REPLACE INTO alarm_meta(key, value) VALUES(?, ?)').run(
    'created_ms',
    String(startMs),
  );
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();

  // Oracle: số dòng kỳ vọng của các truy vấn mẫu, tính từ dữ liệu sinh ra.
  const dayMs = 86400000;
  const from7 = endMs - 7 * dayMs;
  const sel = (f) => data.filter(f).length;
  const queries = {
    total: rows,
    last24h: sel((d) => d.ts >= endMs - dayMs),
    last7d: sel((d) => d.ts >= from7),
    filter7dAreaBonPrioMajor: sel((d) => d.ts >= from7 && d.area === 'bon' && d.priority <= 2),
    filter7dAreaNoneMinor: sel((d) => d.ts >= from7 && d.area === null && d.priority <= 3),
    state7dActive: sel((d) => d.ts >= from7 && d.closed === 0),
    state30dAcked: sel((d) => d.acked),
    search30dRoRiNuoc: sel((d) => d.fold.includes('ro ri nuoc')),
    search30dApSuat: sel((d) => d.fold.includes('ap suat')),
    search30dBonCaoNoDiacritics: sel((d) => d.fold.includes('bon qua cao')),
  };
  const info = { out, rows, days, seed, endMs, startMs, alarms: alarms.length, queries };
  if (manifest) writeFileSync(manifest, JSON.stringify(info, null, 2) + '\n');
  return info;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const out = opt('--out');
  if (!out) {
    console.error(
      'Dùng: node tools/alarm-history-seed/index.mjs --out <alarm.db> [--rows 100000] [--days 30] [--seed 1] [--end-ms <ms>] [--manifest <file>]',
    );
    process.exit(2);
  }
  const t0 = Date.now();
  const info = seedAlarmDb({
    out,
    rows: Number(opt('--rows', 100000)),
    days: Number(opt('--days', 30)),
    seed: Number(opt('--seed', 1)),
    endMs: Number(opt('--end-ms', Date.now())),
    manifest: opt('--manifest'),
  });
  console.log(JSON.stringify({ ...info, seconds: (Date.now() - t0) / 1000 }));
}
