// Bão alarm trên runtime x64 (feature 009 T112 phần Node, T115; FR-047, FR-035; SC-018, SC-019):
// 200 alarm bật trong một tick, 10 client live (3 chậm: không đọc socket), rồi alarm chập chờn 20 lần/phút.
//   node tools/alarm-it/storm.mjs     → một dòng JSON { scenario, checks, measures, pass }
// Project: tests/alarm-it/projects/storm-200 (tools/alarm-it.ps1 dựng rig). Client chậm dùng socket TCP thô (HTTP loopback)
// và `pause()` sau khi bắt tay, nên hàng đợi gửi của máy chủ phía họ đầy lên thật.
import net from 'node:net';
import crypto from 'node:crypto';
import {
  auditRows,
  bearer,
  emit,
  getAlarms,
  getInfo,
  httpGet,
  LiveProbe,
  makeReport,
  pct,
  simCoil,
  sleep,
  waitRuntime,
  webLogin,
  wreq,
} from './lib.mjs';

const r = makeReport('storm');
const m = r.measures;

/** Client chậm: bắt tay WebSocket, gửi subscribeAlarms (khung có che mặt), rồi ngừng đọc. */
function slowClient() {
  const u = new URL(process.env.MAT_IT_HTTP ?? 'http://127.0.0.1:28080');
  const c = {
    bytes: 0,
    closed: false,
    closeCode: null,
    buf: Buffer.alloc(0),
    socket: null,
    paused: false,
  };
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(u.port), u.hostname);
    c.socket = s;
    const key = crypto.randomBytes(16).toString('base64');
    let upgraded = false;
    s.on('connect', () => {
      s.write(
        `GET /api/v1/live HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    s.on('data', (d) => {
      c.bytes += d.length;
      c.buf = Buffer.concat([c.buf, d]);
      if (!upgraded && c.buf.includes('\r\n\r\n')) {
        upgraded = true;
        c.buf = Buffer.alloc(0);
        const payload = Buffer.from(JSON.stringify({ type: 'subscribeAlarms', requestId: 'slow' }));
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
        s.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
        setTimeout(() => {
          s.pause();
          c.paused = true;
        }, 300);
        resolve(c);
        c.hb = setInterval(() => {
          const p = Buffer.from(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
          const mk = crypto.randomBytes(4);
          s.write(
            Buffer.concat([
              Buffer.from([0x81, 0x80 | p.length]),
              mk,
              Buffer.from(p.map((b, i) => b ^ mk[i % 4])),
            ]),
          );
        }, 5000);
      }
      // código de cierre: trama 0x88
      for (let i = 0; i + 4 <= c.buf.length; i++) {
        if (c.buf[i] === 0x88 && c.buf[i + 1] >= 2 && c.buf[i + 1] < 126) {
          c.closeCode = c.buf.readUInt16BE(i + 2);
          break;
        }
      }
    });
    s.on('close', () => {
      c.closed = true;
    });
    s.on('error', (e) => {
      c.closed = true;
      if (!upgraded) reject(e);
    });
  });
}

try {
  await waitRuntime(60000);
  const s = await webLogin('vh1');
  const admin = await bearer('admin');
  await simCoil(0, 0);
  await simCoil(1, 0);
  await sleep(1500);
  const info0 = await getInfo();
  m.infoAlarmsBefore = info0?.alarms ?? null;
  const rev0 = (await getAlarms()).revision;

  // 10 client: 7 nhanh (LiveProbe), 3 chậm
  const fast = [];
  for (let i = 0; i < 7; i++) {
    const p = new LiveProbe();
    await p.open();
    await p.until((l) => l.sequence >= 1, 5000);
    fast.push(p);
  }
  const slow = [];
  for (let i = 0; i < 3; i++) slow.push(await slowClient());
  await sleep(800);
  r.check(
    '10 phiên live mở (7 nhanh, 3 chậm)',
    fast.every((p) => p.closed === null) && slow.every((c) => !c.closed),
  );

  // 200 alarm bật trong một tick: một thanh ghi đổi, 200 alarm cùng điều kiện
  const t0 = Date.now();
  await simCoil(0, 1);
  const reached = await Promise.all(
    fast.map((p) =>
      p.until(
        (l) => [...l.state.values()].filter((i) => i.state !== 'NORMAL').length >= 200,
        20000,
      ),
    ),
  );
  m.activateAllMs = Date.now() - t0;
  r.check(
    `200 alarm đang bật (200 ACTIVE_*) ở cả 7 client nhanh sau ${m.activateAllMs} ms`,
    reached.every((x) => x !== null),
  );
  const doc = await getAlarms();
  r.check(
    'GET /alarms: 200 instance active, unack = 150 (50 alarm lớp advisory không cần xác nhận vào thẳng ACTIVE_ACK)',
    doc.counts.unack === 150 && doc.counts.active === 200 && doc.instances.length === 200,
    JSON.stringify(doc.counts).slice(0, 160),
  );
  m.snapshotBytesRest = JSON.stringify(doc).length;
  m.maxMessageBytes = Math.max(...fast.map((p) => p.maxMessageBytes));
  m.deltaMessagesPerFastClient = pct(
    fast.map((p) => p.alarmMsgs.length),
    50,
  );
  r.check(
    'mọi bản tin live ≤ 64 KB (chia lô ≤ 100 phần tử)',
    m.maxMessageBytes <= 65536,
    `${m.maxMessageBytes} B`,
  );
  await sleep(6000); // để client chậm đầy hàng đợi, bảng chờ dồn
  r.check(
    'client nhanh: 0 phiên bị đóng, sequence liên tục (0 khoảng hở)',
    fast.every((p) => p.closed === null && (p.sequenceGap ?? 0) === 0),
    fast.map((p) => p.closed?.code ?? 'ok').join(','),
  );
  r.check(
    'client chậm vẫn còn kết nối (không 4409 do alarm)',
    slow.every((c) => !c.closed && c.closeCode === null),
    slow.map((c) => `${c.closed}/${c.closeCode}/${c.bytes}`).join(' '),
  );
  const info1 = await getInfo();
  m.infoAlarmsDuring = info1?.alarms ?? null;
  m.infoLive = info1?.live ?? null;

  // mọi client nhanh cùng trạng thái cuối với REST (bất biến §4.1)
  const ids = (p) => [...p.state.keys()].sort().join(',');
  r.check(
    'mọi client nhanh có cùng tập instance với GET /alarms',
    fast.every(
      (p) =>
        ids(p) ===
        doc.instances
          .map((i) => i.id)
          .sort()
          .join(','),
    ),
  );
  r.check(
    'counts live = counts REST',
    fast.every((p) => p.counts?.unack === doc.counts.unack),
  );

  // client chậm đọc lại: nhận được dữ liệu, kết nối còn sống; xin snapshot mới thì đúng
  const slowBytesBefore = slow.map((c) => c.bytes);
  slow.forEach((c) => c.socket.resume());
  await sleep(2500);
  r.check(
    'client chậm đọc lại được dữ liệu (byte tăng) và không bị đóng',
    slow.every((c, i) => c.bytes > slowBytesBefore[i] && !c.closed),
    slow.map((c, i) => `${slowBytesBefore[i]}->${c.bytes}`).join(' '),
  );
  m.slowClientBytesTotal = slow.map((c) => c.bytes);
  r.check(
    `hàng đợi gửi của client chậm ${slow.map((c) => c.bytes).join('/')} B tổng cộng ≤ 128 KB (50 % của 256 KB): chặn trên của đỉnh hàng đợi`,
    slow.every((c) => c.bytes <= 131072),
  );
  const evalBefore = m.infoAlarmsBefore?.evalMaxMs ?? 0;
  const evalDuring = m.infoAlarmsDuring?.evalMaxMs ?? 0;
  r.check(
    `thời gian đánh giá alarm lớn nhất trong bão ${evalDuring} ms, không hơn lúc yên (${evalBefore} ms) quá 5 ms`,
    evalDuring - evalBefore <= 5,
  );
  r.check(
    '0 mã đóng 4409 trên mọi client',
    slow.every((c) => c.closeCode !== 4409) && fast.every((p) => p.closed?.code !== 4409),
  );

  // độ trễ tick: đo bằng REST /system/info (nếu có) trong lúc bão; so với yên
  const lat = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await getInfo();
    lat.push(performance.now() - t);
    await sleep(100);
  }
  m.infoLatencyMs = { p50: Math.round(pct(lat, 50)), p95: Math.round(pct(lat, 95)) };

  // xác nhận tất cả (một dòng audit) và hết
  const ack = await wreq('POST', '/api/v1/alarms/ack', s, {
    all: true,
    upToRevision: doc.revision,
  });
  r.check(
    'ack all: 200 OK, acked = 150 (lớp advisory đã tự xác nhận)',
    ack.status === 200 && ack.json?.acked === 150,
    `${ack.status} ${ack.body?.slice(0, 160)}`,
  );
  const rows = (await auditRows(admin, 'action=alarm.ack')).filter((x) => x.result === 'ok');
  r.check(
    'ack all ghi MỘT dòng audit cho cả lô',
    rows.length >= 1 && rows[0].target?.startsWith?.('all'),
    JSON.stringify(rows[0] ?? null).slice(0, 200),
  );
  await simCoil(0, 0);
  const cleared = await Promise.all(fast.map((p) => p.until((l) => l.state.size === 0, 20000)));
  r.check(
    'sau khi hết và xác nhận: mọi client nhanh về 0 instance',
    cleared.every((x) => x !== null),
  );
  fast.forEach((p) => p.close());
  slow.forEach((c) => {
    clearInterval(c.hb);
    c.socket.destroy();
  });

  // chập chờn: 20 lần/phút trên CHATTER_1 trong 66 s
  const cfgLimit = 5;
  const chatterRowsBefore =
    (await httpGet('/api/v1/alarms/history?alarmId=CHATTER_1&limit=500')).json?.items?.length ?? 0;
  const t1 = Date.now();
  let toggles = 0;
  while (Date.now() - t1 < 66000) {
    await simCoil(1, 1);
    await sleep(1500);
    await simCoil(1, 0);
    await sleep(1500);
    toggles++;
  }
  await sleep(3500);
  const live2 = await getAlarms();
  const ch = live2.instances.find((i) => i.id === 'CHATTER_1');
  m.chatterActivationsAttempted = toggles;
  r.check(
    `CHATTER_1 tự cách ly (shelved bởi hệ thống) sau ${cfgLimit} lần bật trong 60 s`,
    ch?.shelved?.system === true,
    JSON.stringify(ch?.shelved ?? null),
  );
  const hist =
    (await httpGet('/api/v1/alarms/history?alarmId=CHATTER_1&limit=500')).json?.items ?? [];
  const newRows = hist.length - chatterRowsBefore;
  m.chatterRowsInDb = newRows;
  m.chatterLimit = cfgLimit;
  r.check(
    `alarm.db có đúng ${cfgLimit} hàng cho ${toggles} lần dao động (chatterLimit, hàng thứ ${cfgLimit} là dòng tổng kết)`,
    newRows === cfgLimit,
    `${newRows} hàng`,
  );
  const summary = hist.find((x) => x.repeat > 1);
  m.chatterSummaryRepeat = summary?.repeat ?? null;
  r.check(
    `dòng tổng kết của đợt chập chờn có repeat = ${cfgLimit} (số lần bật trong vòng chập chờn)`,
    m.chatterSummaryRepeat === cfgLimit,
    JSON.stringify(summary ?? null).slice(0, 160),
  );
  const shelveAudit = await auditRows(admin, 'action=alarm.shelve');
  m.shelveAuditSample = shelveAudit.slice(0, 2);
  m.chatterHistorySample = hist.slice(0, 2);
  const sysRows = shelveAudit.filter((x) => x.target === 'CHATTER_1');
  r.check(
    'audit ghi shelve của hệ thống do chập chờn',
    sysRows.length >= 1,
    `${sysRows.length} dòng`,
  );
  const unsh = await wreq('POST', '/api/v1/alarms/unshelve', s, { id: 'CHATTER_1' });
  r.check('unshelve tay alarm chập chờn: 200', unsh.status === 200, `${unsh.status}`);
  await simCoil(1, 0);
  const rev1 = (await getAlarms()).revision;
  m.revisionDelta = rev1 - rev0;
} catch (e) {
  r.check(`ngoại lệ: ${String(e.stack ?? e).slice(0, 400)}`, false);
}
const out = emit(r);
process.exit(out.pass ? 0 : 1);
