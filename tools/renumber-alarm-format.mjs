// Phương án dự phòng của T002 (D28, D29): đổi số phiên bản định dạng project của feature alarm nếu thứ tự phát hành
// với 008 (định dạng 0.4.0) hoặc 010 (0.6.0) đổi nữa.
//   node tools/renumber-alarm-format.mjs --from 0.5.0 --to 0.6.0 [--dry-run] [--root <thư mục>]
// Thay chuỗi `from` (và dạng rút gọn của nó: `/0.5.json` trong `$id`, `"0.5"` trong protocol-version.json, mẫu
// `^0\.5\.\d+$`, `0.5.x`) trong specs/009-alarms/**/*.md, schemas/*.json (không đụng schemas/0.*/ đã đóng băng,
// widgets.catalog.json, protocol-version.json chỉ phần tử `from`) và hằng số `kProjectFormatAlarms`,
// `PROJECT_FORMAT_ALARMS`. Không đụng dòng nhắc danh mục widget (catalog, danh mục), `@mat/ui-components`, hay số
// phiên bản khác (0.4.0 của 3b, runtime, Studio). Tên thư mục vector (`v05-*`) và tên tệp `*-05.ts` giữ nguyên.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_LINE = /catalog|danh mục|ui-components|svg-import|symbols/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Đổi `from` -> `to` (cả hai dạng `M.N.P`) trong một đoạn văn bản; trả đoạn mới. */
export function renumber(text, from, to) {
  const [, fMinor] = from.split('.');
  const [, tMinor] = to.split('.');
  const full = new RegExp(`(?<![\\d.])${esc(from)}(?![\\d])`, 'g');
  const fMinorJson = new RegExp(`/0\\.${fMinor}\\.json`, 'g');
  const fPattern = new RegExp(`0\\\\\\.${fMinor}\\\\\\.`, 'g'); // 0\.5\.
  const fX = new RegExp(`(?<![\\d.])0\\.${fMinor}\\.x`, 'g');
  const fQuoted = new RegExp(`"0\\.${fMinor}"`, 'g');
  return text
    .split('\n')
    .map((line) => {
      if (SKIP_LINE.test(line)) return line;
      return line
        .replace(full, to)
        .replace(fMinorJson, `/0.${tMinor}.json`)
        .replace(fPattern, () => `0\\.${tMinor}\\.`)
        .replace(fX, `0.${tMinor}.x`)
        .replace(fQuoted, `"0.${tMinor}"`);
    })
    .join('\n');
}

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** Các tệp bị đụng tới, tương đối với `root`. */
export function targets(root) {
  const rel = (p) => relative(root, p).replaceAll('\\', '/');
  const files = [
    ...walk(join(root, 'specs/009-alarms'), (p) => p.endsWith('.md')),
    ...readdirSync(join(root, 'schemas'))
      .filter((n) => n.endsWith('.json') && n !== 'widgets.catalog.json')
      .map((n) => join(root, 'schemas', n)),
    join(root, 'core/project-manager/alarm_rules.hpp'),
    join(root, 'packages/project-schema/src/format-05.ts'),
  ];
  return files.filter((p) => existsSync(p)).map(rel);
}

function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const from = arg('--from');
  const to = arg('--to');
  const dry = argv.includes('--dry-run');
  const root = resolve(arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const ok = (v) => typeof v === 'string' && /^0\.\d+\.\d+$/.test(v);
  if (!ok(from) || !ok(to) || from === to) {
    console.error(
      'Dùng: node tools/renumber-alarm-format.mjs --from 0.5.0 --to <số mới> [--dry-run] [--root <thư mục>]',
    );
    return 2;
  }
  let changed = 0;
  for (const f of targets(root)) {
    const before = readFileSync(join(root, f), 'utf8');
    const after = renumber(before, from, to);
    if (after === before) continue;
    changed++;
    const lines = before.split('\n').filter((l, i) => l !== after.split('\n')[i]).length;
    console.log(`${dry ? '[dry-run] ' : ''}${f}: ${lines} dòng`);
    if (!dry) writeFileSync(join(root, f), after);
  }
  console.log(`${changed} tệp ${dry ? 'sẽ đổi' : 'đã đổi'} (${from} -> ${to})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));
