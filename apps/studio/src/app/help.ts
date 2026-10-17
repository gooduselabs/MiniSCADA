// Trợ giúp theo ngữ cảnh (feature 011, T178; FR-133): editor đang mở → trang và neo của tài liệu HTML đi kèm bộ cài
// (`docs-html/` trong tài nguyên của Tauri, dựng bởi tools/build-docs.mjs). Bảng ở help-topics.json: tools/build-docs.test.mjs
// kiểm mọi neo có trong HTML dựng ra; phía Rust (`open_help`) chỉ nhận trang và neo gồm chữ thường, số, gạch.
import type { EditorId } from '../model/tree.ts';
import topics from './help-topics.json';

export interface HelpTarget {
  page: string;
  anchor: string;
}

interface Topic extends HelpTarget {
  /** Id editor; kết thúc bằng ":" thì so theo tiền tố (`screen:` cho mọi màn hình). */
  editors: readonly string[];
}

export const HELP_TOPICS: readonly Topic[] = topics.topics;
const DEFAULT: HelpTarget = topics.default;

const matches = (pattern: string, id: string) =>
  pattern.endsWith(':') ? id.startsWith(pattern) : id === pattern;

export function helpTarget(editor: EditorId): HelpTarget {
  const hit = HELP_TOPICS.find((x) => x.editors.some((p) => matches(p, editor)));
  return hit ? { page: hit.page, anchor: hit.anchor } : { ...DEFAULT };
}
