// So sánh project trên máy kỹ sư với project đang chạy trên thiết bị (specs/005-device-online/research.md R15,
// data-model.md §11, FR-029). Hàm thuần, đọc nội dung qua `ProjectSource` như bộ kiểm tra dùng chung: Studio dựng
// nguồn đọc từ tài liệu đã lưu (bên máy) và từ gói đọc lên (`package_read`, bên thiết bị).
//
//  1. Theo file: hợp tập đường dẫn của hai bên (như `files[]` của manifest). Cùng SHA-256 là `=`, khác là `≠`,
//     chỉ trên máy là `+`, chỉ trên thiết bị là `-`. Hai digest bằng nhau thì mọi thứ `=`: không lấy manifest
//     hay gói của thiết bị (chỉ cần `system/info`).
//  2. Theo đối tượng, chỉ cho file `≠`, `+`, `-`: nội dung của thiết bị chỉ được đọc cho file JSON `≠`, `-` (file `=`
//     đọc bản trên máy, giống từng byte), nên gói chỉ cần tải khi `deviceReads()` khác rỗng. SVG chỉ so SHA-256.
//
// Đối tượng so theo khóa, không theo vị trí, nên chỉ đổi thứ tự (Tag, nhóm, phần tử…) thì đối tượng vẫn `=` dù
// file `≠`. Đối tượng `=` vẫn có trong danh sách để bảng và cây hiện đủ.
import { SUPPORTED_SCHEMA, SUPPORTED_SCHEMA_02 } from './codes.ts';
import { migrate01to02 } from './migrate.ts';
import { compareUtf8, type PackageFile } from './package-digest.ts';
import { isSafeRelPath, MemorySource, stripBom, type ProjectSource } from './source.ts';

/** `+` chỉ có trên máy, `-` chỉ có trên thiết bị. */
export type DiffStatus = '=' | '≠' | '+' | '-';

/**
 * Loại đối tượng (data-model §11), cộng `logging-settings`: phần chung của file lưu trữ (`timeZone`…), ngoài nhóm
 * và kết nối.
 */
export type ObjectKind =
  | 'project'
  | 'tag'
  | 'channel'
  | 'field-device'
  | 'value-table'
  | 'watch-table'
  | 'logging-settings'
  | 'logging-group'
  | 'logging-connection'
  | 'screen'
  | 'item'
  | 'navigation'
  | 'svg'
  | 'binding';

/** Thứ tự của `CompareResult.objects` theo kind. */
export const OBJECT_KINDS: readonly ObjectKind[] = [
  'project',
  'navigation',
  'tag',
  'channel',
  'field-device',
  'value-table',
  'watch-table',
  'logging-settings',
  'logging-group',
  'logging-connection',
  'screen',
  'item',
  'svg',
  'binding',
];

export interface FileDiff {
  path: string;
  status: DiffStatus;
  localSha256?: string;
  deviceSha256?: string;
  /**
   * Bên có file này nhưng không đọc được, hoặc không phải JSON đúng dạng: cả họ đối tượng của file (Tag; lưu trữ;
   * một màn hình; binding của một màn hình; cả project nếu là `project.json`) không được so, ở cả hai bên.
   */
  unreadable?: 'local' | 'device';
}

/**
 * Khác biệt của một trường. `path` là JSON pointer tính từ đối tượng; trong tập có khóa (Tag của nhóm theo
 * `tagId`, phần tử của màn hình theo `elementUid`) phần tử được chỉ bằng khóa thay vì chỉ số, ví dụ
 * `/tags/TANK01.LEVEL/deadband`. Thiếu `local` hoặc `device`: trường chỉ có ở bên kia. Mảng giá trị đơn
 * (`viewBox`, `destinations`) là một trường.
 */
export interface FieldDiff {
  path: string;
  local?: unknown;
  device?: unknown;
}

