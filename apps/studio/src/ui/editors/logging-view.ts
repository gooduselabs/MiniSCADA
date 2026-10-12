// Editor Lưu trữ, chỉ đọc (feature 004, US4, T077, FR-026; mockup bản 1, renderLogging): cấu hình lưu dữ
// liệu của feature 003 mà không phải mở file JSON.
// - Từng nhóm: tên, mã, chế độ, chu kỳ hoặc khoảng ghi, Tag và deadband, thời hạn, đích gửi.
// - Từng kết nối DB ngoài: loại, máy chủ, bảng, TLS; không bao giờ hiện mật khẩu (che cả khi lỡ nằm
//   trong URL).
// - Ước tính ghi eMMC bằng đúng hàm của bộ kiểm tra (`estimateLogging`, Constitution II).
// - Lỗi và cảnh báo ngay cạnh mục.
// Chọn nhóm → lựa chọn `group` (inspector, Details). Nhận vị trí lỗi bằng `takeReveal('logging')`.
// Nội dung đọc từ cấu trúc project (outlineOf), kể cả khi file còn lỗi: mọi trường kiểm kiểu trước khi
// hiện, và chỉ đi vào giao diện qua binding của Lit. Editor sửa lưu trữ có ở GĐ 5.
import {
  defaultColumnName,
  defaultTableName,
  estimateLogging,
  LOG_BUDGET_BYTES,
  type Issue,
  type LoggingEstimate,
  type TagDataType,
  type WarningCode,
} from '@mat/project-schema';
import { html, nothing, type PropertyValues } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { locate, severityOf, type Location } from '../../model/issue-map.ts';
import type { ProjectOutline } from '../../model/project-doc.ts';
import { AppElement, icon } from '../base.ts';
import { prow } from '../mat-inspector.ts';
import { registerEditor, registerProps } from '../registry.ts';
import './logging-view.css';

// ---------- Đọc an toàn dữ liệu project (có thể sai kiểu khi file còn lỗi) ----------

type Rec = Readonly<Record<string, unknown>>;
const EMPTY: Rec = {};
const isObject = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const has = (table: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

const DASH = '—';
const MASK = '•••';
/** Mặc định của `minIntervalMs` (specs/003-data-logging/data-model.md §1), như `estimateLogging`. */
const DEFAULT_MIN_INTERVAL_MS = 1000;
/** Mặc định của `timeZone` (specs/003-data-logging/data-model.md §1). */
const DEFAULT_TIME_ZONE = '+07:00';

// ---------- Định dạng ----------

const SIG3 = new Intl.NumberFormat('vi-VN', { maximumSignificantDigits: 3 });
const PCT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6, useGrouping: false });

/** Khoảng thời gian: 100 ms, 1,5 s, 60 s, 5 phút, 1 giờ. */
function formatDuration(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0)
    return t('logging.dur.h', { n: PLAIN.format(ms / 3_600_000) });
  if (ms > 60_000 && ms % 60_000 === 0)
    return t('logging.dur.min', { n: PLAIN.format(ms / 60_000) });
  if (ms >= 1000) return t('logging.dur.s', { n: PLAIN.format(ms / 1000) });
  return t('logging.dur.ms', { n: PLAIN.format(ms) });
}

/** Dung lượng theo đơn vị thập phân, 3 chữ số có nghĩa (như câu cảnh báo của bộ kiểm tra: GB = 10⁹). */
function formatBytes(n: number): string {
  if (n >= 1e9) return t('logging.size.gb', { n: SIG3.format(n / 1e9) });
  if (n >= 1e6) return t('logging.size.mb', { n: SIG3.format(n / 1e6) });
  if (n >= 1e3) return t('logging.size.kb', { n: SIG3.format(n / 1e3) });
  return t('logging.size.b', { n: SIG3.format(n) });
}

/** Phần trăm của ngân sách 2 GiB (LOG_BUDGET_BYTES, cùng hằng số với bộ kiểm tra). */
const budgetPercent = (bytes: number): number => (bytes / LOG_BUDGET_BYTES) * 100;
const formatPercent = (p: number): string =>
  p > 0 && p < 0.1
    ? t('logging.pctTiny', { n: PCT.format(0.1) })
    : t('logging.pct', { n: PCT.format(p) });

