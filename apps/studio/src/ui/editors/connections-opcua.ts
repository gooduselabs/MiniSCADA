// Thẻ của kênh OPC UA trong editor Kết nối (feature 019, US5; specs/019-driver-opcua/contracts/opcua.md §4): Chứng chỉ server
// (Lấy chứng chỉ qua thiết bị, SHA-256, chủ thể, hạn, Tin chứng chỉ này → `opcua.serverCertSha256`) và Duyệt node (cây
// Objects đọc qua thiết bị, chọn biến → Tag ngoài với NodeId và kiểu gợi ý). Studio không tự nối tới server OPC UA: mọi yêu
// cầu đi qua BL335 (`app.opcua`, model/opcua-browse.ts).
import type { Channel, TagV1 } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { probeCodeText } from '../../app/code-text.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t } from '../../i18n/index.ts';
import { probeGate } from '../../model/connections.ts';
import {
  OBJECTS_NODE,
  certExpired,
  groupHex,
  tagFromReference,
  type BrowseResult,
  type OpcUaReference,
} from '../../model/opcua-browse.ts';
import { icon, type AppElement } from '../base.ts';

export class OpcUaCards {
  private readonly host: AppElement;
  private channelId = '';

  constructor(host: AppElement) {
    this.host = host;
  }

  private get app() {
    return this.host.app;
  }

  /** Lý do khóa (cần Online, đăng nhập từ engineer), như Thử kết nối. */
  private lock(): string | null {
    const ctx = this.app.commandContext();
    const lock = probeGate({
      online: ctx.onlineAuth,
      role: ctx.onlineAuth ? (this.app.session.auth?.role ?? null) : null,
    });
    return lock ? t(lock) : null;
  }

