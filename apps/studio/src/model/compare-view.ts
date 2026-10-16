// Mô hình So sánh của Studio (feature 005, US3, data-model §11, research R15, FR-029, FR-030): hàm thuần dựng
// bảng dòng `= ≠ + -` và ký hiệu cho cây từ `CompareResult`; bộ tự so (`CompareRunner`); và "Đọc lên phần chọn"
// (`applyFromDevice`). Không DOM, không gọi lệnh Tauri; chuỗi giao diện ở i18n.
import {
  compareProjects,
  stripBom,
  type CompareResult,
  type DiffStatus,
  type FieldDiff,
  type LocalSide,
  type ObjectDiff,
  type ObjectKind,
  type ProjectSource,
} from '@mat/project-schema';
import type { DeviceError, Role } from '../platform/device-types.ts';
import { isDeviceError } from '../platform/device-types.ts';
import type { ProjectEdit, ProjectOutline } from './project-doc.ts';
import type { CompareInfo, CompareState } from './device-session.ts';
import type { DownloadDevice } from './download-flow.ts';

// ---------- Bảng dòng ----------

export interface CompareRow {
  /** Ổn định giữa các lần so: giữ dòng đang chọn khi so lại. */
  id: string;
  kind: ObjectKind;
  key: string;
  file: string;
  status: DiffStatus;
  /** Có ở bên nào (`+`: chỉ máy; `-`: chỉ thiết bị; `=`, `≠`: cả hai). */
  presence: { local: boolean; device: boolean };
  fields: FieldDiff[];
  fieldCount: number;
}

export interface CompareFilter {
  status?: DiffStatus | 'all';
  kind?: ObjectKind | 'all';
}

export const rowId = (kind: ObjectKind, key: string): string => `${kind}\u0000${key}`;

/** Các dòng của bảng, theo thứ tự `CompareResult.objects` (theo kind), lọc theo trạng thái và kind. */
export function compareRows(result: CompareResult, filter: CompareFilter = {}): CompareRow[] {
  const { status = 'all', kind = 'all' } = filter;
  return result.objects
    .filter((o) => (status === 'all' || o.status === status) && (kind === 'all' || o.kind === kind))
    .map((o) => ({
      id: rowId(o.kind, o.key),
      kind: o.kind,
      key: o.key,
      file: o.file,
      status: o.status,
      presence: { local: o.status !== '-', device: o.status !== '+' },
      fields: o.fields,
      fieldCount: o.fields.length,
    }));
}

/** Khóa của sự kiện nhấp trong họ binding của compare.ts: `<màn hình>/<item>/<phần tử>/@click` (feature 008). */
const EVENT_KEY = /^([^/]+)\/([^/]+)\/([^/]+)\/@click$/;

/** Dòng là sự kiện nhấp của phần tử SVG (không phải binding động hóa). */
export function isEventRow(row: Pick<CompareRow, 'kind' | 'key'>): boolean {
  return row.kind === 'binding' && EVENT_KEY.test(row.key);
}

/** Màn hình, item `svg` và phần tử của dòng sự kiện nhấp; `null` với dòng khác. */
export function eventTargetOf(
  row: Pick<CompareRow, 'kind' | 'key'>,
): { screen: string; item: string; element: string } | null {
  const m = row.kind === 'binding' ? EVENT_KEY.exec(row.key) : null;
  return m ? { screen: m[1]!, item: m[2]!, element: m[3]! } : null;
}

/** Các kind có trong kết quả, theo thứ tự của `OBJECT_KINDS` (để dựng bộ lọc). */
export function kindsOf(result: CompareResult): ObjectKind[] {
  return [...new Set(result.objects.map((o) => o.kind))];
}

// ---------- Ký hiệu trên cây ----------

/** Gộp ký hiệu của các đối tượng thuộc một nút: giống hết thì `=`, cùng một loại `+`/`-` thì giữ, còn lại `≠`. */
export function aggregate(statuses: readonly DiffStatus[]): DiffStatus | null {
  if (statuses.length === 0) return null;
  const first = statuses[0];
  return statuses.every((s) => s === first) ? first : '≠';
}

/**
 * Nút cây của một đối tượng: thiết lập project → \`settings\`; Tag → \`tags\`; nhóm, kết nối, thiết lập lưu trữ →
 * \`logging\`; màn hình, binding và SVG của màn hình → \`screen:<id>\`. Đối tượng chỉ có trên thiết bị mà máy
 * không có màn hình đó thì không có nút (\`null\`).
 */
