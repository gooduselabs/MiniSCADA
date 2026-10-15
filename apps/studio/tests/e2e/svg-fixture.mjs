// Project 0.4 mẫu cho e2e Studio của feature 008 (svg-bind, svg-perf): Tag và bảng giá trị của dashboard-demo, ba màn hình
// (`bon` có một item `svg` chưa gắn gì, `chinh` và popup `chi-tiet` để thử sự kiện chuyển màn hình), đồ họa nhỏ có đủ loại
// phần tử (nhóm, hình, chữ, đường, vòng, nhóm quay). Không phải kịch bản (run.mjs chỉ chạy *.e2e.mjs).
import { DASHBOARD_DEMO, readProject } from './util.mjs';

export const UIDS = {
  tank: 'el_tank',
  shell: 'el_shell',
  liquid: 'el_liquid',
  value: 'el_value',
  lamp: 'el_lamp',
  rotor: 'el_rotor',
  pipe: 'el_pipe',
  hit: 'el_hit',
  alarm: 'el_alarm',
};

const NAMES = {
  el_tank: 'Bồn',
  el_shell: 'Vỏ bồn',
  el_liquid: 'Nước',
  el_value: 'Số mức',
  el_lamp: 'Đèn bơm',
  el_rotor: 'Cánh quạt',
  el_pipe: 'Ống',
  el_hit: 'Nút bơm',
  el_alarm: 'Cảnh báo',
};

export const BON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <g data-mat-uid="el_tank" data-mat-name="Bồn">
    <rect data-mat-uid="el_shell" data-mat-name="Vỏ bồn" x="40" y="20" width="120" height="200" fill="#22404c" stroke="#b8cbd3" stroke-width="3"/>
    <rect data-mat-uid="el_liquid" data-mat-name="Nước" x="44" y="24" width="112" height="192" fill="#1e88e5"/>
  </g>
  <text data-mat-uid="el_value" data-mat-name="Số mức" x="190" y="60" fill="#eaf2f5" font-size="22">0.0</text>
  <circle data-mat-uid="el_lamp" data-mat-name="Đèn bơm" cx="270" cy="140" r="16" fill="#9e9e9e"/>
  <g data-mat-uid="el_rotor" data-mat-name="Cánh quạt" transform="translate(340 140)">
    <circle cx="0" cy="0" r="24" fill="none" stroke="#94a3b8" stroke-width="2"/>
    <line x1="0" y1="0" x2="22" y2="0" stroke="#e2e8f0" stroke-width="4"/>
  </g>
  <path data-mat-uid="el_pipe" data-mat-name="Ống" d="M20 260 L380 260" stroke="#38bdf8" stroke-width="6" fill="none"/>
  <rect data-mat-uid="el_hit" data-mat-name="Nút bơm" x="230" y="190" width="70" height="34" fill="#3b4a54"/>
  <circle data-mat-uid="el_alarm" data-mat-name="Cảnh báo" cx="370" cy="40" r="14" fill="#ef4444"/>
</svg>`;

const json = (v) => JSON.stringify(v, null, 2) + '\n';

/** SVG lớn: `n` phần tử gắn được, xếp lưới trong 6 nhóm lồng nhau (cây phần tử có cấp). */
export function bigSvg(n) {
  const groups = 20;
  const per = Math.floor(n / groups);
  let body = '';
  let k = 0;
  for (let g = 0; g < groups; g++) {
    body += `<g data-mat-uid="el_g${String(g).padStart(5, '0')}" data-mat-name="Nhóm ${g + 1}">`;
    for (let i = 0; i < per; i++, k++) {
      const x = (k % 200) * 5;
      const y = Math.floor(k / 200) * 5;
      body += `<rect data-mat-uid="el_r${String(k).padStart(6, '0')}" x="${x}" y="${y}" width="4" height="4" fill="#4cc9db"/>`;
    }
    body += '</g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">${body}</svg>`;
}

/**
 * Project 0.4: màn hình `bon` (item `svg1` ở (40, 40) cỡ 800 x 600), `chinh`, popup `chi-tiet`. `svg` và `elements` thay được
 * (hiệu năng); `bindings` là bộ binding ban đầu của item (mặc định rỗng).
 */
export function bonProject({ svg = BON_SVG, uids = Object.values(UIDS), bindings = null } = {}) {
  const src = readProject(DASHBOARD_DEMO);
  const at04 = (text) => text.replace(/"schemaVersion": "0\.3\.\d+"/, '"schemaVersion": "0.4.0"');
  const project = JSON.parse(src['project.json']);
  project.schemaVersion = '0.4.0';
  project.minRuntimeVersion = '0.7.0';
  project.screens = ['bon', 'chinh', 'chi-tiet'];
  project.entryScreen = 'bon';
  delete project.navigation;
  const files = {
    'project.json': json(project),
    'tags.json': at04(src['tags.json']),
    'connections.json': at04(src['connections.json']),
  };
  for (const [rel, text] of Object.entries(src))
    if (rel.startsWith('value-tables/')) files[rel] = at04(text);
  const elements = uids.map((elementUid) =>
    NAMES[elementUid] ? { elementUid, name: NAMES[elementUid] } : { elementUid },
  );
  files['screens/bon.screen.json'] = json({
    schemaVersion: '0.4.0',
    id: 'bon',
    name: 'Bồn nước',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    background: '#0f1b21',
    items: [
      {
        id: 'svg1',
        name: 'Sơ đồ bồn',
        type: 'svg',
        x: 40,
        y: 40,
        width: 800,
        height: 600,
        svgFile: 'graphics/bon.svg',
        bindingFile: 'screens/bon.svg1.bindings.json',
        viewBox: [0, 0, 400, 300],
        fit: 'contain',
        elements,
      },
    ],
  });
  files['screens/chinh.screen.json'] = json({
    schemaVersion: '0.4.0',
    id: 'chinh',
    name: 'Chính',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [],
  });
  files['screens/chi-tiet.screen.json'] = json({
    schemaVersion: '0.4.0',
    id: 'chi-tiet',
    name: 'Chi tiết bơm',
    kind: 'popup',
    size: { width: 480, height: 320 },
    items: [],
  });
  files['graphics/bon.svg'] = svg;
  files['screens/bon.svg1.bindings.json'] = json(
    bindings ?? { schemaVersion: '0.4.0', screenId: 'bon', itemId: 'svg1', elements: [] },
  );
  return files;
}
