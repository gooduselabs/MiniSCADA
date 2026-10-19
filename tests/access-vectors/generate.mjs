// Sinh bộ vector quyền dùng chung TS (packages/access-model) và C++ (core/auth, gtest access_vectors_test):
// specs/013-access-control/contracts/access-model.md §4, §7; quy ước chi tiết ở README.md cùng thư mục.
//
//   node tests/access-vectors/generate.mjs
//
// Tất định, không phụ thuộc gói, KHÔNG gọi bộ tính: `expected` của từng ca viết tay theo luật §4 (các hằng OPERATOR,
// VIEWER, ADMIN... là kết quả viết tay của danh mục nền, ca sửa chúng bằng danh sách cụ thể). Ra:
// tests/access-vectors/<tên>/{catalog.json, access.json, principal.json, expected.json}. Mỗi lần chạy xóa và ghi lại
// mọi thư mục ca.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ======================================================================================
// Danh mục nền (đã áp mặc định project, §3)
// ======================================================================================

/**
 * Bốn màn hình (một popup), hai nhóm lưu trữ, một mẫu báo cáo, năm alarm. Tag `PUMP01.RUN_CMD` dùng ở `tong-quan` và
 * `popup-bom`, `PUMP01.RUN` ở `bom-1` và `popup-bom`, `PUMP01.FLOW` chỉ ở `popup-bom`; `P1` chỉ ở nhóm lưu trữ (alarm
 * `a-ap` không có Tag nguồn trên màn hình nào), `E1` ở cả nhóm `nang-luong` và mẫu `dien-ngay`.
 */
function baseCatalog() {
  const op = (id, tags, view = 'viewer', operate = 'operator') => ({
    id,
    operable: true,
    view,
    operate,
    tags,
  });
  const ro = (id, tags, view = 'viewer') => ({ id, operable: false, view, tags });
  return {
    screens: [
      {
        id: 'tong-quan',
        popup: false,
        view: 'viewer',
        items: [
          op('chay-bom', ['PUMP01.RUN_CMD']),
          ro('muc-be', ['TANK.LEVEL']),
          ro('chi-phi', ['COST.TODAY']),
        ],
      },
      {
        id: 'bom-1',
        popup: false,
        view: 'viewer',
        items: [ro('den', ['PUMP01.RUN']), op('dat-toc', ['PUMP01.SPEED_SP'])],
      },
      {
        id: 'bao-tri',
        popup: false,
        view: 'viewer',
        items: [op('reset', ['PUMP01.RESET']), ro('gio-chay', ['PUMP01.HOURS'])],
      },
      {
        id: 'popup-bom',
        popup: true,
        view: 'viewer',
        items: [op('chay', ['PUMP01.RUN_CMD']), ro('nhan', ['PUMP01.RUN', 'PUMP01.FLOW'])],
      },
    ],
    historyGroups: [
      { id: 'ap-suat', tags: ['P1', 'TANK.LEVEL'] },
      { id: 'nang-luong', tags: ['E1'] },
    ],
    reports: [{ id: 'dien-ngay', tags: ['E1', 'E2'] }],
    alarms: [
      { id: 'a-muc', tag: 'TANK.LEVEL' },
      { id: 'a-bom', tag: 'PUMP01.RUN' },
      { id: 'a-ap', tag: 'P1' },
      { id: 'a-gio', tag: 'PUMP01.HOURS' },
      { id: 'a-luu', tag: 'PUMP01.FLOW' },
    ],
  };
}

const screenOf = (cat, id) => cat.screens.find((s) => s.id === id);
const itemOf = (cat, s, i) => screenOf(cat, s).items.find((it) => it.id === i);

// Nhóm có trong access.json của mọi ca (id theo §1.2).
const GROUPS = [
  { id: 'ca-a', name: 'Vận hành ca A' },
  { id: 'ca-b', name: 'Vận hành ca B' },
  { id: 'bao-tri', name: 'Bảo trì' },
  { id: 'quan-doc', name: 'Quản đốc' },
  { id: 'ke-toan', name: 'Kế toán' },
  { id: 'khach', name: 'Khách tham quan' },
];

// ======================================================================================
// Kết quả viết tay của danh mục nền
// ======================================================================================

