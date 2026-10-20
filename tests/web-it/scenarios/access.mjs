// Kịch bản của feature 013 (specs/013-access-control, contracts/admin-api.md §1 đến §6) trên runtime x64 thật,
// project dashboard-demo, viewerLogin required (tools/web-it.ps1 đặt --viewer-login required rồi khởi động lại):
//   login-required (T013): mọi đường dữ liệu không phiên → 401 (hoặc 302 cho trang), 0 byte giá trị Tag.
//   access (T023):         quy tắc đặt qua API quản trị; người bị cấm không nhận Tag bị cấm qua live, màn hình 403,
//                          menu và danh mục Tag lọc, component ẩn, ghi không có operate bị từ chối; quyền đổi →
//                          access-changed trong 2 s.
//   admin-attack (T029):   vai trò thấp gọi API quản trị, CSRF, Origin, leo thang qua sửa chính mình, xóa admin cuối,
//                          ghi bằng curl không quyền; mọi ca bị từ chối và có dòng audit.
// Mỗi kịch bản dọn lại quy tắc, nhóm và nhóm của tài khoản mà nó đặt, để các kịch bản cũ chạy như trước.
import {
  HTTP_BASE,
  Web,
  auditRows,
  api,
  detailOf,
  makeReport,
  plainHttp,
  simMark,
  simWrites,
  sleep,
  wsUpgrade,
} from '../lib/api.mjs';
import { liveConnect } from '../lib/ws.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];
const codeOf = (r) =>
  r.json?.error ?? r.json?.results?.[0]?.reason ?? r.json?.results?.[0]?.code ?? r.json?.code;
// Giá trị mà Tag chỉ dùng ở màn hình hoặc component bị cấm không được có trong phản hồi
const FORBIDDEN_TAGS = ['TANK01.SP_HI', 'SIM.FAN_ON'];
const ALL_SCREENS = ['tong-quan', 'bon-nuoc', 'giam-sat', 'bom1', 'bom', 'bom-chi-tiet'];

async function adminSession(w) {
  const r = await w.login('admin', pw('admin'));
  if (!r.session) throw new Error(`admin login ${r.status}`);
  return r.session;
}

const post = (w, s, path, body, opts = {}) =>
  w.request('POST', path, { s, body: JSON.stringify(body), ...opts });
const get = (w, s, path, opts = {}) =>
  w.request('GET', path, { s, h: { 'Sec-Fetch-Site': 'same-origin' }, ...opts });

/** Đặt nhóm, nhóm của vh2 và quy tắc của kịch bản access; trả hàm dọn lại. */
async function setupRules(w, A) {
  let rev = (await get(w, A, '/api/v1/admin/groups')).json?.rev ?? 0;
  for (const [id, name] of [
    ['quan-doc', 'Quản đốc'],
    ['bao-tri', 'Bảo trì'],
  ]) {
    const r = await post(w, A, '/api/v1/admin/groups', { rev, id, name });
    if (r.status === 201) rev = r.json.rev;
    else if (r.json?.error === 'EXISTS') rev = (await get(w, A, '/api/v1/admin/groups')).json.rev;
    else throw new Error(`group ${id}: ${r.status} ${r.body}`);
  }
  const urev = (await get(w, A, '/api/v1/admin/users')).json.rev;
  const g = await post(w, A, '/api/v1/admin/users/vh2', { rev: urev, groups: ['quan-doc'] });
  if (g.status !== 200) throw new Error(`vh2 groups: ${g.status} ${g.body}`);
  const set = await post(w, A, '/api/v1/admin/access', {
    rev,
    set: [
      { resource: 'screen:bon-nuoc', level: 'view', grantees: ['group:bao-tri'] },
      { resource: 'item:tong-quan/sw_fan', level: 'view', grantees: ['group:quan-doc'] },
      { resource: 'item:tong-quan/slider_flow', level: 'operate', grantees: ['group:quan-doc'] },
    ],
  });
  if (set.status !== 200) throw new Error(`rules: ${set.status} ${set.body}`);
  return async () => {
    const A2 = await adminSession(w);
    const acc = (await get(w, A2, '/api/v1/admin/access')).json;
    const clear = (acc?.rules ?? []).map((r) => ({
      resource: r.resource,
      level: r.level,
      grantees: null,
    }));
    if (clear.length) await post(w, A2, '/api/v1/admin/access', { rev: acc.rev, set: clear });
    const u = (await get(w, A2, '/api/v1/admin/users')).json;
    for (const x of u?.users ?? [])
      if (x.groups?.length) {
        const ur = (await get(w, A2, '/api/v1/admin/users')).json.rev;
        await post(w, A2, `/api/v1/admin/users/${x.name}`, { rev: ur, groups: [] });
      }
    for (const id of ['quan-doc', 'bao-tri']) {
      const gr = (await get(w, A2, '/api/v1/admin/groups')).json.rev;
      await post(w, A2, `/api/v1/admin/groups/${id}/delete`, { rev: gr, reauth: pw('admin') });
    }
  };
}

