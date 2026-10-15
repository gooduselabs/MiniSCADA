// Client của kịch bản history-api (feature 010, T071, T073): đăng nhập Bearer qua HTTPS, kiểm API lịch sử trên
// runtime x64 với DB dựng sẵn (nhóm `bench`, tools/bench-project.mjs + historian_tool fill-agg), chạy bộ tấn công
// SC-010, giới hạn tải và đo p50/p95. In đúng một dòng JSON { scenario, checks, measures, pass }.
//   MAT_IT_PW=... node tests/web-it/history-api.mjs --base https://localhost:18443 --user xem1 [--runs 20] [--tags 8]
// Không phụ thuộc: chỉ dùng module có sẵn của Node.
import https from 'node:https';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const base = new URL(opt('--base', 'https://localhost:18443'));
const user = opt('--user', 'xem1');
const password = process.env.MAT_IT_PW ?? '';
const runs = Number(opt('--runs', '20'));
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false }); // chứng chỉ tự ký của thiết bị thử

const checks = [];
const measures = {};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  return Boolean(pass);
};

function call(path, { token, method = 'GET', body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(
      {
        host: base.hostname,
        port: base.port,
        path,
        method,
        agent,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const ms = performance.now() - t0;
          let json;
          if (!raw) {
            try {
              json = JSON.parse(buf.toString('utf8'));
            } catch {
              json = undefined;
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, json, buf, ms });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const r = await call('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (r.status !== 200) throw new Error(`đăng nhập ${user}: ${r.status}`);
  return r.json.token;
}

const q = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))).toString();
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const round = (x) => Math.round(x * 10) / 10;

async function measure(name, token, path) {
  const ms = [];
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const r = await call(path, { token, raw: path.includes('export.csv') });
    status = r.status;
    if (r.status === 200) ms.push(r.ms);
    await new Promise((res) => setTimeout(res, 150)); // không chạm giới hạn 1 yêu cầu mỗi phiên
  }
  measures[name] = { status, runs: ms.length, p50Ms: round(pct(ms, 50)), p95Ms: round(pct(ms, 95)), maxMs: round(Math.max(...ms, 0)) };
  return measures[name];
}

