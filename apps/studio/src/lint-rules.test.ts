// Luật lint riêng của Studio (feature 004, T003): không chèn HTML thô (Constitution V, ADR-009) và
// chuỗi giao diện tiếng Việt chỉ nằm trong src/i18n (FR-014). Mỗi mẫu trong tests/lint-fixtures được
// lint như thể nằm trong src/ui để áp đúng cấu hình của mã Studio.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const FIXTURES = resolve(__dirname, '../tests/lint-fixtures');
const eslint = new ESLint({ cwd: ROOT });

async function ruleIds(
  fixture: string,
  asPath = 'apps/studio/src/ui/fixture.ts',
): Promise<string[]> {
  const code = readFileSync(resolve(FIXTURES, fixture), 'utf8');
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, asPath) });
  return result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe('luật lint của Studio', () => {
  it('chặn directive unsafeHTML của Lit', async () => {
    expect(await ruleIds('unsafe-html.ts')).toContain('no-restricted-imports');
  });

  it('chặn innerHTML, outerHTML, insertAdjacentHTML', async () => {
    const ids = await ruleIds('inner-html.ts');
    expect(ids.filter((r) => r === 'no-restricted-properties')).toHaveLength(3);
  });

  it('chặn chuỗi tiếng Việt có dấu ngoài i18n, cả trong template literal', async () => {
    const ids = await ruleIds('vietnamese-literal.ts');
    expect(ids.filter((r) => r === 'no-restricted-syntax')).toHaveLength(2);
  });

  it('cho phép chuỗi tiếng Việt trong src/i18n', async () => {
    expect(await ruleIds('vietnamese-literal.ts', 'apps/studio/src/i18n/vi.ts')).not.toContain(
      'no-restricted-syntax',
    );
  });

  it('mã sạch không có lỗi', async () => {
    expect(await ruleIds('clean.ts')).toEqual([]);
  });
}, 60_000);
