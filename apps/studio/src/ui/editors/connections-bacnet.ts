// Các thẻ BACnet/IP của editor Kết nối (feature 020, spec FR-013, FR-015): Tìm thiết bị (Who-Is) ở kênh; Thử kết nối
// (đọc tên thiết bị hoặc một địa chỉ) và Duyệt đối tượng (object-list → thêm Tag) ở thiết bị. Mọi lần thử đi qua BL335
// bằng bộ chạy Thử kết nối chung (`app.probe.runBody`): khóa, mỗi lúc một lần, giới hạn tần suất như Modbus.
import type { Channel, FieldDevice } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { probeCodeText } from '../../app/code-text.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t } from '../../i18n/index.ts';
import { probeGate, type ProbeResult } from '../../model/connections.ts';
import {
  bacnetObjectsBody,
  bacnetReadBody,
  bacnetWhoIsBody,
  deviceFromFound,
  tagFromObject,
  type BacnetObjectRow,
} from '../../model/connections-bacnet.ts';
import { AppElement, icon } from '../base.ts';

export class BacnetPanel extends AppElement {
  static override properties = {
    mode: { type: String },
    channelIndex: { type: Number },
    deviceIndex: { type: Number },
    readOnly: { type: Boolean },
    address: { state: true },
    picked: { state: true },
  };

  declare mode: 'channel' | 'device';
  declare channelIndex: number;
  declare deviceIndex: number;
  declare readOnly: boolean;
  declare address: string;
  declare picked: ReadonlySet<string>;

  constructor() {
    super();
    this.mode = 'channel';
    this.channelIndex = 0;
    this.deviceIndex = 0;
    this.readOnly = false;
    this.address = '';
    this.picked = new Set();
  }

  private channel(): Channel | undefined {
    return this.app.store.state.outline.connections?.channels?.[this.channelIndex];
  }

  private device(): FieldDevice | undefined {
    return this.channel()?.devices?.[this.deviceIndex];
  }

  private lock(): string | null {
    const ctx = this.app.commandContext();
    const lock = probeGate({
      online: ctx.onlineAuth,
      role: ctx.onlineAuth ? (this.app.session.auth?.role ?? null) : null,
    });
    return lock ? t(lock) : null;
  }

  private button(role: string, text: string, run: () => void, primary = false) {
    const reason = this.lock();
    const busy = this.app.probe.state.running;
    return html`<button
      class="btn ${primary ? 'primary' : 'sm'}"
      type="button"
      data-role=${role}
      aria-disabled=${reason || busy ? 'true' : nothing}
      title=${reason ?? text}
      @click=${() => (reason ? this.app.toast(reason) : busy ? undefined : run())}
    >
      ${icon(role === 'bac-browse' ? 'list' : 'check')}${text}
    </button>`;
  }

  /** Kết quả của lần thử gần nhất nếu là lần thử BACnet `action`. */
  private result(action: ProbeResult['action']): ProbeResult | null {
    const r = this.app.probe.state.result;
    if (!r) return null;
    if (r.failure) return r;
    return r.action === action ? r : null;
  }

  private status(r: ProbeResult) {
    if (r.failure)
      return html`<div class="banner err" role="alert">
        ${icon('err', 'err')}
        <div>
          ${r.failure === 'device' && r.deviceError ? t('cn.probe.device', { reason: deviceErrorText(r.deviceError) }) : t('cn.probe.unknown', { code: r.code })}
        </div>
      </div>`;
    return html`<p>
        <span class="chip ${r.ok ? 'ok' : 'err'}" data-role="probe-status"
          >${r.ok ? t('cn.probe.ok') : t('cn.probe.fail')}</span
        >
        <span class="mono" data-role="probe-code"
          >${t('cn.probe.code')}: ${r.code} · ${probeCodeText(r.code)}</span
        >
      </p>
      ${r.responseMs !== undefined ? html`<p class="help">${t('cn.probe.times', { connect: r.connectMs ?? '—', response: r.responseMs })}</p>` : nothing}
      ${r.bacnetError ? html`<p data-role="bac-error">${t('cn.bac.error', { reason: r.bacnetError.reason, class: r.bacnetError.class, code: r.bacnetError.code })}</p>` : nothing}
      ${r.reason !== undefined ? html`<p class="help">${t('cn.bac.reason', { reason: r.reason })}</p>` : nothing}`;
  }

  // ---------- kênh: Tìm thiết bị ----------

