// e2e feature 041: menu có mục hệ thống Alarm, không màn hình nào có Bảng alarm hiện hành → chuông mở #/alarms và tô mục đó.
import { ALARMS, alarmListProject, bellViewAll, currentMenu, open } from './alarm-list-fixture.mjs';
import { sleep, until } from './util.mjs';

export const options = {
  fixture: () =>
    alarmListProject([
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Lịch sử', screen: 'lich-su' },
      { label: 'Cảnh báo', system: 'alarms' },
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
  await sleep(400);
  const hash = await bellViewAll(ctx, until);
  ctx.check('Chuông: menu có mục hệ thống Alarm → #/alarms', hash === '#/alarms', hash);
  await sleep(200);
  const cur = await currentMenu(page);
  ctx.check('Chuông: mục "Cảnh báo" (hệ thống) được tô', cur?.startsWith('Cảnh báo'), String(cur));
  await page.waitForSelector('.al-page:not([hidden]) .al-tabs');
  ctx.check('trang Alarm hệ thống hiện (dùng chung mã với widget)', true);
}
