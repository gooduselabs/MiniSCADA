// node --test tools/pilot/collect.test.mjs (feature 011, T189; FR-137, D38; contract test-protocols §6).
// Runs tools/pilot/collect.ps1 -Once against a fake device API (node http on 127.0.0.1, -BaseUrl override) and checks
// the JSON line: the keys of data-model §6, an audit summary of counts only, and that no Tag name, Tag value, screen or
// project name, nor the password reaches the file or the output. Skipped when PowerShell 7 (pwsh) is not installed.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'tools/pilot/collect.ps1');

function findPwsh() {
  for (const p of [process.env.PWSH, join(homedir(), '.local/bin/pwsh'), 'pwsh']) {
    if (!p) continue;
    const r = spawnSync(p, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf8',
    });
    if (r.status === 0) return p;
  }
  return null;
}
const pwsh = findPwsh();
const skip = pwsh ? false : 'pwsh không có trên máy này';

const PASSWORD = 'mk-Bi-Mat-9f3!';
const SECRETS = [
  'TANK01',
  'LEVEL',
  '42.75',
  '1337.5',
  'Bơm nước thải',
  'man-hinh-chinh',
  'tank-demo',
  PASSWORD,
];

const systemInfo = {
  runtimeVersion: '1.0.0-rc.1',
  releaseSeq: 11,
  bootId: '0f4c3a2e-boot',
  protocolVersion: '1.1.0',
  timeSynced: true,
  project: {
    status: 'active',
    projectId: 'tank-demo',
    projectName: 'Bơm nước thải',
    digest: 'sha256:abc',
    errors: [],
    screens: ['man-hinh-chinh'],
  },
  device: { deviceId: 'd-1', name: 'BL335-01', model: 'BL335', httpsPort: 8443, https: 'ok' },
  warnings: [
    { code: 'TIME_NOT_SYNCED', message: 'Đồng hồ chưa đồng bộ', since: 1, detail: null },
    {
      code: 'PULSE_STUCK',
      message: 'Bit xung TANK01.LEVEL kẹt',
      since: 2,
      detail: { tag: 'TANK01.LEVEL', value: 42.75 },
    },
  ],
  operation: null,
};
const diagnostics = {
  at: 1791601205000,
  timeSynced: true,
  cpu: { systemPct1m: 11.7, runtimePct1m: 4.2 },
  memory: { runtimeRssBytes: 43200000 },
  uptime: { systemS: 123456, runtimeS: 3600 },
  clients: { live: 3, max: 10, sessions: 1 },
  uptimeS: 3600,
  restarts: {
    total: 2,
    lastReason: 'crash',
    lastAt: '2026-11-02T10:01:00Z',
    bootChanged: true,
    note: 'TANK01.LEVEL',
  },
  rssMb: 41.2,
  rssPeakMb: 48.9,
  cpuPct: 11.4,
  fdCount: 63,
  threads: 31,
  ioWriteBytesToday: {
    total: 183500000,
    history: 120000000,
    audit: 3000000,
    log: null,
    other: 45500000,
  },
  ioWriteSource: 'proc-self-io',
  emmcLife: { typeA: 1, typeB: 2, preEol: 1, source: 'sysfs' },
  liveLagP95Ms: 120,
  drivers: [{ channel: 'plc1', lastTag: 'TANK01.LEVEL', lastValue: 1337.5 }],
};
const auditRecords = [
  {
    id: 9,
    ts: 1,
    action: 'tag.write',
    target: 'TANK01.LEVEL',
    detail: { old: 42.75, new: 1337.5 },
    user: 'vh1',
  },
  {
    id: 8,
    ts: 1,
    action: 'tag.write',
    target: 'TANK01.LEVEL',
    detail: { old: 1, new: 2 },
    user: 'vh1',
  },
  { id: 7, ts: 1, action: 'auth.login', target: null, detail: null, user: 'viewer1' },
];

