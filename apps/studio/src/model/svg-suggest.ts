// Gợi ý gắn Tag (feature 008, T068; contract studio-svg-editor §6). Hàm thuần: nhận loại và tên phần tử cùng Tag, trả danh
// sách đề nghị để người dùng chấp nhận hoặc bỏ; KHÔNG BAO GIỜ tự áp dụng.
import type { Binding04 } from '@mat/project-schema';
import { fold } from '../i18n/index.ts';
import { SUGGEST_KEYWORDS, type KeywordGroup } from '../i18n/svg-suggest-keywords.ts';
import {
  newBinding,
  tagClassOf04,
  type ElementKind,
  type RowId,
  type TransformKind04,
} from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';

export interface Suggestion {
  rowId: RowId;
  tagId: string;
  binding: Omit<Binding04, 'id'>;
  /** Khóa i18n của lý do (`svg.suggest.<reason>`). */
  reason:
    'text-number' | 'text-table' | 'level' | 'fill-bool' | 'fill-table' | 'spin' | 'flow' | 'alarm';
}

const FOLDED: Record<KeywordGroup, string[]> = {
  level: SUGGEST_KEYWORDS.level.map(fold),
  spin: SUGGEST_KEYWORDS.spin.map(fold),
  alarm: SUGGEST_KEYWORDS.alarm.map(fold),
};

/** Tên chứa một từ khóa của nhóm (không phân biệt hoa thường và dấu). */
export const nameHas = (name: string, group: KeywordGroup): boolean => {
  const n = fold(name);
  return FOLDED[group].some((k) => n.includes(k));
};

export function suggest(kind: ElementKind, name: string, tag: TagInfo): Suggestion[] {
  const out: Suggestion[] = [];
  const cls = tagClassOf04(tag.type);
  const push = (rowId: RowId, reason: Suggestion['reason'], transform?: TransformKind04): void => {
    if (out.some((s) => s.rowId === rowId)) return;
    const binding = newBinding(rowId, kind, tag, transform);
    if (binding !== null) out.push({ rowId, tagId: tag.id, binding, reason });
  };
  const shape = kind === 'rect' || kind === 'shape' || kind === 'group';
  const hasTable = tag.valueTable !== undefined && tag.valueTable !== '';
  if (kind === 'text') {
    if (hasTable) push('text', 'text-table', 'valueTable');
    else if (cls === 'number') push('text', 'text-number', 'direct');
  }
  if (shape && cls === 'number' && nameHas(name, 'level')) push('level', 'level', 'linearScale');
  if (shape && nameHas(name, 'spin') && cls !== 'string') push('spin', 'spin', 'direct');
  if (kind === 'line' && cls === 'bool') push('flow', 'flow', 'direct');
  if (shape && cls === 'bool' && nameHas(name, 'alarm')) {
    push('blink', 'alarm', 'direct');
    push('fill', 'alarm', 'discreteMap');
  }
  if (shape && cls === 'bool') push('fill', 'fill-bool', 'discreteMap');
  if (shape && hasTable && cls !== 'string') push('fill', 'fill-table', 'valueTable');
  return out;
}
