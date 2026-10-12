// Sinh cặp file nâng cấp 0.1 -> 0.2 (contracts/project-format-0.2.md §9; research R3):
//   tests/migration-vectors/<ca>/before/…  nguồn 0.1 (chép từ tests/project-vectors, hoặc biến thể viết ở đây)
//   tests/migration-vectors/<ca>/after/…   do bộ biến đổi tham chiếu VIẾT RIÊNG trong script này (không import
//                                          @mat/project-schema)
//   tests/migration-vectors/<ca>/expected-error.json  { code, file? } với ca không nâng cấp được (không có after/)
// Định dạng ghi của R2: Tag một dòng, khóa theo thứ tự chuẩn; file khác thụt 2 dấu cách; BOM bị bỏ.
//   node tests/migration-vectors/generate.mjs
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const PV = join(root, 'tests/project-vectors');

const readTree = (dir, rel = '') => {
  const out = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, readTree(dir, r));
    else if (n !== 'expected.json' && n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
};
const text = (b) => {
  const s = b.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};
const j2 = (v) => JSON.stringify(v, null, 2) + '\n';
const maxVer = (a, b) => {
  const p = (s) => s.split('.').map(Number);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a;
};

/** Bộ biến đổi tham chiếu. Trả { files } hoặc { error }. */
function reference(before) {
  let project;
  try {
    project = JSON.parse(text(before['project.json']));
  } catch {
    return { error: { code: 'UNREADABLE', file: 'project.json' } };
  }
  const tagFile = project.tagFile;
  let tags;
  try {
    tags = JSON.parse(text(before[tagFile]));
  } catch {
    return { error: { code: 'UNREADABLE', file: tagFile } };
  }
  const after = { ...before };
  project.schemaVersion = '0.2.0';
  project.minRuntimeVersion = maxVer(project.minRuntimeVersion, '0.5.0');
  after['project.json'] = Buffer.from(j2(project));
  const lines = tags.tags.map((t) => {
    const o = { id: t.id, kind: 'simulation', type: t.type };
    for (const k of ['description', 'unit', 'min', 'max']) if (t[k] !== undefined) o[k] = t[k];
    o.sim = { kind: 'legacy', signal: t.source.signal };
    return '    ' + JSON.stringify(o);
  });
  after[tagFile] = Buffer.from(
    `{\n  "schemaVersion": "0.2.0",\n  "tags": [${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}]\n}\n`,
  );
  const only = [];
  if (project.loggingFile) only.push(project.loggingFile);
  for (const id of project.screens) {
    const sf = `screens/${id}.screen.json`;
    only.push(sf);
    if (before[sf]) {
      try {
        only.push(JSON.parse(text(before[sf])).bindingFile);
      } catch {
        /* hỏng: mang sang */
      }
    }
  }
  for (const f of only) {
    if (!before[f]) continue;
    try {
      const v = JSON.parse(text(before[f]));
      v.schemaVersion = '0.2.0';
      after[f] = Buffer.from(j2(v));
    } catch {
      /* mang sang nguyên văn */
    }
  }
  return { files: after };
}

const cases = {};
const fromVector = (name) => readTree(join(PV, name));
for (const d of readdirSync(PV)) {
  if (d.startsWith('v02-') || d === 'out' || !statSync(join(PV, d)).isDirectory()) continue;
  const exp = JSON.parse(readFileSync(join(PV, d, 'expected.json'), 'utf8'));
  if (exp.valid) cases[d] = fromVector(d); // mọi ca valid-* (kể cả valid-tank-demo)
}
cases['invalid-dup-tag'] = fromVector('invalid-dup-tag'); // lỗi của bản gốc được mang sang

const base = () => fromVector('valid-minimal');
const edit = (files, name, fn) => {
  const v = JSON.parse(text(files[name]));
  fn(v);
  files[name] = Buffer.from(j2(v));
};
{
  const f = base();
  edit(f, 'tags.json', (v) => {
    v.tags[0].source.signal = 'sim.lạ_tín_hiệu'.replace('ạ', 'a').replace('í', 'i');
    v.tags.push({
      id: 'T.UNKNOWN',
      type: 'FLOAT64',
      source: { kind: 'mock', signal: 'khong.co.that' },
    });
  });
  cases['edge-unknown-signal'] = f;
}
{
  const f = base();
  edit(f, 'tags.json', (v) => v.tags.forEach((t) => (delete t.min, delete t.max)));
  cases['edge-no-min-max'] = f;
}
{
  const f = base();
  f['tags.json'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f['tags.json']]);
  f['screens/main.screen.json'] = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    f['screens/main.screen.json'],
  ]);
  cases['edge-bom'] = f;
}
{
  const f = base();
  edit(f, 'project.json', (v) => (v.minRuntimeVersion = '0.9.0'));
  cases['edge-min-runtime-higher'] = f;
}
{
  const f = base();
  edit(f, 'tags.json', (v) => (v.tags = []));
  edit(f, 'screens/main.screen.json', (v) => (v.elements = []));
  edit(f, 'screens/main.bindings.json', (v) => (v.elements = []));
  cases['edge-no-tags'] = f;
}
{
  const f = base();
  edit(f, 'tags.json', (v) =>
    v.tags.push({
      id: 'T.VN',
      type: 'STRING',
      description: 'Mô tả tiếng Việt "có dấu"',
      unit: '°C',
      source: { kind: 'mock', signal: 'x.vn' },
    }),
  );
  cases['edge-vietnamese-text'] = f;
}
{
  const f = base();
  f['tags.json'] = Buffer.from('{ "schemaVersion": "0.1.0", "tags": [ ');
  cases['unreadable-tags'] = f;
}
{
  const f = base();
  f['project.json'] = Buffer.from('not json');
  cases['unreadable-project'] = f;
}

rmSync(here + '/__none__', { recursive: true, force: true });
for (const d of readdirSync(here))
  if (statSync(join(here, d)).isDirectory()) rmSync(join(here, d), { recursive: true });
let n = 0;
for (const [name, before] of Object.entries(cases)) {
  const dir = join(here, name);
  const put = (sub, files) => {
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, sub, rel)), { recursive: true });
      writeFileSync(join(dir, sub, rel), data);
    }
  };
  put('before', before);
  const r = reference(before);
  if (r.error) writeFileSync(join(dir, 'expected-error.json'), JSON.stringify(r.error) + '\n');
  else put('after', r.files);
  n++;
}
console.log(`migration-vectors: ${n} ca`);
