// Kịch bản `gate` của web-it (feature 007, T073, US3-21; device-api-1.2 §7): cổng xem theo nguồn mạng và `viewerLogin`.
// Script chạy kịch bản hai lần: `--mode private` (viewerAccess private, viewerLogin off) và `--mode required`
// (viewerLogin required), khởi động lại runtime giữa hai lần (tools/web-it.ps1).
import { LAN_IP, PUB_IP, Web, makeReport, plainHttp, wsUpgrade } from '../lib/api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];

export async function gate(fp, mode) {
  const rep = makeReport(`gate-${mode}`);
  const { check } = rep;
  const w = new Web(fp);
  const PUB_BASE = `https://${PUB_IP.replace(/\.50$/, '.10')}:8443`;
  const pub = { base: PUB_BASE, localAddress: PUB_IP };
  const lan = { localAddress: LAN_IP };

  // Trang đăng nhập và tài nguyên của nó: không bị lọc nguồn, không bị viewerLogin chặn
  const login = await w.request('GET', '/login', pub);
  check('/login từ mạng công cộng: 200', login.status === 200, login.status);
  const assets = [...(login.body.match(/\/assets\/login-[A-Za-z0-9_-]+\.(?:js|css)/g) ?? [])];
  check(
    'trang /login tham chiếu bundle riêng assets/login-*',
    assets.length >= 1,
    assets.join(','),
  );
  for (const a of assets) {
    const r = await w.request('GET', a, pub);
    check(`${a} từ mạng công cộng: 200`, r.status === 200, r.status);
  }
  const crt = await w.request('GET', '/device.crt', pub);
  check(
    '/device.crt từ mạng công cộng: 200, chỉ chứng chỉ',
    crt.status === 200 && !/PRIVATE KEY/.test(crt.body),
    crt.status,
  );
  const bad = await w.login('xem1', 'sai-mat-khau-xxxxxxxx', pub);
  check(
    'web/login từ mạng công cộng không bị lọc nguồn (trả 401 AUTH_FAILED, không phải 403)',
    bad.status === 401,
    bad.status,
  );

  const pubRoot = await w.request('GET', '/', pub);
  const pubActive = await w.request('GET', '/api/v1/projects/active', pub);
  const pubScreen = await w.request('GET', '/project/screens/tong-quan.screen.json', pub);
  if (mode === 'private') {
    check('viewerAccess private, nguồn công cộng: "/" 403', pubRoot.status === 403, pubRoot.status);
    check('nguồn công cộng: projects/active 403', pubActive.status === 403, pubActive.status);
    check('nguồn công cộng: /project/* 403', pubScreen.status === 403, pubScreen.status);
    const lanRoot = await w.request('GET', '/', lan);
    check('nguồn mạng riêng: "/" 200', lanRoot.status === 200, lanRoot.status);
    // phiên hợp lệ không bị lọc nguồn
    const S = (await w.login('xem1', pw('xem1'), pub)).session;
    const withSession = await w.request('GET', '/api/v1/projects/active', {
      s: S,
      ...pub,
    });
    check(
      'phiên hợp lệ từ nguồn công cộng: projects/active 200 (không bị lọc nguồn)',
      withSession.status === 200,
      withSession.status,
    );
    const ws = await wsUpgrade(fp, {
      cookie: S?.cookie,
      origin: 'https://rt:8443',
      localAddress: PUB_IP,
    });
    check(
      'phiên hợp lệ từ nguồn công cộng: WebSocket live được nâng cấp (101, hoặc hết giờ vì giữ kết nối mở)',
      ws.status === 101 || ws.status === 0,
      `${ws.status} ${ws.error ?? ''}`,
    );
  } else {
    // viewerLogin required: khách bị chặn ở mọi dữ liệu, kể cả từ mạng riêng
    const root = await w.request('GET', '/', lan);
    check(
      'required: "/" HTTPS khách: 302 tới /login',
      root.status === 302 && /\/login/.test(root.headers.location ?? ''),
      `${root.status} ${root.headers.location}`,
    );
    const active = await w.request('GET', '/api/v1/projects/active', lan);
    check(
      'required: projects/active khách: 401 AUTH_REQUIRED',
      active.status === 401 && active.json?.error === 'AUTH_REQUIRED',
      active.status,
    );
    const screen = await w.request('GET', '/project/screens/tong-quan.screen.json', lan);
    check('required: /project/* khách: 401', screen.status === 401, screen.status);
    const info = await w.request('GET', '/api/v1/system/info', lan);
    const keys = Object.keys(info.json ?? {})
      .sort()
      .join(',');
    check(
      'required: system/info khách chỉ có runtimeVersion và web',
      info.status === 200 && keys === 'runtimeVersion,web',
      keys,
    );
    const ws = await wsUpgrade(fp, { origin: 'https://rt:8443', localAddress: LAN_IP });
    check(
      'required: WebSocket live không phiên: 401 (không tin live nào trước khi đăng nhập)',
      ws.status === 401,
      `${ws.status} ${ws.error ?? ''}`,
    );
    const http = await plainHttp('GET', '/');
    check(
      'required: HTTP "/" là trang hướng dẫn mở HTTPS (HTML, CSP default-src none)',
      http.status === 200 &&
        /default-src 'none'/.test(http.headers['content-security-policy'] ?? '') &&
        /https:\/\//.test(http.body),
      `${http.status} ${http.headers['content-security-policy']}`,
    );
    const httpData = await plainHttp('GET', '/api/v1/projects/active');
    check(
      'required: HTTP projects/active khách: không có dữ liệu (401 hoặc 403)',
      [401, 403].includes(httpData.status) && !httpData.body.includes('"tags"'),
      httpData.status,
    );
    const S = (await w.login('xem1', pw('xem1'), lan)).session;
    check('required: đăng nhập viewer được', Boolean(S));
    const ok1 = await w.request('GET', '/api/v1/projects/active', { s: S, ...lan });
    const ok2 = await w.request('GET', '/project/screens/tong-quan.screen.json', {
      s: S,
      ...lan,
    });
    const ok3 = await w.request('GET', '/', { s: S, ...lan });
    check(
      'required: có phiên thì projects/active, /project/*, "/" đều 200',
      ok1.status === 200 && ok2.status === 200 && ok3.status === 200,
      `${ok1.status}/${ok2.status}/${ok3.status}`,
    );
    const wsOk = await wsUpgrade(fp, {
      cookie: S?.cookie,
      origin: 'https://rt:8443',
      localAddress: LAN_IP,
    });
    check(
      'required: có phiên thì WebSocket live được nâng cấp',
      wsOk.status === 101 || wsOk.status === 0,
      `${wsOk.status} ${wsOk.error ?? ''}`,
    );
  }
  return rep.result();
}
