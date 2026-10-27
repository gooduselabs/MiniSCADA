// Kịch bản `device-settings` của web-it (feature 027, specs/027-device-settings SC-001, SC-002): runtime x64 thật.
// Quản trị viên (phiên web + CSRF) đổi viewerLogin qua API → runtime tự khởi động lại → trang không đăng nhập bị chặn;
// giảm bảo vệ cần mật khẩu; sinh lại chứng chỉ có IP thêm → fingerprint trên cổng 8443 đổi đúng giá trị API trả, SAN có
// IP; nhập chứng chỉ của thiết bị khác bị từ chối; audit device.settings và cert.regenerate.
import { BASE, Web, makeReport, sleep } from '../lib/api.mjs';
import { PinError, pinnedConnect } from '../../../tools/measure/device-api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];

/** Fingerprint thiết bị đang đưa trên 8443 (qua lỗi ghim của một ghim giả). */
async function seenFingerprint() {
  try {
    const c = await pinnedConnect(BASE, '0'.repeat(64), { timeoutMs: 3000 });
    c.socket.destroy();
    return '0'.repeat(64);
  } catch (e) {
    return e instanceof PinError ? e.seen : '';
  }
}

/** Chờ runtime chạy lại (system/info trả lời) sau khi tự khởi động lại; `fp` là ghim mong đợi. */
async function waitBack(fp, sinceMs) {
  await sleep(1500);
  const w = new Web(fp);
  for (let i = 0; i < 60; i++) {
    try {
      const r = await w.request('GET', '/api/v1/system/info', { timeoutMs: 2000 });
      if (r.status === 200 && Date.now() - sinceMs > 1500) return true;
    } catch {
      /* đang khởi động lại */
    }
    await sleep(500);
  }
  return false;
}

