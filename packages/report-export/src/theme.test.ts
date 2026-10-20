// T048 (feature 012, FR-038): màu báo cáo PDF lấy đúng giá trị token của chủ đề (contracts/ui-theme.md), không lệch
// khi tools/gen-theme-tokens.mjs sinh lại CSS. Đọc khối sáng đầu tiên của từng tệp chủ đề.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_PALETTES } from './theme.ts';

const THEMES = resolve(__dirname, '../../ui-components/src/styles/themes');

function lightTokens(name: string): Map<string, string> {
  const css = readFileSync(resolve(THEMES, `${name}.css`), 'utf8');
  const block = /:where\([^)]*\)\s*\{([^}]*)\}/.exec(css)![1]!;
  return new Map(
    [...block.matchAll(/--mat-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

describe('bảng màu báo cáo theo chủ đề', () => {
  for (const name of ['vivid', 'industrial'] as const) {
    it(`${name}: khớp token sáng của themes/${name}.css`, () => {
      const tok = lightTokens(name);
      const p = REPORT_PALETTES[name];
      expect(p.accent).toBe(tok.get('accent'));
      expect(p.accentInk).toBe(tok.get('accent-ink'));
      expect(p.text).toBe(tok.get('text'));
      expect(p.muted).toBe(tok.get('text-muted'));
      expect(p.border).toBe(tok.get('border'));
      expect(p.zebra).toBe(tok.get('surface-2'));
      expect(p.chart).toEqual(Array.from({ length: 12 }, (_, i) => tok.get(`chart-${i + 1}`)));
      expect(p.chartSoft).toEqual(
        Array.from({ length: 12 }, (_, i) => tok.get(`chart-${i + 1}-soft`)),
      );
    });
  }
});