  /** Thử kết nối không dùng cho kênh OPC UA: ghi chú ở trang của server. */
  probeNote() {
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
      <h3 id="cn-probe-h">${t('cn.opcua.probeTitle')}</h3>
      <p class="help" data-role="probe-unsupported">${t('cn.opcua.probeNote')}</p>
    </section>`;
  }

  render(channel: Channel, needs11: boolean, ro: boolean) {
    if (channel.id !== this.channelId) {
      // Đổi kênh: bỏ chứng chỉ và cây của kênh trước (sau lần vẽ này).
      const first = this.channelId === '';
      this.channelId = channel.id;
      if (!first) queueMicrotask(() => this.app.opcua.reset());
    }
    const auth = channel.opcua?.auth;
    return html`${
      needs11
        ? html`<div class="banner warn" role="status" data-role="opcua-version">
            ${icon('warn', 'warn')}
            <div>${t('cn.opcua.needs11')}</div>
          </div>`
        : nothing
    }
    ${
      auth?.mode === 'username' && auth.secretId
        ? html`<section class="card cn-note" data-role="opcua-secret">
            <p class="help">${icon('lock')} ${t('cn.opcua.secretNote', { id: auth.secretId })}</p>
          </section>`
        : nothing
    }
    ${this.certCard(channel, ro)} ${this.browseCard(channel, ro)}`;
  }

  // ---------- Chứng chỉ server ----------

  private failText(r: BrowseResult): string {
    switch (r.failure) {
      case 'rate':
        return t('cn.opcua.rate', { n: r.retryAfterS ?? 60 });
      case 'badRequest':
        return t('cn.probe.bad', { issues: (r.issues ?? []).join(', ') });
      case 'audit':
        return t('cn.probe.audit');
      case 'device':
        return t('cn.probe.device', {
          reason: r.deviceError ? deviceErrorText(r.deviceError) : '',
        });
      case 'unknown':
        return t('cn.probe.unknown', { code: r.code });
      default:
        return t('cn.opcua.fail', {
          code: r.code,
          text: r.message ? `${probeCodeText(r.code)} (${r.message})` : probeCodeText(r.code),
        });
    }
  }

  private trust(channel: Channel, sha: string): void {
    const channels = this.app.store.state.outline.connections?.channels ?? [];
    const index = channels.findIndex((c) => c.id === channel.id);
    if (index < 0) return;
    const next: Channel = {
      ...channel,
      opcua: { ...(channel.opcua ?? { endpointUrl: '' }), serverCertSha256: sha },
    };
    this.app.store.edit([{ kind: 'channelUpsert', index, channel: next }]);
    this.app.toast(t('cn.opcua.cert.pinnedToast', { channel: channel.name || channel.id }));
  }

  private certCard(channel: Channel, ro: boolean) {
    const st = this.app.opcua.state;
    const reason = this.lock();
    const r = st.cert;
    const pinned = channel.opcua?.serverCertSha256;
    const sha = r?.server?.certSha256 ?? null;
    return html`<section class="card cn-ua-cert" aria-labelledby="cn-ua-cert-h">
      <h3 id="cn-ua-cert-h">${t('cn.opcua.cert.title')}</h3>
      <p class="help">${t('cn.opcua.cert.help')}</p>
      <div class="cn-ports-actions">
        <button
          class="btn sm"
          type="button"
          data-role="ua-cert-fetch"
          aria-disabled=${reason || st.running ? 'true' : nothing}
          title=${reason ?? t('cn.opcua.cert.fetch')}
          @click=${() => (reason ? this.app.toast(reason) : st.running ? undefined : void this.app.opcua.fetchCert(channel))}
        >
          ${icon('lock')}${t('cn.opcua.cert.fetch')}
        </button>
      </div>
      ${reason ? html`<p class="help" data-role="ua-lock">${reason}</p>` : nothing}
      <div
        data-role="ua-cert-result"
        role="status"
        aria-live="polite"
        aria-busy=${st.running ? 'true' : 'false'}
      >
        ${st.running ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.opcua.cert.fetching')}</p>` : nothing}
        ${
          r && (r.failure || !r.ok)
            ? html`<div class="banner err" role="alert">
                ${icon('err', 'err')}
                <div>${this.failText(r)}</div>
              </div>`
            : nothing
        }
        ${r?.ok && !sha ? html`<p class="help">${t('cn.opcua.cert.none')}</p>` : nothing}
        ${
          r?.server && sha
            ? html`<dl class="cn-ua-facts">
                  <dt>${t('cn.opcua.cert.sha')}</dt>
                  <dd class="mono" data-role="ua-cert-sha">${groupHex(sha)}</dd>
                  ${
                    r.server.certSubject
                      ? html`<dt>${t('cn.opcua.cert.subject')}</dt>
                          <dd>${r.server.certSubject}</dd>`
                      : nothing
                  }
                  ${
                    r.server.certNotAfter
                      ? html`<dt>${t('cn.opcua.cert.notAfter')}</dt>
                          <dd class="mono">${r.server.certNotAfter}</dd>`
                      : nothing
                  }
                  ${
                    r.server.applicationUri
                      ? html`<dt>${t('cn.opcua.cert.uri')}</dt>
                          <dd class="mono">${r.server.applicationUri}</dd>`
                      : nothing
                  }
                </dl>
                ${certExpired(r.server, Date.now()) ? html`<p class="field-warn" role="status">${icon('warn', 'warn')}${t('cn.opcua.cert.expired')}</p>` : nothing}
                ${pinned && pinned !== sha ? html`<p class="field-warn" data-role="ua-cert-mismatch" role="status">${icon('warn', 'warn')}${t('cn.opcua.cert.mismatch')}</p>` : nothing}
                ${
                  pinned === sha
                    ? html`<p class="help" data-role="ua-cert-trusted">
                        ${icon('check')} ${t('cn.opcua.cert.trusted')}
                      </p>`
                    : html`<button
                        class="btn primary sm"
                        type="button"
                        data-role="ua-cert-trust"
                        aria-disabled=${ro ? 'true' : nothing}
                        title=${ro ? t('reason.readOnly') : t('cn.opcua.cert.trust')}
                        @click=${() => (ro ? this.app.toast(t('reason.readOnly')) : this.trust(channel, sha))}
                      >
                        ${icon('check')}${t('cn.opcua.cert.trust')}
                      </button>`
                }`
            : nothing
        }
        ${
          r?.endpoints.length
            ? html`<table class="grid cn-ua-endpoints" aria-label=${t('cn.opcua.cert.endpoints')}>
                <thead>
                  <tr>
                    <th>${t('cn.f.securityMode')}</th>
                    <th>${t('cn.f.securityPolicy')}</th>
                    <th>${t('cn.f.authMode')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${r.endpoints.map(
                    (e) =>
                      html`<tr>
                        <td>${e.securityMode}</td>
                        <td class="mono">${e.securityPolicy}</td>
                        <td>${e.userTokens.join(', ')}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
            : nothing
        }
      </div>
    </section>`;
  }

  // ---------- Duyệt node ----------

  private addTag(channel: Channel, ref: OpcUaReference): void {
    const device = channel.devices?.[0]?.id;
    if (!device) {
      this.app.toast(t('cn.opcua.browse.needDevice'));
      return;
    }
    const tags = (this.app.store.state.outline.tags?.tags ?? []) as unknown as TagV1[];
    const at = tags.findIndex(
      (x) =>
        x.kind === 'external' && x.source?.device === device && x.source.address === ref.nodeId,
    );
    if (at >= 0) {
      const old = tags[at];
      const type = ref.tagType ?? old.type;
      this.app.store.edit([{ kind: 'tagUpsert', index: at, tag: { ...old, type } as never }]);
      this.app.toast(t('cn.opcua.browse.updated', { id: old.id }));
      return;
    }
    const tag = tagFromReference(ref, device, new Set(tags.map((x) => x.id)));
    this.app.store.edit([{ kind: 'tagUpsert', tag: tag as never }]);
    this.app.toast(t('cn.opcua.browse.added', { id: tag.id }));
  }

  private browseCard(channel: Channel, ro: boolean) {
    const ua = this.app.opcua;
    const st = ua.state;
    const reason = this.lock();
    const rows = ua.rows();
    const root = st.children.get(OBJECTS_NODE);
    const device = channel.devices?.[0]?.id;
    const tags = (this.app.store.state.outline.tags?.tags ?? []) as unknown as TagV1[];
    const has = (nodeId: string) =>
      tags.some(
        (x) => x.kind === 'external' && x.source?.device === device && x.source.address === nodeId,
      );
    return html`<section class="card cn-ua-browse" aria-labelledby="cn-ua-browse-h">
      <h3 id="cn-ua-browse-h">${t('cn.opcua.browse.title')}</h3>
      <p class="help">${t('cn.opcua.browse.help')}</p>
      <div class="cn-ports-actions">
        <button
          class="btn sm"
          type="button"
          data-role="ua-browse"
          aria-disabled=${reason || st.loading.has(OBJECTS_NODE) ? 'true' : nothing}
          title=${reason ?? t('cn.opcua.browse.load')}
          @click=${() => (reason ? this.app.toast(reason) : void ua.toggle(channel, OBJECTS_NODE))}
        >
          ${icon('refresh')}${t('cn.opcua.browse.load')}
        </button>
      </div>
      ${reason ? html`<p class="help">${reason}</p>` : nothing}
      <div data-role="ua-browse-status" role="status" aria-live="polite">
        ${st.loading.size ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.opcua.browse.loading')}</p>` : nothing}
        ${
          st.error
            ? html`<div class="banner err" role="alert" data-role="ua-browse-error">
                ${icon('err', 'err')}
                <div>${this.failText(st.error)}</div>
              </div>`
            : nothing
        }
      </div>
      ${root && !root.length ? html`<p class="help">${t('cn.opcua.browse.empty')}</p>` : nothing}
      ${
        rows.length
          ? html`<table
              class="grid cn-ua-tree"
              role="treegrid"
              aria-label=${t('cn.opcua.browse.title')}
            >
              <thead>
                <tr>
                  <th>${t('cn.opcua.browse.col.name')}</th>
                  <th>${t('cn.opcua.browse.col.node')}</th>
                  <th>${t('cn.opcua.browse.col.type')}</th>
                  <th><span class="visually-hidden">${t('cn.opcua.browse.add')}</span></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(({ ref, depth, expanded, loading }) => {
                  const variable = ref.nodeClass === 'Variable';
                  const exists = variable && has(ref.nodeId);
                  return html`<tr
                    role="row"
                    aria-level=${depth + 1}
                    aria-expanded=${ref.hasChildren ? (expanded ? 'true' : 'false') : nothing}
                    data-node=${ref.nodeId}
                  >
                    <td class="ua-name" style="padding-left: ${0.5 + depth * 1.25}rem">
                      ${
                        ref.hasChildren
                          ? html`<button
                              class="btn ghost xs"
                              type="button"
                              data-act="ua-expand"
                              aria-label=${t(expanded ? 'cn.opcua.browse.collapse' : 'cn.opcua.browse.expand', { name: ref.displayName })}
                              @click=${() => (reason ? this.app.toast(reason) : void ua.toggle(channel, ref.nodeId))}
                            >
                              ${loading ? html`<span class="spin" aria-hidden="true"></span>` : icon(expanded ? 'chev-d' : 'chev-r')}
                            </button>`
                          : html`<span class="ua-leaf" aria-hidden="true"></span>`
                      }
                      ${icon(variable ? 'list' : 'project')}<span>${ref.displayName}</span>
                    </td>
                    <td class="mono">${ref.nodeId}</td>
                    <td>
                      ${ref.dataType ?? ''}${ref.tagType ? html` <span class="muted mono">→ ${ref.tagType}</span>` : nothing}${ref.writable ? html` <span class="chip">${t('cn.opcua.browse.writable')}</span>` : nothing}
                    </td>
                    <td>
                      ${
                        variable
                          ? html`<button
                              class="btn sm"
                              type="button"
                              data-act="ua-add-tag"
                              aria-disabled=${ro ? 'true' : nothing}
                              title=${ro ? t('reason.readOnly') : t('cn.opcua.browse.addTip', { id: ref.displayName, node: ref.nodeId })}
                              @click=${() => (ro ? this.app.toast(t('reason.readOnly')) : this.addTag(channel, ref))}
                            >
                              ${icon('plus')}${t(exists ? 'cn.opcua.browse.update' : 'cn.opcua.browse.add')}
                            </button>`
                          : nothing
                      }
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>`
          : nothing
      }
      ${st.truncated.size ? html`<p class="help" data-role="ua-truncated">${t('cn.opcua.browse.truncated')}</p>` : nothing}
    </section>`;
  }
}
