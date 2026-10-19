// Kịch bản `control`, `locks`, `session`, `pulse`, `expect` của web-it (feature 007, T073; SC-005…SC-010):
// ghi Tag bằng phiên web (cookie + CSRF) với runtime x64 thật và giả lập Modbus. Mỗi lệnh ghi: số lần tới giả lập
// (0 hoặc đúng 1), kết quả cuối, dòng audit (channel web, context).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import {
  Web,
  api,
  auditRows,
  detailOf,
  makeReport,
  plainHttp,
  simFault,
  simLog,
  simMark,
  simMem,
  simWrites,
  sleep,
  uuid,
} from '../lib/api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];
const reasonOf = (r) => r.json?.results?.[0]?.reason ?? r.json?.error;

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (cmd.startsWith('/build/x64/bin/mat-runtime')) return Number(d);
    } catch {
      // đã thoát
    }
  }
  return 0;
}

/** Chờ cho tới khi giả lập đã thấy ít nhất một lần đọc (kênh Modbus đã chạy). */
async function waitPolling(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await simLog()).length > 0) return true;
    await sleep(300);
  }
  return false;
}

// ------------------------------------------------------------------------------------ control

export async function control(fp) {
  const rep = makeReport('control');
  const { check } = rep;
  const w = new Web(fp);
  await waitPolling();
  const S = (await w.login('vh1', pw('vh1'))).session;
  if (!S) {
    check('đăng nhập operator', false);
    return rep.result();
  }
  // Feature 013: every write names its component (PAGE_CONTEXT of lib/api.mjs); an engineer writes what only an
  // engineer's component writes.
  const E = (await w.login('kysu1', pw('kysu1'))).session;
  const writeOnce = async (label, req, wantStatus, wantCode, extra = {}, s = S) => {
    const mark = await simMark();
    const r = await w.writeAndWait(s, req);
    await sleep(150);
    const sent = (await simWrites(mark)).length;
    const f = r.final ?? {};
    const code = f.code ?? f.reason;
    check(
      `${label}: ${wantStatus}${wantCode ? ' ' + wantCode : ''}`,
      f.status === wantStatus && (wantCode === undefined || code === wantCode),
      JSON.stringify(f),
    );
    return { ...r, sent, mark, id: r.requestId, ...extra };
  };

  const f = await writeOnce('FLOAT TANK01.SP = 50', { tag: 'TANK01.SP', value: 50 }, 'CONFIRMED');
  check('FLOAT: đúng 1 lệnh tới giả lập, không gửi hai lần', f.sent === 1, f.sent);
  await writeOnce(
    'BOOL ngoại PUMP01.RUN_CMD = true',
    { tag: 'PUMP01.RUN_CMD', value: true },
    'CONFIRMED',
  );
  await writeOnce(
    'BOOL mô phỏng SIM.FAN_ON = true',
    { tag: 'SIM.FAN_ON', value: true },
    'CONFIRMED',
  );
  await writeOnce('INT mô phỏng SIM.MODE = 1', { tag: 'SIM.MODE', value: 1 }, 'CONFIRMED');
  await writeOnce(
    'nội bộ TANK01.SP_HI = 70 (engineer, sp_high minRole engineer)',
    { tag: 'TANK01.SP_HI', value: 70 },
    'CONFIRMED',
    undefined,
    {},
    E,
  );
  const oo = await writeOnce(
    'vượt giới hạn TANK01.SP = 95',
    { tag: 'TANK01.SP', value: 95 },
    'REJECTED',
    'OUT_OF_LIMITS',
  );
  check('vượt giới hạn: 0 lệnh tới giả lập', oo.sent === 0, oo.sent);
  // 013: no component of the page writes a read-only or unknown Tag: refused before the coordinator
  const ro = await writeOnce(
    'Tag chỉ đọc TANK01.LEVEL (không component nào ghi)',
    { tag: 'TANK01.LEVEL', value: 1, context: { screen: 'tong-quan', widget: 'card_level' } },
    'REJECTED',
    'ACCESS_DENIED',
  );
  check('chỉ đọc: 0 lệnh tới giả lập', ro.sent === 0, ro.sent);
  await writeOnce(
    'Tag lạ',
    { tag: 'KHONG.CO', value: 1, context: { screen: 'tong-quan', widget: 'sw_pump' } },
    'REJECTED',
    'ACCESS_DENIED',
  );

  // Giả lập từ chối và im lặng
  await simFault({ kind: 'exception', code: 3, fc: 5, count: 1 });
  const ex = await writeOnce(
    'thiết bị từ chối (exception 03)',
    { tag: 'PUMP01.RUN_CMD', value: false },
    'FAILED',
    'DEVICE_EXCEPTION',
  );
  void ex;
  await simFault({ kind: 'timeout', fc: 5, count: 1 });
  const mk = await simMark();
  const to = await writeOnce(
    'thiết bị không trả lời',
    { tag: 'PUMP01.RUN_CMD', value: false },
    'TIMEOUT',
    'WRITE_TIMEOUT',
  );
  const tw = (await simWrites(mk)).filter((e) => e.fc === 5);
  check('lệnh quá hạn tới giả lập đúng 1 lần, không gửi lại', tw.length === 1, tw.length);
  void to;
  await simFault({ kind: 'clear' });

  // Trùng requestId: chạy một lần
  const id = uuid();
  const m2 = await simMark();
  const a = await w.write(S, { requestId: id, tag: 'SIM.MODE', value: 1 });
  const b = await w.write(S, { requestId: id, tag: 'SIM.MODE', value: 1 });
  check(
    'cùng requestId lần hai: duplicate',
    b.json?.results?.[0]?.duplicate === true && a.json?.results?.[0]?.status === 'ACCEPTED',
    JSON.stringify(b.json?.results?.[0]),
  );
  const c = await w.write(S, { requestId: id, tag: 'SIM.MODE', value: 2 });
  check(
    'cùng requestId khác nội dung: REQUEST_ID_CONFLICT',
    reasonOf(c) === 'REQUEST_ID_CONFLICT',
    reasonOf(c),
  );
  void m2;

  // Audit
  await sleep(600);
  const rows = await auditRows(fp, 'action=tag.write');
  const started = rows.filter(
    (r) => r.result === 'started' && r.user === 'vh1' && detailOf(r).context?.widget,
  );
  check(
    'audit: dòng nhận lệnh có channel web, user, role và context',
    started.length >= 4 && started.every((r) => r.user === 'vh1' && r.role === 'operator'),
    `${started.length}`,
  );
  const ch = new Set(started.map((r) => r.channel ?? detailOf(r).channel ?? r.source));
  check('audit: channel = web', ch.has('web'), [...ch].join(','));
  check(
    'audit: context đúng dạng (screen, widget)',
    started.every((r) => ['bon-nuoc', 'tong-quan'].includes(detailOf(r).context?.screen)),
  );
  const fin = rows.filter((r) => ['ok', 'failed'].includes(r.result));
  check(
    'audit: mỗi lệnh nhận có kết quả',
    fin.length >= started.length - 1,
    `${started.length}/${fin.length}`,
  );
  // context sai dạng: 013 bắt buộc context của một component có thật (trước 013: bỏ context, lệnh chạy)
  const bad = await w.writeAndWait(S, {
    tag: 'SIM.MODE',
    value: 2,
    context: { screen: 'Bad Screen!', widget: 'x' },
  });
  check(
    'context sai dạng: REJECTED ACCESS_DENIED (013)',
    bad.final?.status === 'REJECTED' && (bad.final?.reason ?? bad.final?.code) === 'ACCESS_DENIED',
    JSON.stringify(bad.final),
  );
  // trang tải project: số màn hình lấy từ chính project đang chạy (dashboard-demo đổi theo feature, 011 thêm Bơm và popup)
  const screens = JSON.parse(
    readFileSync(new URL('../../../projects/dashboard-demo/project.json', import.meta.url), 'utf8'),
  ).screens.length;
  const pr = await w.request('GET', '/api/v1/projects/active', { s: S });
  check(
    `projects/active qua cookie: 200 và có ${screens} screens`,
    pr.status === 200 && pr.json?.screens?.length === screens,
    `${pr.status} ${pr.json?.screens?.length}`,
  );
  const pf = await w.request('GET', '/project/screens/tong-quan.screen.json', { s: S });
  check(
    '/project/screens/*.screen.json qua cookie: 200 application/json no-cache',
    pf.status === 200 &&
      /application\/json/.test(pf.headers['content-type'] ?? '') &&
      /no-cache/.test(pf.headers['cache-control'] ?? ''),
    `${pf.status} ${pf.headers['content-type']}`,
  );
  return rep.result();
}

