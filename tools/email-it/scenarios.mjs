// Kiểm tích hợp x64 của feature 023 (email alarm): runtime x64 trong Docker phát alarm → email tới máy chủ SMTP giả
// (STARTTLS, AUTH, CA thử), gửi thử, gom (bão alarm → một email), hết alarm, mất mạng + khởi động lại runtime rồi gửi
// bù, giới hạn email/giờ, nhắc lại (tùy chọn --reminder, mất ~6 phút), audit, RAM/CPU của runtime.
//   node tools/email-it/scenarios.mjs [--reminder]
// Biến môi trường (tools/email-it.ps1 đặt): MAT_IT_HTTPS, MAT_IT_HTTP, MAT_IT_SIM, MAT_IT_RT, MAT_IT_FP,
// MAT_IT_PW_ADMIN, MAT_IT_SMTP_CTL. In đúng một dòng JSON { scenario, checks, measures, pass }.
import {
  auditRows,
  bearer,
  breq,
  dexec,
  emit,
  makeReport,
  simCoil,
  simHolding,
  sleep,
  termRuntime,
  waitFor,
  waitRuntime,
} from '../alarm-it/lib.mjs';

const CTL = process.env.MAT_IT_SMTP_CTL ?? 'http://127.0.0.1:29580';
const withReminder = process.argv.includes('--reminder');
const report = makeReport('email');
const { check, measures } = report;

const ctl = async (method, path) => (await fetch(CTL + path, { method })).json();
const mails = async () => (await ctl('GET', '/mails')).mails;

