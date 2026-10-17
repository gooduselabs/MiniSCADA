// Rà license của bản phát hành (feature 011, T057; FR-027, FR-052, D16).
//
//   node tools/release/license-report.mjs --out release/<ver>/licenses.md
//        [--root <repo>] [--cargo-metadata auto|none|<tệp JSON>] [--json <tệp>]
//
// Đọc `package-lock.json` (và `node_modules/*/package.json` khi lock không có `license`), `Cargo.lock` kèm license
// từ `cargo metadata` (mặc định `auto`: chạy `cargo metadata --locked` nếu có `cargo`), `third_party/LICENSES.md`
// (thư viện vendored và bảng "Ghi đè license"). Chính sách: lib/license-policy.mjs.
// Mã thoát: 0 sạch (có thể có cảnh báo), 1 có thành phần bị từ chối hoặc không rõ license trong bản phân phối,
// 2 dùng sai. Gói chỉ dùng khi phát triển (`dev` trong lock, "chỉ test" trong LICENSES.md) bị từ chối hay không rõ
// thì chỉ cảnh báo: chúng không vào bộ cài hay gói thiết bị.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectComponents, runCargoMetadata } from './lib/components.mjs';
import { classifyLicense } from './lib/license-policy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const SOURCE_LABEL = {
  'package-lock.json': 'package-lock',
  node_modules: 'node_modules',
  'cargo metadata': 'cargo metadata',
  'third_party/LICENSES.md': 'third_party',
  override: 'ghi đè',
  own: 'mã của dự án',
};

/** Phân loại từng thành phần và gom lỗi. */
export function buildLicenseReport(collected) {
  const rows = collected.components.map((c) => {
    const { verdict, chosen } = c.own
      ? { verdict: 'allowed', chosen: c.license }
      : classifyLicense(c.license);
    return { ...c, verdict, chosen };
  });
  const blocking = [];
  const warnings = [];
  const cargoMissing = collected.cargoLicenses === 'none' && collected.counts.cargo > 0;
  if (cargoMissing) {
    blocking.push(
      `không có license của ${collected.counts.cargo} crate: thiếu cargo metadata (cài Rust hoặc truyền --cargo-metadata <tệp>)`,
    );
  }
  for (const r of rows) {
    if (r.verdict !== 'denied' && r.verdict !== 'unknown') continue;
    if (cargoMissing && r.ecosystem === 'cargo' && r.licenseSource === null) continue;
    const line = `${r.ecosystem}:${r.name}@${r.version}: ${r.verdict === 'denied' ? 'license bị cấm' : 'không rõ license'} (${r.license ?? 'không khai báo'})`;
    (r.dev ? warnings : blocking).push(r.dev ? `${line}, chỉ khi phát triển` : line);
  }
  const byLicense = new Map();
  for (const r of rows) {
    const k = r.license ?? '(không khai báo)';
    byLicense.set(k, (byLicense.get(k) ?? 0) + 1);
  }
  return {
    rows,
    counts: collected.counts,
    overridesUsed: collected.overridesUsed,
    cargoLicenses: collected.cargoLicenses,
    blocking,
    warnings,
    byLicense: [...byLicense.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    conditional: rows.filter((r) => r.verdict === 'conditional'),
    denied: rows.filter((r) => r.verdict === 'denied'),
    unknown: rows.filter((r) => r.verdict === 'unknown'),
  };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');

/** licenses.md (không có thời điểm chạy: cùng đầu vào cùng đầu ra). */
export function renderLicensesMd(rep) {
  const L = [];
  L.push('# License các thành phần của mAT SCADA', '');
  L.push(
    'Sinh bằng `tools/release/license-report.mjs` từ `package-lock.json`, `apps/studio/src-tauri/Cargo.lock` ' +
      `(license theo ${rep.cargoLicenses === 'none' ? '**không có** `cargo metadata`' : '`cargo metadata`'}) ` +
      'và `third_party/LICENSES.md`. Chính sách: không phân phối GPL, AGPL, LGPL (link tĩnh) hay license không rõ; ' +
      'MPL-2.0 dùng được khi không sửa mã thư viện (copyleft mức tệp, kèm nơi lấy mã nguồn).',
    '',
  );
  L.push('## Tóm tắt', '');
  L.push(
    `- npm: ${rep.counts.npm} gói; Cargo: ${rep.counts.cargo} crate; vendored: ${rep.counts.vendored} thư viện.`,
  );
  L.push(`- Từ chối: ${rep.blocking.length}.`);
  L.push(`- Không rõ license: ${rep.unknown.length} (kể cả gói chỉ khi phát triển).`);
  L.push(`- Có điều kiện (MPL): ${rep.conditional.length}.`);
  L.push(`- Cảnh báo (chỉ khi phát triển): ${rep.warnings.length}.`);
  L.push(`- Ghi đè license từ \`third_party/LICENSES.md\`: ${rep.overridesUsed.length}.`, '');
  if (rep.blocking.length) {
    L.push('### Bị từ chối', '', ...rep.blocking.map((b) => `- ${b}`), '');
  }
  if (rep.warnings.length) {
    L.push('### Cảnh báo', '', ...rep.warnings.map((b) => `- ${b}`), '');
  }
  L.push('## Theo license', '', '| License | Số thành phần |', '|---|---|');
  for (const [k, n] of rep.byLicense) L.push(`| ${cell(k)} | ${n} |`);
  L.push('');
  if (rep.conditional.length) {
    L.push(
      '## Có điều kiện',
      '',
      '| Thành phần | Phiên bản | License | Phạm vi |',
      '|---|---|---|---|',
    );
    for (const r of rep.conditional) {
      L.push(
        `| ${cell(r.name)} (${r.ecosystem}) | ${cell(r.version)} | ${cell(r.license)} | ${r.dev ? 'chỉ khi phát triển' : 'phân phối'} |`,
      );
    }
    L.push('');
  }
  for (const [eco, title] of [
    ['vendored', 'Thư viện vendored (`third_party/`)'],
    ['npm', 'Gói npm'],
    ['cargo', 'Crate Rust (Studio)'],
  ]) {
    const list = rep.rows.filter((r) => r.ecosystem === eco);
    if (!list.length) continue;
    L.push(
      `## ${title}`,
      '',
      '| Thành phần | Phiên bản | License | Nguồn license | Phạm vi |',
      '|---|---|---|---|---|',
    );
    for (const r of list) {
      const scope = r.own ? 'mã của dự án' : r.dev ? 'chỉ khi phát triển' : 'phân phối';
      L.push(
        `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.license ?? 'không khai báo')} | ${SOURCE_LABEL[r.licenseSource] ?? 'không có'} | ${scope} |`,
      );
    }
    L.push('');
  }
  return L.join('\n');
}

function parseArgs(argv) {
  const o = { root: repoRoot, cargoMetadata: 'auto', out: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`thiếu giá trị cho ${a}`);
      return argv[++i];
    };
    if (a === '--root') o.root = resolve(v());
    else if (a === '--cargo-metadata') o.cargoMetadata = v();
    else if (a === '--out') o.out = resolve(v());
    else if (a === '--json') o.json = resolve(v());
    else throw new Error(`tham số lạ: ${a}`);
  }
  if (!o.out) throw new Error('cần --out <licenses.md>');
  return o;
}