// -------------------------------------------------------------------------------------- locks

export async function locks(fp) {
  const rep = makeReport('locks');
  const { check } = rep;
  const w = new Web(fp);
  await waitPolling();
  const S = (await w.login('vh1', pw('vh1'))).session;
  const V = (await w.login('xem1', pw('xem1'))).session;
  const mark = await simMark();
  const body = (tag, value) => JSON.stringify({ requests: [{ requestId: uuid(), tag, value }] });
  const lock = async (name, r, status, code) =>
    check(
      `khóa ${name}: ${status} ${code}`,
      r.status === status && reasonOf(r) === code,
      `${r.status} ${reasonOf(r)}`,
    );
  await lock(
    'viewer',
    await w.request('POST', '/api/v1/tags/write', { s: V, body: body('PUMP01.RUN_CMD', true) }),
    403,
    'FORBIDDEN',
  );
  await lock(
    'chưa đăng nhập',
    await w.request('POST', '/api/v1/tags/write', {
      body: body('PUMP01.RUN_CMD', true),
      h: { 'X-MAT-CSRF': 'x' },
    }),
    401,
    'AUTH_REQUIRED',
  );
  await lock(
    'HTTP',
    await plainHttp(
      'POST',
      '/api/v1/tags/write',
      { 'Content-Type': 'application/json', Cookie: `__Host-mat_sid=${S.cookie}` },
      body('PUMP01.RUN_CMD', true),
    ),
    403,
    'HTTPS_REQUIRED',
  );
  const ro = await w.write(S, { tag: 'TANK01.LEVEL', value: 1 });
  // 013: no component writes it, refused before the coordinator
  check(
    'khóa Tag chỉ đọc: REJECTED ACCESS_DENIED (013)',
    reasonOf(ro) === 'ACCESS_DENIED',
    reasonOf(ro),
  );
  // mất kết nối tới PLC: Tag BAD → CONNECTION_BAD
  await simFault({ kind: 'refuse' });
  let r;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    r = await w.write(S, { tag: 'PUMP01.RUN_CMD', value: true });
    if (reasonOf(r) === 'CONNECTION_BAD') break;
    if (r.json?.results?.[0]?.reason === 'RATE_LIMITED') await sleep(3000);
  }
  check(
    'khóa mất kết nối thiết bị: CONNECTION_BAD',
    reasonOf(r) === 'CONNECTION_BAD',
    JSON.stringify(r?.json?.results?.[0]),
  );
  await simFault({ kind: 'clear' });
  await sleep(300);
  check(
    'mọi khóa: 0 lệnh ghi tới giả lập',
    (await simWrites(mark)).length === 0,
    (await simWrites(mark)).length,
  );
  const sess = await w.request('GET', '/api/v1/web/session', { s: V });
  check(
    'viewer: web/session trả role viewer để trang khóa nút',
    sess.json?.role === 'viewer',
    JSON.stringify(sess.json),
  );
  const info = await w.request('GET', '/api/v1/system/info', {});
  check(
    'system/info công khai có khối web (trang dựng dải chỉ xem)',
    info.status === 200 && info.json?.web?.https === true && info.json?.web?.login === true,
    JSON.stringify(info.json?.web),
  );
  return rep.result();
}

