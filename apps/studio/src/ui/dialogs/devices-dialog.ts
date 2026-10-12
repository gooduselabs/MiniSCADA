// Hộp thoại Thiết bị trong mạng (feature 005, US1, spec US1-1, US1-2, Edge Cases; theo openDevices của mockup
// đã duyệt): chọn card mạng, Tìm lại; bảng thiết bị trả lời gói tìm (hiện dần) và thiết bị đã lưu, cột tên,
// địa chỉ, runtime, project, trạng thái; chọn dòng hiện model, MAC, cổng HTTPS, fingerprint (chỉ tham khảo);
// Thêm theo địa chỉ; Online (dò chứng chỉ rồi sang bước ghim, đăng nhập). Bảng là lưới ARIA: ↑ ↓ Home End
// chọn dòng, Enter Online. Logic (gộp, sắp, gợi ý) ở model/discovery.ts.
import { compareSemver } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { HTTP_PORT, type DeviceInfo } from '../../model/device.ts';
import {
  deviceRows,
  ifaceOptions,
  scanHint,
  SCAN_MS,
  statusKind,
  type DeviceRow,
  type StatusKind,
} from '../../model/discovery.ts';
import { ONLINE_RUNTIME } from '../../model/device-session.ts';
import { isDeviceError } from '../../platform/device-types.ts';
import { icon } from '../base.ts';
import type { OnlineIntent } from '../../app/app.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { sessionErrorText } from '../diagnostics.ts';
import { groupFingerprint, OnlineDialog } from './dialog-frame.ts';

/** Kiểm nhanh thiết bị đã lưu qua HTTP (system/info), như mockup ("Đang kiểm tra…"). */
type SavedCheck = { state: 'checking' } | { state: 'ok'; info: DeviceInfo } | { state: 'none' };

const STATUS: Readonly<Record<StatusKind, { key: MessageKey; chip: string; icon: IconName }>> = {
  running: { key: 'devices.status.running', chip: 'ok', icon: 'ok' },
  'no-project': { key: 'devices.status.no-project', chip: '', icon: 'info' },
  'project-error': { key: 'devices.status.project-error', chip: 'err', icon: 'err' },
  activating: { key: 'devices.status.activating', chip: 'info', icon: 'info' },
  unknown: { key: 'devices.status.unknown', chip: '', icon: 'info' },
};

/** Trạng thái project của system/info (004) → trạng thái của gói tìm. */
const INFO_STATUS: Readonly<Record<string, StatusKind>> = {
  active: 'running',
  missing: 'no-project',
  invalid: 'project-error',
};

const ADD_ERROR: Readonly<Record<string, MessageKey>> = {
  empty: 'devices.addErr.empty',
  scheme: 'devices.addErr.scheme',
  address: 'devices.addErr.address',
  port: 'devices.addErr.port',
  'bad-address': 'devices.addErr.address',
  'too-many': 'devices.addErr.too-many',
  'http-port': 'devices.addErr.http-port',
};

const own = <T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;

const seconds = (ms: number) =>
  (Math.max(0, ms) / 1000).toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

const DASH = () => t('devices.unknown');
const ADD_ID = 'dd-addr';
const ADD_ERR_ID = 'dd-addr-err';
const ADV_ID = 'dd-adv';
const HTTP_ID = 'dd-http';
const HTTP_ERR_ID = 'dd-http-err';
const HTTP_HELP_ID = 'dd-http-help';

export class MatDevicesDialog extends OnlineDialog {
  protected readonly kind = 'devices';
  private selKey: string | null = null;
  private adding = false;
  private addError: string | null = null;
  /** Ô có lỗi: địa chỉ, hoặc cổng HTTP (Nâng cao, T085b). */
  private addErrorField: 'addr' | 'http' = 'addr';
  /** Phần Nâng cao (cổng HTTP) của Thêm theo địa chỉ đang mở. */
  private advanced = false;
  private addBusy = false;
  private readonly checks = new Map<string, SavedCheck>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  protected override opened(): void {
    this.adding = false;
    this.addError = null;
    this.checks.clear();
  }