const SCREENS = ['tong-quan', 'bom-1', 'bao-tri', 'popup-bom'];
/** Mọi Tag của item (sắp theo chuỗi). */
const ITEM_TAGS = [
  'COST.TODAY',
  'PUMP01.FLOW',
  'PUMP01.HOURS',
  'PUMP01.RESET',
  'PUMP01.RUN',
  'PUMP01.RUN_CMD',
  'PUMP01.SPEED_SP',
  'TANK.LEVEL',
];
/** ITEM_TAGS cộng Tag của hai nhóm lưu trữ (P1, E1) và mẫu báo cáo (E1, E2). */
const ALL_HIST = [
  'COST.TODAY',
  'E1',
  'E2',
  'P1',
  'PUMP01.FLOW',
  'PUMP01.HOURS',
  'PUMP01.RESET',
  'PUMP01.RUN',
  'PUMP01.RUN_CMD',
  'PUMP01.SPEED_SP',
  'TANK.LEVEL',
];
/** Alarm có Tag nguồn trên màn hình (không có `a-ap`: P1 chỉ ở nhóm lưu trữ). */
const ALARMS = ['a-bom', 'a-gio', 'a-luu', 'a-muc'];
const ALL_ALARMS = ['a-ap', 'a-bom', 'a-gio', 'a-luu', 'a-muc'];
const PAGES4 = ['alarms', 'history', 'reports', 'watch'];
const PAGES3 = ['alarms', 'history', 'reports'];
const LOCKED_ALL = {
  'bao-tri': ['reset'],
  'bom-1': ['dat-toc'],
  'popup-bom': ['chay'],
  'tong-quan': ['chay-bom'],
};

const without = (list, ...xs) => list.filter((x) => !xs.includes(x));
const omit = (obj, ...keys) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

const OPERATOR = {
  screens: SCREENS,
  hiddenItems: {},
  lockedItems: {},
  pages: PAGES4,
  admin: false,
  liveTags: ITEM_TAGS,
  historyTags: ALL_HIST,
  alarms: ALARMS,
  orphans: [],
};
const VIEWER = { ...OPERATOR, lockedItems: LOCKED_ALL, pages: PAGES3 };
const ADMIN = { ...OPERATOR, admin: true, alarms: ALL_ALARMS };

/** Không xem được `bao-tri` (mất PUMP01.RESET, PUMP01.HOURS, alarm a-gio). */
const BT_DENIED_OP = {
  ...OPERATOR,
  screens: ['tong-quan', 'bom-1', 'popup-bom'],
  liveTags: without(ITEM_TAGS, 'PUMP01.HOURS', 'PUMP01.RESET'),
  historyTags: without(ALL_HIST, 'PUMP01.HOURS', 'PUMP01.RESET'),
  alarms: ['a-bom', 'a-luu', 'a-muc'],
};
const BT_DENIED_VIEWER = {
  ...BT_DENIED_OP,
  pages: PAGES3,
  lockedItems: omit(LOCKED_ALL, 'bao-tri'),
};
/** Không xem được `popup-bom`: PUMP01.RUN_CMD còn ở tong-quan, PUMP01.RUN ở bom-1, mất PUMP01.FLOW và a-luu. */
const POPUP_DENIED_OP = {
  ...OPERATOR,
  screens: ['tong-quan', 'bom-1', 'bao-tri'],
  liveTags: without(ITEM_TAGS, 'PUMP01.FLOW'),
  historyTags: without(ALL_HIST, 'PUMP01.FLOW'),
  alarms: ['a-bom', 'a-gio', 'a-muc'],
};
/** ITEM_TAGS cộng Tag của mẫu báo cáo (trang Lịch sử bị cấm, trang Báo cáo được). */
const HIST_REPORTS_ONLY = [
  'COST.TODAY',
  'E1',
  'E2',
  'PUMP01.FLOW',
  'PUMP01.HOURS',
  'PUMP01.RESET',
  'PUMP01.RUN',
  'PUMP01.RUN_CMD',
  'PUMP01.SPEED_SP',
  'TANK.LEVEL',
];

// ======================================================================================
// Ca
// ======================================================================================

const P = (user, role, groups = []) => ({ user, role, groups });
const R = (resource, level, grantees) => ({ resource, level, grantees });
const O = (resource, level) => ({ resource, level });

