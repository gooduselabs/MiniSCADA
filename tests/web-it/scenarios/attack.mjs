// Kịch bản `attack` (feature 007, T059, T073, SC-007): 30 ca tấn công của specs/007-screens-widgets/contracts/
// web-session.md §5, mỗi ca với runtime thật: mã HTTP và `error` đúng, 0 lệnh ghi tới giả lập Modbus, dòng audit đúng.
// A29 (XSS qua props) và A30 (nhúng iframe) cần trình duyệt: A30 kiểm thêm ở đây bằng header CSP; A29 ở kịch bản
// `widgets` của trình duyệt.
import {
  HOST,
  LAN_IP,
  PUB_IP,
  Web,
  auditRows,
  detailOf,
  makeReport,
  plainHttp,
  simMark,
  simWrites,
  sleep,
  uuid,
  wsUpgrade,
  api,
} from '../lib/api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];
const codeOf = (r) =>
  r.json?.error ?? r.json?.code ?? r.json?.results?.[0]?.reason ?? r.json?.results?.[0]?.code;

/**
 * `opts.context`: ngữ cảnh gắn vào mọi lệnh ghi của các ca (feature 008 T084: { screen, widget: elementUid } của phần tử SVG, để
 * chứng minh 30 ca vẫn bị từ chối khi lệnh mang ngữ cảnh của phần tử SVG); `opts.name`: tên kịch bản trong báo cáo.
 */
