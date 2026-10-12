// Ô nhập biểu thức của Tag tính toán (feature 006, T185, ADR-016 điểm 4, FR-049, R22, mockup studio-tags.html v-vt): `textarea`
// trong suốt phủ lên lớp `pre` tô màu cú pháp (cùng phông, cùng khung nên trùng chữ); chữ nhận qua bộ gõ ngay trên textarea
// (composition); gợi ý tên Tag, hàm, bảng giá trị bằng ARIA combobox dùng được bằng bàn phím (↑ ↓ Enter Tab Esc); kiểm sau
// 200 ms ngừng gõ và gạch dưới đúng span của lỗi kèm lý do. Tính toán chỉ dùng model/expression-assist.ts (@mat/expression).
// Sự kiện: `expr-input` {value} mỗi lần chữ đổi; `expr-check` {problem, warnings, inputs, program} sau mỗi lần kiểm;
// `expr-commit` {value} khi rời ô hoặc Ctrl+Enter.
import { html, nothing, type PropertyValues } from 'lit';
import { t } from '../../i18n/index.ts';
import {
  DebouncedCheck,
  TagIndex,
  checkExpression,
  highlight,
  suggest,
  type AssistContext,
  type CheckResult,
  type ExprProblem,
  type Suggestion,
} from '../../model/expression-assist.ts';
import { AppElement } from '../base.ts';
import './expression-input.css';

let uid = 0;
/** Lớp CSS theo loại token (tô màu cú pháp). */
const KIND_CLASS: Readonly<Record<string, string>> = {
  function: 't-fn',
  tag: 't-tag',
  number: 't-num',
  table: 't-tab',
  string: 't-str',
  keyword: 't-kw',
  operator: 't-op',
  punctuation: 't-pn',
  error: 't-bad',
};

export class ExpressionInput extends AppElement {
  static override properties = {
    value: { type: String },
    assist: { attribute: false },
    disabled: { type: Boolean },
    label: { type: String },
    text: { state: true },
    problem: { state: true },
    warnings: { state: true },
    list: { state: true },
    hi: { state: true },
  };

  declare value: string;
  declare assist: AssistContext | null;
  declare disabled: boolean;
  declare label: string;
  declare text: string;
  declare problem: ExprProblem | null;
  declare warnings: readonly ExprProblem[];
  declare list: readonly Suggestion[];
  declare hi: number;

  private readonly eid = `ei${++uid}`;
  private composing = false;
  private index: { src: AssistContext; idx: TagIndex } | null = null;
  private readonly checker: DebouncedCheck;

  constructor() {
    super();
    this.value = '';
    this.assist = null;
    this.disabled = false;
    this.label = '';
    this.text = '';
    this.problem = null;
    this.warnings = [];
    this.list = [];
    this.hi = -1;
    this.checker = new DebouncedCheck((src) => this.runCheck(src));
  }

