// Kịch bản `data-api` của web-it (feature 025, specs/025-data-api T042): API dữ liệu trên runtime x64 thật với giả lập
// Modbus (project dashboard-demo, không có quy tắc quyền: mặc định của 013). Quản trị viên tạo key qua API quản trị
// (phiên web + CSRF; key ghi được cần mật khẩu), key đọc Tag/giá trị (giá trị thật từ giả lập), key chỉ đọc không ghi
// được, key ghi được ghi TANK01.SP xuống giả lập (CONFIRMED), gửi lại cùng requestId không ghi lần hai, thu hồi thì bị
// từ chối ngay, HTTP thường bị từ chối, token phiên của người không mở được /data, audit đủ. Phần gọi bằng curl thật
// ở tests/web-it/data-api-curl.sh (tools/web-it.ps1 chạy trong container rt).
import {
  BASE,
  Web,
  api,
  auditRows,
  makeReport,
  plainHttp,
  simMark,
  simWrites,
  sleep,
  uuid,
} from '../lib/api.mjs';
import { pinnedRequest } from '../../../tools/measure/device-api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];

export async function dataApi(fp) {
  const rep = makeReport('data-api');
  const { check, measures } = rep;
  const w = new Web(fp);
  const A = (await w.login('admin', pw('admin'))).session;
  if (!check('quản trị viên đăng nhập web được', !!A)) return rep.result();

  const admin = (method, path, body) =>
    w.request(method, path, {
      s: A,
      body: body === undefined ? undefined : JSON.stringify(body),
      h:
        method === 'POST'
          ? { 'Content-Type': 'application/json' }
          : { 'Sec-Fetch-Site': 'same-origin' },
    });
  const key = (token, method, path, body) =>
    pinnedRequest(BASE, fp, method, path, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // ---- tạo key
  const l0 = await admin('GET', '/api/v1/admin/apikeys');
  check(
    'GET admin/apikeys: 200, rỗng',
    l0.status === 200 && l0.json?.keys?.length === 0,
    `${l0.status}`,
  );
  const c1 = await admin('POST', '/api/v1/admin/apikeys', {
    rev: l0.json?.rev ?? 0,
    name: 'BI chỉ đọc',
  });
  const reader = c1.json?.token ?? '';
  check(
    'tạo key chỉ đọc: 201, token matk_',
    c1.status === 201 && /^matk_[A-Za-z0-9_-]{43}$/.test(reader),
    `${c1.status}`,
  );
  const c2no = await admin('POST', '/api/v1/admin/apikeys', {
    rev: c1.json?.rev,
    name: 'MES ghi',
    role: 'operator',
    readOnly: false,
  });
  check(
    'key ghi được không có mật khẩu: 403 REAUTH_REQUIRED',
    c2no.status === 403 && c2no.json?.error === 'REAUTH_REQUIRED',
    `${c2no.status} ${c2no.json?.error}`,
  );
  const c2 = await admin('POST', '/api/v1/admin/apikeys', {
    rev: c1.json?.rev,
    name: 'MES ghi',
    role: 'operator',
    readOnly: false,
    reauth: pw('admin'),
  });
  const writer = c2.json?.token ?? '';
  const writerId = c2.json?.key?.id ?? '';
  check(
    'tạo key ghi được có mật khẩu: 201',
    c2.status === 201 && writer.startsWith('matk_'),
    `${c2.status}`,
  );
  const l1 = await admin('GET', '/api/v1/admin/apikeys');
  check(
    'danh sách không có token',
    l1.status === 200 && !l1.body.includes(reader.slice(12)) && !l1.body.includes(writer.slice(12)),
  );

  // ---- đọc
  const k = await key(reader, 'GET', '/api/v1/data/key');
  check(
    'data/key: viewer, chỉ đọc',
    k.status === 200 && k.json?.role === 'viewer' && k.json?.canWrite === false,
    `${k.status} ${k.body}`,
  );
  const t = await key(reader, 'GET', '/api/v1/data/tags');
  const names = (t.json?.tags ?? []).map((x) => x.name);
  check(
    'data/tags: có TANK01.LEVEL, TANK01.SP',
    t.status === 200 && names.includes('TANK01.LEVEL') && names.includes('TANK01.SP'),
    `${t.status} ${names.length}`,
  );
  measures.tags = names.length;
  let v;
  for (let i = 0; i < 20; i++) {
    v = await key(reader, 'GET', '/api/v1/data/values?tags=TANK01.LEVEL,TANK01.SP');
    if (v.json?.values?.[0]?.quality === 'GOOD') break;
    await sleep(500);
  }
  check(
    'data/values: giá trị GOOD từ giả lập, có thời điểm',
    v.status === 200 &&
      v.json?.values?.[0]?.quality === 'GOOD' &&
      typeof v.json.values[0].value === 'number' &&
      typeof v.json.values[0].sourceTs === 'string',
    `${v.status} ${v.body.slice(0, 200)}`,
  );
  const bad = await key(reader, 'GET', '/api/v1/data/values?tags=KHONG.CO');
  check(
    'Tag không có: 403 ACCESS_DENIED',
    bad.status === 403 && bad.json?.error === 'ACCESS_DENIED',
    `${bad.status}`,
  );
  const ro = await key(reader, 'POST', '/api/v1/data/write', {
    requests: [{ requestId: uuid(), tag: 'TANK01.SP', value: 40 }],
  });
  check(
    'key chỉ đọc ghi: 403 FORBIDDEN',
    ro.status === 403 && ro.json?.error === 'FORBIDDEN',
    `${ro.status}`,
  );

  // ---- ghi qua giả lập, idempotent
  const mark = await simMark();
  const rid = uuid();
  const value = 40 + Math.round(Math.random() * 40);
  const p1 = await key(writer, 'POST', '/api/v1/data/write', {
    requests: [{ requestId: rid, tag: 'TANK01.SP', value }],
  });
  check(
    'ghi TANK01.SP: ACCEPTED',
    p1.status === 200 && p1.json?.results?.[0]?.status === 'ACCEPTED',
    `${p1.status} ${p1.body}`,
  );
  let fin;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    fin = (await key(writer, 'GET', `/api/v1/data/write/${rid}`)).json?.results?.[0];
    if (fin && fin.status !== 'ACCEPTED') break;
  }
  check('kết quả: CONFIRMED', fin?.status === 'CONFIRMED', JSON.stringify(fin));
  const p2 = await key(writer, 'POST', '/api/v1/data/write', {
    requests: [{ requestId: rid, tag: 'TANK01.SP', value }],
  });
  check(
    'gửi lại cùng requestId: duplicate',
    p2.status === 200 && p2.json?.results?.[0]?.duplicate === true,
    p2.body,
  );
  await sleep(500);
  const writes = (await simWrites(mark)).length;
  check('giả lập nhận đúng một lệnh ghi', writes === 1, `${writes}`);
  measures.simWrites = writes;
  const other = await key(reader, 'GET', `/api/v1/data/write/${rid}`);
  check('key khác không thấy kết quả', other.json?.results?.[0]?.status === 'UNKNOWN', other.body);

  // ---- từ chối
  const http = await plainHttp('GET', '/api/v1/data/key', { Authorization: `Bearer ${reader}` });
  check(
    'HTTP thường: 403 HTTPS_REQUIRED',
    http.status === 403 && http.json?.error === 'HTTPS_REQUIRED',
    `${http.status}`,
  );
  const person = await api(fp, 'admin', 'GET', '/api/v1/data/key');
  check(
    'token phiên của người: 401 AUTH_REQUIRED',
    person.status === 401 && person.json?.error === 'AUTH_REQUIRED',
    `${person.status}`,
  );
  const l2 = await admin('GET', '/api/v1/admin/apikeys');
  const rv = await admin('POST', `/api/v1/admin/apikeys/${writerId}/revoke`, { rev: l2.json?.rev });
  check('thu hồi: 200', rv.status === 200, `${rv.status}`);
  const gone = await key(writer, 'GET', '/api/v1/data/key');
  check(
    'key đã thu hồi: 401 APIKEY_INVALID ngay',
    gone.status === 401 && gone.json?.error === 'APIKEY_INVALID',
    `${gone.status}`,
  );
  const l3 = await admin('GET', '/api/v1/admin/apikeys');
  const used = (l3.json?.keys ?? []).find((x) => x.name === 'BI chỉ đọc');
  check(
    'bảng key: số gọi và lần dùng cuối',
    used && used.calls >= 4 && typeof used.lastUsedAt === 'string',
    JSON.stringify(used),
  );

  // ---- audit
  const rows = await auditRows(fp, 'action=apikey');
  const acts = new Set(rows.map((r) => `${r.action}/${r.result}`));
  check(
    'audit: apikey.create, apikey.revoke, apikey.denied',
    acts.has('apikey.create/ok') &&
      acts.has('apikey.revoke/ok') &&
      acts.has('apikey.denied/denied'),
    [...acts].join(', '),
  );
  const tw = await auditRows(fp, 'action=tag.write');
  check(
    'audit: tag.write của apikey:<id>',
    tw.some((r) => r.user === `apikey:${writerId}` && r.result === 'started'),
    tw
      .slice(0, 3)
      .map((r) => `${r.user}/${r.result}`)
      .join(', '),
  );
  const all = JSON.stringify([...rows, ...tw]);
  check(
    'audit không chứa token',
    !all.includes(reader.slice(12)) && !all.includes(writer.slice(12)),
  );
  return rep.result();
}
