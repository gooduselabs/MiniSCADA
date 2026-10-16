// Cặp file nâng cấp 0.3 -> 0.4 (feature 008, contracts/project-format-0.4.md §7), được generate.mjs nạp SAU các cặp
// 0.2 -> 0.3 (lấy `after` của chúng làm nguồn 0.3) và sau bộ vector project (ca `already-04` dùng v04-valid-full):
//   tests/migration-vectors/<ca>-0.3to0.4/before/…  nguồn 0.3 (hoặc project mẫu dashboard-demo)
//   tests/migration-vectors/<ca>-0.3to0.4/after/…   do bộ biến đổi tham chiếu VIẾT RIÊNG ở đây (không import
//                                                    @mat/project-schema): chỉ `schemaVersion` của mọi file JSON đổi
//                                                    0.3.x -> 0.4.0 và `minRuntimeVersion` của project.json lên tối thiểu
//                                                    0.7.0, thay đúng chuỗi, mọi byte khác (kể cả BOM) giữ nguyên
//   tests/migration-vectors/<ca>-0.3to0.4/expected-error.json  { code, file? } với ca không nâng cấp được
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIN_RUNTIME = '0.7.0';
const SCHEMA_RE = /("schemaVersion"\s*:\s*")0\.3\.\d+(")/;
const MIN_RE = /("minRuntimeVersion"\s*:\s*")(\d+\.\d+\.\d+)(")/;
const text = (b) => b.toString('utf8');
const parse = (b) => {
  const s = text(b);
  try {
    return JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  } catch {
    return null;
  }
};
const maxVer = (a, b) => {
  const p = (s) => s.split('.').map(Number);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a;
};

const readTree = (dir, rel = '') => {
  const out = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, readTree(dir, r));
    else if (n !== 'expected.json' && n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
};

/** Bộ biến đổi tham chiếu. Trả { files } hoặc { error }. */
export function reference(before) {
  const project = before['project.json'] ? parse(before['project.json']) : null;
  if (!project || typeof project !== 'object')
    return { error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (/^0\.4\.\d+$/.test(version)) return { error: { code: 'ALREADY_04' } };
  if (!/^0\.3\.\d+$/.test(version)) return { error: { code: 'UNSUPPORTED_VERSION', version } };

  const files = new Set([
    'project.json',
    project.tagFile,
    project.connectionFile,
    project.loggingFile,
  ]);
  for (const n of project.valueTables ?? []) files.add(`value-tables/${n}.json`);
  for (const n of project.watchTables ?? []) files.add(`watch-tables/${n}.json`);
  for (const id of project.screens ?? []) {
    const sf = `screens/${id}.screen.json`;
    files.add(sf);
    const s = before[sf] ? parse(before[sf]) : null;
    for (const it of s?.items ?? []) if (it.type === 'svg') files.add(it.bindingFile);
  }
  const after = { ...before };
  for (const f of files) {
    if (typeof f !== 'string' || !before[f]) continue;
    let t = text(before[f]);
    if (!SCHEMA_RE.test(t)) continue; // hỏng hoặc không có schemaVersion: mang nguyên văn
    t = t.replace(SCHEMA_RE, '$10.4.0$2');
    if (f === 'project.json')
      t = t.replace(MIN_RE, (_m, a, v, c) => `${a}${maxVer(v, MIN_RUNTIME)}${c}`);
    after[f] = Buffer.from(t);
  }
  return { files: after };
}

/** Các ca: { name, before, result } với result = reference(before). */
export function cases04(root, here) {
  const pv = join(root, 'tests/project-vectors');
  const mv = (name) => readTree(join(here, `${name}-0.2to0.3`, 'after')); // 0.3 sinh ở bước trước
  const C = [];
  const add = (name, before) =>
    C.push({ name: `${name}-0.3to0.4`, before, result: reference(before) });
  add('tank-demo', mv('tank-demo'));
  add('modbus-demo', mv('modbus-demo'));
  add('dashboard-demo', readTree(join(root, 'projects/dashboard-demo')));
  add('multi-screen', mv('multi-screen'));
  add('edge-bom', mv('edge-bom'));
  add('min-runtime-higher', mv('min-runtime-higher')); // minRuntimeVersion 0.7.0 bằng mức mới: giữ
  add('screen-existing-error', mv('screen-existing-error')); // lỗi của bản gốc mang sang
  add('screen-broken-file', mv('screen-broken-file')); // màn hình hỏng JSON mang nguyên văn
  add('already-04', readTree(join(pv, 'v04-valid-full')));
  add('unsupported-version', {
    ...mv('modbus-demo'),
    'project.json': Buffer.from(
      text(mv('modbus-demo')['project.json']).replace(/"0\.3\.0"/, '"0.5.0"'),
    ),
  });
  add('unreadable-project', { ...mv('modbus-demo'), 'project.json': Buffer.from('not json') });
  // minRuntimeVersion 0.6.0 (thấp hơn) lên 0.7.0: dựng từ modbus-demo
  add('min-runtime-lower', {
    ...mv('modbus-demo'),
    'project.json': Buffer.from(
      text(mv('modbus-demo')['project.json']).replace(
        /("minRuntimeVersion"\s*:\s*")[\d.]+"/,
        '$10.6.0"',
      ),
    ),
  });
  return C;
}
