// Ô nhập chữ tại chỗ của trình vẽ SVG (feature 011, T163; FR-108; ADR-016): một `textarea` giữ focus đặt chồng đúng vị trí chữ
// trên canvas, nên bộ gõ tiếng Việt (Telex của TSF, Unikey) ghép chữ ngay trong ô: phím `Process` và Enter/Esc lúc đang ghép
// thuộc về bộ gõ, không bị chặn. Chỉ `text` một dòng: Enter xong (không xuống dòng), Esc xong, mất focus xong; chữ rỗng không
// tạo phần tử. Tài liệu chỉ đổi khi xong (một bước hoàn tác).
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import type { TextTarget } from '../../model/svg/editor.ts';
import type { ViewMap } from './handles.ts';

export interface TextInputHandlers {
  commit(value: string): void;
}

/** Chặn Enter/Esc chỉ khi KHÔNG đang ghép chữ (ADR-016). */
export function textKey(e: KeyboardEvent, h: TextInputHandlers): void {
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return;
  if (e.key === 'Enter' || e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    h.commit((e.target as HTMLTextAreaElement).value);
  }
}

export function renderTextInput(tt: TextTarget | null, map: ViewMap, h: TextInputHandlers) {
  if (!tt) return nothing;
  const size = Math.max(10, tt.fontSize * map.zoom);
  const left = map.x(tt.x);
  const top = map.y(tt.y) - size * 1.05;
  return html`<textarea
    class="sv-text"
    rows="1"
    spellcheck="false"
    aria-label=${tt.mode === 'new' ? t('svgd.text.new') : t('svgd.text.edit')}
    style=${`left:${left}px;top:${top}px;font-size:${size}px;min-width:${Math.max(80, size * 4)}px`}
    .value=${tt.text}
    @keydown=${(e: KeyboardEvent) => textKey(e, h)}
    @blur=${(e: FocusEvent) => h.commit((e.target as HTMLTextAreaElement).value)}
  ></textarea>`;
}
