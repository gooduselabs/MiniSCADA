// Bước sau `vite build` (cả hai chế độ):
//  - dist/ (dev/x64): chép fixture SVG vào dist/screens + screens/index.json cho lab.html.
//  - dist-device/ (gói thiết bị): kiểm KHÔNG có lab, fixture hay unsafe-elements.svg (T058).
// Rồi nén sẵn gzip (máy chủ phục vụ file.gz khi client gửi Accept-Encoding: gzip).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const device = resolve(here, '../dist-device');
const fixtures = resolve(here, '../../../tests/fixtures/svg');

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );

// --- dist/: fixture cho lab ---
const screens = join(dist, 'screens');
mkdirSync(screens, { recursive: true });
const entries = readdirSync(fixtures)
  .filter((f) => f.endsWith('.svg'))
  .sort()
  .map((name) => {
    copyFileSync(join(fixtures, name), join(screens, name));
    const text = readFileSync(join(fixtures, name), 'utf8');
    const title = /<title[^>]*>([^<]*)<\/title>/.exec(text)?.[1]?.trim() || name;
    return { name, title, bytes: statSync(join(fixtures, name)).size };
  });
writeFileSync(
  join(screens, 'index.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), screens: entries }, null, 2),
);

// --- dist-device/: chặn nội dung không được triển khai ---
if (!existsSync(device)) {
  console.error('Thiếu dist-device/: chạy `vite build --mode device` trước.');
  process.exit(1);
}
const forbidden = walk(device)
  .map((f) => relative(device, f).replaceAll('\\', '/'))
  .filter((f) => /(^|\/)lab[.-]|^screens\/|unsafe-elements|\.map$/.test(f));
if (forbidden.length) {
  console.error('Gói thiết bị chứa file không được phép:', forbidden);
  process.exit(1);
}

const COMPRESSIBLE = /\.(html|js|css|svg|json)$/;
for (const [label, root] of [
  ['dist', dist],
  ['dist-device', device],
]) {
  let rawTotal = 0;
  let gzTotal = 0;
  for (const file of walk(root).filter((f) => COMPRESSIBLE.test(f))) {
    const raw = readFileSync(file);
    const gz = gzipSync(raw, { level: 9 });
    if (gz.length >= raw.length) continue; // không lợi thì không tạo .gz
    writeFileSync(file + '.gz', gz);
    rawTotal += raw.length;
    gzTotal += gz.length;
  }
  console.log(`${label}: ${rawTotal} B -> ${gzTotal} B sau gzip`);
}
console.log(`${entries.length} fixture SVG trong dist/screens (lab, không triển khai)`);
