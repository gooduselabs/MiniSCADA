// Thư viện của client web-it (feature 007, T049, T059, T073): gọi HTTPS có ghim fingerprint, phiên web (cookie +
// CSRF), phiên Bearer của kỹ thuật, giả lập Modbus, kiểm audit. Chạy trong container client (Node 22, không phụ thuộc).
import http from 'node:http';
import {
  login as bearerLogin,
  pinnedConnect,
  pinnedRequest,
} from '../../../tools/measure/device-api.mjs';

export const RT = process.env.MAT_IT_RT ?? 'rt';
export const BASE = `https://${RT}:8443`;
export const HOST = `${RT}:8443`;
export const ORIGIN = `https://${HOST}`;
export const HTTP_BASE = `http://${RT}:8080`;
export const SIM = `http://${RT}:1503`;
export const LAN_IP = process.env.MAT_IT_LAN_IP ?? '172.30.7.50';
export const PUB_IP = process.env.MAT_IT_PUB_IP ?? '203.0.113.50';
export const WRITE_FCS = new Set([5, 6, 15, 16, 22]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bộ ghi kết quả của một kịch bản: { name, pass, detail }. */
export function makeReport(scenario) {
  const checks = [];
  const measures = {};
  const check = (name, pass, detail = '') => {
    if (process.env.WEB_IT_TRACE) console.error('check', name, pass);
    checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
    return Boolean(pass);
  };
  return {
    checks,
    measures,
    check,
    result: () => ({ scenario, checks, measures, pass: checks.every((c) => c.pass) }),
  };
}

export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------------- phiên web

const cookieOf = (r) => {
  const set = r.headers['set-cookie'];
  const line = Array.isArray(set) ? set.find((c) => c.startsWith('__Host-mat_sid=')) : undefined;
  return line ? { raw: line, value: line.split(';')[0].slice('__Host-mat_sid='.length) } : null;
};

export class Web {
  /** @param {string} fp fingerprint đã ghim */
  constructor(fp) {
    this.fp = fp;
  }

  /** Một yêu cầu HTTPS; `s` = phiên web { cookie, csrf } (tùy chọn); `h` = header thêm. */
  request(
    method,
    path,
    { s, h = {}, body, raw, base, localAddress, noOrigin, noCsrf, timeoutMs } = {},
  ) {
    const headers = { ...h };
    if (s?.cookie) headers.Cookie = `__Host-mat_sid=${s.cookie}`;
    if (method !== 'GET' && !noOrigin && !('Origin' in headers))
      headers.Origin = base ? new URL(base).origin : ORIGIN;
    if (s?.csrf && !noCsrf && method !== 'GET' && !('X-MAT-CSRF' in headers))
      headers['X-MAT-CSRF'] = s.csrf;
    // `raw`: thân gửi nguyên (Content-Type do h đặt); `body` mặc định là JSON
    if (raw !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(raw));
      return pinnedRequest(base ?? BASE, this.fp, method, path, {
        headers,
        bytes: Buffer.from(raw),
        localAddress,
        timeoutMs,
      });
    }
    return pinnedRequest(base ?? BASE, this.fp, method, path, {
      headers,
      body,
      localAddress,
      timeoutMs,
    });
  }

  /** Đăng nhập web: trả phản hồi kèm `session` = { cookie, csrf, user, role } hoặc null. */
  async login(user, password, opts = {}) {
    const r = await this.request('POST', '/api/v1/web/login', {
      body: JSON.stringify({ username: user, password }),
      ...opts,
    });
    const c = cookieOf(r);
    r.session =
      r.status === 200 && c
        ? { cookie: c.value, csrf: r.json.csrfToken, user: r.json.user, role: r.json.role }
        : null;
    r.setCookie = r.headers['set-cookie'];
    return r;
  }

  /** Ghi một Tag bằng phiên web; trả phản hồi POST. */
  write(s, req, opts = {}) {
    return this.request('POST', '/api/v1/tags/write', {
      s,
      body: JSON.stringify({ requests: [{ requestId: uuid(), ...req }] }),
      ...opts,
    });
  }

  /** Ghi rồi hỏi kết quả mỗi 200 ms cho tới khi hết ACCEPTED. */
  async writeAndWait(s, req, { maxMs = 30000, phases } = {}) {
    const requestId = req.requestId ?? uuid();
    const t0 = Date.now();
    const post = await this.request('POST', '/api/v1/tags/write', {
      s,
      body: JSON.stringify({ requests: [{ ...req, requestId }] }),
    });
    let final = post.json?.results?.[0];
    if (post.status !== 200 || final?.status !== 'ACCEPTED')
      return { post, first: final, final, ms: Date.now() - t0, requestId };
    const first = final;
    while (Date.now() - t0 < maxMs) {
      await sleep(200);
      const r = await this.request('GET', `/api/v1/tags/write/${requestId}`, {
        s,
        h: { 'Sec-Fetch-Site': 'same-origin' },
      });
      final = r.json?.results?.[0] ?? r.json ?? final;
      if (phases && final?.phase) phases.add(final.phase);
      if (final?.status !== 'ACCEPTED') break;
    }
    return { post, first, final, ms: Date.now() - t0, requestId };
  }
}

