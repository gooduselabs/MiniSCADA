// Hộp thoại Nạp xuống (feature 005, US2, T123, FR-020–FR-024, data-model §13; theo openDownload của mockup đã
// duyệt): bước hỏi lưu, xem trước (bảng bảy dòng, ô "đã đọc cảnh báo", nút khóa kèm lý do), tiến trình 6 bước, kết
// quả. Trạng thái nằm ở `DownloadFlow` (model/download-flow.ts) do `app.deploy` giữ; thành phần chỉ vẽ.
import { html, nothing, type TemplateResult } from 'lit';
import type { OnlineDialogSpec } from '../../app/app.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { formatBytes } from '../../model/device.ts';
import type {
  Blocker,
  BusyInfo,
  DownloadFlow,
  Preview,
  PreviewNotice,
  PreviewRows,
  PrepareStep,
  RowStatus,
} from '../../model/download-flow.ts';
import { icon } from '../base.ts';
import { resultBlock, runningBody } from './deploy-parts.ts';
import { OnlineDialog } from './dialog-frame.ts';

const PREP_KEY: Readonly<Record<PrepareStep, MessageKey>> = {
  'ask-save': 'dl.prep.ask-save',
  saving: 'dl.prep.saving',
  checking: 'dl.prep.checking',
  packing: 'dl.prep.packing',
  comparing: 'dl.prep.comparing',
};

const LOCK_KEY: Readonly<Record<string, MessageKey>> = {
  errors: 'dl.lock.errors',
  runtime: 'dl.lock.runtime',
  package: 'dl.lock.package',
  'too-large': 'dl.lock.too-large',
  'no-space': 'dl.lock.no-space',
  unreachable: 'dl.lock.unreachable',
  session: 'dl.lock.session',
  role: 'dl.lock.role',
  busy: 'dl.lock.busy',
};

const ROW_LABEL: Readonly<Record<keyof PreviewRows, MessageKey>> = {
  check: 'dl.row.check',
  runtime: 'dl.row.runtime',
  replace: 'dl.row.replace',
  clients: 'dl.row.clients',
  size: 'dl.row.size',
  logging: 'dl.row.logging',
  connections: 'dl.row.connections',
  retain: 'dl.row.retain',
  device: 'dl.row.device',
};

const STATUS: Readonly<
  Record<RowStatus, { chip: string; ic: 'ok' | 'warn' | 'err' | 'info'; key: MessageKey }>
> = {
  ok: { chip: 'ok', ic: 'ok', key: 'dl.st.ok' },
  notice: { chip: 'info', ic: 'info', key: 'dl.st.notice' },
  warn: { chip: 'warn', ic: 'warn', key: 'dl.st.warn' },
  error: { chip: 'err', ic: 'err', key: 'dl.st.error' },
  unknown: { chip: 'info', ic: 'info', key: 'dl.st.unknown' },
};

const OP_KEY: Readonly<Record<string, MessageKey>> = {
  deploy: 'dl.op.deploy',
  restore: 'dl.op.restore',
};

const when = (ms: number | null): string =>
  ms === null ? '' : new Date(ms).toLocaleTimeString('vi-VN');

const operationName = (kind: string | null): string => {
  const key = kind === null ? undefined : OP_KEY[kind];
  return key ? t(key) : (kind ?? '');
};

export function busyText(b: BusyInfo): string {
  const op = operationName(b.kind);
  if (b.user)
    return t('dl.notice.busy', {
      user: b.user,
      source: b.source ?? '?',
      operation: op,
      since: when(b.since),
    });
  return b.step ? t('dl.notice.busyStep', { step: b.step }) : t('dl.lock.busy');
}

interface RowView {
  id: keyof PreviewRows;
  status: RowStatus;
  info: string;
  action?: { role: string; text: string; run: () => void };
}

export class MatDownloadDialog extends OnlineDialog {
  protected readonly kind: OnlineDialogSpec['kind'] = 'download';

  protected get flow(): DownloadFlow | null {
    return this.app.deploy?.flow ?? null;
  }

  protected get deviceName(): string {
    return this.app.session.device?.name ?? '';
  }

  private chip(status: RowStatus): TemplateResult {
    const s = STATUS[status];
    return html`<span class="chip ${s.chip}">${icon(s.ic)}${t(s.key)}</span>`;
  }

  /** Mở danh sách lỗi (tab Chẩn đoán của Inspector) và đóng hộp thoại. */
  private viewIssues(): void {
    this.app.deploy?.close();
    this.app.setInspectorTab('diag');
  }

