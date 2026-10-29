/* global document */
// e2e (feature 040): cấu hình như project "Tủ SCADA SỐ 1": menu chỉ có màn hình người dùng, mục "Alarm" trỏ tới màn hình
// lưới có một widget `alarm-list` không props, hàng cao "auto", không đặt navigation.alarmBell. Một alarm đang báo chưa xác
// nhận phải hiện ngay trong bảng (có nút Xác nhận), bảng có chiều cao hợp lý, chuông hiện số và mở được danh sách alarm.
import { dashboard } from './fixture-project.mjs';
import { deepEval, until, waitDeep } from './util.mjs';

function tuScada() {
  const base = dashboard();
  const screen = {
    schemaVersion: '1.1.0',
    id: 'man-hinh-1',
    name: 'Alarm',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    layout: {
      mode: 'grid',
      columns: 12,
      gap: 12,
      padding: 16,
      rows: [{ id: 'r1', height: 'auto', cells: [{ id: 'c1', span: 12, item: 'alarm_list_1' }] }],
    },
    items: [{ id: 'alarm_list_1', type: 'widget', widget: 'alarm-list' }],
  };
  base.files.set('screens/man-hinh-1.screen.json', { json: screen });
  const nav = {
    position: 'left',
    items: [
      { label: 'Tổng quan', screen: 'tong-quan', icon: 'home' },
      { label: 'Alarm', screen: 'man-hinh-1', icon: 'bolt' },
    ],
  };
  const a = base.active;
  return {
    active: {
      ...a,
      project: {
        ...a.project,
        schemaVersion: '1.1.0',
        projectId: 'tu-scada-so-1',
        navigation: nav,
      },
      navigation: nav,
      screens: [
        ...a.screens,
        { id: 'man-hinh-1', name: 'Alarm', kind: 'screen', file: 'screens/man-hinh-1.screen.json' },
      ],
      digest: 'sha256:e2e-tu-scada',
    },
    files: base.files,
  };
}

export const options = { fixture: tuScada, config: { alarms: true }, drift: false };

const INNER = (code) =>
  `const t = els.find((e) => e.getRootNode() !== document); if (!t) return null; ${code}`;

export default async function run(ctx) {
  const { page, rt } = ctx;
  ctx.allowConsole.push('status of 401', 'status of 403');
  rt.alarm.reset([
    [
      'ALARM_001.H',
      {
        class: 'minor',
        area: null,
        name: 'ALARM_001',
        text: 'Nhiệt độ lò cao',
        tsActive: Date.now() - 5000,
      },
    ],
  ]);
  await page.goto(`${ctx.url}/#/man-hinh-1`, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-alarm-list', 1);
  let rows = null;
  try {
    await until(
      async () =>
        (
          (rows = await deepEval(
            page,
            'mat-alarm-table',
            INNER(
              "return [...t.shadowRoot.querySelectorAll('tbody tr[data-id]')].map((r) => r.dataset.id);",
            ),
          )) ?? []
        ).length === 1,
      'alarm-list có hàng',
    );
  } catch {
    /* kiểm bên dưới */
  }
  ctx.check(
    'alarm-list không props hiện alarm đang báo chưa xác nhận',
    JSON.stringify(rows) === '["ALARM_001.H"]',
    JSON.stringify(rows),
  );
  const h = await deepEval(
    page,
    'mat-w-alarm-list',
    'return els[0]?.getBoundingClientRect().height ?? 0;',
  );
  ctx.check(`bảng alarm trong hàng auto cao ≥ 200 px (đo ${h})`, h >= 200, String(h));
  const ack = await deepEval(
    page,
    'mat-alarm-table',
    INNER(
      "return [...t.shadowRoot.querySelectorAll('tbody button')].map((b) => b.textContent.trim()).join('|');",
    ),
  );
  ctx.check('có nút Xác nhận trên hàng', /Xác nhận/.test(ack ?? ''), String(ack));
  const bell = await page.evaluate(() => {
    const s = document.getElementById('app-alarm-slot');
    return s
      ? {
          hidden: s.hidden,
          text: s.textContent.replace(/\s+/g, ' ').trim(),
          html: s.innerHTML.length,
        }
      : null;
  });
  ctx.check(
    'chuông alarm hiện (mặc định khi project có alarm)',
    !!bell && !bell.hidden && bell.html > 0,
    JSON.stringify(bell),
  );
  const list = await deepEval(
    page,
    'mat-w-alarm-list',
    "return [...els[0].shadowRoot.querySelectorAll('.bar button')].map((b) => b.textContent.trim()).join('|');",
  );
  ctx.check('thanh công cụ có Xác nhận tất cả', /Xác nhận tất cả/.test(list ?? ''), String(list));
  const badge = await page.$eval('.al-bell-badge', (e) => (e.hidden ? '' : e.textContent.trim()));
  ctx.check('chuông hiện số alarm chưa xác nhận (1)', badge === '1', badge);
  await page.click('#app-alarm-bell-btn');
  await until(
    async () =>
      await page.$eval(
        '#app-alarm-panel',
        (e) => !e.hidden && /Nhiệt độ lò cao/.test(e.textContent),
      ),
    'bảng chuông có alarm',
  );
  ctx.check('bấm chuông mở danh sách alarm dù menu không có trang Alarm hệ thống', true);
}
