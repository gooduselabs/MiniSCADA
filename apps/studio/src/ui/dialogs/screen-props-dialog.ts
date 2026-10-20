// Hộp thoại Thuộc tính màn hình (feature 007, T118, FR-066): tên, loại (màn hình hay popup), cỡ có mẫu 1920 × 1080,
// 1366 × 768, 1280 × 720, chế độ co (`fitMode`), màu nền; cảnh báo khi chọn `stretch` mà màn hình có widget (méo chữ).
// Áp bằng MỘT sửa đổi `screenUpsert` (một bước hoàn tác); Esc hoặc Hủy thì không đổi gì.
import {
  SIZE_MAX,
  SIZE_MIN,
  type FitMode03,
  type Role03,
  type ScreenKind,
} from '@mat/project-schema';
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { setScreenProps } from '../../model/screen-doc.ts';
import { SIZE_PRESETS } from '../../model/screen-ops.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './screen-dialogs.css';

const FIT_MODES: ReadonlyArray<readonly [FitMode03, MessageKey]> = [
  ['contain', 'spd.fit.contain'],
  ['cover', 'spd.fit.cover'],
  ['stretch', 'spd.fit.stretch'],
  ['fit-width', 'spd.fit.fitWidth'],
  ['none', 'spd.fit.none'],
];
const ROLES: readonly Role03[] = ['viewer', 'operator', 'engineer', 'administrator'];

interface Draft {
  name: string;
  kind: ScreenKind;
  width: string;
  height: string;
  fit: FitMode03;
  bg: string | null;
  /** Định dạng 1.1 (feature 013): vai trò tối thiểu để xem. */
  view: Role03;
}

export class MatScreenPropsDialog extends OnlineDialog {
  static override properties = { draft: { state: true }, error: { state: true } };

  protected get kind(): 'screenProps' {
    return 'screenProps';
  }

  declare draft: Draft;
  declare error: MessageKey | null;

  constructor() {
    super();
    this.draft = {
      name: '',
      kind: 'screen',
      width: '',
      height: '',
      fit: 'contain',
      bg: null,
      view: 'viewer',
    };
    this.error = null;
  }

