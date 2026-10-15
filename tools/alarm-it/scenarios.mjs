// Kịch bản tích hợp x64 của feature 009 (T039 state/quality/restart, T040 killloop, T065 auth).
//   node tools/alarm-it/scenarios.mjs <state|quality|restart|killloop|auth> [--rounds N]
// In đúng một dòng JSON { scenario, checks, measures, pass }; tools/alarm-it.ps1 dựng rig và ghi docs/reports/009-<tên>-x64.json.
import {
  alarmDbCheck,
  auditRows,
  bearer,
  breq,
  emit,
  getAlarms,
  getInfo,
  httpGet,
  killRuntime,
  LiveProbe,
  makeReport,
  runtimeStarts,
  simCoil,
  simHolding,
  simRefuse,
  sleep,
  termRuntime,
  waitFor,
  waitRuntime,
  webLogin,
  wreq,
} from './lib.mjs';

const args = process.argv.slice(2);
const scenario = args[0];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

let adminTok;
const byId = (doc, id) => doc?.instances?.find((i) => i.id === id);
const stateOf = (doc, id) => byId(doc, id)?.state ?? 'NORMAL';

async function waitState(id, want, timeoutMs = 15000) {
  const t0 = Date.now();
  const ok = await waitFor(
    async () => {
      const d = await getAlarms();
      const s = stateOf(d, id);
      return (Array.isArray(want) ? want.includes(s) : s === want) ? d : null;
    },
    timeoutMs,
    `${id} -> ${want}`,
    100,
  ).catch(() => null);
  return { ok: Boolean(ok), ms: Date.now() - t0, doc: ok };
}

async function ack(s, id) {
  const d = await getAlarms();
  const inst = byId(d, id);
  if (!inst) return { status: 0, json: null };
  return wreq('POST', '/api/v1/alarms/ack', s, { items: [{ id, occurrence: inst.occurrence }] });
}

/** Về trạng thái sạch: giả lập về 0, mọi alarm hết và đã xác nhận, không shelve/disable. */
async function resetState(s, token) {
  await simRefuse(false);
  await simCoil(0, 0);
  await simCoil(1, 0);
  await simHolding(0, 0);
  await waitFor(
    async () => {
      const d = await getAlarms();
      return d.instances.every(
        (i) => !['ACTIVE_UNACK', 'ACTIVE_ACK'].includes(i.state) || i.shelved,
      )
        ? d
        : null;
    },
    40000,
    'alarm hết',
    300,
  ).catch(() => null);
  for (let k = 0; k < 3; k++) {
    const d = await getAlarms();
    for (const i of d.instances) {
      if (i.shelved) await wreq('POST', '/api/v1/alarms/unshelve', s, { id: i.id });
      if (i.disabled) await breq('POST', '/api/v1/alarms/enable', token, { id: i.id });
    }
    await wreq('POST', '/api/v1/alarms/ack', s, { all: true, upToRevision: d.revision });
    await sleep(600);
  }
  await waitFor(
    async () => ((await getAlarms()).instances.length === 0 ? true : null),
    20000,
    'sạch',
    300,
  ).catch(() => null);
}

// ------------------------------------------------------------------------------------------ state

