// Project của các kịch bản hardening của web-it (feature 011: T053 host-rebind, lockout-dos; T209 write-min-role):
// bản sao projects/dashboard-demo (định dạng 1.0) vào tests/web-it/out/hardening, Tag SIM.MODE có
// `writeMinRole: "engineer"`. Không commit (tests/web-it/out/ bị bỏ qua).
//   node tests/web-it/make-hardening.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../projects/dashboard-demo');
const out = resolve(here, 'out/hardening');
rmSync(out, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
cpSync(src, out, { recursive: true });
// Studio có thể để .mat-editor/, .mat-backup/ trong thư mục: không thuộc project (E_PACKAGE_EXTRA_FILE khi đóng gói).
for (const d of ['.mat-editor', '.mat-backup'])
  rmSync(join(out, d), { recursive: true, force: true });
const file = join(out, 'tags.json');
const tags = JSON.parse(readFileSync(file, 'utf8'));
const t = tags.tags.find((x) => x.id === 'SIM.MODE');
if (!t) throw new Error('dashboard-demo không còn Tag SIM.MODE');
t.writeMinRole = 'engineer';
writeFileSync(file, `${JSON.stringify(tags, null, 2)}\n`);
console.log(out);
