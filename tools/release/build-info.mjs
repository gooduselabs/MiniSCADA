// build-info.json của bản phát hành và kiểm phiên bản đồng nhất (feature 011, T098; FR-052, FR-055).
//
//   node tools/release/build-info.mjs versions [--root <repo>] [--expect <ver>]   mã thoát 1 khi lệch
//   node tools/release/build-info.mjs write --out <tệp> --version <ver> [--release] [--release-seq <n>]
//        [--sign-mode m] [--thumbprint t] [--timestamp-url u] [--release-key-id k] [--skipped a,b] [--root <repo>]
//   node tools/release/build-info.mjs next-seq --file release/releaseSeq.txt
//
// Nguồn phiên bản (contract release-signing §7 bước 1): apps/studio/package.json, tauri.conf.json, Cargo.toml của
// Studio, `project(... VERSION ...)` của CMakeLists.txt (CMake chỉ nhận số: so phần số; chưa khai thì bỏ qua) và
// `kRuntimeVersion` của runtime (core/project-manager/project_validator.hpp).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTreeState } from './gate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

export function readVersions(root) {
  const pkg = readText(join(root, 'apps/studio/package.json'));
  const conf = readText(join(root, 'apps/studio/src-tauri/tauri.conf.json'));
  const cargo = readText(join(root, 'apps/studio/src-tauri/Cargo.toml')) ?? '';
  const cmake = readText(join(root, 'CMakeLists.txt')) ?? '';
  const hpp = readText(join(root, 'core/project-manager/project_validator.hpp')) ?? '';
  const pkgSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? '';
  return {
    studioPackage: pkg ? JSON.parse(pkg).version : null,
    tauriConf: conf ? JSON.parse(conf).version : null,
    cargoToml: /^version\s*=\s*"([^"]+)"/m.exec(pkgSection)?.[1] ?? null,
    cmake: /project\s*\([^)]*\bVERSION\s+([0-9][0-9.]*)/i.exec(cmake)?.[1] ?? null,
    runtime: /kRuntimeVersion\s*=\s*"([^"]+)"/.exec(hpp)?.[1] ?? null,
  };
}

const numeric = (v) => String(v).split(/[-+]/)[0];

/** { consistent, version, mismatches[] }; `expected` (nếu có) phải bằng mọi nguồn. */
export function checkVersions(v, expected = null) {
  const target = expected ?? v.studioPackage ?? v.runtime;
  const mismatches = [];
  for (const [k, val] of Object.entries(v)) {
    if (k === 'cmake') {
      if (val !== null && val !== numeric(target))
        mismatches.push(`cmake: ${val} ≠ ${numeric(target)}`);
      continue;
    }
    if (val === null) mismatches.push(`${k}: không đọc được`);
    else if (val !== target) mismatches.push(`${k}: ${val} ≠ ${target}`);
  }
  return { consistent: mismatches.length === 0, version: target, mismatches };
}

/** Số releaseSeq của lần phát hành này: số trong tệp + 1 (không có tệp: 1). */
export function nextReleaseSeq(file) {
  if (!existsSync(file)) return 1;
  const t = readFileSync(file, 'utf8').trim();
  if (!/^\d+$/.test(t)) throw new Error(`releaseSeq.txt không phải số: ${file}`);
  return Number(t) + 1;
}

function toolVersion(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split('\n')[0].trim() || null;
}

export function makeBuildInfo(o) {
  const tree = readTreeState(o.root, { ignore: o.ignore ?? [] });
  return {
    version: o.version,
    releaseSeq: o.releaseSeq,
    commit: tree?.commit ?? null,
    dirty: tree ? tree.dirty : null,
    builtAt: new Date().toISOString(),
    release: o.release === true,
    versions: readVersions(o.root),
    tools: {
      node: process.version,
      npm: toolVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
      rustc: toolVersion('rustc', ['--version']),
      cargo: toolVersion('cargo', ['--version']),
      cmake: toolVersion('cmake', ['--version']),
      platform: `${process.platform}-${process.arch}`,
    },
    signing: {
      mode: o.signMode ?? null,
      thumbprint: o.thumbprint ?? null,
      timestampUrl: o.timestampUrl ?? null,
      releaseKeyId: o.releaseKeyId ?? null,
    },
    skipped: o.skipped ?? [],
  };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = { root: repoRoot };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--release') {
      o.release = true;
      continue;
    }
    if (!a.startsWith('--') || i + 1 >= rest.length) {
      console.error(`build-info: tham số sai ${a}`);
      process.exit(2);
    }
    o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
  }
  o.root = resolve(o.root);
  if (cmd === 'versions') {
    const r = checkVersions(readVersions(o.root), o.expect ?? null);
    console.log(JSON.stringify(r));
    for (const m of r.mismatches) console.error(`lệch phiên bản: ${m}`);
    process.exit(r.consistent ? 0 : 1);
  } else if (cmd === 'next-seq') {
    if (!o.file) process.exit(2);
    console.log(nextReleaseSeq(o.file));
  } else if (cmd === 'write') {
    if (!o.out || !o.version) {
      console.error('build-info: write cần --out và --version');
      process.exit(2);
    }
    const bi = makeBuildInfo({
      ...o,
      releaseSeq: o.releaseSeq ? Number(o.releaseSeq) : null,
      skipped: o.skipped ? o.skipped.split(',').filter(Boolean) : [],
      ignore: o.ignore ? o.ignore.split(',') : [],
    });
    writeFileSync(o.out, JSON.stringify(bi, null, 2) + '\n');
    console.log(
      `build-info: ${bi.version} seq ${bi.releaseSeq} commit ${bi.commit?.slice(0, 12)} → ${o.out}`,
    );
  } else {
    console.error('build-info: lệnh versions | write | next-seq');
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
