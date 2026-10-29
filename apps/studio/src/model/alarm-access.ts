// Feature 040: alarm dễ thấy với người vận hành. Project có alarm thì trang web cần ít nhất một lối vào: chuông cảnh
// báo (navigation.alarmBell, mặc định bật) hoặc mục trang hệ thống "Alarm" trong menu. Mô-đun thuần (không DOM):
//  - `alarmAccessIssue`: cảnh báo W_ALARM_NO_ACCESS (Studio, không chặn Nạp xuống) khi project ≥ 1 alarm mà chuông
//    tắt và menu không có mục Alarm.
//  - `withAlarmAccess`: menu sau khi thêm mục Alarm (nếu chưa có) và bật chuông; dùng cho nút sửa nhanh và khi thêm
//    alarm đầu tiên (một bước hoàn tác cùng alarm).
import type { Issue, Navigation } from '@mat/project-schema';
import { addSystemLeaf, setAlarmBell, usesSystem } from './navigation-doc.ts';

export const W_ALARM_NO_ACCESS = 'W_ALARM_NO_ACCESS' as const;

/** Định dạng 1.1 trở lên (mục `system` và `alarmBell` mới có). */
export function isFormat11(schemaVersion: unknown): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(String(schemaVersion ?? ''));
  return !!m && (Number(m[1]) > 1 || (Number(m[1]) === 1 && Number(m[2]) >= 1));
}

/** Người vận hành có lối vào alarm trên web: chuông bật hoặc menu có mục Alarm. */
export function hasAlarmAccess(nav: Navigation | null | undefined): boolean {
  if (!nav) return true; // không khai báo menu: runtime tự dựng menu mặc định có chuông
  return nav.alarmBell !== false || usesSystem(nav, 'alarms');
}

export function alarmAccessIssue(
  schemaVersion: unknown,
  nav: Navigation | null | undefined,
  alarmCount: number,
): Issue | null {
  if (alarmCount <= 0 || !isFormat11(schemaVersion) || hasAlarmAccess(nav)) return null;
  return {
    code: W_ALARM_NO_ACCESS,
    file: 'project.json',
    path: '/navigation',
    message:
      'the project has alarms but the web page has no way to them: alarm bell off and no Alarm menu entry',
  };
}

/**
 * Menu có mục "Alarm" (cuối gốc) và chuông bật. Trả `null` khi không cần đổi hoặc không đổi được (project cũ, menu
 * đầy, nhãn lỗi): khi đó giữ nguyên.
 */
export function withAlarmAccess(
  nav: Navigation,
  schemaVersion: unknown,
  label: string,
): Navigation | null {
  if (!isFormat11(schemaVersion)) return null;
  let next = setAlarmBell(nav, true).nav;
  if (!usesSystem(next, 'alarms')) {
    const r = addSystemLeaf(next, { label, system: 'alarms', icon: 'bell' });
    if (!r.rejected) next = r.nav;
  }
  return next === nav ? null : next;
}