export async function deviceSettings(fp) {
  const rep = makeReport('device-settings');
  const { check } = rep;
  let w = new Web(fp);
  let A = (await w.login('admin', pw('admin'))).session;
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

  // ---- thiết lập
  const g0 = await admin('GET', '/api/v1/admin/device-settings');
  check(
    'GET device-settings: 200, rev 0, cert có fingerprint đang dùng',
    g0.status === 200 && g0.json?.rev === 0 && g0.json?.cert?.fingerprint === fp,
    `${g0.status} rev=${g0.json?.rev}`,
  );
  const anon0 = await w.request('GET', '/api/v1/projects/active');
  check(
    'viewerLogin off: trang xem không đăng nhập được (200)',
    anon0.status === 200,
    `${anon0.status}`,
  );
  const k = await w.login('kysu1', pw('kysu1'));
  const eng = await w.request('GET', '/api/v1/admin/device-settings', {
    s: k.session,
    h: { 'Sec-Fetch-Site': 'same-origin' },
  });
  check('engineer: 403', eng.status === 403, `${eng.status}`);

  let t = Date.now();
  const s1 = await admin('POST', '/api/v1/admin/device-settings', {
    rev: 0,
    settings: { viewerLogin: 'required', deviceName: 'Trạm thử 027' },
  });
  check(
    'bật viewerLogin required: 200, restart',
    s1.status === 200 && s1.json?.rev === 1 && s1.json?.restart === true,
    `${s1.status} ${JSON.stringify(s1.json)}`,
  );
  check('runtime tự khởi động lại và chạy lại', await waitBack(fp, t));
  const anon1 = await w.request('GET', '/api/v1/projects/active');
  check(
    'sau khởi động lại: trang không đăng nhập bị chặn (401)',
    anon1.status === 401,
    `${anon1.status}`,
  );
  const g1 = await admin('GET', '/api/v1/admin/device-settings');
  check(
    'phiên web giữ qua khởi động lại; running = settings',
    g1.status === 200 &&
      g1.json?.running?.viewerLogin === 'required' &&
      g1.json?.running?.deviceName === 'Trạm thử 027' &&
      g1.json?.restartPending === false,
    `${g1.status} ${JSON.stringify(g1.json?.running)}`,
  );
  const stale = await admin('POST', '/api/v1/admin/device-settings', { rev: 0, settings: {} });
  check('rev cũ: 409 CONFLICT', stale.status === 409 && stale.json?.error === 'CONFLICT');
  const low = await admin('POST', '/api/v1/admin/device-settings', {
    rev: 1,
    settings: { viewerLogin: 'off' },
  });
  check(
    'tắt đăng nhập không có mật khẩu: 403 REAUTH_REQUIRED',
    low.status === 403 && low.json?.error === 'REAUTH_REQUIRED',
    `${low.status} ${low.json?.error}`,
  );

  // ---- chứng chỉ
  const before = await seenFingerprint();
  t = Date.now();
  const rg = await admin('POST', '/api/v1/admin/cert/regen', {
    reauth: pw('admin'),
    san: ['10.9.8.7', 'scada.nhamay.test'],
  });
  const fp2 = rg.json?.fingerprint ?? '';
  check(
    'sinh lại chứng chỉ: 200, fingerprint mới, SAN có IP thêm',
    rg.status === 200 &&
      /^[0-9a-f]{64}$/.test(fp2) &&
      fp2 !== fp &&
      rg.json?.sanIps?.includes('10.9.8.7') &&
      rg.json?.sanIps?.length >= 2 &&
      rg.json?.sanDns?.includes('scada.nhamay.test'),
    `${rg.status} ips=${JSON.stringify(rg.json?.sanIps)}`,
  );
  check('runtime chạy lại với chứng chỉ mới', await waitBack(fp2, t));
  const after = await seenFingerprint();
  check(
    'cổng 8443 đưa đúng fingerprint API trả (khác bản cũ)',
    after === fp2 && before === fp,
    `${before.slice(0, 8)} → ${after.slice(0, 8)}`,
  );
  w = new Web(fp2);
  A = (await w.login('admin', pw('admin'))).session;
  const g2 = await admin('GET', '/api/v1/admin/device-settings');
  check(
    'GET sau regen: không còn TLS_NO_IP_SAN',
    g2.status === 200 &&
      g2.json?.cert?.fingerprint === fp2 &&
      !(g2.json?.cert?.warnings ?? []).includes('TLS_NO_IP_SAN'),
    JSON.stringify(g2.json?.cert?.warnings),
  );
  const imp = await admin('POST', '/api/v1/admin/cert/import', {
    reauth: pw('admin'),
    pem: '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ\n-----END CERTIFICATE-----\n',
  });
  check(
    'nhập chứng chỉ hỏng: 400 CERT_FILE_INVALID, chứng chỉ cũ còn',
    imp.status === 400 &&
      imp.json?.error === 'CERT_FILE_INVALID' &&
      (await seenFingerprint()) === fp2,
    `${imp.status} ${imp.json?.error}`,
  );
  const csr = await admin('POST', '/api/v1/admin/cert/csr', { san: ['10.9.8.7'] });
  check(
    'tạo CSR: 200, PEM',
    csr.status === 200 && /BEGIN CERTIFICATE REQUEST/.test(csr.json?.csrPem ?? ''),
    `${csr.status}`,
  );

  // ---- audit
  const au = await admin('GET', '/api/v1/admin/audit?action=device.settings');
  const rows = au.json?.records ?? [];
  check(
    'audit device.settings có before/after',
    au.status === 200 &&
      rows.some((r) => r.result === 'ok' && /"after"/.test(JSON.stringify(r.detail ?? ''))),
    `${au.status} ${rows.length}`,
  );
  const au2 = await admin('GET', '/api/v1/admin/audit?action=cert.regenerate');
  check(
    'audit cert.regenerate',
    au2.status === 200 && (au2.json?.records ?? []).some((r) => r.result === 'ok'),
    `${au2.status}`,
  );
  return rep.result();
}
