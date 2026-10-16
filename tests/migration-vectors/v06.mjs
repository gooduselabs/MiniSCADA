// Cặp file nâng cấp 0.5 -> 0.6 (contracts/project-format-0.5.md §7, FR-012, SC-015), sinh bằng:
//   node tests/migration-vectors/v06.mjs
//   tests/migration-vectors/0.5-to-0.6/<ca>/before/…  nguồn (0.5; các ca `from-0.x-…` là 0.1 đến 0.4: nâng qua cả chuỗi)
//   tests/migration-vectors/0.5-to-0.6/<ca>/after/…   do bộ biến đổi tham chiếu VIẾT RIÊNG ở đây (không import
//                                                      @mat/project-schema): mọi file .json có `schemaVersion` đổi
//                                                      sang 0.6.0, project.json nâng `minRuntimeVersion` lên >= 0.9.0,
//                                                      mọi byte khác giữ nguyên, không tạo file nào
//   tests/migration-vectors/0.5-to-0.6/<ca>/expected-error.json  { code, file? } với ca không nâng cấp được
// Ca `from-0.1-…`, `from-0.2-…` lấy `after` 0.3 đã có ở `*-0.2to0.3/after` (tham chiếu của feature 007) rồi áp phần này.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base03 } from '../project-vectors/v03.mjs';
import { base05 } from '../project-vectors/v05.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = join(here, '0.5-to-0.6');

const j2 = (v) => JSON.stringify(v, null, 2) + '\n';
const toFiles = (obj) =>
  Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === 'string' || Buffer.isBuffer(v) ? v : j2(v),
    ]),
  );
