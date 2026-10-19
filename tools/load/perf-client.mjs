// Phần chạy TRONG container client của rig tests/web-it/compose.yaml cho phép đo T055 (012) và T032 (013); điều phối:
// tools/load/perf012-013.mjs. Container client chung PID namespace với rt nên đọc được /proc của mat-runtime.
//   node perf-client.mjs sample --seconds N [--interval 1]      CPU (% một lõi), RSS, byte gửi của mat-runtime
//   node perf-client.mjs setup --fp <fp>                          nhóm, nhóm của u01..u10 (MAT_PERF_PW_ADMIN)
//   node perf-client.mjs rules --fp <fp> --mode set|clear         đặt / gỡ mọi quy tắc của kịch bản
//   node perf-client.mjs sessions --fp <fp> --out <tệp>           đăng nhập u01..u10 (MAT_PERF_PW), ghi Cookie
//   node perf-client.mjs change --fp <fp> --n 5 --gap-ms 6000     đổi một quy tắc n lần, in giờ gửi (ms UTC)
//   node perf-client.mjs cost --fp <fp> --n 300                   chi phí GET /api/v1/web/access (so GET web/session)
// Mỗi lệnh in đúng một dòng JSON. Mật khẩu chỉ qua biến môi trường (docker exec -e), không ghi tệp.
import https from 'node:https';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Web, sleep } from '../../tests/web-it/lib/api.mjs';
import { GROUPS, USERS, iid, rules, sid } from './perf-users.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const fp = opt('--fp', '');
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (v, p) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const median = (v) => pct(v, 50);

