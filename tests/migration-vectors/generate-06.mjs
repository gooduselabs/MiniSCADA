// Sinh cặp file nâng cấp 0.3 -> 0.6 (feature 010, T021): tests/migration-vectors/<ca>-0.3to0.6/{before,after}
//   node tests/migration-vectors/generate-06.mjs
// `after` do bộ biến đổi tham chiếu viết riêng ở đây (không import @mat/project-schema): đổi `schemaVersion` đầu
// tiên của mọi file `.json` từ 0.3.x sang 0.6.0 và nâng `minRuntimeVersion` của project.json lên tối thiểu 0.9.0.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const PV = join(root, 'tests/project-vectors');
const MV = here;

for (const d of readdirSync(MV))
  if (d.endsWith('-0.3to0.6')) rmSync(join(MV, d), { recursive: true, force: true });

const tree = (dir, rel = '') => {
  const out = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else if (n !== 'expected.json' && n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
};

const semverLess = (a, b) => {
  const [x, y] = [a, b].map((s) => s.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

/** Bộ biến đổi tham chiếu trên chuỗi văn bản (giữ nguyên mọi byte khác, kể cả BOM). */
function reference(files) {
  const out = {};
  for (const [path, buf] of Object.entries(files)) {
    let s = buf.toString('utf8');
    if (path.endsWith('.json')) {
      s = s.replace(/("schemaVersion"\s*:\s*")0\.3\.\d+(")/, '$10.6.0$2');
      if (path === 'project.json') {
        s = s.replace(/("minRuntimeVersion"\s*:\s*")([^"]+)(")/, (m, a, v, c) =>
          semverLess(v, '0.9.0') ? `${a}0.9.0${c}` : m,
        );
      }
    }
    out[path] = Buffer.from(s, 'utf8');
  }
  return out;
}

const write = (dir, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
};

let n = 0;
function pair(name, before, { error } = {}) {
  const dir = join(MV, `${name}-0.3to0.6`);
  write(join(dir, 'before'), before);
  if (error) writeFileSync(join(dir, 'expected-error.json'), JSON.stringify(error) + '\n');
  else write(join(dir, 'after'), reference(before));
  n++;
}

const fromVector = (name) => tree(join(PV, name));
const fromPair = (name) => tree(join(MV, name, 'after'));

pair('valid-full', fromVector('v03-valid-full'));
pair('minimal', fromVector('v03-valid-minimal'));
pair('tank-demo', fromPair('tank-demo-0.2to0.3')); // có logging.json
pair('modbus-demo', fromPair('modbus-demo-0.2to0.3'));
pair('already-06', fromVector('v06-valid-full'), { error: { code: 'ALREADY_06' } });
{
  const f = fromVector('v03-valid-full');
  f['project.json'] = Buffer.from(
    f['project.json']
      .toString('utf8')
      .replace('"minRuntimeVersion": "0.6.0"', '"minRuntimeVersion": "0.9.5"'),
  );
  pair('min-runtime-higher', f);
}
pair('screen-existing-error', fromVector('v03-invalid-widget-unknown'));
pair(
  'unreadable-project',
  { 'project.json': Buffer.from('{ "schemaVersion": ') },
  { error: { code: 'UNREADABLE', file: 'project.json' } },
);
pair(
  'unsupported-version',
  { 'project.json': Buffer.from('{ "schemaVersion": "0.4.0" }\n') },
  { error: { code: 'UNSUPPORTED_VERSION', version: '0.4.0' } },
);
{
  // BOM đầu file và file không phải JSON của project (SVG) giữ nguyên byte
  const f = fromVector('v03-valid-full');
  f['tags.json'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f['tags.json']]);
  pair('bom', f);
}
void cpSync;
console.log(`${n} cặp nâng cấp 0.3 -> 0.6 trong ${MV}`);