  private replaceInfo(r: PreviewRows['replace']): string {
    if (r.device.state === 'none') return t('dl.replace.none');
    if (r.device.state === 'invalid') return t('dl.replace.invalid');
    if (r.device.state === 'unknown') return t('dl.replace.unknown');
    const to = r.local?.projectVersion ?? '';
    if (r.compareError !== null)
      return `${t('dl.replace.change', { from: r.device.projectVersion ?? '?', to })} · ${t('dl.replace.compareFailed', { reason: deviceErrorText({ error: r.compareError }) })}`;
    if (r.summary?.same) return t('dl.replace.same', { version: to });
    const migrated = r.migrated ? ` · ${t('dl.replace.migrated')}` : '';
    const head = r.otherProject
      ? t('dl.replace.other', {
          from: `${r.device.projectName ?? r.device.projectId ?? '?'} ${r.device.projectVersion ?? ''}`.trim(),
          to: `${r.local?.projectName ?? ''} ${to}`.trim(),
        })
      : t('dl.replace.change', { from: r.device.projectVersion ?? '?', to });
    if (!r.summary) return head;
    const c = r.summary.counts;
    return `${head} · ${t('dl.replace.summary', { changed: c['≠'], added: c['+'], removed: c['-'] })}${migrated}`;
  }

  private loggingInfo(r: PreviewRows['logging']): string {
    const i = r.impact;
    if (!i) return t('dl.logging.unknown');
    const c = i.connections;
    const changes =
      i.added.length +
      i.removed.length +
      i.changed.length +
      i.newColumns.length +
      c.added.length +
      c.removed.length +
      c.changed.length;
    if (!changes && (i.settings === null || i.settings === '=')) return t('dl.logging.same');
    return t('dl.logging.change', {
      added: i.added.length,
      removed: i.removed.length,
      changed: i.changed.length,
      columns: i.newColumns.length,
    });
  }

  private connectionsInfo(r: PreviewRows['connections']): string {
    const i = r.impact;
    if (!i) return t('dl.connections.unknown');
    const c = i.channels;
    const d = i.devices;
    const total =
      c.added.length +
      c.removed.length +
      c.changed.length +
      d.added.length +
      d.removed.length +
      d.changed.length;
    if (!total) return t('dl.connections.same');
    const part = (x: { added: string[]; removed: string[]; changed: string[] }) =>
      t('dl.connections.parts', {
        added: x.added.length,
        removed: x.removed.length,
        changed: x.changed.length,
      });
    const lines = [
      `${t('compare.kind.channel')}: ${part(c)}; ${t('compare.kind.field-device')}: ${part(d)}`,
    ];
    if (i.reconnect.length)
      lines.push(t('dl.connections.reconnect', { list: i.reconnect.join(', ') }));
    if (c.removed.length) lines.push(t('dl.connections.close', { list: c.removed.join(', ') }));
    return lines.join(' · ');
  }

  /** Dòng "Tag giữ qua mất điện" (FR-008, US4-10): Tag sẽ về giá trị đầu và vì sao. */
  private retainInfo(r: PreviewRows['retain']): string {
    const l = r.losses;
    if (l === null) return t('dl.retain.unknown');
    if (!l.length) return t('dl.retain.none');
    const MAX = 6;
    const one = (x: (typeof l)[number]): string =>
      x.reason === 'type'
        ? t('dl.retain.type', { tag: x.tag, from: x.from ?? '?', to: x.to ?? '?' })
        : x.reason === 'removed'
          ? t('dl.retain.removed', { tag: x.tag })
          : t('dl.retain.off', { tag: x.tag });
    const list = l.slice(0, MAX).map(one).join(', ');
    const more = l.length > MAX ? `, ${t('dl.retain.more', { n: l.length - MAX })}` : '';
    return t('dl.retain.some', { n: l.length, list: `${list}${more}` });
  }

  private sizeInfo(r: PreviewRows['size'], errors: boolean): string {
    const size = r.bytes === null ? '' : formatBytes(r.bytes);
    const limit = formatBytes(r.limit);
    const free = r.freeBytes === null ? null : formatBytes(r.freeBytes);
    switch (r.problem) {
      case 'package':
        return errors
          ? t('dl.size.waitErrors')
          : `${t('dl.size.noPackage')}${r.error ? ` (${deviceErrorText(r.error)})` : ''}`;
      case 'too-large':
        return t('dl.size.tooLarge', { size, limit });
      case 'no-space':
        return t('dl.size.noSpace', {
          free: free ?? '?',
          need: formatBytes(r.needBytes ?? undefined),
        });
      default:
        return free === null
          ? t('dl.size.ok', { size, limit })
          : t('dl.size.free', { size, limit, free });
    }
  }