function readTree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) readTree(dir, r, out);
    else if (n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
}
const SV = /("schemaVersion"\s*:\s*")0\.\d+\.\d+(")/;
const MIN = /("minRuntimeVersion"\s*:\s*")(\d+\.\d+\.\d+)(")/;
const ver = (s) => s.split('.').map(Number);
const less = (a, b) => {
  const [x, y] = [ver(a), ver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};
const text = (b) => b.toString('utf8');
/** Đặt phiên bản nguồn (dựng `before`): mọi .json có schemaVersion đổi sang `v`, project.json có runtime tối thiểu `min`. */
function retag(files, v, min) {
  const out = {};
  for (const [k, b] of Object.entries(files)) {
    if (!k.endsWith('.json')) {
      out[k] = b;
      continue;
    }
    let t = text(b);
    if (SV.test(t)) t = t.replace(SV, `$1${v}$2`);
    if (k === 'project.json' && min) t = t.replace(MIN, `$1${min}$3`);
    out[k] = Buffer.from(t, 'utf8');
  }
  return out;
}
/** Bộ biến đổi tham chiếu 0.5 (hoặc 0.4 .. 0.1 đã qua phần trước) -> 0.6. */
function reference(files) {
  const out = {};
  for (const [k, b] of Object.entries(files)) {
    if (!k.endsWith('.json')) {
      out[k] = b;
      continue;
    }
    let t = text(b);
    t = t.replace(SV, '$10.6.0$2');
    if (k === 'project.json') {
      const m = MIN.exec(t);
      if (m && less(m[2], '0.9.0')) t = t.replace(MIN, '$10.9.0$3');
    }
    out[k] = Buffer.from(t, 'utf8');
  }
  return out;
}

const cases = [];
const add = (name, before, after) => cases.push({ name, before, after });
const err = (name, before, error) => cases.push({ name, before, error });

const v03 = (mutate = () => {}) => {
  const f = base03();
  mutate(f);
  return toFiles(f);
};

// ---- 0.5 -> 0.6 ----
{
  const b = retag(v03(), '0.5.0', '0.8.0');
  add('small-project', b, reference(b));
}
{
  const b = retag(
    v03((f) => {
      f['project.json'].navigation.items.push({
        label: 'Nhóm',
        icon: 'list',
        items: [{ label: 'Chính', screen: 'main', icon: 'home' }],
      });
    }),
    '0.5.0',
    '0.8.0',
  );
  add('with-navigation', b, reference(b));
}
{
  const logging = JSON.parse(
    readFileSync(join(root, 'tests/project-vectors/v02-valid-logging/logging.json'), 'utf8'),
  );
  const b = retag(
    v03((f) => {
      f['logging.json'] = logging;
      f['project.json'].loggingFile = 'logging.json';
    }),
    '0.5.0',
    '0.8.0',
  );
  add('with-logging', b, reference(b));
}
{
  // lỗi sẵn có (Tag trùng id): mang sang, không thêm lỗi mới
  const b = retag(
    v03((f) => f['tags.json'].tags.push({ ...f['tags.json'].tags[0] })),
    '0.5.0',
    '0.8.0',
  );
  add('with-existing-error', b, reference(b));
}
{
  const b = retag(v03(), '0.5.0', '0.9.0');
  add('min-runtime-already-0.9.0', b, reference(b));
}
{
  // BOM đầu project.json được giữ nguyên
  const b = retag(v03(), '0.5.0', '0.8.0');
  b['project.json'] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b['project.json']]);
  add('edge-bom', b, reference(b));
}
{
  // tên có dấu tiếng Việt và ký tự ngoài BMP không bị đụng tới
  const b = retag(
    v03((f) => {
      f['project.json'].projectName = 'Trạm bơm số 1 \u{1F4A7}';
      f['screens/main.screen.json'].name = 'Tổng quan';
    }),
    '0.5.0',
    '0.8.0',
  );
  add('edge-vietnamese-text', b, reference(b));
}
{
  const dash = readTree(join(root, 'projects/dashboard-demo'));
  const b = retag(dash, '0.5.0', '0.8.0');
  add('dashboard-demo', b, reference(b));
}
{
  // project 0.5 có file alarm: mọi file kể cả alarms.json, alarm-classes.json đổi phiên bản
  const f = base05();
  const b = toFiles(f);
  add('with-alarms', b, reference(b));
}
{
  const dash = readTree(join(root, 'projects/dashboard-demo'));
  const b = retag(dash, '0.4.0', '0.7.0');
  add('from-0.4-dashboard-demo', b, reference(b));
}
// ---- chuỗi 0.3 -> 0.4 -> 0.5 -> 0.6 ----
{
  const dash = readTree(join(root, 'projects/dashboard-demo')); // 0.3.0, minRuntime 0.6.0
  add('from-0.3-dashboard-demo', dash, reference(dash));
}
{
  const b = retag(v03(), '0.3.0', '0.6.0');
  add('from-0.3-small-project', b, reference(b));
}
// ---- chuỗi 0.2 -> 0.3 -> 0.5 -> 0.6 và 0.1 -> ... ----
for (const [name, src] of [
  ['from-0.2-modbus-demo', 'modbus-demo-0.2to0.3'],
  ['from-0.1-tank-demo', 'tank-demo-0.2to0.3'],
]) {
  const before = readTree(join(here, src, 'before'));
  // `after` của 0.2 -> 0.3 (tham chiếu của 007) rồi phần 0.3 -> 0.5; minRuntime của 0.3 là 0.6.0 nên lên 0.8.0
  add(name, before, reference(readTree(join(here, src, 'after'))));
}
// ---- không nâng cấp được ----
err('error-already-0.6', retag(v03(), '0.6.0', '0.9.0'), { code: 'ALREADY_06' });
err('error-unsupported-0.7', retag(v03(), '0.7.0', '0.10.0'), {
  code: 'UNSUPPORTED_VERSION',
  version: '0.7.0',
});
err(
  'error-unreadable-project',
  { 'project.json': Buffer.from('{ "schemaVersion": "0.5.0", ') },
  {
    code: 'UNREADABLE',
    file: 'project.json',
  },
);

rmSync(OUT, { recursive: true, force: true });
for (const c of cases) {
  const dir = join(OUT, c.name);
  const put = (sub, files) => {
    for (const [rel, content] of Object.entries(files)) {
      const p = join(dir, sub, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
  };
  put('before', c.before);
  if (c.after) put('after', c.after);
  if (c.error) writeFileSync(join(dir, 'expected-error.json'), JSON.stringify(c.error) + '\n');
}
console.log(`${cases.length} cặp nâng cấp 0.5 -> 0.6 trong ${OUT}`);
