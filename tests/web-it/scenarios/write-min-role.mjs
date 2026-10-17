// Kịch bản `write-min-role` của web-it (feature 011, T209, báo cáo 008 F5): Tag có `writeMinRole: engineer` (project
// tests/web-it/out/hardening, sinh bởi tests/web-it/make-hardening.mjs: SIM.MODE của dashboard-demo). `minRole` của
// nút chỉ khóa giao diện; máy chủ mới là chốt: operator gọi thẳng API ghi bị 403 FORBIDDEN cho cả lô (cả phiên web lẫn
// Bearer), không lệnh nào chạy, có audit tag.write denied; engineer ghi được; Tag khác operator vẫn ghi được.
import { Web, api, auditRows, detailOf, makeReport, uuid } from '../lib/api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];

export async function writeMinRole(fp) {
  const rep = makeReport('write-min-role');
  const { check, measures } = rep;
  const w = new Web(fp);
  const S = (await w.login('vh1', pw('vh1'))).session;
  const E = (await w.login('kysu1', pw('kysu1'))).session;
  if (!S || !E) {
    check('phiên thử đăng nhập được', false, `S=${!!S} E=${!!E}`);
    return rep.result();
  }
  const since = (await auditRows(fp, 'action=tag.write')).reduce((m, r) => Math.max(m, r.id), 0);

  // operator, phiên web (cookie + CSRF): cả lô bị từ chối, kể cả yêu cầu ghi Tag không có writeMinRole.
  const ridA = uuid();
  const ridB = uuid();
  const r1 = await w.request('POST', '/api/v1/tags/write', {
    s: S,
    body: JSON.stringify({
      requests: [
        { requestId: ridA, tag: 'SIM.SP_FLOW', value: 12.5 },
        { requestId: ridB, tag: 'SIM.MODE', value: 2 },
      ],
    }),
  });
  check(
    'operator (web) ghi lô có Tag writeMinRole engineer: 403 FORBIDDEN',
    r1.status === 403 && r1.json?.error === 'FORBIDDEN',
    `${r1.status} ${JSON.stringify(r1.json)}`,
  );
  const res = r1.json?.results ?? [];
  check(
    'mọi yêu cầu của lô REJECTED FORBIDDEN, thông điệp nêu role cần',
    res.length === 2 &&
      res.every((x) => x.status === 'REJECTED' && x.reason === 'FORBIDDEN') &&
      /engineer/.test(res[1]?.message ?? ''),
    JSON.stringify(res),
  );

  // operator, Bearer (công cụ khác Studio): cũng 403.
  const r2 = await api(fp, 'vh1', 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: uuid(), tag: 'SIM.MODE', value: 1 }],
  });
  check('operator (Bearer) ghi SIM.MODE: 403', r2.status === 403, `${r2.status}`);

  // engineer: ghi được.
  const r3 = await w.writeAndWait(E, { tag: 'SIM.MODE', value: 2 });
  check(
    'engineer (web) ghi SIM.MODE: ACCEPTED rồi CONFIRMED',
    r3.post.status === 200 && r3.first?.status === 'ACCEPTED' && r3.final?.status === 'CONFIRMED',
    `${r3.post.status} ${r3.first?.status} ${r3.final?.status} ${r3.final?.code ?? ''}`,
  );
  // operator vẫn ghi được Tag không có writeMinRole.
  const r4 = await w.writeAndWait(S, { tag: 'SIM.SP_FLOW', value: 13.5 });
  check(
    'operator ghi Tag không có writeMinRole: CONFIRMED',
    r4.final?.status === 'CONFIRMED',
    `${r4.post.status} ${r4.final?.status} ${r4.final?.code ?? ''}`,
  );

  const rows = (await auditRows(fp, 'action=tag.write')).filter((r) => r.id > since);
  const denied = rows.filter((r) => r.result === 'denied' && r.code === 'FORBIDDEN');
  // refusals of the same kind within a minute are one row with a count (005)
  const deniedCount = denied.reduce((n, r) => n + (r.count ?? 1), 0);
  check(
    'audit tag.write denied FORBIDDEN cho từng yêu cầu bị từ chối (≥ 3, kể cả dòng gộp có count), tài khoản vh1',
    deniedCount >= 3 && denied.every((r) => r.user === 'vh1'),
    `${denied.length} dòng, count ${deniedCount}: ${denied.map((r) => `${r.target}/${r.channel}`).join(', ')}`,
  );
  check(
    'không có bản ghi started nào của vh1 cho SIM.MODE (không lệnh nào chạy)',
    !rows.some((r) => r.user === 'vh1' && r.target === 'SIM.MODE' && r.result === 'started'),
    '',
  );
  measures.denied = deniedCount;
  measures.channels = [...new Set(denied.map((r) => r.channel))];
  measures.detailSample = denied[0] ? detailOf(denied[0]) : null;
  return rep.result();
}