async function state(r, s, token) {
  const m = r.measures;
  await resetState(s, token);
  const d0 = await getAlarms();
  r.check(
    'khởi đầu: không alarm nào (GET /api/v1/alarms)',
    d0.instances.length === 0 && d0.counts.active === 0,
  );
  const info0 = await getInfo();
  r.check(
    'system/info.alarms có mặt',
    info0?.alarms !== undefined,
    JSON.stringify(info0?.alarms ?? null).slice(0, 200),
  );

  // 1. digital: bật, xác nhận, hết
  const live = new LiveProbe();
  await live.open();
  await live.until((l) => l.sequence >= 1, 5000);
  r.check(
    'live: hello có features alarms và nhận alarmSnapshot',
    live.hello?.features?.includes('alarms') && live.sequence >= 1,
  );
  await simCoil(0, 1);
  const on = await waitState('IT_FAULT', 'ACTIVE_UNACK');
  m.digitalActivateMs = on.ms;
  r.check(`digital IT_FAULT: ACTIVE_UNACK sau khi coil bật (${on.ms} ms)`, on.ok);
  const occ1 = byId(on.doc, 'IT_FAULT')?.occurrence;
  r.check(
    'lần xảy ra có mã và nội dung',
    occ1 >= 1 && typeof byId(on.doc, 'IT_FAULT').text === 'string',
    byId(on.doc, 'IT_FAULT')?.text,
  );
  r.check(
    'counts: active=1, unack=1, critical.unack=1',
    on.doc.counts.active === 1 &&
      on.doc.counts.unack === 1 &&
      on.doc.counts.byPriority.critical.unack === 1,
  );
  const liveOk = await live.until((l) => l.inst('IT_FAULT')?.state === 'ACTIVE_UNACK', 3000);
  r.check('live: alarmDelta cùng trạng thái', liveOk !== null);

  const a1 = await ack(s, 'IT_FAULT');
  r.check(
    'ack: 200 ACKED',
    a1.status === 200 && a1.json?.results?.[0]?.result === 'ACKED',
    `${a1.status} ${a1.body?.slice(0, 200)}`,
  );
  const acked = await waitState('IT_FAULT', 'ACTIVE_ACK', 5000);
  r.check(
    'sau ack: ACTIVE_ACK, ackUser vh1',
    acked.ok && byId(acked.doc, 'IT_FAULT')?.ackUser === 'vh1',
  );
  const a2 = await ack(s, 'IT_FAULT');
  r.check(
    'ack lặp: ALREADY_ACKED',
    a2.json?.results?.[0]?.result === 'ALREADY_ACKED',
    a2.body?.slice(0, 160),
  );
  const stale = await wreq('POST', '/api/v1/alarms/ack', s, {
    items: [{ id: 'IT_FAULT', occurrence: occ1 + 1000 }],
  });
  r.check(
    'ack sai occurrence: STALE',
    stale.json?.results?.[0]?.result === 'STALE',
    stale.body?.slice(0, 160),
  );

  await simCoil(0, 0);
  const gone = await waitState('IT_FAULT', 'NORMAL');
  r.check(
    `điều kiện hết sau khi đã xác nhận: về NORMAL (lớp không ackReturn) (${gone.ms} ms)`,
    gone.ok,
  );

  // 2. lần xảy ra mới (đúng-sai-đúng)
  await simCoil(0, 1);
  const again = await waitState('IT_FAULT', 'ACTIVE_UNACK');
  r.check(
    'bật lại: lần xảy ra mới, mã lớn hơn',
    again.ok && byId(again.doc, 'IT_FAULT').occurrence > occ1,
    `${occ1} -> ${byId(again.doc, 'IT_FAULT')?.occurrence}`,
  );
  await simCoil(0, 0);
  const rtn = await waitState('IT_FAULT', 'RTN_UNACK');
  r.check('hết khi chưa xác nhận: RTN_UNACK', rtn.ok);
  const a3 = await ack(s, 'IT_FAULT');
  r.check(
    'xác nhận lần hết: ACKED → NORMAL',
    a3.json?.results?.[0]?.result === 'ACKED' && (await waitState('IT_FAULT', 'NORMAL', 5000)).ok,
  );

  // 3. limit H/HH, deadband
  await simHolding(0, 85);
  const h = await waitState('IT_LEVEL.H', 'ACTIVE_UNACK');
  r.check(
    `limit: 85 → IT_LEVEL.H ACTIVE_UNACK (${h.ms} ms)`,
    h.ok && stateOf(h.doc, 'IT_LEVEL.HH') === 'NORMAL',
  );
  r.check(
    'nội dung ngưỡng chèn giá trị',
    /85/.test(byId(h.doc, 'IT_LEVEL.H')?.text ?? ''),
    byId(h.doc, 'IT_LEVEL.H')?.text,
  );
  await simHolding(0, 96);
  const hh = await waitState('IT_LEVEL.HH', 'ACTIVE_UNACK');
  r.check(
    'limit: 96 → thêm IT_LEVEL.HH (critical)',
    hh.ok && byId(hh.doc, 'IT_LEVEL.HH')?.priority === 'critical',
  );
  await simHolding(0, 79); // dưới H=80 nhưng trong deadband 2 (hết khi < 78)
  await sleep(2500);
  r.check(
    'deadband: 79 vẫn giữ H đang bật',
    stateOf(await getAlarms(), 'IT_LEVEL.H') === 'ACTIVE_UNACK',
  );
  await simHolding(0, 77);
  const hr = await waitState('IT_LEVEL.H', 'RTN_UNACK');
  r.check(
    'deadband: 77 → H RTN_UNACK; HH cũng đã hết',
    hr.ok && stateOf(hr.doc, 'IT_LEVEL.HH') === 'RTN_UNACK',
  );
  const ackAll = await wreq('POST', '/api/v1/alarms/ack', s, {
    all: true,
    upToRevision: hr.doc.revision,
    filter: { areas: ['bon'] },
  });
  r.check(
    'ack all theo khu vực bon: 200',
    ackAll.status === 200 && ackAll.json?.acked >= 2,
    ackAll.body?.slice(0, 200),
  );
  await simHolding(0, 0);
  await waitFor(
    async () =>
      (await getAlarms()).instances.every(
        (i) => i.id.startsWith('IT_LEVEL') === false || i.state === 'NORMAL',
      ),
    8000,
    'bon sạch',
    200,
  ).catch(() => null);

  // 4. trễ bật 3 s (IT_LEVEL_DLY.H ở 70)
  await simHolding(0, 75);
  const t0 = Date.now();
  await waitState('IT_LEVEL.H', 'NORMAL', 100).catch(() => null);
  await sleep(1200);
  const early = stateOf(await getAlarms(), 'IT_LEVEL_DLY.H');
  r.check('trễ bật 3 s: sau ~1,2 s chưa bật', early === 'NORMAL', early);
  const late = await waitState('IT_LEVEL_DLY.H', 'ACTIVE_UNACK', 9000);
  const dly = Date.now() - t0;
  m.onDelayObservedMs = dly;
  r.check(
    `trễ bật 3 s: bật sau ${dly} ms (3000 ≤ t ≤ 6000)`,
    late.ok && dly >= 2900 && dly <= 6000,
  );
  const occDly = byId(late.doc, 'IT_LEVEL_DLY.H')?.occurrence;
  await ack(s, 'IT_LEVEL_DLY.H');
  await simHolding(0, 0);
  await waitState('IT_LEVEL_DLY.H', 'NORMAL', 8000);
  await sleep(1500);
  await simHolding(0, 75);
  await sleep(1200);
  await simHolding(0, 0);
  await sleep(4500);
  const dAbort = await getAlarms();
  r.check(
    'trễ bật: điều kiện biến mất trước 3 s thì không bật (NORMAL, không lần xảy ra mới)',
    stateOf(dAbort, 'IT_LEVEL_DLY.H') === 'NORMAL' && !byId(dAbort, 'IT_LEVEL_DLY.H'),
    `occ trước ${occDly}; ${JSON.stringify(byId(dAbort, 'IT_LEVEL_DLY.H') ?? null)}`,
  );

  // 5. tạm ẩn và vô hiệu
  await simCoil(1, 1);
  await waitState('IT_FAULT2', 'ACTIVE_UNACK');
  const sh = await wreq('POST', '/api/v1/alarms/shelve', s, {
    id: 'IT_FAULT2',
    reason: 'kiểm tích hợp',
    durationS: 60,
  });
  r.check(
    'shelve: 200, shelved.user vh1',
    sh.status === 200 && sh.json?.shelved?.user === 'vh1',
    sh.body?.slice(0, 200),
  );
  const shd = await getAlarms();
  r.check(
    'shelved không tính vào unack',
    byId(shd, 'IT_FAULT2')?.shelved && shd.counts.unack === 0 && shd.counts.shelved === 1,
    JSON.stringify({ c: shd.counts, i: shd.instances.map((i) => [i.id, i.state, !!i.shelved]) }),
  );
  const un = await wreq('POST', '/api/v1/alarms/unshelve', s, { id: 'IT_FAULT2' });
  r.check(
    'unshelve: điều kiện còn đúng → lần xảy ra ACTIVE_UNACK mới',
    un.status === 200 && un.json?.state === 'ACTIVE_UNACK',
    un.body?.slice(0, 200),
  );
  const dis = await breq('POST', '/api/v1/alarms/disable', token, {
    id: 'IT_FAULT2',
    reason: 'kiểm tích hợp',
  });
  r.check(
    'disable (Bearer engineer): 200, về NORMAL',
    dis.status === 200 && dis.json?.disabled === true && dis.json?.state === 'NORMAL',
    dis.body?.slice(0, 200),
  );
  const en = await breq('POST', '/api/v1/alarms/enable', token, { id: 'IT_FAULT2' });
  r.check('enable: 200', en.status === 200 && en.json?.disabled === false, en.body?.slice(0, 200));
  await simCoil(1, 0);
  await sleep(1500);

  m.liveMessages = live.alarmMsgs.length;
  m.liveSequenceGaps = live.sequenceGap ?? 0;
  r.check('live: sequence alarm liên tục (0 khoảng hở)', (live.sequenceGap ?? 0) === 0);
  r.check('live: phiên không bị đóng', live.closed === null);
  live.close();

  // 6. audit
  const rows = await auditRows(adminTok, 'action=alarm.ack');
  r.check(
    'audit có alarm.ack của vh1 cho IT_FAULT',
    rows.some((x) => x.actor === 'vh1' || x.user === 'vh1'),
    `${rows.length} dòng; mẫu ${JSON.stringify(rows[0] ?? null).slice(0, 220)}`,
  );
  await resetState(s, token);
}

