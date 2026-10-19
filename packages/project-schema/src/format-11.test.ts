// Ghi tệp màn hình 1.1 (feature 012, T014; contracts/project-format-1.1.md §2): `layout` sau `background`, trước
// `params`, `items`; mỗi hàng một dòng gọn; ô bỏ `offset: 0` và `align: "stretch"`; item lưới không có tọa độ.
import { describe, expect, it } from 'vitest';
import { formatScreen03 } from './format-03.ts';
import type { ScreenModel } from './types-03.ts';

const grid = () =>
  ({
    schemaVersion: '1.1.0',
    id: 'tong-quan',
    name: 'Tổng quan',
    size: { width: 1920, height: 1080 },
    background: '#ffffff',
    layout: {
      rows: [
        {
          cells: [
            { item: 'a', span: 4, id: 'c1', offset: 0, align: 'stretch' },
            { id: 'c2', span: 6, offset: 2, align: 'center', minHeight: 200 },
          ],
          height: 'auto',
          id: 'r1',
        },
        { id: 'r2', height: 320, gap: 8, cells: [{ id: 'c3', span: 12 }] },
      ],
      padding: 16,
      columns: 12,
      mode: 'grid',
      gap: 12,
    },
    items: [{ id: 'a', type: 'widget', widget: 'card', tags: { value: 'T.A' } }],
  }) as unknown as ScreenModel;

describe('formatScreen03 với layout (1.1)', () => {
  it('ghi layout đúng chỗ, thứ tự khóa chuẩn, bỏ giá trị mặc định của ô', () => {
    expect(formatScreen03(grid())).toBe(
      [
        '{',
        '  "schemaVersion": "1.1.0",',
        '  "id": "tong-quan",',
        '  "name": "Tổng quan",',
        '  "size": {"width":1920,"height":1080},',
        '  "background": "#ffffff",',
        '  "layout": {',
        '    "mode": "grid",',
        '    "columns": 12,',
        '    "gap": 12,',
        '    "padding": 16,',
        '    "rows": [',
        '      {"id":"r1","height":"auto","cells":[{"id":"c1","span":4,"item":"a"},{"id":"c2","span":6,"offset":2,"align":"center","minHeight":200}]},',
        '      {"id":"r2","height":320,"gap":8,"cells":[{"id":"c3","span":12}]}',
        '    ]',
        '  },',
        '  "items": [',
        '    {"id":"a","type":"widget","widget":"card","tags":{"value":"T.A"}}',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('layout không hàng ghi "rows": []; màn hình tự do không có khóa layout', () => {
    const s = grid() as unknown as { layout: { rows: unknown[] } };
    s.layout.rows = [];
    expect(formatScreen03(s as unknown as ScreenModel)).toContain('    "rows": []\n  },');
    const free = grid() as unknown as Record<string, unknown>;
    delete free.layout;
    expect(formatScreen03(free as unknown as ScreenModel)).not.toContain('layout');
  });
});

// feature 013: vai trò tối thiểu (`security.view`, `security.operate`) của màn hình và item
describe('formatScreen03 với security (1.1, feature 013)', () => {
  const withSecurity = () =>
    ({
      schemaVersion: '1.1.0',
      id: 'bao-tri',
      name: 'Bảo trì',
      size: { width: 1920, height: 1080 },
      security: { view: 'engineer' },
      items: [
        {
          id: 'b',
          type: 'widget',
          widget: 'button',
          x: 0,
          y: 0,
          width: 120,
          height: 40,
          security: { minRole: 'engineer', operate: 'engineer', view: 'operator' },
        },
        {
          id: 'c',
          type: 'widget',
          widget: 'card',
          x: 0,
          y: 50,
          width: 120,
          height: 40,
          security: { view: 'viewer' },
        },
        {
          id: 's',
          type: 'svg',
          x: 0,
          y: 100,
          width: 100,
          height: 100,
          svgFile: 'screens/s.svg',
          bindingFile: 'screens/s.bindings.json',
          viewBox: [0, 0, 100, 100],
          elements: [],
          security: { operate: 'engineer', view: 'operator' },
        },
      ],
    }) as unknown as ScreenModel;

  it('ghi security của màn hình sau layout; item theo thứ tự view, operate, minRole', () => {
    const text = formatScreen03(withSecurity());
    expect(text).toContain(
      '  "size": {"width":1920,"height":1080},\n  "security": {"view":"engineer"},\n',
    );
    expect(text).toContain(
      '"security":{"view":"operator","operate":"engineer","minRole":"engineer"}}',
    );
    expect(text).toContain('"elements":[],"security":{"view":"operator","operate":"engineer"}}');
  });

  it('bỏ giá trị mặc định: view viewer, operate bằng mặc định danh mục', () => {
    const s = withSecurity() as unknown as {
      security: Record<string, string>;
      items: Array<{ security: Record<string, string> }>;
    };
    s.security = { view: 'viewer' };
    s.items[0].security = { operate: 'operator' };
    s.items[2].security = { view: 'viewer', operate: 'operator' };
    const text = formatScreen03(s as unknown as ScreenModel);
    expect(text).not.toContain('security');
  });
});