export interface ObjectDiff {
  kind: ObjectKind;
  /**
   * `project` (thiết lập project), `logging` (thiết lập chung của lưu trữ), id của Tag, nhóm, kết nối, màn hình;
   * đường dẫn của SVG; `<màn hình>/<elementUid>/<binding.id>` của binding.
   */
  key: string;
  /** File chứa đối tượng trên máy; chỉ có trên thiết bị thì là file của thiết bị. */
  file: string;
  status: DiffStatus;
  /** Chỉ có phần tử khi `≠`. SVG `≠`: `/sha256`, và `/size` nếu khác. */
  fields: FieldDiff[];
}

export interface CompareResult {
  localDigest: string;
  deviceDigest: string;
  /** Hai digest bằng nhau. */
  same: boolean;
  /** Theo đường dẫn, sắp theo byte UTF-8 như manifest. */
  files: FileDiff[];
  /** Theo kind (`OBJECT_KINDS`); trong một kind: theo thứ tự trên máy, rồi đối tượng chỉ có trên thiết bị. */
  objects: ObjectDiff[];
  /**
   * Project trên thiết bị là 0.1 còn trên máy là 0.2: đối tượng của thiết bị được nâng cấp trong bộ nhớ (`migrate01to02`)
   * trước khi so; file vẫn so theo SHA-256 thật. Chỉ có khi đã nâng cấp.
   */
  deviceMigrated?: true;
}

/** Bên máy kỹ sư: digest, danh sách file (`files[]` của manifest) và nội dung. */
export interface LocalSide {
  digest: string;
  files: readonly PackageFile[];
  source: ProjectSource;
}

/**
 * Bên thiết bị: digest có sẵn (`system/info`). Danh sách file (`GET /api/v1/project/manifest`) chỉ được lấy khi hai
 * digest khác; nội dung (gói đọc lên) chỉ khi có file JSON `≠` hoặc `-`. Lỗi khi lấy (mạng, phiên…) làm phép so bị
 * từ chối.
 */
export interface DeviceSide {
  digest: string;
  files(): Promise<readonly PackageFile[]>;
  source(): Promise<ProjectSource>;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
/** Giá trị của khóa riêng (không đọc nhầm thuộc tính của Object.prototype như `constructor`). */
const own = (o: Record<string, unknown>, k: string): unknown => (hasOwn(o, k) ? o[k] : undefined);
const isScalar = (v: unknown): boolean => v === null || typeof v !== 'object';
const isJson = (path: string): boolean => path.endsWith('.json');
const isSvg = (path: string): boolean => path.endsWith('.svg');
const escape = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1');
const unescape = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');
const omit = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

function byPath(files: readonly PackageFile[], side: string): Map<string, PackageFile> {
  const out = new Map<string, PackageFile>();
  for (const f of files) {
    if (out.has(f.path)) throw new Error(`Đường dẫn trùng trong danh sách file ${side}: ${f.path}`);
    out.set(f.path, f);
  }
  return out;
}

/** Bước 1: so theo SHA-256 từng file. Đường dẫn trùng trong một bên là lỗi lập trình (ném lỗi). */
export function compareFiles(
  local: readonly PackageFile[],
  device: readonly PackageFile[],
): FileDiff[] {
  const l = byPath(local, 'trên máy');
  const d = byPath(device, 'của thiết bị');
  const paths = [...new Set([...l.keys(), ...d.keys()])].sort(compareUtf8);
  return paths.map((path) => {
    const a = l.get(path);
    const b = d.get(path);
    const status: DiffStatus = !b ? '+' : !a ? '-' : a.sha256 === b.sha256 ? '=' : '≠';
    const out: FileDiff = { path, status };
    if (a) out.localSha256 = a.sha256;
    if (b) out.deviceSha256 = b.sha256;
    return out;
  });
}

/** File của thiết bị cần đọc nội dung để so theo đối tượng: JSON `≠` hoặc `-`. Rỗng thì không cần tải gói. */
export function deviceReads(files: readonly FileDiff[]): string[] {
  return files
    .filter((f) => (f.status === '≠' || f.status === '-') && isJson(f.path))
    .map((f) => f.path);
}

// ---------- Đọc một bên ----------

type Parsed = { ok: true; value: unknown } | { ok: false };

/** Đọc và parse JSON một lần mỗi file; ghi lại file có trong danh sách mà không đọc được hoặc sai dạng. */
class Reader {
  readonly failed = new Set<string>();
  private readonly cache = new Map<string, Promise<Parsed>>();
  private readonly source: ProjectSource | null;
  private readonly listed: ReadonlySet<string>;
  /** File `=` của bên thiết bị: đọc bản trên máy (giống từng byte). */
  private readonly delegate: (rel: string) => Reader | null;

