// Trang Chẩn đoán driver (feature 006, T198, FR-051, FR-029, R22; mockup studio-tags.html v-diag): cây kênh › thiết bị trường có
// trạng thái; số đếm của thiết bị đang chọn kèm phần tăng thêm từ lúc mở trang (US5-4); chu kỳ thực cạnh chu kỳ đặt, dấu quá tải
// (US5-3); Tag xấu kèm lý do tiếng Việt, nhấp đúp tới Bảng Tag (US5-5). Hỏi `GET /api/v1/drivers/diagnostics` mỗi 2 s chỉ khi
// trang đang mở và đang Online có đăng nhập (role viewer trở lên); nguồn dữ liệu ở model/driver-diag.ts. Kênh Siemens S7
// (feature 016): PDU và TSAP đã thương lượng ở thông tin kênh, lỗi PLC theo tên S7 thay cho exception Modbus.
import { html, nothing, type PropertyValues } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import {
  badTagLine,
  channelKindOf,
  counterRows,
  exceptionLabel,
  groupRows,
  opcuaDetailRows,
  type DiagChannelView,
  type DiagDeviceView,
  type DriverDiag,
} from '../../model/driver-diag.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './driver-diagnostics.css';

const LOCALE = 'vi-VN';
const NUMBER = new Intl.NumberFormat(LOCALE, { useGrouping: true, maximumFractionDigits: 0 });
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Nút đang chọn trên cây theo StudioApp: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, { channel: string; device: string | null }>();

const TONE: Readonly<Record<string, string>> = {
  connected: 'ok',
  active: 'ok',
  connecting: 'info',
  error: 'err',
  suspended: 'warn',
  disabled: 'info',
};

const stateText = (state: string): string => {
  const key = `dd.state.${state}`;
  return hasKey(key) ? t(key) : state || t('dd.state.unknown');
};

const kindText = (kind: string): string => {
  const key = `dd.kind.${kind}`;
  return hasKey(key) ? t(key) : kind;
};

interface TreeRow {
  channel: DiagChannelView;
  device: DiagDeviceView | null;
}

export class DriverDiagnostics extends AppElement {
  static override properties = { sel: { state: true } };

  declare sel: { channel: string; device: string | null } | null;

  constructor() {
    super();
    this.sel = null;
  }

  // ---------- Vòng đời: hỏi khi trang mở ----------

  /** Có thể hỏi thiết bị: Online có đăng nhập, phiên đang theo dõi. */
  private canRun(): boolean {
    const s = this.app.session;
    return this.app.online() && s.mode === 'online' && s.auth !== null && s.state === 'monitoring';
  }

  private sync(): void {
    const feed = this.app.driverDiag;
    if (!feed) return;
    if (this.canRun() && !feed.active) feed.start();
    else if (!this.canRun() && feed.active) feed.stop();
  }

  protected override attached(): void {
    this.sel = memory.get(this.app) ?? null;
    this.sync();
    this.requestUpdate();
  }

  protected override detached(): void {
    this.app.driverDiag?.stop();
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.sync();
  }

  // ---------- Dữ liệu ----------

  private rows(data: DriverDiag): TreeRow[] {
    const out: TreeRow[] = [];
    for (const channel of data.channels) {
      out.push({ channel, device: null });
      for (const device of channel.devices) out.push({ channel, device });
    }
    return out;
  }

  /** Nút đang chọn: theo lần chọn trước nếu còn, không thì thiết bị trường đầu tiên (hoặc kênh đầu). */
  private current(data: DriverDiag): TreeRow | null {
    const rows = this.rows(data);
    if (!rows.length) return null;
    const s = this.sel;
    const found = s
      ? rows.find((r) => r.channel.id === s.channel && (r.device?.id ?? null) === s.device)
      : undefined;
    return found ?? rows.find((r) => r.device !== null) ?? rows[0]!;
  }

  private select(row: TreeRow): void {
    const sel = { channel: row.channel.id, device: row.device?.id ?? null };
    memory.set(this.app, sel);
    this.sel = sel;
  }