export function nodeOf(
  o: ObjectDiff,
  outline: Pick<ProjectOutline, 'screens'> & Partial<Pick<ProjectOutline, 'schema'>>,
): string | null {
  switch (o.kind) {
    case 'project':
      return 'settings';
    case 'tag':
      return 'tags';
    case 'channel':
      return `channel:${o.key}`;
    case 'field-device':
      return `fdev:${o.key}`;
    case 'value-table':
      return `valuetable:${o.key}`;
    case 'watch-table':
      return `watch:${o.key}`;
    case 'logging-settings':
    case 'logging-group':
    case 'logging-connection':
      return 'logging';
    case 'screen':
      return outline.screens.some((s) => s.id === o.key) ? `screen:${o.key}` : null;
    case 'binding': {
      const id = o.key.split('/')[0];
      return outline.screens.some((s) => s.id === id) ? `screen:${id}` : null;
    }
    case 'svg': {
      const s = outline.screens.find(
        (x) =>
          x.screen?.svgFile === o.key ||
          x.model?.items.some((i) => i.type === 'svg' && i.svgFile === o.key),
      );
      return s ? `screen:${s.id}` : null;
    }
    case 'item': {
      const id = o.key.split('/')[0];
      return outline.screens.some((s) => s.id === id) ? `screen:${id}` : null;
    }
    case 'navigation':
      return outline.schema === '0.3' ? 'navigation' : 'settings';
    case 'alarm':
    case 'alarm-area':
      return 'alarmList';
    case 'alarm-class':
      return 'alarmClasses';
  }
}

/** Ký hiệu của từng nút cây có đối tượng (id nút → ký hiệu gộp). Không so được thì rỗng. */
export function treeMarks(
  result: CompareResult | null,
  outline: Pick<ProjectOutline, 'screens'> & Partial<Pick<ProjectOutline, 'schema'>>,
): Map<string, DiffStatus> {
  const marks = new Map<string, DiffStatus>();
  if (!result) return marks;
  const by = new Map<string, DiffStatus[]>();
  for (const o of result.objects) {
    const node = nodeOf(o, outline);
    if (node) by.set(node, [...(by.get(node) ?? []), o.status]);
  }
  for (const [node, list] of by) {
    const s = aggregate(list);
    if (s) marks.set(node, s);
  }
  return marks;
}

/** Viewer chỉ biết khớp hay khác (digest công khai); chưa so thì chưa biết. */
export function briefOf(info: CompareInfo | null): 'match' | 'differ' | 'unknown' {
  return info === null ? 'unknown' : info.same ? 'match' : 'differ';
}

// ---------- Tự so ----------

/** `X-Mat-Base-Digest` khi thiết bị chưa có project (trùng \`NO_BASE\` của Nạp xuống). */
const NO_PROJECT = 'none';

const EMPTY_SOURCE: ProjectSource = { read: async () => ({ error: 'missing' }) };

/** Phần tiêm vào của bộ tự so (bản thật ở \`app/compare-env.ts\`). */
export interface CompareEnv {
  /** Đang Online có đăng nhập (phiên còn hạn). */
  loggedIn(): boolean;
  role(): Role | null;
  /** Digest đang chạy theo \`system/info\` gần nhất: chuỗi, \`none\` khi chưa có project, \`null\` khi chưa biết. */
  deviceDigest(): string | null;
  /** Đổi khi nội dung đã lưu của project đổi (sau mỗi lần Lưu, mở lại, nạp lại từ đĩa). */
  localKey(): string;
  /** Digest, danh sách file và nguồn đọc của nội dung đã lưu; \`null\` khi chưa biết tập file. */
  local(): Promise<LocalSide | null>;
  device: Pick<
    DownloadDevice,
    'info' | 'manifest' | 'fetchPackage' | 'readPackageFile' | 'discardPackage'
  >;
  /** Ghi vào \`DeviceSession.compare\`. */
  publish(patch: Partial<CompareState>): void;
  now(): number;
}

class CodedError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const isFull = (role: Role | null): boolean => role === 'engineer' || role === 'administrator';

const deviceDigestOf = (info: unknown): string | null => {
  const p = (info as { project?: { status?: unknown; digest?: unknown } } | null)?.project;
  if (typeof p?.digest === 'string') return p.digest;
  return p?.status === 'missing' || p === undefined ? NO_PROJECT : null;
};

