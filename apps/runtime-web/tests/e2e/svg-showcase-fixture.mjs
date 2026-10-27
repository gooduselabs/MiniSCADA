// Project mẫu projects/svg-showcase (feature 026) cho runtime giả: đọc thẳng các tệp của project trên đĩa, kèm mô phỏng
// tất định các Tag mô phỏng và Tag tính toán mà sơ đồ công nghệ dùng (runtime giả không tự tính biểu thức). Dùng cho ảnh
// chụp tài liệu (tools/docs-screenshots.mjs). `scenario`: 'normal' (P-101, P-102, P-201 chạy) hoặc 'fault' (P-102 lỗi,
// P-103 chạy thay, cảnh báo mức cao bể lắng).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SVG_SHOWCASE_DIR = join(ROOT, 'projects/svg-showcase');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

const SCENARIOS = {
  normal: { run: { P101: 1, P102: 1, P103: 0, P201: 1, P202: 0 }, fault: {}, l101: 66, l201: 58 },
  fault: {
    run: { P101: 1, P102: 0, P103: 1, P201: 1, P202: 1 },
    fault: { P102: true },
    l101: 83,
    l201: 47,
  },
};

/** Mô phỏng tất định theo nhịp 250 ms của runtime giả (các biểu thức như tags.json của project). */
function simulator(scenario) {
  const sc = SCENARIOS[scenario] ?? SCENARIOS.normal;
  return (values, tick) => {
    const t = tick / 4; // giây
    const noise = Math.sin((2 * Math.PI * t) / 7);
    const noise2 = Math.sin((2 * Math.PI * t) / 11 + 1.9);
    const state = {};
    for (const p of ['P101', 'P102', 'P103', 'P201', 'P202']) {
      const fault = sc.fault[p] === true;
      const run = sc.run[p] === 1;
      state[p] = fault ? 2 : run ? 1 : 0;
      values.set(`${p}.RUN`, run);
      values.set(`${p}.FAULT`, fault);
      values.set(`${p}.STATE`, state[p]);
      const feed = p.startsWith('P1');
      values.set(
        `${p}.CURRENT`,
        state[p] === 1 ? r1(feed ? 24.5 + 0.8 * noise : 31.2 + 1.1 * noise2) : 0,
      );
    }
    const on = (p) => (state[p] === 1 ? 1 : 0);
    const fit101 = r1((on('P101') + on('P102') + on('P103')) * (48 + 1.5 * noise));
    const fit201 = r1((on('P201') + on('P202')) * (62 + 2 * noise2));
    values.set('FIT101.FLOW', fit101);
    values.set('XV101.OPEN', fit101 > 1);
    values.set('F101.FLOW', r1(92 + 6 * Math.sin(t / 7)));
    values.set('FIT201.FLOW', fit201);
    values.set('PIT201.PRESS', r2(fit201 > 1 ? 2.6 + 0.012 * fit201 + 0.08 * noise : 0.4));
    const l101 = r1(sc.l101 + 4 * Math.sin(t / 6));
    const l201 = r1(sc.l201 + 5 * Math.sin(t / 8 + 1));
    values.set('LIT101.LEVEL', l101);
    values.set('LIT101.HI', l101 > 80);
    values.set('LIT201.LEVEL', l201);
    values.set('LIT201.LO', l201 < 25);
    const lt = 70 + 2 * Math.sin(t / 30);
    values.set('LT001.LEVEL', r1(lt));
    values.set('LT001.M', r2(lt * 0.05));
    values.set('AIT001.NTU', r1(14 + 3 * Math.sin(t / 10)));
    values.set('AIT002.PH', r2(7.2 + 0.1 * Math.sin(t / 15)));
    values.set('FILTER.DP', r2(0.34 + 0.04 * Math.sin(t / 12)));
    const cl = r2(0.56 + 0.06 * Math.sin(t / 8));
    values.set('AIT301.CL', cl);
    values.set('AIT301.LO', cl < 0.3);
    values.set('LIT301.LEVEL', r1(62 + Math.sin(t / 20)));
    const p301 = fit101 > 1 ? 1 : 0;
    values.set('P301.RUN', p301 === 1);
    values.set('P301.FAULT', false);
    values.set('P301.STATE', p301);
    values.set('P301.CURRENT', p301 ? r2(1.6 + 0.05 * noise) : 0);
    values.set('P301.RATE', p301 ? r2(fit101 * 0.042) : 0);
    values.set('MCC.U', Math.round(399 + 3 * Math.sin(t / 3)));
    const amps = ['P101', 'P102', 'P103', 'P201', 'P202', 'P301'].reduce(
      (s, p) => s + values.get(`${p}.CURRENT`),
      0,
    );
    values.set('MCC.P', r1(amps * 0.56));
    values.set('RUN.COUNT', on('P101') + on('P102') + on('P103') + on('P201') + on('P202') + p301);
    const faults = Object.values(sc.fault).filter(Boolean).length;
    values.set(
      'ALARM.COUNT',
      faults + (l101 > 80 ? 1 : 0) + (l201 < 25 ? 1 : 0) + (cl < 0.3 ? 1 : 0),
    );
    values.set('TOTAL.TODAY', Math.round(2140 + t * 0.03));
    // Trang Thư viện component (Tag DEMO.*; DEMO.CMD/SP/SPEED/MODE là Tag nội bộ ghi được, giữ giá trị ghi)
    values.set('DEMO.TEMP', r1(55 + 25 * Math.sin((2 * Math.PI * t) / 90 + 0.9)));
    values.set('DEMO.LEVEL', r1(55 + 35 * Math.sin((2 * Math.PI * t) / 60 + 1.3)));
    values.set('DEMO.PRESS', r2(4.2 + 1.3 * Math.sin((2 * Math.PI * t) / 45)));
    values.set('DEMO.POS', r1(50 + 50 * Math.sin((2 * Math.PI * t) / 12)));
    values.set('DEMO.RUN', t % 40 < 28);
    values.set('DEMO.FAN', (t + 9) % 30 < 18);
    values.set('SIM.NOISE', r2(noise));
    values.set('SIM.NOISE2', r2(noise2));
  };
}