  private deviceInfo(r: PreviewRows['device']): string {
    const parts: string[] = [];
    if (r.problems.includes('unreachable')) parts.push(t('dl.device.unreachable'));
    if (r.problems.includes('session')) parts.push(t('dl.device.session'));
    if (r.problems.includes('role'))
      parts.push(t('dl.device.role', { user: r.user ?? '', role: r.role ?? '' }));
    if (r.problems.includes('busy') && r.busy) {
      const op = operationName(r.busy.kind);
      parts.push(
        r.busy.user
          ? t('dl.device.busyWho', {
              user: r.busy.user,
              source: r.busy.source ?? '?',
              operation: op,
            })
          : t('dl.device.busy', { operation: op }),
      );
    }
    return parts.length
      ? parts.join('; ')
      : t('dl.device.ok', { user: r.user ?? '', role: r.role ?? '' });
  }

  private rows(pv: Preview): RowView[] {
    const r = pv.rows;
    const errors = pv.blockers.includes('errors');
    const out: RowView[] = [];
    const check = r.check;
    out.push({
      id: 'check',
      status: check.status,
      info: check.errors.length
        ? `${t('dl.check.counts', { errors: check.errors.length, warnings: check.warnings.length })} ${t('dl.check.fix')}`
        : t('dl.check.counts', { errors: 0, warnings: check.warnings.length }),
      ...(check.errors.length || check.warnings.length
        ? {
            action: {
              role: 'view-errors',
              text: t(check.errors.length ? 'dl.check.view' : 'dl.check.viewWarn'),
              run: () => this.viewIssues(),
            },
          }
        : {}),
    });
    out.push({
      id: 'runtime',
      status: r.runtime.status,
      info:
        r.runtime.required === null || r.runtime.device === null
          ? t('dl.runtime.unknown')
          : t(r.runtime.status === 'error' ? 'dl.runtime.old' : 'dl.runtime.ok', {
              required: r.runtime.required,
              device: r.runtime.device,
            }),
    });
    out.push({ id: 'replace', status: r.replace.status, info: this.replaceInfo(r.replace) });
    out.push({
      id: 'clients',
      status: r.clients.status,
      info:
        r.clients.count === null
          ? t('dl.clients.unknown')
          : r.clients.count === 0
            ? t('dl.clients.none')
            : t('dl.clients.count', { count: r.clients.count }),
    });
    out.push({ id: 'size', status: r.size.status, info: this.sizeInfo(r.size, errors) });
    out.push({ id: 'logging', status: r.logging.status, info: this.loggingInfo(r.logging) });
    out.push({
      id: 'connections',
      status: r.connections.status,
      info: this.connectionsInfo(r.connections),
    });
    out.push({ id: 'retain', status: r.retain.status, info: this.retainInfo(r.retain) });
    out.push({
      id: 'device',
      status: r.device.status,
      info: this.deviceInfo(r.device),
      ...(r.device.problems.includes('session')
        ? {
            action: {
              role: 'login',
              text: t('dl.device.login'),
              run: () => void this.app.run('online.login'),
            },
          }
        : {}),
    });
    return out;
  }

  private noticeText(n: PreviewNotice): string {
    switch (n.code) {
      case 'base-changed':
        return t('dl.notice.base-changed');
      case 'session-expired':
        return t('dl.notice.session-expired');
      case 'forbidden':
        return t('dl.notice.forbidden');
      default:
        return busyText(n.busy);
    }
  }

  private lockReasons(pv: Preview): string[] {
    const out = pv.blockers.map((b: Blocker) => {
      const key = LOCK_KEY[b];
      return key ? t(key) : b;
    });
    if (pv.needsAck && !pv.acknowledged) out.push(t('dl.lock.ack'));
    return out;
  }

