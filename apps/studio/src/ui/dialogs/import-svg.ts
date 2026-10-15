// Hộp thoại Nhập SVG (feature 008, T058; contract studio-svg-editor §3; mockup studio-svg.html cảnh 1; FR-011):
// chọn file (svg_open) → importSvg (Worker, có dự phòng) → xem trước Trước/Sau bằng bản đã lọc theo danh sách cho phép
// (mountScreen: không bao giờ dựng bản chưa lọc, không innerHTML) + báo cáo + tùy chọn Tối ưu → Nhập (một bước hoàn tác)
// hoặc Hủy (không đổi project). Máy trạng thái ở model/import-flow.ts; lớp này chỉ hiển thị và chuyển phím.
// Trợ năng: role dialog, bẫy focus, Esc hủy, Enter nhập, Ctrl+S lưu báo cáo (nhãn nút có phím).
import { html, nothing, type TemplateResult } from 'lit';
import { mountScreen } from '@mat/svg-renderer';
import { prescan, reportToMarkdown, type ImportReport } from '@mat/svg-import';
import { currentScreenId } from '../../app/tree-commands.ts';
import { IMPORT_CERTAINTY_CLASS } from '../../i18n/vi-import.ts';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import { ImportFlow, svgItemLimit, type ImportState } from '../../model/import-flow.ts';
import { defaultImportRunner, type ImportRunner } from '../../model/import-runner.ts';
import { uniqueSvgPath } from '../../model/svg-doc.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './import-report.ts';
import './import-svg.css';

/** Trên ngưỡng này thì không dựng xem trước "Trước" (đỡ nặng): importer vẫn xử lý tới 100.000 phần tử thô. */
const BEFORE_PREVIEW_MAX = 20_000;

/** Bộ chạy importSvg; test thay bản giả. */
export const importRunnerRef: { current: ImportRunner } = { current: defaultImportRunner };

const kb = (n: number): string => `${n < 10_240 ? (n / 1024).toFixed(1) : Math.round(n / 1024)} KB`;
const fmt = (n: number): string => n.toLocaleString('vi-VN');

type SaveMsg = { kind: 'ok' | 'err'; text: string } | null;

export class MatImportSvgDialog extends OnlineDialog {
  static override properties = {
    tick: { state: true },
    format: { state: true },
    saveMsg: { state: true },
    planError: { state: true },
  };

  protected get kind(): 'importSvg' {
    return 'importSvg';
  }

  declare tick: number;
  declare format: 'json' | 'md';
  declare saveMsg: SaveMsg;
  declare planError: string | null;

  private flow: ImportFlow | null = null;
  private off: (() => void) | null = null;
  private screenId: string | null = null;
  private mountedResult: unknown = null;
  private mountedHosts: [Element | null, Element | null] = [null, null];

  constructor() {
    super();
    this.tick = 0;
    this.format = 'json';
    this.saveMsg = null;
    this.planError = null;
    this.addEventListener('keydown', (e) => this.hostKey(e));
  }

  // ---------- Vòng đời ----------

  protected override opened(): void {
    this.disposeFlow();
    this.saveMsg = null;
    this.planError = null;
    this.format = 'json';
    this.screenId = currentScreenId(this.app);
    const app = this.app;
    const flow = new ImportFlow({
      open: () => app.svgOpen(),
      run: (bytes, options, onProgress) => importRunnerRef.current(bytes, options, onProgress),
      target: () => {
        const sid = this.screenId;
        const screen = sid === null ? null : app.screenModel(sid);
        if (!screen) return null;
        const project = app.store.state.outline.project as unknown as {
          schemaVersion?: unknown;
        } | null;
        return {
          screen,
          graphicsFiles: Object.keys(app.store.state.docs).filter((r) => r.startsWith('graphics/')),
          schemaVersion:
            typeof project?.schemaVersion === 'string' ? project.schemaVersion : '0.3.0',
        };
      },
      apply: (change) => app.store.applyChange(change),
    });
    this.flow = flow;
    this.off = flow.subscribe(() => {
      this.mountedResult = flow.state.phase === 'preview' ? this.mountedResult : null;
      if (flow.state.phase === 'cancelled') this.app.closeOnlineDialog();
      this.tick++;
    });
    void flow.start();
  }

  protected override willUpdate(): void {
    super.willUpdate();
    // Hộp thoại bị đóng từ nơi khác (đóng project, lệnh khác): dừng luồng, bỏ kết quả đang chạy dở.
    if (!this.isOpen && this.flow) this.disposeFlow(true);
  }

