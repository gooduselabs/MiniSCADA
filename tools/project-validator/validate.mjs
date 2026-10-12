// Kiểm tra một thư mục project v0 bằng bộ kiểm tra dùng chung (@mat/project-schema).
// Dùng: node tools/project-validator/validate.mjs <thư mục project>
// In kết quả JSON (contracts/project-format.md). Mã thoát: 0 hợp lệ, 1 không hợp lệ, 2 dùng sai.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = process.argv[2];
if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error('Dùng: node tools/project-validator/validate.mjs <thư mục project>');
  process.exit(2);
}

const { validateProject } = await import('@mat/project-schema');
const { NodeDirSource } = await import('@mat/project-schema/node');

const r = await validateProject(new NodeDirSource(resolve(dir)), { checkSvg: false });
const report = { valid: r.valid, errors: r.errors, warnings: r.warnings }; // không in nội dung project
console.log(JSON.stringify(report, null, 2));
process.exit(r.valid ? 0 : 1);