let server;
let base;
let mode = { login: 'ok', audit: 'ok' };
const requests = [];
const tmp = mkdtempSync(join(tmpdir(), 'pilot-collect-'));

function handler(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    requests.push({
      method: req.method,
      path: url.pathname,
      query: url.search,
      auth: req.headers.authorization ?? null,
      body,
    });
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    const authed = req.headers.authorization === 'Bearer mats_test';
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
      const b = JSON.parse(body || '{}');
      if (mode.login === 'ok' && b.user === 'viewer1' && b.password === PASSWORD)
        return send(200, {
          token: 'mats_test',
          user: 'viewer1',
          role: 'viewer',
          idleTimeoutS: 1800,
        });
      return send(401, { error: 'AUTH_FAILED' });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout')
      return send(authed ? 204 : 401);
    if (req.method === 'GET' && url.pathname === '/api/v1/system/info')
      return send(200, systemInfo);
    if (!authed) return send(401, { error: 'AUTH_REQUIRED' });
    if (req.method === 'GET' && url.pathname === '/api/v1/diagnostics')
      return send(200, diagnostics);
    if (req.method === 'GET' && url.pathname === '/api/v1/audit') {
      if (mode.audit === 'forbidden') return send(403, { error: 'FORBIDDEN' });
      // two pages: before= absent -> first two records, next = 7
      if (!url.searchParams.get('before'))
        return send(200, { records: auditRecords.slice(0, 2), next: 7 });
      return send(200, { records: auditRecords.slice(2), next: null });
    }
    send(404, { error: 'NOT_FOUND' });
  });
}

// HTTPS (rà soát T062 F2): hai chứng chỉ tự ký; máy chủ đóng kết nối sau mỗi response nên mỗi request là một kết nối
// TLS mới, và `swapAfter` request thì đổi sang chứng chỉ thứ hai (thiết bị bị thay giữa chừng).
function makeCert(dir, name) {
  const key = join(dir, `${name}.key.pem`);
  const cert = join(dir, `${name}.crt.pem`);
  const r = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
let tls = null;
let httpsServer;
let httpsBase;
let httpsCount = 0;
let swapAfter = Infinity;

before(async () => {
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = makeCert(tmp, 'a');
  const b = a && makeCert(tmp, 'b');
  if (a && b) {
    tls = { a, b, fpA: new X509Certificate(a.cert).fingerprint256 };
    httpsServer = createHttpsServer({ key: a.key, cert: a.cert }, (req, res) => {
      res.setHeader('connection', 'close');
      httpsCount += 1;
      if (httpsCount === swapAfter) httpsServer.setSecureContext({ key: b.key, cert: b.cert });
      handler(req, res);
    });
    await new Promise((r) => httpsServer.listen(0, '127.0.0.1', r));
    httpsBase = `https://127.0.0.1:${httpsServer.address().port}`;
  }
});
after(() => {
  server?.close();
  httpsServer?.close();
  rmSync(tmp, { recursive: true, force: true });
});

function run(outDir, extra = [], env = {}, url = null) {
  return new Promise((resolveRun) => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-Site',
      'lab',
      '-Device',
      '127.0.0.1',
    ];
    args.push('-User', 'viewer1', '-BaseUrl', url ?? base, '-OutDir', outDir, '-Once', ...extra);
    const p = spawn(pwsh, args, { env: { ...process.env, MAT_PILOT_PASSWORD: PASSWORD, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolveRun({ code, out }));
  });
}

function lines(outDir) {
  const dir = join(outDir, 'lab');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir);
  assert.equal(files.length, 1, `một tệp mỗi ngày: ${files}`);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  return readFileSync(join(dir, files[0]), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ raw: l, obj: JSON.parse(l) }));
}