async function main() {
  const token = await login();
  const cat = await call('/api/v1/history/catalog', { token });
  check('catalog: 200 và có nhóm bench', cat.status === 200 && cat.json.groups.some((g) => g.id === 'bench'), cat.status);
  const g = cat.json.groups.find((x) => x.id === 'bench');
  if (!g) return;
  check('catalog: không có tên bảng, đường dẫn hay SQL', !/log_|history\.db|mat_agg|sqlite|\/var\//i.test(JSON.stringify(cat.json)), '');
  const to = g.raw.to;
  const day = 86400000;
  const tags = g.tags.filter((t) => t.aggregated).slice(0, Number(opt('--tags', '8'))).map((t) => t.tagId);
  const tags16 = g.tags.filter((t) => t.aggregated).slice(0, 16).map((t) => t.tagId);
  check('catalog: raw và aggregates có khoảng', g.raw && g.aggregates && g.aggregates.minute && g.aggregates.hour, JSON.stringify(g.raw));

  // đúng đắn
  const s24 = await call(`/api/v1/history/series?${q({ group: 'bench', tags: tags.join(','), from: to - day, to, maxPoints: 1000 })}`, { token });
  check('series 24 giờ 8 đường auto: 200, nguồn tổng hợp, ≤ maxPoints', s24.status === 200 && s24.json.res !== 'raw' && s24.json.series.every((s) => s.t.length <= 1000), `${s24.status} ${s24.json?.res}`);
  check('series: min ≤ avg ≤ max ở mọi điểm', s24.status === 200 && s24.json.series.every((s) => s.v.every((v, i) => v === null || (s.min[i] <= v + 1e-9 && v <= s.max[i] + 1e-9))), '');
  const raw1h = await call(`/api/v1/history/series?${q({ group: 'bench', tags: tags16.join(','), from: to - 3600000, to, maxPoints: 1000, res: 'raw' })}`, { token });
  check('series thô 1 giờ 16 đường: 200, reduce minmax', raw1h.status === 200 && raw1h.json.reduce === 'minmax', raw1h.status);
  const big = await call(`/api/v1/history/series?${q({ group: 'bench', tags: tags16.join(','), from: to - 7 * day, to, res: 'raw' })}`, { token });
  check('series thô 7 ngày 16 đường: 422 SCAN_LIMIT trước khi quét', big.status === 422 && big.json?.error === 'SCAN_LIMIT' && big.ms < 500, `${big.status} ${big.ms.toFixed(0)} ms`);
  const wk = await call(`/api/v1/history/series?${q({ group: 'bench', tags: tags.join(','), from: to - 7 * day, to })}`, { token });
  check('series 7 ngày auto: 200 từ bảng tổng hợp', wk.status === 200 && wk.json.res !== 'raw', `${wk.status} ${wk.json?.res}`);
  const agg = await call(`/api/v1/history/aggregate?${q({ group: 'bench', tags: tags.join(','), from: to - 7 * day, to, bucketMs: 8 * 3600000 })}`, { token });
  check('aggregate cửa sổ 8 giờ: 200, count ≤ 5000', agg.status === 200 && agg.json.count <= 5000 && agg.json.series.length === tags.length, agg.status);
  let after;
  let rowsSeen = 0;
  let dup = false;
  const seen = new Set();
  for (let p = 0; p < 3; p++) {
    const r = await call(`/api/v1/history/rows?${q({ group: 'bench', tags: tags[0], from: to - day, to, limit: 200, order: 'asc', ...(after ? { after } : {}) })}`, { token });
    if (r.status !== 200) break;
    for (const row of r.json.rows) {
      if (seen.has(row[0])) dup = true;
      seen.add(row[0]);
      rowsSeen++;
    }
    after = r.json.next;
    if (after === null) break;
  }
  check('rows: 3 trang không trùng seq', rowsSeen === 600 && !dup, `${rowsSeen} dòng`);

  // CSV
  const csv = await call(`/api/v1/history/export.csv?${q({ group: 'bench', tags: tags16.join(','), from: g.raw.from, to: g.raw.from + 3600000, res: 'raw' })}`, { token, raw: true });
  const head = csv.buf.subarray(0, 3);
  check('export.csv: 200, BOM UTF-8, text/csv, chunked', csv.status === 200 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf && /text\/csv/.test(csv.headers['content-type']) && csv.headers['transfer-encoding'] === 'chunked', csv.status);
  const lines = csv.buf.toString('utf8').split('\r\n');
  check('export.csv: dòng đầu time,<cột>, CRLF, số dòng ≈ 720', lines[0].replace('﻿', '').startsWith('time,T0001') && lines.length > 700, `${lines.length} dòng`);

  // tấn công (SC-010): tham số sai và chuỗi giống SQL, không bao giờ 5xx, không lộ bảng
  const bad = [
    `group=bench&tags=${tags[0]}&from=0&to=0`,
    `group=bench'+OR+1=1--&tags=${tags[0]}&from=${to - 1000}&to=${to}`,
    `group=bench&tags=${encodeURIComponent(tags[0] + '" OR 1=1 --')}&from=${to - 1000}&to=${to}`,
    `group=bench&tags=${tags[0]}&from=99999999999999999999&to=${to}`,
    `group=bench&tags=${tags[0]}&from=${to - 1000}&to=${to}&maxPoints=1`,
    `group=bench&tags=${tags[0]}&from=${to - 1000}&to=${to}&foo=bar`,
    `group=bench&group=bench&tags=${tags[0]}&from=${to - 1000}&to=${to}`,
    `group=bench&tags=${Array.from({ length: 20 }, (_, i) => 'X' + i).join(',')}&from=${to - 1000}&to=${to}`,
    `group=..%2F..%2Fetc%2Fpasswd&tags=a&from=1&to=2`,
    `group=bench&tags=${tags[0]}&from=${to - 1000}&to=${to}&res=1%3BDROP`,
  ];
  let attackOk = true;
  let leaks = false;
  for (const b of bad) {
    const r = await call(`/api/v1/history/series?${b}`, { token });
    if (!(r.status >= 400 && r.status < 500)) attackOk = false;
    if (/log_|mat_agg|sqlite|SELECT |\/var\/lib/i.test(r.buf.toString('utf8'))) leaks = true;
    await new Promise((res) => setTimeout(res, 50));
  }
  check('tấn công: mọi tham số sai bị 4xx, không 5xx', attackOk, '');
  check('tấn công: phản hồi lỗi không lộ tên bảng, SQL hay đường dẫn', !leaks, '');
  const noAuth = await call(`/api/v1/history/series?${q({ group: 'bench', tags: tags[0], from: to - 1000, to })}`, {});
  check('không phiên: 401', noAuth.status === 401, noAuth.status);
  const post = await call('/api/v1/history/series', { token, method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  check('POST: 405', post.status === 405, post.status);

  // giới hạn tải: nhiều phiên cùng lúc, có 429 trả lời nhanh
  const tokens = [];
  for (let i = 0; i < 6; i++) {
    tokens.push(await login());
    await new Promise((r) => setTimeout(r, 1200));
  }
  const heavy = (t) => call(`/api/v1/history/series?${q({ group: 'bench', tags: tags16.join(','), from: to - day, to, res: 'raw', maxPoints: 5000 })}`, { token: t });
  const burst = await Promise.all(tokens.map(heavy));
  const busy = burst.filter((r) => r.status === 429);
  const okN = burst.filter((r) => r.status === 200).length;
  const heavyMs = burst.filter((r) => r.status === 200).map((r) => r.ms);
  measures.burst = { sessions: tokens.length, ok: okN, busy429: busy.length, maxBusyMs: round(Math.max(...busy.map((r) => r.ms), 0)), heavyOkMaxMs: round(Math.max(...heavyMs, 0)) };
  check('6 truy vấn nặng cùng lúc: chỉ ≤ 2 chạy, còn lại 429 BUSY có Retry-After', busy.length >= 1 && okN + busy.length === 6 && busy.every((r) => r.json?.error === 'BUSY' && r.headers['retry-after']), JSON.stringify(measures.burst));
  check('429 trả lời ≤ 100 ms', busy.length > 0 && busy.every((r) => r.ms <= 100), `${measures.burst.maxBusyMs} ms`);
  const sys = await call('/api/v1/system/info', { token });
  const hq = sys.json?.historian?.query;
  check('system/info: historian.query có bộ đếm đúng', hq && hq.served > 0 && hq.rejectedBusy >= busy.length, JSON.stringify(hq));
  // FR-031: the estimate of the running configuration (estimateLogging) is there, not null
  const est = sys.json?.historian?.io?.estimateBytesPerDay;
  check('system/info: historian.io.estimateBytesPerDay là số > 0 (từ estimateLogging)', typeof est === 'number' && est > 0, String(est));

  // đo
  await measure('series24h_8lines_auto', token, `/api/v1/history/series?${q({ group: 'bench', tags: tags.join(','), from: to - day, to, maxPoints: 1000 })}`);
  await measure('series_raw1h_16lines', token, `/api/v1/history/series?${q({ group: 'bench', tags: tags16.join(','), from: to - 3600000, to, maxPoints: 1000, res: 'raw' })}`);
  await measure('series7d_8lines_auto', token, `/api/v1/history/series?${q({ group: 'bench', tags: tags.join(','), from: to - 7 * day, to })}`);
  await measure('aggregate7d_8h', token, `/api/v1/history/aggregate?${q({ group: 'bench', tags: tags.join(','), from: to - 7 * day, to, bucketMs: 8 * 3600000 })}`);
  await measure('rows_page200', token, `/api/v1/history/rows?${q({ group: 'bench', tags: tags[0], from: to - day, to, limit: 200 })}`);
  const tags50 = g.tags.slice(0, 50).map((t) => t.tagId);
  const csvT = [];
  for (let i = 0; i < 3; i++) {
    const r = await call(`/api/v1/history/export.csv?${q({ group: 'bench', tags: tags50.join(','), from: to - day, to })}`, { token, raw: true });
    csvT.push({ status: r.status, ms: round(r.ms), bytes: r.buf.length });
  }
  measures.csv24h_50tags = csvT;
  const lim = Number(opt('--budget-ms', '2000'));
  check(`series 24 giờ 8 đường auto p95 ≤ ${lim} ms (x64)`, measures.series24h_8lines_auto.p95Ms <= lim, `${measures.series24h_8lines_auto.p95Ms} ms`);
}

try {
  await main();
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario: 'history-api', checks, measures, pass }));
process.exit(0);