export async function attack(fp, opts = {}) {
  const rep = makeReport(opts.name ?? 'attack');
  const { check } = rep;
  const w = new Web(fp);
  const body = (extra = {}) =>
    JSON.stringify({
      requests: [
        {
          requestId: uuid(),
          tag: 'PUMP01.RUN_CMD',
          value: true,
          ...(opts.context ? { context: opts.context } : {}),
          ...extra,
        },
      ],
    });

  const S = (await w.login('vh1', pw('vh1'))).session;
  const S2 = (await w.login('vh2', pw('vh2'))).session;
  const V = (await w.login('xem1', pw('xem1'))).session;
  const E = (await w.login('kysu1', pw('kysu1'))).session;
  if (!S || !S2 || !V || !E) {
    check('phiên thử đăng nhập được', false, `S=${!!S} S2=${!!S2} V=${!!V} E=${!!E}`);
    return rep.result();
  }
  const cases = [];
  /** Chạy một ca: `run` trả phản hồi; `want` = { status, code? | codes? | any }. */
  const run = async (id, name, run, want, { writes = 0 } = {}) => {
    const mark = await simMark();
    let r;
    try {
      r = await run();
    } catch (e) {
      r = { status: -1, error: e.message, json: null, headers: {} };
    }
    await sleep(120);
    const sent = (await simWrites(mark)).length;
    const statusOk = Array.isArray(want.status)
      ? want.status.includes(r.status)
      : r.status === want.status;
    const code = codeOf(r);
    const codeOk = want.code === undefined || code === want.code;
    cases.push({ id, status: r.status, code, writes: sent });
    check(
      `${id}: ${name}`,
      statusOk && codeOk && sent === writes,
      `HTTP ${r.status} ${code ?? ''} lệnh tới giả lập ${sent}`,
    );
    return r;
  };
  const tw = (s, opts = {}) =>
    w.request('POST', '/api/v1/tags/write', { s, body: body(), ...opts });

  // A24 chạy đầu: audit giới hạn 10 dòng từ chối mỗi phút (các ca sau gộp), dòng của viewer phải còn
  // Viewer ghi
  await run('A24', 'viewer ghi Tag', () => tw(V), { status: 403, code: 'FORBIDDEN' });
  // CSRF
  await run('A1', 'ghi bằng cookie, thiếu X-MAT-CSRF', () => tw(S, { noCsrf: true }), {
    status: 403,
    code: 'CSRF_FAILED',
  });
  const flipped = S.csrf.slice(0, -1) + (S.csrf.endsWith('A') ? 'B' : 'A');
  await run('A2', 'CSRF sai một ký tự', () => tw(S, { h: { 'X-MAT-CSRF': flipped } }), {
    status: 403,
    code: 'CSRF_FAILED',
  });
  await run('A3', 'CSRF của phiên khác', () => tw(S, { h: { 'X-MAT-CSRF': S2.csrf } }), {
    status: 403,
    code: 'CSRF_FAILED',
  });
  // Origin
  await run('A4', 'Origin lạ', () => tw(S, { h: { Origin: 'https://evil.example' } }), {
    status: 403,
    code: 'ORIGIN_MISMATCH',
  });
  await run('A5', 'thiếu Origin', () => tw(S, { noOrigin: true }), {
    status: 403,
    code: 'ORIGIN_MISMATCH',
  });
  await run('A6', 'Origin: null', () => tw(S, { h: { Origin: 'null' } }), {
    status: 403,
    code: 'ORIGIN_MISMATCH',
  });
  await run(
    'A7',
    'Origin HTTP cùng máy',
    () => tw(S, { h: { Origin: `http://${HOST.split(':')[0]}:8080` } }),
    { status: 403, code: 'ORIGIN_MISMATCH' },
  );
  // A8: cookie qua HTTP
  await run(
    'A8',
    'cookie qua HTTP 8080: HTTPS_REQUIRED',
    () =>
      plainHttp(
        'POST',
        '/api/v1/tags/write',
        {
          Cookie: `__Host-mat_sid=${S.cookie}`,
          Origin: `http://${HOST.split(':')[0]}:8080`,
          'X-MAT-CSRF': S.csrf,
          'Content-Type': 'application/json',
        },
        body(),
      ),
    { status: 403, code: 'HTTPS_REQUIRED' },
  );
  // Phạm vi cookie
  await run(
    'A9',
    'cookie operator nạp xuống',
    () =>
      w.request('POST', '/api/v1/project/deployments', {
        s: S,
        h: { 'Content-Type': 'application/zip' },
        body: 'PK',
      }),
    { status: 403, code: 'SESSION_SCOPE' },
  );
  await run('A10', 'cookie đọc audit', () => w.request('GET', '/api/v1/audit', { s: S }), {
    status: 403,
    code: 'SESSION_SCOPE',
  });
  await run(
    'A11a',
    'cookie drivers/test',
    () => w.request('POST', '/api/v1/drivers/test', { s: S, body: '{}' }),
    { status: 403, code: 'SESSION_SCOPE' },
  );
  await run(
    'A11b',
    'cookie serial/ports',
    () => w.request('GET', '/api/v1/serial/ports', { s: S }),
    {
      status: 403,
      code: 'SESSION_SCOPE',
    },
  );
  await run(
    'A11c',
    'cookie drivers/diagnostics',
    () => w.request('GET', '/api/v1/drivers/diagnostics', { s: S }),
    { status: 403, code: 'SESSION_SCOPE' },
  );
  await run(
    'A12',
    'cookie engineer nạp xuống',
    () =>
      w.request('POST', '/api/v1/project/deployments', {
        s: E,
        h: { 'Content-Type': 'application/zip' },
        body: 'PK',
      }),
    { status: 403, code: 'SESSION_SCOPE' },
  );
  await run(
    'A13',
    'token matw_ trong Authorization: Bearer',
    () => w.request('GET', '/api/v1/audit', { h: { Authorization: `Bearer ${S.cookie}` } }),
    { status: 403, code: 'SESSION_SCOPE' },
  );
  const r14 = await run(
    'A14',
    'token mats_ của Bearer đặt trong cookie',
    async () => {
      const lg = await api(fp, null, 'POST', '/api/v1/auth/login', {
        user: 'kysu1',
        password: pw('kysu1'),
      });
      return w.request('GET', '/api/v1/web/session', { s: { cookie: lg.json.token } });
    },
    { status: 401 },
  );
  check(
    'A14: mã lỗi AUTH_REQUIRED hoặc SESSION_INVALID',
    ['AUTH_REQUIRED', 'SESSION_INVALID'].includes(codeOf(r14)),
    codeOf(r14),
  );
  // Phương thức, loại nội dung
  await run(
    'A15',
    'GET đổi trạng thái',
    () => w.request('GET', '/api/v1/tags/write?tag=PUMP01.RUN_CMD&value=true', { s: S }),
    { status: [400, 404, 405] },
  );
  await run(
    'A16',
    'Content-Type text/plain',
    () =>
      w.request('POST', '/api/v1/tags/write', {
        s: S,
        h: { 'Content-Type': 'text/plain' },
        raw: body(),
      }),
    { status: [400, 415] },
  );
  await run(
    'A17',
    'form urlencoded',
    () =>
      w.request('POST', '/api/v1/tags/write', {
        s: S,
        h: { 'Content-Type': 'application/x-www-form-urlencoded' },
        raw: 'tag=PUMP01.RUN_CMD&value=true',
      }),
    { status: [400, 415] },
  );
  await run(
    'A18',
    'web/session với Sec-Fetch-Site: cross-site',
    () => w.request('GET', '/api/v1/web/session', { s: S, h: { 'Sec-Fetch-Site': 'cross-site' } }),
    { status: 403, code: 'FETCH_SITE' },
  );
  // WebSocket
  await run('A19', 'WebSocket cookie, không Origin', () => wsUpgrade(fp, { cookie: S.cookie }), {
    status: 403,
  });
  await run(
    'A20',
    'WebSocket cookie, Origin lạ',
    () => wsUpgrade(fp, { cookie: S.cookie, origin: 'https://evil.example' }),
    { status: 403 },
  );
  // Cố định phiên
  const chosen = `matw_${'c'.repeat(43)}`;
  await run(
    'A21a',
    'cookie tự chọn: không có phiên',
    () => w.request('GET', '/api/v1/web/session', { s: { cookie: chosen } }),
    { status: 401 },
  );
  const fix = await w.login('vh1', pw('vh1'), { s: { cookie: chosen } });
  check(
    'A21b: sau login thành công token khác hẳn token chọn trước',
    fix.session && fix.session.cookie !== chosen && fix.session.cookie !== S.cookie,
    fix.status,
  );
  // Đăng xuất
  const Sx = (await w.login('vh1', pw('vh1'))).session;
  await w.request('POST', '/api/v1/web/logout', { s: Sx });
  await run('A22', 'dùng cookie sau logout', () => tw(Sx), { status: 401 });
  // IP khác
  const Sip = (await w.login('vh1', pw('vh1'), { localAddress: LAN_IP })).session;
  await run('A23', 'cookie từ IP khác', () => tw(Sip, { localAddress: PUB_IP }), {
    status: 401,
    code: 'SESSION_INVALID',
  });
  // Login CSRF
  await run(
    'A25',
    'login với Origin lạ',
    () =>
      w.request('POST', '/api/v1/web/login', {
        h: { Origin: 'https://evil.example' },
        body: JSON.stringify({ username: 'vh1', password: pw('vh1') }),
      }),
    { status: 403, code: 'ORIGIN_MISMATCH' },
  );
  // A30: CSP
  const page = await w.request('GET', '/login');
  const csp = page.headers['content-security-policy'] ?? '';
  check(
    "A30: /login có CSP frame-ancestors 'none'",
    page.status === 200 && /frame-ancestors 'none'/.test(csp),
    `${page.status} ${csp}`,
  );
  const root = await w.request('GET', '/');
  check(
    "A30: trang chính có CSP frame-ancestors 'none'",
    /frame-ancestors 'none'/.test(root.headers['content-security-policy'] ?? ''),
    root.status,
  );

  // Audit: mọi ca bị từ chối có dòng audit (access.denied hoặc tag.write denied) — ca A8, A15..A17, A21 chỉ đếm
  await sleep(500);
  const denied = await auditRows(fp, 'action=access.denied');
  const wdenied = (await auditRows(fp, 'action=tag.write')).filter((r) => r.result === 'denied');
  const dcodes = new Set([
    ...denied.map((r) => r.code ?? detailOf(r).code),
    ...wdenied.map((r) => r.code),
  ]);
  for (const c of ['CSRF_FAILED', 'ORIGIN_MISMATCH', 'SESSION_SCOPE', 'FORBIDDEN'])
    check(`audit có từ chối ${c}`, dcodes.has(c), [...dcodes].join(','));
  const viewerRow = wdenied.find((r) => r.user === 'xem1' && r.code === 'FORBIDDEN');
  check('A24: audit tag.write denied FORBIDDEN của xem1', Boolean(viewerRow), wdenied.length);
  check(
    'audit và phản hồi không chứa token hay CSRF',
    !JSON.stringify([denied, wdenied]).includes(S.csrf) &&
      !JSON.stringify([denied, wdenied]).includes(S.cookie),
  );
  // Tổng: không lệnh nào tới giả lập
  rep.measures.cases = cases.length;
  rep.measures.caseTable = cases;
  return rep.result();
}