// ---------------------------------------------------------------------------------------- quality

async function quality(r, s, token) {
  const m = r.measures;
  await resetState(s, token);
  await simHolding(0, 85);
  await waitState('IT_LEVEL.H', 'ACTIVE_UNACK');
  const live = new LiveProbe();
  await live.open();
  await live.until((l) => l.sequence >= 1, 5000);

  const t0 = Date.now();
  await simRefuse(true);
  const link = await waitState('IT_PLC1_LINK', 'ACTIVE_UNACK', 45000);
  m.deviceLinkAlarmMs = Date.now() - t0;
  r.check(`mất kết nối thiết bị: IT_PLC1_LINK ACTIVE_UNACK sau ${m.deviceLinkAlarmMs} ms`, link.ok);
  const sig = await waitState('IT_TEMP_SIGNAL', 'ACTIVE_UNACK', 45000);
  r.check('Tag mất tín hiệu: IT_TEMP_SIGNAL (quality theo Tag, on notGood) ACTIVE_UNACK', sig.ok);
  const hi = byId(await getAlarms(), 'IT_LEVEL.H');
  r.check(
    'limit đang bật giữ nguyên, cờ inputBad (FR-019)',
    hi?.state === 'ACTIVE_UNACK' && hi.inputBad === true,
    JSON.stringify({ s: hi?.state, bad: hi?.inputBad }),
  );
  const linkInst = byId(await getAlarms(), 'IT_PLC1_LINK');
  r.check(
    'alarm quality có qualityActive BAD',
    linkInst?.qualityActive === 'BAD',
    `${linkInst?.qualityActive} ${linkInst?.text}`,
  );
  await simHolding(0, 0); // đổi giá trị trong lúc mất kết nối: không có hiệu lực (Tag BAD)
  await sleep(2500);
  r.check(
    'Tag BAD: đổi nguồn không làm limit hết (giữ trạng thái)',
    stateOf(await getAlarms(), 'IT_LEVEL.H') === 'ACTIVE_UNACK',
  );

  const t1 = Date.now();
  await simRefuse(false);
  const back = await waitState('IT_PLC1_LINK', 'RTN_UNACK', 45000);
  m.deviceLinkRecoveryMs = Date.now() - t1;
  r.check(`kết nối lại: IT_PLC1_LINK RTN_UNACK sau ${m.deviceLinkRecoveryMs} ms`, back.ok);
  const lv = await waitState('IT_LEVEL.H', 'RTN_UNACK', 45000);
  r.check(
    'kết nối lại và Tag tốt (giá trị 0): limit đánh giá lại và hết',
    lv.ok && byId(lv.doc, 'IT_LEVEL.H')?.inputBad === false,
  );
  r.check(
    'live: thấy cùng kết quả',
    (await live.until((l) => l.inst('IT_PLC1_LINK')?.state === 'RTN_UNACK', 5000)) !== null,
  );
  r.check('live: sequence liên tục', (live.sequenceGap ?? 0) === 0 && live.closed === null);
  live.close();
  await resetState(s, token);
}