// ------------------------------------------------------------------------------------ login-required

export async function loginRequired(fp) {
  const rep = makeReport('login-required');
  const { check } = rep;
  const w = new Web(fp);
  const leaks = (r) =>
    FORBIDDEN_TAGS.concat(['TANK01.LEVEL', 'PUMP01.RUN_CMD']).some((t) =>
      (r.body ?? '').includes(t),
    );
  // Trang: 302 /login
  for (const p of ['/', '/index.html']) {
    const r = await w.request('GET', p);
    check(
      `${p} không phiên: 302 /login`,
      r.status === 302 && /\/login/.test(r.headers.location ?? ''),
      `${r.status} ${r.headers.location}`,
    );
  }
  // Dữ liệu: 401, không byte nào của cấu hình hay giá trị
  const paths = [
    '/api/v1/projects/active',
    '/api/v1/web/access',
    '/api/v1/web/session',
    '/api/v1/alarms',
    '/api/v1/alarms/history',
    '/api/v1/history/catalog',
    '/api/v1/logic',
    '/api/v1/admin/users',
    '/api/v1/admin/access',
    '/project/screens/tong-quan.svg',
    '/project/screens/tong-quan.bindings.json',
    ...ALL_SCREENS.map((s) => `/project/screens/${s}.screen.json`),
  ];
  for (const p of paths) {
    const r = await w.request('GET', p);
    check(
      `${p} không phiên: 401, không có dữ liệu`,
      r.status === 401 && !leaks(r),
      `${r.status} ${(r.body ?? '').slice(0, 80)}`,
    );
  }
  // cookie bịa và cookie hết phiên cũng như không phiên
  const fake = { cookie: `matw_${'q'.repeat(43)}` };
  const fr = await w.request('GET', '/api/v1/projects/active', { s: fake });
  check('cookie bịa: 401', fr.status === 401 && !leaks(fr), fr.status);
  const S = (await w.login('xem1', pw('xem1'))).session;
  await w.request('POST', '/api/v1/web/logout', { s: S });
  const after = await w.request('GET', '/project/screens/tong-quan.screen.json', { s: S });
  check('cookie sau đăng xuất: 401', after.status === 401 && !leaks(after), after.status);
  // ghi không phiên
  const wr = await w.request('POST', '/api/v1/tags/write', {
    body: JSON.stringify({
      requests: [{ requestId: crypto.randomUUID(), tag: 'PUMP01.RUN_CMD', value: true }],
    }),
  });
  check('ghi Tag không phiên: 401', wr.status === 401, wr.status);
  // WebSocket live không phiên: 401 trước khi nâng cấp (0 tin)
  const ws = await wsUpgrade(fp, { origin: 'https://rt:8443' });
  check('live không phiên: 401', ws.status === 401, `${ws.status} ${ws.error ?? ''}`);
  // system/info khách: chỉ đủ để dựng liên kết HTTPS
  const info = await w.request('GET', '/api/v1/system/info');
  check(
    'system/info khách: không Tag, không project',
    info.status === 200 && !leaks(info) && !('project' in (info.json ?? {})),
    Object.keys(info.json ?? {}).join(','),
  );
  // HTTP: trang hướng dẫn, dữ liệu không
  const h = await plainHttp('GET', '/api/v1/projects/active');
  check(
    'HTTP projects/active: 401/403, không dữ liệu',
    [401, 403].includes(h.status) && !h.body.includes('"tags"'),
    h.status,
  );
  // có phiên: được
  const V = (await w.login('xem1', pw('xem1'))).session;
  const ok = await w.request('GET', '/api/v1/web/access', { s: V });
  check(
    'có phiên: web/access 200 với screens',
    ok.status === 200 && Array.isArray(ok.json?.screens),
    ok.status,
  );
  const sess = await w.request('GET', '/api/v1/web/session', { s: V });
  check(
    'web/session có groups và viewerLogin required',
    sess.status === 200 &&
      Array.isArray(sess.json?.groups) &&
      sess.json?.viewerLogin === 'required',
    JSON.stringify(sess.json?.viewerLogin),
  );
  void HTTP_BASE;
  return rep.result();
}

// ------------------------------------------------------------------------------------------- access

