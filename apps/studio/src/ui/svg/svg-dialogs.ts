// Hộp thoại của trình vẽ SVG (feature 011, T161, T163; FR-109, FR-110, FR-112, FR-113, FR-105; mockup studio-svg-draw cảnh 2):
//  - "Khôi phục bản tự lưu" (mở project sau tắt đột ngột): từng tệp chọn bản, Khôi phục hoặc Bỏ; Xem khác biệt (số nút,
//    cỡ); khôi phục mở tệp ở trạng thái chưa lưu, tệp trên đĩa chỉ đổi khi Lưu;
//  - "Tệp đã đổi bên ngoài": Nạp lại (bỏ thay đổi, xóa lịch sử hoàn tác) hoặc Giữ bản đang sửa (lần Lưu sau hỏi trước khi ghi
//    đè); So sánh; báo uid đang có binding mà bản trên đĩa không còn (T007 quyết định 8);
//  - "Xóa phần tử có binding": liệt kê binding sẽ mất; hoàn tác khôi phục cả phần tử lẫn binding (FR-110);
//  - "Đã dán SVG từ clipboard (đã lọc)": những gì bị loại (FR-109);
//  - "Xóa lớp": xóa luôn nội dung hay chuyển sang Lớp mặc định (FR-105).
import { html, nothing } from 'lit';
import { findByUid, parseDrawDoc, utf8Length } from '@mat/svg-edit';
import { t } from '../../i18n/index.ts';
import { OnlineDialog } from '../dialogs/dialog-frame.ts';

const time = (ms: number | null) =>
  ms === null || ms === 0 ? '—' : new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });

export class MatSvgRestoreDialog extends OnlineDialog {
  protected readonly kind = 'svgRestore' as const;
  static override properties = { picks: { state: true }, diff: { state: true } };
  declare picks: Map<string, string | null>;
  declare diff: boolean;

  constructor() {
    super();
    this.picks = new Map();
    this.diff = false;
  }

  protected override opened(): void {
    this.picks = new Map(this.app.svg.offers.map((o) => [o.rel, o.versions[0]?.name ?? null]));
    this.diff = false;
  }

  protected override close(): void {
    // đóng không chọn: giữ bản tự lưu trên đĩa (lần mở sau hỏi lại)
    this.app.svg.offers = [];
    super.close();
  }

