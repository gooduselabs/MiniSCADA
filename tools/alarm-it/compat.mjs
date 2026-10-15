// Kiểm tương thích của feature 009 (T113, T115; FR-014, FR-045, FR-063; SC-015):
//   A. client live 1.2.0 đóng băng (tests/compat/live-client-1.2/, chép từ packages/live-client trước commit 16e7b2f) với runtime
//      x64 1.3.0 đang chạy project có alarm: Tag chạy, 0 bản tin alarm, 0 lỗi;
//   B. client live 1.3.0 hiện hành (packages/live-client) với server giả 1.2.0 (không `features`): không gửi subscribeAlarms,
//      `alarmSupport` = unsupported; và với server giả 1.3.0 không `alarms`: `none`, không gửi; có `alarms`: gửi một lần;
//   C. project 0.1, 0.2, 0.3, 0.4 trên runtime 0.8 (x64): chạy, Tag đổi theo nguồn, hello không có alarm, /api/v1/alarms rỗng.
//      Không có binary runtime 0.6/0.7 để so cạnh nhau: kỳ vọng so với hợp đồng cũ (không `features.alarms`, Tag và nguồn như trước).
//   node tools/alarm-it/compat.mjs [--root <repo>]     → một dòng JSON; cần rig đang chạy (it-basic) cho phần A, và MAT_IT_BUILD cho phần C.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  emit,
  getAlarms,
  httpGet,
  makeReport,
  simHolding,
  simCoil,
  sleep,
  waitFor,
  waitRuntime,
} from './lib.mjs';

const args = process.argv.slice(2);
const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
const r = makeReport('compat');
const m = r.measures;
const WS =
  (process.env.MAT_IT_HTTP ?? 'http://127.0.0.1:28080').replace('http', 'ws') + '/api/v1/live';

const old12 = await import(pathToFileURL(join(root, 'tests/compat/live-client-1.2/index.ts')).href);
const cur13 = await import(pathToFileURL(join(root, 'packages/live-client/src/index.ts')).href);

/** Gói WebSocket của Node thành SocketLike và ghi mọi bản tin tới/đi. */
function recordingSocket(log) {
  return (url) => {
    const ws = new WebSocket(url);
    const s = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (d) => {
        log.sent.push(JSON.parse(d));
        ws.send(d);
      },
      close: (c, reason) => ws.close(c, reason),
    };
    ws.onopen = () => s.onopen?.();
    ws.onmessage = (ev) => {
      try {
        log.recv.push(JSON.parse(String(ev.data)));
      } catch {
        log.recv.push({ type: '?' });
      }
      s.onmessage?.({ data: ev.data });
    };
    ws.onclose = (ev) => s.onclose?.({ code: ev.code });
    return s;
  };
}

// ---------------------------------------------------------------------------------------- A

const lvl = (c) => c.live.values[c.live.ids.indexOf('IT.LEVEL')];

async function partA() {
  await waitRuntime(60000);
  const log = { sent: [], recv: [] };
  const states = [];
  const conn = new old12.LiveConnection({
    url: WS,
    tags: ['IT.LEVEL', 'IT.FAULT'],
    createSocket: recordingSocket(log),
  });
  conn.onState = (s) => states.push(s);
  conn.start();
  const live = await waitFor(
    () => (conn.state === 'live' ? true : null),
    15000,
    'client 1.2 live',
  ).catch(() => null);
  r.check(
    'A: client 1.2.0 đóng băng nối được runtime 1.3.0 và lên trạng thái live',
    Boolean(live),
    states.join('>'),
  );
  const hello = log.recv.find((x) => x.type === 'hello');
  r.check(
    'A: hello 1.3.0 có features alarms mà client 1.2 không hiểu vẫn nhận được',
    hello?.protocolVersion === '1.3.0' && hello.features?.includes('alarms'),
    JSON.stringify(hello?.protocolVersion),
  );
  // đổi Tag nguồn và bật một alarm: client 1.2 thấy Tag, không thấy alarm
  await simHolding(0, 33);
  await waitFor(() => (lvl(conn) === 33 ? true : null), 8000, 'IT.LEVEL=33').catch(() => null);
  const v1 = lvl(conn);
  await simCoil(0, 1);
  const alarms = await waitFor(
    async () => ((await getAlarms()).instances.some((i) => i.id === 'IT_FAULT') ? true : null),
    10000,
    'alarm bật',
  ).catch(() => null);
  await sleep(1500);
  await simHolding(0, 44);
  await waitFor(() => (lvl(conn) === 44 ? true : null), 8000, 'IT.LEVEL=44').catch(() => null);
  const v2 = lvl(conn);
  r.check(`A: Tag chạy như cũ (IT.LEVEL ${v1} rồi ${v2})`, v1 === 33 && v2 === 44);
  r.check(
    'A: runtime đã có alarm thật trong lúc client 1.2 nối (điều kiện của phép thử)',
    Boolean(alarms),
  );
  const alarmMsgs = log.recv.filter((x) => String(x.type).toLowerCase().includes('alarm'));
  const errors = log.recv.filter((x) => x.type === 'error');
  r.check(
    `A: 0 bản tin alarm tới client 1.2.0 (nhận ${log.recv.length} bản tin, ${alarmMsgs.length} alarm)`,
    alarmMsgs.length === 0,
  );
  r.check(
    'A: 0 bản tin error, 0 lỗi trong LiveState, trạng thái không incompatible/offline',
    errors.length === 0 &&
      (conn.live.errors?.length ?? 0) === 0 &&
      !states.some((s) => ['incompatible', 'offline'].includes(s)),
    `${errors.length} error; ${states.join('>')}`,
  );
  r.check(
    'A: client 1.2.0 không gửi gì ngoài subscribe/heartbeat',
    log.sent.every((x) => ['subscribe', 'heartbeat', 'unsubscribe'].includes(x.type)),
    [...new Set(log.sent.map((x) => x.type))].join(','),
  );
  m.partA = { received: log.recv.length, types: [...new Set(log.recv.map((x) => x.type))], states };
  conn.stop?.();
  await simCoil(0, 0);
  await simHolding(0, 0);
}