  protected override detached(): void {
    this.checker.dispose();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('value') && this.value !== this.text) {
      this.text = this.value;
      this.list = [];
      this.hi = -1;
      // Chữ đặt từ ngoài (chọn Tag khác): kiểm ngay để lỗi hiện khi mở.
      if (this.text.trim() !== '') this.runCheck(this.text);
      else {
        this.problem = null;
        this.warnings = [];
      }
    } else if (
      changed.has('assist') &&
      this.assist &&
      this.text.trim() !== '' &&
      changed.get('assist') !== undefined
    )
      this.runCheck(this.text);
  }

  // ---------- Kiểm và gợi ý ----------

  private tagIndex(): TagIndex | null {
    const a = this.assist;
    if (!a) return null;
    if (!this.index || this.index.src !== a) this.index = { src: a, idx: new TagIndex(a) };
    return this.index.idx;
  }

  private runCheck(src: string): void {
    const a = this.assist;
    if (!a) return;
    const r: CheckResult =
      src.trim() === ''
        ? { problem: null, warnings: [], inputs: [], program: null }
        : checkExpression(src, a);
    this.problem = r.problem;
    this.warnings = r.warnings;
    this.dispatchEvent(new CustomEvent('expr-check', { detail: r, bubbles: true }));
  }

  private area(): HTMLTextAreaElement | null {
    return this.querySelector<HTMLTextAreaElement>('textarea.ei-ta');
  }

  private refreshSuggestions(): void {
    const area = this.area();
    const idx = this.tagIndex();
    if (!area || !idx || this.disabled || this.composing) {
      this.list = [];
      this.hi = -1;
      return;
    }
    const caret = area.selectionStart ?? area.value.length;
    this.list = suggest(idx, area.value, caret);
    this.hi = -1;
  }

  // ---------- Sự kiện ----------

  private emitInput(): void {
    this.dispatchEvent(
      new CustomEvent('expr-input', { detail: { value: this.text }, bubbles: true }),
    );
  }

  private readonly onInput = (e: Event): void => {
    const area = e.target as HTMLTextAreaElement;
    this.text = area.value;
    if (!this.composing) {
      this.refreshSuggestions();
      this.checker.input(this.text);
    }
    this.emitInput();
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly onCompositionEnd = (e: Event): void => {
    this.composing = false;
    const area = e.target as HTMLTextAreaElement;
    this.text = area.value;
    this.refreshSuggestions();
    this.checker.input(this.text);
    this.emitInput();
  };

  private accept(i: number): void {
    const s = this.list[i];
    const area = this.area();
    if (!s || !area) return;
    const next = area.value.slice(0, s.range[0]) + s.insert + area.value.slice(s.range[1]);
    area.value = next;
    const caret = s.range[0] + s.insert.length;
    area.setSelectionRange(caret, caret);
    this.text = next;
    this.list = [];
    this.hi = -1;
    this.checker.input(next);
    this.emitInput();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    // Phím của bộ gõ (Process, Enter hay Esc khi đang ghép) thuộc về bộ gõ.
    if (e.isComposing || e.key === 'Process') return;
    const open = this.list.length > 0;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = this.list.length;
      this.hi = e.key === 'ArrowDown' ? (this.hi + 1) % n : this.hi <= 0 ? n - 1 : this.hi - 1;
    } else if (open && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      this.accept(this.hi >= 0 ? this.hi : 0);
    } else if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.list = [];
      this.hi = -1;
    } else if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      this.refreshSuggestions();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.commit();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) this.refreshSuggestions();
  };

  /** Xác nhận ngay (Ctrl+S khi đang gõ): kiểm ngay và phát `expr-commit`. */
  commitNow(): void {
    this.commit();
  }

  private commit(): void {
    this.checker.flush();
    this.dispatchEvent(
      new CustomEvent('expr-commit', { detail: { value: this.text }, bubbles: true }),
    );
  }

  private readonly onBlur = (): void => {
    this.list = [];
    this.hi = -1;
    this.commit();
  };

  private readonly onDragOver = (e: DragEvent): void => {
    if (!this.disabled && e.dataTransfer?.types?.includes('application/x-mat-tag'))
      e.preventDefault();
  };

  private readonly onDrop = (e: DragEvent): void => {
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    const area = this.area();
    if (!name || !area || this.disabled) return;
    e.preventDefault();
    const at = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? at;
    const next = area.value.slice(0, at) + name + area.value.slice(end);
    area.value = next;
    area.setSelectionRange(at + name.length, at + name.length);
    this.text = next;
    this.list = [];
    this.checker.input(next);
    this.emitInput();
  };

  // ---------- Vẽ ----------

  private message() {
    const msgId = `${this.eid}-msg`;
    if (this.problem)
      return html`<div class="ei-msg err" id=${msgId} data-role="msg" role="alert">
        ${this.problem.message}
      </div>`;
    const w = this.warnings[0];
    if (w)
      return html`<div class="ei-msg warn" id=${msgId} data-role="msg" role="status">
        ${w.message}
      </div>`;
    if (this.text.trim() !== '' && this.assist)
      return html`<div class="ei-msg ok" id=${msgId} data-role="msg" role="status">
        ${t('expr.input.ok')}
      </div>`;
    return nothing;
  }

  protected override render() {
    const listId = `${this.eid}-list`;
    const open = this.list.length > 0 && !this.disabled;
    const segs = highlight(this.text, this.problem?.span ?? null);
    return html`<div
        class="ei ${this.problem ? 'ei-bad' : ''}"
        @dragover=${this.onDragOver}
        @drop=${this.onDrop}
      >
        <div class="ei-stack">
          <pre class="ei-hl" aria-hidden="true">
${segs.map(
              (s) =>
                html`<span class="${KIND_CLASS[s.kind] ?? ''} ${s.error ? 't-err' : ''}"
                  >${s.text}</span
                >`,
            )}</pre>
          <textarea
            class="ei-ta"
            role="combobox"
            aria-label=${this.label || t('expr.input.label')}
            aria-autocomplete="list"
            aria-expanded=${open ? 'true' : 'false'}
            aria-controls=${listId}
            aria-activedescendant=${open && this.hi >= 0 ? `${this.eid}-o${this.hi}` : nothing}
            aria-invalid=${this.problem ? 'true' : 'false'}
            aria-describedby=${this.problem ? `${this.eid}-msg` : nothing}
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            rows="3"
            ?readonly=${this.disabled}
            .value=${this.text}
            @input=${this.onInput}
            @compositionstart=${this.onCompositionStart}
            @compositionend=${this.onCompositionEnd}
            @keydown=${this.onKey}
            @keyup=${this.onKeyUp}
            @blur=${this.onBlur}
          ></textarea>
        </div>
        ${
          open
            ? html`<ul
                class="ei-list"
                id=${listId}
                role="listbox"
                aria-label=${t('expr.suggest.label')}
              >
                ${this.list.map(
                  (s, i) =>
                    html`<li
                      id="${this.eid}-o${i}"
                      role="option"
                      class="${i === this.hi ? 'hi' : ''} k-${s.kind}"
                      aria-selected=${i === this.hi ? 'true' : 'false'}
                      @mousedown=${(e: Event) => {
                        e.preventDefault();
                        this.accept(i);
                      }}
                    >
                      <span class="ei-lbl">${s.label}</span><span class="ei-det">${s.detail}</span>
                    </li>`,
                )}
              </ul>`
            : nothing
        }
      </div>
      ${this.message()}`;
  }
}

customElements.define('mat-expression-input', ExpressionInput);

declare global {
  interface HTMLElementTagNameMap {
    'mat-expression-input': ExpressionInput;
  }
}
