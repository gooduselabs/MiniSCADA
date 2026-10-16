// Project mẫu 1.0 cho e2e faceplate (feature 011, T170; FR-123, FR-125; contracts/project-format-1.0.md §5): một popup
// có tham số `bom-chi-tiet` (prefix kiểu tagPrefix, title kiểu string) mở từ 20 nút bơm (args PUMP01…PUMP20) trên màn
// hình `tram-bom`; thêm một nút trỏ PUMP99 (Tag không có trong project) và một nút có args sai dạng. Dựa trên dashboard().
import { dashboard } from './fixture-project.mjs';

export const PUMP_COUNT = 20;
export const pumpId = (n) => `PUMP${String(n).padStart(2, '0')}`;
/** Lưu lượng giả của bơm n (khác nhau để phân biệt bơm trong popup). */
export const flowOf = (n) => 10 + n + 0.5;

const tag = (id, type, extra = {}) => ({ id, type, kind: 'external', access: 'R', ...extra });
const w = (id, widget, x, y, width, height, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  x,
  y,
  width,
  height,
  ...extra,
});
const openBtn = (id, label, x, y, args) =>
  w(id, 'button', x, y, 170, 48, {
    props: { label, variant: 'neutral' },
    events: { click: { action: 'popup', screen: 'bom-chi-tiet', args } },
  });

export function faceplateDemo() {
  const base = dashboard();
  const pumps = Array.from({ length: PUMP_COUNT }, (_, i) => i + 1);
  const tags = [
    ...base.active.tags.tags,
    ...pumps.flatMap((n) => [
      tag(`${pumpId(n)}.FLOW`, 'FLOAT32', { description: `Lưu lượng bơm ${n}`, unit: 'm3/h' }),
      tag(`${pumpId(n)}.RUN`, 'BOOL', { description: `Bơm ${n} chạy` }),
    ]),
  ];
  const station = {
    schemaVersion: '1.0.0',
    id: 'tram-bom',
    name: 'Trạm 20 bơm',
    kind: 'screen',
    size: { width: 1000, height: 400 },
    items: [
      ...pumps.map((n) =>
        openBtn(`b${n}`, `Bơm ${n}`, 20 + ((n - 1) % 5) * 190, 20 + Math.floor((n - 1) / 5) * 64, {
          prefix: pumpId(n),
          title: `Bơm ${n}`,
        }),
      ),
      openBtn('b99', 'Bơm 99', 20, 300, { prefix: 'PUMP99', title: 'Bơm 99' }),
      openBtn('bad', 'Bơm lỗi', 210, 300, { prefix: 'PUMP 01' }),
      w('level', 'card', 400, 280, 220, 100, {
        props: { label: 'Mức bồn' },
        tags: { value: 'TANK01.LEVEL' },
      }),
    ],
  };
  const popup = {
    schemaVersion: '1.0.0',
    id: 'bom-chi-tiet',
    name: 'Chi tiết bơm',
    kind: 'popup',
    size: { width: 640, height: 300 },
    params: [
      { name: 'prefix', kind: 'tagPrefix' },
      { name: 'title', kind: 'string', default: 'Bơm' },
    ],
    items: [
      w('flow', 'card', 20, 20, 280, 120, {
        props: { label: '{title} lưu lượng' },
        tags: { value: '{prefix}.FLOW' },
      }),
      w('run', 'lamp', 340, 20, 200, 120, {
        props: { label: '{title} chạy' },
        tags: { state: '{prefix}.RUN' },
      }),
    ],
  };
  const files = new Map(base.files);
  files.set('screens/tram-bom.screen.json', { json: station });
  files.set('screens/bom-chi-tiet.screen.json', { json: popup });
  const nav = {
    position: 'left',
    items: [{ label: 'Trạm bơm', screen: 'tram-bom', icon: 'pump' }],
  };
  return {
    active: {
      ...base.active,
      project: {
        ...base.active.project,
        schemaVersion: '1.0.0',
        entryScreen: 'tram-bom',
        navigation: nav,
      },
      tags: { schemaVersion: '1.0.0', tags },
      navigation: nav,
      screens: [
        {
          id: 'tram-bom',
          name: station.name,
          kind: 'screen',
          file: 'screens/tram-bom.screen.json',
        },
        {
          id: 'bom-chi-tiet',
          name: popup.name,
          kind: 'popup',
          file: 'screens/bom-chi-tiet.screen.json',
        },
      ],
      digest: 'sha256:e2e-faceplate',
    },
    files,
  };
}