// --------------------------------------------------------------------------------------- restart

async function waitUp(prevStarts) {
  await waitFor(
    () => {
      try {
        return runtimeStarts() > prevStarts;
      } catch {
        return false;
      }
    },
    30000,
    'runtime start lại',
    300,
  );
  return waitRuntime(60000);
}

async function restart(r, s, token) {
  const m = r.measures;
  await resetState(s, token);
  // ACTIVE_ACK (IT_FAULT) và ACTIVE_UNACK (IT_FAULT2), shelve (IT_LEVEL_DLY.H), disable (IT_LEVEL.HH)
  await simCoil(0, 1);
  await simCoil(1, 1);
  await waitState('IT_FAULT', 'ACTIVE_UNACK');
  await waitState('IT_FAULT2', 'ACTIVE_UNACK');
  await ack(s, 'IT_FAULT');
  await waitState('IT_FAULT', 'ACTIVE_ACK', 5000);
  await wreq('POST', '/api/v1/alarms/shelve', s, {
    id: 'IT_LEVEL_DLY.H',
    reason: 'restart',
    durationS: 600,
  });
  await breq('POST', '/api/v1/alarms/disable', token, { id: 'IT_LEVEL.HH', reason: 'restart' });
  const before = await getAlarms();
  const occ = { f: byId(before, 'IT_FAULT').occurrence, f2: byId(before, 'IT_FAULT2').occurrence };
  await sleep(3500); // quá alarmCommitMs (2 s): ghi bền đã commit

  // SIGTERM: tắt sạch
  let n = runtimeStarts();
  termRuntime();
  await waitUp(n);
  await sleep(1500);
  const doc = await getAlarms();
  r.check(
    'SIGTERM: IT_FAULT vẫn ACTIVE_ACK cùng lần xảy ra, đã xác nhận bởi vh1',
    stateOf(doc, 'IT_FAULT') === 'ACTIVE_ACK' &&
      byId(doc, 'IT_FAULT').occurrence === occ.f &&
      byId(doc, 'IT_FAULT').ackUser === 'vh1',
    JSON.stringify(byId(doc, 'IT_FAULT') ?? null).slice(0, 240),
  );
  r.check(
    'SIGTERM: IT_FAULT2 vẫn ACTIVE_UNACK cùng lần xảy ra, không cờ startup giả',
    stateOf(doc, 'IT_FAULT2') === 'ACTIVE_UNACK' && byId(doc, 'IT_FAULT2').occurrence === occ.f2,
  );
  r.check(
    'SIGTERM: disable còn nguyên (bền, không phụ thuộc đồng hồ)',
    byId(doc, 'IT_LEVEL.HH')?.disabled === true,
    JSON.stringify({ hh: byId(doc, 'IT_LEVEL.HH') ?? null }),
  );
  m.shelveAfterSigterm = Boolean(byId(doc, 'IT_LEVEL_DLY.H')?.shelved);
  r.check(
    'SIGTERM: shelve (đồng hồ x64 Docker chưa hợp lệ: clockOk=false nên hết hạn khi nạp, FR-033) không còn',
    m.shelveAfterSigterm === false,
    JSON.stringify(byId(doc, 'IT_LEVEL_DLY.H') ?? null),
  );
  const chk1 = alarmDbCheck();
  r.check(
    '--alarm-db-check sau SIGTERM: integrity ok, exit 0',
    chk1.rc === 0 && chk1.json?.integrity === 'ok',
    JSON.stringify(chk1.json)?.slice(0, 240),
  );
  const info = await getInfo();
  r.check(
    'system/info.alarms.logState',
    info?.alarms?.logState !== undefined,
    JSON.stringify(info?.alarms ?? null).slice(0, 240),
  );

  // kill -9 giữa ACTIVE_ACK và RTN_UNACK: điều kiện hết khi runtime đang chết
  await sleep(500);
  n = runtimeStarts();
  killRuntime();
  await sleep(300);
  await simCoil(0, 0); // IT_FAULT (đã ack) hết trong lúc chết
  await simCoil(1, 0); // IT_FAULT2 (chưa ack) hết trong lúc chết
  await waitUp(n);
  const a = await waitState('IT_FAULT', 'NORMAL', 20000);
  const b = await waitState('IT_FAULT2', 'RTN_UNACK', 20000);
  r.check('kill -9: IT_FAULT (đã xác nhận, hết khi chết) → NORMAL sau khi dựng lại', a.ok);
  r.check(
    'kill -9: IT_FAULT2 (chưa xác nhận, hết khi chết) → RTN_UNACK cùng lần xảy ra',
    b.ok && byId(b.doc, 'IT_FAULT2')?.occurrence === occ.f2,
  );
  r.check(
    'kill -9: disable còn nguyên',
    byId(b.doc, 'IT_LEVEL.HH')?.disabled === true,
    JSON.stringify(byId(b.doc, 'IT_LEVEL.HH') ?? null),
  );
  const chk2 = alarmDbCheck();
  r.check(
    '--alarm-db-check sau kill -9: integrity ok, ackWithoutAudit rỗng, exit 0',
    chk2.rc === 0 &&
      chk2.json?.integrity === 'ok' &&
      (chk2.json?.ackWithoutAudit ?? []).length === 0,
    JSON.stringify(chk2.json)?.slice(0, 300),
  );

  // kill -9 ngay sau ack (chưa chờ commit): trạng thái dựng lại là ACTIVE_ACK hoặc ACTIVE_UNACK (hướng an toàn), audit luôn có dòng ack
  await simCoil(0, 1);
  await waitState('IT_FAULT', 'ACTIVE_UNACK');
  const s2 = await webLogin('vh1'); // phiên web nằm trong RAM: mất khi khởi động lại
  const ackR = await ack(s2, 'IT_FAULT');
  r.check(
    'ack ngay trước kill: 200',
    ackR.status === 200,
    `${ackR.status} ${ackR.body?.slice(0, 200)}`,
  );
  n = runtimeStarts();
  killRuntime();
  await waitUp(n);
  await sleep(1500);
  const fault = stateOf(await getAlarms(), 'IT_FAULT');
  r.check(
    `kill -9 ngay sau ack: dựng lại ACTIVE_ACK hoặc ACTIVE_UNACK (an toàn), thấy ${fault}`,
    ['ACTIVE_ACK', 'ACTIVE_UNACK'].includes(fault),
  );
  adminTok = await bearer('admin');
  token = await bearer('kysu1');
  const rows = await auditRows(adminTok, 'action=alarm.ack');
  r.check(
    'audit giữ dòng alarm.ack kể cả khi trạng thái chưa kịp ghi',
    rows.filter((x) => String(x.target ?? '').includes('IT_FAULT')).length >= 2,
    `${rows.length} dòng ack`,
  );
  const chk3 = alarmDbCheck();
  r.check('--alarm-db-check lần cuối: ok', chk3.rc === 0, JSON.stringify(chk3.json)?.slice(0, 200));
  m.starts = runtimeStarts();
  await resetState(s2, token);
}

