// Hộp thoại `args` của hành động Mở popup (feature 011, T173; FR-123, FR-126; mockup studio-svg-draw cảnh 3 `argsDlg`):
// một dòng cho mỗi tham số của popup đích (faceplate), ô giá trị kiểm theo kiểu ngay khi gõ, báo thiếu/thừa/sai như bộ
// kiểm (E_POPUP_ARGS, cùng hàm `resolveArgs`), và danh sách Tag sẽ dùng khi mở (bung tĩnh bằng `substituteParams`, Tag
// không có trong project đánh dấu đỏ). Trong item của bản sao template, giá trị được dùng `{tham số}` của template (T007
// quyết định 9) nên chỉ hiện, sửa ở template. Áp bằng MỘT sửa đổi màn hình (`setAction`).
import {
  paramValueError,
  substituteParams,
  type Action,
  type Item10,
  type ParamDecl,
  type ScreenModel10,
  type WidgetItem,
} from '@mat/project-schema';
import { html, nothing } from 'lit';
import { screensOf } from '../../app/template-actions.ts';
import { t } from '../../i18n/index.ts';
import { setAction } from '../../model/screen-doc.ts';
import { argsProblems, popupParamsOf } from '../../model/template-doc.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './template-dialogs.css';

type Obj = Record<string, unknown>;

/** Mọi chuỗi Tag trong khe của các item (đã thay). */
function tagsOfItems(items: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const tags = (it as { tags?: Obj }).tags;
    if (!tags || typeof tags !== 'object') continue;
    for (const v of Object.values(tags)) {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
    }
  }
  return [...new Set(out)];
}

/** Tag mà popup `screen` dùng khi mở với `args` (bung tĩnh); `null` khi args sai. */
export function popupTagsWith(
  popup: ScreenModel10 | undefined,
  args: Readonly<Record<string, string>>,
): string[] | null {
  if (!popup) return null;
  const params = popup.params ?? [];
  const out: unknown[] = [];
  for (const it of popup.items) {
    const r = substituteParams(it, params, args);
    if (!r.ok) return null;
    out.push(r.value);
  }
  return tagsOfItems(out);
}

export class MatArgsDialog extends OnlineDialog {
  static override properties = { values: { state: true } };

  protected get kind(): 'popupArgs' {
    return 'popupArgs';
  }

  declare values: Record<string, string>;

  constructor() {
    super();
    this.values = {};
  }

  private spec() {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'popupArgs' ? d : null;
  }

  private item(): WidgetItem | null {
    const s = this.spec();
    const it = s ? this.app.screenModel(s.screen)?.items.find((i) => i.id === s.item) : undefined;
    return it?.type === 'widget' ? it : null;
  }

  private action(): (Action & { args?: Record<string, string> }) | null {
    const a = this.item()?.events?.click;
    return a && a.action === 'popup' ? (a as Action & { args?: Record<string, string> }) : null;
  }

  private params(): ParamDecl[] {
    const a = this.action();
    return a && 'screen' in a ? popupParamsOf(screensOf(this.app), a.screen) : [];
  }

  private locked(): boolean {
    return (this.item() as Item10 | null)?.tpl !== undefined;
  }

  protected override opened(): void {
    this.values = { ...(this.action()?.args ?? {}) };
  }