  private openTag(id: string): void {
    const tags = (this.app.store.state.outline.tags?.tags ?? []) as unknown as { id?: string }[];
    const at = tags.findIndex((x) => x.id === id);
    if (at < 0) {
      this.app.toast(t('dd.bad.notInProject', { id }));
      return;
    }
    this.app.revealTag(at);
  }

  // ---------- Vẽ ----------

  private chip(state: string) {
    return html`<span class="chip ${TONE[state] ?? 'info'}">${stateText(state)}</span>`;
  }

  private onTreeKey = (e: KeyboardEvent, rows: TreeRow[], cur: TreeRow): void => {
    const i = rows.indexOf(cur);
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else return;
    e.preventDefault();
    this.select(rows[next]!);
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')?.focus(),
    );
  };

  private tree(data: DriverDiag, cur: TreeRow) {
    const rows = this.rows(data);
    return html`<ul
      class="dd-tree"
      role="tree"
      aria-label=${t('dd.tree')}
      @keydown=${(e: KeyboardEvent) => this.onTreeKey(e, rows, cur)}
    >
      ${data.channels.map(
        (c) =>
          html`<li role="none">
            ${this.treeItem({ channel: c, device: null }, cur)}
            <ul role="group">
              ${c.devices.map((d) => html`<li role="none">${this.treeItem({ channel: c, device: d }, cur)}</li>`)}
            </ul>
          </li>`,
      )}
    </ul>`;
  }

  private treeItem(row: TreeRow, cur: TreeRow) {
    const selected =
      row.channel.id === cur.channel.id && (row.device?.id ?? null) === (cur.device?.id ?? null);
    const dev = row.device;
    const state = dev ? dev.state : row.channel.state;
    return html`<div
      role="treeitem"
      class="dd-node ${dev ? 'dev' : 'chan'} ${selected ? 'sel' : ''}"
      aria-level=${dev ? 2 : 1}
      aria-selected=${selected ? 'true' : 'false'}
      aria-expanded=${dev ? nothing : 'true'}
      tabindex=${selected ? 0 : -1}
      @click=${() => this.select(row)}
    >
      ${icon(dev ? 'device' : 'connection')}
      <span class="dd-name">${dev ? dev.name : row.channel.name}</span>
      <span class="muted dd-kind">${dev ? '' : kindText(row.channel.kind)}</span>
      ${this.chip(state)}
    </div>`;
  }

  private counters(d: DiagDeviceView, data: DriverDiag) {
    const base = this.app.driverDiag?.state.baseline;
    const baseDev = base?.channels.flatMap((c) => c.devices).find((x) => x.id === d.id);
    const rows = counterRows(d, baseDev);
    // feature 017: kênh MC đếm theo end code, hiện hex kèm nghĩa
    const kind = channelKindOf(data, d.id);
    const label = (key: string): string =>
      key.startsWith('exception:')
        ? exceptionLabel(key.slice(10), kind)
        : t(`dd.row.${key}` as MessageKey);
    const total = (key: string, v: string): string =>
      key === 'requestsOk' || key === 'timeouts' || key.startsWith('exception:')
        ? NUMBER.format(Number(v))
        : v;
    return html`<section class="dd-card" aria-label=${t('dd.counters', { name: d.name })}>
      <h3>${t('dd.counters', { name: d.name })}</h3>
      <table class="dd-table" data-role="counters" aria-label=${t('dd.counters', { name: d.name })}>
        <thead>
          <tr>
            <th scope="col">${t('dd.col.item')}</th>
            <th scope="col" class="num">${t('dd.col.total')}</th>
            <th scope="col" class="num">${t('dd.col.delta')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr data-row=${r.key}>
                <td>${label(r.key)}</td>
                <td class="num dd-total mono">${total(r.key, r.total)}</td>
                <td class="num dd-delta mono">
                  ${r.delta === null ? '—' : `+${NUMBER.format(r.delta)}`}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </section>`;
  }

  private groups(d: DiagDeviceView) {
    const rows = groupRows(d);
    return html`<section class="dd-card" aria-label=${t('dd.groups')}>
      <h3>${t('dd.groups')}</h3>
      ${
        rows.length
          ? html`<table class="dd-table" data-role="groups" aria-label=${t('dd.groups')}>
              <thead>
                <tr>
                  <th scope="col">${t('dd.col.group')}</th>
                  <th scope="col" class="num">${t('dd.col.set')}</th>
                  <th scope="col" class="num">${t('dd.col.actual')}</th>
                  <th scope="col">${t('dd.col.overload')}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (g) =>
                    html`<tr data-group=${g.group}>
                      <td class="mono">${g.group}</td>
                      <td class="num dd-set mono">${NUMBER.format(g.periodMs)} ms</td>
                      <td class="num dd-actual mono">
                        ${NUMBER.format(g.avgMs)} / ${NUMBER.format(g.maxMs)} ms
                      </td>
                      <td class="dd-over">
                        ${
                          g.overloaded
                            ? html`<span class="chip err"
                                  >${icon('warn', 'warn')}${t('dd.overloaded')}</span
                                >
                                <span class="muted"
                                  >${t('dd.overloadTimes', { n: g.overruns })}</span
                                >`
                            : '—'
                        }
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p class="help">${t('dd.groups.none')}</p>`
      }
    </section>`;
  }

  private channelInfo(c: DiagChannelView) {
    const le = c.lastError;
    const det = c.details;
    return html`<section class="dd-card" data-role="channel-info" aria-label=${c.name}>
      <h3>${c.name} ${this.chip(c.state)}</h3>
      <ul class="dd-facts">
        <li>${kindText(c.kind)}</li>
        ${det?.pduSize ? html`<li data-role="pdu">${t('dd.channel.pdu', { n: det.pduSize })}</li>` : nothing}
        ${det?.localTsap || det?.remoteTsap ? html`<li class="mono" data-role="tsap">${t('dd.channel.tsap', { local: det.localTsap ?? '—', remote: det.remoteTsap ?? '—' })}</li>` : nothing}
        ${opcuaDetailRows(c.details).map(
          (r) =>
            html`<li
              data-role="ua-${r.key}"
              class=${r.key.endsWith('Sha256') || r.key === 'endpointUrl' ? 'mono dd-wrap' : ''}
            >
              ${t(`dd.ua.${r.key}` as MessageKey)}: ${r.value}
            </li>`,
        )}
        <li>${t('dd.channel.reconnects', { n: c.reconnects })}</li>
        <li>
          ${
            le
              ? t('dd.channel.lastError', {
                  code: le.code,
                  device: le.device || '—',
                  time: clock(le.at),
                })
              : t('dd.channel.noError')
          }
        </li>
        ${c.warnings.length ? html`<li class="warn-text">${t('dd.channel.warnings', { codes: c.warnings.join(', ') })}</li>` : nothing}
      </ul>
    </section>`;
  }

  private badTags(data: DriverDiag) {
    const lines = data.badTags.map(badTagLine);
    return html`<section class="dd-card" aria-label=${t('dd.bad')}>
      <h3>${t('dd.bad')} <span class="cnt">${lines.length}</span></h3>
      ${
        lines.length
          ? html`<table class="dd-table" data-role="bad-tags" aria-label=${t('dd.bad')}>
                <thead>
                  <tr>
                    <th scope="col">${t('dd.col.tag')}</th>
                    <th scope="col">${t('dd.col.quality')}</th>
                    <th scope="col">${t('dd.col.reason')}</th>
                    <th scope="col" class="num">${t('dd.col.at')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${lines.map(
                    (b, i) =>
                      html`<tr
                        data-tag=${b.id}
                        tabindex=${i === 0 ? 0 : -1}
                        title=${t('dd.bad.open')}
                        @dblclick=${() => this.openTag(b.id)}
                        @keydown=${(e: KeyboardEvent) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            this.openTag(b.id);
                          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            const rows = [
                              ...(e.currentTarget as HTMLElement).parentElement!.children,
                            ] as HTMLElement[];
                            rows[
                              Math.max(
                                0,
                                Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)),
                              )
                            ]?.focus();
                          }
                        }}
                      >
                        <td class="mono">${b.id}</td>
                        <td>
                          <span class="chip ${b.quality === 'BAD' ? 'err' : 'warn'}"
                            >${b.quality}</span
                          >
                        </td>
                        <td>${b.reason}</td>
                        <td class="num mono">${clock(b.at)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
              <p class="help">
                ${t('dd.bad.open')}${data.badTagsTruncated ? ` · ${t('dd.bad.truncated')}` : ''}
              </p>`
          : html`<p class="help">${t('dd.bad.none')}</p>`
      }
    </section>`;
  }

  private needsOnline() {
    const app = this.app;
    return html`<div class="ed ed-fill">
      <div class="empty" data-role="needs-online">
        ${icon('pulse', 'lg')}<b>${t('dd.needsOnline.title')}</b>
        <p>${t('dd.needsOnline.text')}</p>
        <button
          class="btn"
          type="button"
          data-act="online"
          @click=${() => void app.run('online.connect')}
        >
          ${icon('online')}${t('cmd.online.connect')}
        </button>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const feed = app.driverDiag;
    if (!feed || !this.canRun()) return this.needsOnline();
    const st = feed.state;
    const data = st.data;
    const err = st.error
      ? html`<p class="err-text dd-error" data-role="error" role="alert">
          ${icon('err', 'err')}
          ${
            st.error === 'forbidden'
              ? t('dd.error.forbidden')
              : t('dd.error', { reason: deviceErrorText({ error: st.error }) })
          }
        </p>`
      : nothing;
    if (!data)
      return html`<div class="ed ed-fill dd">
        <div class="ed-head"><h2>${t('dd.title')}</h2></div>
        ${err}
        ${
          st.error
            ? nothing
            : html`<div class="empty">
                <span class="spin" aria-hidden="true"></span>
                <p>${t('dd.waiting')}</p>
              </div>`
        }
      </div>`;
    const cur = this.current(data);
    const overloaded = data.channels
      .flatMap((c) => c.devices)
      .filter((d) => d.groups.some((g) => g.overloaded)).length;
    return html`<div class="ed ed-fill dd">
      <div class="ed-head">
        <h2>${t('dd.title')}</h2>
        <span class="grow"></span>
        <span class="help" data-role="updated"
          >${st.receivedAt === null ? '' : t('dd.updated', { time: clock(st.receivedAt) })}</span
        >
        ${overloaded ? html`<span class="chip err">${icon('warn', 'warn')}${t('dd.overloadedDevices', { n: overloaded })}</span>` : nothing}
        <button
          class="tbtn"
          type="button"
          data-act="rebase"
          title=${t('dd.rebaseTip')}
          @click=${() => app.driverDiag?.rebaseline()}
        >
          ${icon('refresh')}<span>${t('dd.rebase')}</span>
        </button>
      </div>
      ${err}
      ${
        !cur
          ? html`<div class="empty">${icon('connection', 'lg')}<b>${t('dd.noChannels')}</b></div>`
          : html`<div class="dd-body">
              <nav class="dd-nav">${this.tree(data, cur)}</nav>
              <div class="dd-main">
                ${cur.device ? html`${this.counters(cur.device, data)} ${this.groups(cur.device)}` : this.channelInfo(cur.channel)}
                ${this.badTags(data)}
              </div>
            </div>`
      }
    </div>`;
  }
}

customElements.define('mat-driver-diagnostics', DriverDiagnostics);

registerEditor({
  match: (id) => id === 'driverDiag',
  render: (app) => html`<mat-driver-diagnostics .app=${app}></mat-driver-diagnostics>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-driver-diagnostics': DriverDiagnostics;
  }
}