  override disconnectedCallback(): void {
    this.disposeFlow(true);
    super.disconnectedCallback();
  }

  private disposeFlow(cancel = false): void {
    this.off?.();
    this.off = null;
    if (cancel) this.flow?.cancel();
    this.flow = null;
    this.mountedResult = null;
    this.mountedHosts = [null, null];
  }

  /** Esc và nút đóng: Hủy luồng (kết quả muộn bị bỏ) rồi đóng. */
  protected override close(): void {
    this.flow?.cancel();
    super.close();
  }

  // ---------- Hành động ----------

  private commit(): void {
    const flow = this.flow;
    if (!flow) return;
    const plan = flow.commit();
    if (plan === null) return;
    if (!plan.ok) {
      this.planError = plan.reason;
      return;
    }
    if (this.screenId !== null) this.app.selectItems(this.screenId, [plan.item.id]);
    this.app.toast(t('imp.done', { name: plan.item.name ?? plan.item.id, file: plan.svgFile }));
    this.app.closeOnlineDialog();
  }

  private async saveReport(): Promise<void> {
    const s = this.flow?.state;
    if (!s?.result) return;
    const base = (s.fileName ?? 'svg').replace(/\.svg$/i, '');
    const ext = this.format;
    const rep: ImportReport = s.result.report;
    const text = ext === 'json' ? JSON.stringify(rep, null, 2) + '\n' : reportToMarkdown(rep);
    const r = await this.app.csvSave(`${base}.import-report.${ext}`, text, ext);
    if (r === null) return;
    this.saveMsg =
      'error' in r
        ? { kind: 'err', text: t('imp.saveFail', { detail: r.detail }) }
        : { kind: 'ok', text: t('imp.saved', { name: r.name }) };
  }

  private pickAnother(): void {
    this.planError = null;
    this.saveMsg = null;
    void this.flow?.start();
  }

