// Bộ ca tấn công vào API alarm (feature 009 T111, T115; FR-091, FR-088; SC-007): kỳ vọng 100 % bị từ chối, 0 đổi trạng thái,
// audit hoặc đếm theo gộp 60 s. Client Node trên máy dev vào rt x64 (tests/alarm-it/compose.yaml).
//   node tools/alarm-it/attack-cases.mjs     → một dòng JSON { scenario, checks, measures, pass }
import {
  auditRows,
  bearer,
  breq,
  emit,
  getAlarms,
  HTTP,
  httpGet,
  makeReport,
  simCoil,
  sleep,
  waitFor,
  waitRuntime,
  webLogin,
  wreq,
} from './lib.mjs';
import http from 'node:http';

// Giới hạn 10 POST/giây/phiên (device-api-1.3 §1.2): các ca thường giãn 120 ms để chỉ ca A16 chạm giới hạn.
const twreq = async (...a) => {
  await sleep(120);
  return wreq(...a);
};
const r = makeReport('attack');
const cases = [];

/** Ghi một ca: kỳ vọng mã trạng thái nằm trong `want` (và, nếu có, `error` khớp). */
function expect(name, resp, want, errorRe) {
  const ok = want.includes(resp.status) && (!errorRe || errorRe.test(resp.body ?? ''));
  cases.push({ name, status: resp.status, ok });
  r.check(
    `${name}: bị từ chối (${want.join('/')})`,
    ok,
    `${resp.status} ${String(resp.body ?? '').slice(0, 140)}`,
  );
}

