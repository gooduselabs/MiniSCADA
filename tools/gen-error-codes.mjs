// Sinh `docs/user/error-codes.md` từ danh mục `schemas/error-codes.json` (feature 011, T025; FR-006):
//   node tools/gen-error-codes.mjs            ghi docs/user/error-codes.md
//   node tools/gen-error-codes.mjs --check    thoát mã 1 khi tài liệu lệch danh mục (CI)
// Cùng danh mục thì cùng từng byte. Thêm mã mới: thêm mục vào danh mục (tools/gen-error-codes.test.mjs bắt mã thiếu),
// rồi chạy lại công cụ này.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(root, 'schemas/error-codes.json');
const outPath = join(root, 'docs/user/error-codes.md');

/** Thứ tự và tên mục của tài liệu; `group` của danh mục phải là một khóa ở đây. */
const GROUPS = {
  format: 'Định dạng và phiên bản project',
  tags: 'Tag, địa chỉ Modbus, cổng serial và bảng giá trị',
  expression: 'Biểu thức của Tag tính toán',
  screens: 'Màn hình, widget, binding và điều hướng',
  svg: 'SVG, hoạt ảnh, sự kiện và nhập SVG',
  alarm: 'Alarm',
  history: 'Lưu trữ, lịch sử và báo cáo',
  package: 'Gói project (.matscada)',
  deploy: 'Nạp xuống, đọc lên, kho project và kiểm tra sức khỏe',
  auth: 'Đăng nhập, phiên và truy cập HTTP',
  write: 'Ghi Tag',
  quality: 'Lý do quality của Tag',
  driver: 'Kết nối PLC, cổng serial và Thử kết nối',
  live: 'Kênh dữ liệu sống (WebSocket)',
  logic: 'Logic: luật, timer, counter, cộng dồn, giờ chạy, lịch và ghi PLC',
  system: 'Cảnh báo hệ thống, chứng chỉ và công cụ dòng lệnh',
  update: 'Cập nhật runtime qua mạng (OTA) và chữ ký phát hành',
  recipe: 'Recipe (công thức)',
};

const cell = (v) => String(v).replace(/\|/g, '\\|');

export function render(catalog) {
  const codes = catalog.codes;
  for (const e of codes) {
    if (!(e.group in GROUPS)) throw new Error(`${e.code}: nhóm lạ "${e.group}"`);
  }
  const used = Object.keys(GROUPS).filter((g) => codes.some((e) => e.group === g));
  const lines = [
    '# Mã lỗi và cảnh báo',
    '',
    '<!-- Tệp sinh bằng `node tools/gen-error-codes.mjs` từ `schemas/error-codes.json`. Không sửa tay. -->',
    '',
    'Danh mục mọi mã lỗi và cảnh báo mà thiết bị (runtime), Studio và trang vận hành có thể báo. Mã viết hoa',
    '(ví dụ `AUTH_FAILED`) không đổi giữa các phiên bản; câu tiếng Việt có thể được viết lại cho rõ hơn.',
    '',
    '- Mã bắt đầu bằng `E_` là lỗi của project hoặc gói: Studio chặn lưu hay nạp xuống cho tới khi sửa.',
    '- Mã bắt đầu bằng `W_` là cảnh báo: không chặn, nhưng nên xem lại.',
    '- Mã khác là kết quả do thiết bị trả về (API, ghi Tag, quality, kênh dữ liệu sống, cảnh báo hệ thống).',
    '- Cột **HTTP** là mã trạng thái HTTP khi thiết bị trả mã này cho một yêu cầu; "—" khi mã nằm trong nội dung',
    '  khác (danh sách lỗi, kết quả ghi, quality, cảnh báo).',
    '- Cột **Nơi dùng** là phần mã nguồn phát hoặc kiểm tra mã này.',
    '',
    `Tổng cộng ${codes.length} mã.`,
    '',
    '## Mục lục',
    '',
  ];
  for (const g of used) {
    const n = codes.filter((e) => e.group === g).length;
    lines.push(`- [${GROUPS[g]}](#${g}) (${n})`);
  }
  for (const g of used) {
    lines.push('', `<a id="${g}"></a>`, '', `## ${GROUPS[g]}`, '');
    lines.push('| Mã | HTTP | Thông điệp | Nơi dùng |', '| --- | --- | --- | --- |');
    for (const e of codes.filter((x) => x.group === g)) {
      const http = e.http === null ? '—' : String(e.http);
      const where = e.usedIn.map((u) => `\`${u}\``).join(', ');
      lines.push(`| \`${e.code}\` | ${http} | ${cell(e.message)} | ${where} |`);
    }
  }
  return lines.join('\n') + '\n';
}

function main() {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const text = render(catalog);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      // chưa có tệp: coi như lệch
    }
    if (current !== text) {
      console.error(
        'docs/user/error-codes.md lệch schemas/error-codes.json: chạy node tools/gen-error-codes.mjs',
      );
      process.exit(1);
    }
    return;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  console.log(`đã ghi docs/user/error-codes.md (${catalog.codes.length} mã)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