  private screenId(): string | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'screenProps' ? d.id : null;
  }

  private model() {
    const id = this.screenId();
    return id === null
      ? null
      : (this.app.store.state.outline.screens.find((s) => s.id === id)?.model ?? null);
  }

  protected override opened(): void {
    const m = this.model();
    if (!m) return;
    this.draft = {
      name: m.name,
      kind: m.kind === 'popup' ? 'popup' : 'screen',
      width: String(m.size.width),
      height: String(m.size.height),
      fit: m.fitMode ?? 'contain',
      bg: m.background ?? null,
      view: m.security?.view ?? 'viewer',
    };
    this.error = null;
  }

  protected override initialFocus(): HTMLElement | null {
    const input = this.querySelector<HTMLInputElement>('input[name="name"]');
    queueMicrotask(() => input?.select());
    return input;
  }

  private patch(p: Partial<Draft>): void {
    this.draft = { ...this.draft, ...p };
    this.error = null;
  }

  private submit(): void {
    const m = this.model();
    if (!m) return;
    const d = this.draft;
    const w = Number(d.width);
    const h = Number(d.height);
    if (d.name.trim() === '') {
      this.error = 'tree.err.empty';
      return;
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      this.error = 'spd.err.size';
      return;
    }
    const r = setScreenProps(m, {
      name: d.name.trim(),
      kind: d.kind,
      size: { width: w, height: h },
      fitMode: d.fit === 'contain' ? null : d.fit,
      background: d.bg,
      ...(this.format11() ? { view: d.view } : {}),
    });
    if (r.rejected) {
      this.error = 'spd.err.size';
      return;
    }
    if (r.doc !== m) this.app.store.edit([{ kind: 'screenUpsert', screen: r.doc }]);
    this.app.closeOnlineDialog();
  }

  private format11(): boolean {
    return this.app.store.state.outline.format11;
  }

  /** Vai trò tối thiểu để xem màn hình (`security.view`, định dạng 1.1, feature 013). */
  private viewField(view: Role03) {
    return html`<div class="field">
        <label for="spd-view">${t('spd.view')}</label>
        <select
          id="spd-view"
          @change=${(e: Event) => this.patch({ view: (e.target as HTMLSelectElement).value as Role03 })}
        >
          ${ROLES.map(
            (r) =>
              html`<option value=${r} ?selected=${view === r}>
                ${t(`wi.role.${r}` as MessageKey)}
              </option>`,
          )}
        </select>
      </div>
      <p class="help">${t('spd.view.help')}</p>`;
  }

  protected override render() {
    const m = this.model();
    if (!this.isOpen || !m) return nothing;
    const d = this.draft;
    const widgets = m.items.filter((i) => i.type === 'widget').length;
    const preset = SIZE_PRESETS.find(
      (p) => String(p.width) === d.width && String(p.height) === d.height,
    );
    const entryWarn =
      d.kind === 'popup' && this.app.store.state.outline.project?.entryScreen === m.id;
    const body = html`<div class="field">
        <label for="spd-name">${t('spd.name')}</label>
        <input
          id="spd-name"
          name="name"
          type="text"
          maxlength="80"
          autocomplete="off"
          .value=${d.name}
          @input=${(e: Event) => this.patch({ name: (e.target as HTMLInputElement).value })}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              this.submit();
            }
          }}
        />
      </div>
      <fieldset class="field sp-kind">
        <legend>${t('spd.kind')}</legend>
        <label class="inline"
          ><input
            type="radio"
            name="kind"
            value="screen"
            .checked=${d.kind === 'screen'}
            @change=${() => this.patch({ kind: 'screen' })}
          />${t('spd.kind.screen')}</label
        >
        <label class="inline"
          ><input
            type="radio"
            name="kind"
            value="popup"
            .checked=${d.kind === 'popup'}
            @change=${() => this.patch({ kind: 'popup' })}
          />${t('spd.kind.popup')}</label
        >
      </fieldset>
      ${entryWarn ? html`<p class="field-err" role="alert">${t('spd.warn.entryPopup')}</p>` : nothing}
      <div class="sp-size">
        <div class="field">
          <label for="spd-preset">${t('spd.preset')}</label>
          <select
            id="spd-preset"
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              const p = SIZE_PRESETS[Number(v)];
              if (p) this.patch({ width: String(p.width), height: String(p.height) });
            }}
          >
            <option value="-1" ?selected=${!preset}>${t('spd.preset.custom')}</option>
            ${SIZE_PRESETS.map(
              (p, i) =>
                html`<option value=${i} ?selected=${preset === p}>
                  ${t('scr.tip.size', { w: p.width, h: p.height })}
                </option>`,
            )}
          </select>
        </div>
        <div class="field">
          <label for="spd-w">${t('spd.width')}</label>
          <input
            id="spd-w"
            name="width"
            type="number"
            inputmode="numeric"
            min=${SIZE_MIN.width}
            max=${SIZE_MAX.width}
            .value=${d.width}
            @input=${(e: Event) => this.patch({ width: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="field">
          <label for="spd-h">${t('spd.height')}</label>
          <input
            id="spd-h"
            name="height"
            type="number"
            inputmode="numeric"
            min=${SIZE_MIN.height}
            max=${SIZE_MAX.height}
            .value=${d.height}
            @input=${(e: Event) => this.patch({ height: (e.target as HTMLInputElement).value })}
          />
        </div>
      </div>
      <p class="help">
        ${t('spd.sizeHelp', { minW: SIZE_MIN.width, maxW: SIZE_MAX.width, minH: SIZE_MIN.height, maxH: SIZE_MAX.height })}
      </p>
      <div class="field">
        <label for="spd-fit">${t('spd.fit')}</label>
        <select
          id="spd-fit"
          @change=${(e: Event) => this.patch({ fit: (e.target as HTMLSelectElement).value as FitMode03 })}
        >
          ${FIT_MODES.map(
            ([v, key]) => html`<option value=${v} ?selected=${d.fit === v}>${t(key)}</option>`,
          )}
        </select>
      </div>
      ${
        d.fit === 'stretch' && widgets > 0
          ? html`<div class="banner warn" role="note">
              ${icon('warn', 'warn')}
              <div>${t('spd.warn.stretch', { count: widgets })}</div>
            </div>`
          : nothing
      }
      <div class="field">
        <label for="spd-bg">${t('spd.bg')}</label>
        <div class="sp-bg">
          <input
            id="spd-bg"
            name="background"
            type="color"
            .value=${d.bg ?? '#0f172a'}
            @input=${(e: Event) => this.patch({ bg: (e.target as HTMLInputElement).value })}
          />
          <span class="mono">${d.bg ?? t('spd.bg.default')}</span>
          <button
            class="btn"
            type="button"
            ?disabled=${d.bg === null}
            @click=${() => this.patch({ bg: null })}
          >
            ${t('spd.bg.clear')}
          </button>
        </div>
      </div>
      ${this.format11() ? this.viewField(d.view) : nothing}
      ${this.error ? html`<p class="field-err" role="alert">${t(this.error)}</p>` : nothing}`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button class="btn primary" type="button" data-role="ok" @click=${() => this.submit()}>
        ${t('spd.do')}
      </button>`;
    return this.frame({ title: t('spd.title'), icon: 'gear', body, foot });
  }
}

customElements.define('mat-screen-props-dialog', MatScreenPropsDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-props-dialog': MatScreenPropsDialog;
  }
}
