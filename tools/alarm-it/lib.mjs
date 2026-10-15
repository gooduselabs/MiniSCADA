// Thư viện của các kịch bản tích hợp alarm (feature 009; tools/alarm-it.ps1, tests/alarm-it/compose.yaml).
// Chạy trên máy dev (Node >= 22), vào rt trong Docker qua cổng loopback 28443 (HTTPS, ghim fingerprint) và 28080 (HTTP).
// Mật khẩu thử: biến môi trường MAT_IT_PW_<USER>; fingerprint: MAT_IT_FP.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { login as bearerLogin, pinnedRequest } from '../measure/device-api.mjs';
import { Web, makeReport, sleep, uuid } from '../../tests/web-it/lib/api.mjs';

export { makeReport, sleep, uuid };
export const HTTPS = process.env.MAT_IT_HTTPS ?? 'https://127.0.0.1:28443';
export const HTTP = process.env.MAT_IT_HTTP ?? 'http://127.0.0.1:28080';
export const SIMCTL = process.env.MAT_IT_SIM ?? 'http://127.0.0.1:28503';
export const CONTAINER = process.env.MAT_IT_RT ?? 'mat-alarm-it-rt-1';
export const FP = process.env.MAT_IT_FP ?? '';
export const web = new Web(FP);

export const now = () => Date.now();

/** Chạy docker và trả stdout (chuỗi); lỗi thì ném. */
export function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 120000, ...opts });
}
export const dexec = (cmd) => docker(['exec', CONTAINER, 'sh', '-c', cmd]);

/** Phiên web (cookie + CSRF) của một tài khoản thử. */
export async function webLogin(user) {
  const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
  if (!pw) throw new Error(`thiếu MAT_IT_PW_${user.toUpperCase()}`);
  const r = await web.request('POST', '/api/v1/web/login', {
    base: HTTPS,
    body: JSON.stringify({ username: user, password: pw }),
  });
  if (r.status !== 200) throw new Error(`login web ${user}: ${r.status} ${r.body}`);
  const set = r.headers['set-cookie'];
  const line = (Array.isArray(set) ? set : [set]).find((c) => c?.startsWith('__Host-mat_sid='));
  return {
    cookie: line.split(';')[0].slice('__Host-mat_sid='.length),
    csrf: r.json.csrfToken,
    user,
  };
}

export async function bearer(user) {
  const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
  const r = await bearerLogin(HTTPS, FP, user, pw);
  if (r.status !== 200) throw new Error(`login bearer ${user}: ${r.status} ${r.body}`);
  return r.json.token;
}

/** Yêu cầu web có phiên cookie; `body` là đối tượng. */
export const wreq = (method, path, s, body, extra = {}) =>
  web.request(method, path, {
    base: HTTPS,
    s,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...extra,
  });

/** Yêu cầu Bearer. */
export const breq = (method, path, token, body) =>
  pinnedRequest(HTTPS, FP, method, path, { token, body });