/** Đọc cargo metadata theo tham số; trả { metadata, note }. */
export function loadCargoMetadata(spec, root) {
  if (spec === 'none') return { metadata: null, note: 'bỏ cargo metadata theo tham số' };
  if (spec === 'auto') {
    const r = runCargoMetadata(root);
    return { metadata: r.metadata, note: r.reason ? `cargo metadata lỗi: ${r.reason}` : null };
  }
  return { metadata: JSON.parse(readFileSync(resolve(spec), 'utf8')), note: null };
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`license-report: ${e.message}`);
    process.exit(2);
  }
  const { metadata, note } = loadCargoMetadata(o.cargoMetadata, o.root);
  if (note) console.error(`license-report: ${note}`);
  const rep = buildLicenseReport(collectComponents({ root: o.root, cargoMetadata: metadata }));
  writeFileSync(o.out, renderLicensesMd(rep));
  if (o.json) {
    const slim = rep.rows.map(
      ({ ecosystem, name, version, license, licenseSource, verdict, dev, own }) => ({
        ecosystem,
        name,
        version,
        license,
        licenseSource,
        verdict,
        dev,
        own,
      }),
    );
    writeFileSync(
      o.json,
      JSON.stringify(
        { counts: rep.counts, blocking: rep.blocking, warnings: rep.warnings, rows: slim },
        null,
        2,
      ) + '\n',
    );
  }
  for (const w of rep.warnings) console.log(`CẢNH BÁO: ${w}`);
  for (const b of rep.blocking) console.error(`TỪ CHỐI: ${b}`);
  console.log(
    `license-report: ${rep.rows.length} thành phần (npm ${rep.counts.npm}, cargo ${rep.counts.cargo}, vendored ${rep.counts.vendored}); từ chối ${rep.blocking.length}, cảnh báo ${rep.warnings.length}, MPL ${rep.conditional.length} → ${o.out}`,
  );
  process.exit(rep.blocking.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