export async function access(fp) {
  const rep = makeReport('access');
  const { check } = rep;
  const w = new Web(fp);
  const A = await adminSession(w);
  const cleanup = await setupRules(w, A);
  try {
    const S = (await w.login('vh1', pw('vh1'))).session; // operator, không nhóm
    const Q = (await w.login('vh2', pw('vh2'))).session; // operator, nhóm quản đốc
    // EffectiveAccess
    const ea = (await get(w, S, '/api/v1/web/access')).json;
    check(
      'vh1: web/access không có bon-nuoc',
      ea && !ea.screens.includes('bon-nuoc') && ea.screens.includes('tong-quan'),
      JSON.stringify(ea?.screens),
    );
    check(
      'vh1: sw_fan ẩn, slider_flow khóa (quy tắc), sp_level khóa (minRole engineer)',
      ea?.hiddenItems?.['tong-quan']?.includes('sw_fan') &&
        ea?.lockedItems?.['tong-quan']?.includes('slider_flow') &&
        ea?.lockedItems?.['tong-quan']?.includes('sp_level'),
      JSON.stringify({ h: ea?.hiddenItems, l: ea?.lockedItems }),
    );
    const eq = (await get(w, Q, '/api/v1/web/access')).json;
    check(
      'vh2 (quản đốc): thấy sw_fan, thao tác slider_flow',
      !eq?.hiddenItems?.['tong-quan'] && !eq?.lockedItems?.['tong-quan']?.includes('slider_flow'),
      JSON.stringify(eq),
    );
    // Màn hình bị cấm: 403 và audit
    const scr = await get(w, S, '/project/screens/bon-nuoc.screen.json');
    check(
      'vh1: bon-nuoc.screen.json 403 ACCESS_DENIED',
      scr.status === 403 && codeOf(scr) === 'ACCESS_DENIED' && !scr.body.includes('TANK01.SP_HI'),
      scr.status,
    );
    // Màn hình được xem: không có item ẩn
    const tq = await get(w, S, '/project/screens/tong-quan.screen.json');
    check(
      'vh1: tong-quan.screen.json không có sw_fan, không SIM.FAN_ON',
      tq.status === 200 && !tq.body.includes('"sw_fan"') && !tq.body.includes('SIM.FAN_ON'),
      tq.status,
    );
    const tq2 = await get(w, Q, '/project/screens/tong-quan.screen.json');
    check(
      'vh2: tong-quan.screen.json có sw_fan',
      tq2.status === 200 && tq2.body.includes('"sw_fan"'),
      tq2.status,
    );
    // projects/active: menu và danh mục Tag
    const act = (await get(w, S, '/api/v1/projects/active')).json;
    const menu = JSON.stringify(act?.project?.navigation ?? {});
    check(
      'vh1: projects/active không có bon-nuoc trong danh sách và menu',
      !act?.screens?.some((s) => s.id === 'bon-nuoc') && !menu.includes('bon-nuoc'),
      menu,
    );
    const tagIds = (act?.tags?.tags ?? []).map((t) => t.id);
    check(
      'vh1: danh mục Tag không có Tag chỉ dùng ở chỗ bị cấm',
      !FORBIDDEN_TAGS.some((t) => tagIds.includes(t)) && tagIds.includes('TANK01.LEVEL'),
      FORBIDDEN_TAGS.filter((t) => tagIds.includes(t)).join(','),
    );
    // Live: Tag bị cấm vào denied, không có giá trị
    const live = await liveConnect(fp, { cookie: S.cookie });
    check('vh1: live được nâng cấp', live.status === 101, live.status);
    await live.waitFor((m) => m.find((x) => x.type === 'hello'), 3000);
    live.send({
      type: 'subscribe',
      requestId: 's1',
      tags: ['TANK01.LEVEL', 'TANK01.SP_HI', 'SIM.FAN_ON', 'TANK01.SP'],
    });
    const snap = await live.waitFor((m) => m.find((x) => x.type === 'snapshot'), 5000);
    check(
      'vh1: snapshot có denied = hai Tag bị cấm',
      snap &&
        JSON.stringify(snap.denied?.sort()) === JSON.stringify(['SIM.FAN_ON', 'TANK01.SP_HI']),
      JSON.stringify(snap?.denied),
    );
    check(
      'vh1: snapshot có TANK01.LEVEL, TANK01.SP',
      snap?.tags?.some((t) => t.id === 'TANK01.LEVEL') &&
        snap?.tags?.some((t) => t.id === 'TANK01.SP'),
      JSON.stringify(snap?.tags?.map((t) => t.id)),
    );
    const liveQ = await liveConnect(fp, { cookie: Q.cookie });
    await liveQ.waitFor((m) => m.find((x) => x.type === 'hello'), 3000);
    liveQ.send({ type: 'subscribe', requestId: 'q1', tags: ['SIM.FAN_ON'] });
    const snapQ = await liveQ.waitFor((m) => m.find((x) => x.type === 'snapshot'), 5000);
    check(
      'vh2: nhận SIM.FAN_ON',
      snapQ?.tags?.some((t) => t.id === 'SIM.FAN_ON') && !snapQ?.denied,
      JSON.stringify(snapQ),
    );
    // Ghi bằng curl không quyền: slider_flow chỉ cho quản đốc, sp_level chỉ từ engineer (mặc định project)
    const mark = await simMark();
    const deny = await w.write(S, {
      tag: 'SIM.SP_FLOW',
      value: 40,
      context: { screen: 'tong-quan', widget: 'slider_flow' },
    });
    check(
      'vh1: ghi qua slider_flow (không operate): REJECTED ACCESS_DENIED',
      codeOf(deny) === 'ACCESS_DENIED',
      JSON.stringify(deny.json),
    );
    const deny2 = await w.write(S, {
      tag: 'TANK01.SP',
      value: 40,
      context: { screen: 'tong-quan', widget: 'sp_level' },
    });
    check(
      'vh1: ghi qua sp_level (minRole engineer của project): ACCESS_DENIED',
      codeOf(deny2) === 'ACCESS_DENIED',
      JSON.stringify(deny2.json),
    );
    const noCtx = await w.write(S, { tag: 'TANK01.SP', value: 40 });
    check(
      'vh1: ghi không context: ACCESS_DENIED',
      codeOf(noCtx) === 'ACCESS_DENIED',
      JSON.stringify(noCtx.json),
    );
    const hidden = await w.write(S, {
      tag: 'TANK01.SP_HI',
      value: 70,
      context: { screen: 'bon-nuoc', widget: 'sp_high' },
    });
    check(
      'vh1: ghi qua màn hình bị cấm: ACCESS_DENIED',
      codeOf(hidden) === 'ACCESS_DENIED',
      JSON.stringify(hidden.json),
    );
    const otherTag = await w.write(S, {
      tag: 'SIM.MODE',
      value: 1,
      context: { screen: 'tong-quan', widget: 'sw_pump' },
    });
    check(
      'vh1: Tag không thuộc binding của component: ACCESS_DENIED',
      codeOf(otherTag) === 'ACCESS_DENIED',
      JSON.stringify(otherTag.json),
    );
    await sleep(300);
    check(
      'ghi bị từ chối: 0 lệnh tới giả lập',
      (await simWrites(mark)).length === 0,
      (await simWrites(mark)).length,
    );
    const allowed = await w.writeAndWait(Q, {
      tag: 'SIM.SP_FLOW',
      value: 41,
      context: { screen: 'tong-quan', widget: 'slider_flow' },
    });
    check(
      'vh2 (quản đốc) ghi qua slider_flow: CONFIRMED',
      allowed.final?.status === 'CONFIRMED',
      JSON.stringify(allowed.final),
    );
    const sw = await w.writeAndWait(S, {
      tag: 'PUMP01.RUN_CMD',
      value: false,
      context: { screen: 'tong-quan', widget: 'sw_pump' },
    });
    check(
      'vh1 ghi qua sw_pump (mặc định operator): CONFIRMED',
      sw.final?.status === 'CONFIRMED',
      JSON.stringify(sw.final),
    );
    // Quyền đổi: access-changed trong 2 s, Tag mất không còn giá trị
    const acc = (await get(w, A, '/api/v1/admin/access')).json;
    const t0 = Date.now();
    const ch = await post(w, A, '/api/v1/admin/access', {
      rev: acc.rev,
      set: [{ resource: 'item:tong-quan/sw_fan', level: 'view', grantees: [] }],
    });
    check('đổi quy tắc: 200', ch.status === 200, ch.status);
    const changed = await liveQ.waitFor((m) => m.find((x) => x.type === 'access-changed'), 4000);
    const ms = Date.now() - t0;
    rep.measures.accessChangedMs = ms;
    check('vh2: access-changed trong 2 s', changed && ms <= 2000, `${ms} ms`);
    const n0 = liveQ.raw.length;
    await sleep(1500);
    const later = liveQ.raw.slice(n0).filter((t) => t.includes('"delta"'));
    check(
      'vh2: sau access-changed không còn delta của SIM.FAN_ON (vị trí 0)',
      later.every((t) => !/\[\[0,/.test(t) && !/\],\[0,/.test(t)),
      later.length,
    );
    check(
      'vh1 không nhận access-changed (quyền của vh1 không đổi)',
      !live.messages.some((x) => x.type === 'access-changed'),
      live.messages.length,
    );
    // Audit: access.denied và tag.write denied ACCESS_DENIED
    await sleep(300);
    const denied = await auditRows(fp, 'action=access.denied');
    check(
      'audit access.denied của /project/screens/bon-nuoc.screen.json',
      denied.some((r) => (r.target ?? '').includes('bon-nuoc') && r.user === 'vh1'),
      denied.length,
    );
    const wd = (await auditRows(fp, 'action=tag.write')).filter(
      (r) => r.result === 'denied' && (r.code ?? detailOf(r).code) === 'ACCESS_DENIED',
    );
    check(
      'audit tag.write denied ACCESS_DENIED của vh1',
      wd.some((r) => r.user === 'vh1'),
      wd.length,
    );
    const rules = await auditRows(fp, 'action=access.rule');
    check(
      'audit access.rule có before/after',
      rules.some((r) => 'before' in detailOf(r) && 'after' in detailOf(r)),
      rules.length,
    );
    // 0 giá trị của Tag bị cấm trên live của vh1 suốt kịch bản
    check(
      'vh1: 0 giá trị Tag bị cấm trên live',
      !live.raw.some((t) => /"(TANK01\.SP_HI|SIM\.FAN_ON)",/.test(t) && !t.includes('"denied"')),
      live.raw.length,
    );
    live.close();
    liveQ.close();
  } finally {
    await cleanup();
  }
  return rep.result();
}

// -------------------------------------------------------------------------------------- access-data

/**
 * access-data (T023, project tests/web-it/out/access-data của make-access-data.mjs): lịch sử, alarm và số đếm alarm
 * lọc theo quyền qua runtime thật. Quy tắc: bon-nuoc và nhóm lưu trữ `song` chỉ cho nhóm bảo trì; vh1 (operator,
 * không nhóm) chỉ thấy DEMO.WAVE (tong-quan) nên chỉ alarm WAVE_HIGH; admin thấy cả SPHI_HIGH.
 */
export async function accessData(fp) {
  const rep = makeReport('access-data');
  const { check } = rep;
  const w = new Web(fp);
  const A = await adminSession(w);
  let rev = (await get(w, A, '/api/v1/admin/groups')).json?.rev ?? 0;
  const g = await post(w, A, '/api/v1/admin/groups', { rev, id: 'bao-tri', name: 'Bảo trì' });
  if (g.status === 201) rev = g.json.rev;
  else rev = (await get(w, A, '/api/v1/admin/groups')).json.rev;
  const set = await post(w, A, '/api/v1/admin/access', {
    rev,
    set: [
      { resource: 'screen:bon-nuoc', level: 'view', grantees: ['group:bao-tri'] },
      { resource: 'history:song', level: 'view', grantees: ['group:bao-tri'] },
    ],
  });
  check('đặt quy tắc bon-nuoc, history:song cho nhóm bảo trì: 200', set.status === 200, set.body);
  const secret = (body) => (body ?? '').includes('SPHI') || (body ?? '').includes('TANK01.SP_HI');
  try {
    const S = (await w.login('vh1', pw('vh1'))).session;
    // Hai alarm đã bật (admin thấy cả hai)
    let adminList = null;
    for (let i = 0; i < 40; i++) {
      adminList = (await get(w, A, '/api/v1/alarms')).json;
      if ((adminList?.instances ?? []).length >= 2) break;
      await sleep(500);
    }
    check(
      'admin: GET alarms có WAVE_HIGH và SPHI_HIGH, counts.active 2',
      adminList?.instances?.length === 2 && adminList?.counts?.active === 2,
      JSON.stringify({ ids: adminList?.instances?.map((x) => x.id), counts: adminList?.counts }),
    );
    const mine = await get(w, S, '/api/v1/alarms');
    check(
      'vh1: GET alarms chỉ WAVE_HIGH, counts.active 1 unack 1, không chữ nào của SPHI',
      mine.status === 200 &&
        mine.json?.instances?.length === 1 &&
        mine.json.instances[0].alarmId === 'WAVE_HIGH' &&
        mine.json?.counts?.active === 1 &&
        mine.json?.counts?.unack === 1 &&
        mine.json?.counts?.byPriority?.major?.active === 0 &&
        !secret(mine.body),
      JSON.stringify({ s: mine.status, counts: mine.json?.counts }),
    );
    const infoV = (await get(w, S, '/api/v1/system/info')).json?.alarms;
    const infoA = (await get(w, A, '/api/v1/system/info')).json?.alarms;
    check(
      'system/info: vh1 instances 1, active 1; admin instances 2, active 2',
      infoV?.instances === 1 &&
        infoV?.active === 1 &&
        infoA?.instances === 2 &&
        infoA?.active === 2,
      JSON.stringify({ infoV, infoA }),
    );
    // Live: alarmSnapshot của vh1
    const live = await liveConnect(fp, { cookie: S.cookie });
    await live.waitFor((m) => m.find((x) => x.type === 'hello'), 3000);
    live.send({ type: 'subscribeAlarms', requestId: 'a1' });
    const snap = await live.waitFor((m) => m.find((x) => x.type === 'alarmSnapshot'), 5000);
    check(
      'vh1: alarmSnapshot chỉ WAVE_HIGH, counts.active 1',
      snap?.instances?.length === 1 &&
        snap.instances[0].alarmId === 'WAVE_HIGH' &&
        snap?.counts?.active === 1,
      JSON.stringify({ n: snap?.instances?.length, counts: snap?.counts }),
    );
    // Lệnh: alarm bị cấm 403; xác nhận tất cả chỉ đụng alarm được xem, counts của câu trả lời là của vh1
    const sphi = adminList?.instances?.find((x) => x.alarmId === 'SPHI_HIGH');
    const denied = await post(w, S, '/api/v1/alarms/ack', {
      items: [{ id: sphi?.id ?? 'SPHI_HIGH.H', occurrence: sphi?.occurrence ?? 1 }],
    });
    check(
      'vh1: ack SPHI_HIGH 403 ACCESS_DENIED',
      denied.status === 403 && codeOf(denied) === 'ACCESS_DENIED',
      `${denied.status} ${codeOf(denied)}`,
    );
    const ackAll = await post(w, S, '/api/v1/alarms/ack', {
      all: true,
      upToRevision: (mine.json?.revision ?? 0) + 1000000,
    });
    check(
      'vh1: ack all xác nhận 1 alarm, counts của câu trả lời: active 1, unack 0',
      ackAll.status === 200 &&
        ackAll.json?.acked === 1 &&
        ackAll.json?.counts?.active === 1 &&
        ackAll.json?.counts?.unack === 0 &&
        !secret(ackAll.body),
      JSON.stringify({ s: ackAll.status, acked: ackAll.json?.acked, counts: ackAll.json?.counts }),
    );
    const delta = await live.waitFor(
      (m) => m.find((x) => x.type === 'alarmDelta' && x.changed?.length),
      5000,
    );
    check(
      'vh1: alarmDelta sau ack có counts của vh1 (active 1, unack 0)',
      delta?.counts?.active === 1 && delta?.counts?.unack === 0,
      JSON.stringify(delta?.counts),
    );
    const adminAfter = (await get(w, A, '/api/v1/alarms')).json?.counts;
    check(
      'admin: SPHI_HIGH vẫn chờ xác nhận (unack 1)',
      adminAfter?.unack === 1,
      JSON.stringify(adminAfter),
    );
    // Lịch sử alarm
    let ah = null;
    for (let i = 0; i < 20; i++) {
      ah = (await get(w, A, '/api/v1/alarms/history')).json;
      if ((ah?.items ?? []).some((x) => x.alarmId?.startsWith('SPHI_HIGH'))) break;
      await sleep(500);
    }
    const vh = await get(w, S, '/api/v1/alarms/history');
    check(
      'alarms/history: admin có SPHI_HIGH, vh1 chỉ WAVE_HIGH',
      (ah?.items ?? []).some((x) => x.alarmId?.startsWith('SPHI_HIGH')) &&
        vh.status === 200 &&
        (vh.json?.items ?? []).length > 0 &&
        vh.json.items.every((x) => x.alarmId?.startsWith('WAVE_HIGH')) &&
        !secret(vh.body),
      JSON.stringify({ a: ah?.items?.length, v: vh.json?.items?.map((x) => x.alarmId) }),
    );
    // Lịch sử Tag
    const cat = (await get(w, S, '/api/v1/history/catalog')).json;
    const song = cat?.groups?.find((x) => x.id === 'song');
    check(
      'vh1: history/catalog nhóm song chỉ có DEMO.WAVE',
      song && song.tags.map((t) => t.tagId ?? t.id).join() === 'DEMO.WAVE',
      JSON.stringify(song?.tags),
    );
    const to = Date.now() + 60000;
    const from = to - 3600000;
    const q = (tags) => `/api/v1/history/series?group=song&tags=${tags}&from=${from}&to=${to}`;
    let adminSeries = null;
    for (let i = 0; i < 30; i++) {
      adminSeries = await get(w, A, q('TANK01.SP_HI'));
      if (adminSeries.status === 200 && /85/.test(adminSeries.body)) break;
      await sleep(1000);
    }
    check(
      'admin: series TANK01.SP_HI có giá trị',
      adminSeries?.status === 200 && /85/.test(adminSeries.body),
      `${adminSeries?.status} ${(adminSeries?.body ?? '').slice(0, 120)}`,
    );
    const onlySecret = await get(w, S, q('TANK01.SP_HI'));
    check(
      'vh1: series chỉ TANK01.SP_HI: 403 ACCESS_DENIED',
      onlySecret.status === 403 && codeOf(onlySecret) === 'ACCESS_DENIED',
      `${onlySecret.status} ${codeOf(onlySecret)}`,
    );
    const both = await get(w, S, q('DEMO.WAVE,TANK01.SP_HI'));
    check(
      'vh1: series DEMO.WAVE,TANK01.SP_HI: không có TANK01.SP_HI',
      both.status === 200 && both.body.includes('DEMO.WAVE') && !secret(both.body),
      `${both.status} ${(both.body ?? '').slice(0, 120)}`,
    );
    // Quyền đổi: vh1 được xem bon-nuoc → access-changed, alarmSnapshot mới có SPHI_HIGH, counts.active 2
    const acc = (await get(w, A, '/api/v1/admin/access')).json;
    const n0 = live.messages.length;
    const t0 = Date.now();
    const ch = await post(w, A, '/api/v1/admin/access', {
      rev: acc.rev,
      set: [
        { resource: 'screen:bon-nuoc', level: 'view', grantees: ['group:bao-tri', 'user:vh1'] },
      ],
    });
    check('cho vh1 xem bon-nuoc: 200', ch.status === 200, ch.status);
    const again = await live.waitFor(
      (m) => m.slice(n0).find((x) => x.type === 'alarmSnapshot'),
      4000,
    );
    rep.measures.alarmResnapshotMs = Date.now() - t0;
    check(
      'vh1: sau access-changed có alarmSnapshot mới, 2 alarm, counts.active 2 (≤ 2 s)',
      live.messages.slice(n0).some((x) => x.type === 'access-changed') &&
        again?.instances?.length === 2 &&
        again?.counts?.active === 2 &&
        rep.measures.alarmResnapshotMs <= 2000,
      `${rep.measures.alarmResnapshotMs} ms ${JSON.stringify(again?.counts)}`,
    );
    live.close();
  } finally {
    const acc = (await get(w, A, '/api/v1/admin/access')).json;
    const clear = (acc?.rules ?? []).map((r) => ({
      resource: r.resource,
      level: r.level,
      grantees: null,
    }));
    if (clear.length) await post(w, A, '/api/v1/admin/access', { rev: acc.rev, set: clear });
    const gr = (await get(w, A, '/api/v1/admin/groups')).json?.rev;
    await post(w, A, '/api/v1/admin/groups/bao-tri/delete', { rev: gr, reauth: pw('admin') });
  }
  return rep.result();
}

// ------------------------------------------------------------------------------------- admin-attack

export async function adminAttack(fp) {
  const rep = makeReport('admin-attack');
  const { check } = rep;
  const w = new Web(fp);
  const A = await adminSession(w);
  const S = (await w.login('vh1', pw('vh1'))).session;
  const V = (await w.login('xem1', pw('xem1'))).session;
  const E = (await w.login('kysu1', pw('kysu1'))).session;
  const urev = (await get(w, A, '/api/v1/admin/users')).json?.rev;
  const cases = [];
  const run = async (id, name, fn, want) => {
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { status: -1, json: null, body: e.message };
    }
    const ok =
      (Array.isArray(want.status) ? want.status.includes(r.status) : r.status === want.status) &&
      (want.code === undefined || codeOf(r) === want.code);
    cases.push({ id, status: r.status, code: codeOf(r) });
    check(`${id}: ${name}`, ok, `HTTP ${r.status} ${codeOf(r) ?? ''}`);
    return r;
  };
  // Vai trò thấp gọi API quản trị
  for (const [who, s] of [
    ['viewer', V],
    ['operator', S],
    ['engineer', E],
  ]) {
    await run(
      `B1-${who}`,
      `${who} đọc danh sách tài khoản`,
      () => get(w, s, '/api/v1/admin/users'),
      { status: 403, code: 'FORBIDDEN' },
    );
    await run(
      `B2-${who}`,
      `${who} tạo tài khoản`,
      () =>
        post(w, s, '/api/v1/admin/users', {
          rev: urev,
          name: 'ke-gian',
          role: 'administrator',
          generate: true,
        }),
      { status: 403, code: 'FORBIDDEN' },
    );
  }
  await run(
    'B3',
    'operator đặt quy tắc',
    () => post(w, S, '/api/v1/admin/access', { rev: 0, set: [] }),
    { status: 403, code: 'FORBIDDEN' },
  );
  // Leo thang qua sửa chính mình
  await run(
    'B4',
    'operator tự nâng mình lên administrator',
    () => post(w, S, '/api/v1/admin/users/vh1', { rev: urev, role: 'administrator' }),
    { status: 403, code: 'FORBIDDEN' },
  );
  await run(
    'B5',
    'operator xem với tư cách admin',
    () => get(w, S, '/api/v1/admin/effective?user=admin'),
    { status: 403, code: 'FORBIDDEN' },
  );
  // Bearer của operator và của admin
  const bOp = await api(fp, 'vh1', 'GET', '/api/v1/admin/users');
  check(
    'B6: Bearer operator: 403 FORBIDDEN',
    bOp.status === 403 && codeOf(bOp) === 'FORBIDDEN',
    bOp.status,
  );
  const bAd = await api(fp, 'admin', 'GET', '/api/v1/admin/users');
  check(
    'B7: Bearer admin đọc được (công cụ)',
    bAd.status === 200 && Array.isArray(bAd.json?.users),
    bAd.status,
  );
  // CSRF, Origin, loại nội dung với cookie admin
  await run(
    'B8',
    'admin, thiếu X-MAT-CSRF',
    () => post(w, A, '/api/v1/admin/groups', { rev: 0, id: 'g-csrf', name: 'x' }, { noCsrf: true }),
    { status: 403, code: 'CSRF_FAILED' },
  );
  await run(
    'B9',
    'admin, Origin lạ',
    () =>
      post(
        w,
        A,
        '/api/v1/admin/groups',
        { rev: 0, id: 'g-origin', name: 'x' },
        { h: { Origin: 'https://evil.example' } },
      ),
    { status: 403, code: 'ORIGIN_MISMATCH' },
  );
  await run(
    'B10',
    'admin, thân text/plain',
    () =>
      w.request('POST', '/api/v1/admin/groups', {
        s: A,
        h: { 'Content-Type': 'text/plain' },
        raw: '{"rev":0,"id":"g-plain","name":"x"}',
      }),
    { status: 415 },
  );
  await run(
    'B11',
    'thân > 64 KiB',
    () =>
      post(w, A, '/api/v1/admin/groups', {
        rev: 0,
        id: 'g-big',
        name: 'x',
        pad: 'x'.repeat(70000),
      }),
    { status: 413 },
  );
  await run(
    'B12',
    'JSON sai',
    () =>
      w.request('POST', '/api/v1/admin/groups', {
        s: A,
        h: { 'Content-Type': 'application/json' },
        raw: '{"rev":',
      }),
    { status: 400 },
  );
  const h = await plainHttp('GET', '/api/v1/admin/users', { Cookie: `__Host-mat_sid=${A.cookie}` });
  check(
    'B13: API quản trị qua HTTP: 403 HTTPS_REQUIRED',
    h.status === 403 && h.json?.error === 'HTTPS_REQUIRED',
    h.status,
  );
  // Xóa admin cuối, tắt admin cuối, hạ vai trò admin cuối
  await run(
    'B14',
    'xóa administrator cuối',
    () => post(w, A, '/api/v1/admin/users/admin/delete', { rev: urev, reauth: pw('admin') }),
    { status: 409, code: 'LAST_ADMIN' },
  );
  await run(
    'B15',
    'tắt administrator cuối',
    () =>
      post(w, A, '/api/v1/admin/users/admin', { rev: urev, enabled: false, reauth: pw('admin') }),
    { status: 409, code: 'LAST_ADMIN' },
  );
  await run(
    'B16',
    'hạ vai trò không nhập lại mật khẩu',
    () => post(w, A, '/api/v1/admin/users/vh1', { rev: urev, role: 'viewer' }),
    { status: 403, code: 'REAUTH_REQUIRED' },
  );
  await run(
    'B17',
    'xác nhận lại sai mật khẩu',
    () =>
      post(w, A, '/api/v1/admin/users/vh1/password', {
        rev: urev,
        generate: true,
        reauth: 'sai-mat-khau-xxxxxxxxx',
      }),
    { status: 403, code: 'REAUTH_REQUIRED' },
  );
  await run(
    'B18',
    'rev cũ',
    () => post(w, A, '/api/v1/admin/users/vh1', { rev: urev - 1, unlock: true }),
    { status: 409, code: 'CONFLICT' },
  );
  await run(
    'B19',
    'quy tắc page:admin',
    () =>
      post(w, A, '/api/v1/admin/access', {
        rev: 0,
        set: [{ resource: 'page:admin', level: 'view', grantees: ['*'] }],
      }),
    { status: 400 },
  );
  // Ghi bằng curl của viewer, và của operator vào component chỉ engineer thao tác
  const mark = await simMark();
  await run(
    'B20',
    'viewer ghi qua component',
    () =>
      w.write(V, {
        tag: 'PUMP01.RUN_CMD',
        value: true,
        context: { screen: 'tong-quan', widget: 'sw_pump' },
      }),
    { status: 403, code: 'FORBIDDEN' },
  );
  await run(
    'B21',
    'operator ghi qua btn_toggle (minRole engineer)',
    () =>
      w.write(S, {
        tag: 'R.RUN',
        value: true,
        context: { screen: 'tong-quan', widget: 'btn_toggle' },
      }),
    { status: 200, code: 'ACCESS_DENIED' },
  );
  await sleep(300);
  check(
    'B20/B21: 0 lệnh tới giả lập',
    (await simWrites(mark)).length === 0,
    (await simWrites(mark)).length,
  );
  // Giới hạn tần suất: 30 thay đổi mỗi phút mỗi phiên
  const A2 = await adminSession(w);
  let limited = 0;
  for (let i = 0; i < 34; i++) {
    const r = await post(w, A2, '/api/v1/admin/groups', { rev: 99999, id: 'g-rate', name: 'x' });
    if (r.status === 429) limited++;
  }
  check('B22: quá 30 thay đổi/phút: 429 RATE_LIMITED', limited >= 3, limited);
  // Audit: mọi ca bị từ chối có dòng
  await sleep(500);
  const denied = await auditRows(fp, 'action=access.denied');
  const codes = new Set(denied.map((r) => r.code ?? detailOf(r).code));
  for (const c of ['FORBIDDEN', 'CSRF_FAILED', 'ORIGIN_MISMATCH'])
    check(`audit access.denied có ${c}`, codes.has(c), [...codes].join(','));
  const lastAdmin = (await auditRows(fp, 'action=account.')).filter((r) => r.result === 'denied');
  check(
    'audit: LAST_ADMIN và REAUTH_REQUIRED có dòng denied',
    lastAdmin.some((r) => r.code === 'LAST_ADMIN') &&
      lastAdmin.some((r) => r.code === 'REAUTH_REQUIRED'),
    lastAdmin.map((r) => r.code).join(','),
  );
  const wd = (await auditRows(fp, 'action=tag.write')).filter(
    (r) => r.result === 'denied' && r.code === 'ACCESS_DENIED',
  );
  check(
    'audit: tag.write denied ACCESS_DENIED (B21)',
    wd.some((r) => r.user === 'vh1'),
    wd.length,
  );
  const all = JSON.stringify(await auditRows(fp, 'action=a'));
  check('audit không chứa mật khẩu', !all.includes(pw('admin')) && !all.includes(pw('vh1')));
  rep.measures.caseTable = cases;
  return rep.result();
}
