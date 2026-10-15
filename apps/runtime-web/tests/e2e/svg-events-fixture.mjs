// Project mẫu 0.4 cho e2e sự kiện phần tử SVG (feature 008, T082; contract svg-events.md): màn hình `ev` có một item `svg`
// với sáu phần tử nhấp được (mở popup, chuyển màn hình, ghi có xác nhận, đảo không xác nhận, phần tử `fill="none"`, phần tử
// ẩn). Dựa trên dashboard() để dùng lại Tag (PUMP1.SPEED_SP, PUMP1.RUN_CMD), popup `pop-bom` và màn hình `bom1`.
import { dashboard } from './fixture-project.mjs';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
  <rect data-mat-uid="el_open" x="20" y="20" width="80" height="50" fill="#22c55e"/>
  <rect data-mat-uid="el_gotobom" x="120" y="20" width="80" height="50" fill="#3b82f6"/>
  <rect data-mat-uid="el_write" x="220" y="20" width="80" height="50" fill="#f59e0b"/>
  <rect data-mat-uid="el_toggle" x="20" y="100" width="80" height="50" fill="#a855f7"/>
  <rect data-mat-uid="el_nofill" x="120" y="100" width="80" height="50" fill="none" stroke="#e2e8f0" stroke-width="3"/>
  <rect data-mat-uid="el_hidden" x="220" y="100" width="80" height="50" fill="#ef4444" style="display:none"/>
</svg>`;

const BINDINGS = {
  schemaVersion: '0.4.0',
  screenId: 'ev',
  itemId: 'svg1',
  elements: [
    {
      elementUid: 'el_open',
      events: { click: { action: 'popup', screen: 'pop-bom', label: 'Mở cửa sổ bơm' } },
    },
    {
      elementUid: 'el_gotobom',
      events: { click: { action: 'navigate', screen: 'bom1', label: 'Sang màn hình bơm 1' } },
    },
    {
      elementUid: 'el_write',
      events: {
        click: {
          action: 'write',
          tag: 'PUMP1.SPEED_SP',
          value: 750,
          confirm: 'always',
          minRole: 'operator',
          label: 'Đặt tốc độ bơm 750',
        },
      },
    },
    {
      elementUid: 'el_toggle',
      events: {
        click: {
          action: 'toggle',
          tag: 'PUMP1.RUN_CMD',
          confirm: 'none',
          label: 'Đảo lệnh chạy bơm',
        },
      },
    },
    {
      elementUid: 'el_nofill',
      events: { click: { action: 'popup', screen: 'pop-bom', label: 'Mở cửa sổ từ vùng trống' } },
    },
    {
      elementUid: 'el_hidden',
      events: { click: { action: 'popup', screen: 'pop-bom', label: 'Phần tử ẩn' } },
    },
  ],
};

const UIDS = BINDINGS.elements.map((e) => e.elementUid);

export function svgEventsDemo() {
  const base = dashboard();
  const screen = {
    schemaVersion: '0.4.0',
    id: 'ev',
    name: 'Sự kiện SVG',
    kind: 'screen',
    size: { width: 800, height: 400 },
    background: '#0f172a',
    items: [
      {
        id: 'svg1',
        name: 'Đồ họa',
        type: 'svg',
        x: 0,
        y: 0,
        width: 800,
        height: 400,
        svgFile: 'screens/ev.svg',
        bindingFile: 'screens/ev.bindings.json',
        viewBox: [0, 0, 400, 200],
        fit: 'contain',
        elements: UIDS.map((elementUid) => ({ elementUid })),
      },
    ],
  };
  const files = new Map(base.files);
  files.set('screens/ev.screen.json', { json: screen });
  files.set('screens/ev.svg', { text: SVG, type: 'image/svg+xml' });
  files.set('screens/ev.bindings.json', { text: JSON.stringify(BINDINGS) });
  const nav = {
    position: 'left',
    items: [
      { label: 'Sự kiện SVG', screen: 'ev', icon: 'home' },
      { label: 'Bơm 1', screen: 'bom1', icon: 'pump' },
    ],
  };
  return {
    active: {
      ...base.active,
      project: {
        ...base.active.project,
        schemaVersion: '0.4.0',
        entryScreen: 'ev',
        navigation: nav,
      },
      navigation: nav,
      screens: [
        ...base.active.screens.filter((s) => s.id === 'bom1' || s.id === 'pop-bom'),
        { id: 'ev', name: 'Sự kiện SVG', kind: 'screen', file: 'screens/ev.screen.json' },
      ],
      digest: 'sha256:e2e-svg-events',
    },
    files,
  };
}