  constructor(
    source: ProjectSource | null,
    listed: ReadonlySet<string>,
    delegate: (rel: string) => Reader | null = () => null,
  ) {
    this.source = source;
    this.listed = listed;
    this.delegate = delegate;
  }

  read(rel: string): Promise<Parsed> {
    const other = this.delegate(rel);
    if (other) return other.read(rel);
    let p = this.cache.get(rel);
    if (!p) {
      p = this.load(rel);
      this.cache.set(rel, p);
    }
    return p;
  }

  /** File có trong danh sách của bên này. */
  has(rel: string): boolean {
    return this.listed.has(rel);
  }

  /** File đọc được nhưng không đúng dạng cần (ví dụ `tags` không phải mảng). */
  bad(rel: string): void {
    const other = this.delegate(rel);
    if (other) other.bad(rel);
    else if (this.listed.has(rel)) this.failed.add(rel);
  }

  private async load(rel: string): Promise<Parsed> {
    // Chỉ đọc file có trong danh sách của bên này (đường dẫn lấy từ project.json, có thể sai).
    if (!this.source || !this.listed.has(rel) || !isSafeRelPath(rel)) return { ok: false };
    const r = await this.source.read(rel);
    if (!('text' in r)) {
      this.failed.add(rel);
      return { ok: false };
    }
    try {
      return { ok: true, value: JSON.parse(stripBom(r.text)) };
    } catch {
      this.failed.add(rel);
      return { ok: false };
    }
  }
}

interface Entry {
  kind: Exclude<ObjectKind, 'svg'>;
  key: string;
  file: string;
  value: unknown;
}

/** Một họ đối tượng của một bên; `null`: không đọc được, không so được. */
type Family = { entries: Entry[] } | null;

interface View {
  /** `project.json` có mà không đọc được: không biết cấu trúc của bên này. */
  broken: boolean;
  /** Theo thứ tự: project, Tag, lưu trữ, rồi mỗi màn hình và binding của nó. */
  families: Map<string, Family>;
}

const EMPTY: Family = { entries: [] };

async function readObject(r: Reader, rel: unknown): Promise<Record<string, unknown> | null> {
  if (typeof rel !== 'string') return null;
  const p = await r.read(rel);
  if (!p.ok) return null;
  if (!isObject(p.value)) {
    r.bad(rel);
    return null;
  }
  return p.value;
}

/** Phần tử là đối tượng có khóa chuỗi `key`; khóa trùng thì lấy phần tử đầu. */
function keyed(list: readonly unknown[], key: string): Array<[string, Record<string, unknown>]> {
  const out = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!isObject(item)) continue;
    const k = own(item, key);
    if (typeof k === 'string' && !out.has(k)) out.set(k, item);
  }
  return [...out];
}

/** Mảng con của đối tượng (`tags`, `groups`…); không có thì rỗng, sai kiểu thì `null`. */
function listOf(o: Record<string, unknown>, key: string): unknown[] | null {
  const v = own(o, key);
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : null;
}