  protected override detached(): void {
    this.stopTicker();
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  protected override updated(): void {
    super.updated();
    // Đang quét: vẽ lại mỗi 100 ms để đếm thời gian và thanh tiến trình.
    const scanning = this.isOpen && this.app.discovery?.state === 'scanning';
    if (scanning && !this.ticker) this.ticker = setInterval(() => this.requestUpdate(), 100);
    else if (!scanning) this.stopTicker();
    // Dòng đang chọn (kể cả chọn mặc định) là thiết bị đã lưu: kiểm nhanh qua HTTP một lần.
    if (this.isOpen) {
      const rows = this.rows();
      const cur = rows[this.currentIndex(rows)];
      if (cur?.kind === 'saved') this.checkSaved(cur);
    }
  }

  // ---------- Dữ liệu ----------

  private rows(): DeviceRow[] {
    return deviceRows(this.app.discovery?.rows ?? [], this.app.knownDevices);
  }

  private currentIndex(rows: readonly DeviceRow[]): number {
    if (!rows.length) return -1;
    const i = rows.findIndex((r) => r.key === this.selKey);
    return i < 0 ? 0 : i;
  }

  private select(rows: readonly DeviceRow[], i: number): void {
    const row = rows[i];
    if (!row) return;
    this.selKey = row.key;
    if (row.kind === 'saved') this.checkSaved(row);
    this.requestUpdate();
  }

  /** Kiểm nhanh thiết bị đã lưu qua HTTP (system/info, không chiếm phiên): runtime, project, trạng thái. */
  private checkSaved(row: Extract<DeviceRow, { kind: 'saved' }>): void {
    const link = this.app.link;
    const k = row.known;
    if (!link || this.checks.has(k.id)) return;
    this.checks.set(k.id, { state: 'checking' });
    void link.monitorGet(`${k.host}:${k.httpPort}`).then((r) => {
      const body = isDeviceError(r) || r.status !== 200 ? null : r.body;
      this.checks.set(
        k.id,
        body && typeof body === 'object' && !Array.isArray(body)
          ? { state: 'ok', info: body as DeviceInfo }
          : { state: 'none' },
      );
      this.requestUpdate();
    });
  }

  // ---------- Hành động ----------

  private nicValue(): string {
    const ifaces = this.app.discovery?.ifaces ?? null;
    return ifaces && ifaces.length === 1 ? String(ifaces[0]) : 'all';
  }

  private readonly onNic = (e: Event): void => {
    const v = (e.target as HTMLSelectElement).value;
    void this.app.rescan(v === 'all' ? null : [Number(v)]);
  };

  private rescan(): void {
    void this.app.rescan(this.app.discovery?.ifaces ?? null);
  }

  private online(row: DeviceRow | undefined, intent: OnlineIntent | null = null): void {
    const app = this.app;
    // Như nút Online: chờ lượt quét xong, không chạy hai lượt dò cùng lúc.
    if (!row || !this.canOnline(row) || app.discovery?.state === 'scanning') return;
    if (app.session.mode === 'online' && app.session.state === 'probing') return;
    void app.goOnline(row, intent);
  }

  private canOnline(row: DeviceRow): boolean {
    return row.kind === 'saved' || row.device.httpsPort !== 0;
  }

  private openAdd(): void {
    this.adding = true;
    this.advanced = false;
    this.addError = null;
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.querySelector<HTMLInputElement>(`#${ADD_ID}`)?.focus(),
    );
  }