/** A26 (khóa), A27 (quota 8 phiên), A28 (đổi mật khẩu) chạy riêng: làm đổi trạng thái tài khoản. */
export async function attackAccounts(fp, part = 'lock') {
  const rep = makeReport('attack-accounts');
  const { check } = rep;
  const w = new Web(fp);
  // A26: 6 lần sai (khóa theo tên VÀ theo IP: phần quota chạy sau khi khởi động lại runtime)
  if (part === 'lock') {
    const codes = [];
    for (let i = 0; i < 6; i++) {
      const r = await w.login('vh2', `sai-mat-khau-so-${i}-xxxxxxxx`);
      codes.push(r.status);
    }
    const ok = await w.login('vh2', pw('vh2'));
    check('A26: lần sai thứ 6 bị khóa 429 AUTH_LOCKED', codes[5] === 429, codes.join(','));
    check(
      'A26: đăng nhập đúng cũng 429 trong thời gian khóa',
      ok.status === 429 && ok.json?.error === 'AUTH_LOCKED',
      ok.status,
    );
    return rep.result();
  }
  // A27: 9 phiên
  const sess = [];
  for (let i = 0; i < 9; i++) {
    const r = await w.login('xem1', pw('xem1'));
    sess.push(r.session);
  }
  const first = await w.request('GET', '/api/v1/web/session', { s: sess[0] });
  const last = await w.request('GET', '/api/v1/web/session', { s: sess[8] });
  check(
    'A27: phiên cũ nhất bị loại ở lần đăng nhập thứ 9; phiên mới còn',
    first.status === 401 && last.status === 200,
    `${first.status}/${last.status}`,
  );
  return rep.result();
}
