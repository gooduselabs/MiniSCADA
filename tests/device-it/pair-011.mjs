// So cặp trước/sau của feature 011 (specs/011-pilot-hardening T200, SC-042, FR-003): cùng một bộ kiểm chạy với
// runtime 0.9.0 (trước 011) và 1.0.0-rc.1, ghi lại hành vi quan sát được thành một bản ghi JSON để so.
//   a) đường xem 0.6 từ mạng riêng (viewerAccess private, không đăng nhập): "/", tài nguyên, system/info,
//      projects/active, /project/*, WebSocket live (hello, snapshot, delta); cùng các yêu cầu từ nguồn công cộng,
//      X-Forwarded-For giả (không được tin), Host lạ;
//   b) quy trình nạp xuống 005: đăng nhập engineer, nạp gói .matscada, các bước, đọc lên, BASE_CHANGED, gói sai
//      digest, project lỗi kiểm, khôi phục bản trước, danh sách version, audit.
// Chạy trong container client của tests/device-it/compose.pair.yaml (tests/device-it/pair-011-rig.mjs):
//   node pair-011.mjs --fp <fingerprint>   (mật khẩu: MAT_IT_PW_KYSU, MAT_IT_PW_ADMIN, MAT_IT_PW_XEM)
// In một đối tượng JSON (bản ghi). Giá trị đổi theo lần chạy (thời điểm, token, opId, hash tên tệp) đã được che.
import { readFileSync } from 'node:fs';
import { buildPackage, manifestOf, readProjectDir, variant } from './pack.mjs';
import {
  deployPackage,
  fetchPackage,
  login,
  pinnedConnect,
  pinnedRequest,
  restoreVersion,
  versions,
} from '../../tools/measure/device-api.mjs';

const args = process.argv.slice(2);
const fp = args[args.indexOf('--fp') + 1];
const RT_LAN = process.env.PAIR_RT_LAN ?? '172.30.71.10';
const RT_PUB = process.env.PAIR_RT_PUB ?? '203.0.113.10';
const LAN_IP = process.env.PAIR_LAN_IP ?? '172.30.71.50';
const PUB_IP = process.env.PAIR_PUB_IP ?? '203.0.113.50';
const LAN = `https://${RT_LAN}:8443`;
const PUB = `https://${RT_PUB}:8443`;
const PROJECT_DIR = '/src/projects/training-demo';
// Lần đối chứng: bỏ các yêu cầu Host lạ (421 có audit riêng của 011), để thấy dòng audit còn lại giống bản cũ
const SKIP_EVIL = process.env.PAIR_SKIP_EVIL_HOST === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VOLATILE =
  /^(ts|at|since|startedAt|endedAt|createdAt|activatedAt|expiresAt|token|csrfToken|opId|status|requestId|sequence|uptimeS|runtimeS|systemS|bootId|startedAtMs|nonce|instanceId)$/;
/** Che giá trị đổi theo lần chạy (giữ kiểu), để hai bản ghi so được. */
function mask(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => mask(x));
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x, k)]));
  if (VOLATILE.test(key) && (typeof v === 'string' || typeof v === 'number'))
    return key === 'status' && typeof v === 'number' ? v : `<${typeof v}>`;
  return v;
}
/** Hình dạng: khóa và kiểu (mảng: hình dạng phần tử đầu, kèm độ dài). */
function shape(v) {
  if (Array.isArray(v)) return v.length ? [shape(v[0]), `len=${v.length}`] : [];
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, shape(v[k])]),
    );
  return v === null ? 'null' : typeof v;
}
const HEADERS = [
  'content-type',
  'content-encoding',
  'cache-control',
  'location',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'content-security-policy',
  'strict-transport-security',
  'www-authenticate',
  'etag',
  'vary',
];
const pickHeaders = (h) =>
  Object.fromEntries(
    HEADERS.filter((k) => h[k] !== undefined).map((k) => [
      k,
      k === 'etag' || k === 'content-security-policy' ? `<${String(h[k]).length} ký tự>` : h[k],
    ]),
  );