async function tagFamily(r: Reader, tagFile: unknown): Promise<Family> {
  const v = await readObject(r, tagFile);
  if (!v) return null;
  const file = tagFile as string;
  const tags = own(v, 'tags');
  if (!Array.isArray(tags)) {
    r.bad(file);
    return null;
  }
  return { entries: keyed(tags, 'id').map(([key, value]) => ({ kind: 'tag', key, file, value })) };
}

/** Kênh và thiết bị trường của `connections.json` (feature 006): khóa là id; thiết bị mang thêm `channel` để thấy việc chuyển kênh. */
async function connectionsFamily(r: Reader, project: Record<string, unknown>): Promise<Family> {
  if (!hasOwn(project, 'connectionFile')) return EMPTY;
  const file = own(project, 'connectionFile');
  const v = await readObject(r, file);
  if (!v) return null;
  const channels = own(v, 'channels');
  if (!Array.isArray(channels)) {
    r.bad(file as string);
    return null;
  }
  const at = file as string;
  const entries: Entry[] = [];
  for (const [id, ch] of keyed(channels, 'id')) {
    entries.push({ kind: 'channel', key: id, file: at, value: omit(ch, ['devices']) });
    const devices = own(ch, 'devices');
    if (Array.isArray(devices))
      for (const [did, d] of keyed(devices, 'id'))
        entries.push({ kind: 'field-device', key: did, file: at, value: { ...d, channel: id } });
  }
  return { entries };
}

/** Bảng giá trị hoặc bảng theo dõi: mỗi bảng một file theo tên trong `project.json`. */
async function tablesFamily(
  r: Reader,
  project: Record<string, unknown>,
  list: 'valueTables' | 'watchTables',
): Promise<Family> {
  const names = own(project, list);
  if (!Array.isArray(names)) return EMPTY;
  const kind = list === 'valueTables' ? 'value-table' : 'watch-table';
  const dir = list === 'valueTables' ? 'value-tables' : 'watch-tables';
  const entries: Entry[] = [];
  for (const name of [...new Set(names.filter((n): n is string => typeof n === 'string'))]) {
    const file = `${dir}/${name}.json`;
    const v = await readObject(r, file);
    if (!v) return null;
    entries.push({ kind, key: name, file, value: v });
  }
  return { entries };
}

async function loggingFamily(r: Reader, project: Record<string, unknown>): Promise<Family> {
  if (!hasOwn(project, 'loggingFile')) return EMPTY; // project không lưu trữ
  const file = own(project, 'loggingFile');
  const v = await readObject(r, file);
  if (!v) return null;
  const groups = listOf(v, 'groups');
  const connections = listOf(v, 'connections');
  if (!groups || !connections) {
    r.bad(file as string);
    return null;
  }
  const at = file as string;
  return {
    entries: [
      {
        kind: 'logging-settings',
        key: 'logging',
        file: at,
        value: omit(v, ['groups', 'connections']),
      },
      ...keyed(groups, 'id').map(([key, value]): Entry => ({
        kind: 'logging-group',
        key,
        file: at,
        value,
      })),
      ...keyed(connections, 'id').map(([key, value]): Entry => ({
        kind: 'logging-connection',
        key,
        file: at,
        value,
      })),
    ],
  };
}

/** `prefix`: `<màn hình>` (0.1, 0.2) hoặc `<màn hình>/<item>` (0.3, mỗi item svg một file binding). */
async function bindingFamily(r: Reader, prefix: string, bindingFile: unknown): Promise<Family> {
  const v = await readObject(r, bindingFile);
  if (!v) return null;
  const file = bindingFile as string;
  const elements = own(v, 'elements');
  if (!Array.isArray(elements)) {
    r.bad(file);
    return null;
  }
  const entries: Entry[] = [];
  for (const [uid, el] of keyed(elements, 'elementUid')) {
    const bindings = own(el, 'bindings');
    if (!Array.isArray(bindings)) continue; // phần tử hỏng: bộ kiểm tra báo
    for (const [id, value] of keyed(bindings, 'id'))
      entries.push({ kind: 'binding', key: `${prefix}/${uid}/${id}`, file, value });
  }
  return { entries };
}

