// Editor Kết nối (feature 006, T130, FR-030, FR-044, studio-ux §5 mục Form, mockup studio-tags.html v-conn): kênh Modbus TCP
// (RTU ở T171) và thiết bị trường theo nhóm Kết nối, Nâng cao; trợ giúp ngay dưới ô; lỗi tại ô (khi gõ và từ bộ kiểm tra);
// nhóm quét; và panel Thử kết nối (thời gian, mã, hex, bảng cách hiểu 4 thứ tự byte, exception kèm nghĩa).
// Mỗi lần xác nhận một trường là một sửa đổi `channelUpsert`/`deviceUpsert` (một bước hoàn tác). Studio không tự kết nối tới
// thiết bị trường: Thử kết nối đi qua BL335 (`DeviceLink.post`).
import type { Channel, FieldDevice } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { exceptionText, issueText, probeCodeText } from '../../app/code-text.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  channelFields,
  deviceFields,
  fieldDefault,
  fieldText,
  interpretTable,
  issueField,
  probeGate,
  setField,
  tagsPerDevice,
  type ChannelKind,
  type FieldSpec,
  type ProbeResult,
} from '../../model/connections.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './connections-editor.css';

type Target =
  | { type: 'overview' }
  | { type: 'channel'; index: number; channel: Channel }
  | { type: 'device'; channel: number; index: number; device: FieldDevice; owner: Channel };

const SCAN = ['fast', 'normal', 'slow'] as const;
const ORDERS = ['ABCD', 'CDAB', 'BADC', 'DCBA'] as const;

export class ConnectionsEditor extends AppElement {
  static override properties = {
    drafts: { state: true },
    errors: { state: true },
    address: { state: true },
    count: { state: true },
  };

  declare drafts: Readonly<Record<string, string>>;
  declare errors: Readonly<Record<string, string>>;
  declare address: string;
  declare count: string;

  constructor() {
    super();
    this.drafts = {};
    this.errors = {};
    this.address = 'HR100';
    this.count = '2';
  }

  protected override attached(): void {
    this.app.probe.refreshLock();
  }

  // ---------- Đối tượng đang chọn ----------

  private channels(): Channel[] {
    return this.app.store.state.outline.connections?.channels ?? [];
  }

  private target(): Target {
    const sel = this.app.ui.treeSel ?? '';
    const channels = this.channels();
    if (sel.startsWith('channel:')) {
      const index = channels.findIndex((c) => c.id === sel.slice(8));
      if (index >= 0) return { type: 'channel', index, channel: channels[index] };
    }
    if (sel.startsWith('fdev:')) {
      for (let c = 0; c < channels.length; c++) {
        const index = (channels[c].devices ?? []).findIndex((d) => d.id === sel.slice(5));
        if (index >= 0)
          return {
            type: 'device',
            channel: c,
            index,
            device: channels[c].devices[index],
            owner: channels[c],
          };
      }
    }
    return { type: 'overview' };
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || s.outline.version !== '0.2';
  }

  private taken() {
    const channels = this.channels();
    return {
      channels: new Set(channels.map((c) => c.id)),
      devices: new Set(channels.flatMap((c) => (c.devices ?? []).map((d) => d.id))),
    };
  }

  // ---------- Sửa ----------

  private commit(target: Target, spec: FieldSpec, text: string): void {
    if (target.type === 'overview') return;
    const key = `${spec.target}:${spec.key}`;
    const obj = target.type === 'channel' ? target.channel : target.device;
    const res = setField(obj as unknown as object, spec, text, this.taken());
    if ('error' in res) {
      this.drafts = { ...this.drafts, [key]: text };
      this.errors = { ...this.errors, [key]: t(res.error) };
      return;
    }
    const drafts = { ...this.drafts };
    const errors = { ...this.errors };
    delete drafts[key];
    delete errors[key];
    this.drafts = drafts;
    this.errors = errors;
    if (target.type === 'channel')
      this.app.store.edit([
        { kind: 'channelUpsert', index: target.index, channel: res.value as unknown as Channel },
      ]);
    else {
      this.app.store.edit([
        {
          kind: 'deviceUpsert',
          channel: target.channel,
          index: target.index,
          device: res.value as unknown as FieldDevice,
        },
      ]);
      // Đổi mã thiết bị: giữ nút đang chọn theo mã mới.
      if (spec.key === 'id')
        this.app.revealNode(`fdev:${(res.value as unknown as FieldDevice).id}`);
    }
    if (target.type === 'channel' && spec.key === 'id')
      this.app.revealNode(`channel:${(res.value as unknown as Channel).id}`);
  }

