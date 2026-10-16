// Hộp thoại Nhập lại SVG / Đối chiếu lại (feature 008, T102; FR-028; mockup studio-svg.html cảnh 3): chọn file SVG mới của một item
// `svg` → importSvg có `previous` → tóm tắt giữ / mới / cần chọn / mồ côi, hai phần tử cạnh nhau, chọn ứng viên → Áp dụng (MỘT
// bước hoàn tác) hoặc Hủy (không đổi). Máy trạng thái ở model/reimport-flow.ts; lớp này chỉ hiển thị và chuyển phím. Xem trước
// dựng bằng mountScreen (bản đã lọc, không innerHTML). Trợ năng: role dialog, bẫy focus, Esc hủy, Enter áp dụng, nhãn nút ghi phím.
import { html, nothing, type TemplateResult } from 'lit';
import { mountScreen } from '@mat/svg-renderer';
import { bindablePaths, parseXml, type MatchResult } from '@mat/svg-import';
import { bindingSetOf } from '../../app/svg-bind.ts';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import { defaultImportRunner, type ImportRunner } from '../../model/import-runner.ts';
import {
  ReimportFlow,
  type OrphanMode,
  type ReimportState,
  type ReimportTarget,
} from '../../model/reimport-flow.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './import-svg.css';
import './reimport.css';

/** Bộ chạy importSvg; test thay bản giả. */
export const reimportRunnerRef: { current: ImportRunner } = { current: defaultImportRunner };

const pct = (d: number): string => `${(d * 100).toFixed(1).replace('.', ',')} %`;
const lastSeg = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\[\d+\]$/, '');

interface NewInfo {
  tag: string;
  uid: string | null;
  path: string;
}

export class MatReimportSvgDialog extends OnlineDialog {
  static override properties = { tick: { state: true }, sel: { state: true } };

  protected get kind(): 'reimportSvg' {
    return 'reimportSvg';
  }

  declare tick: number;
  /** `newPath` của mục "Cần chọn" đang xem ở phần hai bên. */
  declare sel: string | null;

  private flow: ReimportFlow | null = null;
  private off: (() => void) | null = null;
  private spec: { screen: string; item: string } | null = null;
  private newIndex: { src: string; map: Map<string, NewInfo> } | null = null;
  private mountedKey = '';

  constructor() {
    super();
    this.tick = 0;
    this.sel = null;
    this.addEventListener('keydown', (e) => this.hostKey(e));
  }

  // ---------- Vòng đời ----------

  protected override opened(): void {
    this.disposeFlow();
    this.sel = null;
    this.newIndex = null;
    this.mountedKey = '';
    const d = this.app.ui.dialog;
    if (d?.kind !== 'reimportSvg') return;
    this.spec = { screen: d.screen, item: d.item };
    const app = this.app;
    const flow = new ReimportFlow({
      open: () => app.svgOpen(),
      run: (bytes, options, onProgress) => reimportRunnerRef.current(bytes, options, onProgress),
      target: () => this.target(),
      apply: (change) => app.store.applyChange(change),
    });
    this.flow = flow;
    this.off = flow.subscribe(() => {
      if (flow.state.phase === 'cancelled') this.app.closeOnlineDialog();
      if (flow.state.phase === 'resolve' && this.sel === null) {
        this.sel = flow.match?.ambiguous[0]?.newPath ?? null;
      }
      this.tick++;
    });
    void flow.start();
  }

