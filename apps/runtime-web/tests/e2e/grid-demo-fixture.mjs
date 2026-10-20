// Project mẫu projects/grid-demo (định dạng 1.1) cho runtime giả (feature 014): đọc thẳng các tệp của project trên đĩa, kèm
// giá trị đầu và mô phỏng các Tag mà màn hình "Bảng điều khiển" dùng (thẻ chỉ số, biểu đồ có ngưỡng, trạng thái bơm). Dùng
// cho e2e dashboard và ảnh chụp tài liệu (tools/docs-screenshots.mjs). `theme` đè chủ đề của project (vivid, dark…).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const GRID_DEMO_DIR = join(ROOT, 'projects/grid-demo');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Giá trị đầu của các Tag mô phỏng/ngoài mà màn hình dùng. */
const INITIAL = {
  'SIM.TEMP': 45.2,
  'SIM.PRESS': 4.12,
  'SIM.FLOW': 62.4,
  'SIM.SP_FLOW': 60,
  'SIM.MODE': 1,
  'SIM.ALARM': false,
  'SIM.FAN_ON': true,
  'TANK01.LEVEL': 62.5,
  'TANK01.HIGH': false,
  'TANK01.VOLUME': 781.3,
  'METER1.P': 38.6,
  'DEMO.WAVE': 57,
  'PUMP01.FLOW': 18,
  'PUMP02.FLOW': 26,
  'PUMP03.FLOW': 12,
  'PUMP04.FLOW': 31,
  'PUMP05.FLOW': 22,
  'PUMP06.FLOW': 15,
  'PUMP01.RUN': true,
  'PUMP02.RUN': true,
  'PUMP03.RUN': false,
  'PUMP04.RUN': true,
  'PUMP05.RUN': true,
  'PUMP06.RUN': false,
};

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/** Mô phỏng tất định theo nhịp 250 ms của runtime giả. */
function simulate(values, tick) {
  const t = tick / 4; // giây
  values.set('SIM.TEMP', r1(45 + 18 * Math.sin(t / 9) + 2 * Math.sin(t * 1.3)));
  values.set('SIM.PRESS', r2(4 + 1.2 * Math.sin(t / 6) + 0.25 * Math.sin(t * 2.1)));
  values.set('SIM.FLOW', r1(58 + 26 * Math.sin(t / 11) + 3 * Math.sin(t * 0.9)));
  values.set('METER1.P', r1(38 + 6 * Math.sin(t / 7)));
  values.set('DEMO.WAVE', r1(55 + 20 * Math.sin(t / 5)));
  const level = r1(62 + 9 * Math.sin(t / 13));
  values.set('TANK01.LEVEL', level);
  values.set('TANK01.VOLUME', r1(level * 12.5));
  values.set('TANK01.HIGH', level > 85);
  for (let i = 1; i <= 6; i++) {
    const id = `PUMP0${i}.FLOW`;
    values.set(id, r1(INITIAL[id] + 3 * Math.sin(t / (4 + i) + i)));
  }
}

/** Fixture { active, files, values, simulate } của runtime giả. */
export function gridDemoProject({ theme } = {}) {
  const files = new Map();
  for (const p of walk(GRID_DEMO_DIR)) {
    const rel = relative(GRID_DEMO_DIR, p).replace(/\\/g, '/');
    if (rel.startsWith('.')) continue;
    const text = readFileSync(p, 'utf8');
    files.set(
      rel,
      rel.endsWith('.json')
        ? { json: JSON.parse(text) }
        : { text, type: rel.endsWith('.svg') ? 'image/svg+xml' : 'text/plain' },
    );
  }
  const project = files.get('project.json').json;
  const screens = project.screens.map((id) => {
    const file = `screens/${id}.screen.json`;
    const s = files.get(file).json;
    return { id, name: s.name, kind: s.kind ?? 'screen', file };
  });
  const valueTables = Object.fromEntries(
    (project.valueTables ?? []).map((n) => [n, files.get(`value-tables/${n}.json`).json]),
  );
  return {
    active: {
      project: { ...project, ...(theme ? { theme } : {}) },
      tags: files.get(project.tagFile).json,
      valueTables,
      connections: (files.get(project.connectionFile)?.json.connections ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.id,
        kind: c.kind,
      })),
      navigation: project.navigation,
      screens,
      digest: 'sha256:e2e-grid-demo',
    },
    files,
    values: INITIAL,
    simulate,
  };
}
