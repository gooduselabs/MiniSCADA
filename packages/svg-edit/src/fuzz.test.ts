// T155, T165 (SC-034; FR-029, FR-109): fuzz lệnh 100.000 chuỗi (hạt cố định): lệnh ngẫu nhiên, nhiều lệnh độc (on*,
// javascript:, url ngoài, script, foreignObject, bom use, vòng cha con, chữ có ký tự điều khiển…). Sau mỗi chuỗi:
// mọi trạng thái nằm trong allowlist và giới hạn; hoàn tác hết ⇒ canonical bằng ban đầu. Cứ 2.000 chuỗi, kiểm chéo
// bằng bộ lọc DOM của feature 008 (`assertAllowlisted` trên văn bản đã ghi).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAllowlisted } from '@mat/svg-import';
import { CommandError } from './command.ts';
import { evilCommand, FUZZ_SEED_FILES, invariants } from './fuzz-helpers.ts';
import { canonical, serialize } from './serialize.ts';
import { open, randomCommand, rng } from './test-helpers.ts';
import { UndoStack } from './undo.ts';

const SEEDS = FUZZ_SEED_FILES.map((f) =>
  readFileSync(resolve(__dirname, '../../../tests/svg-editor-fixtures', f), 'utf8'),
);

describe('fuzz lệnh: 100.000 chuỗi (hạt cố định)', () => {
  it('mọi trạng thái trong allowlist và giới hạn; hoàn tác hết về ban đầu', () => {
    const N = 100_000;
    let applied = 0;
    let rejected = 0;
    const codes: Record<string, number> = {};
    for (let s = 0; s < SEEDS.length; s++) {
      const doc = open(SEEDS[s], s + 1);
      const start = canonical(doc);
      const stack = new UndoStack(doc);
      const per = Math.ceil(N / SEEDS.length);
      for (let seq = 0; seq < per; seq++) {
        const r = rng(0x5eed + s * 1_000_003 + seq);
        const len = 1 + Math.floor(r() * 5);
        for (let i = 0; i < len; i++) {
          const cmd = r() < 0.7 ? evilCommand(doc, r) : randomCommand(doc, r);
          const v = doc.version;
          const before = seq % 97 === 0 ? canonical(doc) : null;
          try {
            stack.push(cmd);
            applied++;
          } catch (e) {
            if (!(e instanceof CommandError)) throw e;
            rejected++;
            codes[e.code] = (codes[e.code] ?? 0) + 1;
            // lệnh bị từ chối: tài liệu không đổi
            expect(doc.version).toBe(v);
            if (before !== null) expect(canonical(doc)).toBe(before);
          }
        }
        const bad = invariants(doc);
        if (bad !== null) throw new Error(`chuỗi ${s}/${seq}: ${bad}`);
        if (seq % 2000 === 0) assertAllowlisted(serialize(doc));
        while (stack.canUndo) stack.undo();
        stack.clear();
        if (canonical(doc) !== start)
          throw new Error(`chuỗi ${s}/${seq}: hoàn tác không về ban đầu`);
      }
    }
    expect(applied + rejected).toBeGreaterThan(N);
    expect(applied).toBeGreaterThan(10_000);
    expect(Object.keys(codes).sort()).toEqual(
      expect.arrayContaining(['SVG_INVALID', 'SVG_LOCKED', 'SVG_UNSAFE']),
    );
  }, 600_000);
});