  private previewView(flow: DownloadFlow, pv: Preview) {
    const reasons = this.lockReasons(pv);
    const body = html`${
        pv.notice
          ? html`<div class="banner warn" role="alert" data-role="notice">
              ${icon('warn', 'warn')}
              <div>${this.noticeText(pv.notice)}</div>
            </div>`
          : nothing
      }
      <div class="gridwrap framed">
        <table class="grid dense" aria-label=${t('dl.table')}>
          <thead>
            <tr>
              <th>${t('dl.col.status')}</th>
              <th>${t('dl.col.item')}</th>
              <th>${t('dl.col.info')}</th>
            </tr>
          </thead>
          <tbody>
            ${this.rows(pv).map(
              (r) =>
                html`<tr data-row=${r.id}>
                  <td>${this.chip(r.status)}</td>
                  <td>${t(ROW_LABEL[r.id])}</td>
                  <td>
                    <span class="row-act"
                      ><span>${r.info}</span>${
                        r.action
                          ? html`<button
                              class="btn"
                              type="button"
                              data-role=${r.action.role}
                              @click=${r.action.run}
                            >
                              ${r.action.text}
                            </button>`
                          : nothing
                      }</span
                    >
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      ${
        pv.needsAck
          ? html`<label class="inline"
              ><input
                type="checkbox"
                data-role="ack"
                .checked=${pv.acknowledged}
                @change=${(e: Event) => this.flow?.acknowledge((e.target as HTMLInputElement).checked)}
              />${t('dl.ack')}</label
            >`
          : nothing
      }
      ${
        reasons.length && !pv.canDeploy
          ? html`<p class="lock-text" data-role="lock">${reasons.join('; ')}</p>`
          : nothing
      }`;
    const foot = html`<span class="grow muted">${t('dl.footnote')}</span>
      <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dl.cancel')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="deploy"
        title=${pv.canDeploy ? t('dl.deploy') : (reasons[0] ?? t('dl.deploy'))}
        ?disabled=${!pv.canDeploy}
        @click=${() => void flow.deploy()}
      >
        ${icon('download')}${t('dl.deploy')}
      </button>`;
    return this.frame({
      title: t('dl.title.preview', { name: this.deviceName }),
      icon: 'download',
      body,
      foot,
    });
  }

  private prepareView(flow: DownloadFlow) {
    const step = flow.step ?? 'checking';
    if (step === 'ask-save') {
      const body = html`<div class="banner warn" role="alert">
        ${icon('warn', 'warn')}
        <div>${t('dl.ask.text')}</div>
      </div>`;
      const foot = html`<span class="grow"></span>
        <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
          ${t('dl.cancel')}
        </button>
        <button
          class="btn primary"
          type="button"
          data-role="save"
          @click=${() => void flow.saveAndContinue()}
        >
          ${t('dl.ask.save')}
        </button>`;
      return this.frame({
        title: t('dl.title.prepare', { name: this.deviceName }),
        icon: 'download',
        body,
        foot,
      });
    }
    const body = html`<p class="row" role="status">
      <span class="spin" aria-hidden="true"></span>${t(PREP_KEY[step])}
    </p>`;
    const foot = html`<span class="grow"></span>
      <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dl.cancel')}
      </button>`;
    return this.frame({
      title: t('dl.title.prepare', { name: this.deviceName }),
      icon: 'download',
      body,
      foot,
      busy: true,
    });
  }

  protected runningView(flow: DownloadFlow) {
    const run = flow.running;
    if (!run) return nothing;
    const restore = run.kind === 'restore';
    return this.frame({
      title: t(restore ? 'rs.title.running' : 'dl.title.running', { name: this.deviceName }),
      icon: restore ? 'restore' : 'download',
      body: runningBody(run),
      foot: html`<span class="grow muted">${t('dl.runFoot')}</span>`,
      busy: true,
      closeDisabled: true,
    });
  }

  protected resultView(flow: DownloadFlow) {
    const r = flow.result;
    if (!r) return nothing;
    const restore = r.kind === 'restore';
    const ok = r.outcome === 'committed';
    const titleKey: MessageKey = restore
      ? ok
        ? 'rs.title.committed'
        : 'rs.title.failed'
      : ok
        ? 'dl.title.committed'
        : 'dl.title.failed';
    const foot = html`${
        ok && !restore && r.previousSeq !== null
          ? html`<button
              class="btn"
              type="button"
              data-role="restore-prev"
              @click=${() => void flow.restore()}
            >
              ${icon('restore')}${t('dl.restorePrev')}
            </button>`
          : nothing
      }
      ${
        !ok && !restore
          ? html`<button
              class="btn"
              type="button"
              data-role="retry"
              @click=${() => void this.app.deploy?.openDownload()}
            >
              ${t('dl.retry')}
            </button>`
          : nothing
      }
      <span class="grow"></span>
      <button class="btn primary" type="button" data-role="close" @click=${() => this.close()}>
        ${t('dl.close')}
      </button>`;
    return this.frame({
      title: t(titleKey, { name: this.deviceName }),
      icon: restore ? 'restore' : 'download',
      body: resultBlock(r, this.deviceName),
      foot,
    });
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const flow = this.flow;
    if (!flow || this.app.deploy?.kind !== this.kind) return nothing;
    // Khôi phục từ kết quả Nạp xuống (Khôi phục bản trước): vẫn trong hộp thoại này, kết quả của `restore`.
    switch (flow.state) {
      case 'preview': {
        const pv = flow.preview;
        return pv ? this.previewView(flow, pv) : nothing;
      }
      case 'running':
        return this.runningView(flow);
      case 'result':
        return this.resultView(flow);
      case 'preparing':
        return this.prepareView(flow);
      default:
        return nothing;
    }
  }
}

customElements.define('mat-download-dialog', MatDownloadDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-download-dialog': MatDownloadDialog;
  }
}