async function req(
  path,
  { base = LAN, localAddress = LAN_IP, headers = {}, token, method = 'GET', body } = {},
) {
  try {
    const r = await pinnedRequest(base, fp, method, path, {
      headers,
      token,
      localAddress,
      body,
      timeoutMs: 8000,
    });
    return r;
  } catch (e) {
    return { status: 0, error: e.code ?? e.message, headers: {}, body: '', json: null };
  }
}
const brief = (r, { json = true } = {}) => ({
  status: r.status,
  ...(r.error ? { error: r.error } : {}),
  headers: pickHeaders(r.headers ?? {}),
  ...(json && r.json ? { error: r.json.error, code: r.json.code } : {}),
  bytes: r.bodyBytes?.length ?? 0,
});

function plainHttp(host, path, headers = {}) {
  return new Promise((resolve) => {
    import('node:http').then(({ default: http }) => {
      const q = http.request(
        {
          host,
          port: 8080,
          path,
          headers: { Connection: 'close', ...headers },
          agent: false,
          localAddress: LAN_IP,
          timeout: 5000,
        },
        (res) => {
          const c = [];
          res.on('data', (d) => c.push(d));
          res.on('end', () => {
            const text = Buffer.concat(c).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* không phải JSON */
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              json,
              bodyBytes: Buffer.concat(c),
            });
          });
        },
      );
      q.on('timeout', () => q.destroy(new Error('timeout')));
      q.on('error', (e) => resolve({ status: 0, error: e.code ?? e.message, headers: {} }));
      q.end();
    });
  });
}

// --------------------------------------------------------------------------------- WebSocket

function wsFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const maskKey = crypto.getRandomValues(new Uint8Array(4));
  let head;
  if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
  else {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(payload.length, 2);
  }
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ maskKey[i % 4];
  return Buffer.concat([head, Buffer.from(maskKey), out]);
}

/**
 * Một phiên WebSocket thật qua kết nối đã ghim: nâng cấp, nhận các bản tin văn bản trong `listenMs`, gửi `send`
 * (hàm nhận bản tin đầu tiên, trả mảng chuỗi JSON). Trả { status, head, messages, close }.
 */