/** Fixture { active, files, values, simulate } của runtime giả. */
export function svgShowcaseProject({ theme, scenario = 'normal' } = {}) {
  const files = new Map();
  for (const p of walk(SVG_SHOWCASE_DIR)) {
    const rel = relative(SVG_SHOWCASE_DIR, p).replace(/\\/g, '/');
    if (rel.startsWith('.') || rel.endsWith('.md')) continue;
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
  const tags = files.get(project.tagFile).json;
  const simulate = simulator(scenario);
  const values = new Map();
  for (const t of tags.tags) {
    if (t.kind === 'simulation' && t.sim.kind === 'manual') values.set(t.id, t.sim.initial);
    else if (t.kind === 'simulation' && t.sim.kind === 'ramp') values.set(t.id, t.sim.from);
  }
  simulate(values, 0);
  return {
    active: {
      project: { ...project, ...(theme ? { theme } : {}) },
      tags,
      valueTables,
      connections: [],
      navigation: project.navigation,
      screens,
      digest: `sha256:e2e-svg-showcase-${scenario}`,
    },
    files,
    values: Object.fromEntries(values),
    simulate,
  };
}

const MIN = 60_000;
/** Lịch sử giả cho nhóm lưu trữ `thu-vien` (logging.json của project): giá trị tất định theo thời điểm t (ms). */
export function svgShowcaseHistory() {
  const logging = JSON.parse(readFileSync(join(SVG_SHOWCASE_DIR, 'logging.json'), 'utf8'));
  const tags = JSON.parse(readFileSync(join(SVG_SHOWCASE_DIR, 'tags.json'), 'utf8')).tags;
  const h = (t) => t / 3_600_000;
  const valueAt = (id, t) => {
    switch (id) {
      case 'DEMO.TEMP':
        return r1(55 + 18 * Math.sin(h(t) * 0.9) + 3 * Math.sin(t / MIN / 4));
      case 'DEMO.PRESS':
        return r2(4.2 + 1.1 * Math.sin(h(t) * 1.3 + 1) + 0.15 * Math.sin(t / MIN / 3));
      case 'FIT101.FLOW':
        return r1(96 + 30 * Math.sin(h(t) * 0.7) + 2 * Math.sin(t / MIN / 5));
      case 'FIT201.FLOW':
        return r1(118 + 20 * Math.sin(h(t) * 0.5 + 2) + 2 * Math.sin(t / MIN / 6));
      default:
        return null;
    }
  };
  return {
    groups: logging.groups.map((g) => ({
      id: g.id,
      name: g.name,
      mode: g.mode,
      tags: g.tags.map((x) => x.tagId),
    })),
    tags,
    valueAt,
  };
}