const CASES = [];
/** c(tên, { catalog?: (cat) => void, rules?: [], principal, expected }) */
function c(name, { catalog, rules = [], principal, expected }) {
  if (CASES.some((x) => x.name === name)) throw new Error(`ca trùng tên: ${name}`);
  const cat = baseCatalog();
  if (catalog) catalog(cat);
  CASES.push({ name, catalog: cat, rules, principal, expected });
}

const BT = (grantees) => [R('screen:bao-tri', 'view', grantees)];

// ---------- mặc định, không quy tắc ----------
c('default-viewer', { principal: P('xem1', 'viewer'), expected: VIEWER });
c('default-operator', { principal: P('vh1', 'operator'), expected: OPERATOR });
c('default-engineer', { principal: P('ks1', 'engineer'), expected: OPERATOR });
c('default-administrator', { principal: P('admin', 'administrator'), expected: ADMIN });
c('default-anonymous', { principal: P(null, 'viewer'), expected: VIEWER });
c('default-empty-catalog', {
  catalog: (cat) => {
    cat.screens = [];
    cat.historyGroups = [];
    cat.reports = [];
    cat.alarms = [];
  },
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, screens: [], liveTags: [], historyTags: [], alarms: [] },
});

// ---------- người nhận `*` ----------
c('star-logged-in', { rules: BT(['*']), principal: P('vh1', 'operator'), expected: OPERATOR });
c('star-viewer-logged-in', { rules: BT(['*']), principal: P('xem1', 'viewer'), expected: VIEWER });
c('star-anonymous-denied', {
  rules: BT(['*']),
  principal: P(null, 'viewer'),
  expected: BT_DENIED_VIEWER,
});

// ---------- `user:` ----------
c('user-match', { rules: BT(['user:vh1']), principal: P('vh1', 'operator'), expected: OPERATOR });
c('user-other', {
  rules: BT(['user:vh1']),
  principal: P('vh2', 'operator'),
  expected: BT_DENIED_OP,
});
c('user-anonymous-denied', {
  rules: BT(['user:vh1']),
  principal: P(null, 'viewer'),
  expected: BT_DENIED_VIEWER,
});

// ---------- `group:` ----------
c('group-match', {
  rules: BT(['group:bao-tri']),
  principal: P('vh1', 'operator', ['bao-tri']),
  expected: OPERATOR,
});
c('group-no-match', {
  rules: BT(['group:bao-tri']),
  principal: P('vh1', 'operator', ['ca-a']),
  expected: BT_DENIED_OP,
});
c('group-member-of-several', {
  rules: BT(['group:bao-tri']),
  principal: P('vh1', 'operator', ['ca-a', 'bao-tri']),
  expected: OPERATOR,
});
c('group-several-grantees', {
  rules: BT(['group:ca-b', 'group:bao-tri']),
  principal: P('vh1', 'operator', ['bao-tri']),
  expected: OPERATOR,
});
c('group-two-screens-one-match', {
  rules: [
    R('screen:bao-tri', 'view', ['group:bao-tri']),
    R('screen:bom-1', 'view', ['group:ca-a']),
  ],
  principal: P('vh1', 'operator', ['ca-a']),
  expected: BT_DENIED_OP,
});
c('group-two-screens-none', {
  rules: [
    R('screen:bao-tri', 'view', ['group:bao-tri']),
    R('screen:bom-1', 'view', ['group:ca-a']),
  ],
  principal: P('vh1', 'operator', ['ca-b']),
  expected: {
    ...OPERATOR,
    screens: ['tong-quan', 'popup-bom'],
    liveTags: ['COST.TODAY', 'PUMP01.FLOW', 'PUMP01.RUN', 'PUMP01.RUN_CMD', 'TANK.LEVEL'],
    historyTags: [
      'COST.TODAY',
      'E1',
      'E2',
      'P1',
      'PUMP01.FLOW',
      'PUMP01.RUN',
      'PUMP01.RUN_CMD',
      'TANK.LEVEL',
    ],
    alarms: ['a-bom', 'a-luu', 'a-muc'],
  },
});
c('group-anonymous-denied', {
  rules: BT(['group:bao-tri']),
  principal: P(null, 'viewer'),
  expected: BT_DENIED_VIEWER,
});

