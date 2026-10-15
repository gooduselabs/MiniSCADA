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

// --- Cổng kích thước khởi động và kiểm nội dung bản build (feature 007, T048, T072) ---
// JS + CSS mà dist-device/index.html tải lúc mở trang nén gzip ≤ 250 KB (FR-024, SC-024); biểu đồ đường tải lười đo riêng
// (T085). login.html chỉ tham chiếu assets/login-* (bundle riêng), index.html không tham chiếu assets/login-*.
const STARTUP_LIMIT = 250 * 1000;
const gzSize = (f) => gzipSync(readFileSync(f), { level: 9 }).length;
const refsOf = (htmlFile) =>
  [
    ...readFileSync(htmlFile, 'utf8').matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g),
  ].map((m) => m[1]);
const kb = (n) => `${(n / 1024).toFixed(1).padStart(7)} KB`;
const failures = [];

const indexRefs = refsOf(join(device, 'index.html'));
const loginRefs = existsSync(join(device, 'login.html'))
  ? refsOf(join(device, 'login.html'))
  : null;
if (!indexRefs.length) failures.push('index.html không tham chiếu JS/CSS nào');
if (indexRefs.some((r) => /^assets\/login-/.test(r)))
  failures.push('index.html tham chiếu assets/login-*');
if (loginRefs === null)
  failures.push('thiếu dist-device/login.html: chạy `vite build --mode login` (T072)');
else if (!loginRefs.length || loginRefs.some((r) => !/^assets\/login-/.test(r)))
  failures.push(`login.html chỉ được tham chiếu assets/login-*: ${loginRefs.join(', ')}`);

const startup = new Set(indexRefs);
const login = new Set(loginRefs ?? []);
console.log('Kích thước bản thiết bị (gzip mức 9):');
let startupTotal = 0;
let loginTotal = 0;
for (const file of walk(join(device, 'assets'))
  .filter((f) => !f.endsWith('.gz'))
  .sort()) {
  const rel = relative(device, file).replaceAll('\\', '/');
  const n = gzSize(file);
  const kind = startup.has(rel) ? 'khởi động' : login.has(rel) ? 'đăng nhập' : 'tải lười';
  if (kind === 'khởi động') startupTotal += n;
  if (kind === 'đăng nhập') loginTotal += n;
  console.log(`  ${rel.padEnd(42)} ${kb(n)}  ${kind}`);
}
console.log(
  `  KHỞI ĐỘNG (JS+CSS): ${kb(startupTotal)} / ${kb(STARTUP_LIMIT)}; trang đăng nhập: ${kb(loginTotal)}`,
);
if (startupTotal > STARTUP_LIMIT)
  failures.push(`JS+CSS khởi động ${startupTotal} B gzip > ${STARTUP_LIMIT} B (FR-024)`);

// Cổng kích thước xuất báo cáo (feature 010, T106; SC-018, SC-024): chunk XLSX ≤ 60 KB gzip, chunk PDF (pdf + pdfmake +
// phông) ≤ 1,2 MB gzip, và không chunk nào của xuất file nằm trong tải khởi động (tải lười khi bấm xuất).
const XLSX_LIMIT = 60 * 1000;
const PDF_LIMIT = 1.2 * 1000 * 1000;
const exportChunks = (re) =>
  walk(join(device, 'assets')).filter(
    (f) => !f.endsWith('.gz') && re.test(f.replaceAll('\\', '/')),
  );
const xlsxSize = exportChunks(/\/xlsx-[^/]+\.js$/).reduce((s, f) => s + gzSize(f), 0);
const pdfSize = exportChunks(/\/(pdf|pdfmake\.min|vfs_fonts)-[^/]+\.js$/).reduce(
  (s, f) => s + gzSize(f),
  0,
);
console.log(
  `  XUẤT BÁO CÁO: XLSX ${kb(xlsxSize)} / ${kb(XLSX_LIMIT)}; PDF ${kb(pdfSize)} / ${kb(PDF_LIMIT)}`,
);
if (xlsxSize === 0 || pdfSize === 0) failures.push('không thấy chunk xuất XLSX hoặc PDF (T106)');
if (xlsxSize > XLSX_LIMIT)
  failures.push(`chunk XLSX ${xlsxSize} B gzip > ${XLSX_LIMIT} B (SC-018)`);
if (pdfSize > PDF_LIMIT) failures.push(`chunk PDF ${pdfSize} B gzip > ${PDF_LIMIT} B (SC-018)`);
if (indexRefs.some((r) => /(^|\/)(xlsx|pdf|pdfmake\.min|vfs_fonts)-/.test(r)))
  failures.push('index.html tham chiếu chunk xuất XLSX/PDF: phải tải lười (SC-024)');

// Không eval, new Function, HTML thô trong mọi JS của bản thiết bị (SC-020). Ngoại lệ DUY NHẤT: Lit dựng <template> từ chuỗi
// tĩnh của các mẫu html`...` do mã nguồn viết (`createElement(e){let n=document.createElement("template");return n.innerHTML=e,n}`);
// dữ liệu project luôn đi qua binding dạng chữ. Mã nguồn trang và thư viện widget bị eslint cấm innerHTML (eslint.config.mjs).
const LIT_TEMPLATE =
  /\w+\.createElement\(\s*[`"']template[`"']\s*\)\s*;\s*return \w+\.innerHTML\s*=\s*\w+\s*,\s*\w+/g;
const BANNED = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\.innerHTML\b/, 'innerHTML'],
  [/\.outerHTML\b/, 'outerHTML'],
  [/\.insertAdjacentHTML\b/, 'insertAdjacentHTML'],
  [/\bdocument\.write\s*\(/, 'document.write'],
];
let litTemplates = 0;
for (const file of walk(device).filter((f) => f.endsWith('.js'))) {
  const raw = readFileSync(file, 'utf8');
  litTemplates += (raw.match(LIT_TEMPLATE) ?? []).length;
  const text = raw.replace(LIT_TEMPLATE, '');
  for (const [re, name] of BANNED)
    if (re.test(text))
      failures.push(`${relative(device, file).replaceAll('\\', '/')} chứa ${name} (SC-020)`);
}
console.log(
  `Kiểm nội dung: không eval, new Function, innerHTML ngoài ${litTemplates} chỗ dựng <template> của Lit`,
);
if (failures.length) {
  console.error('Bản thiết bị không đạt:');
  for (const f of failures) console.error(`  - ${f}`);
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