/**
 * Các họ đối tượng của một bên, đọc tuần tự theo cấu trúc trong `project.json` của chính bên đó. Bên không có
 * `project.json` (thiết bị chưa có project) không có đối tượng nào: mọi đối tượng của bên kia là `+` hoặc `-`.
 */
async function viewOf(r: Reader): Promise<View> {
  const families = new Map<string, Family>();
  if (!r.has('project.json')) return { broken: false, families };
  const project = await readObject(r, 'project.json');
  const screens = project ? own(project, 'screens') : undefined;
  if (!project || !Array.isArray(screens)) {
    if (project) r.bad('project.json');
    return { broken: true, families };
  }
  families.set('project', {
    entries: [
      {
        kind: 'project',
        key: 'project',
        file: 'project.json',
        value: omit(project, ['screens', 'navigation']),
      },
    ],
  });
  // Định dạng 0.3: menu điều hướng là đối tượng riêng (không có thì không có đối tượng)
  const nav = own(project, 'navigation');
  families.set(
    'navigation',
    nav === undefined
      ? EMPTY
      : { entries: [{ kind: 'navigation', key: 'navigation', file: 'project.json', value: nav }] },
  );
  families.set('tag', await tagFamily(r, own(project, 'tagFile')));
  families.set('connections', await connectionsFamily(r, project));
  families.set('value-tables', await tablesFamily(r, project, 'valueTables'));
  families.set('watch-tables', await tablesFamily(r, project, 'watchTables'));
  families.set('logging', await loggingFamily(r, project));
  const ids = [...new Set(screens.filter((s): s is string => typeof s === 'string'))];
  for (const id of ids) {
    const file = `screens/${id}.screen.json`;
    const screen = await readObject(r, file);
    const items = screen ? own(screen, 'items') : undefined;
    if (screen && Array.isArray(items)) {
      // Định dạng 0.3: màn hình (không kèm item), mỗi item một đối tượng, mỗi item svg một họ binding
      families.set(`screen:${id}`, {
        entries: [
          { kind: 'screen', key: id, file, value: omit(screen, ['items']) },
          ...keyed(items, 'id').map(([iid, value]): Entry => ({
            kind: 'item',
            key: `${id}/${iid}`,
            file,
            value,
          })),
        ],
      });
      for (const [iid, item] of keyed(items, 'id'))
        if (own(item, 'type') === 'svg')
          families.set(
            `binding:${id}/${iid}`,
            await bindingFamily(r, `${id}/${iid}`, own(item, 'bindingFile')),
          );
      continue;
    }
    families.set(
      `screen:${id}`,
      screen ? { entries: [{ kind: 'screen', key: id, file, value: screen }] } : null,
    );
    families.set(
      `binding:${id}`,
      screen ? await bindingFamily(r, id, own(screen, 'bindingFile')) : null,
    );
  }
  return { broken: false, families };
}

// ---------- So từng trường ----------

/** Tập có khóa trong đối tượng của từng kind: so phần tử theo khóa, không theo vị trí. */
const KEYED: Partial<Record<ObjectKind, ReadonlyMap<string, string>>> = {
  'logging-group': new Map([['/tags', 'tagId']]),
  screen: new Map([['/elements', 'elementUid']]),
  item: new Map([['/elements', 'elementUid']]),
};
const NONE: ReadonlyMap<string, string> = new Map();

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length && keys.every((k) => hasOwn(b, k) && equal(a[k], b[k]))
    );
  }
  return false;
}

/** Map khóa → phần tử; có phần tử không có khóa chuỗi thì `null` (so theo vị trí). */
function keyMap(list: readonly unknown[], key: string): Map<string, unknown> | null {
  const out = new Map<string, unknown>();
  for (const item of list) {
    if (!isObject(item)) return null;
    const k = own(item, key);
    if (typeof k !== 'string') return null;
    if (!out.has(k)) out.set(k, item);
  }
  return out;
}