// ---------- `role:` (đúng hoặc cao hơn) ----------
c('role-higher-matches', {
  rules: BT(['role:operator']),
  principal: P('ks1', 'engineer'),
  expected: OPERATOR,
});
c('role-equal-matches', {
  rules: BT(['role:operator']),
  principal: P('vh1', 'operator'),
  expected: OPERATOR,
});
c('role-lower-denied', {
  rules: BT(['role:operator']),
  principal: P('xem1', 'viewer'),
  expected: BT_DENIED_VIEWER,
});
c('role-viewer-matches-anonymous', {
  rules: BT(['role:viewer']),
  principal: P(null, 'viewer'),
  expected: VIEWER,
});
c('role-unknown-name', {
  rules: BT(['role:boss']),
  principal: P('ks1', 'engineer'),
  expected: BT_DENIED_OP,
});
c('role-administrator-grantee', {
  rules: BT(['role:administrator']),
  principal: P('ks1', 'engineer'),
  expected: BT_DENIED_OP,
});

// ---------- người nhận trộn ----------
c('mixed-grantees-none', {
  rules: BT(['user:ks1', 'group:bao-tri', 'role:engineer']),
  principal: P('vh1', 'operator', ['ca-a']),
  expected: BT_DENIED_OP,
});
c('mixed-grantees-role', {
  rules: BT(['user:ks1', 'group:bao-tri', 'role:engineer']),
  principal: P('ks2', 'engineer'),
  expected: OPERATOR,
});

// ---------- `grantees: []` ----------
c('empty-grantees-engineer', {
  rules: BT([]),
  principal: P('ks1', 'engineer'),
  expected: BT_DENIED_OP,
});
c('empty-grantees-administrator', {
  rules: BT([]),
  principal: P('admin', 'administrator'),
  expected: ADMIN,
});
c('empty-grantees-page-watch', {
  rules: [R('page:watch', 'view', [])],
  principal: P('ks1', 'engineer'),
  expected: { ...OPERATOR, pages: PAGES3 },
});

// ---------- sàn vai trò: viewer không bao giờ operate ----------
c('floor-viewer-star-operate', {
  rules: [R('item:tong-quan/chay-bom', 'operate', ['*'])],
  principal: P('xem1', 'viewer'),
  expected: VIEWER,
});
c('floor-viewer-role-viewer-operate', {
  rules: [R('item:bom-1/dat-toc', 'operate', ['role:viewer'])],
  principal: P('xem1', 'viewer'),
  expected: VIEWER,
});
c('floor-viewer-user-operate', {
  rules: [R('item:bao-tri/reset', 'operate', ['user:xem1'])],
  principal: P('xem1', 'viewer'),
  expected: VIEWER,
});

// ---------- quy tắc operate ----------
c('operate-rule-denied', {
  rules: [R('item:tong-quan/chay-bom', 'operate', ['group:quan-doc'])],
  principal: P('vh1', 'operator', ['ca-a']),
  expected: { ...OPERATOR, lockedItems: { 'tong-quan': ['chay-bom'] } },
});
c('operate-rule-allowed', {
  rules: [R('item:tong-quan/chay-bom', 'operate', ['group:quan-doc'])],
  principal: P('vh1', 'operator', ['quan-doc']),
  expected: OPERATOR,
});
c('operate-rule-popup-empty', {
  rules: [R('item:popup-bom/chay', 'operate', [])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, lockedItems: { 'popup-bom': ['chay'] } },
});

