// Dựng trang runtime của bản TRƯỚC feature 008 (cha của commit 008 đầu tiên, tức bản 007 = runtime 0.6) để so tương thích (T107, SC-011):
//   node tests/web-it/build-old-web.mjs <thư mục đích, ví dụ C:/build/w3b-old>
// Xuất mã nguồn (git archive) của apps/runtime-web và packages/ ở commit đó, dựng node_modules bằng junction trỏ vào node_modules của
// repo (trừ @mat: trỏ vào packages của bản cũ), rồi `vite build --mode device`. Không cài gói nào. In đường dẫn dist-device.
// Thư mục đích bị xóa trước khi dựng; xóa tay khi xong việc (ổ C: có hạn).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const target = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !/w3b/i.test(target)) {
  console.error('Dùng: node tests/web-it/build-old-web.mjs <thư mục đích có "w3b" trong tên>');
  process.exit(2);
}
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const first = git('log', '--reverse', '--grep=(008)', '--format=%H').split('\n')[0];
const base = git('rev-parse', `${first}^`);
console.error(`bản trước 008: ${base} (${git('log', '-1', '--format=%s', base)})`);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const tar = execFileSync(
  'git',
  ['archive', '--format=tar', base, 'apps/runtime-web', 'packages', 'package.json'],
  { cwd: REPO, maxBuffer: 1 << 28 },
);
const x = spawnSync('tar', ['-x', '-C', target], { input: tar });
if (x.status !== 0) throw new Error(`tar: ${x.stderr}`);

const nm = join(target, 'node_modules');
mkdirSync(join(nm, '@mat'), { recursive: true });
const repoNm = realpathSync(join(REPO, 'node_modules'));
for (const e of readdirSync(repoNm)) {
  if (e === '@mat') continue;
  const p = join(repoNm, e);
  let real;
  try {
    real = realpathSync(p);
    if (!statSync(real).isDirectory()) continue;
  } catch {
    continue;
  }
  symlinkSync(real, join(nm, e), 'junction');
}
for (const d of readdirSync(join(target, 'packages'))) {
  const pj = join(target, 'packages', d, 'package.json');
  if (!existsSync(pj)) continue;
  const name = JSON.parse(readFileSync(pj, 'utf8')).name; // @mat/<tên>
  if (name?.startsWith('@mat/'))
    symlinkSync(join(target, 'packages', d), join(nm, '@mat', name.slice(5)), 'junction');
}
const vite = join(repoNm, 'vite', 'bin', 'vite.js');
const b = spawnSync(process.execPath, [vite, 'build', '--mode', 'device'], {
  cwd: join(target, 'apps', 'runtime-web'),
  encoding: 'utf8',
});
if (b.status !== 0) {
  console.error(b.stdout, b.stderr);
  process.exit(1);
}
const dist = join(target, 'apps', 'runtime-web', 'dist-device');
console.log(dist);
