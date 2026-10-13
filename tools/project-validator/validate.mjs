// Kiểm tra một thư mục project (0.1, 0.2 hoặc 0.3) bằng bộ kiểm tra dùng chung (@mat/project-schema).
// Dùng: node tools/project-validator/validate.mjs <thư mục project>
//       node tools/project-validator/validate.mjs --migrate <thư mục 0.1 hoặc 0.2>
//       node tools/project-validator/validate.mjs --migrate <thư mục 0.1 hoặc 0.2> --write <thư mục ra>
//       node tools/project-validator/validate.mjs --migrate <thư mục 0.1> <thư mục ra>     (cũ: chỉ lên 0.2)
// Kiểm: in kết quả JSON (contracts/project-format.md). Mã thoát: 0 hợp lệ, 1 không hợp lệ, 2 dùng sai.
// `--migrate` lên 0.3 (0.1 đi qua 0.2): in {ok, changes, backup}, KHÔNG ghi đĩa; thêm `--write <thư mục ra>` thì ghi
// project 0.3 vào đó (phải chưa có hoặc rỗng). Dạng cũ `--migrate <0.1> <ra>` ghi project 0.2 (giữ cho tương thích).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const usage = () => {
  console.error('Dùng: node tools/project-validator/validate.mjs <thư mục project>');
  console.error('      node tools/project-validator/validate.mjs --migrate <thư mục 0.1 hoặc 0.2>');
  console.error(
    '      node tools/project-validator/validate.mjs --migrate <thư mục 0.1 hoặc 0.2> --write <thư mục ra>',
  );
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

/** Ghi các tệp vào `to` (phải chưa có hoặc rỗng), rồi thoát với 2 nếu thư mục ra đã có nội dung. */
function writeFiles(to, files) {
  const dest = resolve(to);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    console.error('Thư mục ra phải rỗng hoặc chưa có.');
    process.exit(2);
  }
  for (const [path, text] of Object.entries(files)) {
    const f = join(dest, path);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
}

const { validateProject, migrate01to02, migrateTo03 } = await import('@mat/project-schema');
const { NodeDirSource } = await import('@mat/project-schema/node');

if (process.argv[2] === '--migrate') {
  const args = process.argv.slice(3);
  const positional = [];
  let write;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--write') {
      write = args[++i];
      if (!write) usage();
    } else if (args[i].startsWith('--')) usage();
    else positional.push(args[i]);
  }
  const from = positional[0];
  if (!isDir(from) || positional.length > 2 || (positional.length === 2 && write !== undefined))
    usage();
  const files = readTree(resolve(from));

  if (positional.length === 2) {
    // dạng cũ: 0.1 -> 0.2, ghi vào thư mục ra
    const dest = positional[1];
    if (existsSync(resolve(dest)) && readdirSync(resolve(dest)).length > 0) {
      console.error('Thư mục ra phải rỗng hoặc chưa có.');
      process.exit(2);
    }
    const r = await migrate01to02(files);
    if (!r.ok) {
      console.log(JSON.stringify({ ok: false, error: r.error }, null, 2));
      process.exit(1);
    }
    writeFiles(dest, r.files);
    console.log(JSON.stringify({ ok: true, changes: r.changes }, null, 2));
    process.exit(0);
  }

  const r = await migrateTo03(files);
  if (!r.ok) {
    console.log(JSON.stringify({ ok: false, error: r.error }, null, 2));
    process.exit(1);
  }
  if (write) writeFiles(write, r.files);
  console.log(
    JSON.stringify(
      { ok: true, written: write ? resolve(write) : null, changes: r.changes, backup: r.backup },
      null,
      2,
    ),
  );
  process.exit(0);
}

const dir = process.argv[2];
if (!isDir(dir)) usage();
const r = await validateProject(new NodeDirSource(resolve(dir)), { checkSvg: false });
const report = { valid: r.valid, errors: r.errors, warnings: r.warnings }; // không in nội dung project
console.log(JSON.stringify(report, null, 2));
process.exit(r.valid ? 0 : 1);