test(
  'collect.ps1 -Once: một dòng JSON đúng dạng data-model §6, tóm tắt audit chỉ có số đếm',
  { skip },
  async () => {
    mode = { login: 'ok', audit: 'ok' };
    requests.length = 0;
    const outDir = join(tmp, 'ok');
    const r = await run(outDir);
    assert.equal(r.code, 0, r.out);
    const ls = lines(outDir);
    assert.equal(ls.length, 1);
    const { raw, obj } = ls[0];
    assert.deepEqual(Object.keys(obj), ['t', 'site', 'info', 'diag', 'audit']);
    assert.match(obj.t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
    assert.equal(obj.site, 'lab');
    assert.deepEqual(obj.info, {
      version: '1.0.0-rc.1',
      releaseSeq: 11,
      bootId: '0f4c3a2e-boot',
      uptimeS: 3600,
      warnings: ['TIME_NOT_SYNCED', 'PULSE_STUCK'],
    });
    assert.deepEqual(obj.diag, {
      restarts: {
        total: 2,
        lastReason: 'crash',
        lastAt: '2026-11-02T10:01:00Z',
        bootChanged: true,
      },
      rssMb: 41.2,
      cpuPct: 11.4,
      fdCount: 63,
      ioWriteBytesToday: {
        total: 183500000,
        history: 120000000,
        audit: 3000000,
        log: null,
        other: 45500000,
      },
      emmcLife: { typeA: 1, typeB: 2, preEol: 1 },
      liveLagP95Ms: 120,
      clients: 3,
      timeSynced: true,
    });
    assert.deepEqual(obj.audit.counts, { 'auth.login': 1, 'tag.write': 2 });
    assert.equal(obj.audit.total, 3);
    assert.ok(Number.isInteger(obj.audit.from) && obj.audit.to - obj.audit.from === 3_600_000);
    for (const s of SECRETS) {
      assert.ok(!raw.includes(s), `dòng thu chứa "${s}"`);
      assert.ok(!r.out.includes(s), `đầu ra chứa "${s}"`);
    }
    // Bearer on the protected reads; the audit pages followed `next`; the session is closed at the end.
    const paths = requests.map((q) => `${q.method} ${q.path}`);
    assert.ok(
      paths.indexOf('POST /api/v1/auth/login') < paths.indexOf('GET /api/v1/diagnostics'),
      paths.join(', '),
    );
    assert.equal(paths.filter((p) => p === 'POST /api/v1/auth/login').length, 1);
    assert.ok(
      requests
        .filter((q) => q.path === '/api/v1/diagnostics')
        .every((q) => q.auth === 'Bearer mats_test'),
    );
    assert.equal(requests.filter((q) => q.path === '/api/v1/audit').length, 2);
    assert.match(requests.filter((q) => q.path === '/api/v1/audit')[1].query, /before=7/);
    assert.equal(paths[paths.length - 1], 'POST /api/v1/auth/logout');
  },
);

test(
  'collect.ps1: tài khoản không đọc được audit (403) vẫn ghi mẫu, audit ghi lỗi',
  { skip },
  async () => {
    mode = { login: 'ok', audit: 'forbidden' };
    const outDir = join(tmp, 'forbidden');
    const r = await run(outDir);
    assert.equal(r.code, 0, r.out);
    const [{ obj }] = lines(outDir);
    assert.deepEqual(obj.audit, { error: 'FORBIDDEN' });
    assert.equal(obj.diag.rssMb, 41.2);
  },
);

test('collect.ps1 -NoAudit: không gọi audit, dòng không có khóa audit', { skip }, async () => {
  mode = { login: 'ok', audit: 'ok' };
  requests.length = 0;
  const outDir = join(tmp, 'noaudit');
  const r = await run(outDir, ['-NoAudit']);
  assert.equal(r.code, 0, r.out);
  const [{ obj }] = lines(outDir);
  assert.deepEqual(Object.keys(obj), ['t', 'site', 'info', 'diag']);
  assert.equal(requests.filter((q) => q.path === '/api/v1/audit').length, 0);
});

test(
  'collect.ps1: sai mật khẩu thì mã khác 0, không ghi tệp, không in mật khẩu',
  { skip },
  async () => {
    mode = { login: 'fail', audit: 'ok' };
    const outDir = join(tmp, 'fail');
    const r = await run(outDir);
    assert.notEqual(r.code, 0);
    assert.deepEqual(lines(outDir), []);
    assert.ok(!r.out.includes(PASSWORD));
  },
);

test(
  'collect.ps1: không có mật khẩu (biến môi trường trống, không phải Windows) thì dừng có thông báo',
  { skip },
  async () => {
    mode = { login: 'ok', audit: 'ok' };
    const outDir = join(tmp, 'nopw');
    const r = await run(outDir, [], { MAT_PILOT_PASSWORD: '' });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /MAT_PILOT_PASSWORD/);
    assert.deepEqual(lines(outDir), []);
  },
);

