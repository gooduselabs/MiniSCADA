/* global location */
// Fixture e2e feature 041: màn hình lưới có Bảng alarm kiểu Đầy đủ, Gọn và Lịch sử; menu theo tham số (đích chuông).
import { dashboard } from './fixture-project.mjs';

const grid = (id, name, cells, items) => ({
  schemaVersion: '1.1.0',
  id,
  name,
  kind: 'screen',
  size: { width: 1920, height: 1080 },
  layout: {
    mode: 'grid',
    columns: 12,
    gap: 12,
    padding: 16,
    rows: [{ id: 'r1', height: 'auto', cells }],
  },
  items,
});

const SCREENS = [
  grid(
    'bang-full',
    'Bảng alarm',
    [{ id: 'c1', span: 12, item: 'al_full' }],
    [{ id: 'al_full', type: 'widget', widget: 'alarm-list', props: { mode: 'full' } }],
  ),
  grid(
    'tq-gon',
    'Tổng quan alarm',
    [{ id: 'c1', span: 6, item: 'al_gon' }],
    [{ id: 'al_gon', type: 'widget', widget: 'alarm-list', props: { maxRows: 5 } }],
  ),
  grid(
    'lich-su',
    'Lịch sử',
    [{ id: 'c1', span: 12, item: 'al_hist' }],
    [
      {
        id: 'al_hist',
        type: 'widget',
        widget: 'alarm-list',
        props: { mode: 'full', source: 'history' },
      },
    ],
  ),
];

/** Project dashboard + 3 màn hình trên; `navItems`: mục menu (mặc định mọi màn hình). */
export function alarmListProject(navItems) {
  const base = dashboard();
  for (const s of SCREENS) base.files.set(`screens/${s.id}.screen.json`, { json: s });
  const nav = {
    position: 'left',
    items: navItems ?? [
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Tổng quan alarm', screen: 'tq-gon' },
      { label: 'Bảng alarm', screen: 'bang-full' },
      { label: 'Lịch sử', screen: 'lich-su' },
    ],
  };
  const a = base.active;
  return {
    active: {
      ...a,
      project: { ...a.project, schemaVersion: '1.1.0', projectId: 'alarm-041', navigation: nav },
      navigation: nav,
      screens: [
        ...a.screens,
        ...SCREENS.map((s) => ({
          id: s.id,
          name: s.name,
          kind: 'screen',
          file: `screens/${s.id}.screen.json`,
        })),
      ],
      digest: 'sha256:e2e-alarm-041',
    },
    files: base.files,
  };
}

export const ALARMS = () => [
  [
    'TANK.HH',
    { class: 'critical', area: 'bon', text: 'Mức bồn rất cao', tsActive: Date.now() - 9000 },
  ],
  ['PUMP.F', { class: 'major', area: null, text: 'Bơm lỗi', tsActive: Date.now() - 8000 }],
  [
    'VOLT.L',
    {
      class: 'minor',
      area: 'dien',
      text: 'Điện áp thấp',
      tsActive: Date.now() - 7000,
      state: 'ACTIVE_ACK',
    },
  ],
  [
    'FAN.S',
    {
      class: 'minor',
      area: 'dien',
      text: 'Quạt tạm ẩn',
      tsActive: Date.now() - 6000,
      shelved: {
        until: Date.now() + 3_600_000,
        remainingMs: 3_600_000,
        reason: 'bảo trì',
        user: 'vanhanh1',
        system: false,
      },
    },
  ],
];

export function historyRows(now) {
  const rows = [];
  for (let id = 30; id >= 1; id--) {
    const tsActive = now - (31 - id) * 60_000;
    rows.push({
      id,
      alarmId: `AL_${id}`,
      name: `Alarm ${id}`,
      class: 'major',
      priority: id % 2 ? 'major' : 'minor',
      area: id % 3 ? 'bon' : 'dien',
      text: `Sự kiện lịch sử ${id}`,
      valueActive: true,
      qualityActive: 'GOOD',
      reason: null,
      tsActive,
      clockOk: true,
      tsAck: tsActive + 1000,
      ackUser: 'vanhanh1',
      tsReturn: tsActive + 30_000,
      tsReturnAck: null,
      returnAckUser: null,
      flags: { startup: false, inputBad: false },
      closedBy: 'return',
      state: 'closed',
    });
  }
  return rows;
}

/** Mở trang (https) và chờ trực tuyến. */
export async function open(ctx, hash) {
  const { page } = ctx;
  await page.goto('about:blank');
  await page.goto(`${ctx.httpsUrl}/${hash}`, { waitUntil: 'domcontentloaded' });
}

/** Mở chuông và bấm "Xem tất cả alarm"; trả hash sau khi đổi. */
export async function bellViewAll(ctx, until) {
  const { page } = ctx;
  await page.waitForSelector('#app-alarm-bell-btn');
  await page.click('#app-alarm-bell-btn');
  await page.waitForSelector('#app-alarm-panel .al-panel-viewall', { visible: true });
  const before = await page.evaluate(() => location.hash);
  await page.click('#app-alarm-panel .al-panel-viewall');
  await until(
    async () => (await page.evaluate(() => location.hash)) !== before,
    'đổi trang sau Xem tất cả',
  ).catch(() => undefined);
  return page.evaluate(() => location.hash);
}

export const currentMenu = (page) =>
  page.$eval('#app-nav button[aria-current="page"]', (b) => b.textContent.trim()).catch(() => null);
