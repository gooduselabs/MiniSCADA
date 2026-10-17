// Danh sách thành phần của bản phát hành (feature 011, T057, T095; FR-027, FR-052, D16).
// Nguồn: `package-lock.json` (npm, lockfileVersion 3), `apps/studio/src-tauri/Cargo.lock` (+ license từ
// `cargo metadata` nếu có), bảng thư viện vendored và bảng ghi đè license trong `third_party/LICENSES.md`.
// Dùng chung cho `license-report.mjs` và `sbom.mjs`; chỉ đọc tệp, không mạng, không phụ thuộc npm.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OWN_LICENSE = 'LicenseRef-ATPro-Proprietary';
export const CARGO_LOCK = 'apps/studio/src-tauri/Cargo.lock';

/** purl theo https://github.com/package-url/purl-spec (npm: `@` của scope mã hóa `%40`). */
export function purlOf(ecosystem, name, version) {
  const type = ecosystem === 'vendored' ? 'generic' : ecosystem;
  const n = name.startsWith('@') ? '%40' + name.slice(1) : name;
  return `pkg:${type}/${n}@${version}`;
}

/** Bảng Markdown trong tệp: [{ heading, header: string[], rows: string[][] }]. */
export function markdownTables(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    if (!line.startsWith('|') || !/^\|\s*:?-{3,}/.test(lines[i + 1] ?? '')) continue;
    const cells = (l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
    const t = { heading, header: cells(line), rows: [] };
    i += 2;
    while (i < lines.length && lines[i].startsWith('|')) t.rows.push(cells(lines[i++]));
    i--;
    tables.push(t);
  }
  return tables;
}

const stripTicks = (s) => s.replace(/`/g, '').trim();

/** Đọc `third_party/LICENSES.md`: thư viện vendored và bảng ghi đè license. */
export function readThirdParty(mdPath) {
  const text = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '';
  const vendored = [];
  const overrides = new Map();
  for (const t of markdownTables(text)) {
    const col = (name) => t.header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const [cLib, cVer, cLic, cDir, cUse, cSrc] = [
      'Thư viện',
      'Phiên bản',
      'License',
      'Thư mục',
      'Dùng ở',
      'Nguồn',
    ].map(col);
    if (cLib >= 0 && cVer >= 0 && cLic >= 0 && cDir >= 0) {
      for (const r of t.rows) {
        const dir = /`([^`]+)`/.exec(r[cDir])?.[1] ?? r[cDir];
        const slug = dir.split('/')[0].trim();
        const version = /^(draft-\d+|\d[\w.+-]*)/.exec(r[cVer].trim())?.[1] ?? r[cVer].trim();
        let license = r[cLic].split(' (')[0].trim();
        if (/^public domain$/i.test(license)) license = 'LicenseRef-Public-Domain';
        const src = cSrc >= 0 ? r[cSrc] : '';
        const url = /https?:\/\/[^\s,)]+/.exec(src)?.[0] ?? null;
        const hashes = [];
        const hm = /(SHA3-256|SHA-256|SHA-512)\s+`([0-9a-f]{64,128})`/.exec(src);
        if (hm) hashes.push({ alg: hm[1], content: hm[2] });
        vendored.push({
          ecosystem: 'vendored',
          name: slug,
          displayName: r[cLib].replace(/\*\*/g, ''),
          version,
          license,
          licenseSource: 'third_party/LICENSES.md',
          licenseNote: r[cLic],
          dev: cUse >= 0 && /chỉ test/i.test(r[cUse]),
          own: false,
          url,
          hashes,
          paths: [`third_party/${slug}`],
        });
      }
    }
    const cKey = col('Thành phần');
    const cWhy = col('Lý do');
    if (cKey >= 0 && cLic >= 0 && cWhy >= 0) {
      for (const r of t.rows) overrides.set(stripTicks(r[cKey]), { license: r[cLic].trim(), reason: r[cWhy] });
    }
  }
  return { vendored, overrides };
}

function licenseString(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v.type === 'string') return v.type;
  if (Array.isArray(v)) return v.map(licenseString).filter(Boolean).join(' OR ') || null;
  return null;
}

function npmHash(integrity) {
  const m = /^(sha512|sha256|sha1)-(.+)$/.exec(integrity ?? '');
  if (!m) return [];
  const alg = { sha512: 'SHA-512', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]];
  return [{ alg, content: Buffer.from(m[2], 'base64').toString('hex') }];
}

