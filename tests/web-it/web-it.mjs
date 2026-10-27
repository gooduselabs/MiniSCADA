// Điểm vào của client web-it (feature 007, T049, T073): chạy trong container `client` của tests/web-it/compose.yaml,
// do tools/web-it.ps1 gọi bằng `docker exec`. In đúng một đối tượng JSON: { scenario, checks, measures, pass }.
//   node web-it.mjs attack|attack-accounts|control|locks|session|expect|pulse|pulse-kill --fp <fingerprint>
//   node web-it.mjs session --step prep28|check28 --fp <fp>   (đổi mật khẩu bằng CLI do script làm giữa hai bước)
// Mật khẩu từ môi trường (MAT_IT_PW_ADMIN, _KYSU1, _VH1, _VH2, _XEM1).
import { access, accessData, adminAttack, loginRequired } from './scenarios/access.mjs';
import { attack, attackAccounts } from './scenarios/attack.mjs';
import { dataApi } from './scenarios/data-api.mjs';
import { deviceSettings } from './scenarios/device-settings.mjs';
import { gate } from './scenarios/gate.mjs';
import { writeMinRole } from './scenarios/write-min-role.mjs';
import { lockoutDos } from './lockout-dos.mjs';
import { control, expectScenario, locks, pulse, pulseKill, session } from './scenarios/control.mjs';

const args = process.argv.slice(2);
const scenario = args[0];
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const fp = opt('--fp', '');

const table = {
  attack: () => attack(fp),
  'svg-attack': () =>
    attack(fp, {
      name: 'svg-attack',
      context: { screen: 'bon-nuoc', widget: 'el_pump_centrifugal_hit' },
    }),
  'attack-accounts': () => attackAccounts(fp, opt('--part', 'lock')),
  control: () => control(fp),
  gate: () => gate(fp, opt('--mode', 'private')),
  locks: () => locks(fp),
  session: () => session(fp, opt('--step', 'all')),
  expect: () => expectScenario(fp),
  pulse: () => pulse(fp, Number(opt('--rounds', '20'))),
  'pulse-kill': () => pulseKill(fp, Number(opt('--rounds', '5'))),
  // feature 011 (T053, T209)
  'lockout-dos': () => lockoutDos(fp, Number(opt('--attempts', '1000'))),
  'write-min-role': () => writeMinRole(fp),
  // feature 013 (T013, T023, T029): viewerLogin required
  'login-required': () => loginRequired(fp),
  access: () => access(fp),
  'access-data': () => accessData(fp),
  'admin-attack': () => adminAttack(fp),
  // feature 025 (T042): API dữ liệu bằng API key
  'data-api': () => dataApi(fp),
  'device-settings': () => deviceSettings(fp),
};

if (!table[scenario]) {
  console.error(`kịch bản không biết: ${scenario}`);
  process.exit(2);
}
try {
  const result = await table[scenario]();
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  console.log(
    JSON.stringify({
      scenario,
      checks: [{ name: 'chạy hết kịch bản', pass: false, detail: e.stack ?? String(e) }],
      measures: {},
      pass: false,
    }),
  );
  process.exit(0);
}