// ---------------------------------------------------------------------------------------- B

/** Server WebSocket giả tối thiểu: bắt tay, gửi `hello` do kịch bản định, ghi mọi khung client gửi. */
function fakeServer(helloMsg) {
  const received = [];
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const send = (obj) => {
      const p = Buffer.from(JSON.stringify(obj));
      const head =
        p.length < 126
          ? Buffer.from([0x81, p.length])
          : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
      socket.write(Buffer.concat([head, p]));
    };
    send(helloMsg);
    socket.on('data', (buf) => {
      let i = 0;
      while (i + 6 <= buf.length) {
        const op = buf[i] & 15;
        let len = buf[i + 1] & 127;
        let off = i + 2;
        if (len === 126) {
          len = buf.readUInt16BE(off);
          off += 2;
        }
        const mask = buf.subarray(off, off + 4);
        const data = Buffer.from(
          buf.subarray(off + 4, off + 4 + len).map((b, k) => b ^ mask[k % 4]),
        );
        if (op === 1) {
          try {
            const msg = JSON.parse(data.toString('utf8'));
            received.push(msg);
            if (msg.type === 'subscribe')
              send({
                type: 'snapshot',
                subscriptionId: msg.requestId,
                sequence: 1,
                ts: Date.now(),
                tags: [],
                unknown: [],
              });
          } catch {
            /* bỏ */
          }
        }
        i = off + 4 + len;
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, received, close: () => server.close() }),
    ),
  );
}

const baseHello = (v, features) => ({
  type: 'hello',
  protocolVersion: v,
  serverVersion: v === '1.2.0' ? '0.7.0' : '0.8.0',
  maxClients: 10,
  heartbeatMs: 5000,
  timeoutMs: 15000,
  ...(features ? { features } : {}),
  project: { digest: 'sha256:' + '0'.repeat(64) },
});

async function partB() {
  for (const [name, hello, expectSupport, expectSub] of [
    ['server giả 1.2.0 (không features)', baseHello('1.2.0'), 'unsupported', false],
    ['server giả 1.3.0 không alarm (không features.alarms)', baseHello('1.3.0', []), 'none', false],
    ['server giả 1.3.0 có features.alarms', baseHello('1.3.0', ['alarms']), 'supported', true],
  ]) {
    const srv = await fakeServer(hello);
    const log = { sent: [], recv: [] };
    const conn = new cur13.LiveConnection({
      url: `ws://127.0.0.1:${srv.port}/api/v1/live`,
      tags: ['X.TAG'],
      createSocket: recordingSocket(log),
    });
    let support = null;
    conn.onAlarmSupport = (s) => (support = s);
    conn.subscribeAlarms();
    conn.start();
    await sleep(1500);
    const subs = srv.received.filter((x) => x.type === 'subscribeAlarms');
    r.check(
      `B: client 1.3.0 với ${name}: alarmSupport = ${expectSupport} (thấy ${support ?? conn.alarmSupport})`,
      (support ?? conn.alarmSupport) === expectSupport,
    );
    r.check(
      `B: ${name}: ${expectSub ? 'gửi đúng một subscribeAlarms' : 'không gửi subscribeAlarms'} (gửi ${subs.length})`,
      expectSub ? subs.length === 1 : subs.length === 0,
    );
    r.check(
      `B: ${name}: Tag vẫn đăng ký bình thường, không lỗi`,
      srv.received.some((x) => x.type === 'subscribe') &&
        !['incompatible', 'offline'].includes(conn.state),
      conn.state,
    );
    conn.stop?.();
    srv.close();
  }
}

// ---------------------------------------------------------------------------------------- C

function compose(projectContainerPath, mapPath, down = false) {
  const cf = join(root, 'tests/alarm-it/compose.yaml');
  const env = { ...process.env, MAT_IT_PROJECT: projectContainerPath, MAT_IT_MAP: mapPath };
  execFileSync('docker', ['compose', '-f', cf, '-p', 'mat-alarm-it', 'down', '-v'], {
    env,
    stdio: 'ignore',
  });
  if (!down)
    execFileSync('docker', ['compose', '-f', cf, '-p', 'mat-alarm-it', 'up', '-d'], {
      env,
      stdio: 'ignore',
    });
}