const skipTls = () => skip || (tls ? false : 'openssl không tạo được chứng chỉ thử');
function resetTls(swap = Infinity) {
  httpsServer.setSecureContext({ key: tls.a.key, cert: tls.a.cert });
  httpsCount = 0;
  swapAfter = swap;
}

test('collect.ps1 https: không có -Fingerprint và không -Insecure thì từ chối, không gọi API', async (t) => {
  if (skipTls()) return t.skip(skipTls());
  mode = { login: 'ok', audit: 'ok' };
  resetTls();
  const outDir = join(tmp, 'https-nofp');
  const r = await run(outDir, [], {}, httpsBase);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /-Fingerprint/);
  assert.match(r.out, /-Insecure/);
  assert.equal(httpsCount, 0, 'không được gửi request (mật khẩu) khi chưa kiểm được chứng chỉ');
  assert.deepEqual(lines(outDir), []);
});

test('collect.ps1 https -Insecure: chạy được, có cảnh báo', async (t) => {
  if (skipTls()) return t.skip(skipTls());
  mode = { login: 'ok', audit: 'ok' };
  resetTls();
  const outDir = join(tmp, 'https-insecure');
  const r = await run(outDir, ['-Insecure', '-NoAudit'], {}, httpsBase);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not checked|không kiểm/i);
  assert.equal(lines(outDir).length, 1);
});

test('collect.ps1 https -Fingerprint đúng: ghi mẫu', async (t) => {
  if (skipTls()) return t.skip(skipTls());
  mode = { login: 'ok', audit: 'ok' };
  resetTls();
  const outDir = join(tmp, 'https-pin');
  const r = await run(outDir, ['-Fingerprint', tls.fpA], {}, httpsBase);
  assert.equal(r.code, 0, r.out);
  assert.equal(lines(outDir).length, 1);
  assert.ok(httpsCount >= 4, `mỗi request một kết nối: ${httpsCount}`);
});

test('collect.ps1 https -Fingerprint sai: từ chối trước khi gửi mật khẩu', async (t) => {
  if (skipTls()) return t.skip(skipTls());
  mode = { login: 'ok', audit: 'ok' };
  resetTls();
  const outDir = join(tmp, 'https-wrong');
  const r = await run(outDir, ['-Fingerprint', '00'.repeat(32)], {}, httpsBase);
  assert.notEqual(r.code, 0, r.out);
  assert.equal(httpsCount, 0, 'không request nào qua được TLS');
  assert.deepEqual(lines(outDir), []);
  assert.ok(!r.out.includes(PASSWORD));
});

test('collect.ps1 https: ghim kiểm ở MỌI kết nối (chứng chỉ đổi sau request đầu thì dừng)', async (t) => {
  if (skipTls()) return t.skip(skipTls());
  mode = { login: 'ok', audit: 'ok' };
  resetTls(1);
  requests.length = 0;
  const outDir = join(tmp, 'https-swap');
  const r = await run(outDir, ['-Fingerprint', tls.fpA, '-NoAudit'], {}, httpsBase);
  assert.notEqual(r.code, 0, r.out);
  assert.deepEqual(lines(outDir), []);
  assert.equal(
    requests.filter((q) => q.path === '/api/v1/auth/login').length,
    0,
    'mật khẩu không được gửi tới chứng chỉ khác ghim',
  );
});