function diff(
  l: unknown,
  d: unknown,
  path: string,
  keyedAt: ReadonlyMap<string, string>,
  out: FieldDiff[],
): void {
  if (equal(l, d)) return;
  const key = keyedAt.get(path);
  if (key !== undefined && Array.isArray(l) && Array.isArray(d)) {
    const lm = keyMap(l, key);
    const dm = keyMap(d, key);
    if (lm && dm) {
      for (const [k, v] of lm) diff(v, dm.get(k), `${path}/${escape(k)}`, keyedAt, out);
      for (const [k, v] of dm)
        if (!lm.has(k)) diff(undefined, v, `${path}/${escape(k)}`, keyedAt, out);
      return;
    }
  }
  if (isObject(l) && isObject(d)) {
    for (const k of Object.keys(l)) diff(l[k], own(d, k), `${path}/${escape(k)}`, keyedAt, out);
    for (const k of Object.keys(d))
      if (!hasOwn(l, k)) diff(undefined, d[k], `${path}/${escape(k)}`, keyedAt, out);
    return;
  }
  if (Array.isArray(l) && Array.isArray(d) && !(l.every(isScalar) && d.every(isScalar))) {
    const n = Math.max(l.length, d.length);
    for (let i = 0; i < n; i++) diff(l[i], d[i], `${path}/${i}`, keyedAt, out);
    return;
  }
  const f: FieldDiff = { path };
  if (l !== undefined) f.local = l;
  if (d !== undefined) f.device = d;
  out.push(f);
}

const familyKey = (e: Entry) => `${e.kind}\u0000${e.key}`;

function mergeViews(lv: View, dv: View): ObjectDiff[] {
  if (lv.broken || dv.broken) return [];
  const ids = [
    ...lv.families.keys(),
    ...[...dv.families.keys()].filter((k) => !lv.families.has(k)),
  ];
  const out: ObjectDiff[] = [];
  for (const id of ids) {
    const l = lv.families.has(id) ? lv.families.get(id)! : EMPTY;
    const d = dv.families.has(id) ? dv.families.get(id)! : EMPTY;
    if (!l || !d) continue; // một bên không đọc được: bỏ cả họ ở hai bên
    const theirs = new Map(d.entries.map((e) => [familyKey(e), e]));
    for (const e of l.entries) {
      const other = theirs.get(familyKey(e));
      theirs.delete(familyKey(e));
      const fields: FieldDiff[] = [];
      if (other) diff(e.value, other.value, '', KEYED[e.kind] ?? NONE, fields);
      const status: DiffStatus = !other ? '+' : fields.length ? '≠' : '=';
      out.push({ kind: e.kind, key: e.key, file: e.file, status, fields });
    }
    for (const e of theirs.values())
      out.push({ kind: e.kind, key: e.key, file: e.file, status: '-', fields: [] });
  }
  return out;
}

function svgObjects(
  files: readonly FileDiff[],
  local: ReadonlyMap<string, PackageFile>,
  device: ReadonlyMap<string, PackageFile>,
): ObjectDiff[] {
  return files
    .filter((f) => isSvg(f.path))
    .map((f) => {
      const fields: FieldDiff[] = [];
      if (f.status === '≠') {
        fields.push({ path: '/sha256', local: f.localSha256, device: f.deviceSha256 });
        const a = local.get(f.path)?.size;
        const b = device.get(f.path)?.size;
        if (a !== b) fields.push({ path: '/size', local: a, device: b });
      }
      return { kind: 'svg', key: f.path, file: f.path, status: f.status, fields };
    });
}

