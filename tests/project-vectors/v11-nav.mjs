// Ca `v11-nav-*` của bộ vector project (feature 030: menu 100 % theo cấu hình; mục trang hệ thống `system`,
// `navigation.alarmBell`). Được v11.mjs gọi (navCases); mô tả ở README-030.md. Dùng chung TS (vectors-11.test.ts)
// và C++ (vectors_11_test.cpp).
const PJ = 'project.json';
const nav = (f) => f[PJ].navigation;
const at = (code, path) => ({ code, file: PJ, path });

/** `ok`, `bad`: các hàm thêm ca của v11.mjs; `to10`: hạ project về 1.0 (bỏ phần chỉ có ở 1.1). */
export function navCases(ok, bad, to10) {
  // ---------- hợp lệ ----------
  ok('v11-nav-system-admin-bell-off', (f) => {
    nav(f).items.push({ label: 'Quản trị', system: 'admin', icon: 'gear' });
    nav(f).alarmBell = false;
  });
  // Trang hệ thống mà project không có tính năng: hợp lệ, cảnh báo, trang vận hành bỏ qua mục
  ok(
    'v11-nav-system-unavailable',
    (f) => {
      nav(f).items.push(
        { label: 'Cảnh báo', system: 'alarms' },
        {
          label: 'Hệ thống',
          items: [
            { label: 'Lịch sử alarm', system: 'alarm-history' },
            { label: 'Lịch sử', system: 'history' },
            { label: 'Công thức', system: 'recipes' },
          ],
        },
      );
    },
    ['W_NAV_SYSTEM'],
    {
      issues: [
        at('W_NAV_SYSTEM', '/navigation/items/1/system'),
        at('W_NAV_SYSTEM', '/navigation/items/2/items/0/system'),
        at('W_NAV_SYSTEM', '/navigation/items/2/items/1/system'),
        at('W_NAV_SYSTEM', '/navigation/items/2/items/2/system'),
      ],
    },
  );

  // ---------- schema ----------
  bad('v11-nav-system-unknown', (f) => nav(f).items.push({ label: 'X', system: 'trends' }), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-nav-system-and-screen',
    (f) => nav(f).items.push({ label: 'X', system: 'admin', screen: 'pump' }),
    ['E_SCHEMA'],
  );
  bad('v11-nav-alarm-bell-type', (f) => (nav(f).alarmBell = 'tat'), ['E_SCHEMA']);

  // ---------- phiên bản: chỉ từ 1.1 ----------
  bad(
    'v11-nav-system-in-1.0',
    (f) => {
      to10(f);
      nav(f).items.push({ label: 'Quản trị', system: 'admin' });
    },
    ['E_NAV'],
    undefined,
    { issues: [at('E_NAV', '/navigation/items/1/system')] },
  );
  bad(
    'v11-nav-alarm-bell-in-1.0',
    (f) => {
      to10(f);
      nav(f).alarmBell = true;
    },
    ['E_NAV'],
    undefined,
    { issues: [at('E_NAV', '/navigation/alarmBell')] },
  );
}
