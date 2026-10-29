// e2e feature 041: menu không có Bảng alarm nào và không có mục Alarm hệ thống → chuông vẫn mở #/alarms (luôn có chỗ xử lý).
import { ALARMS, alarmListProject, bellViewAll, open } from './alarm-list-fixture.mjs';
import { until } from './util.mjs';

export const options = {
  fixture: () =>
    alarmListProject([
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Lịch sử', screen: 'lich-su' },
    ]),
  config: { alarms: true },
  drift: false,
};

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403');
  rt.alarm.reset(ALARMS());
  await open(ctx, '#/tong-quan');
  await new Promise((r) => setTimeout(r, 400));
  const hash = await bellViewAll(ctx, until);
  ctx.check('Chuông: không có gì trong menu → vẫn #/alarms', hash === '#/alarms', hash);
  await page.waitForSelector('.al-page:not([hidden]) .al-tabs');
  ctx.check('trang Alarm hệ thống hiện', true);
}