// ---------- mặc định project cao hơn quy tắc ----------
c('default-higher-screen-rule', {
  catalog: (cat) => (screenOf(cat, 'bao-tri').view = 'engineer'),
  rules: BT(['group:bao-tri']),
  principal: P('vh1', 'operator', ['bao-tri']),
  expected: BT_DENIED_OP,
});
c('default-higher-screen-engineer', {
  catalog: (cat) => (screenOf(cat, 'bao-tri').view = 'engineer'),
  rules: BT(['group:bao-tri']),
  principal: P('ks1', 'engineer', ['bao-tri']),
  expected: OPERATOR,
});
c('default-higher-screen-no-rule', {
  catalog: (cat) => (screenOf(cat, 'bao-tri').view = 'engineer'),
  principal: P('vh1', 'operator'),
  expected: BT_DENIED_OP,
});
c('default-higher-screen-administrator-only', {
  catalog: (cat) => (screenOf(cat, 'bao-tri').view = 'administrator'),
  rules: BT(['*']),
  principal: P('ks1', 'engineer'),
  expected: BT_DENIED_OP,
});
c('default-higher-item-operate', {
  catalog: (cat) => (itemOf(cat, 'bom-1', 'dat-toc').operate = 'engineer'),
  rules: [R('item:bom-1/dat-toc', 'operate', ['*'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, lockedItems: { 'bom-1': ['dat-toc'] } },
});
c('default-higher-item-operate-group', {
  catalog: (cat) => (itemOf(cat, 'bao-tri', 'reset').operate = 'engineer'),
  rules: [R('item:bao-tri/reset', 'operate', ['group:bao-tri'])],
  principal: P('vh1', 'operator', ['bao-tri']),
  expected: { ...OPERATOR, lockedItems: { 'bao-tri': ['reset'] } },
});
c('default-higher-item-view', {
  catalog: (cat) => (itemOf(cat, 'tong-quan', 'chi-phi').view = 'engineer'),
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    hiddenItems: { 'tong-quan': ['chi-phi'] },
    liveTags: without(ITEM_TAGS, 'COST.TODAY'),
    historyTags: without(ALL_HIST, 'COST.TODAY'),
  },
});
c('default-higher-item-view-engineer', {
  catalog: (cat) => (itemOf(cat, 'tong-quan', 'chi-phi').view = 'engineer'),
  principal: P('ks1', 'engineer'),
  expected: OPERATOR,
});
c('default-higher-popup', {
  catalog: (cat) => (screenOf(cat, 'popup-bom').view = 'engineer'),
  principal: P('vh1', 'operator'),
  expected: POPUP_DENIED_OP,
});

// ---------- page:watch mặc định operator ----------
c('page-watch-viewer-star', {
  rules: [R('page:watch', 'view', ['*'])],
  principal: P('xem1', 'viewer'),
  expected: VIEWER,
});
c('page-watch-operator-group-no-match', {
  rules: [R('page:watch', 'view', ['group:ca-a'])],
  principal: P('vh1', 'operator', ['ca-b']),
  expected: { ...OPERATOR, pages: PAGES3 },
});

// ---------- cha: màn hình, item ----------
c('item-view-rule-hides', {
  rules: [R('item:tong-quan/chi-phi', 'view', ['group:ke-toan'])],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    hiddenItems: { 'tong-quan': ['chi-phi'] },
    liveTags: without(ITEM_TAGS, 'COST.TODAY'),
    historyTags: without(ALL_HIST, 'COST.TODAY'),
  },
});
c('item-hidden-operable-not-locked', {
  // PUMP01.RUN_CMD vẫn được phép: popup-bom/chay dùng nó
  rules: [R('item:tong-quan/chay-bom', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, hiddenItems: { 'tong-quan': ['chay-bom'] } },
});
c('item-hidden-viewer-not-locked', {
  rules: [R('item:tong-quan/chay-bom', 'view', ['group:khach'])],
  principal: P('xem1', 'viewer'),
  expected: {
    ...VIEWER,
    hiddenItems: { 'tong-quan': ['chay-bom'] },
    lockedItems: omit(LOCKED_ALL, 'tong-quan'),
  },
});
c('item-operate-needs-view', {
  rules: [
    R('item:tong-quan/chay-bom', 'view', ['group:khach']),
    R('item:tong-quan/chay-bom', 'operate', ['*']),
  ],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, hiddenItems: { 'tong-quan': ['chay-bom'] } },
});
c('screen-denied-items-gone', {
  // item của màn hình bị cấm không vào hiddenItems và không cấp Tag, dù có quy tắc item cho phép
  rules: [R('screen:bom-1', 'view', ['group:khach']), R('item:bom-1/den', 'view', ['*'])],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    screens: ['tong-quan', 'bao-tri', 'popup-bom'],
    liveTags: without(ITEM_TAGS, 'PUMP01.SPEED_SP'),
    historyTags: without(ALL_HIST, 'PUMP01.SPEED_SP'),
  },
});
c('screen-denied-viewer-not-locked', {
  rules: [R('screen:bom-1', 'view', ['group:khach'])],
  principal: P('xem1', 'viewer'),
  expected: {
    ...VIEWER,
    screens: ['tong-quan', 'bao-tri', 'popup-bom'],
    lockedItems: omit(LOCKED_ALL, 'bom-1'),
    liveTags: without(ITEM_TAGS, 'PUMP01.SPEED_SP'),
    historyTags: without(ALL_HIST, 'PUMP01.SPEED_SP'),
  },
});
c('item-view-default-operator-viewer', {
  // PUMP01.RUN vẫn được phép: popup-bom/nhan dùng nó
  catalog: (cat) => (itemOf(cat, 'bom-1', 'den').view = 'operator'),
  principal: P('xem1', 'viewer'),
  expected: { ...VIEWER, hiddenItems: { 'bom-1': ['den'] } },
});
c('all-items-of-screen-hidden', {
  rules: [R('item:bom-1/den', 'view', []), R('item:bom-1/dat-toc', 'view', [])],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    hiddenItems: { 'bom-1': ['dat-toc', 'den'] },
    liveTags: without(ITEM_TAGS, 'PUMP01.SPEED_SP'),
    historyTags: without(ALL_HIST, 'PUMP01.SPEED_SP'),
  },
});