  private addFound(index: number): void {
    const r = this.app.probe.state.result;
    const ch = this.channel();
    const found = r?.devices?.[index];
    if (!ch || !found || this.readOnly) return;
    const ids = (this.app.store.state.outline.connections?.channels ?? []).flatMap((c) =>
      (c.devices ?? []).map((d) => d.id),
    );
    const device = deviceFromFound(found, ch, ids);
    if (!device) return;
    this.app.store.edit([{ kind: 'deviceUpsert', channel: this.channelIndex, device }]);
    this.app.toast(t('cn.bac.discover.added', { id: device.id }));
  }

  private discoverCard(ch: Channel) {
    const r = this.result('whois');
    const have = new Set((ch.devices ?? []).map((d) => d.deviceInstance));
    return html`<section class="card cn-probe" aria-labelledby="bac-discover-h">
      <h3 id="bac-discover-h">${t('cn.bac.discover.title')}</h3>
      <p class="help">${t('cn.bac.discover.help')}</p>
      <div class="cn-probe-row">
        ${this.button('bac-whois', t('cn.bac.discover.run'), () => void this.app.probe.runBody(bacnetWhoIsBody(ch)), true)}
      </div>
      ${this.lock() ? html`<p class="help" data-role="probe-lock">${this.lock()}</p>` : nothing}
      <div class="cn-probe-out" data-role="bac-whois-result" role="status" aria-live="polite">
        ${this.app.probe.state.running ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.probe.running')}</p>` : nothing}
        ${r ? this.status(r) : nothing}
        ${
          r?.devices
            ? r.devices.length
              ? html`<p class="help">${t('cn.bac.discover.count', { n: r.devices.length })}</p>
                  <table class="grid" aria-label=${t('cn.bac.discover.title')}>
                    <thead>
                      <tr>
                        <th>${t('cn.bac.col.instance')}</th>
                        <th>${t('cn.bac.col.address')}</th>
                        <th>${t('cn.bac.col.route')}</th>
                        <th>${t('cn.bac.col.apdu')}</th>
                        <th>${t('cn.bac.col.vendor')}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${r.devices.map(
                        (d, i) =>
                          html`<tr data-instance=${d.instance}>
                            <td class="mono num">${d.instance}</td>
                            <td class="mono">${d.host}:${d.port}</td>
                            <td class="mono">${d.network ? `${d.network} / ${d.mac}` : '—'}</td>
                            <td class="mono num">${d.maxApdu}</td>
                            <td class="mono num">${d.vendorId}</td>
                            <td>
                              ${
                                have.has(d.instance)
                                  ? html`<span class="chip">${t('cn.bac.discover.have')}</span>`
                                  : html`<button
                                      class="btn sm"
                                      type="button"
                                      data-role="bac-add-device"
                                      aria-disabled=${this.readOnly ? 'true' : nothing}
                                      @click=${() => (this.readOnly ? this.app.toast(t('reason.readOnly')) : this.addFound(i))}
                                    >
                                      ${icon('plus')}${t('cn.bac.discover.add')}
                                    </button>`
                              }
                            </td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>`
              : html`<p class="help" data-role="bac-none">${t('cn.bac.discover.none')}</p>`
            : nothing
        }
      </div>
    </section>`;
  }

  // ---------- thiết bị: Thử kết nối, Duyệt đối tượng ----------

  private addPicked(objects: readonly BacnetObjectRow[]): void {
    const dev = this.device();
    if (!dev || this.readOnly) return;
    const taken = new Set(
      ((this.app.store.state.outline.tags?.tags ?? []) as { id: string }[]).map((x) => x.id),
    );
    const tags = [];
    for (const o of objects) {
      if (!this.picked.has(o.address)) continue;
      const tag = tagFromObject(o, dev.id, taken);
      if (!tag) continue;
      taken.add(tag.id);
      tags.push(tag);
    }
    if (!tags.length) return;
    this.app.store.edit(tags.map((tag) => ({ kind: 'tagUpsert' as const, tag: tag as never })));
    this.picked = new Set();
    this.app.toast(t('cn.bac.browse.added', { n: tags.length }));
  }

  private toggle(address: string, on: boolean): void {
    const next = new Set(this.picked);
    if (on) next.add(address);
    else next.delete(address);
    this.picked = next;
  }