async function admin(w) {
  const r = await w.login('admin', process.env.MAT_PERF_PW_ADMIN);
  if (!r.session) throw new Error(`admin login ${r.status} ${r.body}`);
  return r.session;
}
const get = (w, s, p) => w.request('GET', p, { s, h: { 'Sec-Fetch-Site': 'same-origin' } });
const post = (w, s, p, b) => w.request('POST', p, { s, body: JSON.stringify(b) });

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/cmdline`, 'utf8').startsWith('/build/x64/bin/mat-runtime'))
        return Number(d);
    } catch {
      // đã thoát
    }
  }
  return 0;
}
function readProc(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const cpu = (Number(f[11]) + Number(f[12])) / 100;
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
  // byte gửi qua mọi card trừ lo (namespace mạng của rt, đọc qua /proc/<pid>/net/dev)
  let tx = 0;
  for (const l of readFileSync(`/proc/${pid}/net/dev`, 'utf8').split('\n').slice(2)) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(l);
    if (m && m[1].trim() !== 'lo') tx += Number(m[2].trim().split(/\s+/)[8]);
  }
  return { cpu, rss, tx, t: Date.now() };
}

async function sample() {
  const seconds = Number(opt('--seconds', '60'));
  const interval = Number(opt('--interval', '1')) * 1000;
  const pid = runtimePid();
  if (!pid) return { error: 'không thấy mat-runtime' };
  const s = [readProc(pid)];
  const end = s[0].t + seconds * 1000;
  while (Date.now() < end) {
    await sleep(Math.min(interval, Math.max(0, end - Date.now())));
    s.push(readProc(pid));
  }
  const a = s[0];
  const b = s.at(-1);
  const wall = (b.t - a.t) / 1000;
  const win = [];
  for (let i = 1; i < s.length; i++)
    win.push(((s[i].cpu - s[i - 1].cpu) / ((s[i].t - s[i - 1].t) / 1000)) * 100);
  const rss = s.map((x) => x.rss);
  return {
    pid,
    samples: s.length,
    wallSeconds: r1(wall),
    cpuAvgPct: Math.round(((b.cpu - a.cpu) / wall) * 1000) / 10,
    cpuP95Pct: r1(pct(win, 95)),
    cpuMaxPct: r1(Math.max(...win)),
    cpuSeconds: Math.round((b.cpu - a.cpu) * 100) / 100,
    rssAvgMB: r1(rss.reduce((x, y) => x + y, 0) / rss.length),
    rssMaxMB: r1(Math.max(...rss)),
    txBytesPerS: Math.round((b.tx - a.tx) / wall),
  };
}

async function setup() {
  const w = new Web(fp);
  const A = await admin(w);
  let rev = (await get(w, A, '/api/v1/admin/groups')).json?.rev ?? 0;
  for (const [id, name] of GROUPS) {
    const r = await post(w, A, '/api/v1/admin/groups', { rev, id, name });
    if (r.status === 201) rev = r.json.rev;
    else if (r.json?.error === 'EXISTS') rev = (await get(w, A, '/api/v1/admin/groups')).json.rev;
    else throw new Error(`group ${id}: ${r.status} ${r.body}`);
  }
  for (const u of USERS) {
    if (!u.groups.length) continue;
    const urev = (await get(w, A, '/api/v1/admin/users')).json.rev;
    const g = await post(w, A, `/api/v1/admin/users/${u.name}`, { rev: urev, groups: u.groups });
    if (g.status !== 200) throw new Error(`${u.name} groups: ${g.status} ${g.body}`);
  }
  return { ok: true, groups: GROUPS.length };
}

async function setRules() {
  const w = new Web(fp);
  const A = await admin(w);
  const acc = (await get(w, A, '/api/v1/admin/access')).json;
  const set =
    opt('--mode', 'set') === 'set'
      ? rules()
      : (acc?.rules ?? []).map((r) => ({ resource: r.resource, level: r.level, grantees: null }));
  if (!set.length) return { ok: true, rules: 0 };
  const r = await post(w, A, '/api/v1/admin/access', { rev: acc.rev, set });
  if (r.status !== 200) throw new Error(`rules: ${r.status} ${r.body}`);
  const after = (await get(w, A, '/api/v1/admin/access')).json;
  return { ok: true, rules: after?.rules?.length ?? null, rev: after?.rev };
}

async function sessions() {
  const w = new Web(fp);
  const lines = [];
  for (const u of USERS) {
    const r = await w.login(u.name, process.env.MAT_PERF_PW);
    if (!r.session) throw new Error(`login ${u.name}: ${r.status} ${r.body}`);
    lines.push(`__Host-mat_sid=${r.session.cookie}`);
  }
  writeFileSync(opt('--out', '/tmp/cookies.txt'), `${lines.join('\n')}\n`, { mode: 0o600 });
  return { ok: true, sessions: lines.length };
}

// Đổi quyền của ca-b (u04..u06) trên item perf-01/i10: thêm rồi bỏ group:ca-b, n lần; mỗi lần ghi giờ gửi (ms UTC,
// cùng đồng hồ với load-tester trong container này) và thời gian trả lời POST.
async function change() {
  const n = Number(opt('--n', '5'));
  const gap = Number(opt('--gap-ms', '6000'));
  const w = new Web(fp);
  const A = await admin(w);
  const out = [];
  for (let k = 0; k < n; k++) {
    const acc = (await get(w, A, '/api/v1/admin/access')).json;
    const grantees =
      k % 2 === 0 ? ['user:u01', 'group:bao-tri', 'group:ca-b'] : ['user:u01', 'group:bao-tri'];
    const t0 = Date.now();
    const r = await post(w, A, '/api/v1/admin/access', {
      rev: acc.rev,
      set: [{ resource: `item:${sid(1)}/${iid(10)}`, level: 'view', grantees }],
    });
    out.push({ sentAtMs: t0, postMs: Date.now() - t0, status: r.status });
    await sleep(gap);
  }
  return { ok: out.every((x) => x.status === 200), changes: out, affected: ['u04', 'u05', 'u06'] };
}

// Gọi GET qua MỘT kết nối TLS giữ sống (như trang), ghim fingerprint trên chứng chỉ của kết nối đó.
function keepAliveClient() {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });
  const want = fp.toLowerCase();
  return (path, cookie) =>
    new Promise((resolve, reject) => {
      const t0 = process.hrtime.bigint();
      const req = https.request(
        {
          host: 'rt',
          port: 8443,
          path,
          method: 'GET',
          agent,
          headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
        },
        (res) => {
          const got = res.socket
            .getPeerCertificate()
            ?.fingerprint256?.replace(/:/g, '')
            .toLowerCase();
          if (got !== want) reject(new Error('fingerprint'));
          let n = 0;
          res.on('data', (c) => (n += c.length));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              bytes: n,
              ms: Number(process.hrtime.bigint() - t0) / 1e6,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
}

async function cost() {
  const n = Number(opt('--n', '300'));
  const w = new Web(fp);
  const pid = runtimePid();
  const out = {};
  const cookies = [];
  for (const u of USERS) {
    const r = await w.login(u.name, process.env.MAT_PERF_PW);
    if (!r.session) throw new Error(`login ${u.name}: ${r.status}`);
    cookies.push(`__Host-mat_sid=${r.session.cookie}`);
  }
  await sleep(2000); // đăng nhập (Argon2) xong hẳn
  for (const path of ['/api/v1/web/session', '/api/v1/web/access']) {
    const call = keepAliveClient();
    await call(path, cookies[0]); // mở kết nối
    const lat = [];
    let bytes = 0;
    let bad = 0;
    const c0 = readProc(pid).cpu;
    const t0 = Date.now();
    for (let k = 0; k < n; k++) {
      const r = await call(path, cookies[k % cookies.length]);
      lat.push(r.ms);
      bytes = Math.max(bytes, r.bytes);
      if (r.status !== 200) bad++;
    }
    const cpuS = readProc(pid).cpu - c0;
    out[path] = {
      calls: n,
      non200: bad,
      p50Ms: Math.round(median(lat) * 100) / 100,
      p95Ms: Math.round(pct(lat, 95) * 100) / 100,
      maxMs: Math.round(Math.max(...lat) * 100) / 100,
      maxBodyBytes: bytes,
      runtimeCpuMsPerCall: Math.round(((cpuS * 1000) / n) * 100) / 100,
      wallS: r1((Date.now() - t0) / 1000),
    };
  }
  return out;
}

const run = { sample, setup, rules: setRules, sessions, change, cost }[cmd];
if (!run) {
  console.error('lệnh: sample | setup | rules | sessions | change | cost');
  process.exit(2);
}
try {
  console.log(JSON.stringify(await run()));
} catch (e) {
  console.log(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
}
