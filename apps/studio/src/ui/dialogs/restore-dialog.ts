// Hộp thoại Khôi phục (feature 005, US2, T123, FR-024; theo confirmRestore của mockup đã duyệt): danh sách bản lưu
// của thiết bị (phiên bản, digest, thời điểm, người nạp), chọn rồi xác nhận, sau đó tiến trình và kết quả giống Nạp
// xuống (cùng `DownloadFlow`, kind = restore). Danh sách do `app.deploy.versions` giữ.
import { html, nothing } from 'lit';
import { deviceErrorText } from '../../app/device-errors.ts';
import type { VersionRow } from '../../app/download-env.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { icon } from '../base.ts';
import { MatDownloadDialog } from './download-dialog.ts';

const SOURCE_KEY: Readonly<Record<string, MessageKey>> = {
  studio: 'rs.source.studio',
  'runtime-package': 'rs.source.runtime-package',
  restore: 'rs.source.restore',
};

const shortDigest = (d: string): string => d.replace(/^sha256:/, '').slice(0, 8);

export class MatRestoreDialog extends MatDownloadDialog {
  protected override readonly kind = 'restore';
  private selected: number | null = null;
  private confirming = false;

  protected override opened(): void {
    this.selected = null;
    this.confirming = false;
  }

  private pick(row: VersionRow): void {
    if (!row.restorable) return;
    this.selected = row.seq;
    this.requestUpdate();
  }

  private by(row: VersionRow): string {
    if (!row.deployedBy) return '';
    const source = row.source && SOURCE_KEY[row.source] ? t(SOURCE_KEY[row.source]) : '';
    return row.deployedFrom && row.source !== 'runtime-package'
      ? t('rs.by', { user: row.deployedBy, source: row.deployedFrom })
      : `${row.deployedBy}${source ? ` · ${source}` : ''}`;
  }

  private tableView(rows: readonly VersionRow[]) {
    const stateText = (r: VersionRow) =>
      r.state === 'active'
        ? t('rs.state.active')
        : r.restorable
          ? t('rs.state.backup')
          : t('rs.state.broken');
    return html`<div class="gridwrap framed">
      <table class="grid dense" aria-label=${t('rs.table')}>
        <thead>
          <tr>
            <th></th>
            <th>${t('rs.col.version')}</th>
            <th>${t('rs.col.digest')}</th>
            <th>${t('rs.col.time')}</th>
            <th>${t('rs.col.by')}</th>
            <th>${t('rs.col.state')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr
                data-seq=${r.seq}
                data-active=${r.state === 'active'}
                aria-selected=${this.selected === r.seq ? 'true' : 'false'}
                @click=${() => this.pick(r)}
              >
                <td>
                  <input
                    type="radio"
                    name="rs-pick"
                    aria-label=${`${r.projectVersion} · ${stateText(r)}`}
                    ?disabled=${!r.restorable}
                    .checked=${this.selected === r.seq}
                    @change=${() => this.pick(r)}
                  />
                </td>
                <td>${r.projectName} ${r.projectVersion}</td>
                <td class="mono">${shortDigest(r.digest)}</td>
                <td>
                  ${r.activatedAt === null ? '' : new Date(r.activatedAt).toLocaleString('vi-VN')}
                </td>
                <td>${this.by(r)}</td>
                <td>${stateText(r)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private listView() {
    const deploy = this.app.deploy;
    const v = deploy?.versions;
    const title = t('rs.title.list', { name: this.deviceName });
    const cancel = html`<button
      class="btn"
      type="button"
      data-role="cancel"
      @click=${() => this.close()}
    >
      ${t('dl.cancel')}
    </button>`;
    if (!v || v.status === 'loading')
      return this.frame({
        title,
        icon: 'restore',
        body: html`<p class="row" role="status">
          <span class="spin" aria-hidden="true"></span>${t('rs.loading')}
        </p>`,
        foot: html`<span class="grow"></span>${cancel}`,
        busy: true,
      });
    if (v.status === 'error')
      return this.frame({
        title,
        icon: 'restore',
        body: html`<div class="banner err" role="alert">
          ${icon('err', 'err')}
          <div>${t('rs.error', { reason: deviceErrorText({ error: v.error }) })}</div>
        </div>`,
        foot: html`<span class="grow"></span>${cancel}`,
      });
    const rows = v.list.rows;
    const any = rows.some((r) => r.restorable);
    const body = html`<p class="help">${t('rs.intro')}</p>
      ${any ? nothing : html`<p data-role="empty">${t('rs.empty')}</p>`} ${this.tableView(rows)}`;
    const foot = html`<span class="grow"></span>${cancel}
      <button
        class="btn primary"
        type="button"
        data-role="restore"
        title=${this.selected === null ? t('rs.pick') : t('rs.restore')}
        ?disabled=${this.selected === null}
        @click=${() => {
          this.confirming = true;
          this.requestUpdate();
        }}
      >
        ${icon('restore')}${t('rs.restore')}
      </button>`;
    return this.frame({ title, icon: 'restore', body, foot });
  }

  private confirmView() {
    const v = this.app.deploy?.versions;
    const row =
      v?.status === 'ready' ? v.list.rows.find((r) => r.seq === this.selected) : undefined;
    if (!row) {
      this.confirming = false;
      return this.listView();
    }
    const clients = this.app.session.info?.clients;
    const body = html`<div class="result warn">
      ${icon('warn', 'lg warn')}
      <div>
        <b>${t('rs.title.confirm', { version: row.projectVersion, name: this.deviceName })}</b>
        <p>
          ${t('rs.confirmText', {
            version: row.projectVersion,
            clients:
              typeof clients === 'number'
                ? t('rs.confirmClients', {
                    count: Math.max(
                      0,
                      clients - (['live', 'open'].includes(this.app.session.live ?? '') ? 1 : 0),
                    ),
                  })
                : '?',
          })}
        </p>
      </div>
    </div>`;
    const foot = html`<span class="grow"></span>
      <button
        class="btn"
        type="button"
        data-role="back"
        @click=${() => {
          this.confirming = false;
          this.requestUpdate();
        }}
      >
        ${t('rs.back')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="confirm"
        @click=${() => {
          const seq = row.seq;
          this.confirming = false;
          void this.app.deploy?.restore(seq);
        }}
      >
        ${icon('restore')}${t('rs.confirm')}
      </button>`;
    return this.frame({
      title: t('rs.title.confirm', { version: row.projectVersion, name: this.deviceName }),
      icon: 'restore',
      body,
      foot,
    });
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const flow = this.flow;
    if (!flow || this.app.deploy?.kind !== 'restore') return nothing;
    switch (flow.state) {
      case 'running':
        return this.runningView(flow);
      case 'result':
        return this.resultView(flow);
      case 'closed':
        return this.confirming ? this.confirmView() : this.listView();
      default:
        return nothing;
    }
  }
}

customElements.define('mat-restore-dialog', MatRestoreDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-restore-dialog': MatRestoreDialog;
  }
}
