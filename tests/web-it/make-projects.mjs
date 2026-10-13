// Sinh project đo tải của web-it (feature 007, T133, SC-002, SC-003): `tests/web-it/projects/big-250`:
//   node tests/web-it/make-projects.mjs
// 100 Tag mô phỏng tất định (không cần giả lập Modbus) và hai màn hình:
//   chuan: màn hình chuẩn của SC-002 (20 widget, 100 Tag: 10 bảng Tag × 10 dòng + 10 card);
//   lon:   250 item (card, nhãn, đèn, đồng hồ) trên 100 Tag: ngưỡng của FR-010;
//   graf:  8 biểu đồ đường x 8 đường (SC-017).
// Đầu ra được commit; chạy lại cho cùng từng byte.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProject03, formatScreen03, formatTagsFile } from '@mat/project-schema';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'projects/big-250');
const V = '0.3.0';

const tags = [];
for (let i = 1; i <= 100; i++) {
  const id = `S.T${String(i).padStart(3, '0')}`;
  tags.push({
    id,
    kind: 'simulation',
    type: 'FLOAT32',
    unit: i % 2 ? '°C' : 'bar',
    min: 0,
    max: 100,
    sim: { kind: 'sine', center: 50, amplitude: 10 + (i % 30), periodMs: 5000 + i * 100 },
  });
}
const tagIds = tags.map((t) => t.id);

const item = (id, widget, x, y, w, h, props, slots) => ({
  id,
  name: id,
  type: 'widget',
  widget,
  x,
  y,
  width: w,
  height: h,
  ...(props ? { props } : {}),
  tags: slots,
});

const chuan = {
  schemaVersion: V,
  id: 'chuan',
  name: 'Màn hình chuẩn',
  size: { width: 1920, height: 1080 },
  items: [],
};
for (let k = 0; k < 10; k++) {
  chuan.items.push(
    item(
      `tbl_${k + 1}`,
      'tag-table',
      20 + (k % 5) * 380,
      20 + Math.floor(k / 5) * 520,
      360,
      500,
      { columns: ['label', 'value', 'unit', 'quality'], dense: true },
      {
        rows: tagIds.slice(k * 10, k * 10 + 10),
      },
    ),
  );
}
for (let k = 0; k < 10; k++)
  chuan.items.push(
    item(
      `card_${k + 1}`,
      'card',
      20 + k * 180,
      1010,
      170,
      60,
      { label: `Tag ${k + 1}` },
      { value: tagIds[k * 10] },
    ),
  );

const lon = {
  schemaVersion: V,
  id: 'lon',
  name: 'Màn hình 250 item',
  size: { width: 3840, height: 2160 },
  items: [],
};
for (let k = 0; k < 250; k++) {
  const col = k % 25;
  const row = Math.floor(k / 25);
  const x = 20 + col * 150;
  const y = 20 + row * 200;
  const t = tagIds[k % 100];
  const kind = k % 5;
  if (kind === 0)
    lon.items.push(item(`i${k}`, 'card', x, y, 140, 90, { label: `V${k}` }, { value: t }));
  else if (kind === 1) lon.items.push(item(`i${k}`, 'label', x, y, 140, 40, { text: `Nhãn ${k}` }));
  else if (kind === 2)
    lon.items.push(item(`i${k}`, 'lamp', x, y, 60, 60, { label: `L${k}` }, { state: t }));
  else if (kind === 3)
    lon.items.push(
      item(`i${k}`, 'gauge', x, y, 140, 140, { label: `G${k}`, min: 0, max: 100 }, { value: t }),
    );
  else
    lon.items.push(
      item(`i${k}`, 'level', x, y, 60, 180, { label: `M${k}`, min: 0, max: 100 }, { value: t }),
    );
}

// graf: 8 biểu đồ đường x 8 đường, cửa sổ 3.600 s, lấy mẫu 250 ms: bàn thử của SC-017 (scenario charts).
const graf = {
  schemaVersion: V,
  id: 'graf',
  name: '8 biểu đồ x 8 đường',
  size: { width: 1920, height: 1080 },
  items: [],
};
for (let k = 0; k < 8; k++)
  graf.items.push(
    item(
      `line_${k + 1}`,
      'line',
      20 + (k % 4) * 470,
      20 + Math.floor(k / 4) * 520,
      450,
      500,
      { windowSec: 3600, sampleMs: 250 },
      { series: tagIds.slice(k * 8, k * 8 + 8) },
    ),
  );

const project = {
  format: 'matscada-project',
  schemaVersion: V,
  projectId: 'big-250',
  projectName: 'Đo tải 250 item',
  projectVersion: '0.1.0',
  minRuntimeVersion: '0.6.0',
  entryScreen: 'chuan',
  screens: ['chuan', 'lon', 'graf'],
  tagFile: 'tags.json',
  connectionFile: 'connections.json',
  navigation: {
    position: 'left',
    items: [
      { label: 'Chuẩn', screen: 'chuan', icon: 'home' },
      { label: '250 item', screen: 'lon', icon: 'chart' },
      { label: 'Biểu đồ', screen: 'graf', icon: 'chart' },
    ],
  },
  maxClients: 10,
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'screens'), { recursive: true });
const w = (rel, text) => writeFileSync(join(out, rel), text, 'utf8');
w('project.json', formatProject03(project));
w('tags.json', formatTagsFile({ schemaVersion: V, tags }));
w(
  'connections.json',
  JSON.stringify(
    { schemaVersion: V, scanGroups: { fast: 250, normal: 1000, slow: 5000 }, channels: [] },
    null,
    2,
  ) + '\n',
);
w('screens/chuan.screen.json', formatScreen03(chuan));
w('screens/lon.screen.json', formatScreen03(lon));
w('screens/graf.screen.json', formatScreen03(graf));
console.log(
  `big-250: ${tags.length} Tag, ${chuan.items.length} + ${lon.items.length} item -> ${out}`,
);