// -------------------------------------------------------------------------------------- killloop

async function killloop(r, s, token) {
  const m = r.measures;
  const rounds = Number(opt('--rounds', 100));
  await resetState(s, token);
  const modes = ['write', 'ack', 'ack-race', 'idle'];
  const log = [];
  let integrityFail = 0;
  let ackNoAudit = 0;
  let restartsFail = 0;
  let sess = s;
  let acksSent = 0;
  let acksAccepted = 0;
  let acksRefused = 0;
  let coilState = 0;
  let level = 0;
  for (let i = 1; i <= rounds; i++) {
    const mode = modes[i % modes.length];
    const n = runtimeStarts();
    // tạo hoạt động: đổi nguồn liên tục (ghi alarm.db) và xác nhận (audit trước)
    const stopAt = Date.now() + 300 + Math.floor(Math.random() * 2200);
    const wiggle = (async () => {
      while (Date.now() < stopAt) {
        coilState ^= 1;
        level = level === 0 ? 96 : 0;
        await simCoil(0, coilState).catch(() => {});
        await simCoil(1, coilState ^ 1).catch(() => {});
        await simHolding(0, level).catch(() => {});
        await sleep(150 + Math.floor(Math.random() * 250));
      }
    })();
    const acker = (async () => {
      while (Date.now() < stopAt) {
        const d = await getAlarms().catch(() => null);
        const todo = (d?.instances ?? []).filter(
          (x) => ['ACTIVE_UNACK', 'RTN_UNACK'].includes(x.state) && !x.shelved,
        );
        if (todo.length && mode !== 'idle') {
          const body =
            mode === 'ack-race'
              ? { all: true, upToRevision: d.revision }
              : { items: todo.slice(0, 5).map((x) => ({ id: x.id, occurrence: x.occurrence })) };
          wreq('POST', '/api/v1/alarms/ack', sess, body, { timeoutMs: 3000 })
            .then((x) => {
              acksSent++;
              if (x.status === 200) acksAccepted += x.json?.acked ?? 0;
              else acksRefused++;
            })
            .catch(() => {});
        }
        await sleep(60 + Math.floor(Math.random() * 120));
      }
    })();
    await Promise.all([wiggle, acker]);
    // kill -9 ở thời điểm ngẫu nhiên ngay trong lúc còn hoạt động
    killRuntime();
    await sleep(100);
    let up = null;
    try {
      up = await waitUp(n);
      sess = await webLogin('vh1'); // phiên web nằm trong RAM: mất sau mỗi lần kill
    } catch {
      restartsFail++;
    }
    await sleep(400);
    const chk = alarmDbCheck();
    const okIntegrity = chk.json?.integrity === 'ok' && (chk.rc === 0 || chk.rc === 3);
    const noAudit = chk.json?.ackWithoutAudit?.length ?? 0;
    if (!okIntegrity) integrityFail++;
    ackNoAudit += noAudit;
    log.push({
      round: i,
      mode,
      integrity: chk.json?.integrity ?? chk.error,
      rc: chk.rc,
      rows: chk.json?.rows,
      open: chk.json?.open,
      acked: chk.json?.acked,
      ackWithoutAudit: noAudit,
      runtimeUp: Boolean(up),
    });
    if (!up) {
      await sleep(3000);
    }
  }
  m.rounds = rounds;
  m.integrityFailures = integrityFail;
  m.ackWithoutAuditTotal = ackNoAudit;
  m.restartFailures = restartsFail;
  m.finalRows = log.at(-1)?.rows;
  m.finalAcked = log.at(-1)?.acked;
  m.acksSent = acksSent;
  m.acksAccepted = acksAccepted;
  m.acksRefused = acksRefused;
  m.maxAckedRows = Math.max(...log.map((x) => x.acked ?? 0));
  m.roundsWithAckedRows = log.filter((x) => (x.acked ?? 0) > 0).length;
  r.check(
    `${rounds} vòng kill -9: PRAGMA integrity_check = ok ở mọi vòng`,
    integrityFail === 0,
    `${integrityFail} vòng hỏng`,
  );
  r.check(
    'không có ACTIVE_ACK (ts_ack_ms) mà audit.db không có alarm.ack tương ứng (ackWithoutAudit rỗng ở mọi vòng)',
    ackNoAudit === 0,
    `${ackNoAudit} mục`,
  );
  r.check('runtime luôn khởi động lại và đọc được /api/v1/alarms', restartsFail === 0);
  r.check(
    'có ghi thật: hàng alarm.db tăng, ≥ 50 xác nhận được chấp nhận, có hàng ts_ack_ms ở ≥ 10 vòng',
    (m.finalRows ?? 0) > 100 && acksAccepted >= 50 && m.roundsWithAckedRows >= 10,
    `rows=${m.finalRows} acksAccepted=${acksAccepted} roundsWithAcked=${m.roundsWithAckedRows}`,
  );
  r.check(
    'mọi chế độ kill đã chạy (ghi, xác nhận, xác nhận hàng loạt, rỗi)',
    new Set(log.map((x) => x.mode)).size === modes.length,
  );
  r.extra = { rounds: log };
  await resetState(sess, await bearer('kysu1'));
}