// -------------------------------------------------------------------------- phiên Bearer (kỹ thuật)

const bearer = {};
export async function bearerToken(fp, user) {
  if (bearer[user]) return bearer[user];
  const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
  const r = await bearerLogin(BASE, fp, user, pw);
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${r.body}`);
  bearer[user] = r.json.token;
  return bearer[user];
}

export async function api(fp, user, method, path, body) {
  return pinnedRequest(BASE, fp, method, path, {
    token: user ? await bearerToken(fp, user) : undefined,
    body,
  });
}

/** Mọi dòng audit khớp `query` (đã lật trang). */
export async function auditRows(fp, query) {
  const rows = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const r = await api(
      fp,
      'admin',
      'GET',
      `/api/v1/audit?${query}&limit=200${before ? `&before=${before}` : ''}`,
    );
    if (r.status !== 200) break;
    rows.push(...r.json.records);
    before = r.json.next;
    if (!before) break;
  }
  return rows;
}

export const detailOf = (row) =>
  row?.detail && typeof row.detail === 'object' ? row.detail : JSON.parse(row?.detail ?? '{}');

// ------------------------------------------------------------------------------------ giả lập

function simCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${SIM}${path}`,
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
export const simLog = async (since = 0) => (await simCall('GET', `/log?since=${since}`)).entries;
export const simMark = async () => (await simLog()).at(-1)?.seq ?? 0;
export const simWrites = async (since) => (await simLog(since)).filter((e) => WRITE_FCS.has(e.fc));
export const simMem = async (area, address, count = 1, unit = 1) =>
  (await simCall('GET', `/mem?unit=${unit}&area=${area}&address=${address}&count=${count}`)).values;
export const simFault = (f) => simCall('POST', '/fault', f);

// ------------------------------------------------------------------------------ yêu cầu thô

/**
 * Nâng cấp WebSocket thủ công (WebSocket của Node không đặt được Origin hay Cookie): gửi yêu cầu qua kết nối đã ghim
 * fingerprint, đọc dòng trạng thái rồi đóng. Trả { status } (101 khi được nâng cấp); 0 khi không có trả lời trong 3 s.
 */
export async function wsUpgrade(
  fp,
  { cookie, origin, localAddress, path = '/api/v1/live', base } = {},
) {
  const target = base ?? BASE;
  const conn = await pinnedConnect(target, fp, { timeoutMs: 5000, localAddress }).catch(() => null);
  if (!conn) return { status: 0, error: 'connect' };
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${new URL(target).host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  if (cookie) lines.push(`Cookie: __Host-mat_sid=${cookie}`);
  if (origin !== undefined) lines.push(`Origin: ${origin}`);
  return new Promise((resolve) => {
    let buf = '';
    const done = (r) => {
      conn.socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => done({ status: 0, error: 'timeout' }), 3000);
    conn.socket.on('data', (d) => {
      buf += d.toString('latin1');
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf);
      if (m && buf.includes('\r\n')) {
        clearTimeout(timer);
        done({ status: Number(m[1]), head: buf.split('\r\n\r\n')[0] });
      }
    });
    conn.socket.on('error', () => {
      clearTimeout(timer);
      done({ status: 0, error: 'socket' });
    });
    conn.socket.write(lines.join('\r\n') + '\r\n\r\n');
  });
}

export function plainHttp(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${HTTP_BASE}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // không phải JSON
        }
        resolve({ status: res.statusCode, headers: res.headers, body: text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
