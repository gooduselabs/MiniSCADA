// Project mẫu 0.4 cho e2e hoạt ảnh (feature 008, T067): một màn hình SVG có mọi đích hoạt ảnh. Dựa trên dashboard()
// (Tag, bảng giá trị, điều hướng) nhưng màn hình vào là `anim`, đồ họa và binding nằm ngay trong file này.
import { dashboard } from './fixture-project.mjs';

/** Tag dùng: TANK01.LEVEL (0-100), TANK01.INFLOW, MOTOR01.RUN (BOOL), MOTOR01.SPEED (rpm), TANK01.SP,
 *  TANK02.SP, TANK03.SP, PUMP1.SPEED_SP (số ghi được: test đặt giá trị bằng rt.setValue). */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <g transform="translate(20 20)"><path data-mat-uid="el_curve" d="M0 100 C 0 0 100 0 100 100 Z" fill="#ef4444"/></g>
  <g data-mat-uid="el_group" transform="translate(150 20)">
    <rect x="0" y="0" width="50" height="100" fill="#3b82f6"/>
    <rect x="60" y="0" width="50" height="100" fill="#22c55e"/>
  </g>
  <g data-mat-uid="el_needle" transform="translate(300 150)">
    <line x1="0" y1="0" x2="0" y2="-60" stroke="#ffffff" stroke-width="4"/>
  </g>
  <rect data-mat-uid="el_mover" transform="translate(50 250)" x="0" y="0" width="20" height="20" fill="#f59e0b"/>
  <rect data-mat-uid="el_scaler" x="100" y="250" width="20" height="20" fill="#a855f7"/>
  <rect data-mat-uid="el_xfrot" transform="translate(250 250)" x="0" y="0" width="30" height="30" fill="#14b8a6"/>
  <circle data-mat-uid="el_blink" cx="360" cy="30" r="14" fill="#ef4444"/>
  <path data-mat-uid="el_pipe" d="M20 200 L 200 200" stroke="#38bdf8" stroke-width="6" fill="none"/>
  <g data-mat-uid="el_fan" transform="translate(300 60)">
    <circle cx="0" cy="0" r="30" fill="none" stroke="#94a3b8" stroke-width="2"/>
    <line x1="0" y1="0" x2="25" y2="0" stroke="#e2e8f0" stroke-width="4"/>
  </g>
</svg>`;

const direct = { kind: 'direct' };
const tag = (tagId) => ({ type: 'tag', tagId });
const b = (id, target, tagId, extra = {}) => ({
  id,
  target,
  source: tag(tagId),
  transform: direct,
  ...extra,
});
const pct = (inMax) => ({
  kind: 'linearScale',
  inMin: 0,
  inMax,
  outMin: 0,
  outMax: 100,
  clamp: true,
});

const BINDINGS = {
  schemaVersion: '0.4.0',
  screenId: 'anim',
  itemId: 'svg1',
  elements: [
    { elementUid: 'el_curve', bindings: [b('c1', 'geometry.clipLevel', 'TANK01.LEVEL')] },
    {
      elementUid: 'el_group',
      bindings: [
        b('c2', 'geometry.clipLevel', 'TANK01.INFLOW', { transform: pct(20), direction: 'right' }),
      ],
    },
    {
      elementUid: 'el_needle',
      bindings: [b('n1', 'transform.rotate', 'TANK01.SP', { pivot: [0.5, 1] })],
    },
    { elementUid: 'el_mover', bindings: [b('m1', 'transform.translateX', 'TANK02.SP')] },
    {
      elementUid: 'el_scaler',
      bindings: [b('s1', 'transform.scale', 'TANK03.SP', { pivot: [0, 0] })],
    },
    { elementUid: 'el_xfrot', bindings: [b('x1', 'transform.rotate', 'PUMP1.SPEED_SP')] },
    {
      elementUid: 'el_blink',
      bindings: [b('k1', 'effect.blink', 'MOTOR01.RUN', { period: 400 })],
    },
    { elementUid: 'el_pipe', bindings: [b('f1', 'effect.flow', 'MOTOR01.RUN')] },
    {
      elementUid: 'el_fan',
      bindings: [b('p1', 'transform.rotate', 'MOTOR01.SPEED', { animation: 'spin' })],
    },
  ],
};

const UIDS = BINDINGS.elements.map((e) => e.elementUid);

const NAV = { position: 'left', items: [{ label: 'Hoạt ảnh', screen: 'anim', icon: 'home' }] };

export function animDemo() {
  const base = dashboard();
  const screen = {
    schemaVersion: '0.3.0',
    id: 'anim',
    name: 'Hoạt ảnh',
    kind: 'screen',
    size: { width: 800, height: 600 },
    background: '#0f172a',
    items: [
      {
        id: 'svg1',
        name: 'Đồ họa',
        type: 'svg',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        svgFile: 'screens/anim.svg',
        bindingFile: 'screens/anim.bindings.json',
        viewBox: [0, 0, 400, 300],
        fit: 'contain',
        elements: UIDS.map((elementUid) => ({ elementUid })),
      },
    ],
  };
  const files = new Map(base.files);
  files.set('screens/anim.screen.json', { json: screen });
  files.set('screens/anim.svg', { text: SVG, type: 'image/svg+xml' });
  files.set('screens/anim.bindings.json', { text: JSON.stringify(BINDINGS) });
  return {
    active: {
      ...base.active,
      project: { ...base.active.project, entryScreen: 'anim', navigation: NAV },
      navigation: NAV,
      screens: [{ id: 'anim', name: 'Hoạt ảnh', kind: 'screen', file: 'screens/anim.screen.json' }],
      digest: 'sha256:e2e-anim',
    },
    files,
  };
}
