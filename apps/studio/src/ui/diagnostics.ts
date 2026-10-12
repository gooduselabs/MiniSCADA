// Tab Chẩn đoán của inspector (feature 004, T072, FR-029, US3-8, mockup bản 1) và cách hiển thị thông tin
// thiết bị dùng chung cho trang Thiết bị, thanh trạng thái, task card Công cụ online. Số liệu là bản
// /api/v1/system/info mới nhất của phiên thiết bị duy nhất (DeviceSession hỏi lại mỗi 5 s khi theo dõi):
// runtime, giao thức, phiên trên tối đa, project trên thiết bị, lưu trữ và từng DB ngoài. Thông tin thiết bị
// chưa cung cấp (CPU, RAM) hiện "chưa có". Chưa theo dõi thì hiện trạng thái chưa kết nối như trước.
// Feature 005 (US4, FR-032): khi Online có đăng nhập, tab thêm `GET /api/v1/diagnostics` (hỏi mỗi 5 s khi tab mở, do
// `app.diag`): CPU trung bình 1 phút, RAM của runtime và của hệ thống, dung lượng trống, thời gian chạy, số phiên đăng
// nhập, độ lệch giờ so với máy này.
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { StudioApp } from '../app/app.ts';
import { deviceErrorText } from '../app/device-errors.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import type { Diagnostics } from '../model/diagnostics-feed.ts';
import type { SessionErrorCode } from '../model/device-session.ts';
import {
  deviceProject,
  formatBytes,
  type DestinationInfo,
  type DeviceInfo,
  type DeviceProject,
} from '../model/device.ts';
import { icon } from './base.ts';
import './editors/device-page.css';
import { registerDiagnostics, type InspectorView } from './registry.ts';

const LOCALE = 'vi-VN';
const integer = new Intl.NumberFormat(LOCALE);
const decimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/** Số đếm theo kiểu Việt Nam (15.234); không phải số thì "?". */
export const count = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? integer.format(n) : t('device.info.unknown');

const seconds = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? decimal.format(n) : t('device.info.unknown');

const text = (v: unknown): string =>
  typeof v === 'string' && v !== '' ? v : t('device.info.unknown');

