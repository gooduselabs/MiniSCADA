// Package builder of the device-it scenarios (specs/005-device-online T126): a .matscada package
// (contracts/matscada-package.md) from a project directory, entries stored, deterministic, the
// manifest first. The ZIP writer is the small one of tests/package-vectors/generate.mjs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const byUtf8 = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** { 'screens/a.svg': Buffer, ... } from the .json and .svg files under `dir` (relative, '/'). */
export function readProjectDir(dir) {
  const files = {};
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(join(dir, r)).isDirectory()) walk(r);
      else if (/\.(json|svg)$/.test(name)) files[r] = readFileSync(join(dir, r));
    }
  };
  walk('');
  return files;
}

/** The digest of section 4 of the contract, from [{ path, size, sha256 }]. */
export function digestOf(list) {
  const text = [...list]
    .sort((a, b) => byUtf8(a.path, b.path))
    .map((f) => `${f.sha256} ${f.size} ${f.path}\n`)
    .join('');
  return `sha256:${sha256(Buffer.from(text, 'utf8'))}`;
}

function le(fields) {
  const b = Buffer.alloc(fields.reduce((n, [size]) => n + size, 0));
  let o = 0;
  for (const [size, v] of fields) {
    if (size === 2) b.writeUInt16LE(v, o);
    else b.writeUInt32LE(v >>> 0, o);
    o += size;
  }
  return b;
}

function storedZip(entries) {
  const parts = [];
  const central = [];
  let pos = 0;
  for (const [path, data] of entries) {
    const name = Buffer.from(path, 'utf8');
    const crc = crc32(data);
    const head = (sig, extra) =>
      le([
        [4, sig],
        ...extra,
        [2, 0x0800], // flags: UTF-8 names
        [2, 0], // stored
        [2, 0],
        [2, 0x21],
        [4, crc],
        [4, data.length],
        [4, data.length],
        [2, name.length],
        [2, 0],
      ]);
    // local header: version needed 20 before the flags
    const local = Buffer.concat([head(0x04034b50, [[2, 20]]), name]);
    parts.push(local, data);
    // central: version made by 20, version needed 20, then the same fields, comment 0, disk 0,
    // internal attrs 0, external attrs 0, offset
    const c = head(0x02014b50, [
      [2, 20],
      [2, 20],
    ]);
    central.push(
      Buffer.concat([
        c,
        le([
          [2, 0],
          [2, 0],
          [2, 0],
          [4, 0],
          [4, pos],
        ]),
        name,
      ]),
    );
    pos += local.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = le([
    [4, 0x06054b50],
    [2, 0],
    [2, 0],
    [2, entries.length],
    [2, entries.length],
    [4, cd.length],
    [4, pos],
    [2, 0],
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}

/** Builds the package of `files` ({ path: Buffer|string }). Returns { bytes, digest, manifest }. */
export function buildPackage(files) {
  const data = {};
  for (const [p, v] of Object.entries(files)) data[p] = Buffer.isBuffer(v) ? v : Buffer.from(v);
  const list = Object.keys(data)
    .sort(byUtf8)
    .map((p) => ({ path: p, size: data[p].length, sha256: sha256(data[p]) }));
  const p = JSON.parse(data['project.json'].toString('utf8'));
  const manifest = {
    format: 'matscada-package',
    formatVersion: '1.0.0',
    project: {
      projectId: p.projectId,
      projectName: p.projectName,
      projectVersion: p.projectVersion,
      minRuntimeVersion: p.minRuntimeVersion,
    },
    createdAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    generator: { name: 'device-it pack.mjs', version: '1.0.0' },
    files: list,
    digest: digestOf(list),
  };
  const entries = [['matscada.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)]];
  for (const f of list) entries.push([f.path, data[f.path]]);
  return { bytes: storedZip(entries), digest: manifest.digest, manifest };
}

/** The manifest of a package built by buildPackage (first entry, stored). */
export function manifestOf(bytes) {
  if (bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('not a ZIP');
  const csize = bytes.readUInt32LE(18);
  const n = bytes.readUInt16LE(26);
  const m = bytes.readUInt16LE(28);
  const start = 30 + n + m;
  return JSON.parse(bytes.subarray(start, start + csize).toString('utf8'));
}

/** `files` with project.json's projectVersion and optional replacements of other files. */
export function variant(files, { projectVersion, replace = {}, add = {} } = {}) {
  const out = { ...files, ...replace, ...add };
  if (projectVersion) {
    const p = JSON.parse(out['project.json'].toString('utf8'));
    p.projectVersion = projectVersion;
    out['project.json'] = Buffer.from(`${JSON.stringify(p, null, 2)}\n`);
  }
  return out;
}