async function wsFirstMessages(tagIds) {
  return new Promise((resolve) => {
    const msgs = [];
    const ws = new WebSocket(WS);
    const done = () => {
      try {
        ws.close();
      } catch {
        /* đã đóng */
      }
      resolve(msgs);
    };
    const timer = setTimeout(done, 4000);
    ws.onmessage = (ev) => {
      const m2 = JSON.parse(String(ev.data));
      msgs.push(m2);
      if (m2.type === 'hello')
        ws.send(JSON.stringify({ type: 'subscribe', requestId: 'c', tags: tagIds }));
      if (m2.type === 'snapshot') {
        clearTimeout(timer);
        setTimeout(done, 300);
      }
    };
    ws.onerror = () => done();
  });
}

async function partC() {
  const projects = [
    [
      '0.1 tank-demo',
      '/src/projects/tank-demo',
      '/src/tests/alarm-it/map.json',
      'projects/tank-demo',
    ],
    [
      '0.2 modbus-demo',
      '/src/projects/modbus-demo',
      '/src/tools/modbus-sim/maps/modbus-demo.json',
      'projects/modbus-demo',
    ],
    [
      '0.3 dashboard-demo',
      '/src/projects/dashboard-demo',
      '/src/tools/modbus-sim/maps/modbus-demo.json',
      'projects/dashboard-demo',
    ],
    [
      '0.4 dashboard-demo',
      '/src/tests/migration-vectors/0.4-to-0.5/dashboard-demo/before',
      '/src/tools/modbus-sim/maps/modbus-demo.json',
      'tests/migration-vectors/0.4-to-0.5/dashboard-demo/before',
    ],
  ];
  m.partC = [];
  for (const [name, cpath, map, hostPath] of projects) {
    compose(cpath, map);
    const up = await waitFor(
      async () => {
        try {
          const x = await httpGet('/api/v1/alarms');
          return x.status === 200 ? x : null;
        } catch {
          return null;
        }
      },
      60000,
      `runtime ${name}`,
      500,
    ).catch(() => null);
    r.check(`C: project ${name} chạy trên runtime 0.8 (GET /api/v1/alarms 200)`, Boolean(up));
    if (!up) continue;
    const a = up.json;
    r.check(
      `C: ${name}: /api/v1/alarms rỗng (instances 0, revision 0, counts 0)`,
      a.instances.length === 0 && a.revision === 0 && a.counts.active === 0,
      JSON.stringify(a).slice(0, 120),
    );
    const tags = JSON.parse(readFileSync(join(root, hostPath, 'tags.json'), 'utf8'))
      .tags.slice(0, 3)
      .map((t) => t.id);
    const msgs = await wsFirstMessages(tags);
    const hello = msgs.find((x) => x.type === 'hello');
    const snap = msgs.find((x) => x.type === 'snapshot');
    r.check(
      `C: ${name}: hello không có features.alarms (project không có alarm)`,
      hello && !(hello.features ?? []).includes('alarms'),
      JSON.stringify(hello?.features),
    );
    r.check(
      `C: ${name}: Tag đăng ký có snapshot, không Tag lạ (${tags.join(',')})`,
      Boolean(snap) &&
        (snap.unknown ?? []).length === 0 &&
        (snap.tags ?? []).length === tags.length,
      JSON.stringify(snap ?? null).slice(0, 200),
    );
    const sub = await new Promise((res) => {
      const ws = new WebSocket(WS);
      const got = [];
      ws.onmessage = (ev) => {
        const x = JSON.parse(String(ev.data));
        got.push(x);
        if (x.type === 'hello')
          ws.send(JSON.stringify({ type: 'subscribeAlarms', requestId: 'x' }));
        if (x.type === 'alarmSnapshot') {
          ws.close();
          res(got);
        }
      };
      setTimeout(() => res(got), 3000);
    });
    const as = sub.find((x) => x.type === 'alarmSnapshot');
    r.check(
      `C: ${name}: subscribeAlarms trên project không alarm nhận alarmSnapshot rỗng (không lỗi)`,
      as && as.instances.length === 0 && as.revision === 0 && !sub.some((x) => x.type === 'error'),
      JSON.stringify(as ?? sub.map((x) => x.type)).slice(0, 160),
    );
    m.partC.push({
      name,
      hello: hello?.protocolVersion,
      tags: snap?.tags?.length ?? 0,
      alarmSnapshotEmpty: Boolean(as && as.instances.length === 0),
    });
  }
  compose('', '', true);
}

try {
  if (!args.includes('--skip-a')) await partA();
  await partB();
  if (!args.includes('--skip-c')) await partC();
} catch (e) {
  r.check(`ngoại lệ: ${String(e.stack ?? e).slice(0, 400)}`, false);
}
const out = emit(r);
process.exit(out.pass ? 0 : 1);
