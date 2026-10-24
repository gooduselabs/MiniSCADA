// Editor Kết nối (feature 006, T130, FR-030, FR-044, studio-ux §5 mục Form, mockup studio-tags.html v-conn): kênh Modbus TCP
// (RTU ở T171; Siemens S7 ở feature 016: một CPU mỗi kênh, chưa có Thử kết nối; OPC UA ở feature 019: một server mỗi
// kênh, Lấy chứng chỉ và Duyệt node thay cho Thử kết nối) và thiết bị trường theo nhóm Kết nối,
// Nâng cao; trợ giúp ngay dưới ô; lỗi tại ô (khi gõ và từ bộ kiểm tra); nhóm quét; và panel Thử kết nối (thời gian, mã,
// hex, bảng cách hiểu 4 thứ tự byte, exception kèm nghĩa).
// Mỗi lần xác nhận một trường là một sửa đổi `channelUpsert`/`deviceUpsert` (một bước hoàn tác). Studio không tự kết nối tới
// thiết bị trường: Thử kết nối đi qua BL335 (`DeviceLink.post`).
import type { Channel, FieldDevice } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { exceptionText, issueText, probeCodeText } from '../../app/code-text.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  canAddDevice,
  channelFields,
  channelSub,
  FIELD_GROUPS,
  deviceFields,
  deviceSub,
  fieldDefault,
  fieldText,
  interpretTable,
  issueField,
  portChoices,
  portProblem,
  portsGate,
  oneDeviceReason,
  opcuaNeedsPin,
  opcuaSecurityConflict,
  probeGate,
  probeSupported,
  rs485Hint,
  s7TsapConflict,
  setField,
  tagsPerDevice,
  visibleChannelFields,
  type ChannelKind,
  type FieldGroup,
  type FieldSpec,
  type ProbeResult,
} from '../../model/connections.ts';
import { treeAddChannel } from '../../app/tree-commands.ts';
import { mcFieldHint } from '../../model/mc.ts';
import { OpcUaCards } from './connections-opcua.ts';
import { planOpcdaImport } from '../../model/opcda-map.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './connections-editor.css';
import './connections-bacnet.ts';

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
    opcdaQuality: { state: true },
    opcdaResult: { state: true },
  };

  declare drafts: Readonly<Record<string, string>>;
  declare errors: Readonly<Record<string, string>>;
  declare address: string;
  declare count: string;
  /** Thẻ Chứng chỉ server và Duyệt node của kênh OPC UA (feature 019). */
  private readonly opcua = new OpcUaCards(this);
  declare opcdaQuality: boolean;
  declare opcdaResult: { summary: string; lines: string[] } | null;
  /** Chữ đang gõ dở theo khóa ô; không phải state phản ứng (gõ không vẽ lại). */
  private readonly typing: Record<string, string> = {};

  constructor() {
    super();
    this.drafts = {};
    this.errors = {};
    this.address = 'HR100';
    this.count = '2';
    this.opcdaQuality = true;
    this.opcdaResult = null;
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
    // Chữ đang gõ dở (chưa xác nhận) thắng mọi lần vẽ lại do việc khác (kết quả thử, kiểm tra nền) gây ra.
    const value = this.typing[key] ?? draft ?? fieldText(obj, spec);
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
      inputmode=${spec.kind === 'number' && !spec.hex ? 'decimal' : nothing}
      placeholder=${def}
      aria-invalid=${common['aria-invalid']}
      aria-describedby=${common['aria-describedby']}
      ?readonly=${ro}
      .value=${live(value)}
      @input=${(e: Event) => void (this.typing[key] = (e.target as HTMLInputElement).value)}
      @change=${(e: Event) => {
        delete this.typing[key];
        this.commit(target, spec, (e.target as HTMLInputElement).value);
      }}
      @blur=${() => void delete this.typing[key]}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />`;
  }

  /**
   * Cảnh báo không chặn tại ô. Kênh S7: TSAP đích cùng rack/slot (E_S7_TSAP, báo ngay khi gõ; ở ô TSAP đích chỉ khi bộ kiểm
   * tra chưa báo). Kênh OPC UA: chế độ và policy không khớp (E_OPCUA_SECURITY), mật khẩu trên kết nối không mã hóa, chưa
   * tin chứng chỉ server. Kênh RTU khi Online và đã đọc danh sách cổng (US3-4, US3-5): cổng ngoài danh sách cho phép, đang
   * có ai dùng; RS485.
   */
  private fieldWarning(
    target: Target,
    spec: FieldSpec,
    obj: object,
    found: readonly string[],
  ): string | null {
    if (target.type === 'channel' && target.channel.kind === 's7') {
      const keys = found.length ? ['rack', 'slot'] : ['rack', 'slot', 'remoteTsap'];
      return keys.includes(spec.key) && s7TsapConflict(obj as Channel)
        ? t('cn.s7.tsapConflict')
        : null;
    }
    if (target.type === 'channel' && target.channel.kind === 'opcua') {
      const ch = obj as Channel;
      if (spec.key === 'securityPolicy' && opcuaSecurityConflict(ch))
        return t('cn.opcua.securityConflict');
      if (spec.key === 'serverCertSha256' && opcuaNeedsPin(ch)) return t('cn.opcua.needsPin');
      if (
        spec.key === 'authMode' &&
        ch.opcua?.auth?.mode === 'username' &&
        (ch.opcua.securityMode ?? 'None') === 'None'
      )
        return t('cn.opcua.plainPassword');
      return null;
    }
    return this.portWarning(target, spec, obj);
  }

  /** Cảnh báo của Studio khi Online và đã đọc danh sách cổng (US3-4, US3-5): cổng ngoài danh sách cho phép, đang có ai dùng; RS485. */
  private portWarning(target: Target, spec: FieldSpec, obj: object): string | null {
    if (target.type !== 'channel' || target.channel.kind !== 'modbus-rtu') return null;
    const ports = this.app.ports.state.ports;
    if (!ports) return null;
    const serial = (obj as Channel).serial;
    if (spec.key === 'serialPort') {
      const p = portProblem(serial?.port ?? '', ports, target.channel.id);
      if (!p) return null;
      return p.reason === 'cn.err.portUnknown'
        ? t(p.reason, { port: p.port })
        : t('cn.err.portProblem', { port: p.port, why: t(p.reason, { channel: p.channel ?? '' }) });
    }
    if (spec.key === 'rs485') {
      const name = serial?.port ?? '';
      const port = ports.find((x) => x.name === name || x.path === name || x.byId === name);
      const hint = rs485Hint(serial?.rs485 ?? true, port);
      return hint ? t(hint) : null;
    }
    return null;
  }

  /** Gợi ý mềm của kênh MC (feature 017): cổng Modbus, ASCII, UDP, trạm không khớp mạng, module I/O lạ… */
  private mcWarning(target: Target, spec: FieldSpec, obj: object): string | null {
    const owner =
      target.type === 'channel' ? target.channel : target.type === 'device' ? target.owner : null;
    if (owner?.kind !== 'mc') return null;
    const hint = mcFieldHint(spec.key, spec.target, obj as Channel | FieldDevice);
    return hint ? t(hint.key, hint.params) : null;
  }

  private field(target: Target, spec: FieldSpec, obj: object, issues: Map<string, string[]>) {
    const key = `${spec.target}:${spec.key}`;
    const id = `cn-${spec.target}-${spec.key}`;
    const err = this.errors[key];
    const found = issues.get(key) ?? [];
    const warn = this.fieldWarning(target, spec, obj, found) ?? this.mcWarning(target, spec, obj);
    return html`<div class="cn-field ${spec.kind === 'bool' ? 'bool' : ''}">
      <label for=${id}
        >${t(spec.label)}${spec.unit ? html` <span class="unit">(${spec.unit})</span>` : nothing}</label
      >
      ${this.control(target, spec, obj)}
      <p class="help" id="${id}-h">${t(spec.help)}</p>
      ${err ? html`<p class="field-err" id="${id}-e" role="alert">${err}</p>` : nothing}
      ${!err && found.length ? html`<p class="field-err" id="${id}-e">${found.join(' · ')}</p>` : nothing}
      ${warn ? html`<p class="field-warn" id="${id}-w" role="status">${icon('warn', 'warn')}${warn}</p>` : nothing}
    </div>`;
  }

  private form(target: Target, title: string, specs: readonly FieldSpec[], obj: object) {
    const issues = this.issuesFor(target);
    const group = (g: FieldGroup) => {
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
      ${FIELD_GROUPS.map((g) => group(g))}
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
    const item = (
      id: string,
      level: number,
      label: string,
      sub: string,
      count: number,
      s7 = false,
    ) =>
      html`<li role="treeitem" aria-level=${level} aria-selected=${sel === id ? 'true' : 'false'}>
        <button
          type="button"
          class="cn-item l${level} ${sel === id ? 'sel' : ''}"
          data-node=${id}
          @click=${() => app.revealNode(id)}
        >
          ${icon(level === 1 ? (s7 ? 'plc' : 'connection') : 'device')}<span class="lbl"
            >${label}</span
          >
          <span class="sub">${sub}</span><span class="cnt">${count}</span>
        </button>
      </li>`;
    const addReason = ro ? t('reason.readOnly') : null;
    const owner =
      target.type === 'channel' ? target.channel : target.type === 'device' ? target.owner : null;
    // feature 018: kênh Omron FINS chỉ có từ định dạng 1.1
    const finsReason =
      addReason ?? (app.store.state.outline.format11 ? null : t('reason.needFormat11'));
    // feature 017: kênh MC cần project 1.1 (E_CHANNEL_VERSION)
    const mcReason = addReason ?? (app.store.state.outline.format11 ? null : t('cn.mc.need11'));
    // feature 020: kênh BACnet/IP chỉ có từ định dạng 1.1
    const bacnetReason =
      addReason ?? (app.store.state.outline.format11 ? null : t('reason.needFormat11'));
    const deviceReason = ro
      ? t('reason.readOnly')
      : !owner
        ? t('cn.pick')
        : !canAddDevice(owner)
          ? t(oneDeviceReason(owner))
          : null;
    return html`<nav class="cn-nav card" aria-label=${t('cn.channels')}>
      <h3>${t('cn.channels')}</h3>
      <ul role="tree" class="cn-tree">
        ${channels.map(
          (c) =>
            html`${item(`channel:${c.id}`, 1, c.name || c.id, channelSub(c), c.devices?.length ?? 0, c.kind === 's7')}
            ${(c.devices ?? []).map((d) =>
              item(`fdev:${d.id}`, 2, d.name || d.id, deviceSub(c, d), perDevice.get(d.id) ?? 0),
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
          data-act="add-channel-rtu"
          aria-disabled=${addReason ? 'true' : nothing}
          title=${addReason ?? t('cn.add.rtu')}
          @click=${() => (addReason ? app.toast(addReason) : this.addRtuChannel())}
        >
          ${icon('plus')}${t('cn.add.rtu')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-channel-s7"
          aria-disabled=${addReason ? 'true' : nothing}
          title=${addReason ?? t('cn.add.s7')}
          @click=${() => (addReason ? app.toast(addReason) : treeAddChannel(app, 's7'))}
        >
          ${icon('plus')}${t('cn.add.s7')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-channel-fins"
          aria-disabled=${finsReason ? 'true' : nothing}
          title=${finsReason ?? t('cn.add.fins')}
          @click=${() => (finsReason ? app.toast(finsReason) : treeAddChannel(app, 'fins'))}
        >
          ${icon('plus')}${t('cn.add.fins')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-channel-mc"
          aria-disabled=${mcReason ? 'true' : nothing}
          title=${mcReason ?? t('cn.add.mc')}
          @click=${() => (mcReason ? app.toast(mcReason) : treeAddChannel(app, 'mc'))}
        >
          ${icon('plus')}${t('cn.add.mc')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-channel-bacnet"
          aria-disabled=${bacnetReason ? 'true' : nothing}
          title=${bacnetReason ?? t('cn.add.bacnet')}
          @click=${() => (bacnetReason ? app.toast(bacnetReason) : treeAddChannel(app, 'bacnet'))}
        >
          ${icon('plus')}${t('cn.add.bacnet')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="add-channel-opcua"
          aria-disabled=${addReason ? 'true' : nothing}
          title=${addReason ?? t('cn.add.opcua')}
          @click=${() => (addReason ? app.toast(addReason) : treeAddChannel(app, 'opcua'))}
        >
          ${icon('plus')}${t('cn.add.opcua')}
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

  private addRtuChannel(): void {
    treeAddChannel(this.app, 'modbus-rtu');
  }

  // ---------- Vẽ: cổng serial của kênh RTU ----------

  private portsCard(target: Extract<Target, { type: 'channel' }>) {
    const app = this.app;
    const ctx = app.commandContext();
    const lock = portsGate({
      online: ctx.onlineAuth,
      role: ctx.onlineAuth ? (app.session.auth?.role ?? null) : null,
    });
    const st = app.ports.state;
    const reason = lock ? t(lock) : null;
    const ro = this.readOnly();
    const choices = st.ports ? portChoices(st.ports, target.channel.id) : [];
    const serialSpec = channelFields('modbus-rtu').find((x) => x.key === 'serialPort')!;
    const useText = (c: (typeof choices)[number]): string => {
      const use = c.info.inUse;
      if (!use)
        return c.info.allowed
          ? t('cn.ports.free')
          : `${t('cn.ports.free')} · ${t('cn.ports.notAllowedTag')}`;
      if (use.by === 'channel')
        return use.detail === target.channel.id
          ? t('cn.ports.you')
          : t('cn.ports.byChannel', { channel: use.detail });
      return use.detail || t(c.status.usable ? 'cn.ports.free' : 'cn.port.other');
    };
    const btn = (role: string, text: MessageKey, tip: string, probe: boolean) =>
      html`<button
        class="btn sm"
        type="button"
        data-role=${role}
        aria-disabled=${reason || st.loading ? 'true' : nothing}
        title=${reason ?? tip}
        @click=${() => (reason ? app.toast(reason) : st.loading ? undefined : void app.ports.load(probe))}
      >
        ${icon(probe ? 'check' : 'refresh')}${t(text)}
      </button>`;
    return html`<section class="card cn-ports" aria-labelledby="cn-ports-h">
      <h3 id="cn-ports-h">${t('cn.ports.title')}</h3>
      <p class="help">${t('cn.ports.help')}</p>
      <div class="cn-ports-actions">
        ${btn('ports-load', 'cn.ports.load', t('cn.ports.load'), false)}
        ${btn('ports-probe', 'cn.ports.probe', t('cn.ports.probeTip'), true)}
        ${st.probed ? html`<span class="help" data-role="ports-probed">${t('cn.ports.probed')}</span>` : nothing}
      </div>
      ${reason ? html`<p class="help" data-role="ports-lock">${reason}</p>` : nothing}
      <div
        data-role="ports-result"
        role="status"
        aria-live="polite"
        aria-busy=${st.loading ? 'true' : 'false'}
      >
        ${st.loading ? html`<p><span class="spin" aria-hidden="true"></span> ${t('cn.ports.loading')}</p>` : nothing}
        ${st.error ? html`<p class="field-err" data-role="ports-error" role="alert">${t('cn.ports.error', { reason: deviceErrorText({ error: st.error }) })}</p>` : nothing}
      </div>
      ${
        st.ports && !choices.length
          ? html`<p class="help">${t('cn.ports.empty')}</p>`
          : choices.length
            ? html`<table class="grid cn-port-table" aria-label=${t('cn.ports.title')}>
                <thead>
                  <tr>
                    <th>${t('cn.ports.col.name')}</th>
                    <th>${t('cn.ports.col.kind')}</th>
                    <th>${t('cn.ports.col.use')}</th>
                    <th>${t('cn.ports.col.rs485')}</th>
                    <th><span class="visually-hidden">${t('cn.ports.pick')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${choices.map((c) => {
                    const why = c.status.usable
                      ? null
                      : t(c.status.reason, { channel: c.status.channel ?? '' });
                    const off = ro || !c.usable;
                    return html`<tr data-port=${c.name}>
                      <td class="mono pt-name">${c.name}</td>
                      <td class="pt-kind">
                        ${t(`cn.port.kind.${c.kind}` as MessageKey)}${c.info.usb ? html` <span class="muted">${c.info.usb.product ?? ''} (${c.info.usb.vid}:${c.info.usb.pid})</span>` : nothing}
                      </td>
                      <td class="pt-use">${useText(c)}</td>
                      <td class="pt-rs485">${t(`cn.port.rs485.${c.rs485}` as MessageKey)}</td>
                      <td>
                        <button
                          class="btn sm"
                          type="button"
                          data-act="pick"
                          aria-disabled=${off ? 'true' : nothing}
                          title=${ro ? t('reason.readOnly') : (why ?? t('cn.ports.pickTip', { name: c.name }))}
                          @click=${() => (off ? app.toast(ro ? t('reason.readOnly') : (why ?? '')) : this.commit(target, serialSpec, c.name))}
                        >
                          ${t('cn.ports.pick')}
                        </button>
                      </td>
                    </tr>`;
                  })}
                </tbody>
              </table>`
            : nothing
      }
    </section>`;
  }

  // ---------- Vẽ: kênh Siemens S7 ----------

  /**
   * Ghi chú cấu hình PLC cho kênh S7 (PUT/GET, optimized block access). Project chưa ở định dạng 1.1: báo ngay (không chặn;
   * bộ kiểm tra báo E_DRIVER_VERSION hoặc lỗi schema của tệp kết nối).
   */
  private s7Note(needs11: boolean) {
    return html`${
        needs11
          ? html`<div class="banner warn" role="status" data-role="s7-version">
              ${icon('warn', 'warn')}
              <div>${t('cn.s7.needs11')}</div>
            </div>`
          : nothing
      }
      <section class="card cn-note" aria-label=${t('cn.kind.s7')} data-role="s7-note">
        <p class="help">${icon('plc')} ${t('cn.s7.putget')}</p>
      </section>`;
  }

  /** Thử kết nối chưa hỗ trợ kênh S7 (feature 016, D8): ghi chú thay cho panel. */
  private probeUnsupported() {
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
      <h3 id="cn-probe-h">${t('cn.s7.probeTitle')}</h3>
      <p class="help" data-role="probe-unsupported">${t('cn.s7.probeNote')}</p>
      <p class="help">${t('cn.s7.putget')}</p>
    </section>`;
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
    const fins = target.owner.kind === 'fins';
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
      <h3 id="cn-probe-h">${t('cn.probe.title')}</h3>
      <p class="help">${t(fins ? 'cn.probe.finsHelp' : 'cn.probe.help')}</p>
      <div class="cn-probe-row">
        <div class="cn-field">
          <label for="cn-probe-address">${t('cn.probe.address')}</label>
          <input
            id="cn-probe-address"
            class="input sm mono"
            type="text"
            spellcheck="false"
            autocomplete="off"
            .value=${live(this.probeAddress(fins))}
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

  /** Địa chỉ của ô Thử kết nối; với thiết bị FINS, địa chỉ Modbus mặc định đổi thành D100 (feature 018). */
  private probeAddress(fins: boolean): string {
    return fins && this.address === 'HR100' ? 'D100' : this.address;
  }

  /** Kênh MC: Thử kết nối chưa có (feature 017, T091); chỉ sang Chẩn đoán driver. */
  private mcProbeNote() {
    return html`<section class="card cn-probe" aria-labelledby="cn-probe-h">
      <h3 id="cn-probe-h">${t('cn.probe.title')}</h3>
      <p class="help" data-role="probe-mc">${t('cn.probe.mcLater')}</p>
    </section>`;
  }

  private async runProbe(
    target: Extract<Target, { type: 'device' }>,
    count: number,
  ): Promise<void> {
    const address = this.probeAddress(target.owner.kind === 'fins').trim();
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
      ${r.model ? html`<p data-role="probe-model">${t('cn.probe.model', { model: r.model })}</p>` : nothing}
      ${r.nodes ? html`<p class="help">${t('cn.probe.nodes', { client: r.nodes.client, server: r.nodes.server })}</p>` : nothing}
      ${r.endCode ? html`<p data-role="probe-endcode">${t('cn.probe.endCode', { code: r.endCode.code, meaning: r.endCode.meaning })}</p>` : nothing}
      ${r.address ? html`<p class="help">${t('cn.probe.finsRead', { address: r.address, count: (r.hex ?? r.bits ?? []).length })}</p>` : nothing}
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

  /** Thẻ BACnet/IP (feature 020): Tìm thiết bị ở kênh, Thử kết nối và Duyệt đối tượng ở thiết bị. */
  private bacnetPanel(channel: number, device: number, ro: boolean) {
    return html`<mat-bacnet-panel
      .app=${this.app}
      .mode=${device < 0 ? 'channel' : 'device'}
      .channelIndex=${channel}
      .deviceIndex=${Math.max(0, device)}
      .readOnly=${ro}
    ></mat-bacnet-panel>`;
  }

  // ---------- OPC DA qua cầu nối (spec 021) ----------

  private opcdaCard(target: Extract<Target, { type: 'device' }>) {
    if (target.owner.kind !== 'modbus-tcp') return nothing;
    const ro = this.readOnly();
    const r = this.opcdaResult;
    return html`<section class="card cn-form" data-role="opcda" aria-label=${t('cn.opcda.title')}>
      <h3>${t('cn.opcda.title')}</h3>
      <p class="help">${t('cn.opcda.helpDevice')}</p>
      <div class="cn-probe-row">
        <label
          ><input
            type="checkbox"
            data-role="opcda-quality"
            .checked=${live(this.opcdaQuality)}
            @change=${(e: Event) => (this.opcdaQuality = (e.target as HTMLInputElement).checked)}
          />
          ${t('cn.opcda.quality')}</label
        >
        <button
          class="btn sm"
          type="button"
          data-act="opcda-import"
          aria-disabled=${ro ? 'true' : nothing}
          @click=${() => (ro ? this.app.toast(t('reason.readOnly')) : void this.importOpcda(target))}
        >
          ${icon('import')}${t('cn.opcda.import')}
        </button>
      </div>
      ${
        r
          ? html`<div role="status" data-role="opcda-result">
              <p>${r.summary}</p>
              ${r.lines.map((l) => html`<p class="help">${l}</p>`)}
            </div>`
          : nothing
      }
    </section>`;
  }

  private async importOpcda(target: Extract<Target, { type: 'device' }>): Promise<void> {
    const file = await this.app.csvOpen();
    if (file === null) return;
    if ('error' in file) {
      this.app.toast(t(file.error === 'too-large' ? 'tt.csv.err.too-large' : 'tt.csv.err.io'));
      return;
    }
    const plan = planOpcdaImport(file.bytes, this.app.store.state.outline.tags?.tags ?? [], {
      device: target.device.id,
      withQuality: this.opcdaQuality,
    });
    if (plan.fatal) {
      this.app.toast(t('cn.opcda.fatal', { reason: plan.fatal }));
      return;
    }
    if (plan.edits.length) this.app.store.edit(plan.edits);
    this.opcdaResult = {
      summary: t('cn.opcda.done', {
        add: plan.add,
        update: plan.update,
        errors: plan.errors.length,
      }),
      lines: plan.errors
        .slice(0, 20)
        .map((e) => t('cn.opcda.line', { line: e.line, reason: e.reason })),
    };
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
      </section>
      <section class="card cn-form" data-role="opcda-help" aria-label=${t('cn.opcda.title')}>
        <h3>${t('cn.opcda.title')}</h3>
        <p class="help">${t('cn.opcda.help')}</p>
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
        ? html`${this.form(
            target,
            `${t(`cn.kind.${target.channel.kind}` as MessageKey)}: ${target.channel.name || target.channel.id}`,
            visibleChannelFields(target.channel),
            target.channel,
          )}
          ${target.channel.kind === 'modbus-rtu' ? this.portsCard(target) : nothing}
          ${target.channel.kind === 's7' ? this.s7Note(!s.outline.format11) : nothing}
          ${target.channel.kind === 'bacnet' ? this.bacnetPanel(target.index, -1, ro) : nothing}
          ${target.channel.kind === 'opcua' ? this.opcua.render(target.channel, !s.outline.format11, ro) : nothing}`
        : target.type === 'device'
          ? html`${this.form(target, `${t('cn.device')}: ${target.device.name || target.device.id}`, deviceFields(target.owner.kind as ChannelKind), target.device)}
            ${
              target.owner.kind === 'mc'
                ? this.mcProbeNote()
                : target.owner.kind === 'bacnet'
                  ? this.bacnetPanel(target.channel, target.index, ro)
                  : probeSupported(target.owner.kind)
                    ? this.probeCard(target)
                    : target.owner.kind === 'opcua'
                      ? this.opcua.probeNote()
                      : this.probeUnsupported()
            }
            ${this.opcdaCard(target)}`
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