/** GET công khai qua HTTP (khách trong mạng riêng). */
export function httpGet(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${HTTP}${path}`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* không phải JSON */
          }
          resolve({ status: res.statusCode, json, body: text });
        });
      })
      .on('error', reject);
  });
}
export const getAlarms = async () => (await httpGet('/api/v1/alarms')).json;
export const getInfo = async () => (await httpGet('/api/v1/system/info')).json;

export async function waitFor(fn, timeoutMs, what, stepMs = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`hết giờ chờ: ${what}`);
    await sleep(stepMs);
  }
}

/** Chờ runtime trả lời và (nếu có) alarm đã dựng xong. */
export async function waitRuntime(timeoutMs = 60000) {
  return waitFor(
    async () => {
      try {
        const r = await httpGet('/api/v1/alarms');
        return r.status === 200 ? r.json : null;
      } catch {
        return null;
      }
    },
    timeoutMs,
    'runtime /api/v1/alarms',
    300,
  );
}

// ------------------------------------------------------------------------------ giả lập Modbus

function simCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${SIMCTL}${path}`,
      {
        method,
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
/** Đặt thanh ghi giữ (holding) hay coil của giả lập. */
export const simSet = (area, address, value) =>
  simCall('POST', '/set', { unit: 1, area, address, value });
export const simHolding = (address, value) => simSet('holding', address, value);
export const simCoil = (address, value) => simSet('coils', address, value ? 1 : 0);
export const simRefuse = (on) =>
  on ? simCall('POST', '/fault', { kind: 'refuse' }) : simCall('DELETE', '/fault');

// ------------------------------------------------------------------------------ live (WebSocket)

/** Client live tối thiểu cho kịch bản (WebSocket có sẵn của Node, qua HTTP loopback). */
export class LiveProbe {
  constructor({
    subscribe = true,
    url = `${HTTP.replace('http', 'ws')}/api/v1/live`,
    slow = false,
  } = {}) {
    this.url = url;
    this.msgs = [];
    this.alarmMsgs = [];
    this.closed = null;
    this.state = new Map(); // id -> instance
    this.counts = null;
    this.sequence = 0;
    this.revision = 0;
    this.maxMessageBytes = 0;
    this.bytes = 0;
    this.slow = slow;
    this.wantSubscribe = subscribe;
    this.hello = null;
    this.waiters = [];
    this.parts = null;
    this.tagLog = [];
    this.tagIds = null;
  }

  /** Đăng ký Tag (giao thức 1.x `subscribe`); `tagLog` ghi giờ máy dev của mỗi thay đổi. */
  subscribeTags(tags, requestId = 't1') {
    this.ws.send(JSON.stringify({ type: 'subscribe', requestId, tags }));
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onerror = () => reject(new Error('WebSocket lỗi'));
      ws.onclose = (e) => {
        this.closed = { code: e.code, reason: e.reason };
        this.#wake();
      };
      ws.onmessage = (ev) => this.#onMessage(String(ev.data), resolve);
    });
  }

  #onMessage(text, resolveOpen) {
    const t = performance.now();
    this.bytes += text.length;
    this.maxMessageBytes = Math.max(this.maxMessageBytes, text.length);
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    m.__t = t;
    m.__wall = Date.now();
    this.msgs.push(m);
    if (m.type === 'heartbeat') this.ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    if (m.type === 'hello') {
      this.hello = m;
      if (this.wantSubscribe && (m.features ?? []).includes('alarms')) this.subscribeAlarms();
      resolveOpen?.(m);
    } else if (m.type === 'snapshot' && Array.isArray(m.tags)) {
      this.tagIds = m.tags.map((t) => t.id);
      this.tagLog.push({ at: m.__wall, snapshot: true });
    } else if (m.type === 'delta' && Array.isArray(m.tags) && this.tagIds) {
      for (const [i, v] of m.tags) this.tagLog.push({ at: m.__wall, id: this.tagIds[i], value: v });
    } else if (m.type === 'alarmSnapshot') {
      this.alarmMsgs.push(m);
      this.#applySnapshot(m);
    } else if (m.type === 'alarmDelta') {
      this.alarmMsgs.push(m);
      this.#applyDelta(m);
    }
    this.#wake();
  }

  subscribeAlarms(requestId = `a${Math.floor(Math.random() * 1e6)}`) {
    this.subId = requestId;
    this.ws.send(JSON.stringify({ type: 'subscribeAlarms', requestId }));
  }

  #applySnapshot(m) {
    if (m.part && m.part > 1 && this.parts?.sequence !== m.sequence) return;
    if (!m.part || m.part === 1) this.parts = { sequence: m.sequence, items: [] };
    if (m.part) this.parts.items.push(...m.instances);
    else this.parts.items = m.instances;
    if (m.part && m.part < m.parts) return;
    this.state = new Map(this.parts.items.map((i) => [i.id, i]));
    this.counts = m.counts;
    this.sequence = m.sequence;
    this.revision = m.revision;
  }

  #applyDelta(m) {
    if (m.sequence !== this.sequence + 1) this.sequenceGap = (this.sequenceGap ?? 0) + 1;
    for (const i of m.changed ?? []) this.state.set(i.id, i);
    for (const id of m.removed ?? []) this.state.delete(id);
    this.counts = m.counts;
    this.sequence = m.sequence;
    this.revision = m.revision;
  }

  #wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  /** Chờ tới khi `pred(this)` đúng; trả thời điểm (performance.now) của bản tin làm nó đúng, hoặc null khi hết giờ. */
  async until(pred, timeoutMs) {
    const t0 = performance.now();
    for (;;) {
      if (pred(this)) return this.msgs.at(-1)?.__t ?? performance.now();
      const left = timeoutMs - (performance.now() - t0);
      if (left <= 0) return null;
      await new Promise((r) => {
        this.waiters.push(r);
        setTimeout(r, Math.min(left, 200));
      });
    }
  }

  inst(id) {
    return this.state.get(id);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* đã đóng */
    }
  }
}

// ------------------------------------------------------------------------------ audit và alarm.db

/** Các dòng audit khớp `query` (đã lật trang), bằng token engineer/admin. */
export async function auditRows(token, query) {
  const rows = [];
  let before;
  for (let page = 0; page < 40; page++) {
    const r = await breq(
      'GET',
      `/api/v1/audit?${query}&limit=200${before ? `&before=${before}` : ''}`,
      token,
    );
    if (r.status !== 200) break;
    rows.push(...r.json.records);
    before = r.json.next;
    if (!before) break;
  }
  return rows;
}

/** Chạy `mat-runtime --alarm-db-check` trong container; trả { rc, json }. */
export function alarmDbCheck() {
  try {
    const out = dexec('/build/x64/bin/mat-runtime --alarm-db-check --data-dir /data; echo "rc=$?"');
    const rc = Number(/rc=(\d+)\s*$/.exec(out)?.[1] ?? -1);
    const json = JSON.parse(out.slice(0, out.lastIndexOf('rc=')));
    return { rc, json };
  } catch (e) {
    return { rc: -1, json: null, error: String(e.message ?? e).slice(0, 300) };
  }
}

/** kill -9 runtime (vòng giám sát chạy lại sau 2 s). */
export function killRuntime() {
  dexec('kill -KILL $(cat /run/mat-runtime.pid)');
}

/** SIGTERM runtime (tắt sạch; vòng giám sát chạy lại). */
export function termRuntime() {
  dexec('kill -TERM $(cat /run/mat-runtime.pid)');
}

/** Đếm số lần runtime đã (re)start theo nhật ký giám sát. */
export function runtimeStarts() {
  return Number(dexec("grep -c '^supervise: start' /logs/runtime.log").trim());
}

export function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** In đúng một dòng JSON kết quả. */
export function emit(report, extra = {}) {
  const r = { ...report.result(), ...extra };
  console.log(JSON.stringify(r));
  return r;
}