  private deviceCards(ch: Channel, dev: FieldDevice) {
    const read = this.result('read');
    const browse = this.result('objects');
    const objects = browse?.objects ?? [];
    const readable = objects.filter((o) => o.address && !o.address.startsWith('DEV:'));
    const allOn = readable.length > 0 && readable.every((o) => this.picked.has(o.address));
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
        <h3 id="cn-probe-h">${t('cn.probe.title')}</h3>
        <p class="help">${t('cn.bac.probe.help')}</p>
        <div class="cn-probe-row">
          <div class="cn-field">
            <label for="cn-probe-address">${t('cn.probe.address')}</label>
            <input
              id="cn-probe-address"
              class="input sm mono"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder=${`DEV:${dev.deviceInstance ?? 0}:object-name`}
              .value=${live(this.address)}
              @input=${(e: Event) => (this.address = (e.target as HTMLInputElement).value)}
            />
          </div>
          ${this.button('probe-run', t('cn.probe.run'), () => void this.app.probe.runBody(bacnetReadBody(ch, dev, this.address)), true)}
        </div>
        ${this.lock() ? html`<p class="help" data-role="probe-lock">${this.lock()}</p>` : nothing}
        <div class="cn-probe-out" data-role="probe-result" role="status" aria-live="polite">
          ${read ? this.status(read) : nothing}
          ${read?.value !== undefined && read.ok ? html`<p data-role="bac-value">${t('cn.bac.probe.value', { address: read.address ?? '', value: read.value, kind: read.valueKind ?? '' })}</p>` : nothing}
        </div>
      </section>
      <section class="card cn-probe" aria-labelledby="bac-browse-h">
        <h3 id="bac-browse-h">${t('cn.bac.browse.title')}</h3>
        <p class="help">${t('cn.bac.browse.help')}</p>
        <div class="cn-probe-row">
          ${this.button('bac-browse', t('cn.bac.browse.run'), () => void this.app.probe.runBody(bacnetObjectsBody(ch, dev)))}
          ${
            readable.length
              ? html`<button
                  class="btn sm primary"
                  type="button"
                  data-role="bac-add-tags"
                  aria-disabled=${this.readOnly || !this.picked.size ? 'true' : nothing}
                  @click=${() => (this.readOnly ? this.app.toast(t('reason.readOnly')) : this.addPicked(objects))}
                >
                  ${icon('plus')}${t('cn.bac.browse.addTags', { n: this.picked.size })}
                </button>`
              : nothing
          }
        </div>
        <div class="cn-probe-out" data-role="bac-objects" role="status" aria-live="polite">
          ${this.app.probe.state.running ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.probe.running')}</p>` : nothing}
          ${browse ? this.status(browse) : nothing}
          ${browse?.truncated ? html`<p class="field-warn">${t('cn.bac.browse.truncated')}</p>` : nothing}
          ${
            objects.length
              ? html`<p class="help">${t('cn.bac.browse.count', { n: objects.length })}</p>
                  <table class="grid" aria-label=${t('cn.bac.browse.title')}>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label=${t('cn.bac.browse.all')}
                            data-role="bac-pick-all"
                            .checked=${allOn}
                            @change=${(e: Event) => (this.picked = (e.target as HTMLInputElement).checked ? new Set(readable.map((o) => o.address)) : new Set())}
                          />
                        </th>
                        <th>${t('cn.bac.col.object')}</th>
                        <th>${t('cn.bac.col.name')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${objects.map((o) => {
                        const ok = !!o.address && !o.address.startsWith('DEV:');
                        return html`<tr data-address=${o.address}>
                          <td>
                            ${
                              ok
                                ? html`<input
                                    type="checkbox"
                                    aria-label=${o.address}
                                    .checked=${this.picked.has(o.address)}
                                    @change=${(e: Event) => this.toggle(o.address, (e.target as HTMLInputElement).checked)}
                                  />`
                                : nothing
                            }
                          </td>
                          <td class="mono">
                            ${o.address || `${o.type}:${o.instance}`}${!o.address ? html` <span class="help">(${t('cn.bac.browse.skip')})</span>` : nothing}
                          </td>
                          <td>${o.name}</td>
                        </tr>`;
                      })}
                    </tbody>
                  </table>`
              : nothing
          }
        </div>
      </section>`;
  }

  protected override render() {
    const ch = this.channel();
    if (!ch) return nothing;
    if (this.mode === 'channel') return this.discoverCard(ch);
    const dev = this.device();
    return dev ? this.deviceCards(ch, dev) : nothing;
  }
}

customElements.define('mat-bacnet-panel', BacnetPanel);

declare global {
  interface HTMLElementTagNameMap {
    'mat-bacnet-panel': BacnetPanel;
  }
}
