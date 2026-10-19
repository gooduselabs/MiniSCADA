// Project mẫu 1.1 cho e2e bố cục lưới (feature 012, T022; US2, FR-025 đến FR-028, SC-002): màn hình `luoi` có hàng
// 3+3+3+3 (thẻ, đèn), hàng 8+4 cao 300 px (biểu đồ đường, đồng hồ), hàng 12 (bảng Tag sống); chủ đề vivid. Dựa trên
// dashboard() (cùng Tag và giá trị giả của fake-runtime).
import { dashboard } from './fixture-project.mjs';

const w = (id, widget, tags, props) => ({
  id,
  type: 'widget',
  widget,
  ...(props ? { props } : {}),
  tags,
});

export const gridScreen = {
  schemaVersion: '1.1.0',
  id: 'luoi',
  name: 'Bảng điều khiển lưới',
  kind: 'screen',
  size: { width: 1920, height: 1080 },
  layout: {
    mode: 'grid',
    columns: 12,
    gap: 12,
    padding: 16,
    rows: [
      {
        id: 'r1',
        height: 'auto',
        cells: [
          { id: 'c1', span: 3, item: 'muc' },
          { id: 'c2', span: 3, item: 'luu_luong' },
          { id: 'c3', span: 3, item: 'toc_do' },
          { id: 'c4', span: 3, item: 'chay' },
        ],
      },
      {
        id: 'r2',
        height: 300,
        cells: [
          { id: 'c5', span: 8, item: 'xu_huong' },
          { id: 'c6', span: 4, item: 'dong_ho' },
        ],
      },
      { id: 'r3', height: 'auto', cells: [{ id: 'c7', span: 12, item: 'bang' }] },
    ],
  },
  items: [
    w('muc', 'card', { value: 'TANK01.LEVEL' }, { label: 'Mức bồn' }),
    w('luu_luong', 'card', { value: 'TANK01.INFLOW' }, { label: 'Lưu lượng vào' }),
    w('toc_do', 'card', { value: 'MOTOR01.SPEED' }, { label: 'Tốc độ bơm' }),
    w('chay', 'lamp', { state: 'MOTOR01.RUN' }, { label: 'Bơm chạy' }),
    w('xu_huong', 'line', { series: ['TANK01.LEVEL', 'TANK01.INFLOW'] }),
    w('dong_ho', 'gauge', { value: 'TANK01.LEVEL' }),
    w('bang', 'tag-table', {
      rows: ['TANK01.LEVEL', 'TANK01.INFLOW', 'MOTOR01.SPEED', 'TANK01.TEMP'],
    }),
  ],
};

export function gridDemo() {
  const base = dashboard();
  base.files.set('screens/luoi.screen.json', { json: gridScreen });
  const a = base.active;
  a.project = { ...a.project, schemaVersion: '1.1.0', entryScreen: 'luoi', theme: 'vivid' };
  a.screens = [
    { id: 'luoi', name: gridScreen.name, kind: 'screen', file: 'screens/luoi.screen.json' },
    ...a.screens,
  ];
  a.navigation = {
    ...a.navigation,
    items: [{ label: 'Lưới', screen: 'luoi', icon: 'home' }, ...a.navigation.items],
  };
  a.project.navigation = a.navigation;
  a.digest = 'sha256:e2e-grid';
  return base;
}