  /** Enter nhập (khi focus không ở nút, ô chọn hay ô tích); Ctrl+S lưu báo cáo thay vì lưu project. */
  private hostKey(e: KeyboardEvent): void {
    if (!this.isOpen || !this.flow) return;
    const phase = this.flow.state.phase;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (phase === 'preview') void this.saveReport();
      return;
    }
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.shiftKey || phase !== 'preview') return;
    const el = e.target;
    if (el instanceof HTMLElement && el.closest('button, select, input, a, [role="region"]'))
      return;
    e.preventDefault();
    this.commit();
  }

  // ---------- Xem trước ----------

  protected override updated(): void {
    super.updated();
    this.mountPreviews();
  }

  private mountPreviews(): void {
    const flow = this.flow;
    const s = flow?.state;
    if (!flow || !s || s.phase !== 'preview' || !s.result?.ok) return;
    const before = this.querySelector('[data-pv="before"]');
    const after = this.querySelector('[data-pv="after"]');
    if (!before || !after) return;
    if (
      this.mountedResult === s.result &&
      this.mountedHosts[0] === before &&
      this.mountedHosts[1] === after
    )
      return;
    this.mountedResult = s.result;
    this.mountedHosts = [before, after];
    const layout = {
      viewBox: s.result.viewBox,
      fitMode: 'contain' as const,
      elements: [],
    };
    const fail = (host: Element): void => host.replaceChildren(t('imp.preview.fail'));
    try {
      mountScreen(after as HTMLElement, s.result.svg, layout);
    } catch {
      fail(after);
    }
    if (s.result.report.counts.elementsBefore > BEFORE_PREVIEW_MAX) {
      before.replaceChildren(t('imp.preview.big', { n: fmt(BEFORE_PREVIEW_MAX) }));
      return;
    }
    const bytes = flow.sourceBytes;
    const scan = bytes ? prescan(bytes) : null;
    if (!scan || !scan.ok) return fail(before);
    try {
      mountScreen(before as HTMLElement, scan.text, layout);
    } catch {
      fail(before);
    }
  }

  // ---------- Hiển thị ----------

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])') ??
      this.querySelector<HTMLElement>('.dlg-f button')
    );
  }

  private kbd(label: string) {
    return html`<kbd>${label}</kbd>`;
  }

  private waitingView(): TemplateResult {
    return this.frame({
      title: t('imp.title'),
      icon: 'import',
      busy: true,
      body: html`<p class="row" role="status" data-role="waiting">
        <span class="spin" aria-hidden="true"></span>${t('imp.waiting')}
      </p>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}
        </button>`,
    });
  }

  private processingView(s: ImportState): TemplateResult {
    const name = s.fileName ?? '';
    const pct = s.progress === null ? null : Math.round(s.progress * 100);
    const size = this.flow?.sourceBytes?.length ?? 0;
    const step = (text: string, state: 'ok' | 'run' | 'wait'): TemplateResult =>
      html`<div class="st ${state === 'wait' ? 'muted' : ''}">
        ${
          state === 'ok'
            ? icon('ok', 'ok')
            : state === 'run'
              ? html`<span class="spin" aria-hidden="true"></span>`
              : html`<span class="st-dot" aria-hidden="true"></span>`
        }
        <span>${text}</span>
      </div>`;
    return this.frame({
      title: t('imp.title.processing', { name }),
      icon: 'import',
      busy: true,
      body: html`<div class="steps" role="status" aria-live="polite" data-role="steps">
          ${step(t('imp.step.read', { size: kb(size) }), 'ok')} ${step(t('imp.step.scan'), 'ok')}
          ${step(t('imp.step.clean'), 'run')} ${step(t('imp.step.preview'), 'wait')}
        </div>
        <div
          class="imp-prog ${pct === null ? 'indeterminate' : ''}"
          role="progressbar"
          aria-label=${t('imp.progress')}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${pct === null ? nothing : String(pct)}
        >
          <i style=${pct === null ? '' : `width:${pct}%`}></i>
        </div>
        <p class="help">${t('imp.progress.help')}</p>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}</button
        ><button class="btn primary" type="button" disabled>${t('imp.do')}</button>`,
    });
  }

  private errorView(s: ImportState): TemplateResult {
    const code = s.error?.code ?? 'worker';
    const title = hasKey(`imp.err.${code}.title`) ? t(`imp.err.${code}.title` as MessageKey) : code;
    const detail = s.error?.detail ?? '';
    const hintKey = `imp.err.${code}.hint`;
    const hint = hasKey(hintKey) ? t(hintKey as MessageKey, { detail }) : '';
    const size = this.flow?.sourceBytes?.length;
    return this.frame({
      title: t('imp.title.rejected'),
      icon: 'import',
      body: html`<div class="result err" role="alert" data-role="rejected">
          ${icon('err', 'lg err')}
          <div>
            <b><span class="mono code" data-role="code">${code}</span> ${title}</b>
            <p data-role="hint">${hint}</p>
          </div>
        </div>
        <dl class="kvs">
          ${
            s.fileName
              ? html`<dt>${t('imp.kv.file')}</dt>
                  <dd>${s.fileName}${size ? ` (${kb(size)})` : ''}</dd>`
              : nothing
          }
          <dt>${t('imp.kv.changed')}</dt>
          <dd>${t('imp.kv.no')}</dd>
        </dl>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="close" @click=${() => this.close()}>
          ${t('imp.close')} ${this.kbd('Esc')}</button
        ><button
          class="btn primary"
          type="button"
          data-role="another"
          @click=${() => this.pickAnother()}
        >
          ${icon('import', 'sm')}${t('imp.another')}
        </button>`,
    });
  }

  private previewView(s: ImportState): TemplateResult {
    const result = s.result;
    if (!result?.ok) return this.waitingView();
    const rep = result.report;
    const c = rep.counts;
    const target = this.flow ? this.targetPath(s) : '';
    const cert = IMPORT_CERTAINTY_CLASS[rep.generator.certainty] ?? 'warn';
    const bytes = new TextEncoder().encode(result.svg).length;
    const heavy = c.elementsBefore > 20_000;
    const full = this.planError !== null;
    const planText = !full
      ? ''
      : t(`imp.plan.${this.planError}` as MessageKey, {
          n: svgItemLimit(this.targetSchema()),
        });
    return this.frame({
      title: t('imp.title'),
      icon: 'import',
      body: html`<div class="imp-info">
          <span
            >${icon('report', 'sm')} ${t('imp.file')}: <b>${s.fileName}</b> (${kb(
              this.flow?.sourceBytes?.length ?? rep.file.bytes,
            )})</span
          >
          <span
            >${t('imp.generator')}: ${rep.generator.name}
            <span class="chip ${cert}" data-role="certainty"
              >${icon(cert === 'ok' ? 'ok' : cert === 'info' ? 'info' : 'warn')}${
                rep.generator.certainty
              }</span
            ></span
          >
          <span class="muted" data-role="target"
            >${t('imp.target')}: <span class="mono">${target}</span></span
          >
        </div>
        <div class="imp-pv">
          <div class="pvbox">
            <div class="cap">
              ${t('imp.preview.before')}
              <span class="cap-note">${t('imp.preview.beforeNote')}</span>
            </div>
            <div
              class="pv-host"
              data-pv="before"
              role="img"
              aria-label=${t('imp.preview.beforeLabel')}
            ></div>
          </div>
          <div class="pvbox">
            <div class="cap">${t('imp.preview.after')}</div>
            <div
              class="pv-host"
              data-pv="after"
              role="img"
              aria-label=${t('imp.preview.afterLabel')}
            ></div>
          </div>
          <dl class="stat3" data-role="stats">
            <dt>${t('imp.stat.elements')}</dt>
            <dd>
              ${t('imp.stat.elementsValue', { before: fmt(c.elementsBefore), after: fmt(c.elementsAfter) })}
            </dd>
            <dt>${t('imp.stat.uid')}</dt>
            <dd>${fmt(c.uidAssigned)}</dd>
            <dt>${t('imp.stat.named')}</dt>
            <dd>${fmt(c.named)}</dd>
            <dt>${t('imp.stat.depth')}</dt>
            <dd>${c.depth}</dd>
            <dt>${t('imp.stat.size')}</dt>
            <dd>${kb(bytes)}</dd>
            <dt>${t('imp.stat.viewBox')}</dt>
            <dd class="mono">${result.viewBox.join(' ')}</dd>
          </dl>
        </div>
        <mat-import-report .report=${rep}></mat-import-report>
        <label class="inline">
          <input
            type="checkbox"
            data-role="optimize"
            .checked=${s.options.optimize}
            @change=${(e: Event) => void this.flow?.setOptimize((e.target as HTMLInputElement).checked)}
          />
          ${t('imp.optimize')}
        </label>
        <p
          class="help ${heavy ? 'warn-text' : ''}"
          style="margin-top:-6px"
          data-role="optimize-help"
        >
          ${
            heavy
              ? t('imp.optimize.suggest', { n: fmt(c.elementsBefore) })
              : t('imp.optimize.help', { n: fmt(c.elementsBefore) })
          }
          ${
            rep.optimize.enabled
              ? t('imp.optimize.result', {
                  merged: fmt(rep.optimize.merged),
                  saved: fmt(rep.optimize.elementsSaved),
                })
              : ''
          }
        </p>
        ${full ? html`<p class="field-err" role="alert" data-role="plan-error">${planText}</p>` : nothing}
        ${
          this.saveMsg
            ? html`<p
                class=${this.saveMsg.kind === 'err' ? 'field-err' : 'help'}
                role=${this.saveMsg.kind === 'err' ? 'alert' : 'status'}
                data-role="save-msg"
              >
                ${this.saveMsg.text}
              </p>`
            : nothing
        }`,
      foot: html`<select
          class="fmt"
          data-role="format"
          aria-label=${t('imp.format.label')}
          .value=${this.format}
          @change=${(e: Event) =>
            (this.format = (e.target as HTMLSelectElement).value === 'md' ? 'md' : 'json')}
        >
          <option value="json" ?selected=${this.format === 'json'}>${t('imp.format.json')}</option>
          <option value="md" ?selected=${this.format === 'md'}>
            ${t('imp.format.md')}
          </option></select
        ><button
          class="btn"
          type="button"
          data-role="save-report"
          @click=${() => void this.saveReport()}
        >
          ${icon('save', 'sm')}${t('imp.saveReport')} ${this.kbd('Ctrl+S')}</button
        ><span class="grow"></span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}</button
        ><button class="btn primary" type="button" data-role="ok" @click=${() => this.commit()}>
          ${t('imp.do')} ${this.kbd('Enter')}
        </button>`,
    });
  }

  private targetSchema(): string {
    const p = this.app.store.state.outline.project as unknown as { schemaVersion?: unknown } | null;
    return typeof p?.schemaVersion === 'string' ? p.schemaVersion : '0.3.0';
  }

  private targetPath(s: ImportState): string {
    const taken = Object.keys(this.app.store.state.docs).filter((r) => r.startsWith('graphics/'));
    return uniqueSvgPath(s.fileName ?? 'svg', taken);
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.isOpen || !this.flow) return nothing;
    const s = this.flow.state;
    switch (s.phase) {
      case 'preview':
        return this.previewView(s);
      case 'error':
        return this.errorView(s);
      case 'importing':
        return this.processingView(s);
      case 'reading':
      case 'idle':
        return this.waitingView();
      default:
        return nothing;
    }
  }
}

customElements.define('mat-import-svg-dialog', MatImportSvgDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-import-svg-dialog': MatImportSvgDialog;
  }
}