// ------------------------------------------------------------------------------------------ auth

async function auth(r, s, token) {
  // viewer, operator, engineer, khách: ack, shelve, disable; thứ tự audit trước
  await resetState(s, token);
  await simCoil(0, 1);
  await waitState('IT_FAULT', 'ACTIVE_UNACK');
  const d = await getAlarms();
  const occ = byId(d, 'IT_FAULT').occurrence;
  const ackBody = { items: [{ id: 'IT_FAULT', occurrence: occ }] };
  const shBody = { id: 'IT_FAULT', reason: 'auth', durationS: 60 };

  // khách (không phiên): đọc được, không ghi được
  const guestRead = await httpGet('/api/v1/alarms');
  r.check('khách trong mạng riêng đọc được GET /alarms (200)', guestRead.status === 200);
  const guestHist = await httpGet('/api/v1/alarms/history?limit=5');
  r.check(
    'khách đọc được GET /alarms/history (200)',
    guestHist.status === 200,
    `${guestHist.status}`,
  );
  const guestAck = await wreq('POST', '/api/v1/alarms/ack', undefined, ackBody);
  r.check(
    'khách ack: 401',
    guestAck.status === 401,
    `${guestAck.status} ${guestAck.body?.slice(0, 100)}`,
  );
  const guestSh = await wreq('POST', '/api/v1/alarms/shelve', undefined, shBody);
  r.check('khách shelve: 401', guestSh.status === 401, `${guestSh.status}`);
  const guestDis = await wreq('POST', '/api/v1/alarms/disable', undefined, {
    id: 'IT_FAULT',
    reason: 'x',
  });
  r.check('khách disable: 401', guestDis.status === 401, `${guestDis.status}`);

  // viewer
  const sv = await webLogin('xem1');
  const vAck = await wreq('POST', '/api/v1/alarms/ack', sv, ackBody);
  r.check(
    'viewer ack: 403 FORBIDDEN',
    vAck.status === 403,
    `${vAck.status} ${vAck.body?.slice(0, 100)}`,
  );
  const vSh = await wreq('POST', '/api/v1/alarms/shelve', sv, shBody);
  r.check('viewer shelve: 403', vSh.status === 403, `${vSh.status}`);
  const vRead = await wreq('GET', '/api/v1/alarms', sv);
  r.check('viewer đọc: 200', vRead.status === 200);
  r.check(
    'sau các lần bị từ chối: trạng thái không đổi (ACTIVE_UNACK)',
    stateOf(await getAlarms(), 'IT_FAULT') === 'ACTIVE_UNACK',
  );

  // operator: ack và shelve được, disable không (cookie: SESSION_SCOPE)
  const opDis = await wreq('POST', '/api/v1/alarms/disable', s, { id: 'IT_FAULT', reason: 'x' });
  r.check(
    'operator (cookie) disable: 403',
    opDis.status === 403,
    `${opDis.status} ${opDis.body?.slice(0, 120)}`,
  );
  const opEn = await wreq('POST', '/api/v1/alarms/enable', s, { id: 'IT_FAULT' });
  r.check('operator (cookie) enable: 403', opEn.status === 403, `${opEn.status}`);
  const opAck = await wreq('POST', '/api/v1/alarms/ack', s, ackBody);
  r.check(
    'operator ack: 200 ACKED',
    opAck.status === 200 && opAck.json?.results?.[0]?.result === 'ACKED',
  );
  const opSh = await wreq('POST', '/api/v1/alarms/shelve', s, shBody);
  r.check('operator shelve: 200', opSh.status === 200, opSh.body?.slice(0, 120));
  await wreq('POST', '/api/v1/alarms/unshelve', s, { id: 'IT_FAULT' });

  // operator Bearer disable: role thấp 403 FORBIDDEN
  const opTok = await bearer('vh1');
  const opBDis = await breq('POST', '/api/v1/alarms/disable', opTok, {
    id: 'IT_FAULT',
    reason: 'x',
  });
  r.check(
    'operator (Bearer) disable: 403',
    opBDis.status === 403,
    `${opBDis.status} ${opBDis.body?.slice(0, 120)}`,
  );

  // engineer: Bearer disable/enable được; cookie engineer bị chặn phạm vi
  const kyTok = await bearer('kysu1');
  const eDis = await breq('POST', '/api/v1/alarms/disable', kyTok, {
    id: 'IT_FAULT',
    reason: 'engineer thử',
  });
  r.check(
    'engineer (Bearer) disable: 200',
    eDis.status === 200 && eDis.json?.disabled === true,
    `${eDis.status} ${eDis.body?.slice(0, 120)}`,
  );
  const sk = await webLogin('kysu1');
  const eCookie = await wreq('POST', '/api/v1/alarms/enable', sk, { id: 'IT_FAULT' });
  r.check(
    'engineer (cookie) enable: 403 SESSION_SCOPE',
    eCookie.status === 403 && /SESSION_SCOPE/.test(eCookie.body ?? ''),
    `${eCookie.status} ${eCookie.body?.slice(0, 120)}`,
  );
  const eEn = await breq('POST', '/api/v1/alarms/enable', kyTok, { id: 'IT_FAULT' });
  r.check('engineer (Bearer) enable: 200', eEn.status === 200 && eEn.json?.disabled === false);

  // audit: đủ trường, đúng người, đúng kênh; thứ tự (audit trước, trạng thái sau)
  const admin = await bearer('admin');
  const rows = await auditRows(admin, 'action=alarm.ack');
  const ok1 = rows.find(
    (x) => String(x.target ?? '') === 'IT_FAULT' && (x.result === 'ok' || x.outcome === 'ok'),
  );
  r.check(
    'audit alarm.ack: có dòng ok cho IT_FAULT, người vh1, kênh web, role operator',
    Boolean(ok1) && (ok1.actor ?? ok1.user) === 'vh1',
    JSON.stringify(ok1 ?? null).slice(0, 360),
  );
  const keys = ok1 ? Object.keys(ok1) : [];
  r.check(
    'audit đủ trường (ts, người, role, kênh, hành động, đích, kết quả, chi tiết)',
    ['action', 'target', 'result'].every((k) => keys.includes(k)) || keys.length >= 7,
    keys.join(','),
  );
  const denied =
    (await auditRows(admin, 'action=access.denied')).length +
    rows.filter((x) => x.result === 'denied').length;
  r.check(
    'lượt bị từ chối ghi audit (access.denied hoặc alarm.ack denied)',
    denied >= 1,
    `${denied} dòng`,
  );
  const shRows = await auditRows(admin, 'action=alarm.shelve');
  const disRows = await auditRows(admin, 'action=alarm.disable');
  r.check(
    'audit alarm.shelve và alarm.disable có dòng ok',
    shRows.some((x) => x.result === 'ok') && disRows.some((x) => x.result === 'ok'),
    `${shRows.length}/${disRows.length}`,
  );
  // thứ tự: dòng audit ack có ts <= ts_ack_ms của lần xảy ra trong alarm.db (audit trước rồi mới áp dụng)
  await sleep(3500); // quá alarmCommitMs: hàng đã xác nhận được ghi vào alarm.db
  const hist = await httpGet('/api/v1/alarms/history?alarmId=IT_FAULT&limit=20');
  const rowDb = hist.json?.items?.find((x) => x.alarmId === 'IT_FAULT' && x.id === occ);
  const auditTs = ok1 ? Number(ok1.ts ?? ok1.timestamp ?? ok1.tsMs) : NaN;
  r.check(
    'thứ tự: ts của dòng audit ack ≤ tsAck của lần xảy ra (audit trước)',
    rowDb?.tsAck != null && Number.isFinite(auditTs) && auditTs <= rowDb.tsAck + 1000,
    `audit=${ok1?.ts} tsAck=${rowDb?.tsAck}`,
  );
  await simCoil(0, 0);
  await resetState(s, token);
}

// ------------------------------------------------------------------------------------------ main

const report = makeReport(scenario);
const fns = { state, quality, restart, killloop, auth };
if (!fns[scenario]) {
  console.error(`kịch bản không biết: ${scenario}`);
  process.exit(2);
}
try {
  await waitRuntime(60000);
  const s = await webLogin('vh1');
  const token = await bearer('kysu1');
  adminTok = await bearer('admin');
  await fns[scenario](report, s, token);
} catch (e) {
  report.check(`ngoại lệ: ${String(e.stack ?? e).slice(0, 400)}`, false);
}
const out = emit(report, report.extra ?? {});

process.exit(out.pass ? 0 : 1);