/** `schemaVersion` của `project.json` ở bên đọc được, hoặc `null`. */
async function schemaVersionOf(r: Reader): Promise<string | null> {
  if (!r.has('project.json')) return null;
  const p = await r.read('project.json');
  if (!p.ok || !isObject(p.value)) return null;
  const v = own(p.value, 'schemaVersion');
  return typeof v === 'string' ? v : null;
}

/**
 * Thiết bị 0.1, máy 0.2: dựng bên thiết bị từ bản nâng cấp trong bộ nhớ. Đọc nội dung mọi file JSON của thiết bị (file `=`
 * lấy từ bên máy, giống từng byte). Không nâng cấp được (file hỏng, lỗi mới) thì `null`: so như thường.
 */
async function migratedDevice(
  localReader: Reader,
  deviceReader: Reader,
  localSource: ProjectSource,
  deviceSource: ProjectSource | null,
  deviceList: ReadonlyMap<string, PackageFile>,
  statusOf: ReadonlyMap<string, DiffStatus>,
): Promise<Reader | null> {
  const lv = await schemaVersionOf(localReader);
  const dv = await schemaVersionOf(deviceReader);
  if (!lv || !dv || !SUPPORTED_SCHEMA_02.test(lv) || !SUPPORTED_SCHEMA.test(dv)) return null;
  const texts: Record<string, string> = {};
  for (const path of deviceList.keys()) {
    if (!isJson(path)) continue;
    const src = statusOf.get(path) === '=' ? localSource : deviceSource;
    if (!src) return null;
    const r = await src.read(path);
    if (!('text' in r)) return null;
    texts[path] = r.text;
  }
  const migrated = await migrate01to02(texts);
  if (!migrated.ok) return null;
  return new Reader(new MemorySource(migrated.files), new Set(Object.keys(migrated.files)));
}

/** So project trên máy với thiết bị (R15). */
export async function compareProjects(
  local: LocalSide,
  device: DeviceSide,
): Promise<CompareResult> {
  const same = local.digest === device.digest;
  const deviceFiles = same ? local.files : await device.files();
  const files = compareFiles(local.files, deviceFiles);
  const statusOf = new Map(files.map((f) => [f.path, f.status]));
  const deviceSource = deviceReads(files).length > 0 ? await device.source() : null;

  const localList = byPath(local.files, 'trên máy');
  const deviceList = byPath(deviceFiles, 'của thiết bị');
  const localReader = new Reader(local.source, new Set(localList.keys()));
  const deviceReader = new Reader(deviceSource, new Set(deviceList.keys()), (rel) =>
    statusOf.get(rel) === '=' ? localReader : null,
  );
  const lv = await viewOf(localReader);
  const migrated = await migratedDevice(
    localReader,
    deviceReader,
    local.source,
    deviceSource,
    deviceList,
    statusOf,
  );
  const dv = await viewOf(migrated ?? deviceReader);

  const rank = (k: ObjectKind) => OBJECT_KINDS.indexOf(k);
  const objects = [...mergeViews(lv, dv), ...svgObjects(files, localList, deviceList)].sort(
    (a, b) => rank(a.kind) - rank(b.kind),
  );
  for (const f of files) {
    if (localReader.failed.has(f.path)) f.unreadable = 'local';
    else if (deviceReader.failed.has(f.path)) f.unreadable = 'device';
  }
  return {
    localDigest: local.digest,
    deviceDigest: device.digest,
    same,
    files,
    objects,
    ...(migrated ? { deviceMigrated: true as const } : {}),
  };
}

// ---------- Tóm tắt cho bước xem trước của Nạp xuống (FR-020) ----------

export interface CompareSummary {
  same: boolean;
  /** Số đối tượng theo ký hiệu. */
  counts: Record<DiffStatus, number>;
  /** Số đối tượng khác theo kind; kind không có gì khác thì không có mục. */
  byKind: Partial<Record<ObjectKind, Record<'≠' | '+' | '-', number>>>;
}

