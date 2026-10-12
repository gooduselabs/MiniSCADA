// Runtime giả cho e2e theo dõi thiết bị (feature 004, T069): HTTP `GET /api/v1/system/info` và WebSocket
// `/api/v1/live` nói giao thức live 1.0.0 (specs/002-vertical-slice/contracts/live-ws.md): `hello` khi nhận
// phiên; `subscribe` → `snapshot` theo đúng thứ tự yêu cầu, Tag lạ trong `unknown`; `delta`
// `[index, value, quality]` mỗi 250 ms khi có Tag đổi; `heartbeat` mỗi 5 s. Chế độ đầy gửi
// MAX_CLIENTS_REACHED rồi đóng 4429; chế độ treo không trả lời system/info. `stop()` giả lập runtime tắt
// (cắt TCP mọi phiên, ngừng nghe), `start()` bật lại trên cùng cổng. Ghi lại lần mở/đóng phiên để test đo
// thời gian thiết bị nhận lại phiên. Chỉ dùng khi chạy e2e (gói `ws` có sẵn qua puppeteer-core).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PROTOCOL = '1.0.0';
const MAX_CLIENTS = 10;

/** Giá trị của thiết bị giả; TANK01.TEMP cố ý không có (Tag lạ). */
function initialValues() {
  return new Map([
    ['TANK01.LEVEL', 42],
    ['MOTOR01.RUN', true],
    ['MOTOR01.SPEED', 1440],
    ['TANK01.INFLOW', 9.5],
  ]);
}

/**
 * Bật runtime giả trên 127.0.0.1, cổng ngẫu nhiên. Trả bộ điều khiển: `address` (host:port), `setFull`,
 * `setHang`, `stop`, `start`, `close`, `openCount()`, `maxConcurrent`, `log` (mở, đóng, từ chối).
 */
