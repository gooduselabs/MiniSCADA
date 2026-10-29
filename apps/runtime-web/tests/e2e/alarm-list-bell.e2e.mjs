// e2e feature 041: đích của chuông "Xem tất cả alarm" khi menu không có màn hình Bảng alarm Đầy đủ. Một project, ba lần nạp
// với menu khác nhau: ở đây menu chỉ có màn hình Bảng alarm Gọn (và kiểu Lịch sử) → chuông mở màn hình Gọn.
import { ALARMS, alarmListProject, bellViewAll, currentMenu, open } from './alarm-list-fixture.mjs';
import { sleep, until } from './util.mjs';

// Menu: Tổng quan, màn hình Gọn (không có Đầy đủ) → chuông mở màn hình Gọn.
export const options = {
  fixture: () =>
    alarmListProject([
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Tổng quan alarm', screen: 'tq-gon' },
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
  await sleep(400);
  const hash = await bellViewAll(ctx, until);
  ctx.check(
    'Chuông: chỉ có Bảng alarm Gọn → mở màn hình đó (bỏ qua kiểu Lịch sử)',
    hash === '#/tq-gon',
    hash,
  );
  await sleep(200);
  const cur = await currentMenu(page);
  ctx.check('Chuông: mục "Tổng quan alarm" được tô', cur === 'Tổng quan alarm', String(cur));
}