/**
 * Tự so máy kỹ sư với thiết bị: khi vào Online với role ≥ engineer, sau mỗi lần Lưu, sau mỗi lần nạp xuống (digest
 * của thiết bị đổi). Digest giống thì chỉ cần \`system/info\`; khác thì tải manifest, rồi tải gói nếu có file JSON
 * khác (gói bỏ ngay sau khi so). Viewer không có quyền đọc manifest và gói: chỉ biết khớp hay khác.
 */
export class CompareRunner {
  private readonly env: CompareEnv;
  private lastKey: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** Tăng khi hủy (Offline): kết quả của lần so cũ bị bỏ. */
  private epoch = 0;

  constructor(env: CompareEnv) {
    this.env = env;
  }

  /** Gọi mỗi khi phiên, thiết bị hay project đổi: so lại khi (và chỉ khi) có gì khác lần so trước. */
  sync(): void {
    const env = this.env;
    if (!env.loggedIn()) {
      if (this.lastKey !== null || this.running) {
        this.lastKey = null;
        this.epoch++;
        env.publish({ busy: false, info: null, error: null });
      }
      return;
    }
    const digest = env.deviceDigest();
    if (digest === null) return; // chờ system/info
    const key = [env.role() ?? '', digest, env.localKey()].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    void this.start();
  }

  /** So lại ngay (nút So sánh lại, mở So sánh), dù không có gì đổi. */
  refresh(): Promise<void> {
    if (!this.env.loggedIn()) return Promise.resolve();
    this.lastKey = null;
    return this.start();
  }