export async function startFakeRuntime() {
  const startedAt = Date.now();
  const values = initialValues();
  /** Tag đang BAD kèm lý do (live 1.2.0): id → reason. */
  const bad = new Map();
  const sessions = new Set();
  const log = [];
  const state = { full: false, hang: false, maxConcurrent: 0, accepted: 0, tick: 0 };
  let port = 0;
  let http = null;
  let wss = null;

  const info = () => ({
    runtimeVersion: '0.3.0',
    protocolVersion: PROTOCOL,
    schemaVersions: ['0.1'],
    clients: sessions.size,
    maxClients: MAX_CLIENTS,
    rejectedTotal: log.filter((e) => e.type === 'rejected').length,
    uptimeS: Math.floor((Date.now() - startedAt) / 1000),
    project: { status: 'active', projectId: 'tank-demo', projectVersion: '0.1.0', errors: [] },
    tagCount: values.size,
    historian: {
      enabled: true,
      state: 'running',
      clock: 'ok',
      groups: 2,
      rowsWritten: 15234,
      dbBytes: 12582912,
      dbMaxBytes: 2147483648,
      warnings: [],
      lastError: null,
      destinations: [
        { id: 'kho-du-lieu', type: 'postgresql', state: 'ok', pendingRows: 0, lagS: 0.4 },
      ],
    },
  });

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function onHttp(req, res) {
    const headers = {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET' });
      res.end();
      return;
    }
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method !== 'GET' || path !== '/api/v1/system/info') {
      res.writeHead(404, headers);
      res.end();
      return;
    }
    if (state.hang) return; // không trả lời: Studio phải tự báo sau 3 s
    res.writeHead(200, { ...headers, 'content-type': 'application/json' });
    res.end(JSON.stringify(info()));
  }

  function onConnection(ws) {
    if (state.full) {
      log.push({ type: 'rejected', at: Date.now() });
      send(ws, {
        type: 'error',
        code: 'MAX_CLIENTS_REACHED',
        message: `Hệ thống đã đạt tối đa ${MAX_CLIENTS} kết nối. Vui lòng thử lại sau.`,
      });
      ws.close(4429, 'full');
      return;
    }
    const session = { ws, sub: null };
    sessions.add(session);
    state.accepted++;
    state.maxConcurrent = Math.max(state.maxConcurrent, sessions.size);
    log.push({ type: 'open', at: Date.now() });
    send(ws, {
      type: 'hello',
      protocolVersion: PROTOCOL,
      serverVersion: '0.3.0-e2e',
      maxClients: MAX_CLIENTS,
      heartbeatMs: 5000,
      timeoutMs: 15000,
      project: { projectId: 'tank-demo', projectVersion: '0.1.0' },
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        send(ws, { type: 'error', code: 'BAD_MESSAGE', message: 'bad json' });
        return;
      }
      if (msg.type === 'subscribe') {
        const asked = Array.isArray(msg.tags) ? msg.tags.map(String) : [];
        const ids = asked.filter((id) => values.has(id));
        const unknown = asked.filter((id) => !values.has(id));
        if (!ids.length) {
          send(ws, {
            type: 'error',
            code: 'NO_VALID_TAGS',
            message: 'no valid tags',
            requestId: msg.requestId,
          });
          return;
        }
        const seq = (session.sub?.sequence ?? 0) + 1;
        const now = Date.now();
        session.sub = {
          id: String(msg.requestId),
          ids,
          sequence: seq,
          sent: ids.map((id) => values.get(id)),
          sentBad: ids.map((id) => bad.get(id) ?? null),
        };
        send(ws, {
          type: 'snapshot',
          subscriptionId: session.sub.id,
          sequence: seq,
          ts: now,
          tags: ids.map((id) => ({
            id,
            value: values.get(id),
            quality: bad.has(id) ? 'BAD' : 'GOOD',
            ...(bad.has(id) ? { reason: bad.get(id) } : {}),
            sourceTimestamp: now,
            serverTimestamp: now,
            revision: 1,
          })),
          unknown,
        });
      } else if (msg.type === 'unsubscribe') session.sub = null;
    });
    ws.on('close', (code) => {
      sessions.delete(session);
      log.push({ type: 'close', at: Date.now(), code });
    });
  }

  /** Mỗi 250 ms: đổi giá trị, gửi delta cho Tag đổi; mỗi 5 s gửi heartbeat. */
  const timer = setInterval(() => {
    state.tick++;
    const t = state.tick;
    values.set('TANK01.LEVEL', t % 8 < 4 ? 42 : 43);
    values.set('MOTOR01.SPEED', 1440 + (t % 2));
    values.set('TANK01.INFLOW', Math.round((9.5 + Math.sin(t / 8)) * 10) / 10);
    for (const s of sessions) {
      if (t % 20 === 0) send(s.ws, { type: 'heartbeat', ts: Date.now() });
      const sub = s.sub;
      if (!sub) continue;
      const changes = [];
      sub.ids.forEach((id, i) => {
        const v = values.get(id);
        const r = bad.get(id) ?? null;
        if (v !== sub.sent[i] || r !== sub.sentBad[i]) {
          sub.sent[i] = v;
          sub.sentBad[i] = r;
          changes.push(r ? [i, v, 'BAD', r] : [i, v, 'GOOD']);
        }
      });
      if (!changes.length) continue;
      sub.sequence++;
      send(s.ws, {
        type: 'delta',
        subscriptionId: sub.id,
        sequence: sub.sequence,
        ts: Date.now(),
        tags: changes,
      });
    }
  }, 250);

  async function start() {
    http = createServer(onHttp);
    wss = new WebSocketServer({ server: http, path: '/api/v1/live' });
    wss.on('connection', onConnection);
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, '127.0.0.1', () => {
        port = http.address().port;
        resolve();
      });
    });
  }

  /** Runtime tắt: cắt TCP mọi phiên (client thấy mất kết nối), ngừng nghe. */
  async function stop() {
    if (!http) return;
    for (const s of sessions) s.ws.terminate();
    sessions.clear();
    const server = http;
    http = null;
    wss.close();
    wss = null;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  await start();
  return {
    get port() {
      return port;
    },
    get address() {
      return `127.0.0.1:${port}`;
    },
    log,
    get maxConcurrent() {
      return state.maxConcurrent;
    },
    get accepted() {
      return state.accepted;
    },
    openCount: () => sessions.size,
    setFull: (on) => void (state.full = on),
    setHang: (on) => void (state.hang = on),
    /** Đặt Tag BAD kèm lý do (null: trở lại GOOD); delta kế tiếp mang `reason` ở vị trí thứ tư. */
    setBad: (id, reason) => void (reason ? bad.set(id, reason) : bad.delete(id)),
    stop,
    start,
    async close() {
      clearInterval(timer);
      await stop();
    },
  };
}
