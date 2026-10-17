// Kịch bản `lockout-dos` của web-it (feature 011, T053, SC-003; contracts/device-api-011.md §2): khóa đăng nhập theo
// cặp (tên, IP) và theo IP thay khóa theo tên của 005, nên kẻ tấn công không khóa được người dùng thật.
//   - IP A (mạng lan của client) đoán mật khẩu 1.000 lần, rải trên nhiều tên (có tên thật vh1, kysu1, admin): bộ đếm
//     IP khóa sau 20 lần sai, nên tối đa 20 lần được kiểm mật khẩu (401), phần còn lại 429 ACCOUNT_LOCKED ngay;
//   - trong lúc đó vh1 (người thật) từ IP B (mạng pub) đăng nhập đúng: 200 trong ≤ 2 s, kể cả khi vh1 bị đoán từ A;
//   - IP A với mật khẩu đúng của vh1 vẫn bị chặn (khóa IP), audit có auth.lockout.
// Chạy trong container client: node tests/web-it/web-it.mjs lockout-dos --fp <fp>. Không đổi tài khoản; khóa nằm trong
// bộ nhớ runtime (tools/web-it.ps1 khởi động lại runtime trước kịch bản sau).
import { LAN_IP, PUB_IP, Web, auditRows, makeReport } from './lib/api.mjs';

const pw = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`];

export async function lockoutDos(fp, attempts = 1000) {
  const rep = makeReport('lockout-dos');
  const { check, measures } = rep;
  const w = new Web(fp);
  const sinceId = (await auditRows(fp, 'action=auth.login').catch(() => [])).at(-1)?.id ?? 0;
  const names = ['vh1', 'kysu1', 'admin', 'vh2', 'xem1', 'operator', 'root', 'quanly'];
  const statuses = {};
  let checked = 0; // lần mật khẩu thật sự được kiểm (401 sai mật khẩu)
  let firstLockedAt = -1;
  let maxLockedMs = 0;
  let realLogins = 0;
  let realOk = 0;
  let realWorstMs = 0;
  const t0 = performance.now();
  for (let i = 0; i < attempts; i++) {
    const user = names[i % names.length];
    const t = performance.now();
    const r = await w.login(user, `sai-${i}-mat-khau-doan`, { localAddress: LAN_IP });
    const ms = performance.now() - t;
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    if (r.status === 401) checked++;
    if (r.status === 429) {
      if (firstLockedAt < 0) firstLockedAt = i;
      maxLockedMs = Math.max(maxLockedMs, ms);
    }
    // Người dùng thật từ IP B, mỗi 100 lần đoán.
    if (i % 100 === 50) {
      realLogins++;
      const tr = performance.now();
      const ok = await w.login('vh1', pw('vh1'), { localAddress: PUB_IP });
      const rms = performance.now() - tr;
      realWorstMs = Math.max(realWorstMs, rms);
      if (ok.status === 200 && ok.session && rms <= 2000) realOk++;
    }
  }
  const totalS = (performance.now() - t0) / 1000;
  check(
    `${attempts} lần đoán từ IP A: tối đa 20 lần được kiểm mật khẩu (khóa IP)`,
    checked <= 20,
    `${checked} lần 401; trạng thái ${JSON.stringify(statuses)}`,
  );
  check(
    'các lần còn lại bị chặn bằng 429 (ACCOUNT_LOCKED), không phải lỗi khác',
    (statuses[429] ?? 0) + checked === attempts,
    JSON.stringify(statuses),
  );
  check(
    'người dùng thật vh1 từ IP B đăng nhập được trong ≤ 2 s ở mọi lần thử',
    realOk === realLogins && realLogins > 0,
    `${realOk}/${realLogins}, chậm nhất ${Math.round(realWorstMs)} ms`,
  );
  const fromA = await w.login('vh1', pw('vh1'), { localAddress: LAN_IP });
  check(
    'IP A với mật khẩu đúng vẫn bị chặn (429) trong thời gian khóa',
    fromA.status === 429,
    `${fromA.status} ${fromA.json?.error ?? ''}`,
  );
  const fromB = await w.login('vh1', pw('vh1'), { localAddress: PUB_IP });
  check('sau cùng vh1 từ IP B vẫn vào được', fromB.status === 200, String(fromB.status));
  const rows = await auditRows(fp, 'action=auth.lockout').catch(() => []);
  check(
    'audit có auth.lockout cho IP A',
    rows.some((r) => r.id > sinceId && String(r.source ?? '').includes(LAN_IP)),
    `${rows.length} dòng auth.lockout`,
  );
  Object.assign(measures, {
    attempts,
    checkedByPassword: checked,
    firstLockedAtAttempt: firstLockedAt,
    statuses,
    lockedAnswerMaxMs: Math.round(maxLockedMs),
    realUserLogins: `${realOk}/${realLogins}`,
    realUserWorstMs: Math.round(realWorstMs),
    durationS: Math.round(totalS * 10) / 10,
  });
  return rep.result();
}