async function liveSession({
  base = LAN,
  localAddress = LAN_IP,
  origin,
  host,
  listenMs = 6000,
  onMessage,
}) {
  const conn = await pinnedConnect(base, fp, { timeoutMs: 5000, localAddress }).catch((e) => ({
    error: e.code ?? e.message,
  }));
  if (conn.error) return { status: 0, error: conn.error, messages: [] };
  const sock = conn.socket;
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const lines = [
    'GET /api/v1/live HTTP/1.1',
    `Host: ${host ?? new URL(base).host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  if (origin !== undefined) lines.push(`Origin: ${origin}`);
  sock.write(lines.join('\r\n') + '\r\n\r\n');
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);
    let status = null;
    let head = '';
    let body = '';
    const messages = [];
    let close = null;
    const finish = () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ status: status ?? 0, head, body, messages, close });
    };
    const timer = setTimeout(finish, listenMs);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (status === null) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        head = buf.subarray(0, end).toString('latin1');
        status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
        buf = buf.subarray(end + 4);
        if (status !== 101) {
          // thân lỗi (nếu có) rồi kết thúc
          setTimeout(() => {
            body = buf.toString('utf8');
            finish();
          }, 300);
          return;
        }
      }
      if (status !== 101) return;
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 1) {
          let m;
          try {
            m = JSON.parse(payload.toString('utf8'));
          } catch {
            m = { unparsed: payload.toString('utf8').slice(0, 80) };
          }
          messages.push(m);
          for (const out of onMessage?.(m, messages) ?? []) sock.write(wsFrame(out));
        } else if (op === 8) {
          close = {
            code: payload.length >= 2 ? payload.readUInt16BE(0) : null,
            reason: payload.subarray(2).toString('utf8'),
          };
          finish();
          return;
        } else if (op === 9) {
          // ping: pong có mask
          sock.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));
        }
      }
    });
    sock.on('error', () => finish());
    sock.on('close', () => finish());
  });
}

// ------------------------------------------------------------------------------------- viewer

const TAG_IDS = JSON.parse(readFileSync(`${PROJECT_DIR}/tags.json`, 'utf8')).tags.map((t) => t.id);
const VIEWER_PATHS = [
  '/',
  '/index.html',
  '/login',
  '/device.crt',
  '/api/v1/system/info',
  '/api/v1/device/identity',
  '/api/v1/projects/active',
  '/project/project.json',
  '/project/tags.json',
  '/project/screens/tong-quan.screen.json',
  '/project/screens/xu-huong.screen.json',
  '/project/connections.json',
  '/project/alarms.json',
  '/project/khong-co.json',
  '/api/v1/web/session',
  '/api/v1/alarms',
  '/api/v1/history/catalog',
  '/api/v1/diagnostics',
  '/api/v1/project/versions',
  '/khong-co-trang-nay',
];

async function viewer() {
  const out = { lan: {}, pub: {}, xff: {}, host: {}, http: {}, live: {} };
  for (const p of VIEWER_PATHS) out.lan[p] = brief(await req(p));

  // "/" và tài nguyên nó tham chiếu
  const root = await req('/', { headers: { 'Accept-Encoding': 'gzip' } });
  const html =
    root.headers['content-encoding'] === 'gzip'
      ? (await import('node:zlib')).gunzipSync(root.bodyBytes).toString('utf8')
      : root.body;
  const assets = [...new Set(html.match(/(?:\.\/|\/)?assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g) ?? [])];
  out.root = {
    gzip: brief(root),
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
    assetCount: assets.length,
    assetKinds: assets
      .map((a) => a.replace(/^.*assets\//, '').replace(/-[A-Za-z0-9_-]{6,}\./, '-<hash>.'))
      .sort(),
  };
  const assetResults = {};
  for (const a of assets) {
    const path = '/' + a.replace(/^\.?\//, '');
    const plain = await req(path);
    const gz = await req(path, { headers: { 'Accept-Encoding': 'gzip' } });
    const k = path.replace(/-[A-Za-z0-9_-]{6,}\./, '-<hash>.');
    assetResults[k] = {
      status: plain.status,
      contentType: plain.headers['content-type'],
      cacheControl: plain.headers['cache-control'] ?? null,
      gzipStatus: gz.status,
      gzipEncoding: gz.headers['content-encoding'] ?? null,
    };
  }
  out.assets = assetResults;

  // nội dung JSON chính của trang xem
  const info = await req('/api/v1/system/info');
  out.systemInfo = { status: info.status, shape: shape(info.json), value: mask(info.json) };
  const active = await req('/api/v1/projects/active');
  out.projectsActive = {
    status: active.status,
    shape: shape(active.json),
    value: mask(active.json),
  };
  const identity = await req('/api/v1/device/identity');
  out.identity = {
    status: identity.status,
    shape: shape(identity.json),
    features: identity.json?.features ?? null,
  };
  // alarm đang có phụ thuộc pha sin của giả lập lúc đo: ghi kèm giá trị BON.MUC để giải thích
  const alarms = await req('/api/v1/alarms');
  out.alarms = {
    status: alarms.status,
    shape: shape(alarms.json),
    active: (alarms.json?.alarms ?? alarms.json?.active ?? []).map?.((x) => `${x.id} ${x.state}`),
  };
  const session = await req('/api/v1/web/session');
  out.webSession = { status: session.status, value: mask(session.json) };
  const screen = await req('/project/screens/tong-quan.screen.json');
  const fileOnDisk = readFileSync(`${PROJECT_DIR}/screens/tong-quan.screen.json`);
  out.screenFile = {
    status: screen.status,
    sameBytesAsProjectDir: Buffer.compare(screen.bodyBytes ?? Buffer.alloc(0), fileOnDisk) === 0,
  };

  // nguồn công cộng (203.0.113.0/24, không phải RFC1918)
  for (const p of VIEWER_PATHS)
    out.pub[p] = brief(await req(p, { base: PUB, localAddress: PUB_IP }));
  // X-Forwarded-For / X-Real-IP giả một địa chỉ mạng riêng: không được tin
  for (const p of ['/', '/api/v1/projects/active', '/api/v1/system/info'])
    out.xff[p] = brief(
      await req(p, {
        base: PUB,
        localAddress: PUB_IP,
        headers: { 'X-Forwarded-For': LAN_IP, 'X-Real-IP': LAN_IP, Forwarded: `for=${LAN_IP}` },
      }),
    );
  // Host: IP (mặc định ở trên), tên máy, tên lạ, thiếu cổng
  for (const [name, host] of [
    ['hostname rt:8443', 'rt:8443'],
    ['hostname rt.local', 'rt.local'],
    ['localhost', 'localhost:8443'],
    ['evil.example', 'evil.example'],
    ['ip no port', RT_LAN],
  ].filter(([n]) => !(SKIP_EVIL && n === 'evil.example'))) {
    out.host[name] = {
      root: brief(await req('/', { headers: { Host: host } })),
      active: brief(await req('/api/v1/projects/active', { headers: { Host: host } })),
    };
  }
  // cổng HTTP 8080
  for (const p of ['/', '/api/v1/projects/active', '/api/v1/system/info', '/project/project.json'])
    out.http[p] = brief(await plainHttp(RT_LAN, p, { Host: `${RT_LAN}:8080` }));

  // WebSocket live, mạng riêng, không đăng nhập
  const origin = `https://${RT_LAN}:8443`;
  let sentWrite = false;
  const s = await liveSession({
    origin,
    listenMs: 7000,
    onMessage: (m) => {
      if (m.type === 'hello')
        return [
          JSON.stringify({
            type: 'subscribe',
            requestId: 'pair-1',
            tags: [...TAG_IDS, 'KHONG.CO'],
          }),
        ];
      if (m.type === 'snapshot' && !sentWrite) {
        sentWrite = true;
        return [
          JSON.stringify({ type: 'write', requestId: 'pair-w', tag: 'BON.MUC_DAT', value: 50 }),
          JSON.stringify({ type: 'heartbeat' }),
        ];
      }
      return [];
    },
  });
  const hello = s.messages.find((m) => m.type === 'hello');
  const snap = s.messages.find((m) => m.type === 'snapshot');
  const deltas = s.messages.filter((m) => m.type === 'delta');
  const errors = s.messages.filter((m) => m.type === 'error');
  out.live.lan = {
    status: s.status,
    helloShape: shape(hello ? { ...hello, project: undefined } : null),
    hello: hello
      ? {
          protocolVersion: hello.protocolVersion,
          serverVersion: hello.serverVersion,
          maxClients: hello.maxClients,
          heartbeatMs: hello.heartbeatMs,
          timeoutMs: hello.timeoutMs,
          features: hello.features ?? null,
          projectShape: shape(hello.project),
          project: mask(hello.project),
        }
      : null,
    snapshot: snap
      ? {
          shape: shape({ ...snap, tags: undefined }),
          tagCount: snap.tags.length,
          tagShape: shape(snap.tags[0]),
          tagIds: snap.tags.map((t) => t.id ?? t.tag ?? t[0]),
          bonMuc: snap.tags.find((t) => t.id === 'BON.MUC')?.value ?? null,
          qualities: Object.fromEntries(
            snap.tags.map((t) => [t.id ?? t.tag, t.quality ?? t.q ?? null]),
          ),
          unknown: snap.unknown,
        }
      : null,
    deltaCount: deltas.length,
    deltaShape: deltas[0] ? shape({ ...deltas[0], tags: undefined }) : null,
    deltaTagShape: deltas[0] ? shape(deltas[0].tags?.[0]) : null,
    // delta: mỗi Tag là [vị trí trong subscribe, giá trị, ...]
    deltaTagPositions: [
      ...new Set(
        deltas.flatMap((d) => (d.tags ?? []).map((t) => (Array.isArray(t) ? t[0] : t.id))),
      ),
    ].sort(),
    deltaSequenceMonotonic: deltas.every((d, i) => i === 0 || d.sequence > deltas[i - 1].sequence),
    errors: errors.map((e) => ({ code: e.code, requestId: e.requestId ?? null })),
    messageTypes: [...new Set(s.messages.map((m) => m.type))].sort(),
    close: s.close,
  };
  // các biến thể nâng cấp
  const variants = {
    'lan no Origin': { origin: undefined },
    'lan Origin evil': { origin: 'https://evil.example' },
    'lan Origin http': { origin: `http://${RT_LAN}:8443` },
    ...(SKIP_EVIL
      ? {}
      : { 'lan Host evil': { origin: 'https://evil.example', host: 'evil.example' } }),
    'pub (public source)': { base: PUB, localAddress: PUB_IP, origin: `https://${RT_PUB}:8443` },
  };
  for (const [name, v] of Object.entries(variants)) {
    const r = await liveSession({ ...v, listenMs: 2500 });
    let errJson = null;
    try {
      errJson = r.body ? JSON.parse(r.body.slice(r.body.indexOf('{'))) : null;
    } catch {
      // thân không phải JSON
    }
    out.live[name] = {
      status: r.status,
      error: errJson?.error ?? r.error ?? null,
      statusLine: r.head?.split('\r\n')[0] ?? null,
      bodyBytes: r.body?.length ?? 0,
      firstMessage: r.messages[0]?.type ?? null,
      close: r.close,
    };
  }
  return out;
}

// ------------------------------------------------------------------------------------- deploy

async function signIn(user) {
  const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
  for (let i = 0; i < 40; i++) {
    const r = await login(LAN, fp, user, pw, { localAddress: LAN_IP }).catch(() => null);
    if (r?.status === 200) return r;
    if (r && r.status !== 401) return r;
    await sleep(500);
  }
  return login(LAN, fp, user, pw, { localAddress: LAN_IP });
}

/** Thăm dò thao tác mỗi 100 ms: chuỗi trạng thái các bước quan sát được và kết quả cuối. */
async function follow(token, opId, timeoutMs = 90000) {
  const t0 = performance.now();
  const seen = [];
  let op = null;
  let restarts = 0;
  while (performance.now() - t0 < timeoutMs) {
    let r = null;
    try {
      r = await pinnedRequest(LAN, fp, 'GET', `/api/v1/project/deployments/${opId}`, {
        token,
        timeoutMs: 3000,
        localAddress: LAN_IP,
      });
    } catch {
      restarts++;
    }
    if (r?.status === 200) {
      op = r.json;
      const sig = (op.steps ?? []).map((s) => `${s.id}:${s.state}`).join(',');
      if (seen.at(-1) !== sig) seen.push(sig);
      if (op.result !== 'running') break;
    }
    await sleep(100);
  }
  return { op: mask(op), stepTrace: seen, sawRestartGap: restarts > 0 };
}

async function activeDigest(token) {
  const r = await versions(LAN, fp, token, { localAddress: LAN_IP });
  return r.json?.versions?.find((v) => v.state === 'active')?.digest ?? 'none';
}

const versionList = (r) => ({
  status: r.status,
  shape: shape(r.json),
  versions: (r.json?.versions ?? []).map((v) => ({
    seq: v.seq,
    state: v.state,
    projectId: v.projectId,
    projectVersion: v.projectVersion,
    source: v.source,
    deployedBy: v.deployedBy ?? null,
    restorable: v.restorable ?? null,
    digest: v.digest,
  })),
});

async function deploy() {
  const out = { steps: [] };
  const step = (name, data) => out.steps.push({ step: name, ...data });
  const files = readProjectDir(PROJECT_DIR);
  const o = { localAddress: LAN_IP };

  // đăng nhập
  const bad = await login(LAN, fp, 'kysu', 'sai-mat-khau-pair-011', o);
  step('login sai mật khẩu', { status: bad.status, error: bad.json?.error });
  const li = await signIn('kysu');
  step('login engineer', {
    status: li.status,
    shape: shape(li.json),
    role: li.json?.role,
    user: li.json?.user,
  });
  const token = li.json?.token;
  const xem = (await signIn('xem')).json?.token;
  const admin = (await signIn('admin')).json?.token;
  const sess = await pinnedRequest(LAN, fp, 'GET', '/api/v1/auth/session', { token, ...o });
  step('auth/session', { status: sess.status, value: mask(sess.json) });

  // bản đang chạy (nhận từ thư mục project ở lần chạy đầu)
  const v0 = await versions(LAN, fp, token, o);
  step('versions lúc đầu', versionList(v0));
  const base = await activeDigest(token);
  const up0 = await fetchPackage(LAN, fp, token, undefined, o);
  step('đọc lên bản đầu', {
    status: up0.status,
    contentType: up0.headers['content-type'],
    disposition: up0.headers['content-disposition'],
    digestHeaderIsActive: up0.headers['x-mat-digest'] === base,
    files:
      up0.status === 200
        ? manifestOf(up0.bodyBytes)
            .files.map((f) => f.path)
            .sort()
        : null,
  });
  const man = await pinnedRequest(LAN, fp, 'GET', '/api/v1/project/manifest', { token, ...o });
  step('project/manifest', { status: man.status, shape: shape(man.json) });
  const opNow = await pinnedRequest(LAN, fp, 'GET', '/api/v1/project/operation', { token, ...o });
  step('project/operation lúc đầu', { status: opNow.status, value: mask(opNow.json) });

  // từ chối trước khi nhận
  const p1 = buildPackage(variant(files, { projectVersion: '0.2.0' }));
  const noAuth = await deployPackage(LAN, fp, undefined, p1.bytes, p1.digest, base, o);
  step('nạp xuống không đăng nhập', { status: noAuth.status, error: noAuth.json?.error });
  const asViewer = await deployPackage(LAN, fp, xem, p1.bytes, p1.digest, base, o);
  step('nạp xuống role viewer', { status: asViewer.status, error: asViewer.json?.error });
  const overHttp = await plainHttp(RT_LAN, '/api/v1/project/versions', {
    Authorization: `Bearer ${token}`,
    Host: `${RT_LAN}:8080`,
  });
  step('versions qua HTTP 8080', { status: overHttp.status, error: overHttp.json?.error });
  const wrongBase = await deployPackage(
    LAN,
    fp,
    token,
    p1.bytes,
    p1.digest,
    `sha256:${'0'.repeat(64)}`,
    o,
  );
  step('nạp xuống BASE_CHANGED', { status: wrongBase.status, error: wrongBase.json?.error });
  const badHeader = await deployPackage(LAN, fp, token, p1.bytes, 'abc', base, o);
  step('nạp xuống X-Mat-Digest sai dạng', {
    status: badHeader.status,
    error: badHeader.json?.error,
  });

  // nạp xuống hợp lệ 0.2.0
  const t1 = performance.now();
  const d1 = await deployPackage(LAN, fp, token, p1.bytes, p1.digest, base, o);
  const f1 = d1.status === 202 ? await follow(token, d1.json.opId) : null;
  step('nạp xuống 0.2.0', {
    status: d1.status,
    accepted: mask(d1.json),
    result: f1?.op?.result,
    error: f1?.op?.error ?? null,
    stepTrace: f1?.stepTrace,
    op: f1?.op,
    ms: Math.round(performance.now() - t1),
  });
  await sleep(1500);
  const up1 = await fetchPackage(LAN, fp, token, undefined, o);
  step('đọc lên 0.2.0', {
    status: up1.status,
    sameBytes: up1.status === 200 && Buffer.compare(up1.bodyBytes, p1.bytes) === 0,
    digestHeader: up1.headers['x-mat-digest'] === p1.digest,
  });
  const act1 = await req('/api/v1/projects/active');
  step('projects/active sau 0.2.0 (khách)', {
    status: act1.status,
    projectVersion: act1.json?.projectVersion ?? act1.json?.project?.projectVersion ?? null,
    digestMatches: JSON.stringify(act1.json ?? {}).includes(p1.digest),
  });

  // digest khai báo khác gói
  const base1 = await activeDigest(token);
  const p2 = buildPackage(variant(files, { projectVersion: '0.2.1' }));
  const dMis = await deployPackage(LAN, fp, token, p2.bytes, `sha256:${'1'.repeat(64)}`, base1, o);
  const fMis = dMis.status === 202 ? await follow(token, dMis.json.opId) : null;
  step('nạp xuống digest khác gói', {
    status: dMis.status,
    error: dMis.json?.error,
    result: fMis?.op?.result,
    opError: fMis?.op?.error ?? null,
    stepTrace: fMis?.stepTrace,
  });

  // project lỗi kiểm (Tag không tồn tại trên màn hình)
  const scr = JSON.parse(files['screens/tong-quan.screen.json'].toString('utf8'));
  const brokenScr = JSON.stringify(scr).replace('"BON.MUC"', '"KHONG.CO.TAG"');
  const p3 = buildPackage(
    variant(files, {
      projectVersion: '0.2.2',
      replace: { 'screens/tong-quan.screen.json': Buffer.from(brokenScr) },
    }),
  );
  const d3 = await deployPackage(LAN, fp, token, p3.bytes, p3.digest, await activeDigest(token), o);
  const f3 = d3.status === 202 ? await follow(token, d3.json.opId) : null;
  step('nạp xuống project lỗi kiểm', {
    status: d3.status,
    error: d3.json?.error,
    result: f3?.op?.result,
    opErrorCode: f3?.op?.error?.code,
    issueCodes: (f3?.op?.error?.issues ?? []).map((i) => `${i.code} ${i.file} ${i.path}`),
    stepTrace: f3?.stepTrace,
  });

  // phiên bản thứ hai hợp lệ
  const p4 = buildPackage(variant(files, { projectVersion: '0.3.0' }));
  const d4 = await deployPackage(LAN, fp, token, p4.bytes, p4.digest, await activeDigest(token), o);
  const f4 = d4.status === 202 ? await follow(token, d4.json.opId) : null;
  step('nạp xuống 0.3.0', { status: d4.status, result: f4?.op?.result, stepTrace: f4?.stepTrace });
  await sleep(1500);
  const v4 = await versions(LAN, fp, token, o);
  step('versions sau 0.3.0', versionList(v4));

  // khôi phục bản 0.2.0 (quay về)
  const seq020 = v4.json?.versions?.find((v) => v.projectVersion === '0.2.0')?.seq;
  const activeSeq = v4.json?.versions?.find((v) => v.state === 'active')?.seq;
  const already = await restoreVersion(LAN, fp, token, activeSeq, await activeDigest(token), o);
  step('khôi phục bản đang chạy', { status: already.status, error: already.json?.error });
  const nosuch = await restoreVersion(LAN, fp, token, 999, await activeDigest(token), o);
  step('khôi phục seq không có', { status: nosuch.status, error: nosuch.json?.error });
  const rs = await restoreVersion(LAN, fp, token, seq020, await activeDigest(token), o);
  const fr = rs.status === 202 ? await follow(token, rs.json.opId) : null;
  step('khôi phục 0.2.0', {
    status: rs.status,
    result: fr?.op?.result,
    kind: fr?.op?.kind,
    stepTrace: fr?.stepTrace,
    op: fr?.op,
  });
  await sleep(1500);
  const v5 = await versions(LAN, fp, token, o);
  step('versions sau khôi phục', versionList(v5));
  const up5 = await fetchPackage(LAN, fp, token, undefined, o);
  step('đọc lên sau khôi phục', {
    status: up5.status,
    sameBytesAs020: up5.status === 200 && Buffer.compare(up5.bodyBytes, p1.bytes) === 0,
  });
  const upOld = await fetchPackage(LAN, fp, token, 1, o);
  step('đọc lên seq 1 (bản dự phòng)', { status: upOld.status, error: upOld.json?.error });

  // audit (administrator)
  const aud = await pinnedRequest(LAN, fp, 'GET', '/api/v1/audit?limit=200', {
    token: admin,
    ...o,
  });
  const rows = (aud.json?.records ?? []).slice().reverse();
  out.audit = {
    status: aud.status,
    recordShape: shape(rows[0]),
    rows: rows.map((r) =>
      [
        r.action,
        r.user || '-',
        r.role || '-',
        r.channel || '-',
        r.result,
        r.code ?? '-',
        /^(sha256:)?[0-9a-f]{64}$/.test(r.target ?? '') ? '<digest>' : r.target,
      ].join(' | '),
    ),
    // audit.suppressed: các sự kiện bị gộp (theo action), để giải thích dòng thiếu
    suppressed: rows
      .filter((r) => r.action === 'audit.suppressed')
      .map((r) => {
        const d = typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail;
        return { count: r.count, byAction: d?.byAction ?? d?.actions ?? d };
      }),
  };
  const auditViewer = await pinnedRequest(LAN, fp, 'GET', '/api/v1/audit?limit=1', {
    token: xem,
    ...o,
  });
  step('audit với role viewer', { status: auditViewer.status, error: auditViewer.json?.error });
  return out;
}

const record = { fp: '<pinned>', tagIds: TAG_IDS };
try {
  record.viewer = await viewer();
  record.deploy = await deploy();
} catch (e) {
  record.error = e.stack ?? String(e);
}
process.stdout.write(JSON.stringify(record) + '\n');
