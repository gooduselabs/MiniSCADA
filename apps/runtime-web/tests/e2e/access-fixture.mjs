// Project và kho quyền mẫu cho e2e của feature 013 (đăng nhập bắt buộc, phân quyền, trang Quản trị). Dựa trên gridDemo
// (012: màn hình lưới `luoi` + các màn hình của dashboard) thêm màn hình `chi-phi` (một thẻ dùng Tag ENERGY.COST, chỉ
// Quản đốc được xem) để thử "Không có nội dung bạn được xem" và "0 giá trị Tag bị cấm".
import { gridDemo } from './grid-fixture.mjs';

export const PASS = {
  quantri: 'quantri-mat-khau-2026',
  vh1: 'vh1-mat-khau-2026-ok',
  vh2: 'vh2-mat-khau-2026-ok',
  qd1: 'qd1-mat-khau-2026-ok',
  xem1: 'xem1-mat-khau-2026-ok',
  kt1: 'kt1-mat-khau-2026-ok',
};

export function accessDemo() {
  const base = gridDemo();
  const chiPhi = {
    schemaVersion: '1.1.0',
    id: 'chi-phi',
    name: 'Chi phí điện',
    kind: 'screen',
    size: { width: 800, height: 400 },
    items: [
      {
        id: 'tien',
        type: 'widget',
        widget: 'card',
        x: 20,
        y: 20,
        width: 260,
        height: 120,
        props: { label: 'Chi phí điện hôm nay', unit: 'đ' },
        tags: { value: 'ENERGY.COST' },
      },
    ],
  };
  base.files.set('screens/chi-phi.screen.json', { json: chiPhi });
  const a = base.active;
  a.screens = [
    ...a.screens,
    { id: 'chi-phi', name: chiPhi.name, kind: 'screen', file: 'screens/chi-phi.screen.json' },
  ];
  a.tags = {
    ...a.tags,
    tags: [
      ...a.tags.tags,
      {
        id: 'ENERGY.COST',
        type: 'FLOAT32',
        kind: 'external',
        access: 'R',
        description: 'Chi phí điện',
        unit: 'đ',
      },
    ],
  };
  a.navigation = {
    ...a.navigation,
    items: [...a.navigation.items, { label: 'Chi phí điện', screen: 'chi-phi', icon: 'bolt' }],
  };
  a.project.navigation = a.navigation;
  a.digest = 'sha256:e2e-access';
  return base;
}

/** Kho mẫu: một administrator, vận hành ca A, quản đốc, người xem, kỹ sư (đang khóa tạm), bốn nhóm, năm quy tắc. */
export function accessSeed(over = {}) {
  return {
    users: [
      {
        name: 'quantri',
        role: 'administrator',
        password: PASS.quantri,
        lastLoginAt: Date.now() - 3_600_000,
      },
      {
        name: 'vh1',
        role: 'operator',
        groups: ['ca-a'],
        password: PASS.vh1,
        lastLoginAt: Date.now() - 86_400_000,
      },
      { name: 'vh2', role: 'operator', groups: ['ca-a'], password: PASS.vh2 },
      { name: 'qd1', role: 'operator', groups: ['quan-doc', 'ca-a'], password: PASS.qd1 },
      { name: 'xem1', role: 'viewer', password: PASS.xem1 },
      {
        name: 'kt1',
        role: 'engineer',
        groups: ['bao-tri'],
        password: PASS.kt1,
        lockedUntil: Date.now() + 240_000,
      },
    ],
    groups: [
      { id: 'ca-a', name: 'Vận hành ca A' },
      { id: 'quan-doc', name: 'Quản đốc' },
      { id: 'bao-tri', name: 'Bảo trì' },
      { id: 'trong', name: 'Nhóm trống' },
    ],
    rules: [
      { resource: 'screen:bon-nuoc', level: 'view', grantees: ['group:bao-tri'] },
      { resource: 'item:luoi/toc_do', level: 'view', grantees: ['group:quan-doc'] },
      { resource: 'item:bom1/run', level: 'operate', grantees: ['group:quan-doc'] },
      { resource: 'item:chi-phi/tien', level: 'view', grantees: ['group:quan-doc'] },
      { resource: 'screen:da-xoa', level: 'view', grantees: ['group:ca-a'] },
    ],
    auditSeed: 12,
    ...over,
  };
}

/** Đăng nhập qua trang /login (đã mở sẵn), chờ chuyển về trang chính. */
export async function loginPage(page, user, pass) {
  await page.waitForSelector('input[autocomplete="username"]');
  await page.$eval('input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('input[autocomplete="username"]', user);
  await page.type('input[autocomplete="current-password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.keyboard.press('Enter'),
  ]);
}
