// Trình vẽ SVG của feature 011 (ADR-038; contracts/svg-editor.md): mô hình tài liệu `DrawDoc`, lệnh đảo ngược được,
// hoàn tác, tuần tự hóa chuẩn tắc, hình học, bắt dính, căn chỉnh, xếp lớp, lớp, sửa nút, clipboard. Không DOM (trừ cổng
// DOMParser của parse.ts và pasteSvgText, dùng bộ lọc của feature 008). Chỉ Studio dùng; runtime không dùng gói này.
export const SVG_EDIT_VERSION = '1.0.0-rc.1';

export * from './limits.ts';
export * from './node.ts';
export {
  checkAttr,
  elementProblem,
  placementProblem,
  structuralProblem,
  hasInvalidXmlChar,
} from './allow.ts';
export type { AttrVerdict } from './allow.ts';
export { parseDrawDoc, emptyDoc, docFromDom, rootViewBox } from './parse.ts';
export type {
  ParseIssue,
  ParseReport,
  ParseResult,
  ParseOptions,
  ParseErrorCode,
} from './parse.ts';
export { serialize, canonical, serializeSubtree, escAttr, escText } from './serialize.ts';
export { buildSubtree, snapshotSubtree, specOf } from './build.ts';
export type { NodeSpec, Subtree } from './build.ts';
export * from './command.ts';
export { UndoStack } from './undo.ts';
export type { UndoOptions } from './undo.ts';
export * from './matrix.ts';
export * from './transform.ts';
export * from './path.ts';
export * from './bbox.ts';
export * from './bake.ts';
export * from './structure.ts';
export * from './group.ts';
export * from './order.ts';
export * from './layers.ts';
export * from './polygon.ts';
export * from './snap.ts';
export * from './align.ts';
export * from './shapes.ts';
export * from './clipboard.ts';
