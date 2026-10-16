// Sinh `packages/ui-components/README.md` từ `schemas/widgets.catalog.json` (feature 007, T140, FR-079):
//   node tools/gen-widget-docs.mjs            ghi README.md
//   node tools/gen-widget-docs.mjs --check    thoát mã 1 khi README.md lệch danh mục (CI)
// Cùng danh mục thì cùng từng byte. Phần mở đầu (cách nhúng, TagSource, ActionHost) là văn bản cố định ở đây.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'schemas/widgets.catalog.json'), 'utf8'));

const GROUPS = {
  display: 'Hiển thị',
  chart: 'Biểu đồ',
  table: 'Bảng',
  control: 'Điều khiển',
  layout: 'Bố cục',
  alarm: 'Alarm',
  history: 'Lịch sử',
};

const cell = (v) => String(v).replace(/\|/g, '\\|');

function propRange(p) {
  switch (p.kind) {
    case 'int':
    case 'number':
      return [p.min !== undefined ? `≥ ${p.min}` : '', p.max !== undefined ? `≤ ${p.max}` : '']
        .filter(Boolean)
        .join(', ');
    case 'string':
      return p.maxLength !== undefined ? `≤ ${p.maxLength} ký tự` : '';
    case 'enum':
      return (p.options ?? []).map((o) => `\`${o}\``).join(', ');
    case 'array': {
      const items = p.items?.options
        ? `phần tử: ${p.items.options.map((o) => `\`${o}\``).join(', ')}`
        : '';
      const size = [
        p.minItems !== undefined ? `≥ ${p.minItems} phần tử` : '',
        p.maxItems !== undefined ? `≤ ${p.maxItems} phần tử` : '',
        p.unique ? 'không trùng' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return [size, items].filter(Boolean).join('; ');
    }
    case 'object':
      return (p.fields ?? [])
        .map(
          (f) =>
            `\`${f.name}\`${
              f.requiredWhen
                ? ' (bắt buộc khi ' +
                  Object.entries(f.requiredWhen)
                    .map(([k, v]) => `${k} = ${v}`)
                    .join(', ') +
                  ')'
                : ''
            }`,
        )
        .join(', ');
    default:
      return '';
  }
}

