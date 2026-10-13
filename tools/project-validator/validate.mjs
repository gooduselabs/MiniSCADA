// Kiểm tra một thư mục project (0.1 hoặc 0.2) bằng bộ kiểm tra dùng chung (@mat/project-schema).
// Dùng: node tools/project-validator/validate.mjs <thư mục project>
//       node tools/project-validator/validate.mjs --migrate <thư mục 0.1> <thư mục ra>
// Kiểm: in kết quả JSON (contracts/project-format.md). Mã thoát: 0 hợp lệ, 1 không hợp lệ, 2 dùng sai.
// Nâng cấp: ghi project 0.2 vào thư mục ra (phải chưa có hoặc rỗng); in {ok, changes} hoặc {ok:false, error}.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const usage = () => {
  console.error('Dùng: node tools/project-validator/validate.mjs <thư mục project>');
  console.error(
    '      node tools/project-validator/validate.mjs --migrate <thư mục 0.1> <thư mục ra>',
  );
  process.exit(2);
};
const isDir = (d) => d && existsSync(d) && statSync(d).isDirectory();

function readTree(root, rel = '', out = {}) {
  for (const n of readdirSync(join(root, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(root, r)).isDirectory()) readTree(root, r, out);
    else out[r] = readFileSync(join(root, r), 'utf8');
  }
  return out;
}

const { validateProject, migrate01to02 } = await import('@mat/project-schema');
const { NodeDirSource } = await import('@mat/project-schema/node');

if (process.argv[2] === '--migrate') {
  const [from, to] = [process.argv[3], process.argv[4]];
  if (!isDir(from) || !to) usage();
  const dest = resolve(to);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    console.error('Thư mục ra phải rỗng hoặc chưa có.');
    process.exit(2);
  }
  const r = await migrate01to02(readTree(resolve(from)));
  if (!r.ok) {
    console.log(JSON.stringify({ ok: false, error: r.error }, null, 2));
    process.exit(1);
  }
  for (const [path, text] of Object.entries(r.files)) {
    const f = join(dest, path);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  console.log(JSON.stringify({ ok: true, changes: r.changes }, null, 2));
  process.exit(0);
}

const dir = process.argv[2];
if (!isDir(dir)) usage();
const r = await validateProject(new NodeDirSource(resolve(dir)), { checkSvg: false });
const report = { valid: r.valid, errors: r.errors, warnings: r.warnings }; // không in nội dung project
console.log(JSON.stringify(report, null, 2));
process.exit(r.valid ? 0 : 1);