// ------------------------------------------------------------------------------------- session

export async function session(fp, step = 'all') {
  const rep = makeReport('session');
  const { check } = rep;
  const w = new Web(fp);
  if (step === 'prep28') {
    const S = (await w.login('vh1', pw('vh1'))).session;
    writeFileSync('/tmp/s28.json', JSON.stringify(S));
    check('A28 chuẩn bị: phiên vh1 đang mở', Boolean(S));
    return rep.result();
  }
  if (step === 'check28') {
    const S = JSON.parse(readFileSync('/tmp/s28.json', 'utf8'));
    const r = await w.request('GET', '/api/v1/web/session', { s: S });
    check(
      'A28: phiên bị hủy sau khi đổi mật khẩu bằng CLI: 401',
      r.status === 401,
      `${r.status} ${reasonOf(r)}`,
    );
    const old = await w.login('vh1', pw('vh1'));
    check('A28: mật khẩu cũ không đăng nhập được', old.status === 401, old.status);
    return rep.result();
  }
  const lg = await w.login('vh1', pw('vh1'));
  check(
    'đăng nhập: 200 và có csrfToken (43 ký tự)',
    lg.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(lg.json?.csrfToken ?? ''),
    lg.status,
  );
  const sc = (lg.setCookie ?? [])[0] ?? '';
  for (const a of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'])
    check(`Set-Cookie có ${a}`, sc.includes(a), sc.replace(/matw_[A-Za-z0-9_-]+/, 'matw_…'));
  for (const a of ['Domain', 'Max-Age', 'Expires'])
    check(`Set-Cookie không có ${a}`, !new RegExp(a, 'i').test(sc), sc);
  check('Set-Cookie dùng tiền tố __Host-', sc.startsWith('__Host-mat_sid=matw_'));
  check('đăng nhập: Cache-Control no-store', /no-store/.test(lg.headers['cache-control'] ?? ''));
  check(
    'phản hồi đăng nhập có hạn rảnh và tối đa',
    lg.json?.idleTimeoutS > 0 && lg.json?.maxSessionS > 0 && Boolean(lg.json?.expiresAt),
  );
  const S = lg.session;
  const s1 = await w.request('GET', '/api/v1/web/session', { s: S });
  check(
    'GET web/session: cùng csrfToken (khôi phục sau F5)',
    s1.status === 200 && s1.json?.csrfToken === S.csrf && s1.json?.user === 'vh1',
    s1.status,
  );
  const t = await w.request('POST', '/api/v1/web/touch', { s: S });
  check('touch: 204', t.status === 204, t.status);
  const bad = await w.login('vh1', 'sai-mat-khau-xxxxxxxx');
  check(
    'đăng nhập sai: 401 AUTH_FAILED một câu chung',
    bad.status === 401 && bad.json?.error === 'AUTH_FAILED',
    bad.status,
  );
  const unk = await w.login('khong-co-ai', 'sai-mat-khau-xxxxxxxx');
  check(
    'tên lạ cùng phản hồi như sai mật khẩu',
    unk.status === 401 &&
      unk.json?.error === 'AUTH_FAILED' &&
      unk.json?.message === bad.json?.message,
  );
  const big = await w.request('POST', '/api/v1/web/login', {
    body: JSON.stringify({ username: 'a', password: 'x'.repeat(8000) }),
  });
  check('thân > 4 KiB: 413', big.status === 413, big.status);
  const ct = await w.request('POST', '/api/v1/web/login', {
    h: { 'Content-Type': 'text/plain' },
    raw: 'a',
  });
  check('login không phải JSON: 415', ct.status === 415, ct.status);
  const out = await w.request('POST', '/api/v1/web/logout', { s: S });
  check(
    'logout: 204 và xóa cookie (Max-Age=0)',
    out.status === 204 && /Max-Age=0/i.test((out.headers['set-cookie'] ?? [])[0] ?? ''),
    `${out.status} ${out.headers['set-cookie']}`,
  );
  const again = await w.request('GET', '/api/v1/web/session', { s: S });
  check('dùng lại cookie sau logout: 401', again.status === 401, again.status);
  const noCookieOut = await w.request('POST', '/api/v1/web/logout', {
    s: { cookie: 'matw_' + 'z'.repeat(43) },
  });
  check(
    'logout cookie không hợp lệ: 204 (xóa cookie)',
    noCookieOut.status === 204,
    noCookieOut.status,
  );
  // Bearer thắng cookie; token chéo loại
  const eng = await api(fp, 'kysu1', 'GET', '/api/v1/auth/session');
  check('Bearer của kỹ thuật vẫn chạy (không đổi)', eng.status === 200, eng.status);
  const S2 = (await w.login('vh1', pw('vh1'))).session;
  const au = await w.request('GET', '/api/v1/audit', { s: S2 });
  check(
    'cookie không vào API kỹ thuật',
    au.status === 403 && au.json?.error === 'SESSION_SCOPE',
    au.status,
  );
  // Audit đăng nhập kênh web
  const rows = await auditRows(fp, 'action=auth.login');
  check(
    'audit auth.login có dòng kênh web',
    rows.some((r) => (r.channel ?? detailOf(r).channel) === 'web'),
    rows.length,
  );
  check(
    'audit không chứa mật khẩu hay token',
    !JSON.stringify(rows).includes(pw('vh1')) && !JSON.stringify(rows).includes(S2.cookie),
  );
  return rep.result();
}

// --------------------------------------------------------------------------------------- pulse

export async function pulse(fp, rounds = 20) {
  const rep = makeReport('pulse');
  const { check } = rep;
  const w = new Web(fp);
  await waitPolling();
  const S = (await w.login('vh1', pw('vh1'))).session;
  const ctx = { screen: 'tong-quan', widget: 'btn_start' };
  let good = 0;
  let gaps = [];
  const phases = new Set();
  const before = await simMark();
  for (let i = 0; i < rounds; i++) {
    const mark = await simMark();
    const r = await w.writeAndWait(
      S,
      { tag: 'PUMP01.RUN_CMD', value: true, pulseMs: 500, context: ctx },
      { phases },
    );
    if (r.post.json?.results?.[0]?.reason === 'RATE_LIMITED') {
      await sleep((r.post.json.results[0].retryAfterMs ?? 3000) + 100);
      i--;
      continue;
    }
    const wr = (await simWrites(mark)).filter((e) => e.fc === 5);
    const ok =
      r.final?.status === 'CONFIRMED' &&
      r.final?.pulse?.released === true &&
      wr.length === 2 &&
      wr[0].data?.[0] !== wr[1].data?.[0];
    if (ok) {
      good++;
      gaps.push(wr[1].ts - wr[0].ts);
    } else
      check(`vòng ${i}: xung đúng`, false, JSON.stringify({ final: r.final, writes: wr.length }));
  }
  check(
    `${rounds} xung: bật rồi tắt đúng 2 lệnh, CONFIRMED, pulse.released`,
    good === rounds,
    `${good}/${rounds}`,
  );
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  rep.measures.gapMs = { min: minGap, max: maxGap };
  check(
    'khoảng giữa hai lần ghi ≈ pulseMs (500 ms, 480…1000)',
    minGap >= 480 && maxGap <= 1000,
    `${minGap}…${maxGap}`,
  );
  check('có thấy phase release khi chờ', phases.has('release'), [...phases].join(','));
  // Đóng trình duyệt ngay sau khi xác nhận ACCEPTED: runtime vẫn nhả
  let lost = 0;
  for (let i = 0; i < 5; i++) {
    const mark = await simMark();
    const post = await w.write(S, {
      tag: 'PUMP01.RUN_CMD',
      value: true,
      pulseMs: 500,
      context: ctx,
    });
    if (post.json?.results?.[0]?.status !== 'ACCEPTED') {
      await sleep(3200);
      i--;
      continue;
    }
    await w.request('POST', '/api/v1/web/logout', { s: S }); // trang đóng: phiên mất ngay
    await sleep(1500);
    const wr = (await simWrites(mark)).filter((e) => e.fc === 5);
    if (wr.length !== 2) lost++;
    S.cookie = (await w.login('vh1', pw('vh1'))).session.cookie;
    S.csrf = (await w.request('GET', '/api/v1/web/session', { s: S })).json?.csrfToken ?? S.csrf;
  }
  check('đóng trang ngay sau ACCEPTED: bit vẫn được nhả (5/5)', lost === 0, `mất ${lost}`);
  // Lỗi tham số
  const bad1 = await w.write(S, { tag: 'PUMP01.RUN_CMD', value: true, pulseMs: 50 });
  check('pulseMs 50: REJECTED PULSE_RANGE', reasonOf(bad1) === 'PULSE_RANGE', reasonOf(bad1));
  const bad2 = await w.write(S, { tag: 'SIM.MODE', value: 1, pulseMs: 500 });
  check(
    'pulse trên Tag số: REJECTED PULSE_NOT_BOOL',
    reasonOf(bad2) === 'PULSE_NOT_BOOL',
    reasonOf(bad2),
  );
  // Lần ghi đầu thất bại: không ghi lần hai
  await sleep(3200);
  await simFault({ kind: 'exception', code: 3, fc: 5, count: 1 });
  const mf = await simMark();
  const f = await w.writeAndWait(S, { tag: 'PUMP01.RUN_CMD', value: true, pulseMs: 500 });
  const wf = (await simWrites(mf)).filter((e) => e.fc === 5);
  check(
    'lần ghi bật lỗi: FAILED và không ghi lần hai',
    f.final?.status === 'FAILED' && wf.length === 1,
    `${f.final?.status} ${wf.length}`,
  );
  await simFault({ kind: 'clear' });
  // Audit: mỗi xung có started, kết quả
  await sleep(500);
  const rows = await auditRows(fp, 'action=tag.write&target=PUMP01.RUN_CMD');
  const started = rows.filter((r) => r.result === 'started' && detailOf(r).pulseMs === 500);
  check('audit: dòng nhận lệnh xung có pulseMs', started.length >= rounds, `${started.length}`);
  const writesAll = (await simWrites(before)).length;
  const startedAll = rows.filter((r) => r.result === 'started').length;
  check(
    '0 lệnh tới giả lập không có dòng audit nhận lệnh',
    writesAll <= startedAll * 2,
    `${writesAll} lệnh, ${startedAll} dòng`,
  );
  return rep.result();
}

/** kill -9 runtime giữa lúc chờ xung (SC-010): sau khi chạy lại, mọi lệnh dở có dòng interrupted. */
export async function pulseKill(fp, rounds = 5) {
  const rep = makeReport('pulse-kill');
  const { check } = rep;
  const w = new Web(fp);
  const mark = await simMark();
  const ids = [];
  for (let k = 0; k < rounds; k++) {
    let S;
    for (let i = 0; i < 60 && !S; i++) {
      S = (await w.login('vh1', pw('vh1')).catch(() => ({}))).session;
      if (!S) await sleep(500);
    }
    if (!S) break;
    await waitPolling();
    await sleep(1500);
    const id = uuid();
    const r = await w.write(S, {
      requestId: id,
      tag: 'PUMP01.RUN_CMD',
      value: true,
      pulseMs: 5000,
      context: { screen: 'tong-quan', widget: 'btn_start' },
    });
    if (r.json?.results?.[0]?.status === 'ACCEPTED') ids.push(id);
    await sleep(900 + Math.floor(Math.random() * 600)); // giữa lúc chờ nhả
    try {
      process.kill(runtimePid(), 'SIGKILL');
    } catch {
      // đã thoát
    }
    await sleep(3500);
  }
  await sleep(2000);
  let rows = [];
  for (let i = 0; i < 40 && !rows.length; i++) {
    rows = await auditRows(fp, 'action=tag.write').catch(() => []);
    if (!rows.length) await sleep(500);
  }
  const startedIds = new Set(
    rows.filter((r) => r.result === 'started').map((r) => detailOf(r).requestId),
  );
  const interrupted = new Map(
    rows.filter((r) => r.result === 'interrupted').map((r) => [detailOf(r).requestId, r]),
  );
  const finished = new Set(
    rows.filter((r) => ['ok', 'failed'].includes(r.result)).map((r) => detailOf(r).requestId),
  );
  const open = ids.filter((id) => !interrupted.has(id) && !finished.has(id));
  check(
    'mọi lệnh xung bị kill giữa chừng có kết quả hoặc dòng interrupted',
    open.length === 0,
    `${open.length}/${ids.length} mở`,
  );
  check(
    'lệnh dở: interrupted kèm UNKNOWN_OUTCOME',
    [...interrupted.values()].every(
      (r) => r.code === 'UNKNOWN_OUTCOME' || detailOf(r).pulse === 'pending',
    ),
    `${interrupted.size}`,
  );
  const writes = await simWrites(mark);
  check(
    '0 lệnh tới giả lập khi chưa có dòng audit nhận lệnh',
    ids.every((id) => startedIds.has(id)) && writes.length <= startedIds.size * 2 + 0,
    `${writes.length} lệnh, ${startedIds.size} dòng`,
  );
  check(
    'mỗi vòng có đúng một lệnh xung được nhận (ACCEPTED)',
    ids.length === rounds,
    `${ids.length}/${rounds}`,
  );
  check(
    'mỗi lệnh bị kill giữa chừng có dòng interrupted',
    interrupted.size >= ids.length && ids.length > 0,
    `${interrupted.size}/${ids.length}`,
  );
  // Bit lệnh sau kill: runtime không tự nhả (R17: ghi nhận, cảnh báo bằng audit); chỉ đo để báo cáo
  const coil = await simMem('coils', 10).catch(() => undefined);
  Object.assign(rep.measures, {
    rounds,
    sent: ids.length,
    interrupted: interrupted.size,
    coilAfterKill: coil,
  });
  return rep.result();
}

// --------------------------------------------------------------------------------------- expect

export async function expectScenario(fp) {
  const rep = makeReport('expect');
  const { check } = rep;
  const w = new Web(fp);
  await waitPolling();
  // 013: R.RUN is written by btn_toggle, an engineer's component: two engineer sessions
  const A = (await w.login('kysu1', pw('kysu1'))).session;
  const B = (await w.login('kysu1', pw('kysu1'))).session;
  // đưa R.RUN về false
  const reset = await w.writeAndWait(A, { tag: 'R.RUN', value: false });
  check('đặt R.RUN = false', reset.final?.status === 'CONFIRMED', JSON.stringify(reset.final));
  const a = await w.writeAndWait(A, {
    tag: 'R.RUN',
    value: true,
    expect: false,
    context: { screen: 'tong-quan', widget: 'btn_toggle' },
  });
  check(
    'client A (expect false → true): CONFIRMED',
    a.final?.status === 'CONFIRMED',
    JSON.stringify(a.final),
  );
  const mB = await simMark();
  const b = await w.writeAndWait(B, { tag: 'R.RUN', value: true, expect: false });
  check(
    'client B cùng đảo false → true: REJECTED STALE_EXPECTATION',
    b.final?.status === 'REJECTED' && (b.final?.reason ?? b.final?.code) === 'STALE_EXPECTATION',
    JSON.stringify(b.final),
  );
  check(
    'client B: không gì tới thiết bị trường',
    (await simWrites(mB)).length === 0,
    (await simWrites(mB)).length,
  );
  const c = await w.write(A, { tag: 'SIM.MODE', value: 1, expect: true });
  check(
    'expect trên Tag không phải BOOL: REJECTED EXPECT_NOT_BOOL',
    reasonOf(c) === 'EXPECT_NOT_BOOL',
    reasonOf(c),
  );
  const d = await w.write(B, { tag: 'R.RUN', value: false, expect: true });
  check(
    'expect khớp (true → false): ACCEPTED',
    d.json?.results?.[0]?.status === 'ACCEPTED',
    JSON.stringify(d.json?.results?.[0]),
  );
  await sleep(1500);
  const rows = await auditRows(fp, 'action=tag.write&target=R.RUN');
  check(
    'audit: detail có expect',
    rows.some((r) => detailOf(r).expect === false),
    rows.length,
  );
  return rep.result();
}