// ---------- popup ----------
c('popup-denied-shared-tags', {
  rules: [R('screen:popup-bom', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: POPUP_DENIED_OP,
});
c('popup-allowed-viewer', {
  rules: [R('screen:popup-bom', 'view', ['role:viewer'])],
  principal: P('xem1', 'viewer'),
  expected: VIEWER,
});

// ---------- item không operable, mồ côi ----------
c('non-operable-operate-rule-orphan', {
  rules: [R('item:tong-quan/muc-be', 'operate', ['*'])],
  principal: P('xem1', 'viewer'),
  expected: { ...VIEWER, orphans: [O('item:tong-quan/muc-be', 'operate')] },
});
c('orphans-missing-resources', {
  rules: [
    R('screen:khong-co', 'view', ['*']),
    R('item:tong-quan/khong-co', 'operate', ['*']),
    R('history:khong-co', 'view', []),
    R('report:khong-co', 'view', []),
  ],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    orphans: [
      O('history:khong-co', 'view'),
      O('item:tong-quan/khong-co', 'operate'),
      O('report:khong-co', 'view'),
      O('screen:khong-co', 'view'),
    ],
  },
});
c('orphans-bad-level-and-page', {
  rules: [
    R('page:admin', 'view', ['*']),
    R('page:khac', 'view', ['*']),
    R('screen:tong-quan', 'operate', ['*']),
    R('history:ap-suat', 'operate', []),
  ],
  principal: P('xem1', 'viewer'),
  expected: {
    ...VIEWER,
    orphans: [
      O('history:ap-suat', 'operate'),
      O('page:admin', 'view'),
      O('page:khac', 'view'),
      O('screen:tong-quan', 'operate'),
    ],
  },
});
c('orphan-item-of-other-screen', {
  // chay-bom có ở tong-quan, không có ở bom-1
  rules: [R('item:bom-1/chay-bom', 'view', [])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, orphans: [O('item:bom-1/chay-bom', 'view')] },
});

// ---------- trang hệ thống, alarm ----------
c('page-alarms-denied', {
  // alarm vẫn tính theo Tag (widget alarm trên màn hình); chỉ trang Alarm bị cấm
  rules: [R('page:alarms', 'view', ['role:engineer'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, pages: ['history', 'reports', 'watch'] },
});
c('page-alarms-anonymous-star', {
  rules: [R('page:alarms', 'view', ['*'])],
  principal: P(null, 'viewer'),
  expected: { ...VIEWER, pages: ['history', 'reports'] },
});
c('alarm-source-item-hidden', {
  rules: [R('item:bao-tri/gio-chay', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    hiddenItems: { 'bao-tri': ['gio-chay'] },
    liveTags: without(ITEM_TAGS, 'PUMP01.HOURS'),
    historyTags: without(ALL_HIST, 'PUMP01.HOURS'),
    alarms: ['a-bom', 'a-luu', 'a-muc'],
  },
});

// ---------- nhóm lưu trữ, mẫu báo cáo ----------
c('history-page-denied', {
  rules: [R('page:history', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, pages: ['alarms', 'reports', 'watch'], historyTags: HIST_REPORTS_ONLY },
});
c('reports-page-denied', {
  rules: [R('page:reports', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: {
    ...OPERATOR,
    pages: ['alarms', 'history', 'watch'],
    historyTags: without(ALL_HIST, 'E2'),
  },
});
c('history-group-denied', {
  // TANK.LEVEL của nhóm ap-suat vẫn được: tong-quan/muc-be dùng nó
  rules: [R('history:ap-suat', 'view', ['group:khach'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, historyTags: without(ALL_HIST, 'P1') },
});
c('report-denied-tag-kept-by-group', {
  // E1 vẫn được qua nhóm nang-luong
  rules: [R('report:dien-ngay', 'view', ['user:khac'])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, historyTags: without(ALL_HIST, 'E2') },
});
c('history-group-and-report-denied', {
  rules: [R('history:nang-luong', 'view', []), R('report:dien-ngay', 'view', [])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, historyTags: without(ALL_HIST, 'E1', 'E2') },
});
c('history-group-allowed-page-denied', {
  // quy tắc nhóm cho phép nhưng trang Lịch sử bị cấm: nhóm không cấp Tag
  rules: [R('history:ap-suat', 'view', ['*']), R('page:history', 'view', [])],
  principal: P('vh1', 'operator'),
  expected: { ...OPERATOR, pages: ['alarms', 'reports', 'watch'], historyTags: HIST_REPORTS_ONLY },
});
c('both-history-pages-denied-viewer', {
  rules: [R('page:history', 'view', ['group:khach']), R('page:reports', 'view', ['group:khach'])],
  principal: P('xem1', 'viewer'),
  expected: { ...VIEWER, pages: ['alarms'], historyTags: ITEM_TAGS },
});
c('history-page-anonymous-star', {
  rules: [R('page:history', 'view', ['*'])],
  principal: P(null, 'viewer'),
  expected: { ...VIEWER, pages: ['alarms', 'reports'], historyTags: HIST_REPORTS_ONLY },
});

// ---------- administrator ----------
c('admin-ignores-rules', {
  rules: [
    R('screen:bao-tri', 'view', []),
    R('page:watch', 'view', []),
    R('item:tong-quan/chay-bom', 'operate', []),
    R('history:ap-suat', 'view', []),
    R('screen:khong-co', 'view', ['*']),
  ],
  principal: P('admin', 'administrator'),
  expected: { ...ADMIN, orphans: [O('screen:khong-co', 'view')] },
});
c('admin-ignores-project-defaults', {
  catalog: (cat) => {
    screenOf(cat, 'bao-tri').view = 'administrator';
    itemOf(cat, 'bom-1', 'dat-toc').operate = 'administrator';
  },
  principal: P('admin', 'administrator'),
  expected: ADMIN,
});

// ======================================================================================
// Ghi
// ======================================================================================

if (CASES.length < 40) throw new Error(`cần ít nhất 40 ca, có ${CASES.length}`);

for (const d of readdirSync(here)) {
  const p = join(here, d);
  if (statSync(p).isDirectory()) rmSync(p, { recursive: true });
}

const json = (v) => JSON.stringify(v, null, 2) + '\n';
for (const k of CASES) {
  const dir = join(here, k.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'catalog.json'), json(k.catalog));
  writeFileSync(
    join(dir, 'access.json'),
    json({ schemaVersion: '1.0.0', rev: 1, groups: GROUPS, rules: k.rules }),
  );
  writeFileSync(join(dir, 'principal.json'), json(k.principal));
  const e = k.expected;
  writeFileSync(
    join(dir, 'expected.json'),
    json({
      screens: e.screens,
      hiddenItems: e.hiddenItems,
      lockedItems: e.lockedItems,
      pages: e.pages,
      admin: e.admin,
      liveTags: e.liveTags,
      historyTags: e.historyTags,
      alarms: e.alarms,
      orphans: e.orphans,
    }),
  );
}
console.log(`${CASES.length} ca trong ${here}`);
