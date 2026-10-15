// Kiểm bucket THẬT trong history.db (do historian_tool fill-agg hoặc runtime ghi) bằng bản tham chiếu độc lập:
// dựng bucket phút/giờ từ dòng thô đã xuất (--dump của fill-agg) bằng aggregateStore (không dùng mã C++),
// rồi so từng bucket với mat_agg (SC-003, T048). Cần Node >= 22.13 (node:sqlite).
//
//   node tools/history-ref/verify-db.mjs --db <history.db> --dump <dump.csv> --table bench --tags 24 \
//        --gap-ms 300000 --end-ms <endMs> [--period 30000] [--limit-cols 4]
//
// Dòng đầu ra: một dòng JSON { buckets, mismatches, missing, extra, ... }; mã thoát 0 khi 0 sai khác.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { aggregateStore, HOUR_MS, MIN_MS } from './ref.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const dbPath = arg('db');
const dumpPath = arg('dump');
const table = arg('table', 'bench');
const tags = Number(arg('tags', '24'));
const gapMs = Number(arg('gap-ms', '300000'));
const endMs = Number(arg('end-ms', '0'));
const limitCols = Number(arg('limit-cols', String(tags)));
if (!dbPath || !dumpPath || !endMs) {
  console.error('cần --db, --dump, --end-ms');
  process.exit(2);
}

const lines = readFileSync(dumpPath, 'utf8').split('\n').filter(Boolean);
const rows = lines.map((l) => l.split(',').map(Number));
const colName = (k) => `${k % 20 === 19 ? 'S' : 'T'}${String(k + 1).padStart(4, '0')}`;

const db = new DatabaseSync(dbPath, { readOnly: true });
const cids = new Map(
  db
    .prepare('SELECT col, cid FROM mat_agg_cols WHERE tbl = ?')
    .all(table)
    .map((r) => [r.col, Number(r.cid)]),
);
const stmt = db.prepare(
  'SELECT bucket, n, min, COALESCE(max, min) AS max, COALESCE(first, min) AS first, COALESCE(last, min) AS last, sumw, wms FROM mat_agg WHERE cid = ? AND res = ? ORDER BY bucket',
);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

let buckets = 0;
let mismatches = 0;
let missing = 0;
let extra = 0;
const examples = [];
for (let k = 0; k < limitCols; k++) {
  const col = colName(k);
  const events = [{ t: rows[0][0], op: 'break' }];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i][0];
    if (i > 0 && t - rows[i - 1][0] > gapMs) events.push({ t: rows[i - 1][0], op: 'break' });
    events.push({ t, op: 'row', values: { [col]: rows[i][k + 1] } });
  }
  events.push({ t: endMs, op: 'break' });
  const want = aggregateStore(events, col);
  for (const res of [MIN_MS, HOUR_MS]) {
    const got = new Map(stmt.all(cids.get(col), res).map((r) => [Number(r.bucket), r]));
    const wantMap = new Map(want[res].map((b) => [b.bucket, b]));
    for (const [bucket, w] of wantMap) {
      buckets++;
      const g = got.get(bucket);
      if (!g) {
        missing++;
        if (examples.length < 10) examples.push({ col, res, bucket, kind: 'missing' });
        continue;
      }
      const bad =
        Number(g.n) !== w.n ||
        Number(g.wms) !== w.wms ||
        !near(g.min, w.min) ||
        !near(g.max, w.max) ||
        !near(g.first, w.first) ||
        !near(g.last, w.last) ||
        !near(g.sumw, w.sumw);
      if (bad) {
        mismatches++;
        if (examples.length < 10)
          examples.push({ col, res, bucket, kind: 'mismatch', got: g, want: w });
      }
    }
    for (const bucket of got.keys()) {
      if (bucket >= endMs) continue; // dòng và bucket do Historian ghi sau khi dữ liệu mô phỏng kết thúc
      if (res === HOUR_MS && bucket + HOUR_MS > endMs) continue; // giờ cuối chưa tròn: runtime vẫn ghi hàng một phần
      if (!wantMap.has(bucket)) {
        extra++;
        if (examples.length < 10) examples.push({ col, res, bucket, kind: 'extra' });
      }
    }
  }
}
const out = { buckets, mismatches, missing, extra, columns: limitCols, examples };
console.log(JSON.stringify(out));
process.exit(mismatches + missing + extra === 0 ? 0 : 1);