  /** Bộ args sẽ ghi: bỏ ô rỗng (lấy default). */
  private args(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.values)) if (v !== '') out[k] = v;
    return out;
  }

  private submit(): void {
    const s = this.spec();
    const a = this.action();
    if (!s || !a || !('screen' in a) || this.locked()) return;
    if (argsProblems(this.params(), this.args()).length) return;
    const args = this.args();
    this.app.editScreen(s.screen, (d) =>
      setAction(d, s.item, 'click', {
        action: 'popup',
        screen: a.screen,
        ...(Object.keys(args).length ? { args } : {}),
      } as Action),
    );
    this.app.closeOnlineDialog();
  }

  protected override render() {
    const s = this.spec();
    const a = this.action();
    if (!this.isOpen || !s || !a || !('screen' in a)) return nothing;
    const params = this.params();
    const known = new Set(params.map((p) => p.name));
    const locked = this.locked();
    const problems = argsProblems(params, this.args());
    const extra = Object.keys(this.values).filter((k) => !known.has(k));
    const popup = screensOf(this.app).find((x) => x.id === a.screen) as ScreenModel10 | undefined;
    const tagIds = new Set(
      ((this.app.store.state.outline.tags?.tags ?? []) as Array<{ id?: unknown }>).map((x) =>
        String(x.id),
      ),
    );
    const resolved: Record<string, string> = {};
    for (const p of params) {
      const v = this.values[p.name] || p.default;
      if (v !== undefined) resolved[p.name] = v;
    }
    const tags = problems.length || locked ? null : popupTagsWith(popup, resolved);
    const body = html`<div class="tpl-dlg">
      <dl class="tpl-kv">
        <dt>${t('args.popup')}</dt>
        <dd class="mono">${a.screen}${popup ? ` · ${popup.name}` : ''}</dd>
      </dl>
      ${
        params.length === 0
          ? html`<p class="help">${t('args.noParams')}</p>`
          : html`<table class="tpl-tb" aria-label=${t('args.table')}>
              <thead>
                <tr>
                  <th scope="col">${t('tpl.col.name')}</th>
                  <th scope="col">${t('tpl.col.kind')}</th>
                  <th scope="col">${t('tpl.col.value')}</th>
                  <th scope="col">${t('tpl.col.check')}</th>
                </tr>
              </thead>
              <tbody>
                ${params.map((p) => {
                  const v = this.values[p.name] ?? '';
                  const bad =
                    v === ''
                      ? p.default === undefined
                        ? t('args.missing')
                        : null
                      : locked
                        ? null
                        : paramValueError(p.kind, v);
                  return html`<tr data-param=${p.name}>
                    <td class="mono">${p.name}</td>
                    <td class="mono">${p.kind}</td>
                    <td>
                      <input
                        name=${`a-${p.name}`}
                        aria-label=${t('args.valueOf', { name: p.name })}
                        aria-invalid=${bad ? 'true' : 'false'}
                        placeholder=${p.default ?? ''}
                        ?readonly=${locked}
                        .value=${v}
                        @input=${(e: Event) => {
                          this.values = {
                            ...this.values,
                            [p.name]: (e.target as HTMLInputElement).value,
                          };
                        }}
                      />
                    </td>
                    <td class=${bad ? 'bad' : ''}>${bad ?? t('tpl.ok')}</td>
                  </tr>`;
                })}
              </tbody>
            </table>`
      }
      ${
        extra.length
          ? html`<div class="tpl-box err" role="alert">
              ${icon('err', 'err')}
              <span>${t('args.extra', { list: extra.join(', ') })}</span>
              <button
                class="btn sm"
                type="button"
                data-act="drop-extra"
                @click=${() => {
                  const next: Record<string, string> = {};
                  for (const [k, v] of Object.entries(this.values)) if (known.has(k)) next[k] = v;
                  this.values = next;
                }}
              >
                ${t('args.dropExtra')}
              </button>
            </div>`
          : nothing
      }
      ${locked ? html`<p class="help">${t('args.locked')}</p>` : nothing}
      ${
        tags
          ? html`<div class="tpl-sec">
              <b>${t('args.tags')}</b>
              <div class="tpl-tags" data-k="tags">
                ${tags.map(
                  (x) =>
                    html`<span class=${tagIds.has(x) ? '' : 'bad'}
                      >${x}${tagIds.has(x) ? '' : ` (${t('args.noTag')})`}</span
                    >`,
                )}
              </div>
            </div>`
          : nothing
      }
      <p class="help">${t('args.help')}</p>
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${locked || problems.length > 0}
        @click=${() => this.submit()}
      >
        ${t('args.apply')}
      </button>`;
    return this.frame({ title: t('args.title', { item: s.item }), icon: 'popup', body, foot });
  }
}

customElements.define('mat-args-dialog', MatArgsDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-args-dialog': MatArgsDialog;
  }
}