function httpPost(path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      `${HTTP}${path}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const stateKey = (d) =>
  JSON.stringify(d.instances.map((i) => [i.id, i.state, i.occurrence, !!i.shelved, i.disabled]));

try {
  await waitRuntime(60000);
  const op = await webLogin('vh1');
  const op2 = await webLogin('vh2');
  const viewer = await webLogin('xem1');
  const eng = await webLogin('kysu1');
  const admin = await bearer('admin');

  // nền: một alarm đang ACTIVE_UNACK để tấn công
  await simCoil(0, 0);
  await simCoil(0, 1);
  const base = await waitFor(
    async () => {
      const d = await getAlarms();
      return d.instances.find((i) => i.id === 'IT_FAULT' && i.state === 'ACTIVE_UNACK') ? d : null;
    },
    20000,
    'IT_FAULT bật',
  );
  const occ = base.instances.find((i) => i.id === 'IT_FAULT').occurrence;
  const item = { items: [{ id: 'IT_FAULT', occurrence: occ }] };
  const before = stateKey(base);
  const revBefore = base.revision;
  const ackOkBefore = (await auditRows(admin, 'action=alarm.ack')).filter(
    (x) => x.result === 'ok',
  ).length;
  const shelveOkBefore = (await auditRows(admin, 'action=alarm.shelve')).filter(
    (x) => x.result === 'ok',
  ).length;
  const disableOkBefore = (await auditRows(admin, 'action=alarm.disable')).filter(
    (x) => x.result === 'ok',
  ).length;
  const deniedBefore =
    (await auditRows(admin, 'action=access.denied')).length +
    (await auditRows(admin, 'action=alarm.ack')).filter((x) => x.result === 'denied').length;

  // 1-3. CSRF
  expect(
    'A1 thiếu X-MAT-CSRF',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { noCsrf: true }),
    [403],
    /CSRF/,
  );
  expect(
    'A2 X-MAT-CSRF sai',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { 'X-MAT-CSRF': 'x'.repeat(43) } }),
    [403],
    /CSRF/,
  );
  expect(
    'A3 CSRF của phiên khác (vh2) với cookie của vh1',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { 'X-MAT-CSRF': op2.csrf } }),
    [403],
    /CSRF/,
  );
  expect(
    'A3b CSRF rỗng',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { 'X-MAT-CSRF': '' } }),
    [403],
    /CSRF/,
  );
  // 4. Origin
  expect(
    'A4 Origin lạ',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { Origin: 'https://evil.example' } }),
    [403],
    /ORIGIN/,
  );
  expect(
    'A5 thiếu Origin',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { noOrigin: true }),
    [403],
    /ORIGIN/,
  );
  expect(
    'A5b Origin null',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { Origin: 'null' } }),
    [403],
    /ORIGIN/,
  );
  expect(
    'A5c Origin cùng host khác cổng',
    await twreq('POST', '/api/v1/alarms/ack', op, item, { h: { Origin: 'https://127.0.0.1:9' } }),
    [403],
    /ORIGIN/,
  );
  // 6. cookie trên HTTP (không TLS): cookie Secure __Host- không hợp lệ qua HTTP; thao tác ghi qua HTTP bị từ chối
  expect(
    'A6 cookie hợp lệ gửi qua HTTP',
    await httpPost(
      '/api/v1/alarms/ack',
      { cookie: `__Host-mat_sid=${op.cookie}`, 'x-mat-csrf': op.csrf, origin: HTTP },
      item,
    ),
    [401, 403, 426],
  );
  expect(
    'A6b ack qua HTTP không phiên',
    await httpPost('/api/v1/alarms/ack', {}, item),
    [401, 403, 426],
  );
  // 7. cookie gọi disable/enable
  expect(
    'A7 cookie engineer gọi disable',
    await twreq('POST', '/api/v1/alarms/disable', eng, { id: 'IT_FAULT', reason: 'tấn công' }),
    [403],
    /SESSION_SCOPE/,
  );
  expect(
    'A8 cookie engineer gọi enable',
    await twreq('POST', '/api/v1/alarms/enable', eng, { id: 'IT_FAULT' }),
    [403],
    /SESSION_SCOPE/,
  );
  expect(
    'A8b cookie operator gọi disable',
    await twreq('POST', '/api/v1/alarms/disable', op, { id: 'IT_FAULT', reason: 'x' }),
    [403],
  );
  // 9. GET đổi trạng thái
  for (const path of [
    '/api/v1/alarms/ack',
    '/api/v1/alarms/shelve',
    '/api/v1/alarms/disable',
    '/api/v1/alarms/enable',
    '/api/v1/alarms/unshelve',
  ]) {
    expect(`A9 GET ${path}`, await twreq('GET', path, op), [404, 405]);
  }
  expect(
    'A9b GET /alarms?ack=IT_FAULT (tham số lạ không đổi gì)',
    await (async () => {
      const x = await httpGet(`/api/v1/alarms?ack=IT_FAULT&occurrence=${occ}`);
      return {
        status: x.status === 200 && stateKey(x.json) === before ? 405 : x.status,
        body: 'GET trả 200 và không đổi trạng thái',
      };
    })(),
    [405],
  );
  // 10. role thấp
  expect('A10 viewer ack', await twreq('POST', '/api/v1/alarms/ack', viewer, item), [403]);
  expect(
    'A10b viewer shelve',
    await twreq('POST', '/api/v1/alarms/shelve', viewer, {
      id: 'IT_FAULT',
      reason: 'x',
      durationS: 60,
    }),
    [403],
  );
  expect(
    'A10c viewer unshelve',
    await twreq('POST', '/api/v1/alarms/unshelve', viewer, { id: 'IT_FAULT' }),
    [403],
  );
  expect(
    'A10d khách (không phiên) ack',
    await twreq('POST', '/api/v1/alarms/ack', undefined, item),
    [401],
  );
  expect(
    'A10e khách shelve',
    await twreq('POST', '/api/v1/alarms/shelve', undefined, {
      id: 'IT_FAULT',
      reason: 'x',
      durationS: 60,
    }),
    [401],
  );
  expect(
    'A10f operator (Bearer) disable',
    await breq('POST', '/api/v1/alarms/disable', await bearer('vh1'), {
      id: 'IT_FAULT',
      reason: 'x',
    }),
    [403],
  );
  expect(
    'A10g viewer (Bearer) enable',
    await breq('POST', '/api/v1/alarms/enable', await bearer('xem1'), { id: 'IT_FAULT' }),
    [403],
  );
  // 11. phiên hết hạn / đăng xuất, đúng-sai-đúng
  const tmp = await webLogin('vh1');
  await twreq('POST', '/api/v1/web/logout', tmp);
  expect(
    'A11 phiên đã đăng xuất (mất phiên giữa chừng)',
    await twreq('POST', '/api/v1/alarms/ack', tmp, item),
    [401],
  );
  expect(
    'A11b cookie giả (không từng cấp)',
    await twreq(
      'POST',
      '/api/v1/alarms/ack',
      { cookie: 'A'.repeat(43), csrf: 'B'.repeat(43) },
      item,
    ),
    [401],
  );
  // đúng-sai-đúng: (đúng) shelve hợp lệ, (sai) ack khi mất phiên, (đúng) unshelve bằng phiên mới
  const rs = await webLogin('vh1');
  const good1 = await twreq('POST', '/api/v1/alarms/shelve', rs, {
    id: 'IT_FAULT2',
    reason: 'đúng-sai-đúng',
    durationS: 60,
  });
  r.check(
    'A12 đúng: shelve hợp lệ trước khi mất phiên (200)',
    good1.status === 200,
    `${good1.status}`,
  );
  await twreq('POST', '/api/v1/web/logout', rs);
  expect(
    'A12 sai: ack bằng phiên vừa mất',
    await twreq('POST', '/api/v1/alarms/ack', rs, item),
    [401],
  );
  const rs2 = await webLogin('vh1');
  const good2 = await twreq('POST', '/api/v1/alarms/unshelve', rs2, { id: 'IT_FAULT2' });
  r.check(
    'A12 đúng: phiên mới unshelve (200) — mất phiên không để lại trạng thái hỏng',
    good2.status === 200,
    `${good2.status}`,
  );
  // 13. thân quá lớn, dạng lỗi
  expect(
    'A13 thân 20 KiB',
    await twreq('POST', '/api/v1/alarms/ack', op, undefined, {
      raw: JSON.stringify({ items: [], pad: 'x'.repeat(20 * 1024) }),
      h: { 'Content-Type': 'application/json' },
    }),
    [413, 400],
  );
  expect(
    'A13b thân 2 MiB',
    await twreq('POST', '/api/v1/alarms/ack', op, undefined, {
      raw: '{"pad":"' + 'x'.repeat(2 * 1024 * 1024) + '"}',
      h: { 'Content-Type': 'application/json' },
    }),
    [413, 400, 0].filter((x) => x),
    undefined,
  );
  expect(
    'A13c Content-Type sai',
    await twreq('POST', '/api/v1/alarms/ack', op, undefined, {
      raw: JSON.stringify(item),
      h: { 'Content-Type': 'text/plain' },
    }),
    [415],
  );
  expect(
    'A13d JSON hỏng',
    await twreq('POST', '/api/v1/alarms/ack', op, undefined, {
      raw: '{"items":[',
      h: { 'Content-Type': 'application/json' },
    }),
    [400],
  );
  expect(
    'A13e khóa lạ trong thân',
    await twreq('POST', '/api/v1/alarms/ack', op, { items: item.items, evil: 1 }),
    [400],
  );
  expect(
    'A13f vừa items vừa all',
    await twreq('POST', '/api/v1/alarms/ack', op, {
      items: item.items,
      all: true,
      upToRevision: revBefore,
    }),
    [400],
  );
  expect(
    'A13g JSON lồng sâu 200 tầng',
    await twreq('POST', '/api/v1/alarms/ack', op, undefined, {
      raw: '['.repeat(200) + ']'.repeat(200),
      h: { 'Content-Type': 'application/json' },
    }),
    [400, 413],
  );
  // 14. ack 1000 mục
  const many = {
    items: Array.from({ length: 1000 }, (_, i) => ({
      id: `IT_X${String(i).padStart(4, '0')}`,
      occurrence: i + 1,
    })),
  };
  expect('A14 ack 1.000 mục', await twreq('POST', '/api/v1/alarms/ack', op, many), [400, 413]);
  expect(
    'A14b ack 101 mục (giới hạn 100)',
    await twreq('POST', '/api/v1/alarms/ack', op, { items: many.items.slice(0, 101) }),
    [400],
  );
  // 15. id sai dạng, tiêm
  expect(
    'A15 id tiêm SQL "\' OR 1=1 --"',
    await twreq('POST', '/api/v1/alarms/ack', op, {
      items: [{ id: "x' OR 1=1 --", occurrence: 1 }],
    }),
    [400],
  );
  expect(
    'A15b id dài 5.000 ký tự',
    await twreq('POST', '/api/v1/alarms/shelve', op, {
      id: 'A'.repeat(5000),
      reason: 'x',
      durationS: 60,
    }),
    [400, 413],
  );
  expect(
    'A15c shelve durationS ngoài khoảng',
    await twreq('POST', '/api/v1/alarms/shelve', op, { id: 'IT_FAULT', reason: 'x', durationS: 5 }),
    [422],
  );
  expect(
    'A15d shelve lý do rỗng',
    await twreq('POST', '/api/v1/alarms/shelve', op, {
      id: 'IT_FAULT',
      reason: '   ',
      durationS: 60,
    }),
    [422],
  );
  expect(
    'A15e shelve id không tồn tại',
    await twreq('POST', '/api/v1/alarms/shelve', op, {
      id: 'KHONG_CO',
      reason: 'x',
      durationS: 60,
    }),
    [404],
  );
  expect(
    'A15f ack all thiếu upToRevision',
    await twreq('POST', '/api/v1/alarms/ack', op, { all: true }),
    [400],
  );
  expect(
    'A15g history from >= to',
    await httpGet('/api/v1/alarms/history?from=10&to=5'),
    [400],
    /BAD_QUERY/,
  );
  expect(
    'A15h history tham số lạ',
    await httpGet('/api/v1/alarms/history?evil=1'),
    [400],
    /BAD_QUERY/,
  );
  const likeEsc = await httpGet("/api/v1/alarms/history?q=%25_%5C'");
  r.check(
    "A15i history q chứa % _ \\ ' (thoát phía máy chủ): 200, không lỗi SQL",
    likeEsc.status === 200,
    `${likeEsc.status} ${likeEsc.body.slice(0, 100)}`,
  );
  cases.push({ name: 'A15i', status: likeEsc.status, ok: likeEsc.status === 200 });

  // 16. giới hạn tần suất: > 10 POST/giây một phiên
  const burstSession = await webLogin('vh1');
  const burst = await Promise.all(
    Array.from({ length: 30 }, () =>
      wreq('POST', '/api/v1/alarms/shelve', burstSession, {
        id: 'KHONG_CO',
        reason: 'x',
        durationS: 60,
      }),
    ),
  );
  const limited = burst.filter((x) => x.status === 429).length;
  r.check(
    `A16 giới hạn tần suất: 30 POST/phiên đồng thời có 429 (${limited})`,
    limited >= 10,
    `${limited} lần 429`,
  );
  cases.push({ name: 'A16 rate limit', status: 429, ok: limited >= 10 });

  // kết luận: 0 đổi trạng thái, 0 audit ok mới, bị từ chối có audit/đếm
  await sleep(1500);
  const after = await getAlarms();
  r.check(
    '0 đổi trạng thái alarm sau toàn bộ ca tấn công (instances giống hệt)',
    stateKey(after) === before,
    `${stateKey(after).slice(0, 120)}`,
  );
  r.check(
    'revision động cơ không tăng do tấn công (chỉ tăng do hai thao tác hợp lệ shelve/unshelve của A12)',
    after.revision - revBefore <= 6,
    `${revBefore} -> ${after.revision}`,
  );
  const ackOkAfter = (await auditRows(admin, 'action=alarm.ack')).filter(
    (x) => x.result === 'ok',
  ).length;
  const shelveOkAfter = (await auditRows(admin, 'action=alarm.shelve')).filter(
    (x) => x.result === 'ok',
  ).length;
  const disableOkAfter = (await auditRows(admin, 'action=alarm.disable')).filter(
    (x) => x.result === 'ok',
  ).length;
  r.check(
    '0 dòng audit alarm.ack ok mới',
    ackOkAfter === ackOkBefore,
    `${ackOkBefore} -> ${ackOkAfter}`,
  );
  r.check(
    '0 dòng audit alarm.disable ok mới',
    disableOkAfter === disableOkBefore,
    `${disableOkBefore} -> ${disableOkAfter}`,
  );
  r.check(
    'chỉ 1 dòng audit alarm.shelve ok mới (ca đúng của A12)',
    shelveOkAfter - shelveOkBefore === 1,
    `${shelveOkBefore} -> ${shelveOkAfter}`,
  );
  const deniedAfter =
    (await auditRows(admin, 'action=access.denied')).length +
    (await auditRows(admin, 'action=alarm.ack')).filter((x) => x.result === 'denied').length;
  r.check(
    'bị từ chối có dấu vết audit (access.denied hoặc alarm.ack denied, gộp 60 s)',
    deniedAfter > deniedBefore,
    `${deniedBefore} -> ${deniedAfter}`,
  );
  const rejected = cases.filter((c) => c.ok).length;
  r.check(`100 % ca bị từ chối đúng (${rejected}/${cases.length})`, rejected === cases.length);
  r.measures.cases = cases.length;
  r.measures.rejected = rejected;
  r.measures.rateLimited = limited;
  await simCoil(0, 0);
} catch (e) {
  r.check(`ngoại lệ: ${String(e.stack ?? e).slice(0, 400)}`, false);
}
const out = emit(r);
process.exit(out.pass ? 0 : 1);