export function summarizeCompare(r: CompareResult): CompareSummary {
  const counts: Record<DiffStatus, number> = { '=': 0, '≠': 0, '+': 0, '-': 0 };
  const byKind: CompareSummary['byKind'] = {};
  for (const o of r.objects) {
    counts[o.status]++;
    if (o.status === '=') continue;
    const k = (byKind[o.kind] ??= { '≠': 0, '+': 0, '-': 0 });
    k[o.status]++;
  }
  return { same: r.same, counts, byKind };
}

/** Ảnh hưởng tới lưu trữ dữ liệu (dòng "Lưu trữ dữ liệu" của bước xem trước, FR-020, feature 003). */
export interface LoggingImpact {
  /** Thiết lập chung của file lưu trữ; `null` khi cả hai bên không lưu trữ. */
  settings: DiffStatus | null;
  /** id nhóm sẽ thêm (chỉ trên máy), sẽ bỏ (chỉ trên thiết bị), sẽ đổi. */
  added: string[];
  removed: string[];
  changed: string[];
  /** Cột mới trong nhóm đã có: Tag thêm vào nhóm, hoặc đổi tên cột (`column`). */
  newColumns: Array<{ group: string; tagId: string }>;
  /** Kết nối DB ngoài. */
  connections: { added: string[]; removed: string[]; changed: string[] };
}

const NEW_COLUMN = /^\/tags\/([^/]+)(\/column)?$/;

export function loggingImpact(r: CompareResult): LoggingImpact {
  const of = (kind: ObjectKind, status: DiffStatus) =>
    r.objects.filter((o) => o.kind === kind && o.status === status).map((o) => o.key);
  const newColumns: LoggingImpact['newColumns'] = [];
  for (const g of r.objects) {
    if (g.kind !== 'logging-group' || g.status !== '≠') continue;
    const seen = new Set<string>();
    for (const f of g.fields) {
      const m = NEW_COLUMN.exec(f.path);
      // `/tags/<id>` chỉ trên máy: Tag thêm vào nhóm. `/tags/<id>/column`: tên cột đổi.
      if (!m || (!m[2] && f.device !== undefined)) continue;
      const tagId = unescape(m[1]);
      if (seen.has(tagId)) continue;
      seen.add(tagId);
      newColumns.push({ group: g.key, tagId });
    }
  }
  return {
    settings: r.objects.find((o) => o.kind === 'logging-settings')?.status ?? null,
    added: of('logging-group', '+'),
    removed: of('logging-group', '-'),
    changed: of('logging-group', '≠'),
    newColumns,
    connections: {
      added: of('logging-connection', '+'),
      removed: of('logging-connection', '-'),
      changed: of('logging-connection', '≠'),
    },
  };
}

/** Ảnh hưởng tới kết nối (dòng "Kết nối" của bước xem trước Nạp xuống, FR-008, feature 006). */
export interface ConnectionsImpact {
  channels: { added: string[]; removed: string[]; changed: string[] };
  devices: { added: string[]; removed: string[]; changed: string[] };
  /**
   * Kênh sẽ kết nối lại khi nạp: kênh thêm mới, hoặc kênh đổi phần cấu hình của chính kênh (địa chỉ, cổng, thông số
   * serial…). Chỉ đổi thiết bị trường thì kênh giữ kết nối; kênh bị bớt thì đóng.
   */
  reconnect: string[];
}

export function connectionsImpact(r: CompareResult): ConnectionsImpact {
  const of = (kind: ObjectKind, status: DiffStatus) =>
    r.objects.filter((o) => o.kind === kind && o.status === status).map((o) => o.key);
  const channels = {
    added: of('channel', '+'),
    removed: of('channel', '-'),
    changed: of('channel', '≠'),
  };
  return {
    channels,
    devices: {
      added: of('field-device', '+'),
      removed: of('field-device', '-'),
      changed: of('field-device', '≠'),
    },
    reconnect: [...channels.added, ...channels.changed],
  };
}