  /** Chờ lần so đang chạy (và lần so chờ sau nó) xong. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private start(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = (async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async once(): Promise<void> {
    const env = this.env;
    const epoch = this.epoch;
    const alive = () => epoch === this.epoch && env.loggedIn();
    env.publish({ busy: true, error: null });
    try {
      const local = await env.local();
      if (!local) throw new CodedError('no-project');
      const info = await env.device.info();
      if (isDeviceError(info)) throw new CodedError(info.error);
      const digest = deviceDigestOf(info);
      if (digest === null) throw new CodedError('no-project-package');
      const role = env.role();
      let result: CompareResult | null = null;
      if (isFull(role)) result = await this.full(local, digest);
      if (!alive()) return;
      env.publish({
        busy: false,
        error: null,
        info: {
          at: env.now(),
          localDigest: local.digest,
          deviceDigest: digest,
          same: local.digest === digest,
          result,
        },
      });
    } catch (e) {
      if (!alive()) return;
      env.publish({ busy: false, error: codeOf(e) });
    }
  }

  private async full(local: LocalSide, digest: string): Promise<CompareResult> {
    const device = this.env.device;
    if (digest === NO_PROJECT)
      return compareProjects(local, {
        digest: NO_PROJECT,
        files: async () => [],
        source: async () => EMPTY_SOURCE,
      });
    let fetched: string | null = null;
    try {
      return await compareProjects(local, {
        digest,
        files: async () => {
          const m = await device.manifest();
          if (isDeviceError(m)) throw new CodedError(m.error);
          if (m.digest !== digest) throw new CodedError('changed');
          return m.files;
        },
        source: async () => {
          const p = await device.fetchPackage();
          if (isDeviceError(p)) throw new CodedError(p.error);
          fetched = p.packageId;
          if (p.digest !== digest) throw new CodedError('changed');
          return { read: (rel) => device.readPackageFile(p.packageId, rel) };
        },
      });
    } finally {
      if (fetched !== null) void device.discardPackage(fetched).catch(() => undefined);
    }
  }
}

const codeOf = (e: unknown): string =>
  e instanceof CodedError ? e.code : isDeviceError(e) ? (e as DeviceError).error : 'failed';

// ---------- Đọc lên phần chọn ----------

/** Phần của store mà \`applyFromDevice\` dùng (\`StudioStore\` thỏa). */
export interface ApplyTarget {
  state: { outline: ProjectOutline };
  applyChange(change: {
    edits?: readonly ProjectEdit[];
    replace?: Readonly<Record<string, string>>;
  }): void;
}

export type SkipReason = 'same' | 'local-only' | 'unreadable';

export interface ApplyReport {
  applied: ObjectDiff[];
  skipped: Array<{ object: ObjectDiff; reason: SkipReason }>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

async function readJson(source: ProjectSource, rel: string): Promise<unknown> {
  const r = await source.read(rel);
  if (!('text' in r)) return undefined;
  try {
    return JSON.parse(stripBom(r.text));
  } catch {
    return undefined;
  }
}

/**
 * Lấy các đối tượng đã chọn từ thiết bị vào project đang mở thành MỘT bước sửa chưa lưu (FR-030):
 * - \`project\`, \`tag\`: sửa đối tượng trong \`project.json\`, file Tag qua store (một Tag \`≠\` được thay, một Tag
 *   \`-\` được thêm);
 * - kind khác: thay cả file chứa đối tượng bằng bản của thiết bị ("nội dung chờ ghi"), nên các đối tượng khác của
 *   cùng file cũng theo thiết bị.
 * Dòng \`=\` (đã giống) và \`+\` (chỉ có trên máy: lấy về nghĩa là xóa, không làm) bị bỏ qua kèm lý do.
 */
export async function applyFromDevice(
  target: ApplyTarget,
  device: ProjectSource,
  selection: readonly ObjectDiff[],
): Promise<ApplyReport> {
  const report: ApplyReport = { applied: [], skipped: [] };
  const edits: ProjectEdit[] = [];
  const replace: Record<string, string> = {};
  const outline = target.state.outline;
  const screenDone = new Set<string>();
  let deviceProject: Record<string, unknown> | null | undefined;
  const projectOf = async () => {
    if (deviceProject === undefined) {
      const p = await readJson(device, 'project.json');
      deviceProject = isObject(p) ? p : null;
    }
    return deviceProject;
  };
  for (const o of selection) {
    if (o.status === '=') {
      report.skipped.push({ object: o, reason: 'same' });
      continue;
    }
    if (o.status === '+') {
      report.skipped.push({ object: o, reason: 'local-only' });
      continue;
    }
    if (o.kind === 'project') {
      const dev = await projectOf();
      const local = outline.project as unknown as Record<string, unknown> | null;
      if (!dev || !local) {
        report.skipped.push({ object: o, reason: 'unreadable' });
        continue;
      }
      // Thiết lập project = mọi khóa trừ danh sách màn hình (cấu trúc của máy giữ nguyên).
      const fields: Record<string, unknown> = {};
      // Project 0.3: `navigation` là đối tượng riêng (kind `navigation`), không đi theo thiết lập project.
      const keep = (k: string) =>
        k !== 'screens' && !(outline.schema === '0.3' && k === 'navigation');
      for (const k of Object.keys(local)) if (keep(k)) fields[k] = undefined;
      for (const [k, v] of Object.entries(dev)) if (keep(k)) fields[k] = v;
      edits.push({ kind: 'projectPatch', fields });
      report.applied.push(o);
    } else if (o.kind === 'tag') {
      const dev = await projectOf();
      const tagFile = dev && typeof dev.tagFile === 'string' ? dev.tagFile : null;
      const list = tagFile ? await readJson(device, tagFile) : undefined;
      const tags = isObject(list) && Array.isArray(list.tags) ? (list.tags as unknown[]) : null;
      const tag = tags?.find((t) => isObject(t) && t.id === o.key);
      if (!isObject(tag) || !outline.tags) {
        report.skipped.push({ object: o, reason: 'unreadable' });
        continue;
      }
      const index = (outline.tags.tags as unknown[]).findIndex(
        (t) => isObject(t) && t.id === o.key,
      );
      edits.push(
        index >= 0
          ? { kind: 'tagUpsert', index, tag: tag as never }
          : { kind: 'tagUpsert', tag: tag as never },
      );
      report.applied.push(o);
    } else if (o.kind === 'navigation' && outline.schema === '0.3') {
      const dev = await projectOf();
      const nav = dev?.navigation;
      if (!isObject(nav)) {
        report.skipped.push({ object: o, reason: 'unreadable' });
        continue;
      }
      edits.push({ kind: 'navigation', value: nav as never });
      report.applied.push(o);
    } else if ((o.kind === 'screen' || o.kind === 'item') && outline.schema === '0.3') {
      // Màn hình 0.3 là tài liệu sửa được: lấy cả màn hình của thiết bị (mọi item của nó theo thiết bị).
      const id = o.kind === 'item' ? o.key.split('/')[0]! : o.key;
      const dev = await readJson(device, o.file);
      if (!isObject(dev) || !Array.isArray(dev.items)) {
        report.skipped.push({ object: o, reason: 'unreadable' });
        continue;
      }
      if (!screenDone.has(id)) {
        screenDone.add(id);
        edits.push({ kind: 'screenUpsert', screen: dev as never });
      }
      report.applied.push(o);
    } else {
      const r = await device.read(o.file);
      if (!('text' in r)) {
        report.skipped.push({ object: o, reason: 'unreadable' });
        continue;
      }
      replace[o.file] = r.text;
      report.applied.push(o);
    }
  }
  if (report.applied.length) target.applyChange({ edits, replace });
  return report;
}