/**
 * Địa chỉ để hiện (máy chủ SQL, URL InfluxDB): che tài khoản, mật khẩu (`user:pass@`) và phần truy vấn
 * hay fragment (có thể chứa token). Project không được chứa bí mật (E_LOG_SECRET) nhưng file viết tay có
 * thể lỡ để; giao diện không bao giờ hiện lại. Che rộng tay: tới dấu `@` cuối cùng, kể cả khi mật khẩu có
 * `/`; dấu `?`/`#` đứng trước dấu `@` (không rõ ranh giới) thì che hết phần sau scheme.
 */
export function maskAddress(address: string): string {
  const start = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(address)?.[0].length ?? 0;
  const head = address.slice(0, start);
  const rest = address.slice(start);
  const at = rest.lastIndexOf('@');
  const query = rest.search(/[?#]/);
  if (query >= 0 && at > query) return head + MASK;
  let out = at >= 0 ? MASK + rest.slice(at) : rest;
  const q = out.search(/[?#]/);
  if (q >= 0) out = out.slice(0, q + 1) + MASK;
  return head + out;
}

// ---------- Mô hình hiển thị ----------

interface TagRow {
  index: number;
  tagId: string;
  column: string;
  deadband?: number;
  maxLength?: number;
}

interface GroupRow {
  index: number;
  id: string;
  name: string;
  modeLabel: string;
  cyclic: boolean;
  onChange: boolean;
  /** Dạng ngắn cho bảng: "60 s", "1 s – 60 s". */
  interval: string;
  /** Dạng câu cho inspector. */
  intervalLong: string;
  days?: number;
  destinations: string[];
  /** Bảng ở DB ngoài (`table`, hoặc suy ra từ `id` như bộ kiểm tra). */
  table?: string;
  tags: TagRow[];
}

function groupRow(raw: unknown, index: number): GroupRow {
  const g = isObject(raw) ? raw : EMPTY;
  const id = text(g.id);
  const cyclic = g.mode === 'cyclic';
  const onChange = g.mode === 'onChange';
  let interval = DASH;
  let intervalLong = DASH;
  if (cyclic) {
    const period = num(g.periodMs);
    if (period !== undefined) {
      interval = formatDuration(period);
      intervalLong = t('logging.props.cyclic', { period: interval });
    }
  } else if (onChange) {
    const min = formatDuration(num(g.minIntervalMs) ?? DEFAULT_MIN_INTERVAL_MS);
    const maxMs = num(g.maxIntervalMs);
    if (maxMs !== undefined) {
      const max = formatDuration(maxMs);
      interval = t('logging.interval.range', { min, max });
      intervalLong = t('logging.props.onChangeMax', { min, max });
    } else {
      interval = t('logging.interval.atLeast', { min });
      intervalLong = t('logging.props.onChange', { min });
    }
  }
  const tags = list(g.tags).map((x, j): TagRow => {
    const tag = isObject(x) ? x : EMPTY;
    const tagId = typeof tag.tagId === 'string' ? tag.tagId : '';
    return {
      index: j,
      tagId,
      column: text(tag.column) ?? (tagId ? defaultColumnName(tagId) : DASH),
      deadband: num(tag.deadband),
      maxLength: num(tag.maxLength),
    };
  });
  return {
    index,
    id: id ?? DASH,
    name: text(g.name) ?? id ?? t('logging.group.unnamed', { n: index + 1 }),
    modeLabel: cyclic
      ? t('logging.mode.cyclic')
      : onChange
        ? t('logging.mode.onChange')
        : (text(g.mode) ?? DASH),
    cyclic,
    onChange,
    interval,
    intervalLong,
    days: num(g.retentionDays),
    destinations: list(g.destinations).filter((d): d is string => typeof d === 'string'),
    table: text(g.table) ?? (id ? defaultTableName(id) : undefined),
    tags,
  };
}

const CONN_TYPE: Readonly<Record<string, MessageKey>> = {
  mysql: 'logging.connType.mysql',
  mssql: 'logging.connType.mssql',
  postgresql: 'logging.connType.postgresql',
  influxdb: 'logging.connType.influxdb',
};

const TLS_TEXT: Readonly<Record<string, MessageKey>> = {
  'verify-full': 'logging.tls.verifyFull',
  require: 'logging.tls.require',
  prefer: 'logging.tls.prefer',
  disable: 'logging.tls.disable',
};

/** Máy chủ: SQL `host:port/database`, InfluxDB `url · org · bucket`; tài khoản trong địa chỉ bị che. */
function serverOf(c: Rec): { text: string; masked: boolean } {
  if (c.type === 'influxdb') {
    const url = text(c.url);
    const shown = url === undefined ? DASH : maskAddress(url);
    return {
      text: t('logging.server.influx', {
        url: shown,
        org: text(c.org) ?? DASH,
        bucket: text(c.bucket) ?? DASH,
      }),
      masked: url !== undefined && shown !== url,
    };
  }
  const host = text(c.host);
  const port = num(c.port);
  const shown = host === undefined ? DASH : maskAddress(host);
  // IPv6 kèm cổng: [fe80::1]:5432
  let address =
    port !== undefined && shown.includes(':') && !shown.startsWith('[') ? `[${shown}]` : shown;
  if (port !== undefined) address += `:${port}`;
  const database = text(c.database);
  return {
    text: database === undefined ? address : `${address}/${database}`,
    masked: host !== undefined && shown !== host,
  };
}

/** Bảng ở DB ngoài mà kết nối nhận: bảng của các nhóm gửi tới nó (schema nếu khai báo). */
function tablesOf(c: Rec, groups: readonly GroupRow[]): string[] {
  const id = c.id;
  if (typeof id !== 'string') return [];
  const schema = c.type === 'postgresql' || c.type === 'mssql' ? text(c.schema) : undefined;
  return groups
    .filter((g) => g.table !== undefined && g.destinations.includes(id))
    .map((g) => (schema ? `${schema}.${g.table}` : g.table!));
}

/**
 * Chế độ TLS: SQL thiếu `tls` là `verify-full` (mặc định, Constitution V); InfluxDB thiếu `tls` thì theo
 * scheme của URL (specs/003-data-logging/data-model.md §1).
 */
function tlsOf(c: Rec): { mode: string; raw: boolean; desc: string } {
  const tls = text(c.tls);
  if (c.type === 'influxdb' && tls === undefined) {
    const url = text(c.url) ?? '';
    const scheme = url.startsWith('https://') ? 'https' : url.startsWith('http://') ? 'http' : null;
    if (!scheme) return { mode: DASH, raw: false, desc: '' };
    return {
      mode: t('logging.tls.byUrl', { scheme }),
      raw: false,
      desc: t(scheme === 'https' ? 'logging.tls.verifyFull' : 'logging.tls.disable'),
    };
  }
  const mode = tls ?? 'verify-full';
  return {
    mode: tls === undefined ? t('logging.tls.default', { mode }) : mode,
    raw: tls !== undefined,
    desc: has(TLS_TEXT, mode) ? t(TLS_TEXT[mode]) : '',
  };
}

// ---------- Lỗi và cảnh báo theo mục ----------

interface IssueBuckets {
  /** Cả file (kể cả không đọc được) và `/loggingFile` của project.json. */
  file: Issue[];
  groups: Map<number, Issue[]>;
  /** Khóa `nhóm:Tag`. */
  tags: Map<string, Issue[]>;
  conns: Map<number, Issue[]>;
  /** File lưu trữ còn lỗi (E_): bộ kiểm tra chưa xét ngân sách ghi. */
  hasErrors: boolean;
}

const TAG_PATH = /^\/groups\/(\d+)\/tags\/(\d+)(?:\/|$)/;

function push<K>(map: Map<K, Issue[]>, key: K, issue: Issue): void {
  map.set(key, [...(map.get(key) ?? []), issue]);
}

/** Chia lỗi của file lưu trữ theo mục, dùng cùng ánh xạ với tab Thông tin (issue-map). */
function bucketIssues(issues: readonly Issue[], outline: ProjectOutline): IssueBuckets {
  const out: IssueBuckets = {
    file: [],
    groups: new Map(),
    tags: new Map(),
    conns: new Map(),
    hasErrors: false,
  };
  const file = outline.loggingFile;
  for (const issue of issues) {
    if (issue.file === 'project.json' && issue.path === '/loggingFile') {
      out.file.push(issue);
      continue;
    }
    if (file === null || issue.file !== file) continue;
    if (severityOf(issue) === 'error') out.hasErrors = true;
    const loc = locate(issue, outline);
    if (loc.editor === 'logging' && loc.group !== undefined) {
      push(out.groups, loc.group, issue);
      const m = TAG_PATH.exec(issue.path);
      if (m) push(out.tags, `${m[1]}:${m[2]}`, issue);
    } else if (loc.editor === 'logging' && loc.connection !== undefined) {
      push(out.conns, loc.connection, issue);
    } else out.file.push(issue);
  }
  return out;
}

const BUDGET: ReadonlySet<string> = new Set<WarningCode>(['W_LOG_WRITE_BUDGET', 'W_LOG_SIZE_CAP']);
/** Lỗi làm bộ kiểm tra không nạp được file Tag (nên không ước tính). */
const TAG_LOAD_ERRORS: ReadonlySet<string> = new Set(['E_JSON', 'E_FILE_MISSING', 'E_SCHEMA']);

type EstimateState =
  { kind: 'ok'; estimate: LoggingEstimate } | { kind: 'blocked' } | { kind: 'noTags' };

/** Kiểu của Tag theo file Tag đọc được; `null` khi chưa đọc được file Tag. */
function tagTypes(outline: ProjectOutline): Map<string, TagDataType> | null {
  if (!outline.tags) return null;
  const types = new Map<string, TagDataType>();
  for (const tag of list(outline.tags.tags))
    if (isObject(tag) && typeof tag.id === 'string' && typeof tag.type === 'string')
      if (!types.has(tag.id)) types.set(tag.id, tag.type as TagDataType);
  return types;
}

/**
 * Ước tính ghi eMMC bằng đúng hàm của bộ kiểm tra. Như bộ kiểm tra, chỉ ước tính khi file lưu trữ không
 * còn lỗi và file Tag nạp được.
 */
function estimateOf(
  outline: ProjectOutline,
  issues: readonly Issue[],
  buckets: IssueBuckets,
  types: Map<string, TagDataType> | null,
): EstimateState {
  if (!outline.logging || buckets.hasErrors) return { kind: 'blocked' };
  const tagsBroken = issues.some(
    (i) =>
      (i.file === outline.tagFile && TAG_LOAD_ERRORS.has(i.code)) ||
      (i.file === 'project.json' && i.path === '/tagFile'),
  );
  if (!types || tagsBroken) return { kind: 'noTags' };
  try {
    const estimate = estimateLogging(outline.logging, types);
    return Number.isFinite(estimate.writeBytesPerDay) && Number.isFinite(estimate.storageBytes)
      ? { kind: 'ok', estimate }
      : { kind: 'blocked' };
  } catch {
    return { kind: 'blocked' }; // hình dạng sai: bộ kiểm tra sẽ báo E_SCHEMA
  }
}

// ---------- Mẩu giao diện dùng chung ----------

const sevIcon = (issue: Issue) => {
  const err = severityOf(issue) === 'error';
  return icon(err ? 'err' : 'warn', err ? 'err' : 'warn');
};

/** Một lỗi hoặc cảnh báo: icon, chữ mức (cho trình đọc màn hình), mã, lý do. */
const issueLine = (issue: Issue) =>
  html`<div class="lv-issue-line" data-code=${issue.code}>
    ${sevIcon(issue)}<span class="visually-hidden"
      >${severityOf(issue) === 'error' ? t('logging.issue.error') : t('logging.issue.warning')}</span
    >
    <span class="mono code">${issue.code}</span>
    <span>${issue.message}</span>
  </div>`;

/** Số lỗi, cảnh báo của một mục: icon kèm chữ (màu không là tín hiệu duy nhất, FR-012). */
function issueChips(issues: readonly Issue[]) {
  const errors = issues.filter((i) => severityOf(i) === 'error').length;
  const warnings = issues.length - errors;
  return html`${
    errors
      ? html` <span class="chip err"
          >${icon('err', 'err')}${t('logging.issues.errors', { n: errors })}</span
        >`
      : nothing
  }${
    warnings
      ? html` <span class="chip warn"
          >${icon('warn', 'warn')}${t('logging.issues.warnings', { n: warnings })}</span
        >`
      : nothing
  }`;
}

/** Dòng phụ ngay dưới mục: chi tiết lỗi và cảnh báo. */
const issueRow = (key: string, issues: readonly Issue[], span: number) =>
  html`<tr class="lv-issue" data-issues=${key}>
    <td colspan=${span}>
      <div class="lv-lines">${issues.map(issueLine)}</div>
    </td>
  </tr>`;

// ---------- Editor ----------

type Revealed = { kind: 'group' | 'conn'; index: number } | { kind: 'file' };

export class LoggingView extends AppElement {
  /** Mục mà vị trí lỗi trỏ tới (tô viền tới khi người dùng thao tác). */
  private revealed: Revealed | null = null;
  /** Bộ chọn phần tử cần focus sau lần vẽ tới. */
  private focusTarget: string | null = null;

  private readonly clearReveal = (): void => {
    if (!this.revealed) return;
    this.revealed = null;
    this.requestUpdate();
  };

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const loc = this.app.takeReveal('logging');
    if (loc) this.reveal(loc);
    this.ensureGroupSelected();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!this.focusTarget) return;
    const target = this.querySelector<HTMLElement>(this.focusTarget);
    this.focusTarget = null;
    target?.scrollIntoView?.({ block: 'nearest' });
    target?.focus();
  }

  /** Vị trí lỗi (tab Thông tin) hay "Dùng ở đâu": chọn nhóm, hoặc tô dòng kết nối, hoặc cả file. */
  private reveal(loc: Location): void {
    if (loc.editor !== 'logging') return;
    const groups = list(this.app.store.state.outline.logging?.groups).length;
    if (loc.group !== undefined && loc.group < groups) {
      this.revealed = { kind: 'group', index: loc.group };
      this.focusTarget = `tr[data-group="${loc.group}"]`;
      this.app.select({ kind: 'group', index: loc.group });
    } else if (loc.connection !== undefined) {
      this.revealed = { kind: 'conn', index: loc.connection };
      this.focusTarget = `tr[data-conn="${loc.connection}"]`;
    } else {
      this.revealed = { kind: 'file' };
      this.focusTarget = '[data-reveal="file"]';
    }
  }

  /** Editor đang mở luôn có một nhóm đang chọn (như mockup): bảng Tag và inspector theo nhóm đó. */
  private ensureGroupSelected(): void {
    const s = this.app.store.state;
    if (s.active !== 'logging') return;
    const count = list(s.outline.logging?.groups).length;
    const sel = s.selection;
    if (!count || (sel?.kind === 'group' && sel.index >= 0 && sel.index < count)) return;
    this.app.select({ kind: 'group', index: 0 });
  }

  private selectGroup(index: number, focus: boolean): void {
    this.revealed = null;
    if (focus) this.focusTarget = `tr[data-group="${index}"]`;
    this.app.select({ kind: 'group', index });
  }

  /** Lưới nhóm (mẫu ARIA grid, chọn theo dòng): ↑ ↓ Home End chọn và chuyển focus; Enter, Space chọn. */
  private onGroupKey(e: KeyboardEvent, index: number, count: number): void {
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(count - 1, index + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    else if (e.key === 'Enter' || e.key === ' ') next = index;
    else return;
    e.preventDefault();
    this.selectGroup(next, true);
  }

  // ---------- Vẽ ----------

  private head(file: string | null) {
    return html`<div class="ed-head">
      <h2>${t('tree.logging')}</h2>
      ${file ? html`<span class="path">${file}</span>` : nothing}
      <span class="grow"></span>
      <span class="chip" title=${t('logging.readonlyTip')}
        >${icon('lock')}${t('logging.readonly')}</span
      >
      ${this.app.workspace.showPhases ? html`<span class="phase">${t('logging.phaseChip')}</span>` : nothing}
    </div>`;
  }

  private estimatePanel(
    state: EstimateState,
    budgetIssues: readonly Issue[],
    files: { logging: string; tags: string },
  ) {
    const budget = t('logging.size.gib', { n: SIG3.format(LOG_BUDGET_BYTES / 1024 ** 3) });
    const lines = (code: WarningCode) => budgetIssues.filter((i) => i.code === code).map(issueLine);
    if (state.kind !== 'ok')
      return html`<section
        class="banner lv-est"
        aria-label=${t('logging.est.label')}
        tabindex="-1"
        data-reveal="file"
      >
        <div class="row"><b>${t('logging.est.label')}</b></div>
        <p class="help">
          ${
            state.kind === 'noTags'
              ? t('logging.est.noTags', { file: files.tags })
              : t('logging.est.blocked', { file: files.logging })
          }
        </p>
        ${budgetIssues.map(issueLine)}
      </section>`;
    const e = state.estimate;
    const line = (
      key: 'write' | 'storage',
      bytes: number,
      label: unknown,
      value: string,
      code: WarningCode,
    ) => {
      const pct = budgetPercent(bytes);
      return html`<div class="row">
          ${label}<span class="grow"></span>
          <data class="num" data-est=${key} value=${String(bytes)}>${value}</data>
        </div>
        <span class="bar ${e.warnings.includes(code) ? 'over' : ''}" data-est-bar=${key}
          ><i style=${styleMap({ width: `${Math.min(100, pct)}%` })}></i
        ></span>
        ${lines(code)}`;
    };
    return html`<section
      class="banner lv-est"
      aria-label=${t('logging.est.label')}
      tabindex="-1"
      data-reveal="file"
    >
      ${line(
        'write',
        e.writeBytesPerDay,
        html`<b>${t('logging.est.label')}</b>`,
        t('logging.est.write', {
          value: formatBytes(e.writeBytesPerDay),
          pct: formatPercent(budgetPercent(e.writeBytesPerDay)),
          budget,
        }),
        'W_LOG_WRITE_BUDGET',
      )}
      ${line(
        'storage',
        e.storageBytes,
        html`<span>${t('logging.est.storageLabel')}</span>`,
        t('logging.est.storage', {
          value: formatBytes(e.storageBytes),
          pct: formatPercent(budgetPercent(e.storageBytes)),
          budget,
        }),
        'W_LOG_SIZE_CAP',
      )}
      <p class="help">${t('logging.est.help')}</p>
    </section>`;
  }

  private groupsTable(groups: readonly GroupRow[], current: number, buckets: IssueBuckets) {
    const cols: readonly MessageKey[] = [
      'logging.col.group',
      'logging.col.mode',
      'logging.col.interval',
      'logging.col.tags',
      'logging.col.retention',
      'logging.col.destinations',
    ];
    return html`<table
      class="grid dense"
      data-table="groups"
      role="grid"
      aria-readonly="true"
      aria-label=${t('logging.groups')}
    >
      <thead>
        <tr>
          ${cols.map((c) => html`<th scope="col">${t(c)}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${groups.map((g) => {
          const issues = buckets.groups.get(g.index) ?? [];
          const selected = g.index === current;
          const revealed = this.revealed?.kind === 'group' && this.revealed.index === g.index;
          return html`<tr
              data-group=${g.index}
              class="${selected ? 'rsel' : ''} ${revealed ? 'lv-revealed' : ''}"
              aria-selected=${selected ? 'true' : 'false'}
              tabindex=${selected ? 0 : -1}
              @click=${() => this.selectGroup(g.index, false)}
              @keydown=${(e: KeyboardEvent) => this.onGroupKey(e, g.index, groups.length)}
            >
              <td><b>${g.name}</b> <span class="muted mono">${g.id}</span>${issueChips(issues)}</td>
              <td>${g.modeLabel}</td>
              <td class="num">${g.interval}</td>
              <td class="r">${g.tags.length}</td>
              <td class="num">${g.days === undefined ? DASH : t('logging.days', { n: g.days })}</td>
              <td>
                ${
                  g.destinations.length
                    ? html`<span class="mono">${g.destinations.join(', ')}</span>`
                    : html`<span class="muted">${t('logging.localOnly')}</span>`
                }
              </td>
            </tr>
            ${issues.length ? issueRow(`group:${g.index}`, issues, cols.length) : nothing}`;
        })}
      </tbody>
    </table>`;
  }

  private tagsTable(
    g: GroupRow,
    title: string,
    types: Map<string, TagDataType> | null,
    buckets: IssueBuckets,
  ) {
    const cols: readonly MessageKey[] = [
      'logging.col.tag',
      'logging.col.type',
      'logging.col.column',
      'logging.col.deadband',
      'logging.col.when',
    ];
    const when = (tag: TagRow): string =>
      g.cyclic
        ? t('logging.when.cycle')
        : g.onChange
          ? t((tag.deadband ?? 0) > 0 ? 'logging.when.deadband' : 'logging.when.change')
          : DASH;
    const deadband = (tag: TagRow): string =>
      tag.deadband === undefined
        ? DASH
        : g.cyclic
          ? t('logging.deadband.unused', { value: PLAIN.format(tag.deadband) })
          : PLAIN.format(tag.deadband);
    const type = (tag: TagRow) => {
      if (!types) return DASH;
      const ty = types.get(tag.tagId);
      if (!ty) return html`<span class="muted">${t('logging.type.unknown')}</span>`;
      return tag.maxLength === undefined
        ? ty
        : t('logging.type.maxLength', { type: ty, n: tag.maxLength });
    };
    return html`<table class="grid dense" data-table="tags" aria-label=${title}>
      <thead>
        <tr>
          ${cols.map((c) => html`<th scope="col">${t(c)}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${g.tags.map((tag) => {
          const issues = buckets.tags.get(`${g.index}:${tag.index}`) ?? [];
          return html`<tr data-tag=${tag.index}>
            <td>
              <span class="mono">${tag.tagId || DASH}</span>${issues.map(
                (i) =>
                  html` <span
                    class="chip ${severityOf(i) === 'error' ? 'err' : 'warn'}"
                    title=${i.message}
                    >${sevIcon(i)}${i.code}</span
                  >`,
              )}
            </td>
            <td>${type(tag)}</td>
            <td class="mono">${tag.column}</td>
            <td class="num">${deadband(tag)}</td>
            <td class="muted">${when(tag)}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private connectionsTable(
    conns: readonly unknown[],
    groups: readonly GroupRow[],
    buckets: IssueBuckets,
  ) {
    const cols: readonly MessageKey[] = [
      'logging.col.conn',
      'logging.col.connType',
      'logging.col.server',
      'logging.col.tables',
      'logging.col.tls',
    ];
    return html`<table class="grid dense" data-table="connections" aria-label=${t('logging.conns')}>
      <thead>
        <tr>
          ${cols.map((c) => html`<th scope="col">${t(c)}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${conns.map((raw, i) => {
          const c = isObject(raw) ? raw : EMPTY;
          const issues = buckets.conns.get(i) ?? [];
          const type =
            typeof c.type === 'string' && has(CONN_TYPE, c.type)
              ? t(CONN_TYPE[c.type])
              : (text(c.type) ?? DASH);
          const server = serverOf(c);
          const tables = tablesOf(c, groups);
          const tls = tlsOf(c);
          const revealed = this.revealed?.kind === 'conn' && this.revealed.index === i;
          return html`<tr data-conn=${i} tabindex="-1" class=${revealed ? 'lv-revealed' : ''}>
              <td><span class="mono">${text(c.id) ?? DASH}</span>${issueChips(issues)}</td>
              <td>${type}</td>
              <td class="mono" title=${server.masked ? t('logging.server.masked') : nothing}>
                ${server.text}
              </td>
              <td>
                ${
                  tables.length
                    ? html`<span class="mono">${tables.join(', ')}</span>`
                    : html`<span class="muted">${t('logging.tables.none')}</span>`
                }
              </td>
              <td>
                <span class=${tls.raw ? 'mono' : ''}>${tls.mode}</span>${
                  tls.desc ? html`<span class="muted"> · ${tls.desc}</span>` : nothing
                }
              </td>
            </tr>
            ${issues.length ? issueRow(`conn:${i}`, issues, cols.length) : nothing}`;
        })}
      </tbody>
    </table>`;
  }

  private body() {
    const s = this.app.store.state;
    const outline = s.outline;
    const file = outline.loggingFile;
    if (!outline.project)
      return html`<div class="empty lv-empty">
        ${icon('err', 'lg err')}<b>${t('logging.noProject.title')}</b>
        <p>${t('logging.noProject.text')}</p>
      </div>`;
    if (file === null)
      return html`<div class="empty lv-empty">
        ${icon('db', 'lg')}<b>${t('logging.none.title')}</b>
        <p>${t('logging.none.text')}</p>
        <p class="help">${t('logging.none.doc')}</p>
      </div>`;
    const buckets = bucketIssues(s.issues, outline);
    const cfg = outline.logging;
    if (!cfg)
      return html`<div class="empty lv-empty" tabindex="-1" data-reveal="file">
        ${icon('err', 'lg err')}<b>${t('logging.unreadable.title', { file })}</b>
        <p>${t('logging.unreadable.text')}</p>
        <div class="lv-lines">${buckets.file.map(issueLine)}</div>
      </div>`;

    const groups = list(cfg.groups).map(groupRow);
    const sel = s.selection;
    const current =
      sel?.kind === 'group' && sel.index >= 0 && sel.index < groups.length ? sel.index : 0;
    const shown = groups[current];
    const types = tagTypes(outline);
    const conns = list(cfg.connections);
    const budgetIssues = buckets.file.filter((i) => BUDGET.has(i.code));
    const fileIssues = buckets.file.filter((i) => !BUDGET.has(i.code));
    const fileHasError = fileIssues.some((i) => severityOf(i) === 'error');
    const tz = text(cfg.timeZone);
    const tagsTitle = shown ? t('logging.tags.title', { name: shown.name }) : '';
    return html`<p class="banner lv-note">
        ${icon('info', 'info')}<span>${t('logging.note', { file })}</span>
      </p>
      ${
        fileIssues.length
          ? html`<div
              class="banner ${fileHasError ? 'err' : 'warn'} lv-file-issues"
              tabindex="-1"
              data-reveal="file"
            >
              <div class="lv-lines grow">
                <b>${t('logging.fileIssues')}</b>${fileIssues.map(issueLine)}
              </div>
            </div>`
          : nothing
      }
      ${this.estimatePanel(estimateOf(outline, s.issues, buckets, types), budgetIssues, {
        logging: file,
        tags: outline.tagFile,
      })}
      <div class="lv-body">
        <h3 class="lv-sub">
          ${t('logging.groups')}
          <span class="cnt">${t('logging.groups.count', { n: groups.length })}</span>
        </h3>
        <div class="gridwrap lv-frame">${this.groupsTable(groups, current, buckets)}</div>
        <p class="help">
          ${
            tz
              ? t('logging.timeZone', { tz })
              : t('logging.timeZoneDefault', { tz: DEFAULT_TIME_ZONE })
          }
        </p>
        ${
          shown
            ? html`<h3 class="lv-sub" data-heading="tags">${tagsTitle}</h3>
                <div class="gridwrap lv-frame" tabindex="0" role="region" aria-label=${tagsTitle}>
                  ${this.tagsTable(shown, tagsTitle, types, buckets)}
                </div>`
            : nothing
        }
        <h3 class="lv-sub">${t('logging.conns')}</h3>
        ${
          conns.length
            ? html`<div
                class="gridwrap lv-frame"
                tabindex="0"
                role="region"
                aria-label=${t('logging.conns')}
              >
                ${this.connectionsTable(conns, groups, buckets)}
              </div>`
            : html`<p class="help lv-noconn">${t('logging.conns.none')}</p>`
        }
        <p class="help">${t('logging.secrets')}</p>
      </div>`;
  }

  protected override render() {
    if (!this.app.store.state.project) return nothing;
    return html`<div class="ed lv" @pointerdown=${this.clearReveal} @keydown=${this.clearReveal}>
      ${this.head(this.app.store.state.outline.loggingFile)} ${this.body()}
    </div>`;
  }
}

customElements.define('mat-logging-view', LoggingView);

registerEditor({
  match: (id) => id === 'logging',
  render: (app) => html`<mat-logging-view .app=${app}></mat-logging-view>`,
});

/** Inspector › Thuộc tính của nhóm lưu trữ đang chọn (FR-006, mockup bản 1). */
registerProps((app: StudioApp) => {
  const s = app.store.state;
  const sel = s.selection;
  if (sel?.kind !== 'group') return null;
  const raw = list(s.outline.logging?.groups)[sel.index];
  if (raw === undefined) return null;
  const g = groupRow(raw, sel.index);
  const sends = g.destinations.length > 0;
  return {
    ctx: t('logging.props.ctx', { name: g.name }),
    body: html`${prow(t('logging.props.id'), g.id, { mono: true })}
    ${prow(t('logging.props.mode'), g.modeLabel)}
    ${prow(t('logging.props.interval'), g.intervalLong)}
    ${prow(t('logging.props.tags'), String(g.tags.length))}
    ${prow(
      t('logging.props.retention'),
      g.days === undefined ? DASH : t('logging.props.retentionValue', { n: g.days }),
    )}
    ${prow(
      t('logging.props.destinations'),
      sends ? g.destinations.join(', ') : t('logging.localOnly'),
      { mono: sends },
    )}
    ${prow(
      t('logging.props.table'),
      sends && g.table ? t('logging.props.tableValue', { table: g.table }) : DASH,
    )}`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-logging-view': LoggingView;
  }
}