  private readonly onAdd = async (e: Event): Promise<void> => {
    e.preventDefault();
    const input = this.querySelector<HTMLInputElement>(`#${ADD_ID}`);
    if (!input || this.addBusy) return;
    this.addBusy = true;
    this.requestUpdate();
    const http = this.querySelector<HTMLInputElement>(`#${HTTP_ID}`);
    const r = await this.app.addDeviceAddress(input.value, { httpPort: http?.value ?? '' });
    this.addBusy = false;
    if (!r.ok) {
      const key = own(ADD_ERROR, r.error);
      this.addErrorField = r.error === 'http-port' ? 'http' : 'addr';
      this.addError = key
        ? t(key)
        : t('devices.addErr.other', { reason: deviceErrorText(r.cause ?? { error: r.error }) });
      this.requestUpdate();
      void this.updateComplete.then(() =>
        (this.addErrorField === 'http' && http ? http : input).focus(),
      );
      return;
    }
    this.adding = false;
    this.addError = null;
    const key = `saved:${r.device.id}`;
    const rows = this.rows();
    const i = rows.findIndex((x) => x.key === key);
    // Thiết bị vừa thêm có thể đang trả lời gói tìm: chọn dòng của nó.
    const found = rows.findIndex((x) => x.kind === 'found' && x.known?.id === r.device.id);
    this.select(rows, i >= 0 ? i : found);
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('table[role="grid"]')?.focus(),
    );
  };

  private readonly onGridKey = (e: KeyboardEvent): void => {
    const rows = this.rows();
    const i = this.currentIndex(rows);
    const next =
      e.key === 'ArrowDown'
        ? Math.min(rows.length - 1, i + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : null;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.online(rows[i]);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    this.select(rows, next);
  };

  // ---------- Vẽ ----------

  private statusChip(kind: StatusKind) {
    const s = STATUS[kind];
    return html`<span class="chip ${s.chip}">${icon(s.icon)}${t(s.key)}</span>`;
  }

  private rowCells(row: DeviceRow) {
    if (row.kind === 'found') {
      const d = row.device;
      const p = d.project;
      const project = p
        ? t('devices.project', { name: p.name || p.id, version: p.version })
        : DASH();
      return {
        name: d.name,
        mac: d.mac ?? null,
        address: d.ip,
        runtime: d.runtime,
        project,
        status: this.statusChip(statusKind(d.status)),
        pinned: !!row.known?.pin,
      };
    }
    const k = row.known;
    const c = this.checks.get(k.id);
    const info = c?.state === 'ok' ? c.info : null;
    const p = info?.project;
    const project =
      p?.projectId && p.projectVersion
        ? t('devices.project', {
            name: typeof p.projectName === 'string' && p.projectName ? p.projectName : p.projectId,
            version: p.projectVersion,
          })
        : DASH();
    const status =
      c?.state === 'checking'
        ? html`<span class="chip"
            ><span class="spin" aria-hidden="true"></span>${t('devices.status.checking')}</span
          >`
        : info
          ? this.statusChip(own(INFO_STATUS, p?.status) ?? 'unknown')
          : html`<span class="chip">${icon('info')}${t('devices.status.saved')}</span>`;
    return {
      name: k.name,
      mac: k.mac ?? null,
      address: `${k.host}:${k.httpsPort}`,
      runtime: info?.runtimeVersion ?? k.lastRuntime ?? DASH(),
      project,
      status,
      pinned: !!k.pin,
    };
  }

  private row(row: DeviceRow, i: number, selected: boolean, rows: readonly DeviceRow[]) {
    const c = this.rowCells(row);
    return html`<tr
      id="dd-row-${i}"
      data-key=${row.key}
      class=${selected ? 'rsel' : ''}
      aria-selected=${selected ? 'true' : 'false'}
      @click=${() => this.select(rows, i)}
      @dblclick=${() => this.online(row)}
    >
      <td>
        <span class="dd-name"
          >${icon('device')}<b>${c.name}</b>${
            c.pinned
              ? html`<span title=${t('devices.pinnedTip')}
                  >${icon('shield', 'ok')}<span class="visually-hidden"
                    >${t('devices.pinnedTip')}</span
                  ></span
                >`
              : nothing
          }${row.sameName && c.mac ? html`<span class="dd-mac">${c.mac}</span>` : nothing}</span
        >
      </td>
      <td class="mono">${c.address}</td>
      <td class="mono">${c.runtime}</td>
      <td>${c.project}</td>
      <td>${c.status}</td>
    </tr>`;
  }

  private emptyRow() {
    const scan = this.app.discovery;
    const hint = scan ? scanHint(scan) : null;
    const text =
      scan?.state === 'scanning'
        ? t('devices.waiting')
        : hint === 'iface-failed'
          ? t('devices.noneIface')
          : t('devices.none');
    return html`<tr>
      <td colspan="5" class="muted">${text}</td>
    </tr>`;
  }

  private top() {
    const app = this.app;
    const scan = app.discovery;
    const scanning = scan?.state === 'scanning';
    const opts = ifaceOptions(app.netInterfaces ?? []);
    const value = this.nicValue();
    const usable = opts.filter((o) => o.usable).length;
    return html`<div class="row wrap">
        <label class="inline" for="dev-nic">${t('devices.nic')}</label>
        <select class="select" id="dev-nic" ?disabled=${scanning} @change=${this.onNic}>
          <option value="all" .selected=${value === 'all'}>
            ${t('devices.nicAll', { n: usable })}
          </option>
          ${opts.map(
            (o) =>
              html`<option
                value=${String(o.index)}
                ?disabled=${!o.usable}
                .selected=${value === String(o.index)}
              >
                ${t(
                  o.reason === 'vpn'
                    ? 'devices.nicVpn'
                    : o.reason === 'no-broadcast'
                      ? 'devices.nicNoBroadcast'
                      : 'devices.nicOption',
                  { name: o.name, cidr: o.cidr },
                )}
              </option>`,
          )}
        </select>
        <button class="btn" type="button" ?disabled=${scanning} @click=${() => this.rescan()}>
          ${icon('refresh')}${t('devices.rescan')}
        </button>
        <span class="grow"></span>
        <label class="inline muted" title=${t('devices.ledTip')}
          ><input type="checkbox" disabled />${t('devices.led')}</label
        >
      </div>
      ${
        opts.some((o) => o.reason === 'vpn')
          ? html`<p class="help">${t('devices.vpnHint')}</p>`
          : nothing
      }`;
  }

  private status() {
    const app = this.app;
    const scan = app.discovery;
    if (!scan || scan.state === 'idle') return html`<div class="scan" role="status"></div>`;
    const opts = ifaceOptions(app.netInterfaces ?? []);
    const ifaces = scan.ifaces;
    const where =
      ifaces && ifaces.length === 1
        ? (opts.find((o) => o.index === ifaces[0])?.subnet ?? t('devices.scanAll'))
        : t('devices.scanAll');
    const started = scan.startedAt ?? Date.now();
    if (scan.state === 'scanning') {
      const elapsed = Date.now() - started;
      const pct = Math.min(100, (elapsed / SCAN_MS) * 100);
      return html`<div class="scan" role="status">
        <span class="spin" aria-hidden="true"></span>
        <span>${t('devices.scanning', { where, s: seconds(elapsed) })}</span>
        <span class="bar" aria-hidden="true"><i style=${styleMap({ width: `${pct}%` })}></i></span>
      </div>`;
    }
    if (scan.state === 'error')
      return html`<div class="scan" role="status">
        ${icon('err', 'err')}<span
          >${t('devices.scanError', {
            reason: deviceErrorText(scan.failure ?? { error: scan.error ?? '' }),
          })}</span
        >
      </div>`;
    const failed = (scan.summary?.failed ?? [])
      .map((f) => opts.find((o) => o.index === f.index)?.name ?? String(f.index))
      .join(', ');
    return html`<div class="scan" role="status">
      ${icon('ok', 'ok')}<span>${t('devices.scanDone', {
        s: seconds((scan.finishedAt ?? started) - started),
        n: scan.rows.length,
      })}</span>${failed ? html`<span class="muted">${t('devices.scanFailedIface', { names: failed })}</span>` : nothing}
    </div>`;
  }

  private details(row: DeviceRow | undefined) {
    if (!row) return nothing;
    const kv = (k: string, v: unknown, mono = false) =>
      html`<dt>${k}</dt>
        <dd class=${mono ? 'mono' : ''}>${v}</dd>`;
    const pinText = (pinned: boolean) =>
      pinned ? t('devices.detail.pinned') : t('devices.detail.unpinned');
    if (row.kind === 'found') {
      const d = row.device;
      const k = row.known;
      return html`<div class="devdetail">
        <dl class="kvs">
          ${kv(t('devices.detail.model'), d.model || DASH())}
          ${kv(t('devices.detail.mac'), d.mac || DASH(), true)}
          ${kv(
            t('devices.detail.https'),
            d.httpsPort ? `${d.ip}:${d.httpsPort}` : t('devices.detail.httpsOff'),
            d.httpsPort !== 0,
          )}
          ${kv(t('devices.detail.api'), d.api || DASH(), true)}
          ${kv(t('devices.detail.cert'), pinText(!!k?.pin))}
          ${k?.lastUser ? kv(t('devices.detail.lastUser'), k.lastUser, true) : nothing}
        </dl>
        ${
          d.fingerprint
            ? html`<div>
                <span class="help">${t('devices.detail.fingerprint')}</span>
                <pre class="fp mono">${groupFingerprint(d.fingerprint)}</pre>
              </div>`
            : nothing
        }
      </div>`;
    }
    const k = row.known;
    const c = this.checks.get(k.id);
    const runtime = c?.state === 'ok' ? c.info.runtimeVersion : undefined;
    const old = typeof runtime === 'string' && compareSemver(runtime, ONLINE_RUNTIME) < 0;
    return html`<div class="devdetail">
      <dl class="kvs">
        ${kv(t('devices.detail.https'), `${k.host}:${k.httpsPort}`, true)}
        ${kv(t('devices.detail.http'), `${k.host}:${k.httpPort}`, true)}
        ${kv(t('devices.detail.mac'), k.mac || DASH(), true)}
        ${kv(t('devices.detail.cert'), pinText(!!k.pin))}
        ${k.lastUser ? kv(t('devices.detail.lastUser'), k.lastUser, true) : nothing}
      </dl>
      ${old ? html`<p class="help">${icon('warn', 'warn')} ${t('device.err.runtime-old')}</p>` : nothing}
      ${
        k.pin
          ? html`<div>
              <span class="help">${t('pin.pinnedLabel')}</span>
              <pre class="fp mono">${groupFingerprint(k.pin.fingerprint)}</pre>
            </div>`
          : nothing
      }
      <p class="help">${t('devices.detail.notSeen')}</p>
      <div class="row">
        <button class="btn" type="button" @click=${() => void this.app.forgetDevice(k.id)}>
          ${icon('x')}${t('devices.detail.forget')}
        </button>
      </div>
    </div>`;
  }

  private readonly toggleAdvanced = (): void => {
    this.advanced = !this.advanced;
    // Đóng Nâng cao thì bỏ cả giá trị đã gõ (không gửi giá trị đang ẩn) và lỗi của nó.
    if (!this.advanced && this.addErrorField === 'http') this.addError = null;
    this.requestUpdate();
    if (this.advanced)
      void this.updateComplete.then(() =>
        this.querySelector<HTMLInputElement>(`#${HTTP_ID}`)?.focus(),
      );
  };

  /** Nâng cao: cổng HTTP (trang xem, theo dõi chỉ đọc; thiết bị runtime cũ qua port-forward, T085b). */
  private advancedPart(httpErr: boolean) {
    const open = this.advanced;
    return html`<div class="dd-adv">
      <button
        type="button"
        class="dd-adv-toggle"
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${open ? ADV_ID : nothing}
        @click=${this.toggleAdvanced}
      >
        ${icon(open ? 'chev-d' : 'chev-r', 'sm')}${t('devices.advanced')}
      </button>
      ${
        open
          ? html`<div class="dd-adv-body" id=${ADV_ID}>
              <div class="field">
                <label for=${HTTP_ID}>${t('devices.httpPortLabel')}</label>
                <input
                  id=${HTTP_ID}
                  name="http-port"
                  class="input mono ${httpErr ? 'bad' : ''}"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder=${String(HTTP_PORT)}
                  aria-invalid=${httpErr ? 'true' : 'false'}
                  aria-describedby=${httpErr ? `${HTTP_ERR_ID} ${HTTP_HELP_ID}` : HTTP_HELP_ID}
                />
                ${httpErr ? html`<p class="err-text" id=${HTTP_ERR_ID}>${this.addError}</p>` : nothing}
                <p class="help" id=${HTTP_HELP_ID}>${t('devices.httpPortHelp')}</p>
              </div>
            </div>`
          : nothing
      }
    </div>`;
  }

  private addForm() {
    if (!this.adding) return nothing;
    const httpErr = this.addError !== null && this.addErrorField === 'http';
    const addrErr = this.addError !== null && !httpErr;
    return html`<form class="dd-add" novalidate @submit=${this.onAdd}>
      <div class="field">
        <label for=${ADD_ID}>${t('devices.addLabel')}</label>
        <input
          id=${ADD_ID}
          name="addr"
          class="input mono ${addrErr ? 'bad' : ''}"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder=${t('devices.addPlaceholder')}
          aria-invalid=${addrErr ? 'true' : 'false'}
          aria-describedby=${addrErr ? ADD_ERR_ID : nothing}
        />
        ${addrErr ? html`<p class="err-text" id=${ADD_ERR_ID}>${this.addError}</p>` : nothing}
      </div>
      <div class="row">
        <button class="btn" type="submit" ?disabled=${this.addBusy}>
          ${t('devices.addSubmit')}
        </button>
        <button
          class="btn"
          type="button"
          @click=${() => {
            this.adding = false;
            this.addError = null;
            this.requestUpdate();
          }}
        >
          ${t('devices.addCancel')}
        </button>
      </div>
      ${this.advancedPart(httpErr)}
    </form>`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const app = this.app;
    const s = app.session;
    const rows = this.rows();
    const i = this.currentIndex(rows);
    const cur = rows[i];
    const scanning = app.discovery?.state === 'scanning';
    const probing = s.mode === 'online' && s.state === 'probing';
    const name = s.device?.name ?? '';
    const failed =
      s.mode === 'online' && s.state === 'error' && s.error !== 'cert-mismatch' && !!s.device;
    const blocked = !cur || scanning || probing || !this.canOnline(cur);
    const body = html`${this.top()} ${this.status()}
      <div class="gridwrap framed">
        <table
          class="grid dense"
          role="grid"
          tabindex="0"
          aria-label=${t('devices.table')}
          aria-activedescendant=${i >= 0 ? `dd-row-${i}` : nothing}
          @keydown=${this.onGridKey}
        >
          <thead>
            <tr>
              <th scope="col">${t('devices.col.name')}</th>
              <th scope="col">${t('devices.col.address')}</th>
              <th scope="col">${t('devices.col.runtime')}</th>
              <th scope="col">${t('devices.col.project')}</th>
              <th scope="col">${t('devices.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((r, j) => this.row(r, j, j === i, rows)) : this.emptyRow()}
          </tbody>
        </table>
      </div>
      ${this.details(cur)} ${this.addForm()}
      ${
        failed
          ? html`<p class="err-text" role="alert">
              ${t('devices.onlineError', { name, reason: sessionErrorText(app) })}
            </p>`
          : nothing
      }
      <p class="help">${t('devices.help')}</p>`;
    const foot = html`<button class="btn" type="button" @click=${() => this.openAdd()}>
        ${icon('plus')}${t('devices.add')}
      </button>
      <span class="grow"></span>
      ${
        probing
          ? html`<span class="row" role="status"
              ><span class="spin" aria-hidden="true"></span>${t('devices.probing', { name })}</span
            >`
          : nothing
      }
      <button
        class="btn"
        type="button"
        data-role="upload-compare"
        ?disabled=${blocked}
        title=${t('devices.upload.tip')}
        @click=${() => this.online(cur, 'compare')}
      >
        ${icon('compare')}${t('devices.upload.compare')}
      </button>
      <button
        class="btn"
        type="button"
        data-role="upload-new"
        ?disabled=${blocked}
        title=${t('devices.upload.tip')}
        @click=${() => this.online(cur, 'upload-new')}
      >
        ${icon('upload')}${t('devices.upload')}
      </button>
      <button
        class="btn primary"
        type="button"
        ?disabled=${blocked}
        title=${cur && !this.canOnline(cur) ? t('devices.httpsOffTip') : nothing}
        @click=${() => this.online(cur)}
      >
        ${icon('online')}${t('devices.online')}
      </button>`;
    return this.frame({ title: t('devices.title'), icon: 'device', body, foot, busy: probing });
  }
}

customElements.define('mat-devices-dialog', MatDevicesDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-devices-dialog': MatDevicesDialog;
  }
}
