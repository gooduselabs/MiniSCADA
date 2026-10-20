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
import { readFileSync, writeFileSync } from 'node:fs';
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
  const { body, bytes, headers: extraHeaders, token, timeoutMs = 10000, localAddress } = options;
  const conn = await pinnedConnect(base, pin, { timeoutMs, localAddress });
  const headers = { Connection: 'close', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (bytes !== undefined) {
    payload = Buffer.from(bytes); // a package: the caller sets Content-Type and the X-Mat-* headers
    headers['Content-Length'] = String(payload.length);
  } else if (body !== undefined) {
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
            const bodyBytes = Buffer.concat(chunks);
            const text = bodyBytes.toString('utf8');
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
              bodyBytes,
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
    if (bytes === undefined) payload?.fill(0); // a sign-in body holds the password
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

// ------------------------------------------------------------------- project (feature 005, US2-US4)

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST /project/deployments with a package (Content-Type application/zip, X-Mat-* headers). */
export const deployPackage = (base, pin, token, bytes, digest, baseDigest, options = {}) =>
  pinnedRequest(base, pin, 'POST', '/api/v1/project/deployments', {
    ...options,
    token,
    bytes,
    headers: {
      'Content-Type': 'application/zip',
      'X-Mat-Digest': digest,
      'X-Mat-Base-Digest': baseDigest,
    },
  });

/** GET /project/package[?seq=<n>]: bodyBytes are the package; header X-Mat-Digest. */
export const fetchPackage = (base, pin, token, seq, options = {}) =>
  pinnedRequest(
    base,
    pin,
    'GET',
    `/api/v1/project/package${seq === undefined ? '' : `?seq=${seq}`}`,
    { ...options, token },
  );

export const restoreVersion = (base, pin, token, seq, baseDigest, options = {}) =>
  pinnedRequest(base, pin, 'POST', '/api/v1/project/restore', {
    ...options,
    token,
    body: JSON.stringify({ seq, baseDigest }),
  });

export const versions = (base, pin, token, options = {}) =>
  pinnedRequest(base, pin, 'GET', '/api/v1/project/versions', { ...options, token });

export const diagnostics = (base, pin, token, options = {}) =>
  pinnedRequest(base, pin, 'GET', '/api/v1/diagnostics', { ...options, token });

/** GET /drivers/diagnostics (device-api 1.1 section 5): the channels, field devices and bad Tags. */
export const driversDiagnostics = (base, pin, token, options = {}) =>
  pinnedRequest(base, pin, 'GET', '/api/v1/drivers/diagnostics', { ...options, token });

/** GET /serial/ports[?probe=1] (device-api 1.1 section 6). */
export const serialPorts = (base, pin, token, probe = false, options = {}) =>
  pinnedRequest(base, pin, 'GET', `/api/v1/serial/ports${probe ? '?probe=1' : ''}`, {
    ...options,
    token,
  });

/** POST /tags/write (device-api 1.1 section 3.1): requests = [{ requestId, tag, value }]. */
export const tagsWrite = (base, pin, token, requests, options = {}) =>
  pinnedRequest(base, pin, 'POST', '/api/v1/tags/write', {
    ...options,
    token,
    body: JSON.stringify({ requests }),
  });

/** GET /tags/write?ids=a,b (section 3.2): the results of up to 16 commands. */
export const tagsResults = (base, pin, token, ids, options = {}) =>
  pinnedRequest(base, pin, 'GET', '/api/v1/tags/write?ids=' + ids.join(','), { ...options, token });

/** POST /drivers/test (section 4): { channel, device, read? }. */
export const driversTest = (base, pin, token, config, options = {}) =>
  pinnedRequest(base, pin, 'POST', '/api/v1/drivers/test', {
    ...options,
    token,
    body: JSON.stringify(config),
  });

/** GET /audit with the filters of contract section 7: { from, to, user, action, before, limit }. */
export function audit(base, pin, token, filters = {}, options = {}) {
  const q = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return pinnedRequest(base, pin, 'GET', `/api/v1/audit${q ? `?${q}` : ''}`, {
    ...options,
    token,
  });
}

/**
 * Polls GET /project/deployments/<opId> until the operation has a result other than "running". The
 * device restarts itself during a deploy (1-3 s of refused connections): errors are retried. A
 * process killed and started again has lost the sessions (only an execv keeps them): on 401 the
 * optional `reauth` () => token signs in again.
 * Resolves with { op, ms, polls }.
 */
export async function waitOperation(
  base,
  pin,
  token,
  opId,
  { timeoutMs = 60000, everyMs = 250, reauth } = {},
) {
  const t0 = performance.now();
  let polls = 0;
  let op = null;
  while (performance.now() - t0 < timeoutMs) {
    polls++;
    try {
      const r = await pinnedRequest(base, pin, 'GET', `/api/v1/project/deployments/${opId}`, {
        token,
        timeoutMs: 3000,
      });
      if (r.status === 200) {
        op = r.json;
        if (op.result !== 'running') break;
      } else if (r.status === 401 && reauth) {
        token = await reauth();
      }
    } catch {
      /* the device is restarting */
    }
    await sleepMs(everyMs);
  }
  return { op, ms: performance.now() - t0, polls };
}

/** The digest of a package file, from its manifest (the first entry, matscada.json). */
export async function packageDigest(bytes) {
  const { manifestOf } = await import('../../tests/device-it/pack.mjs');
  return manifestOf(bytes).digest;
}

// ------------------------------------------------------------------- live channel (feature 013)

/**
 * /api/v1/live over a pinned TLS connection with `Authorization: Bearer <token>` (the WebSocket of
 * Node sets neither the header nor the pin). Feature 013: an anonymous live session only gets the
 * Tags of the items it views, the engineer's tools (Bearer, engineer or above) get every Tag.
 * Resolves after the 101 with { send(text), close(), onmessage, onclose } — `onmessage` receives
 * { data } for every text message, as the WebSocket of the browser; rejects on another status.
 * For the tests only: no compression, the client sends unfragmented masked frames.
 */
export async function pinnedWebSocket(base, pin, token, path = '/api/v1/live') {
  const conn = await pinnedConnect(base, pin, { timeoutMs: 10000 });
  const socket = conn.socket;
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${new URL(base).host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  if (token) lines.push(`Authorization: Bearer ${token}`);
  const ws = { onmessage: null, onclose: null, closeCode: null };
  const sendFrame = (opcode, payload) => {
    const data = Buffer.from(payload);
    const mask = Buffer.from(crypto.getRandomValues(new Uint8Array(4)));
    let head;
    if (data.length < 126) head = Buffer.from([0x80 | opcode, 0x80 | data.length]);
    else if (data.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 126;
      head.writeUInt16BE(data.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 127;
      head.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    if (!socket.destroyed) socket.write(Buffer.concat([head, mask, masked]));
  };
  let buf = Buffer.alloc(0);
  let parts = []; // a fragmented text message
  const parse = () => {
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
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
      const payload = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (opcode === 1 || opcode === 0) {
        parts.push(payload);
        if (fin) {
          const text = Buffer.concat(parts).toString('utf8');
          parts = [];
          ws.onmessage?.({ data: text });
        }
      } else if (opcode === 8) {
        ws.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        socket.destroy();
      } else if (opcode === 9) {
        sendFrame(10, payload);
      }
    }
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('websocket: no answer to the upgrade'));
    }, 10000);
    let upgraded = false;
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString('latin1');
        const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
        clearTimeout(timer);
        if (status !== 101) {
          socket.destroy();
          reject(new Error(`websocket: HTTP ${status}`));
          return;
        }
        buf = buf.subarray(end + 4);
        upgraded = true;
        resolve();
      }
      parse();
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (!upgraded) reject(new Error('websocket: closed before the upgrade'));
      ws.onclose?.({ code: ws.closeCode ?? 1006 });
    });
    socket.on('error', () => {
      // 'close' follows
    });
    socket.write(lines.join('\r\n') + '\r\n\r\n');
  });
  ws.send = (text) => {
    if (socket.destroyed) throw new Error('websocket: closed');
    sendFrame(1, text);
  };
  ws.close = () => {
    try {
      sendFrame(8, Buffer.from([0x03, 0xe8]));
    } catch {
      // closed already
    }
    socket.end();
    setTimeout(() => socket.destroy(), 200).unref();
  };
  return ws;
}

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
    'Usage: node tools/measure/device-api.mjs <https://host:port> --fingerprint <fp> [--user <name>] [--password-stdin] [--out f.json] [login|session|logout|deploy|fetch|restore|diag|audit|write|drivers-diag|serial-ports ...]';
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
  const pkgFile = take('--package');
  const baseDigest = take('--base-digest');
  const seqArg = take('--seq');
  const saveFile = take('--save');
  const filterUser = take('--filter-user');
  const actionArg = take('--action');
  const limitArg = take('--limit');
  const tagArg = take('--tag');
  const valueArg = take('--value'); // JSON: 75, true, "text"; anything else is a string
  const stdinPassword = flag('--password-stdin');
  const probeFlag = flag('--probe'); // serial-ports: ask the allowed, free ports about RS485
  const base = args.find((a) => /^https:\/\//.test(a))?.replace(/\/$/, '');
  const commands = args.filter((a) => a !== base);
  if (!base || !normalizeFingerprint(pin)) {
    console.error(usage);
    return 2;
  }
  const list = commands.length ? commands : ['login', 'session', 'logout'];
  const known = [
    'login',
    'session',
    'logout',
    'deploy',
    'fetch',
    'restore',
    'diag',
    'audit',
    'write',
    'drivers-diag',
    'serial-ports',
  ];
  const unknown = list.filter((c) => !known.includes(c));
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
      } else if (cmd === 'deploy') {
        if (!pkgFile) throw new Error('deploy needs --package <file.matscada>');
        const bytes = readFileSync(pkgFile);
        const r = await deployPackage(
          base,
          pin,
          token,
          bytes,
          await packageDigest(bytes),
          baseDigest ?? 'none',
        );
        const waited =
          r.status === 202 ? await waitOperation(base, pin, token, r.json.opId) : undefined;
        result.steps.push(
          summary(r, {
            command: 'deploy',
            opId: r.json?.opId,
            result: waited?.op?.result,
            steps: waited?.op?.steps?.map((s) => `${s.id}:${s.state}`),
            opError: waited?.op?.error?.code,
            totalMs: waited ? Math.round(waited.ms) : undefined,
          }),
        );
        if (r.status !== 202 || waited?.op?.result !== 'committed') rc = 1;
      } else if (cmd === 'fetch') {
        const r = await fetchPackage(base, pin, token, seqArg);
        if (saveFile && r.status === 200) writeFileSync(saveFile, r.bodyBytes);
        result.steps.push(
          summary(r, {
            command: 'fetch',
            digest: r.headers['x-mat-digest'],
            bytes: r.bodyBytes.length,
          }),
        );
        if (r.status !== 200) rc = 1;
      } else if (cmd === 'restore') {
        const r = await restoreVersion(base, pin, token, Number(seqArg), baseDigest);
        const waited =
          r.status === 202 ? await waitOperation(base, pin, token, r.json.opId) : undefined;
        result.steps.push(
          summary(r, { command: 'restore', opId: r.json?.opId, result: waited?.op?.result }),
        );
        if (r.status !== 202 || waited?.op?.result !== 'committed') rc = 1;
      } else if (cmd === 'diag') {
        const r = await diagnostics(base, pin, token);
        result.steps.push(summary(r, { command: 'diag', diagnostics: r.json }));
        if (r.status !== 200) rc = 1;
      } else if (cmd === 'drivers-diag') {
        // the tree of channels and field devices with the counters of FR-029 (SC-016)
        const r = await driversDiagnostics(base, pin, token);
        const tree = (r.json?.channels ?? []).map((c) => ({
          id: c.id,
          state: c.state,
          lastError: c.lastError,
          reconnects: c.reconnects,
          devices: c.devices.map((d) => ({
            id: d.id,
            state: d.state,
            requestsOk: d.requestsOk,
            timeouts: d.timeouts,
            exceptions: d.exceptions,
            badFrames: d.badFrames,
            responseMs: d.responseMs,
          })),
        }));
        result.steps.push(
          summary(r, {
            command: 'drivers-diag',
            tree,
            badTags: r.json?.badTags?.length,
            badTagsTruncated: r.json?.badTagsTruncated,
          }),
        );
        if (r.status !== 200) rc = 1;
      } else if (cmd === 'serial-ports') {
        const r = await serialPorts(base, pin, token, probeFlag);
        result.steps.push(summary(r, { command: 'serial-ports', ports: r.json?.ports }));
        if (r.status !== 200) rc = 1;
      } else if (cmd === 'write') {
        // writes one value and polls the result every 200 ms until it is final (at most 30 s)
        if (!tagArg || valueArg === undefined)
          throw new Error('write needs --tag <id> --value <json>');
        let value;
        try {
          value = JSON.parse(valueArg);
        } catch {
          value = valueArg;
        }
        const requestId = crypto.randomUUID();
        const t0 = performance.now();
        const r = await tagsWrite(base, pin, token, [{ requestId, tag: tagArg, value }]);
        let final = r.json?.results?.[0];
        while (final?.status === 'ACCEPTED' && performance.now() - t0 < 30000) {
          await sleepMs(200);
          final = (await tagsResults(base, pin, token, [requestId])).json?.results?.[0];
        }
        result.steps.push(
          summary(r, {
            command: 'write',
            requestId,
            final,
            totalMs: Math.round(performance.now() - t0),
          }),
        );
        if (r.status !== 200 || final?.status !== 'CONFIRMED') rc = 1;
      } else if (cmd === 'audit') {
        const r = await audit(base, pin, token, {
          user: filterUser,
          action: actionArg,
          limit: limitArg,
        });
        result.steps.push(summary(r, { command: 'audit', body: r.json }));
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
