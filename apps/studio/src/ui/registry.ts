// Bảng đăng ký để editor của từng user story gắn vào khung mà không sửa khung (feature 004, T049, T053):
// - editor: EditorId → nội dung vùng editor;
// - thuộc tính: lựa chọn hiện tại → nội dung tab Thuộc tính của inspector;
// - chẩn đoán: nội dung tab Chẩn đoán (US3).
import { nothing } from 'lit';
import type { StudioApp } from '../app/app.ts';
import type { EditorId } from '../model/tree.ts';

export interface EditorEntry {
  match: (id: EditorId) => boolean;
  render: (app: StudioApp, id: EditorId) => unknown;
}

const editors: EditorEntry[] = [];

export function registerEditor(entry: EditorEntry): void {
  editors.unshift(entry);
}

export function renderEditor(app: StudioApp, id: EditorId): unknown {
  return editors.find((e) => e.match(id))?.render(app, id) ?? nothing;
}

/** Nội dung tab Thuộc tính: `ctx` là dòng ngữ cảnh bên phải dải tab inspector. */
export interface InspectorView {
  ctx: string;
  body: unknown;
}

/** Trả `null` khi lựa chọn hiện tại không thuộc loại mình vẽ. */
export type PropsRenderer = (app: StudioApp) => InspectorView | null;

const props: PropsRenderer[] = [];

export function registerProps(renderer: PropsRenderer): void {
  props.unshift(renderer);
}

export function renderProps(app: StudioApp): InspectorView | null {
  for (const r of props) {
    const v = r(app);
    if (v) return v;
  }
  return null;
}

let diagnostics: ((app: StudioApp) => InspectorView) | null = null;

export function registerDiagnostics(renderer: (app: StudioApp) => InspectorView): void {
  diagnostics = renderer;
}

export function renderDiagnostics(app: StudioApp): InspectorView | null {
  return diagnostics ? diagnostics(app) : null;
}