function decodeSubject(data) {
  const m = /^Subject: ((?:.*)(?:\r\n[ \t].*)*)/m.exec(data);
  if (!m) return '';
  return m[1]
    .replace(/\r\n[ \t]/g, '')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
}
function bodyParts(data) {
  const out = [];
  for (const m of data.matchAll(
    /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g,
  ))
    out.push(Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
  return out;
}
async function waitMails(n, timeoutMs, what) {
  return waitFor(
    async () => {
      const m = await mails();
      return m.length >= n ? m : null;
    },
    timeoutMs,
    what,
    300,
  ).catch(() => null);
}
const rss = () =>
  Number(dexec('grep VmRSS /proc/$(cat /run/mat-runtime.pid)/status | tr -dc 0-9').trim() || '0');
const cpuTicks = () => {
  const f = dexec('cat /proc/$(cat /run/mat-runtime.pid)/stat').trim().split(' ');
  return Number(f[13]) + Number(f[14]);
};
async function cpuPercent(seconds) {
  const a = cpuTicks();
  await sleep(seconds * 1000);
  return ((cpuTicks() - a) / 100 / seconds) * 100;
}

const config = (over = {}) => ({
  enabled: true,
  siteName: 'Trạm thử IT',
  baseUrl: 'https://192.0.2.10:8443',
  smtp: {
    host: 'smtp',
    port: 2525,
    security: 'starttls',
    username: 'mat',
    from: 'scada@example.com',
    fromName: 'mAT IT',
    caFile: '/certs/cert.pem',
    timeoutS: 10,
  },
  rules: [
    {
      id: 'all',
      name: 'Khẩn cấp và quan trọng',
      priorities: [1, 2],
      events: withReminder ? ['active', 'return', 'reminder'] : ['active', 'return'],
      reminderMin: 5,
      to: ['truc.ca@example.com', 'ky.su@example.com'],
    },
  ],
  batchSeconds: 5,
  maxPerHour: 50,
  reminderMax: 1,
  ...over,
});

let token;
let rev = 0;
async function save(cfg) {
  const r = await breq('POST', '/api/v1/admin/email', token, { rev, config: cfg });
  if (r.status === 200) rev = r.json.rev;
  return r;
}
const status = async () => (await breq('GET', '/api/v1/admin/email', token)).json;

try {
  await waitRuntime(90000);
  token = await bearer('admin');
  await simCoil(0, 0);
  await simCoil(1, 0);
  await simHolding(0, 0);
  await sleep(1500);
  measures.rssKiBEmailOff = rss();
  measures.cpuIdlePctEmailOff = Number((await cpuPercent(20)).toFixed(2));

  const s0 = await status();
  check(
    'GET /admin/email: chưa bật, mật khẩu đã đặt',
    s0 && s0.config.enabled === false && s0.passwordSet === true,
    JSON.stringify(s0?.status),
  );
  rev = s0?.rev ?? 0;
  const bad = await breq('POST', '/api/v1/admin/email', token, {
    rev,
    config: { ...config(), smtp: { ...config().smtp, password: 'x' } },
  });
  check('mật khẩu qua API bị từ chối (400)', bad.status === 400, bad.status);
  const sv = await save(config());
  check('lưu cấu hình (200, rev + 1)', sv.status === 200 && rev === s0.rev + 1, sv.status);

  // Gửi thử.
  await ctl('POST', '/reset');
  const t = await breq('POST', '/api/v1/admin/email/test', token, { to: 'thu@example.com' });
  check('gửi thử: ok', t.status === 200 && t.json.ok === true, JSON.stringify(t.json));
  let m = await waitMails(1, 10000, 'email thử');
  check(
    'máy chủ giả nhận email thử qua STARTTLS + AUTH',
    m && m[0].tls && m[0].auth === 'mat',
    JSON.stringify(m?.[0] && { tls: m[0].tls, auth: m[0].auth }),
  );
  check(
    'tiêu đề email thử tiếng Việt',
    m && decodeSubject(m[0].data) === '[Trạm thử IT] Email thử',
    m && decodeSubject(m[0].data),
  );

  // Alarm khẩn cấp → một email trong gom + 10 s.
  await ctl('POST', '/reset');
  const t0 = Date.now();
  await simCoil(0, 1); // IT_FAULT, khẩn cấp
  m = await waitMails(1, 25000, 'email alarm');
  measures.alarmToEmailMs = m ? m[0].at - t0 : null;
  check(
    'alarm → email trong batchSeconds + 10 s (SC-001)',
    m && m[0].at - t0 <= 15000,
    measures.alarmToEmailMs,
  );
  if (m) {
    const subj = decodeSubject(m[0].data);
    const [text, html] = bodyParts(m[0].data);
    check('tiêu đề: trạm, mức, tên alarm', subj === '[Trạm thử IT] Khẩn cấp: Bơm IT lỗi', subj);
    check(
      'người nhận: cả hai địa chỉ của quy tắc',
      m[0].to.sort().join() === 'ky.su@example.com,truc.ca@example.com',
      m[0].to.join(),
    );
    check(
      'nội dung text: Tag, trạng thái, liên kết trang Alarm',
      text?.includes('IT.FAULT') &&
        text.includes('Đang có, chưa xác nhận') &&
        text.includes('https://192.0.2.10:8443/alarms'),
      text?.slice(0, 300),
    );
    check(
      'nội dung HTML có liên kết, không có thẻ lạ',
      html?.includes('href="https://192.0.2.10:8443/alarms"') && !html.includes('<script'),
      '',
    );
  }

  // Bão: 3 alarm trong cửa sổ gom → 1 email.
  await ctl('POST', '/reset');
  await simHolding(0, 99); // IT_LEVEL.H (quan trọng), IT_LEVEL.HH (khẩn cấp)
  await simCoil(1, 1); // IT_FAULT2 (quan trọng)
  m = await waitMails(1, 25000, 'email gom');
  await sleep(8000);
  m = await mails();
  check('bão 3 alarm → đúng 1 email (gom)', m.length === 1, m.length);
  if (m.length) {
    const subj = decodeSubject(m[0].data);
    check('tiêu đề gom: số sự kiện theo mức', /3 sự kiện alarm/.test(subj), subj);
  }

  // Hết alarm → email "đã hết".
  await ctl('POST', '/reset');
  await simCoil(0, 0);
  await simCoil(1, 0);
  await simHolding(0, 0);
  m = await waitMails(1, 25000, 'email hết');
  check(
    'alarm hết → email',
    m && /đã hết|sự kiện alarm/.test(decodeSubject(m[0].data)),
    m && decodeSubject(m[0].data),
  );

  // Mất mạng + khởi động lại runtime → gửi bù.
  await sleep(8000);
  await ctl('POST', '/reset');
  await ctl('POST', '/pause');
  await simCoil(0, 1);
  await waitFor(
    async () => (((await status())?.status?.queue?.count ?? 0) >= 1 ? true : null),
    30000,
    'email vào hàng đợi',
    500,
  ).catch(() => null);
  const sq = await status();
  check(
    'mất mạng: email nằm trong hàng đợi, có lỗi cuối CONNECT',
    sq.status.queue.count >= 1 && sq.status.lastError?.error === 'CONNECT',
    JSON.stringify(sq.status),
  );
  termRuntime();
  await sleep(3000);
  await waitRuntime(90000);
  token = await bearer('admin');
  const sr = await status();
  check(
    'sau khởi động lại: hàng đợi còn trên đĩa',
    sr.status.queue.count >= 1,
    JSON.stringify(sr.status.queue),
  );
  rev = sr.rev;
  await ctl('POST', '/resume');
  m = await waitMails(1, 120000, 'gửi bù');
  check('mạng về: email được gửi bù', m && m.length >= 1, m?.length);
  await sleep(10000);
  m = await mails();
  check(
    'gửi bù không trùng (1 email, không gửi lại alarm khôi phục lúc khởi động)',
    m.length === 1,
    m.map((x) => decodeSubject(x.data)).join(' | '),
  );

  // Giới hạn email/giờ.
  const lim = await save(config({ maxPerHour: 1 }));
  check('đặt maxPerHour = 1', lim.status === 200, lim.status);
  await ctl('POST', '/reset');
  await simCoil(1, 1);
  await waitMails(1, 25000, 'email 1 trong giờ');
  await simCoil(0, 0);
  await sleep(2000);
  await simCoil(0, 1);
  await sleep(15000);
  m = await mails();
  const sl = await status();
  check(
    'giới hạn 1 email/giờ: email thứ hai bị giữ, không mất',
    m.length === 1 && sl.status.pendingEvents >= 1,
    `${m.length} mails, pending ${sl.status.pendingEvents}`,
  );

  if (withReminder) {
    await save(
      config({
        maxPerHour: 50,
        rules: [{ ...config().rules[0], events: ['reminder'], reminderMin: 5 }],
      }),
    );
    // Sự kiện còn giữ do giới hạn ở bước trước được gửi trước (không mất): bỏ qua email đó.
    await sleep(12000);
    await ctl('POST', '/reset');
    await simCoil(1, 0);
    await sleep(2000);
    await simCoil(1, 1); // chưa xác nhận
    const rem = await waitFor(
      async () => (await mails()).find((x) => /Nhắc lại/.test(decodeSubject(x.data))) ?? null,
      7 * 60000,
      'email nhắc lại',
      1000,
    ).catch(() => null);
    check(
      'chưa xác nhận sau 5 phút → email nhắc lại',
      rem,
      (await mails()).map((x) => decodeSubject(x.data)).join(' | '),
    );
  }

  // Audit.
  const rows = await auditRows(token, 'action=email.');
  const acts = new Set(rows.map((r) => `${r.action}/${r.result}`));
  check(
    'audit: email.sent, email.failed, email.config, email.test',
    ['email.sent/ok', 'email.failed/failed', 'email.config/ok', 'email.test/ok'].every((a) =>
      acts.has(a),
    ),
    [...acts].join(','),
  );
  const pw = process.env.MAT_IT_SMTP_PW ?? '';
  check('audit không chứa mật khẩu SMTP', pw && !JSON.stringify(rows).includes(pw));
  const log = dexec('cat /logs/runtime.log');
  check('log runtime không chứa mật khẩu SMTP', pw && !log.includes(pw));

  measures.rssKiBEmailOn = rss();
  measures.cpuIdlePctEmailOn = Number((await cpuPercent(20)).toFixed(2));
  measures.rssDeltaKiB = measures.rssKiBEmailOn - measures.rssKiBEmailOff;
  check(
    'RSS tăng ≤ 1 MiB khi bật email (SC-004, tham khảo)',
    measures.rssDeltaKiB <= 1024 + 512,
    measures.rssDeltaKiB,
  );
} catch (e) {
  check('chạy hết kịch bản', false, e?.stack ?? String(e));
}
emit(report);