  private async finish(all: 'restore' | 'discard' | 'picked'): Promise<void> {
    const ws = this.app.svg;
    const choices = ws.offers.map((o) => ({
      rel: o.rel,
      name:
        all === 'discard'
          ? null
          : all === 'restore'
            ? (this.picks.get(o.rel) ?? o.versions[0].name)
            : (this.picks.get(o.rel) ?? null),
    }));
    this.app.closeOnlineDialog();
    await ws.restore(choices);
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const offers = this.app.svg.offers;
    const restoring = offers.filter((o) => this.picks.get(o.rel) !== null).length;
    const body = html`<div class="sv-dlg">
      <div class="warnbox" role="note">${t('svgd.restore.warn', { n: offers.length })}</div>
      <table class="tb" aria-label=${t('svgd.restore.table')}>
        <thead>
          <tr>
            <th>${t('svgd.restore.file')}</th>
            <th>${t('svgd.restore.disk')}</th>
            <th>${t('svgd.restore.version')}</th>
            ${this.diff ? html`<th>${t('svgd.restore.diff')}</th>` : nothing}
            <th>${t('svgd.restore.action')}</th>
          </tr>
        </thead>
        <tbody>
          ${offers.map((o) => {
            const pick = this.picks.get(o.rel) ?? null;
            const v = o.versions.find((x) => x.name === pick) ?? o.versions[0];
            let diff = '';
            if (this.diff && v) {
              const p = parseDrawDoc(v.text, { domCheck: false });
              diff = p.ok
                ? t('svgd.restore.diffText', {
                    n: p.doc.elementCount,
                    kb: Math.ceil(utf8Length(v.text) / 1024),
                  })
                : p.message;
            }
            return html`<tr data-rel=${o.rel}>
              <td class="mono">${o.rel}</td>
              <td class="num">
                ${o.diskMtimeMs === null ? t('svgd.restore.newFile') : time(o.diskMtimeMs)}
              </td>
              <td>
                <select
                  class="select sm"
                  aria-label=${t('svgd.restore.pick', { file: o.rel })}
                  @change=${(e: Event) => {
                    const m = new Map(this.picks);
                    m.set(o.rel, (e.target as HTMLSelectElement).value);
                    this.picks = m;
                  }}
                >
                  ${o.versions.map((x, i) => html`<option value=${x.name} ?selected=${x.name === v?.name}>${time(x.mtimeMs)}${i === 0 ? ` (${t('svgd.restore.latest')})` : ''}</option>`)}
                </select>
              </td>
              ${this.diff ? html`<td>${diff}</td>` : nothing}
              <td>
                <span class="seg sm" role="group" aria-label=${t('svgd.restore.action')}>
                  <button
                    type="button"
                    aria-pressed=${pick !== null ? 'true' : 'false'}
                    @click=${() => this.set(o.rel, v?.name ?? null)}
                  >
                    ${t('svgd.restore.restore')}
                  </button>
                  <button
                    type="button"
                    aria-pressed=${pick === null ? 'true' : 'false'}
                    @click=${() => this.set(o.rel, null)}
                  >
                    ${t('svgd.restore.discard')}
                  </button>
                </span>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      <p class="help">${t('svgd.restore.help')}</p>
    </div>`;
    const foot = html`<button
        type="button"
        class="btn"
        aria-pressed=${this.diff ? 'true' : 'false'}
        @click=${() => (this.diff = !this.diff)}
      >
        ${t('svgd.restore.showDiff')}
      </button>
      <span class="grow"></span>
      <button
        type="button"
        class="btn"
        data-role="discard-all"
        @click=${() => void this.finish('discard')}
      >
        ${t('svgd.restore.discardAll')}
      </button>
      <button
        type="button"
        class="btn primary"
        data-role="ok"
        @click=${() => void this.finish('picked')}
      >
        ${t('svgd.restore.ok', { n: restoring })}
      </button>`;
    return this.frame({ title: t('svgd.restore.title'), icon: 'restore', body, foot });
  }

  private set(rel: string, name: string | null): void {
    const m = new Map(this.picks);
    m.set(rel, name);
    this.picks = m;
  }
}

export class MatSvgExternalDialog extends OnlineDialog {
  protected readonly kind = 'svgExternal' as const;
  static override properties = { compare: { state: true }, info: { state: true } };
  declare compare: boolean;
  declare info: { nodes: number; kb: number; missing: string[] } | null;

  constructor() {
    super();
    this.compare = false;
    this.info = null;
  }

  private rel(): string | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'svgExternal' ? d.rel : null;
  }

  protected override opened(): void {
    this.compare = false;
    this.info = null;
    void this.load();
  }

  /** Bản trên đĩa: số nút, cỡ, uid đang có binding mà bản trên đĩa không còn. */
  private async load(): Promise<void> {
    const rel = this.rel();
    if (!rel) return;
    const r = await this.app.platform.read(rel);
    if (!('text' in r)) {
      this.info = { nodes: 0, kb: 0, missing: [] };
      return;
    }
    const p = parseDrawDoc(r.text, { domCheck: false });
    const s = this.app.svg.session(rel);
    const bound = s
      ? this.app.svg.bindingRefs(
          rel,
          [...s.doc.nodes.values()].map((n) => n.attrs.get('data-mat-uid') ?? '').filter(Boolean),
        )
      : [];
    const missing = p.ok
      ? [...new Set(bound.map((b) => b.uid))].filter((u) => findByUid(p.doc, u) === null)
      : [];
    this.info = {
      nodes: p.ok ? p.doc.elementCount : 0,
      kb: Math.ceil(utf8Length(r.text) / 1024),
      missing,
    };
  }

  protected override close(): void {
    const rel = this.rel();
    if (rel) this.app.svg.keepMine(rel);
    super.close();
  }

  protected override render() {
    const rel = this.rel();
    if (!this.isOpen || rel === null) return nothing;
    const ws = this.app.svg;
    const ext = ws.external;
    const s = ws.session(rel);
    const info = this.info;
    const body = html`<div class="sv-dlg">
      <p><b class="mono">${rel}</b> ${ext?.missing ? t('svgd.ext.gone') : t('svgd.ext.changed')}</p>
      <dl class="kv">
        <dt>${t('svgd.ext.loaded')}</dt>
        <dd class="mono">
          ${time(s?.base.disk?.mtimeMs ?? null)} · sha256
          ${(s?.base.hash ?? '').slice(0, 4)}…${(s?.base.hash ?? '').slice(-4)}
        </dd>
        <dt>${t('svgd.ext.now')}</dt>
        <dd class="mono">
          ${ext?.disk ? `${time(ext.disk.mtimeMs)} · sha256 ${ext.disk.hash.slice(0, 4)}…${ext.disk.hash.slice(-4)}` : t('svgd.ext.missing')}
        </dd>
        <dt>${t('svgd.ext.mine')}</dt>
        <dd>${t('svgd.ext.mineText', { n: s?.undo.undoSize ?? 0 })}</dd>
        ${
          info && info.missing.length
            ? html`<dt>${t('svgd.ext.bindings')}</dt>
                <dd data-k="orphans">${t('svgd.ext.orphans', { n: info.missing.length })}</dd>`
            : nothing
        }
        ${
          this.compare && info
            ? html`<dt>${t('svgd.ext.compare')}</dt>
                <dd data-k="compare">
                  ${t('svgd.ext.compareText', { a: s?.doc.elementCount ?? 0, b: info.nodes, kb: info.kb })}
                </dd>`
            : nothing
        }
      </dl>
      <div class="warnbox" role="note">${t('svgd.ext.warn')}</div>
      <p class="help">${t('svgd.ext.help')}</p>
    </div>`;
    const foot = html`<button
        type="button"
        class="btn"
        aria-pressed=${this.compare ? 'true' : 'false'}
        @click=${() => (this.compare = !this.compare)}
      >
        ${t('svgd.ext.compareBtn')}
      </button>
      <span class="grow"></span>
      <button type="button" class="btn" data-role="keep" @click=${() => this.close()}>
        ${t('svgd.ext.keep')}
      </button>
      <button
        type="button"
        class="btn primary"
        data-role="reload"
        ?disabled=${ext?.missing}
        @click=${() => {
          this.app.closeOnlineDialog();
          void ws.reloadFromDisk(rel);
        }}
      >
        ${t('svgd.ext.reload')}
      </button>`;
    return this.frame({ title: t('svgd.ext.title'), icon: 'warn', body, foot });
  }
}

export class MatSvgDeleteDialog extends OnlineDialog {
  protected readonly kind = 'svgDelete' as const;

  protected override close(): void {
    this.app.svg.cancelDelete();
    super.close();
  }

  protected override initialFocus(): HTMLElement | null {
    // hành động phá hủy: focus đầu tiên vào Hủy
    return this.querySelector<HTMLElement>('[data-role="cancel"]');
  }

  protected override render() {
    const p = this.hasApp ? this.app.svg.pendingDelete : null;
    if (!this.isOpen || !p) return nothing;
    const files = new Set(p.refs.map((r) => r.file)).size;
    const body = html`<div class="sv-dlg">
      <p>${t('svgd.del.text', { what: p.what, n: p.refs.length, files })}</p>
      <table class="tb" aria-label=${t('svgd.del.table')}>
        <thead>
          <tr>
            <th>uid</th>
            <th>${t('svgd.del.where')}</th>
            <th>${t('svgd.del.what')}</th>
          </tr>
        </thead>
        <tbody>
          ${p.refs.map(
            (r) =>
              html`<tr>
                <td class="mono">${r.uid}</td>
                <td class="mono">${r.screen} · ${r.item}</td>
                <td>${r.rows.join('; ')}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      <p class="help">${t('svgd.del.help')}</p>
    </div>`;
    const foot = html`<span class="grow"></span>
      <button type="button" class="btn" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}
      </button>
      <button
        type="button"
        class="btn sv-danger"
        data-role="ok"
        @click=${() => {
          this.app.closeOnlineDialog();
          this.app.svg.confirmDelete();
        }}
      >
        ${t('svgd.del.ok', { n: p.refs.length })}
      </button>`;
    return this.frame({
      title: t('svgd.del.title', { what: p.what, n: p.refs.length }),
      icon: 'warn',
      body,
      foot,
    });
  }
}

export class MatSvgPasteDialog extends OnlineDialog {
  protected readonly kind = 'svgPasteReport' as const;

  protected override render() {
    const p = this.hasApp ? this.app.svg.pasteReport : null;
    if (!this.isOpen || !p) return nothing;
    const rep = p.report;
    const body = html`<div class="sv-dlg">
      <div class="okbox" role="note">${t('svgd.paste.ok', { n: p.count })}</div>
      <div class="warnbox" role="note">
        ${t('svgd.paste.removed', { e: rep.removedElements, a: rep.removedAttributes })}
      </div>
      <table class="tb" aria-label=${t('svgd.paste.table')}>
        <thead>
          <tr>
            <th>${t('svgd.paste.what')}</th>
            <th>${t('svgd.paste.why')}</th>
            <th>${t('svgd.paste.count')}</th>
          </tr>
        </thead>
        <tbody>
          ${rep.removed.map(
            (r) =>
              html`<tr>
                <td class="mono">${r.name}</td>
                <td>${r.reason ?? r.code}</td>
                <td class="num">${r.count}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      <p class="help">${t('svgd.paste.help')}</p>
    </div>`;
    const foot = html`<span class="grow"></span
      ><button type="button" class="btn primary" data-role="ok" @click=${() => this.close()}>
        ${t('dlg.close')}
      </button>`;
    return this.frame({ title: t('svgd.paste.title'), icon: 'paste', body, foot });
  }
}

export class MatSvgLayerDeleteDialog extends OnlineDialog {
  protected readonly kind = 'svgLayerDelete' as const;

  private spec(): { rel: string; layer: string } | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'svgLayerDelete' ? { rel: d.rel, layer: d.layer } : null;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('[data-role="move"]');
  }

  protected override render() {
    const sp = this.spec();
    if (!this.isOpen || !sp) return nothing;
    const ws = this.app.svg;
    const ed = ws.editor(sp.rel);
    const row = ed?.layerRows().find((r) => r.name === sp.layer);
    const n = row?.children.length ?? 0;
    const plan = ed?.planDeleteLayer(sp.layer, 'content');
    const lost = plan && typeof plan !== 'string' ? ws.bindingRefs(sp.rel, plan.uids).length : 0;
    const run = (mode: 'content' | 'move') => {
      this.app.closeOnlineDialog();
      ws.deleteLayer(sp.rel, sp.layer, mode);
    };
    const body = html`<div class="sv-dlg">
      <p>${t('svgd.ldel.text', { name: sp.layer, n })}</p>
      ${lost ? html`<div class="warnbox" role="note">${t('svgd.ldel.bindings', { n: lost })}</div>` : nothing}
    </div>`;
    const foot = html`<span class="grow"></span>
      <button type="button" class="btn" @click=${() => this.close()}>${t('dlg.cancel')}</button>
      <button
        type="button"
        class="btn sv-danger"
        data-role="content"
        @click=${() => run('content')}
      >
        ${t('svgd.ldel.content')}
      </button>
      <button type="button" class="btn primary" data-role="move" @click=${() => run('move')}>
        ${t('svgd.ldel.move')}
      </button>`;
    return this.frame({
      title: t('svgd.ldel.title', { name: sp.layer }),
      icon: 'trash',
      body,
      foot,
    });
  }
}

customElements.define('mat-svg-restore-dialog', MatSvgRestoreDialog);
customElements.define('mat-svg-external-dialog', MatSvgExternalDialog);
customElements.define('mat-svg-delete-dialog', MatSvgDeleteDialog);
customElements.define('mat-svg-paste-dialog', MatSvgPasteDialog);
customElements.define('mat-svg-layer-delete-dialog', MatSvgLayerDeleteDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-restore-dialog': MatSvgRestoreDialog;
    'mat-svg-external-dialog': MatSvgExternalDialog;
    'mat-svg-delete-dialog': MatSvgDeleteDialog;
    'mat-svg-paste-dialog': MatSvgPasteDialog;
    'mat-svg-layer-delete-dialog': MatSvgLayerDeleteDialog;
  }
}