  /** Item đích, SVG đang dùng, binding và các item khác dùng chung tệp SVG; `null` khi item không còn. */
  private target(): ReimportTarget | null {
    const spec = this.spec;
    if (spec === null) return null;
    const app = this.app;
    const screen = app.screenModel(spec.screen);
    const item = screen?.items.find((i) => i.id === spec.item);
    if (!screen || !item || item.type !== 'svg') return null;
    const docs = app.store.state.docs;
    const sharers: ReimportTarget['sharers'][number][] = [];
    for (const s of app.store.state.outline.screens) {
      for (const it of s.model?.items ?? []) {
        if (it.type !== 'svg' || it.svgFile !== item.svgFile) continue;
        if (s.id === spec.screen && it.id === spec.item) continue;
        sharers.push({
          screen: s.model!,
          item: it,
          bindings: bindingSetOf(app, { screen: s.id, item: it.id, file: it.bindingFile }),
        });
      }
    }
    return {
      screen,
      item,
      svg:
        docs[item.svgFile] && !docs[item.svgFile]!.removed ? app.store.textOf(item.svgFile) : null,
      bindings: bindingSetOf(app, { screen: spec.screen, item: item.id, file: item.bindingFile }),
      graphicsFiles: Object.keys(docs).filter((r) => r.startsWith('graphics/')),
      sharers,
    };
  }

  protected override willUpdate(): void {
    super.willUpdate();
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
    this.mountedKey = '';
  }

  protected override close(): void {
    this.flow?.cancel();
    super.close();
  }

  // ---------- Hành động ----------

  private commit(): void {
    const flow = this.flow;
    if (!flow || flow.state.phase !== 'resolve') return;
    const sum = flow.summary();
    const name = this.itemName();
    if (!flow.commit()) return;
    if (this.spec !== null) this.app.selectItems(this.spec.screen, [this.spec.item]);
    this.app.toast(
      t('imp.re.done', {
        name,
        kept: String(sum.kept),
        added: String(sum.added),
        orphans: String(flow.keptOrphanCount()),
      }),
    );
    this.app.closeOnlineDialog();
  }

  private itemName(): string {
    const spec = this.spec;
    if (spec === null) return '';
    const it = this.app.screenModel(spec.screen)?.items.find((i) => i.id === spec.item);
    return it === undefined ? spec.item : ((it as { name?: string }).name ?? it.id);
  }

  /** Enter áp dụng (khi focus không ở nút, ô chọn hay phần tử danh sách); Ctrl+Enter luôn áp dụng. */
  private hostKey(e: KeyboardEvent): void {
    if (!this.isOpen || !this.flow || this.flow.state.phase !== 'resolve') return;
    if (e.key !== 'Enter' || e.altKey || e.shiftKey || e.isComposing) return;
    if (!e.ctrlKey && !e.metaKey) {
      const el = e.target;
      if (el instanceof HTMLElement && el.closest('button, select, input, a, [role="option"]'))
        return;
    }
    e.preventDefault();
    this.commit();
  }