  private setScan(group: (typeof SCAN)[number], text: string): void {
    const cfg = this.app.store.state.outline.connections;
    const key = `scan:${group}`;
    const n = text.trim() === '' ? undefined : Number(text);
    if (n !== undefined && (!/^\d+$/.test(text.trim()) || n < 100 || n > 60000)) {
      this.drafts = { ...this.drafts, [key]: text };
      this.errors = { ...this.errors, [key]: t('cn.err.range') };
      return;
    }
    const drafts = { ...this.drafts };
    const errors = { ...this.errors };
    delete drafts[key];
    delete errors[key];
    this.drafts = drafts;
    this.errors = errors;
    const next = { ...(cfg?.scanGroups ?? {}) } as Record<string, number>;
    if (n === undefined) delete next[group];
    else next[group] = n;
    this.app.store.edit([
      { kind: 'scanGroups', value: Object.keys(next).length ? (next as never) : undefined },
    ]);
  }

  // ---------- Lỗi của bộ kiểm tra theo trường ----------

  private issuesFor(target: Target): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const file = this.app.store.state.outline.connectionFile;
    if (!file || target.type === 'overview') return out;
    const chIndex = target.type === 'channel' ? target.index : target.channel;
    const owner = target.type === 'channel' ? target.channel : target.owner;
    for (const i of this.app.store.state.issues) {
      if (i.file !== file) continue;
      const f = issueField(i.path, owner.kind as ChannelKind);
      if (!f || f.channel !== chIndex) continue;
      if (target.type === 'channel' ? f.device !== null : f.device !== target.index) continue;
      const k = `${target.type === 'channel' ? 'channel' : 'device'}:${f.field ?? '*'}`;
      out.set(k, [...(out.get(k) ?? []), issueText(i)]);
    }
    return out;
  }

  // ---------- Vẽ: form ----------

  private control(target: Target, spec: FieldSpec, obj: object) {
    const key = `${spec.target}:${spec.key}`;
    const id = `cn-${spec.target}-${spec.key}`;
    const ro = this.readOnly();
    const draft = this.drafts[key];
    const value = draft ?? fieldText(obj, spec);
    const def = fieldDefault(spec);
    const err = this.errors[key] || '';
    const describedBy = `${id}-h${err ? ` ${id}-e` : ''}`;
    const common = {
      id,
      'aria-invalid': err ? 'true' : 'false',
      'aria-describedby': describedBy,
    };
    if (spec.kind === 'bool') {
      const on = value === '' ? spec.default === true : value === 'true';
      return html`<input
        type="checkbox"
        id=${common.id}
        aria-describedby=${common['aria-describedby']}
        .checked=${on}
        ?disabled=${ro}
        @change=${(e: Event) => this.commit(target, spec, String((e.target as HTMLInputElement).checked))}
      />`;
    }
    if (spec.kind === 'select') {
      return html`<select
        id=${common.id}
        class="select sm ${spec.mono ? 'mono' : ''}"
        aria-invalid=${common['aria-invalid']}
        aria-describedby=${common['aria-describedby']}
        ?disabled=${ro}
        .value=${live(value === '' ? def : value)}
        @change=${(e: Event) => this.commit(target, spec, (e.target as HTMLSelectElement).value)}
      >
        ${(spec.options ?? []).map((o) => html`<option value=${o} ?selected=${o === (value === '' ? def : value)}>${o}</option>`)}
      </select>`;
    }
    return html`<input
      id=${common.id}
      class="input sm ${spec.mono ? 'mono' : ''}"
      type="text"
      autocomplete="off"
      spellcheck="false"
      inputmode=${spec.kind === 'number' ? 'decimal' : nothing}
      placeholder=${def}
      aria-invalid=${common['aria-invalid']}
      aria-describedby=${common['aria-describedby']}
      ?readonly=${ro}
      .value=${live(value)}
      @change=${(e: Event) => this.commit(target, spec, (e.target as HTMLInputElement).value)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />`;
  }

  private field(target: Target, spec: FieldSpec, obj: object, issues: Map<string, string[]>) {
    const key = `${spec.target}:${spec.key}`;
    const id = `cn-${spec.target}-${spec.key}`;
    const err = this.errors[key];
    const found = issues.get(key) ?? [];
    return html`<div class="cn-field ${spec.kind === 'bool' ? 'bool' : ''}">
      <label for=${id}
        >${t(spec.label)}${spec.unit ? html` <span class="unit">(${spec.unit})</span>` : nothing}</label
      >
      ${this.control(target, spec, obj)}
      <p class="help" id="${id}-h">${t(spec.help)}</p>
      ${err ? html`<p class="field-err" id="${id}-e" role="alert">${err}</p>` : nothing}
      ${!err && found.length ? html`<p class="field-err" id="${id}-e">${found.join(' · ')}</p>` : nothing}
    </div>`;
  }

  private form(target: Target, title: string, specs: readonly FieldSpec[], obj: object) {
    const issues = this.issuesFor(target);
    const group = (g: 'basic' | 'advanced') => {
      const list = specs.filter((s) => s.group === g);
      return list.length
        ? html`<fieldset class="cn-group ${g}">
            <legend>${t(`cn.group.${g}` as MessageKey)}</legend>
            ${list.map((s) => this.field(target, s, obj, issues))}
          </fieldset>`
        : nothing;
    };
    const rest = [...issues.entries()].filter(([k]) => k.endsWith(':*')).flatMap(([, v]) => v);
    return html`<section class="card cn-form" aria-label=${title}>
      <h3>${title}</h3>
      ${group('basic')} ${group('advanced')}
      ${
        rest.length
          ? html`<ul class="cn-issues">
              ${rest.map((m) => html`<li class="field-err">${m}</li>`)}
            </ul>`
          : nothing
      }
    </section>`;
  }

  // ---------- Vẽ: danh sách bên trái ----------

  private nav(target: Target) {
    const app = this.app;
    const channels = this.channels();
    const perDevice = tagsPerDevice((app.store.state.outline.tags?.tags ?? []) as never);
    const sel = app.ui.treeSel;
    const ro = this.readOnly();
    const item = (id: string, level: number, label: string, sub: string, count: number) =>
      html`<li role="treeitem" aria-level=${level} aria-selected=${sel === id ? 'true' : 'false'}>
        <button
          type="button"
          class="cn-item l${level} ${sel === id ? 'sel' : ''}"
          data-node=${id}
          @click=${() => app.revealNode(id)}
        >
          ${icon(level === 1 ? 'connection' : 'device')}<span class="lbl">${label}</span>
          <span class="sub">${sub}</span><span class="cnt">${count}</span>
        </button>
      </li>`;
    const addReason = ro ? t('reason.readOnly') : null;
    const deviceReason = ro
      ? t('reason.readOnly')
      : target.type === 'overview'
        ? t('cn.pick')
        : null;
    return html`<nav class="cn-nav card" aria-label=${t('cn.channels')}>
      <h3>${t('cn.channels')}</h3>
      <ul role="tree" class="cn-tree">
        ${channels.map(
          (c) =>
            html`${item(`channel:${c.id}`, 1, c.name || c.id, c.kind === 'modbus-rtu' ? 'RTU' : 'TCP', c.devices?.length ?? 0)}
            ${(c.devices ?? []).map((d) =>
              item(
                `fdev:${d.id}`,
                2,
                d.name || d.id,
                c.kind === 'modbus-rtu' ? `slave ${d.slave ?? 1}` : `unit ${d.unitId ?? 1}`,
                perDevice.get(d.id) ?? 0,
              ),
            )}`,
        )}
      </ul>
      ${channels.length ? nothing : html`<p class="help">${t('cn.empty.text')}</p>`}
      <div class="cn-nav-actions">
        <button
          class="btn sm"
          type="button"
          data-act="add-channel"
          aria-disabled=${addReason ? 'true' : nothing}
          title=${addReason ?? t('cn.add.tcp')}
          @click=${() => (addReason ? app.toast(addReason) : this.addChannel())}
        >
          ${icon('plus')}${t('cn.add.tcp')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-device"
          aria-disabled=${deviceReason ? 'true' : nothing}
          title=${deviceReason ?? t('cn.add.device')}
          @click=${() => (deviceReason ? app.toast(deviceReason) : void app.run('tree.add'))}
        >
          ${icon('plus')}${t('cn.add.device')}
        </button>
      </div>
    </nav>`;
  }

  private addChannel(): void {
    this.app.revealNode('connections');
    void this.app.run('tree.add');
  }

  // ---------- Vẽ: Thử kết nối ----------

  private probeCard(target: Extract<Target, { type: 'device' }>) {
    const app = this.app;
    const ctx = app.commandContext();
    const lock = probeGate({
      online: ctx.onlineAuth,
      role: ctx.onlineAuth ? (app.session.auth?.role ?? null) : null,
    });
    const st = app.probe.state;
    const reason = lock ? t(lock) : null;
    const count = Number(this.count);
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
      <h3 id="cn-probe-h">${t('cn.probe.title')}</h3>
      <p class="help">${t('cn.probe.help')}</p>
      <div class="cn-probe-row">
        <div class="cn-field">
          <label for="cn-probe-address">${t('cn.probe.address')}</label>
          <input
            id="cn-probe-address"
            class="input sm mono"
            type="text"
            spellcheck="false"
            autocomplete="off"
            .value=${live(this.address)}
            @input=${(e: Event) => (this.address = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="cn-field">
          <label for="cn-probe-count">${t('cn.probe.count')}</label>
          <input
            id="cn-probe-count"
            class="input sm"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            .value=${live(this.count)}
            @input=${(e: Event) => (this.count = (e.target as HTMLInputElement).value)}
          />
        </div>
        <button
          class="btn primary"
          type="button"
          data-role="probe-run"
          aria-disabled=${reason || st.running ? 'true' : nothing}
          title=${reason ?? t('cn.probe.run')}
          @click=${() => (reason ? app.toast(reason) : st.running ? undefined : void this.runProbe(target, count))}
        >
          ${icon('check')}${t('cn.probe.run')}
        </button>
      </div>
      ${reason ? html`<p class="help" data-role="probe-lock">${reason}</p>` : nothing}
      <div
        class="cn-probe-out"
        data-role="probe-result"
        role="status"
        aria-live="polite"
        aria-busy=${st.running ? 'true' : 'false'}
      >
        ${st.running ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.probe.running')}</p>` : nothing}
        ${st.result ? this.resultView(st.result) : nothing}
      </div>
    </section>`;
  }

  private async runProbe(
    target: Extract<Target, { type: 'device' }>,
    count: number,
  ): Promise<void> {
    const address = this.address.trim();
    const read = address
      ? { address, count: Number.isFinite(count) && count > 0 ? count : 1 }
      : null;
    await this.app.probe.run(target.owner, target.device, read);
  }

  private resultView(r: ProbeResult) {
    if (r.failure)
      return html`<div
        class="banner ${r.failure === 'busy' || r.failure === 'rate' ? 'warn' : 'err'}"
        role="alert"
      >
        ${icon('err', 'err')}
        <div>${this.failureText(r)}</div>
      </div>`;
    const lines = interpretTable(r.interpret);
    const multi = lines.some((l) => Object.keys(l.values).length > 1);
    return html`<p>
        <span class="chip ${r.ok ? 'ok' : 'err'}" data-role="probe-status"
          >${r.ok ? t('cn.probe.ok') : t('cn.probe.fail')}</span
        >
        <span class="mono" data-role="probe-code"
          >${t('cn.probe.code')}: ${r.code} · ${probeCodeText(r.code)}</span
        >
      </p>
      ${r.connectMs !== undefined || r.responseMs !== undefined ? html`<p class="help">${t('cn.probe.times', { connect: r.connectMs ?? '—', response: r.responseMs ?? '—' })}</p>` : nothing}
      ${r.message ? html`<p>${r.message}</p>` : nothing}
      ${r.exception ? html`<p data-role="probe-exception">${t('cn.probe.exception', { code: r.exception.code, meaning: exceptionText(r.exception.code) })}</p>` : nothing}
      ${r.read ? html`<p class="help">${t('cn.probe.read', { fc: r.read.fc, offset: r.read.offset, count: r.read.count })}</p>` : nothing}
      ${r.hex ? html`<p><b>${t('cn.probe.hex')}</b> <code class="mono" data-role="probe-hex">${r.hex.join(' ')}</code></p>` : nothing}
      ${r.bits ? html`<p><b>${t('cn.probe.bits')}</b> <code class="mono">${r.bits.map((b) => (b ? '1' : '0')).join(' ')}</code></p>` : nothing}
      ${
        lines.length
          ? html`<table class="grid cn-interp" aria-label=${t('cn.probe.interpret')}>
              <thead>
                <tr>
                  <th>${t('cn.probe.col.type')}</th>
                  ${multi ? ORDERS.map((o) => html`<th class="mono">${o}</th>`) : html`<th>${t('cn.probe.col.value')}</th>`}
                </tr>
              </thead>
              <tbody>
                ${lines.map(
                  (l) =>
                    html`<tr data-type=${l.type}>
                      <td class="mono">${l.type}</td>
                      ${(Object.keys(l.values).length > 1 ? ORDERS : (['-'] as const)).map(
                        (o) =>
                          html`<td class="mono num ${l.invalid.includes(o) ? 'bad' : ''}">
                            ${l.values[o] ?? ''}
                          </td>`,
                      )}
                    </tr>`,
                )}
              </tbody>
            </table>`
          : nothing
      }`;
  }

  private failureText(r: ProbeResult): string {
    switch (r.failure) {
      case 'busy':
        return t('cn.probe.busy');
      case 'rate':
        return r.retryAfterS !== undefined
          ? t('cn.probe.rate', { n: r.retryAfterS })
          : t('cn.probe.rateNoTime');
      case 'badRequest':
        return t('cn.probe.bad', { issues: (r.issues ?? []).join(', ') });
      case 'audit':
        return t('cn.probe.audit');
      case 'device':
        return t('cn.probe.device', {
          reason: r.deviceError ? deviceErrorText(r.deviceError) : '',
        });
      default:
        return t('cn.probe.unknown', { code: r.code });
    }
  }

  // ---------- Vẽ: tổng quan ----------

  private overview() {
    const cfg = this.app.store.state.outline.connections;
    const ro = this.readOnly();
    return html`<section class="card cn-form" aria-label=${t('cn.groups.title')}>
      <h3>${t('cn.groups.title')}</h3>
      <p class="help">${t('cn.groups.help')}</p>
      <div class="cn-scan">
        ${SCAN.map((g) => {
          const key = `scan:${g}`;
          const err = this.errors[key];
          const value =
            this.drafts[key] ??
            (cfg?.scanGroups?.[g] === undefined ? '' : String(cfg.scanGroups[g]));
          const def = { fast: '250', normal: '1000', slow: '5000' }[g];
          return html`<div class="cn-field">
            <label for="cn-scan-${g}"
              >${t(`cn.scan.${g}` as MessageKey)} <span class="unit">(ms)</span></label
            >
            <input
              id="cn-scan-${g}"
              class="input sm mono"
              type="text"
              inputmode="numeric"
              placeholder=${def}
              ?readonly=${ro}
              aria-invalid=${err ? 'true' : 'false'}
              .value=${live(value)}
              @change=${(e: Event) => this.setScan(g, (e.target as HTMLInputElement).value)}
            />
            ${err ? html`<p class="field-err" role="alert">${err}</p>` : nothing}
          </div>`;
        })}
      </div>
      ${
        this.channels().length
          ? nothing
          : html`<div class="empty">
              ${icon('connection', 'lg')}<b>${t('cn.empty.title')}</b>
              <p>${t('cn.empty.text')}</p>
            </div>`
      }
    </section>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const target = this.target();
    const ro = this.readOnly();
    const removable = target.type !== 'overview';
    const main =
      target.type === 'channel'
        ? this.form(
            target,
            `${t(`cn.kind.${target.channel.kind}` as MessageKey)}: ${target.channel.name || target.channel.id}`,
            channelFields(target.channel.kind as ChannelKind),
            target.channel,
          )
        : target.type === 'device'
          ? html`${this.form(target, `${t('cn.device')}: ${target.device.name || target.device.id}`, deviceFields(target.owner.kind as ChannelKind), target.device)}
            ${this.probeCard(target)}`
          : this.overview();
    return html`<div class="ed ed-fill cn">
      <div class="ed-head">
        <h2>${app.editorTitle('connections')}</h2>
        <span class="path">${s.outline.connectionFile ?? 'connections.json'}</span>
        <span class="grow"></span>
        ${
          removable
            ? html`<button
                class="btn sm"
                type="button"
                data-act="remove"
                aria-disabled=${ro ? 'true' : nothing}
                @click=${() => (ro ? app.toast(t('reason.readOnly')) : void app.run('tree.remove'))}
              >
                ${icon('x')}${target.type === 'channel' ? t('cn.remove.channel') : t('cn.remove.device')}
              </button>`
            : nothing
        }
      </div>
      ${
        ro
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t('tagTable.readOnlyBanner')}</div>
            </div>`
          : nothing
      }
      <div class="cn-body">
        ${this.nav(target)}
        <div class="cn-main">${main}</div>
      </div>
    </div>`;
  }
}

customElements.define('mat-connections-editor', ConnectionsEditor);

registerEditor({
  match: (id) => id === 'connections',
  render: (app) => html`<mat-connections-editor .app=${app}></mat-connections-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-connections-editor': ConnectionsEditor;
  }
}
