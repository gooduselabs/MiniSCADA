// Gọi API kỹ thuật của mat-runtime qua HTTPS có ghim fingerprint, không cần Studio
// (specs/005-device-online T052, quickstart §2, contracts/device-api.md §2–§3, research R6).
// Node thuần, không thêm phụ thuộc.
//
// Dùng:
//   node tools/measure/device-api.mjs <https://host:port> --fingerprint <fp> [--user <tên>]
//        [--password-stdin] [--out f.json] [lệnh ...]
// - Lệnh: login (đo thời gian), session, logout; mặc định "login session logout". session và
//   logout dùng token của login trong cùng lần chạy, hoặc biến môi trường MAT_DEVICE_TOKEN.
// - Mật khẩu: dòng đầu của stdin (--password-stdin), biến môi trường MAT_DEVICE_PASSWORD, hoặc hỏi
//   trên terminal (không hiện ký tự). Không nhận mật khẩu trên dòng lệnh.
// - <fp>: 64 hex, có hoặc không có dấu ":" (dán thẳng dòng "SHA256 Fingerprint=…" của
//   --cert-fingerprint cũng được).
// - Ghim: mỗi lệnh mở một kết nối TLS mới, bắt tay đầy đủ (kể cả chữ ký bắt tay), rồi so SHA-256
//   chứng chỉ máy chủ với fingerprint trước khi gửi byte HTTP nào. Sai thì dừng, mã thoát 3.
//   Node không gọi checkServerIdentity khi chuỗi chứng chỉ không kiểm được (chứng chỉ tự ký:
//   UNABLE_TO_VERIFY_LEAF_SIGNATURE), nên phép so nằm ở sự kiện secureConnect; checkServerIdentity
//   vẫn so cùng giá trị cho trường hợp chuỗi kiểm được.
// - Kết quả JSON ra stdout (và --out). Token không bao giờ có trong kết quả, chỉ có độ dài.
// Mã thoát: 0 mọi lệnh có mã HTTP mong đợi; 1 có lệnh trả mã khác; 2 tham số sai; 3 sai fingerprint
// hoặc không kết nối được.
import { writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

/** 64 lower-case hex from "AB:CD:…", "abcd…" or "SHA256 Fingerprint=AB:…"; "" when invalid. */
export function normalizeFingerprint(text) {
  const hex = String(text ?? '')
    .replace(/^.*=/, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : '';
}

export class PinError extends Error {
  constructor(pinned, seen) {
    super(`certificate fingerprint ${seen} is not the pinned ${pinned}`);
    this.code = 'cert-mismatch';
    this.pinned = pinned;
    this.seen = seen;
  }
}

/**
 * Pinned TLS connection. Resolves with { socket, handshakeMs, protocol, cipher }: the fingerprint
 * has been compared and no HTTP byte has been sent yet.
 */
export function pinnedConnect(base, pin, { timeoutMs = 10000, localAddress } = {}) {
  const url = new URL(base);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || 443);
  const expected = normalizeFingerprint(pin);
  if (!expected) return Promise.reject(new Error('bad fingerprint'));
  const seenOf = (cert) => normalizeFingerprint(cert?.fingerprint256);
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const socket = tls.connect({
      host,
      port,
      localAddress,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, // self-signed: the fingerprint comparison below replaces it
      checkServerIdentity: (_name, cert) => {
        const seen = seenOf(cert);
        return seen === expected ? undefined : new PinError(expected, seen);
      },
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error(`timeout after ${timeoutMs} ms`), { code: 'timeout' }));
    }, timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const seen = seenOf(socket.getPeerCertificate());
      if (seen !== expected) {
        socket.destroy();
        reject(new PinError(expected, seen));
        return;
      }
      resolve({
        socket,
        handshakeMs: performance.now() - t0,
        protocol: socket.getProtocol(),
        cipher: socket.getCipher()?.standardName ?? socket.getCipher()?.name,
      });
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * One request on a new pinned connection. Resolves with { status, headers, body, json,
 * handshakeMs, requestMs, protocol, cipher }; body is a string, json an object or null.
 */
export async function pinnedRequest(base, pin, method, path, options = {}) {
  const { body, token, timeoutMs = 10000, localAddress } = options;
  const conn = await pinnedConnect(base, pin, { timeoutMs, localAddress });
  const headers = { Connection: 'close' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(payload.length);
  }
  const url = new URL(path, base);
  try {
    return await new Promise((resolve, reject) => {
      const t0 = performance.now();
      const req = https.request(
        // No agent: with `agent: false` Node makes its own agent, which ignores createConnection
        // and opens an unpinned connection.
        url,
        { method, headers, createConnection: () => conn.socket, timeout: timeoutMs },
        (res) => {
          // The request must have gone over the pinned socket, never over another connection.
          if (res.socket !== conn.socket) {
            res.destroy();
            reject(new Error('response on an unpinned connection'));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: text,
              json,
              handshakeMs: conn.handshakeMs,
              requestMs: performance.now() - t0,
              protocol: conn.protocol,
              cipher: conn.cipher,
            });
          });
        },
      );
      req.on('timeout', () =>
        req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })),
      );
      req.on('error', reject);
      req.end(payload);
    });
  } finally {
    payload?.fill(0); // a sign-in body holds the password
    conn.socket.destroy();
  }
}

