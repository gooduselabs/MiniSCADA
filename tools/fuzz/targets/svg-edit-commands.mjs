// Mục tiêu fuzz `svg-edit-commands` (T165): bản chạy dài của packages/svg-edit/src/fuzz.test.ts. Mỗi ca là một chuỗi
// 1 đến 5 lệnh (70 % lệnh độc của fuzz-helpers.ts, 30 % lệnh ngẫu nhiên của test-helpers.ts) trên một trong sáu mầm
// tests/svg-editor-fixtures, đẩy qua UndoStack. Bất biến (giống fuzz.test.ts):
//  - lệnh bị từ chối chỉ bằng CommandError và tài liệu không đổi (version, canonical);
//  - sau chuỗi: mọi nút trong allowlist, giới hạn số/độ sâu, uid duy nhất, đếm phần tử đúng (invariants);
//  - văn bản ghi ra qua được bộ lọc DOM của feature 008 (assertAllowlisted), cứ 50 ca một lần;
//  - hoàn tác hết thì canonical bằng ban đầu.
// Mỗi mầm mở một lần mỗi worker; mỗi ca bắt đầu từ trạng thái ban đầu (sau hoàn tác của ca trước). Bộ sinh uid của
// mầm chạy tiếp qua các ca, nên `--case C` chạy lại đúng lệnh nhưng uid mới có thể khác: tái tạo chắc chắn bằng chạy
// lại cả dải `--max-cases C+1` với cùng seed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDom } from '../../svg-import/chrome-util.mjs';

installDom();
const { assertAllowlisted } = await import('../../../packages/svg-import/src/index.ts');
const { CommandError } = await import('../../../packages/svg-edit/src/command.ts');
const { evilCommand, invariants, FUZZ_SEED_FILES } =
  await import('../../../packages/svg-edit/src/fuzz-helpers.ts');
const { canonical, serialize } = await import('../../../packages/svg-edit/src/serialize.ts');
const { open, randomCommand } = await import('../../../packages/svg-edit/src/test-helpers.ts');
const { UndoStack } = await import('../../../packages/svg-edit/src/undo.ts');

const DIR = resolve(import.meta.dirname, '../../../tests/svg-editor-fixtures');

export async function setup() {
  const docs = FUZZ_SEED_FILES.map((f, i) => {
    const doc = open(readFileSync(resolve(DIR, f), 'utf8'), i + 1);
    return { name: f, doc, start: canonical(doc), stack: new UndoStack(doc) };
  });
  return { docs, n: 0 };
}

/** Đầu vào chỉ là (mầm, hạt): lệnh sinh ngay trên tài liệu lúc chạy (cần nút thật). */
export function generate(ctx, r) {
  return { seed: Math.floor(r() * ctx.docs.length), rngSeed: Math.floor(r() * 2 ** 32) };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function check(ctx, input) {
  const problems = [];
  const counters = [];
  const d = ctx.docs[input.seed];
  const { doc, stack } = d;
  const r = mulberry32(input.rngSeed);
  const len = 1 + Math.floor(r() * 5);
  for (let i = 0; i < len; i++) {
    const cmd = r() < 0.7 ? evilCommand(doc, r) : randomCommand(doc, r);
    const v = doc.version;
    const before = i === 0 && r() < 0.05 ? canonical(doc) : null;
    try {
      stack.push(cmd);
      counters.push('applied');
    } catch (e) {
      if (!(e instanceof CommandError)) {
        problems.push(
          'lệnh ném lỗi không phải CommandError: ' + String(e?.stack ?? e).slice(0, 800),
        );
        break;
      }
      counters.push('rejected', 'code:' + e.code);
      if (doc.version !== v) problems.push('lệnh bị từ chối mà version đổi');
      if (before !== null && canonical(doc) !== before)
        problems.push('lệnh bị từ chối mà tài liệu đổi');
    }
  }
  const bad = invariants(doc);
  if (bad !== null) problems.push(bad);
  if (ctx.n++ % 50 === 0)
    try {
      assertAllowlisted(serialize(doc));
    } catch (e) {
      problems.push('bộ lọc DOM 008 từ chối văn bản ghi ra: ' + e.message);
    }
  while (stack.canUndo) stack.undo();
  stack.clear();
  if (canonical(doc) !== d.start) {
    problems.push('hoàn tác không về ban đầu');
    // mở lại mầm để các ca sau không kế thừa trạng thái hỏng
    const fresh = open(readFileSync(resolve(DIR, d.name), 'utf8'), input.seed + 1);
    ctx.docs[input.seed] = {
      name: d.name,
      doc: fresh,
      start: canonical(fresh),
      stack: new UndoStack(fresh),
    };
  }
  return { problems, counters };
}