function widgetSection(w) {
  const lines = [];
  lines.push(`### \`${w.id}\` (\`<mat-w-${w.id}>\`)`);
  lines.push('');
  lines.push(
    `Nhóm: ${GROUPS[w.group] ?? w.group}. Cỡ mặc định ${w.defaultSize.join(' × ')}, nhỏ nhất ${w.minSize.join(' × ')}.`,
  );
  lines.push('');
  if (w.slots.length) {
    lines.push('| Khe Tag | Bắt buộc | Nhiều Tag | Kiểu | Cần ghi |');
    lines.push('|---|---|---|---|---|');
    for (const s of w.slots)
      lines.push(
        `| \`${s.name}\` | ${s.required ? 'có' : 'không'} | ${s.multi ? `có (≤ ${s.max ?? '?'})` : 'không'} | ${(s.types ?? []).join(', ')} | ${s.needsWrite ? 'có' : 'không'} |`,
      );
    lines.push('');
  }
  if (w.props.length) {
    lines.push('| Thuộc tính | Kiểu | Mặc định | Ràng buộc |');
    lines.push('|---|---|---|---|');
    for (const p of w.props)
      lines.push(
        `| \`${p.name}\` | ${p.kind} | ${p.default === undefined ? (p.fromTag ? `theo Tag (\`${p.fromTag}\`)` : '') : `\`${cell(JSON.stringify(p.default))}\``} | ${cell(propRange(p))} |`,
      );
    lines.push('');
  }
  if (w.events.length) {
    lines.push(
      `Sự kiện: ${w.events.map((e) => `\`${e.name}\` (hành động: ${(e.actions ?? []).map((a) => `\`${a}\``).join(', ')})`).join('; ')}.`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

const out = [];
out.push('# @mat/ui-components');
out.push('');
out.push(
  '<!-- Sinh bởi tools/gen-widget-docs.mjs từ schemas/widgets.catalog.json. Không sửa tay: sửa danh mục rồi chạy lại. -->',
);
out.push('');
out.push(
  `Thư viện widget và màn hình v1 của mAT SCADA (Lit, Shadow DOM, không phụ thuộc framework). Dùng chung cho trang vận hành (\`apps/runtime-web\`) và xem trước của Studio. Danh mục ${catalog.widgets.length} widget (phiên bản danh mục ${catalog.catalogVersion}) nằm ở \`schemas/widgets.catalog.json\`; hai bộ kiểm tra (TS và C++) và Studio đọc cùng tệp đó.`,
);
out.push('');
out.push('## Nhúng');
out.push('');
out.push('```ts');
out.push("import { registerWidgets, type MatScreen } from '@mat/ui-components';");
out.push('registerWidgets(); // đăng ký <mat-w-*> và <mat-screen>');
out.push("const el = document.createElement('mat-screen') as MatScreen;");
out.push(
  'el.screen = screenModel;      // ScreenModel của định dạng 0.3 (toScreenModel cho 0.1 và 0.2)',
);
out.push('el.tags = tagSource;          // TagSource: giá trị, chất lượng, giờ');
out.push('el.host = actionHost;         // ActionHost: ghi, điều hướng, popup');
out.push('el.loadSvg = (p) => store.loadSvg(p);');
out.push('el.loadBindings = (p) => store.loadBindings(p);');
out.push('```');
out.push('');
out.push('## Hai giao diện chủ');
out.push('');
out.push(
  '- `TagSource`: `subscribe(ids, fn)` (trả hàm hủy), `get(id)`, `info(id)`, `now()`, trạng thái kết nối. Trang vận hành dùng `LiveTagSource` (WebSocket live), Studio dùng nguồn mô phỏng hoặc thiết bị.',
);
out.push(
  '- `ActionHost`: `write(spec, onPhase)` (kết quả `ACCEPTED`, `CONFIRMED`, `REJECTED`, `FAILED`, `TIMEOUT`, `UNKNOWN`), `navigate`, `openPopup`, `closePopup`, `session`, `writeBlocked`, `requestLogin`. Mọi lệnh ghi đi qua `ControlController` (khóa theo role, kết nối, chất lượng, giới hạn; hộp xác nhận).',
);
out.push(
  '- `AlarmSource` (feature 009, `.alarms` của `<mat-w-*>`): `snapshot()`, `subscribe(fn)`, `counts()`, `classes()`, `areas()`, `status()`, `now()`; `ActionHost` có thêm `ackAlarms`, `shelveAlarm`, `unshelveAlarm`. Hai widget alarm không có khe Tag và không gọi mạng: chỉ đọc `AlarmSource` và gọi `ActionHost`.',
);
out.push('');
out.push('## An toàn DOM');
out.push('');
out.push(
  'Không dùng `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `unsafeHTML` (ESLint, SC-020). Mọi chữ do người dùng nhập (nhãn, mô tả, `confirmText`, tên Tag) đi qua template Lit hoặc `textContent`; màu qua danh sách trắng.',
);
out.push('');
for (const [gid, gname] of Object.entries(GROUPS)) {
  const ws = catalog.widgets.filter((w) => w.group === gid);
  if (!ws.length) continue;
  out.push(`## Nhóm ${gname}`);
  out.push('');
  for (const w of ws) out.push(widgetSection(w));
}
const text =
  out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
const target = join(root, 'packages/ui-components/README.md');
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // chưa có
  }
  if (current !== text) {
    console.error(
      'packages/ui-components/README.md lệch danh mục: chạy node tools/gen-widget-docs.mjs',
    );
    process.exit(1);
  }
  console.log('README khớp danh mục');
} else {
  writeFileSync(target, text, 'utf8');
  console.log(`đã ghi ${target} (${catalog.widgets.length} widget)`);
}