export async function login(base, pin, user, password, options = {}) {
  const r = await pinnedRequest(base, pin, 'POST', '/api/v1/auth/login', {
    ...options,
    body: JSON.stringify({ user, password }),
  });
  return r;
}

export const session = (base, pin, token, options = {}) =>
  pinnedRequest(base, pin, 'GET', '/api/v1/auth/session', { ...options, token });

export const logout = (base, pin, token, options = {}) =>
  pinnedRequest(base, pin, 'POST', '/api/v1/auth/logout', { ...options, token });

// ------------------------------------------------------------------------------- command line

async function readStdinLine() {
  const chunks = [];
  for await (const c of process.stdin) {
    chunks.push(c);
    if (Buffer.concat(chunks).includes(10)) break;
  }
  return Buffer.concat(chunks).toString('utf8').split('\n')[0].replace(/\r$/, '');
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      reject(new Error('no password: use --password-stdin or MAT_DEVICE_PASSWORD'));
      return;
    }
    process.stderr.write(question);
    input.setRawMode(true);
    input.resume();
    let value = '';
    const done = (err) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}

function summary(r, extra = {}) {
  return {
    status: r.status,
    error: r.json?.error,
    handshakeMs: Math.round(r.handshakeMs * 10) / 10,
    requestMs: Math.round(r.requestMs * 10) / 10,
    protocol: r.protocol,
    cipher: r.cipher,
    ...extra,
  };
}

async function main(argv) {
  const usage =
    'Usage: node tools/measure/device-api.mjs <https://host:port> --fingerprint <fp> [--user <name>] [--password-stdin] [--out f.json] [login|session|logout ...]';
  const args = [...argv];
  const take = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  if (args.some((a) => /^--password(=|$)/.test(a))) {
    console.error('device-api: passwords are not taken on the command line');
    return 2;
  }
  const pin = take('--fingerprint');
  const user = take('--user') ?? 'admin';
  const out = take('--out');
  const stdinPassword = flag('--password-stdin');
  const base = args.find((a) => /^https:\/\//.test(a))?.replace(/\/$/, '');
  const commands = args.filter((a) => a !== base);
  if (!base || !normalizeFingerprint(pin)) {
    console.error(usage);
    return 2;
  }
  const list = commands.length ? commands : ['login', 'session', 'logout'];
  const unknown = list.filter((c) => !['login', 'session', 'logout'].includes(c));
  if (unknown.length) {
    console.error(`device-api: unknown command ${unknown.join(', ')}\n${usage}`);
    return 2;
  }

  let token = process.env.MAT_DEVICE_TOKEN || '';
  const result = { base, fingerprint: normalizeFingerprint(pin), user, steps: [] };
  let rc = 0;
  try {
    for (const cmd of list) {
      if (cmd === 'login') {
        let password = stdinPassword
          ? await readStdinLine()
          : process.env.MAT_DEVICE_PASSWORD || (await promptHidden(`Password for ${user}: `));
        const r = await login(base, pin, user, password);
        password = '';
        token = r.json?.token ?? '';
        result.steps.push(
          summary(r, {
            command: 'login',
            role: r.json?.role,
            idleTimeoutS: r.json?.idleTimeoutS,
            maxLifetimeS: r.json?.maxLifetimeS,
            retryAfterS: r.json?.retryAfterS,
            tokenLength: token.length,
          }),
        );
        if (r.status !== 200) rc = 1;
      } else if (cmd === 'session') {
        const r = await session(base, pin, token);
        result.steps.push(
          summary(r, { command: 'session', user: r.json?.user, role: r.json?.role }),
        );
        if (r.status !== 200) rc = 1;
      } else {
        const r = await logout(base, pin, token);
        result.steps.push(summary(r, { command: 'logout' }));
        if (r.status !== 204) rc = 1;
        token = '';
      }
    }
  } catch (e) {
    result.error =
      e instanceof PinError
        ? { code: e.code, pinned: e.pinned, seen: e.seen }
        : { code: e.code ?? 'error', message: e.message };
    rc = 3;
  }
  result.pass = rc === 0;
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (out) writeFileSync(out, json + '\n');
  return rc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