/** Gốc URL không kèm `http://` (https giữ nguyên để thấy kết nối mã hóa). */
export const hostOf = (base: string): string => base.replace(/^http:\/\//, '');

/** Địa chỉ đang dùng của phiên, hoặc địa chỉ đã nhập. */
export const sessionHost = (app: StudioApp): string =>
  hostOf(app.session.address ?? app.deviceBase() ?? app.deviceAddress());

const ERROR_TEXT: Readonly<Record<SessionErrorCode, MessageKey>> = {
  timeout: 'device.err.timeout',
  network: 'device.err.network',
  http: 'device.err.httpAny',
  'bad-response': 'device.err.bad-response',
  'invalid-address': 'device.err.invalid-address',
  'live-closed': 'device.err.live-closed',
  // Feature 005 (chế độ online, data-model §6)
  'cert-unpinned': 'device.err.cert-unpinned',
  'cert-mismatch': 'device.err.cert-mismatch',
  tls: 'device.err.tls',
  'auth-required': 'device.err.auth-required',
  'session-expired': 'device.err.session-expired',
  'session-invalid': 'device.err.session-invalid',
  forbidden: 'device.err.forbidden',
  'runtime-old': 'device.err.runtime-old',
  'https-unreachable': 'device.err.https-unreachable',
  'viewer-private': 'device.err.viewer-private',
};

/**
 * Lý do lỗi của phiên, bằng chữ: lỗi gốc của Rust (TLS kèm thông báo, mã lạ…) nếu có, không thì theo mã
 * của phiên (feature 005).
 */
export function sessionErrorText(app: StudioApp): string {
  const s = app.session;
  return s.errorInfo ? deviceErrorText(s.errorInfo) : errorText(s.error);
}

/** Lý do không kết nối được, bằng chữ. `detail` của lỗi HTTP là mã HTTP. */
export function errorText(code: SessionErrorCode | null, detail?: string): string {
  if (code === 'http' && detail) return t('device.err.http', { status: detail });
  return code ? t(ERROR_TEXT[code]) : t('device.err.network');
}

/** Project trên thiết bị so với project đang mở (không có gì để báo thì `null`). */
export function projectText(p: DeviceProject): string | null {
  switch (p.kind) {
    case 'same':
      return t('device.project.same', { id: p.id, version: p.version });
    case 'version':
      return t('device.project.version', { id: p.id, device: p.device, local: p.local });
    case 'other':
      return t('device.project.other', { id: p.id, version: p.version });
    case 'active':
      return t('device.project.active', { id: p.id, version: p.version });
    case 'none':
      return t('device.project.none');
    case 'invalid':
      return t('device.project.invalid');
    default:
      return null;
  }
}

export const projectOf = (app: StudioApp, info: DeviceInfo | null): DeviceProject =>
  deviceProject(info, app.store.state.outline.project);

/** Icon đi kèm trạng thái project (màu không là tín hiệu duy nhất: luôn có chữ). */
export function projectIcon(p: DeviceProject): { icon?: IconName; iconCls?: string } {
  if (p.kind === 'same') return { icon: 'ok', iconCls: 'ok' };
  if (p.kind === 'other' || p.kind === 'version' || p.kind === 'none' || p.kind === 'invalid')
    return { icon: 'warn', iconCls: 'warn' };
  return {};
}

const STORAGE_STATE: Readonly<Record<string, MessageKey>> = {
  running: 'device.storage.state.running',
  clock_invalid: 'device.storage.state.clock_invalid',
  paused_low_disk: 'device.storage.state.paused_low_disk',
  error: 'device.storage.state.error',
};

const VIEWER_ACCESS: Readonly<Record<string, MessageKey>> = {
  private: 'diag.viewer.private',
  any: 'diag.viewer.any',
  off: 'diag.viewer.off',
};

const RETAIN_STATE: Readonly<Record<string, MessageKey>> = {
  ok: 'diag.retain.ok',
  fallback: 'diag.retain.fallback',
  lost: 'diag.retain.lost',
  off: 'diag.retain.off',
};

const DEST_STATE: Readonly<Record<string, MessageKey>> = {
  connecting: 'device.dest.state.connecting',
  ok: 'device.dest.state.ok',
  error: 'device.dest.state.error',
  no_client: 'device.dest.state.no_client',
  no_secret: 'device.dest.state.no_secret',
};

const own = <T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;

/** Trạng thái lưu trữ bằng chữ (mã lạ giữ nguyên). */
export function storageState(state: unknown): string {
  const key = own(STORAGE_STATE, state);
  return key ? t(key) : text(state);
}

export function destState(state: unknown): string {
  const key = own(DEST_STATE, state);
  return key ? t(key) : text(state);
}

/** "{số dòng} dòng · {dung lượng} / {trần}". */
export const storageNote = (h: NonNullable<DeviceInfo['historian']>): string =>
  t('diag.storageNote', {
    rows: count(h.rowsWritten),
    size: formatBytes(h.dbBytes),
    max: formatBytes(h.dbMaxBytes),
  });

/** Một dòng lưu trữ (trang Thiết bị); thiết bị không báo khối lưu trữ (runtime cũ) thì nói rõ. */
export function storageLine(info: DeviceInfo): string {
  const h = info.historian;
  if (!h || typeof h !== 'object') return t('device.storage.unreported');
  if (!h.enabled) return t('device.storage.disabled');
  const line = t('device.storage.summary', {
    state: storageState(h.state),
    rows: count(h.rowsWritten),
    size: formatBytes(h.dbBytes),
    max: formatBytes(h.dbMaxBytes),
  });
  return h.warnings?.length
    ? `${line} · ${t('device.storage.warnings', { codes: h.warnings.join(', ') })}`
    : line;
}

/** "chờ {n} dòng · trễ {s} s" kèm lỗi gần nhất (câu của thiết bị). */
export function destNote(d: DestinationInfo): string {
  const note = t('diag.destNote', { rows: count(d.pendingRows), lag: seconds(d.lagS) });
  const err = d.lastError?.message || d.lastError?.code;
  return err ? `${note} · ${err}` : note;
}

/** Một dòng DB ngoài (trang Thiết bị): "{id}: {trạng thái} · chờ … · trễ …". */
export const destLine = (d: DestinationInfo): string =>
  t('device.dest.line', { id: text(d.id), summary: `${destState(d.state)} · ${destNote(d)}` });

export const destinations = (info: DeviceInfo): DestinationInfo[] =>
  info.historian?.enabled && Array.isArray(info.historian.destinations)
    ? info.historian.destinations.filter((d) => d && typeof d === 'object')
    : [];

/** Thời gian chạy: "3 ngày 4 giờ", "2 giờ 5 phút", "12 phút", "40 giây"; không có thì `null`. */
export function uptimeText(s: unknown): string | null {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return t('diag.uptime.d', { d, h });
  if (h) return t('diag.uptime.h', { h, m });
  if (m) return t('diag.uptime.m', { m });
  return t('diag.uptime.s', { s: Math.floor(s) });
}

/** "{n} / {max}" và tỉ lệ cho thanh (khi có đủ hai số). */
export function sessionsOf(info: DeviceInfo): { text: string; frac?: number } {
  const n = info.clients;
  const max = info.maxClients;
  const ok = typeof n === 'number' && typeof max === 'number' && max > 0;
  return {
    text: t('device.info.ratio', { n: count(n), max: count(max) }),
    frac: ok ? n / max : undefined,
  };
}

/** Thẻ số liệu (mockup `.metric`): nhãn, giá trị, thanh tỉ lệ, ghi chú. */
export function metric(
  label: string,
  value: string,
  opts: { frac?: number; note?: string | null; icon?: IconName; iconCls?: string } = {},
) {
  const frac = opts.frac;
  return html`<div class="metric">
    <span class="l">${label}</span>
    <span class="v dg-v">${opts.icon ? icon(opts.icon, opts.iconCls ?? '') : nothing}${value}</span>
    ${
      frac !== undefined
        ? html`<span class="bar"
            ><i
              style=${styleMap({ width: `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%` })}
            ></i
          ></span>`
        : nothing
    }
    ${opts.note ? html`<span class="n">${opts.note}</span>` : nothing}
  </div>`;
}

const DEST_ICON: Readonly<Record<string, [IconName, string]>> = {
  ok: ['ok', 'ok'],
  error: ['err', 'err'],
  no_client: ['warn', 'warn'],
  no_secret: ['warn', 'warn'],
};

function storageMetric(info: DeviceInfo) {
  const h = info.historian;
  const label = t('diag.storage');
  if (!h || typeof h !== 'object')
    return metric(label, t('device.storage.unreported'), { icon: 'info', iconCls: 'info' });
  if (!h.enabled) return metric(label, t('device.storage.disabled'));
  const max = h.dbMaxBytes;
  const warn = h.warnings?.length
    ? ` · ${t('device.storage.warnings', { codes: h.warnings.join(', ') })}`
    : '';
  // Lỗi lưu trữ gần nhất trên thiết bị (disk_full, io, corrupt_recovered): câu của thiết bị.
  const lastError = h.lastError?.message || h.lastError?.code;
  return metric(label, storageState(h.state), {
    icon: h.state === 'running' ? 'ok' : 'warn',
    iconCls: h.state === 'running' ? 'ok' : 'warn',
    frac:
      typeof h.dbBytes === 'number' && typeof max === 'number' && max > 0
        ? h.dbBytes / max
        : undefined,
    note: storageNote(h) + warn + (lastError ? ` · ${lastError}` : ''),
  });
}

const percent = (n: number): string => decimal.format(n);
const load = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Độ lệch giờ lớn hơn mức này thì cảnh báo. */
const SKEW_WARN_MS = 5000;

/** "+3,2 s" khi thiết bị đi trước máy này, "-1 s" khi đi sau. */
export function skewText(ms: number): string {
  const s = decimal.format(Math.abs(ms) / 1000);
  return t(ms >= 0 ? 'diag.clock.ahead' : 'diag.clock.behind', { s });
}

/** Các thẻ của chẩn đoán đầy đủ (device-api §6); `null` khi chưa hỏi được lần nào. */
function liveMetrics(d: Diagnostics, skewMs: number | null) {
  const usedFrac = (free: number, total: number) => (total > 0 ? 1 - free / total : undefined);
  const dropped = d.discovery
    ? d.discovery.dropped.subnet +
      d.discovery.dropped.format +
      d.discovery.dropped.rate +
      d.discovery.dropped.port
    : 0;
  const warnClock = !d.timeSynced || (skewMs !== null && Math.abs(skewMs) > SKEW_WARN_MS);
  const clockNote = !d.timeSynced
    ? t('diag.clock.unsynced')
    : skewMs !== null && Math.abs(skewMs) > SKEW_WARN_MS
      ? t('diag.clock.big')
      : t('diag.clock.synced');
  const stamp = (ms: number | null): string =>
    ms === null ? '' : new Date(ms).toLocaleTimeString(LOCALE);
  const viewer = d.viewer
    ? metric(
        t('diag.viewer'),
        t(own(VIEWER_ACCESS, d.viewer.access) ?? 'diag.viewer.other', { access: d.viewer.access }),
        {
          icon: d.viewer.access === 'any' ? 'warn' : 'ok',
          iconCls: d.viewer.access === 'any' ? 'warn' : 'ok',
          note:
            d.viewer.lastBlockedAt === null
              ? t('diag.viewer.blocked', { n: count(d.viewer.blockedTotal) })
              : t('diag.viewer.blockedAt', {
                  n: count(d.viewer.blockedTotal),
                  time: stamp(d.viewer.lastBlockedAt),
                }),
        },
      )
    : null;
  const tags = d.tags
    ? metric(t('diag.tags'), t('diag.tags.value', { total: count(d.tags.total) }), {
        icon: d.tags.bad > 0 ? 'warn' : 'ok',
        iconCls: d.tags.bad > 0 ? 'warn' : 'ok',
        frac: d.tags.total > 0 ? d.tags.good / d.tags.total : undefined,
        note: t('diag.tags.note', {
          good: count(d.tags.good),
          uncertain: count(d.tags.uncertain),
          bad: count(d.tags.bad),
        }),
      })
    : null;
  const retain = d.retain
    ? metric(
        t('diag.retain'),
        t(own(RETAIN_STATE, d.retain.state) ?? 'diag.retain.other', { state: d.retain.state }),
        {
          ...(d.retain.state === 'off'
            ? {}
            : {
                icon:
                  d.retain.state === 'ok'
                    ? ('ok' as const)
                    : d.retain.state === 'lost'
                      ? ('err' as const)
                      : ('warn' as const),
                iconCls:
                  d.retain.state === 'ok' ? 'ok' : d.retain.state === 'lost' ? 'err' : 'warn',
              }),
          note:
            d.retain.state === 'off'
              ? null
              : d.retain.lastSaveAt === null
                ? t('diag.retain.note0', {
                    tags: count(d.retain.tags),
                    saves: count(d.retain.saves),
                  })
                : t('diag.retain.note', {
                    tags: count(d.retain.tags),
                    saves: count(d.retain.saves),
                    time: stamp(d.retain.lastSaveAt),
                  }),
        },
      )
    : null;
  return {
    viewer,
    tags,
    retain,
    cpu: metric(
      t('diag.cpu'),
      t('diag.cpu.value', {
        system: percent(d.cpu.systemPct1m),
        runtime: percent(d.cpu.runtimePct1m),
      }),
      {
        frac: d.cpu.systemPct1m / 100,
        note: t('diag.cpu.note', { load: load.format(d.cpu.loadAvg1), cores: d.cpu.cores }),
      },
    ),
    ramRuntime: metric(t('diag.ramRuntime'), formatBytes(d.memory.runtimeRssBytes), {
      note: t('diag.ramRuntime.note'),
    }),
    ramSystem: metric(
      t('diag.ramSystem'),
      t('diag.ramSystem.value', { total: formatBytes(d.memory.systemTotalBytes) }),
      {
        frac: usedFrac(d.memory.systemAvailableBytes, d.memory.systemTotalBytes),
        note: t('diag.ramSystem.note', {
          free: formatBytes(d.memory.systemAvailableBytes),
          pct: percent(
            Math.round(
              (usedFrac(d.memory.systemAvailableBytes, d.memory.systemTotalBytes) ?? 0) * 1000,
            ) / 10,
          ),
        }),
      },
    ),
    disk: d.disk
      ? metric(
          t('diag.disk'),
          t('diag.disk.value', {
            free: formatBytes(d.disk.freeBytes),
            total: formatBytes(d.disk.totalBytes),
          }),
          {
            frac: usedFrac(d.disk.freeBytes, d.disk.totalBytes),
            note: t('diag.disk.note', { path: d.disk.path }),
          },
        )
      : metric(t('diag.disk'), t('diag.disk.unknown'), { icon: 'warn', iconCls: 'warn' }),
    logins: metric(t('diag.logins'), count(d.clients.sessions), { note: t('diag.logins.note') }),
    clock: metric(
      t('diag.clock'),
      skewMs === null
        ? t('device.info.unknown')
        : t('diag.clock.value', { skew: skewText(skewMs) }),
      {
        icon: warnClock ? 'warn' : 'ok',
        iconCls: warnClock ? 'warn' : 'ok',
        note: clockNote,
      },
    ),
    discovery: d.discovery
      ? metric(
          t('diag.discovery'),
          d.discovery.enabled
            ? t('diag.discovery.value', { replies: count(d.discovery.replies) })
            : t('diag.discovery.off'),
          {
            note: d.discovery.enabled
              ? t('diag.discovery.note', {
                  dropped: count(dropped),
                  format: count(d.discovery.dropped.format),
                  subnet: count(d.discovery.dropped.subnet),
                  rate: count(d.discovery.dropped.rate),
                  port: count(d.discovery.dropped.port),
                })
              : null,
          },
        )
      : null,
  };
}

function offlineView(app: StudioApp): InspectorView {
  const s = app.session;
  const reason =
    s.state === 'error'
      ? sessionErrorText(app)
      : s.state === 'incompatible'
        ? t('device.err.incompatible')
        : null;
  return {
    ctx: t('insp.ctx.offline'),
    body: html`<div class="empty">
      ${icon('pulse', 'lg')}<b>${t('insp.diag.offTitle')}</b>
      <p>${t('insp.diag.offText')}</p>
      ${reason ? html`<p class="err-text">${icon('err', 'err')} ${t('diag.lastError', { reason })}</p>` : nothing}
      <button class="btn" type="button" @click=${() => void app.run('online.connect')}>
        ${icon('online')}${t('cmd.online.connect')}
      </button>
    </div>`,
  };
}

function diagView(app: StudioApp): InspectorView {
  const s = app.session;
  if (!app.online()) return offlineView(app);
  // Thiết bị đã lưu (feature 005) có tên riêng; theo dõi theo địa chỉ thì "BL335".
  const name = s.device?.name ?? t('tree.device');
  const info = s.info;
  if (!info)
    return {
      ctx: t('diag.ctx.waiting', { name }),
      body: html`<div class="empty">
        <span class="spin" aria-hidden="true"></span>
        <p>${t('diag.connecting', { address: sessionHost(app) })}</p>
      </div>`,
    };
  const time = s.infoAt === null ? '' : new Date(s.infoAt).toLocaleTimeString(LOCALE);
  const stale = s.state !== 'monitoring';
  const ctx =
    s.state === 'monitoring'
      ? t('diag.ctx.monitoring', { name, time })
      : s.state === 'full'
        ? t('diag.ctx.full', { name, time })
        : s.state === 'connecting'
          ? t('diag.ctx.connecting', { name, time })
          : t('diag.ctx.stale', { name, time });
  const sessions = sessionsOf(info);
  const project = projectOf(app, info);
  const dg = app.diag?.state ?? null;
  const live = dg?.data ? liveMetrics(dg.data, dg.skewMs) : null;
  const uptime = uptimeText(dg?.data ? dg.data.uptime.runtimeS : info.uptimeS);
  const systemUptime = dg?.data ? uptimeText(dg.data.uptime.systemS) : null;
  const notYet = t('diag.notYet');
  const notYetNote = t('diag.notYetNote');
  return {
    ctx,
    body: html`<div class="diag ${stale ? 'dg-stale' : ''}">
        ${metric(t('diag.runtime'), text(info.runtimeVersion), {
          note: t('diag.protocol', { version: text(info.protocolVersion) }),
        })}
        ${metric(t('diag.sessions'), sessions.text, {
          frac: sessions.frac,
          note: stale ? null : t('diag.sessionsNote'),
        })}
        ${metric(
          t('diag.project'),
          projectText(project) ?? t('device.info.unknown'),
          projectIcon(project),
        )}
        ${metric(t('diag.uptime'), uptime ?? notYet, {
          note: systemUptime ? t('diag.uptime.note', { uptime: systemUptime }) : null,
        })}
        ${live ? live.cpu : metric(t('diag.cpu'), notYet, { note: notYetNote })}
        ${live ? live.ramRuntime : metric(t('diag.ram'), notYet, { note: notYetNote })}
        ${live ? live.ramSystem : nothing} ${live ? live.disk : nothing}
        ${live ? live.logins : nothing} ${live ? live.clock : nothing}
        ${live ? live.viewer : nothing} ${live ? live.tags : nothing}
        ${live ? live.retain : nothing} ${live ? live.discovery : nothing} ${storageMetric(info)}
        ${destinations(info).map((d) => {
          const [ic, cls] = own(DEST_ICON, d.state) ?? ['info', 'info'];
          return metric(t('diag.dest', { id: text(d.id) }), destState(d.state), {
            icon: ic,
            iconCls: cls,
            note: destNote(d),
          });
        })}
      </div>
      ${
        dg?.error
          ? html`<p class="err-text pad" data-role="diag-error">
              ${t('diag.fetchError', {
                reason:
                  dg.error === 'forbidden'
                    ? t('diag.fetchError.forbidden')
                    : deviceErrorText({ error: dg.error }),
              })}
            </p>`
          : nothing
      }
      ${
        s.infoError
          ? html`<p class="err-text pad">
              ${t('diag.pollError', { reason: errorText(s.infoError) })}
            </p>`
          : nothing
      }`,
  };
}

registerDiagnostics(diagView);
