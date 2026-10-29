// Sửa lỗi 042: lỗi schema chỉ báo ở chỗ sâu nhất (không báo "Trường groups không hợp lệ" ở gốc, không báo lỗi ở
// /groups/0 làm tô đỏ cột Chế độ); ước tính ghi của nhóm 0 Tag bằng 0.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';
import { estimateLogging } from './logging.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/logging-valid');

function files(dir: string, base = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const rel = base ? `${base}/${n}` : n;
    if (statSync(p).isDirectory()) Object.assign(out, files(p, rel));
    else if (n !== 'expected.json') out[rel] = readFileSync(p, 'utf8');
  }
  return out;
}

async function loggingErrors(mutate: (g: Record<string, unknown>) => void) {
  const f = files(DIR);
  const log = JSON.parse(f['logging.json']!);
  mutate(log.groups[0]);
  f['logging.json'] = JSON.stringify(log);
  const r = await validateProject(new MemorySource(f));
  return r.errors.filter((e) => e.file === 'logging.json');
}

describe('lỗi schema sâu nhất (042)', () => {
  it('nhóm 0 Tag: một lỗi duy nhất ở /groups/0/tags', async () => {
    const errs = await loggingErrors((g) => (g.tags = []));
    expect(errs.map((e) => [e.code, e.path])).toEqual([['E_SCHEMA', '/groups/0/tags']]);
    expect(errs[0]!.message).toMatch(/too few items \(0 < 1\)/);
  });

  it('thuộc tính thừa thật vẫn báo ở nhóm', async () => {
    const errs = await loggingErrors((g) => (g.foo = 1));
    expect(errs.map((e) => e.path)).toEqual(['/groups/0']);
    expect(errs[0]!.message).toMatch(/Property "foo"/);
  });

  it('chu kỳ sai báo ở /periodMs, không ở gốc', async () => {
    const errs = await loggingErrors((g) => {
      g.mode = 'cyclic';
      g.periodMs = 5;
    });
    expect(errs.map((e) => e.path)).toEqual(['/groups/0/periodMs']);
  });
});

describe('ước tính nhóm 0 Tag (042)', () => {
  it('0 Tag → 0 byte; 1 Tag FLOAT32 mỗi 1 s ≈ 430 MB/ngày (commit chiếm phần lớn)', () => {
    const g = { id: 'g', name: 'G', mode: 'cyclic' as const, periodMs: 1000, retentionDays: 30 };
    const zero = estimateLogging(
      { schemaVersion: '1.0.0', groups: [{ ...g, tags: [] }] },
      new Map(),
    );
    expect(zero.writeBytesPerDay).toBe(0);
    expect(zero.storageBytes).toBe(0);
    expect(zero.daysToFillCap).toBeNull();
    const one = estimateLogging(
      { schemaVersion: '1.0.0', groups: [{ ...g, tags: [{ tagId: 'T' }] }] },
      new Map([['T', 'FLOAT32']]),
    );
    expect(one.writeBytesPerDay).toBe(2 * 86_400 * 33 + 17_280 * 6 * 4096);
  });
});