/** Gói npm từ `package-lock.json` (bỏ gốc và mục `link`; gộp cùng tên và phiên bản). */
export function readNpm(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const out = new Map();
  for (const [key, v] of Object.entries(lock.packages ?? {})) {
    if (key === '' || v.link) continue;
    const idx = key.lastIndexOf('node_modules/');
    const name = v.name ?? (idx >= 0 ? key.slice(idx + 'node_modules/'.length) : key);
    const own = idx < 0;
    const id = `${name}@${v.version}`;
    const prev = out.get(id);
    if (prev) {
      prev.paths.push(key);
      prev.dev = prev.dev && v.dev === true;
      continue;
    }
    let license = licenseString(v.license);
    let licenseSource = license ? 'package-lock.json' : null;
    if (!license && !own) {
      const pj = join(root, key, 'package.json');
      if (existsSync(pj)) {
        try {
          license = licenseString(JSON.parse(readFileSync(pj, 'utf8')).license);
          if (license) licenseSource = 'node_modules';
        } catch {
          /* package.json hỏng: coi như không khai báo */
        }
      }
    }
    out.set(id, {
      ecosystem: 'npm',
      name,
      version: v.version,
      license: own ? OWN_LICENSE : license,
      licenseSource: own ? 'own' : licenseSource,
      dev: v.dev === true,
      own,
      url: v.resolved ?? null,
      hashes: npmHash(v.integrity),
      paths: [key],
    });
  }
  return [...out.values()];
}

/** Gói từ `Cargo.lock` (định dạng TOML cố định của Cargo, đọc theo dòng). */
export function readCargoLock(path) {
  const text = readFileSync(path, 'utf8');
  const out = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const get = (k) => new RegExp(`^${k} = "([^"]*)"`, 'm').exec(block)?.[1] ?? null;
    out.push({
      name: get('name'),
      version: get('version'),
      source: get('source'),
      checksum: get('checksum'),
    });
  }
  return out;
}

/** Chạy `cargo metadata` cho Studio; null nếu không có `cargo` hay lệnh lỗi (kèm lý do). */
export function runCargoMetadata(root) {
  const cwd = join(root, 'apps/studio/src-tauri');
  const r = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    return { metadata: null, reason: r.error ? r.error.message : (r.stderr || '').trim().split('\n').pop() };
  }
  return { metadata: JSON.parse(r.stdout), reason: null };
}

/**
 * Gom mọi thành phần.
 * @param {{ root: string, cargoMetadata?: object|null, npm?: boolean, cargo?: boolean, vendored?: boolean }} opt
 */
export function collectComponents(opt) {
  const { root, cargoMetadata = null } = opt;
  const tp = readThirdParty(join(root, 'third_party/LICENSES.md'));
  const overridesUsed = [];
  const applyOverride = (c) => {
    const key = `${c.ecosystem}:${c.name}@${c.version}`;
    const o = tp.overrides.get(key);
    if (o) {
      c.license = o.license;
      c.licenseSource = 'override';
      c.licenseNote = o.reason;
      overridesUsed.push(key);
    }
    return c;
  };

  const components = [];
  if (opt.npm !== false) components.push(...readNpm(root).map(applyOverride));

  let cargoCount = 0;
  if (opt.cargo !== false && existsSync(join(root, CARGO_LOCK))) {
    const lic = new Map();
    for (const p of cargoMetadata?.packages ?? []) lic.set(`${p.name}@${p.version}`, p.license ?? null);
    const seen = new Set();
    for (const p of readCargoLock(join(root, CARGO_LOCK))) {
      const id = `${p.name}@${p.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const own = p.source === null;
      const license = own ? OWN_LICENSE : (lic.get(id) ?? null);
      components.push(
        applyOverride({
          ecosystem: 'cargo',
          name: p.name,
          version: p.version,
          license,
          licenseSource: own ? 'own' : license ? 'cargo metadata' : null,
          dev: false,
          own,
          url: own ? null : `https://crates.io/crates/${p.name}/${p.version}`,
          hashes: p.checksum ? [{ alg: 'SHA-256', content: p.checksum }] : [],
          paths: [CARGO_LOCK],
        }),
      );
    }
    cargoCount = seen.size;
  }

  if (opt.vendored !== false) components.push(...tp.vendored.map(applyOverride));

  for (const c of components) c.purl = purlOf(c.ecosystem, c.name, c.version);
  components.sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  const count = (e) => components.filter((c) => c.ecosystem === e).length;
  return {
    components,
    counts: { npm: count('npm'), cargo: cargoCount, vendored: count('vendored') },
    overridesUsed,
    cargoLicenses: cargoMetadata ? 'cargo metadata' : 'none',
  };
}