  private onOptionKey(e: KeyboardEvent, ids: readonly string[], id: string): void {
    if (e.ctrlKey || e.metaKey) return;
    const i = ids.indexOf(id);
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(ids.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.sel = id;
      return;
    } else return;
    e.preventDefault();
    const nid = ids[next]!;
    this.sel = nid;
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>(`[data-new="${CSS.escape(nid)}"]`)?.focus(),
    );
  }

  // ---------- Xem trước hai phần tử ----------

  private newInfoOf(svg: string, path: string): NewInfo {
    if (this.newIndex?.src !== svg) {
      const map = new Map<string, NewInfo>();
      const p = parseXml(svg);
      if (p.ok)
        for (const b of bindablePaths(p.root))
          map.set(b.path, {
            tag: b.el.localName,
            uid: b.el.getAttribute('data-mat-uid'),
            path: b.path,
          });
      this.newIndex = { src: svg, map };
    }
    return this.newIndex.map.get(path) ?? { tag: lastSeg(path), uid: null, path };
  }

  protected override updated(): void {
    super.updated();
    this.mountSides();
  }

  private mountSides(): void {
    const flow = this.flow;
    const s = flow?.state;
    const m = flow?.match;
    if (!flow || !s || s.phase !== 'resolve' || !s.result?.ok || !m || this.sel === null) return;
    const amb = m.ambiguous.find((a) => a.newPath === this.sel);
    const neu = this.querySelector<HTMLElement>('[data-pv="new"]');
    const old = this.querySelector<HTMLElement>('[data-pv="old"]');
    if (!amb || !neu) return;
    const picked = s.choices[amb.newPath] ?? null;
    const cand = picked ?? this.previewCandidate(amb);
    const key = `${amb.newPath}|${cand ?? ''}|${s.result.svg.length}`;
    if (key === this.mountedKey && this.querySelector('.pvw .hl') !== null) return;
    this.mountedKey = key;
    const target = this.target();
    const viewBox = s.result.viewBox;
    const layout = { viewBox, fitMode: 'contain' as const, elements: [] };
    const info = this.newInfoOf(s.result.svg, amb.newPath);
    this.mountOne(neu, s.result.svg, layout, info.uid);
    if (old && target?.svg) this.mountOne(old, target.svg, layout, cand);
    else old?.replaceChildren();
  }

  /** Ứng viên hiển thị ở bên "Cũ": ứng viên đã chọn, không thì ứng viên gần nhất. */
  private previewCandidate(a: MatchResult['ambiguous'][number]): string | null {
    return a.candidates[0]?.oldUid ?? null;
  }

  private mountOne(
    host: HTMLElement,
    svg: string,
    layout: Parameters<typeof mountScreen>[2],
    uid: string | null,
  ): void {
    try {
      mountScreen(host, svg, layout);
    } catch {
      host.replaceChildren(t('imp.preview.fail'));
      return;
    }
    const hl = host.parentElement?.querySelector<HTMLElement>('.hl');
    if (!hl) return;
    hl.hidden = true;
    const el =
      uid === null || !host.shadowRoot
        ? null
        : host.shadowRoot.querySelector(`[data-mat-uid="${CSS.escape(uid)}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    hl.style.left = `${r.left - h.left - 2}px`;
    hl.style.top = `${r.top - h.top - 2}px`;
    hl.style.width = `${Math.max(6, r.width) + 4}px`;
    hl.style.height = `${Math.max(6, r.height) + 4}px`;
    hl.hidden = false;
  }

  // ---------- Hiển thị ----------

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
      this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])') ??
      this.querySelector<HTMLElement>('.dlg-f button')
    );
  }

  private kbd(label: string) {
    return html`<kbd>${label}</kbd>`;
  }

  private waitingView(): TemplateResult {
    return this.frame({
      title: t('imp.re.title', { name: this.itemName() }),
      icon: 'import',
      busy: true,
      body: html`<p class="row" role="status" data-role="waiting">
        <span class="spin" aria-hidden="true"></span>${t('imp.re.waiting')}
      </p>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}
        </button>`,
    });
  }

  private processingView(s: ReimportState): TemplateResult {
    return this.frame({
      title: t('imp.re.title.processing', { name: s.fileName ?? '' }),
      icon: 'import',
      busy: true,
      body: html`<div class="steps" role="status" aria-live="polite" data-role="steps">
        <div class="st">
          <span class="spin" aria-hidden="true"></span><span>${t('imp.step.clean')}</span>
        </div>
      </div>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}</button
        ><button class="btn primary" type="button" disabled>${t('imp.re.do')}</button>`,
    });
  }

  private errorView(s: ReimportState): TemplateResult {
    const code = s.error?.code ?? 'worker';
    const tk = `imp.re.err.${code}.title`;
    const title = hasKey(tk)
      ? t(tk as MessageKey)
      : hasKey(`imp.err.${code}.title`)
        ? t(`imp.err.${code}.title` as MessageKey)
        : code;
    const detail = s.error?.detail ?? '';
    const hk = hasKey(`imp.re.err.${code}.hint`)
      ? `imp.re.err.${code}.hint`
      : `imp.err.${code}.hint`;
    const hint = hasKey(hk) ? t(hk as MessageKey, { detail }) : '';
    return this.frame({
      title: t('imp.re.title.rejected'),
      icon: 'import',
      body: html`<div class="result err" role="alert" data-role="rejected">
          ${icon('err', 'lg err')}
          <div>
            <b><span class="mono code" data-role="code">${code}</span> ${title}</b>
            <p data-role="hint">${hint}</p>
          </div>
        </div>
        <dl class="kvs">
          <dt>${t('imp.kv.changed')}</dt>
          <dd>${t('imp.kv.no')}</dd>
        </dl>`,
      foot: html`<span class="grow"></span
        ><button class="btn" type="button" data-role="close" @click=${() => this.close()}>
          ${t('imp.close')} ${this.kbd('Esc')}</button
        >${
          code === 'E_NO_TARGET'
            ? nothing
            : html`<button
                class="btn primary"
                type="button"
                data-role="another"
                @click=${() => void this.flow?.start()}
              >
                ${icon('import', 'sm')}${t('imp.another')}
              </button>`
        }`,
    });
  }

  private resolveView(s: ReimportState): TemplateResult {
    const flow = this.flow!;
    const m = flow.match;
    const sum = flow.summary();
    const orphans = flow.orphanList();
    const need = m?.ambiguous ?? [];
    const flat = (n: number) => String(n);
    const bound = orphans.filter((o) => o.hasBinding || o.hasEvent);
    const total = Math.max(1, sum.kept + sum.added + sum.ambiguous + sum.orphansBound);
    const seg = (n: number, cls: string): TemplateResult =>
      html`<i class=${cls} style=${`flex:${(n / total).toFixed(4)}`}></i>`;
    const amb = need.find((a) => a.newPath === this.sel) ?? null;
    const sharers = this.target()?.sharers.length ?? 0;
    const ids = need.map((a) => a.newPath);
    return this.frame({
      title: t('imp.re.title', { name: this.itemName() }),
      icon: 'import',
      body: html`<div class="rc-sum" data-role="summary">
          <span class="chip ok" data-role="n-kept"
            >${icon('ok')}${t('imp.re.kept', { n: flat(sum.kept) })}</span
          >
          <span class="chip info" data-role="n-added"
            >${icon('plus')}${t('imp.re.added', { n: flat(sum.added) })}</span
          >
          <span class="chip warn" data-role="n-need"
            >${icon('warn')}${t('imp.re.need', { n: flat(sum.ambiguous) })}</span
          >
          <span class="chip err" data-role="n-orphan"
            >${icon('err')}${t('imp.re.orphan', { n: flat(sum.orphansBound) })}</span
          >
          <span class="grow"></span>
          <span class="help">${t('imp.re.file')}: <b>${s.fileName}</b> · ${t('imp.re.how')}</span>
        </div>
        <div
          class="rc-bar"
          role="img"
          aria-label=${t('imp.re.bar', {
            kept: flat(sum.kept),
            added: flat(sum.added),
            need: flat(sum.ambiguous),
            orphan: flat(sum.orphansBound),
          })}
        >
          ${seg(sum.kept, 'k')}${seg(sum.added, 'a')}${seg(sum.ambiguous, 'n')}${seg(sum.orphansBound, 'o')}
        </div>
        <div class="rc-cols">
          <div class="rc-left">
            <div class="rc-list">
              <h4>
                ${icon('warn', 'sm warn')}${t('imp.re.need.title')}
                <span class="badge warn">${sum.ambiguous}</span>
                <span class="help rc-help">${t('imp.re.need.help')}</span>
              </h4>
              ${
                need.length === 0
                  ? html`<p class="rc-empty" data-role="need-none">${t('imp.re.need.none')}</p>`
                  : html`<div
                      role="listbox"
                      aria-label=${t('imp.re.need.label')}
                      data-role="need-list"
                    >
                      ${need.map((a) => this.needRow(a, s, ids))}
                    </div>`
              }
            </div>
            <div class="rc-list">
              <h4>
                ${icon('err', 'sm err')}${t('imp.re.orph.title')}
                <span class="badge">${bound.length}</span>
              </h4>
              ${
                bound.length === 0
                  ? html`<p class="rc-empty" data-role="orphan-none">${t('imp.re.orph.none')}</p>`
                  : bound.map((o) => this.orphanRow(o, s))
              }
            </div>
          </div>
          <div class="rc-right rc-list">
            <h4>
              ${t('imp.re.side.title')}
              <span class="help rc-help">${t('imp.re.side.help')}</span>
            </h4>
            ${amb ? this.sideView(amb, s) : html`<p class="rc-empty" data-role="side-none">${t('imp.re.side.none')}</p>`}
          </div>
        </div>
        ${
          sharers > 0
            ? html`<fieldset class="rc-share" data-role="share">
                <legend class="help">${t('imp.re.share.legend', { n: flat(sharers) })}</legend>
                <label
                  ><input
                    type="radio"
                    name="rc-share"
                    data-role="share-split"
                    .checked=${s.shareMode === 'split'}
                    @change=${() => flow.setShare('split')}
                  />
                  ${t('imp.re.share.split')}</label
                >
                <label
                  ><input
                    type="radio"
                    name="rc-share"
                    data-role="share-all"
                    .checked=${s.shareMode === 'all'}
                    @change=${() => flow.setShare('all')}
                  />
                  ${t('imp.re.share.all')}</label
                >
              </fieldset>`
            : nothing
        }`,
      foot: html`<span class="help rc-hint">${t('imp.re.hint')}</span
        ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('imp.cancel')} ${this.kbd('Esc')}</button
        ><button class="btn primary" type="button" data-role="ok" @click=${() => this.commit()}>
          ${t('imp.re.do')} ${this.kbd('Enter')}
        </button>`,
    });
  }

  private needRow(a: MatchResult['ambiguous'][number], s: ReimportState, ids: readonly string[]) {
    const neu = s.result?.ok ? this.newInfoOf(s.result.svg, a.newPath) : null;
    const picked = s.choices[a.newPath] ?? null;
    const selected = this.sel === a.newPath;
    const names = a.candidates.map((c) => c.name || c.oldUid).join(', ');
    return html`<div
      class="rc-item ${selected ? 'sel' : ''}"
      role="option"
      tabindex=${selected ? '0' : '-1'}
      aria-selected=${selected ? 'true' : 'false'}
      data-new=${a.newPath}
      @click=${() => (this.sel = a.newPath)}
      @keydown=${(e: KeyboardEvent) => this.onOptionKey(e, ids, a.newPath)}
    >
      <span
        ><b class="mono">${neu?.tag ?? ''} ${a.newPath}</b
        ><small>${t('imp.re.cand', { names })}</small></span
      >
      <span class="chip ${picked === null ? '' : 'info'}" data-role="state"
        >${picked === null ? t('imp.re.chip.new') : t('imp.re.chip.old')}</span
      >
    </div>`;
  }

  private orphanRow(o: MatchResult['orphans'][number], s: ReimportState) {
    const mode: OrphanMode = s.orphanModes[o.oldUid] ?? 'drop';
    const label = o.name || o.oldUid;
    const btn = (m: OrphanMode, text: string): TemplateResult =>
      html`<button
        type="button"
        class="btn"
        aria-pressed=${mode === m ? 'true' : 'false'}
        data-orphan=${o.oldUid}
        data-mode=${m}
        @click=${() => this.flow?.setOrphan(o.oldUid, m)}
      >
        ${text}
      </button>`;
    return html`<div class="rc-item rc-orph" data-role="orphan">
        <span
          ><b>"${label}"</b
          ><small
            >${t('imp.re.orph.sub', { n: o.hasBinding && o.hasEvent ? '2' : '1' })}
            <span class="mono">${o.oldUid}</span></small
          ></span
        >
        <div class="seg" role="group" aria-label=${t('imp.re.orph.group', { name: label })}>
          ${btn('drop', t('imp.re.orph.drop'))}${btn('keep', t('imp.re.orph.keep'))}
        </div>
      </div>
      ${
        mode === 'keep'
          ? html`<div class="rc-warn" role="note" data-role="keep-warn">
              ${icon('err', 'sm err')}${t('imp.re.orph.keepWarn')}
            </div>`
          : nothing
      }`;
  }

  private sideView(a: MatchResult['ambiguous'][number], s: ReimportState): TemplateResult {
    const flow = this.flow!;
    const neu = s.result?.ok ? this.newInfoOf(s.result.svg, a.newPath) : null;
    const picked = s.choices[a.newPath] ?? null;
    const cand = a.candidates.find((c) => c.oldUid === picked) ?? a.candidates[0]!;
    const showOld = picked !== null;
    const label = `${neu?.tag ?? ''} ${a.newPath}`;
    return html`<div class="cmp">
        <div class="side">
          <div class="cap">${icon('plus', 'sm')}${t('imp.re.side.new')}</div>
          <div class="pvw">
            <div
              class="pv-host"
              data-pv="new"
              role="img"
              aria-label=${t('imp.re.side.newLabel')}
            ></div>
            <i class="hl" hidden></i>
          </div>
          <dl class="kv">
            <dt>${t('imp.re.kv.tag')}</dt>
            <dd class="mono">${neu?.tag ?? ''}</dd>
            <dt>${t('imp.re.kv.path')}</dt>
            <dd class="mono">${a.newPath}</dd>
          </dl>
        </div>
        <div class="side">
          <div class="cap">${icon('err', 'sm')}${t('imp.re.side.old')}</div>
          <div class="pvw">
            <div
              class="pv-host"
              data-pv="old"
              role="img"
              aria-label=${t('imp.re.side.oldLabel')}
            ></div>
            <i class="hl" hidden></i>
          </div>
          <dl class="kv" data-role="old-kv">
            <dt>${t('imp.re.kv.name')}</dt>
            <dd>${cand.name || '-'}</dd>
            <dt>${t('imp.re.kv.uid')}</dt>
            <dd class="mono">${cand.oldUid}</dd>
            <dt>${t('imp.re.kv.diff')}</dt>
            <dd>${pct(cand.d)}</dd>
            <dt>${t('imp.re.kv.binding')}</dt>
            <dd class=${cand.hasBinding ? 'df' : ''}>
              ${cand.hasBinding ? t('imp.re.kv.yes') : t('imp.re.kv.no')}
            </dd>
            <dt>${t('imp.re.kv.event')}</dt>
            <dd class=${cand.hasEvent ? 'df' : ''}>
              ${cand.hasEvent ? t('imp.re.kv.yes') : t('imp.re.kv.no')}
            </dd>
          </dl>
          ${showOld ? nothing : html`<p class="help" data-role="no-old">${t('imp.re.side.noOld')}</p>`}
        </div>
      </div>
      <fieldset class="rc-radios" data-role="pick">
        <legend class="help">${t('imp.re.pick.legend')}</legend>
        ${a.candidates.map(
          (c) =>
            html`<label
              ><input
                type="radio"
                name=${`rc-${a.newPath}`}
                value=${c.oldUid}
                data-role="pick-old"
                .checked=${picked === c.oldUid}
                aria-label=${t('imp.re.pick.group', { name: label })}
                @change=${() => flow.choose(a.newPath, c.oldUid)}
              />
              ${t('imp.re.pick.cand', {
                name: c.name || c.oldUid,
                pct: pct(c.d),
                b: c.hasBinding ? t('imp.re.pick.hasBinding') : t('imp.re.pick.noBinding'),
              })}</label
            >`,
        )}
        <label
          ><input
            type="radio"
            name=${`rc-${a.newPath}`}
            value="new"
            data-role="pick-new"
            .checked=${picked === null}
            @change=${() => flow.choose(a.newPath, null)}
          />
          ${t('imp.re.pick.new')} <span class="chip ok">${t('imp.re.pick.safe')}</span></label
        >
      </fieldset>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.isOpen || !this.flow) return nothing;
    const s = this.flow.state;
    switch (s.phase) {
      case 'resolve':
        return this.resolveView(s);
      case 'matching':
      case 'importing':
        return this.processingView(s);
      case 'error':
        return this.errorView(s);
      case 'reading':
      case 'idle':
        return this.waitingView();
      default:
        return nothing;
    }
  }
}

customElements.define('mat-reimport-svg-dialog', MatReimportSvgDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-reimport-svg-dialog': MatReimportSvgDialog;
  }
}
