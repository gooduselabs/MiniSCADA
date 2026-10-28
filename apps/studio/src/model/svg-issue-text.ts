// Câu lỗi dễ hiểu cho một dòng của tab Gắn Tag (feature 032): lỗi schema thô (ajv, E_SCHEMA) của một binding được gom
// thành đúng một câu tiếng Việt chỉ chỗ cần điền theo cách đổi đang chọn; vài mã luật quen thuộc cũng có câu riêng.
import type { Binding04 } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { Severity } from './issue-map.ts';
import type { SvgIssue } from './svg-issues.ts';

export interface RowIssueText {
  severity: Severity;
  /** Mã gốc (để test, thuộc tính data); không hiện mã E_SCHEMA. */
  code: string;
  text: string;
}

const outWord = (rowId: string | undefined): string =>
  rowId === 'fill' || rowId === 'stroke' ? t('svb.fix.outColor') : t('svb.fix.outValue');

/** Câu thay cho mọi lỗi schema của binding `b` (dòng `rowId`). */
export function schemaFixText(b: Binding04 | undefined, rowId: string | undefined): string {
  const tr = b?.transform as
    { kind?: string; cases?: unknown[]; ranges?: unknown[]; table?: string } | undefined;
  switch (tr?.kind) {
    case 'discreteMap':
      return t('svb.fix.discrete', { out: outWord(rowId) });
    case 'rangeMap':
      return t('svb.fix.range', { out: outWord(rowId) });
    case 'linearScale':
      return t('svb.fix.linear');
    case 'valueTable':
      return t('svb.fix.table');
    default:
      return t('svb.fix.generic');
  }
}

const KNOWN: Readonly<Record<string, MessageKey>> = {
  E_REF_TABLE: 'svb.fix.table',
  E_SCALE_RANGE: 'svb.fix.scaleRange',
  E_TYPE_MISMATCH: 'svb.fix.typeMismatch',
};

/** Danh sách câu hiển thị của một dòng: mọi E_SCHEMA gộp thành một câu; mã quen có câu riêng; còn lại giữ thông điệp. */
export function rowIssueTexts(
  issues: readonly SvgIssue[],
  b: Binding04 | undefined,
  rowId: string | undefined,
): RowIssueText[] {
  const out: RowIssueText[] = [];
  const seen = new Set<string>();
  for (const i of issues) {
    const code = i.issue.code;
    let text: string;
    if (code === 'E_SCHEMA') text = schemaFixText(b, rowId);
    else if (KNOWN[code] !== undefined) text = t(KNOWN[code]);
    else text = i.issue.message;
    const key = `${i.severity}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity: i.severity, code, text });
  }
  return out;
}
