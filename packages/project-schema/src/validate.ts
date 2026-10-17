// Bộ kiểm tra project v0, bản TypeScript (dùng chung Studio, runtime web, CLI).
// Bản C++ ở core/project-manager phải cho cùng tập mã lỗi trên tests/project-vectors (FR-008).
import { Validator, type Schema } from '@cfworker/json-schema';
import bindingSchema from '../../../schemas/0.1/binding.schema.json' with { type: 'json' };
import loggingSchema from '../../../schemas/0.1/logging.schema.json' with { type: 'json' };
import projectSchema from '../../../schemas/0.1/project.schema.json' with { type: 'json' };
import screenSchema from '../../../schemas/0.1/screen.schema.json' with { type: 'json' };
import tagSchema from '../../../schemas/0.1/tag.schema.json' with { type: 'json' };
import bindingSchema02 from '../../../schemas/0.2/binding.schema.json' with { type: 'json' };
import connectionsSchema02 from '../../../schemas/0.2/connections.schema.json' with { type: 'json' };
import loggingSchema02 from '../../../schemas/0.2/logging.schema.json' with { type: 'json' };
import projectSchema02 from '../../../schemas/0.2/project.schema.json' with { type: 'json' };
import screenSchema02 from '../../../schemas/0.2/screen.schema.json' with { type: 'json' };
import tagSchema02 from '../../../schemas/0.2/tag.schema.json' with { type: 'json' };
import valueTableSchema02 from '../../../schemas/0.2/value-table.schema.json' with { type: 'json' };
import watchTableSchema02 from '../../../schemas/0.2/watch-table.schema.json' with { type: 'json' };
import bindingSchema03 from '../../../schemas/0.3/binding.schema.json' with { type: 'json' };
import connectionsSchema03 from '../../../schemas/0.3/connections.schema.json' with { type: 'json' };
import loggingSchema03 from '../../../schemas/0.3/logging.schema.json' with { type: 'json' };
import projectSchema03 from '../../../schemas/0.3/project.schema.json' with { type: 'json' };
import screenSchema03 from '../../../schemas/0.3/screen.schema.json' with { type: 'json' };
import tagSchema03 from '../../../schemas/0.3/tag.schema.json' with { type: 'json' };
import valueTableSchema03 from '../../../schemas/0.3/value-table.schema.json' with { type: 'json' };
import watchTableSchema03 from '../../../schemas/0.3/watch-table.schema.json' with { type: 'json' };
import bindingSchema05 from '../../../schemas/0.5/binding.schema.json' with { type: 'json' };
import connectionsSchema05 from '../../../schemas/0.5/connections.schema.json' with { type: 'json' };
import loggingSchema05 from '../../../schemas/0.5/logging.schema.json' with { type: 'json' };
import projectSchema05 from '../../../schemas/0.5/project.schema.json' with { type: 'json' };
import screenSchema05 from '../../../schemas/0.5/screen.schema.json' with { type: 'json' };
import tagSchema05 from '../../../schemas/0.5/tag.schema.json' with { type: 'json' };
import valueTableSchema05 from '../../../schemas/0.5/value-table.schema.json' with { type: 'json' };
import watchTableSchema05 from '../../../schemas/0.5/watch-table.schema.json' with { type: 'json' };
import bindingSchema04 from '../../../schemas/0.4/binding.schema.json' with { type: 'json' };
import connectionsSchema04 from '../../../schemas/0.4/connections.schema.json' with { type: 'json' };
import loggingSchema04 from '../../../schemas/0.4/logging.schema.json' with { type: 'json' };
import projectSchema04 from '../../../schemas/0.4/project.schema.json' with { type: 'json' };
import screenSchema04 from '../../../schemas/0.4/screen.schema.json' with { type: 'json' };
import tagSchema04 from '../../../schemas/0.4/tag.schema.json' with { type: 'json' };
import valueTableSchema04 from '../../../schemas/0.4/value-table.schema.json' with { type: 'json' };
import watchTableSchema04 from '../../../schemas/0.4/watch-table.schema.json' with { type: 'json' };
import bindingSchema06 from '../../../schemas/0.6/binding.schema.json' with { type: 'json' };
import connectionsSchema06 from '../../../schemas/0.6/connections.schema.json' with { type: 'json' };
import loggingSchema06 from '../../../schemas/0.6/logging.schema.json' with { type: 'json' };
import projectSchema06 from '../../../schemas/0.6/project.schema.json' with { type: 'json' };
import reportsSchema06 from '../../../schemas/0.6/reports.schema.json' with { type: 'json' };
import screenSchema06 from '../../../schemas/0.6/screen.schema.json' with { type: 'json' };
import tagSchema06 from '../../../schemas/0.6/tag.schema.json' with { type: 'json' };
import valueTableSchema06 from '../../../schemas/0.6/value-table.schema.json' with { type: 'json' };
import watchTableSchema06 from '../../../schemas/0.6/watch-table.schema.json' with { type: 'json' };
import bindingSchema10 from '../../../schemas/binding.schema.json' with { type: 'json' };
import connectionsSchema10 from '../../../schemas/connections.schema.json' with { type: 'json' };
import loggingSchema10 from '../../../schemas/logging.schema.json' with { type: 'json' };
import logicSchema10 from '../../../schemas/logic.schema.json' with { type: 'json' };
import projectSchema10 from '../../../schemas/project.schema.json' with { type: 'json' };
import reportsSchema10 from '../../../schemas/reports.schema.json' with { type: 'json' };
import screenSchema10 from '../../../schemas/screen.schema.json' with { type: 'json' };
import tagSchema10 from '../../../schemas/tag.schema.json' with { type: 'json' };
import templateSchema10 from '../../../schemas/template.schema.json' with { type: 'json' };
import valueTableSchema10 from '../../../schemas/value-table.schema.json' with { type: 'json' };
import watchTableSchema10 from '../../../schemas/watch-table.schema.json' with { type: 'json' };
import {
  MAX_FILE_BYTES,
  MAX_JSON_DEPTH,
  MAX_STRING_BYTES,
  RUNTIME_VERSION,
  SUPPORTED_SCHEMA_02,
  SUPPORTED_SCHEMA_03,
  SUPPORTED_SCHEMA_04,
  SUPPORTED_SCHEMA_05,
  SUPPORTED_SCHEMA_06,
  SUPPORTED_SCHEMA_10,
  type ErrorCode,
  type Issue,
} from './codes.ts';
import { findSecretKey, findUrlCredentials } from './logging.ts';
import type { ReportsConfig } from './reports.ts';
import { runRules, type RuleInput } from './rules.ts';
import { runRules02, type Rule02Input } from './rules-02.ts';
import { runRules03, type Rule03Screen } from './rules-03.ts';
import { runRules05 } from './rules-05.ts';
import { runRules10 } from './rules-10.ts';
import type { LoadedProject10, LogicDoc, Project10, TemplateDoc } from './types-10.ts';
import { runRules04 } from './rules-04.ts';
import { svgContentRules, svgTooLargeIssue } from './rules-04-svg.ts';
import type { SerialPolicy } from './serial-allow.ts';
import { isSafeRelPath, stripBom, type ProjectSource } from './source.ts';
import type {
  BindingSet,
  LoadedProject,
  LoggingConfig,
  Project,
  Screen,
  TagList,
} from './types.ts';
import type { BindingSet03, LoadedProject03, Project03, ScreenModel } from './types-03.ts';
import type { LoadedProject05, Project05 } from './types-05.ts';
import type { BindingSet04, LoadedProject04 } from './types-04.ts';
import type {
  BindingSet02,
  ConnectionsConfig,
  LoadedProject02,
  TagListV1,
  ValueTableDoc,
  WatchTableDoc,
} from './types-02.ts';

/**
 * Bảng id → màn hình không có prototype: id màn hình do project đặt (mẫu id cho phép `constructor`), nên tra
 * `screens[id]` trên đối tượng thường trả Object.prototype.constructor (fuzz T058, src/fuzz-regress.test.ts).
 */
const idMap = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export interface ValidationResult {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Có khi không còn lỗi và project là 0.1. */
  project?: LoadedProject;
  /** Có khi không còn lỗi và project là 0.2. */
  project02?: LoadedProject02;
  /** Có khi không còn lỗi và project là 0.3, 0.4 hoặc 0.5 (cùng một đối tượng với `project05` ở 0.5). */
  project03?: LoadedProject03;
  /** Có khi không còn lỗi và project là 0.5: như `project03` cộng `alarms`, `alarmClasses` (nếu khai). */
  project05?: LoadedProject05;
  /** Có khi không còn lỗi và project là 0.4. */
  project04?: LoadedProject04;
  /** Có khi không còn lỗi và project là 1.0 (cùng một đối tượng với `project03`, `project05`). */
  project10?: LoadedProject10;
}

export interface ValidateOptions {
  /** Kiểm `data-mat-uid` trong SVG (cần DOMParser). Mặc định: có khi môi trường có DOMParser. */
  checkSvg?: boolean;
  /** Phiên bản runtime để so `minRuntimeVersion` (E_RUNTIME_TOO_OLD). Mặc định RUNTIME_VERSION. */
  runtimeVersion?: string;
  /** Luật E_SERIAL_NOT_ALLOWED của thiết bị (feature 006); không có thì luật không chạy. */
  serialPolicy?: SerialPolicy;
}

type Kind =
  | 'project'
  | 'tag'
  | 'screen'
  | 'binding'
  | 'logging'
  | 'connections'
  | 'valueTable'
  | 'watchTable'
  /** alarms.json, alarm-classes.json: không qua JSON Schema, luật làm tay ở alarm-rules.ts. */
  | 'alarms'
  | 'alarmClasses'
  | 'reports'
  /** Định dạng 1.0 (feature 011). */
  | 'logic'
  | 'template';
/**
 * Bộ schema theo phiên bản: 0.1 đến 0.5 ở schemas/0.1 .. schemas/0.5 (đóng băng) và 0.6 ở schemas/ (hiện hành: 0.5 của
 * features 008 và 009 cộng lưu trữ nâng cao, báo cáo của feature 010).
 */
type SchemaSet = '0.1' | '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '1.0';
const make = (s: unknown) => new Validator(s as Schema, '7', false);
const validators: Record<SchemaSet, Partial<Record<Kind, Validator>>> = {
  '0.1': {
    project: make(projectSchema),
    tag: make(tagSchema),
    screen: make(screenSchema),
    binding: make(bindingSchema),
    logging: make(loggingSchema),
  },
  '0.2': {
    project: make(projectSchema02),
    tag: make(tagSchema02),
    screen: make(screenSchema02),
    binding: make(bindingSchema02),
    logging: make(loggingSchema02),
    connections: make(connectionsSchema02),
    valueTable: make(valueTableSchema02),
    watchTable: make(watchTableSchema02),
  },
  '0.3': {
    project: make(projectSchema03),
    tag: make(tagSchema03),
    screen: make(screenSchema03),
    binding: make(bindingSchema03),
    logging: make(loggingSchema03),
    connections: make(connectionsSchema03),
    valueTable: make(valueTableSchema03),
    watchTable: make(watchTableSchema03),
  },
  '0.4': {
    project: make(projectSchema04),
    tag: make(tagSchema04),
    screen: make(screenSchema04),
    binding: make(bindingSchema04),
    logging: make(loggingSchema04),
    connections: make(connectionsSchema04),
    valueTable: make(valueTableSchema04),
    watchTable: make(watchTableSchema04),
  },
  '0.5': {
    project: make(projectSchema05),
    tag: make(tagSchema05),
    screen: make(screenSchema05),
    binding: make(bindingSchema05),
    logging: make(loggingSchema05),
    connections: make(connectionsSchema05),
    valueTable: make(valueTableSchema05),
    watchTable: make(watchTableSchema05),
  },
  // Định dạng 0.6 (feature 010): đóng băng ở schemas/0.6/ từ feature 011
  '0.6': {
    project: make(projectSchema06),
    tag: make(tagSchema06),
    screen: make(screenSchema06),
    binding: make(bindingSchema06),
    logging: make(loggingSchema06),
    connections: make(connectionsSchema06),
    valueTable: make(valueTableSchema06),
    watchTable: make(watchTableSchema06),
    reports: make(reportsSchema06),
  },
  // Định dạng 1.0 (feature 011): schemas/ ở gốc (bản đóng băng ở schemas/1.0/)
  '1.0': {
    project: make(projectSchema10),
    tag: make(tagSchema10),
    screen: make(screenSchema10),
    binding: make(bindingSchema10),
    logging: make(loggingSchema10),
    connections: make(connectionsSchema10),
    valueTable: make(valueTableSchema10),
    watchTable: make(watchTableSchema10),
    reports: make(reportsSchema10),
    logic: make(logicSchema10),
    template: make(templateSchema10),
  },
};

/** Trường `expression` của Tag tính toán: giới hạn riêng (E_EXPR_LIMIT), miễn trần 1.024 byte chung. */
const isExpressionPath = (path: string): boolean => /^\/tags\/\d+\/expression$/.test(path);

/** Bộ schema theo `schemaVersion` của project.json: 0.4.x bộ 0.4, 0.3.x bộ 0.3, 0.2.x bộ 0.2, còn lại bộ 0.1. */
async function pickSchemaSet(src: ProjectSource): Promise<SchemaSet> {
  const r = await src.read('project.json');
  if (!('text' in r)) return '0.1';
  try {
    const v = (JSON.parse(stripBom(r.text)) as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof v === 'string' && SUPPORTED_SCHEMA_10.test(v)) return '1.0';
    if (typeof v === 'string' && SUPPORTED_SCHEMA_06.test(v)) return '0.6';
    if (typeof v === 'string' && SUPPORTED_SCHEMA_05.test(v)) return '0.5';
    if (typeof v === 'string' && SUPPORTED_SCHEMA_04.test(v)) return '0.4';
    if (typeof v === 'string' && SUPPORTED_SCHEMA_03.test(v)) return '0.3';
    return typeof v === 'string' && SUPPORTED_SCHEMA_02.test(v) ? '0.2' : '0.1';
  } catch {
    return '0.1';
  }
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Độ sâu lồng [ / { lớn nhất, bỏ qua ký tự nằm trong chuỗi (cùng thuật toán với bản C++). */
export function jsonNestingDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c)
        escaped = true; // \
      else if (c === 0x22) inString = false; // "
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x5b || c === 0x7b) {
      if (++depth > max) max = depth;
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }
  }
  return max;
}

const hasLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    }
  }
  return false;
};

/**
 * Điều JSON.parse cho qua nhưng parser của bản C++ (nlohmann) từ chối khi parse: surrogate UTF-16
 * đứng lẻ (escape `"\ud800"`) và số vượt phạm vi double (`1e400` thành Infinity). Trả mô tả lỗi.
 */
function unparsable(v: unknown): string | null {
  if (typeof v === 'string') return hasLoneSurrogate(v) ? 'surrogate UTF-16 đứng lẻ' : null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'số vượt phạm vi';
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = unparsable(x);
      if (r !== null) return r;
    }
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const r = hasLoneSurrogate(k) ? 'surrogate UTF-16 đứng lẻ' : unparsable(x);
      if (r !== null) return r;
    }
  }
  return null;
}

/**
 * JSON Pointer của chuỗi (khóa hoặc giá trị) đầu tiên dài hơn MAX_STRING_BYTES, hoặc null. `exempt`: đường dẫn
 * của chuỗi được miễn (trường `expression` của 0.2).
 */
function findLongString(v: unknown, path: string, exempt?: (p: string) => boolean): string | null {
  if (typeof v === 'string') {
    if (exempt?.(path)) return null;
    return utf8Length(v) > MAX_STRING_BYTES ? path : null;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findLongString(v[i], `${path}/${i}`, exempt);
      if (r !== null) return r;
    }
    return null;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, child] of Object.entries(v)) {
      const p = `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (utf8Length(k) > MAX_STRING_BYTES) return p;
      const r = findLongString(child, p, exempt);
      if (r !== null) return r;
    }
  }
  return null;
}

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  /** Số byte của từng file đã đọc (alarms.json có trần riêng 512 KiB). */
  bytes = new Map<string, number>();
  add(code: ErrorCode, file: string, path: string, message: string) {
    this.errors.push({ code, file, path, message });
  }
}

/** Đọc + parse JSON + kiểm schema. Trả object nếu đúng schema, ngược lại undefined. */
async function loadJson<T>(
  src: ProjectSource,
  file: string,
  kind: Kind,
  out: Collector,
  set: SchemaSet = '0.1',
): Promise<T | undefined> {
  // Mã lỗi theo bản C++ (contracts/project-format.md): không đọc được (kể cả đường dẫn bị từ chối,
  // symlink ra ngoài) → E_FILE_MISSING; quá lớn hoặc không phải UTF-8 → E_JSON.
  const r = await src.read(file);
  if ('error' in r) {
    if (r.error === 'too-large') out.add('E_JSON', file, '', 'File lớn hơn 1 MB');
    else if (r.error === 'bad-utf8') out.add('E_JSON', file, '', 'File không phải UTF-8 hợp lệ');
    else if (r.error === 'bad-path')
      out.add('E_FILE_MISSING', file, '', `Không đọc được '${file}': đường dẫn bị từ chối`);
    else out.add('E_FILE_MISSING', file, '', `Không tìm thấy file '${file}'`);
    return undefined;
  }
  // Kích thước tính cả BOM (= kích thước file, như bản C++).
  if (utf8Length(r.text) > MAX_FILE_BYTES) {
    out.add('E_JSON', file, '', 'File lớn hơn 1 MB');
    return undefined;
  }
  out.bytes.set(file, utf8Length(r.text));
  const text = stripBom(r.text);
  // Độ sâu được đếm trên văn bản TRƯỚC khi parse: bản C++ (parser đệ quy) cũng làm vậy.
  if (jsonNestingDepth(text) > MAX_JSON_DEPTH) {
    out.add('E_JSON', file, '', `JSON lồng sâu hơn ${MAX_JSON_DEPTH} mức`);
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    out.add('E_JSON', file, '', `JSON không hợp lệ: ${(e as Error).message}`);
    return undefined;
  }
  const bad = unparsable(data);
  if (bad !== null) {
    out.add('E_JSON', file, '', `JSON không hợp lệ: ${bad}`);
    return undefined;
  }
  // Chuỗi quá dài bị chặn trước khi so pattern (std::regex của bản C++ đệ quy theo độ dài).
  const long = findLongString(
    data,
    '',
    kind === 'tag' && set !== '0.1' ? isExpressionPath : undefined,
  );
  if (long !== null) {
    out.add('E_SCHEMA', file, long, `Chuỗi dài hơn ${MAX_STRING_BYTES} byte`);
    return undefined;
  }
  // logging.json: khóa giống bí mật bị từ chối TRƯỚC schema, với mã riêng (contract bước 3).
  if (kind === 'logging') {
    const secret = findSecretKey(data) ?? findUrlCredentials(data);
    if (secret !== null) {
      out.add(
        'E_LOG_SECRET',
        file,
        secret,
        'Không để mật khẩu/token trong project: nhập trên thiết bị bằng mat-runtime --set-secret',
      );
      return undefined;
    }
  }
  const validator = validators[set][kind];
  if (!validator) return data as T; // alarms.json, alarm-classes.json: luật làm tay (alarm-rules.ts)
  const res = validator.validate(data);
  if (!res.valid) {
    // Bỏ lỗi tổng hợp của từ khóa bao ngoài (properties/items/$ref…) khi đã có lỗi chi tiết hơn.
    const leaf = res.errors.filter(
      (e) =>
        !res.errors.some((o) => o !== e && o.keywordLocation.startsWith(e.keywordLocation + '/')),
    );
    const seen = new Set<string>();
    for (const e of leaf.length ? leaf : res.errors) {
      const path = e.instanceLocation.replace(/^#/, '');
      if (seen.has(path)) continue;
      seen.add(path);
      out.add('E_SCHEMA', file, path, e.error);
    }
    return undefined;
  }
  return data as T;
}

export async function validateProject(
  src: ProjectSource,
  opts: ValidateOptions = {},
): Promise<ValidationResult> {
  const set = await pickSchemaSet(src);
  if (set === '0.3' || set === '0.4' || set === '0.5' || set === '0.6' || set === '1.0')
    return validateProject03(src, opts, set);
  if (set === '0.2') return validateProject02(src, opts);
  const out = new Collector();
  const project = await loadJson<Project>(src, 'project.json', 'project', out);

  let tags: TagList | undefined;
  let logging: LoggingConfig | undefined;
  const screens: RuleInput['screens'] = idMap();
  if (project) {
    if (!isSafeRelPath(project.tagFile))
      out.add(
        'E_PATH',
        'project.json',
        '/tagFile',
        `Đường dẫn không an toàn: '${project.tagFile}'`,
      );
    else tags = await loadJson<TagList>(src, project.tagFile, 'tag', out);

    // Feature 003: cùng thứ tự với bản C++ (contracts/logging-config.md).
    if (project.loggingFile !== undefined) {
      if (!isSafeRelPath(project.loggingFile))
        out.add(
          'E_PATH',
          'project.json',
          '/loggingFile',
          `Đường dẫn không an toàn: '${project.loggingFile}'`,
        );
      else logging = await loadJson<LoggingConfig>(src, project.loggingFile, 'logging', out);
    }

    for (const id of project.screens) {
      const file = `screens/${id}.screen.json`;
      const screen = await loadJson<Screen>(src, file, 'screen', out);
      if (!screen) continue;
      let bindings: BindingSet | undefined;
      if (!isSafeRelPath(screen.bindingFile))
        out.add('E_PATH', file, '/bindingFile', `Đường dẫn không an toàn: '${screen.bindingFile}'`);
      else bindings = await loadJson<BindingSet>(src, screen.bindingFile, 'binding', out);
      let svgText: string | null = null;
      if (!isSafeRelPath(screen.svgFile))
        out.add('E_PATH', file, '/svgFile', `Đường dẫn không an toàn: '${screen.svgFile}'`);
      else {
        // Bản C++ chỉ kiểm SVG có tồn tại: SVG quá lớn hoặc không phải UTF-8 không phải lỗi, chỉ
        // không kiểm được data-mat-uid (audit FR-032).
        const svg = await src.read(screen.svgFile);
        if ('text' in svg) svgText = stripBom(svg.text);
        else if (svg.error === 'missing' || svg.error === 'bad-path')
          out.add('E_FILE_MISSING', file, '/svgFile', `Không tìm thấy '${screen.svgFile}'`);
      }
      screens[id] = { file, screen, bindings, svgText };
    }
  }

  const checkSvg = opts.checkSvg ?? typeof DOMParser !== 'undefined';
  if (project) {
    const r = runRules({ project, tags, screens, checkSvg, logging });
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
  }

  const valid = out.errors.length === 0;
  const result: ValidationResult = { valid, errors: out.errors, warnings: out.warnings };
  if (valid && project && tags) {
    const loaded: LoadedProject = { project, tags, screens: idMap() };
    if (logging) loaded.logging = logging;
    for (const [id, s] of Object.entries(screens))
      if (s.bindings) loaded.screens[id] = { screen: s.screen, bindings: s.bindings };
    result.project = loaded;
  }
  return result;
}

/**
 * Project 0.3, 0.4 và 0.5 (contracts/project-format-0.3.md, 0.5.md): luật màn hình ở rules-03.ts như nhau; 0.5 thêm
 * `alarms.json`, `alarm-classes.json` (alarm-rules.ts).
 */
async function validateProject03(
  src: ProjectSource,
  opts: ValidateOptions,
  set: '0.3' | '0.4' | '0.5' | '0.6' | '1.0',
): Promise<ValidationResult> {
  const out = new Collector();
  const project = await loadJson<Project03>(src, 'project.json', 'project', out, set);

  let tags: TagListV1 | undefined;
  let connections: ConnectionsConfig | undefined;
  let logging: LoggingConfig | undefined;
  let reports: ReportsConfig | undefined;
  const valueTables: Rule02Input['valueTables'] = {};
  const watchTables: Rule02Input['watchTables'] = {};
  const screens: Record<string, Rule03Screen> = idMap();
  let alarmsDoc: unknown;
  let alarmClassesDoc: unknown;
  let logic: { file: string; doc: LogicDoc; bytes?: number } | undefined;
  const templates: Array<{ file: string; doc?: TemplateDoc }> = [];
  const unsafe = (file: string, ptr: string, p: string) =>
    out.add('E_PATH', file, ptr, `Đường dẫn không an toàn: '${p}'`);
  if (project) {
    if (!isSafeRelPath(project.tagFile)) unsafe('project.json', '/tagFile', project.tagFile);
    else tags = await loadJson<TagListV1>(src, project.tagFile, 'tag', out, set);

    if (project.connectionFile !== undefined) {
      if (!isSafeRelPath(project.connectionFile))
        unsafe('project.json', '/connectionFile', project.connectionFile);
      else
        connections = await loadJson<ConnectionsConfig>(
          src,
          project.connectionFile,
          'connections',
          out,
          set,
        );
    }
    if (project.loggingFile !== undefined) {
      if (!isSafeRelPath(project.loggingFile))
        unsafe('project.json', '/loggingFile', project.loggingFile);
      else logging = await loadJson<LoggingConfig>(src, project.loggingFile, 'logging', out, set);
    }
    // Định dạng 0.5 trở lên: hai file alarm (khai ở project.json; chỉ đọc, luật ở alarm-rules.ts)
    if (set === '0.5' || set === '0.6' || set === '1.0') {
      const p5 = project as Project05;
      if (p5.alarmFile !== undefined) {
        if (!isSafeRelPath(p5.alarmFile)) unsafe('project.json', '/alarmFile', p5.alarmFile);
        else alarmsDoc = await loadJson<unknown>(src, p5.alarmFile, 'alarms', out, set);
      }
      if (p5.alarmClassFile !== undefined) {
        if (!isSafeRelPath(p5.alarmClassFile))
          unsafe('project.json', '/alarmClassFile', p5.alarmClassFile);
        else
          alarmClassesDoc = await loadJson<unknown>(
            src,
            p5.alarmClassFile,
            'alarmClasses',
            out,
            set,
          );
      }
    }
    if (project.reportsFile !== undefined) {
      if (!isSafeRelPath(project.reportsFile))
        unsafe('project.json', '/reportsFile', project.reportsFile);
      else reports = await loadJson<ReportsConfig>(src, project.reportsFile, 'reports', out, set);
    }
    // Định dạng 1.0 (feature 011): logic.json (chỉ khung; luật E_LOGIC_* ở T135) và template
    if (set === '1.0') {
      const p10 = project as Project10;
      if (p10.logic !== undefined) {
        if (!isSafeRelPath(p10.logic)) unsafe('project.json', '/logic', p10.logic);
        else {
          const doc = await loadJson<LogicDoc>(src, p10.logic, 'logic', out, set);
          const bytes = out.bytes.get(p10.logic);
          if (doc) logic = { file: p10.logic, doc, ...(bytes !== undefined ? { bytes } : {}) };
        }
      }
      for (const [i, file] of (p10.templates ?? []).entries()) {
        if (!isSafeRelPath(file)) {
          unsafe('project.json', `/templates/${i}`, file);
          continue;
        }
        const doc = await loadJson<TemplateDoc>(src, file, 'template', out, set);
        templates.push(doc ? { file, doc } : { file });
      }
    }
    const seenTables = new Set<string>();
    for (const name of project.valueTables ?? []) {
      if (seenTables.has(name.toLowerCase())) continue;
      seenTables.add(name.toLowerCase());
      const file = `value-tables/${name}.json`;
      const doc = await loadJson<ValueTableDoc>(src, file, 'valueTable', out, set);
      if (doc) valueTables[name] = { file, doc };
    }
    const seenWatch = new Set<string>();
    for (const id of project.watchTables ?? []) {
      if (seenWatch.has(id)) continue;
      seenWatch.add(id);
      const file = `watch-tables/${id}.json`;
      const doc = await loadJson<WatchTableDoc>(src, file, 'watchTable', out, set);
      if (doc) watchTables[id] = { file, doc };
    }

    // Mỗi file binding chỉ nạp một lần (hai item chung file là lỗi của luật, không đọc lại).
    const bindingCache = new Map<string, BindingSet03 | undefined>();
    const loaded = new Set<string>();
    for (const id of project.screens) {
      if (loaded.has(id)) continue;
      loaded.add(id);
      const file = `screens/${id}.screen.json`;
      const screen = await loadJson<ScreenModel>(src, file, 'screen', out, set);
      if (!screen) continue;
      const svg: Rule03Screen['svg'] = [];
      for (let i = 0; i < screen.items.length; i++) {
        const item = screen.items[i]!;
        if (item.type !== 'svg') continue;
        let bindings: BindingSet03 | undefined;
        if (!isSafeRelPath(item.bindingFile))
          unsafe(file, `/items/${i}/bindingFile`, item.bindingFile);
        else if (bindingCache.has(item.bindingFile)) bindings = bindingCache.get(item.bindingFile);
        else {
          bindings = await loadJson<BindingSet03>(src, item.bindingFile, 'binding', out, set);
          bindingCache.set(item.bindingFile, bindings);
        }
        let svgText: string | null = null;
        if (!isSafeRelPath(item.svgFile)) unsafe(file, `/items/${i}/svgFile`, item.svgFile);
        else {
          // Như 0.2: chỉ kiểm SVG có tồn tại; SVG quá lớn hoặc không phải UTF-8 chỉ là không kiểm được uid.
          const r = await src.read(item.svgFile);
          if ('text' in r) svgText = stripBom(r.text);
          else if (r.error === 'too-large' && set !== '0.3')
            out.errors.push(svgTooLargeIssue(item.svgFile));
          else if (r.error === 'missing' || r.error === 'bad-path')
            out.add(
              'E_FILE_MISSING',
              file,
              `/items/${i}/svgFile`,
              `Không tìm thấy '${item.svgFile}'`,
            );
        }
        svg[i] = { bindings, svgText };
      }
      screens[id] = { file, screen, svg };
    }
  }

  const checkSvg = opts.checkSvg ?? typeof DOMParser !== 'undefined';
  if (project) {
    const input = {
      project,
      tags,
      connections,
      valueTables,
      watchTables,
      screens,
      checkSvg,
      logging,
      runtimeVersion: opts.runtimeVersion ?? RUNTIME_VERSION,
      schema: set,
      ...(reports ? { reports } : {}),
      ...(opts.serialPolicy ? { serialPolicy: opts.serialPolicy } : {}),
    };
    let r: { errors: Issue[]; warnings: Issue[] };
    const p5 = project as Project05;
    const alarmsBytes =
      p5.alarmFile !== undefined && out.bytes.has(p5.alarmFile)
        ? { alarmsBytes: out.bytes.get(p5.alarmFile)! }
        : {};
    if (set === '1.0')
      r = runRules10({
        ...input,
        project: project as Project10,
        alarmsDoc,
        alarmClassesDoc,
        ...alarmsBytes,
        templates,
        ...(logic ? { logic } : {}),
      });
    else if (set === '0.5' || set === '0.6') {
      r = runRules05({
        ...input,
        project: p5,
        alarmsDoc,
        alarmClassesDoc,
        ...alarmsBytes,
      });
    } else r = set === '0.4' ? runRules04(input) : runRules03(input);
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
    // 0.4: luật theo nội dung SVG (chỉ bản TS; rules-04-svg.ts, T060)
    if (set !== '0.3' && checkSvg) {
      for (const s of Object.values(screens)) {
        s.screen.items.forEach((item, i) => {
          const d = s.svg[i];
          if (item.type !== 'svg' || !d || d.svgText === null) return;
          const sr = svgContentRules({
            svgFile: item.svgFile,
            svgText: d.svgText,
            bindingFile: item.bindingFile,
            ...(d.bindings ? { bindings: d.bindings as unknown as BindingSet04 } : {}),
          });
          out.errors.push(...sr.errors);
          out.warnings.push(...sr.warnings);
        });
      }
    }
  }

  const valid = out.errors.length === 0;
  const result: ValidationResult = { valid, errors: out.errors, warnings: out.warnings };
  if (valid && project && tags) {
    const loadedProject: LoadedProject03 = {
      project,
      tags,
      valueTables: Object.fromEntries(Object.entries(valueTables).map(([k, v]) => [k, v.doc])),
      watchTables: Object.fromEntries(Object.entries(watchTables).map(([k, v]) => [k, v.doc])),
      screens: idMap(),
    };
    if (connections) loadedProject.connections = connections;
    if (logging) loadedProject.logging = logging;
    if (reports) loadedProject.reports = reports;
    for (const [id, s] of Object.entries(screens)) {
      const bindings: LoadedProject03['screens'][string]['bindings'] = {};
      s.screen.items.forEach((item, i) => {
        const b = s.svg[i]?.bindings;
        if (item.type === 'svg' && b) bindings[item.id] = b as BindingSet03;
      });
      loadedProject.screens[id] = { screen: s.screen, bindings };
    }
    if (set === '0.4') result.project04 = loadedProject as unknown as LoadedProject04;
    else result.project03 = loadedProject;
    if (set === '0.5' || set === '0.6' || set === '1.0') {
      const lp5 = loadedProject as unknown as LoadedProject05;
      // đã qua luật: hai file nếu khai là đối tượng đúng cấu trúc
      if (alarmsDoc !== undefined) lp5.alarms = alarmsDoc as LoadedProject05['alarms'];
      if (alarmClassesDoc !== undefined)
        lp5.alarmClasses = alarmClassesDoc as LoadedProject05['alarmClasses'];
      result.project05 = lp5;
    }
    if (set === '1.0') {
      const lp10 = loadedProject as unknown as LoadedProject10;
      if (logic) lp10.logic = logic.doc;
      lp10.templates = Object.fromEntries(
        templates.flatMap((t) => (t.doc ? [[t.file, t.doc] as const] : [])),
      );
      result.project10 = lp10;
    }
  }
  return result;
}

/** Project 0.2 (contracts/project-format-0.2.md). Bộ schema 0.2; luật ở rules-02.ts. */
async function validateProject02(
  src: ProjectSource,
  opts: ValidateOptions,
): Promise<ValidationResult> {
  const out = new Collector();
  const set: SchemaSet = '0.2';
  const project = await loadJson<Project>(src, 'project.json', 'project', out, set);

  let tags: TagListV1 | undefined;
  let connections: ConnectionsConfig | undefined;
  let logging: LoggingConfig | undefined;
  const valueTables: Rule02Input['valueTables'] = {};
  const watchTables: Rule02Input['watchTables'] = {};
  const screens: Rule02Input['screens'] = idMap();
  const unsafe = (file: string, ptr: string, p: string) =>
    out.add('E_PATH', file, ptr, `Đường dẫn không an toàn: '${p}'`);
  if (project) {
    if (!isSafeRelPath(project.tagFile)) unsafe('project.json', '/tagFile', project.tagFile);
    else tags = await loadJson<TagListV1>(src, project.tagFile, 'tag', out, set);

    if (project.connectionFile !== undefined) {
      if (!isSafeRelPath(project.connectionFile))
        unsafe('project.json', '/connectionFile', project.connectionFile);
      else
        connections = await loadJson<ConnectionsConfig>(
          src,
          project.connectionFile,
          'connections',
          out,
          set,
        );
    }
    if (project.loggingFile !== undefined) {
      if (!isSafeRelPath(project.loggingFile))
        unsafe('project.json', '/loggingFile', project.loggingFile);
      else logging = await loadJson<LoggingConfig>(src, project.loggingFile, 'logging', out, set);
    }
    // Tên trùng (không phân biệt hoa thường) chỉ nạp một lần: luật E_DUP_ID báo phần trùng.
    const seenTables = new Set<string>();
    for (const name of project.valueTables ?? []) {
      if (seenTables.has(name.toLowerCase())) continue;
      seenTables.add(name.toLowerCase());
      const file = `value-tables/${name}.json`;
      const doc = await loadJson<ValueTableDoc>(src, file, 'valueTable', out, set);
      if (doc) valueTables[name] = { file, doc };
    }
    const seenWatch = new Set<string>();
    for (const id of project.watchTables ?? []) {
      if (seenWatch.has(id)) continue;
      seenWatch.add(id);
      const file = `watch-tables/${id}.json`;
      const doc = await loadJson<WatchTableDoc>(src, file, 'watchTable', out, set);
      if (doc) watchTables[id] = { file, doc };
    }

    for (const id of project.screens) {
      const file = `screens/${id}.screen.json`;
      const screen = await loadJson<Screen>(src, file, 'screen', out, set);
      if (!screen) continue;
      let bindings: BindingSet02 | undefined;
      if (!isSafeRelPath(screen.bindingFile)) unsafe(file, '/bindingFile', screen.bindingFile);
      else bindings = await loadJson<BindingSet02>(src, screen.bindingFile, 'binding', out, set);
      let svgText: string | null = null;
      if (!isSafeRelPath(screen.svgFile)) unsafe(file, '/svgFile', screen.svgFile);
      else {
        const svg = await src.read(screen.svgFile);
        if ('text' in svg) svgText = stripBom(svg.text);
        else if (svg.error === 'missing' || svg.error === 'bad-path')
          out.add('E_FILE_MISSING', file, '/svgFile', `Không tìm thấy '${screen.svgFile}'`);
      }
      screens[id] = { file, screen, bindings, svgText };
    }
  }

  const checkSvg = opts.checkSvg ?? typeof DOMParser !== 'undefined';
  if (project) {
    const r = runRules02({
      project,
      tags,
      connections,
      valueTables,
      watchTables,
      screens,
      checkSvg,
      logging,
      runtimeVersion: opts.runtimeVersion ?? RUNTIME_VERSION,
      ...(opts.serialPolicy ? { serialPolicy: opts.serialPolicy } : {}),
    });
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
  }

  const valid = out.errors.length === 0;
  const result: ValidationResult = { valid, errors: out.errors, warnings: out.warnings };
  if (valid && project && tags) {
    const loaded: LoadedProject02 = {
      project,
      tags,
      valueTables: Object.fromEntries(Object.entries(valueTables).map(([k, v]) => [k, v.doc])),
      watchTables: Object.fromEntries(Object.entries(watchTables).map(([k, v]) => [k, v.doc])),
      screens: idMap(),
    };
    if (connections) loaded.connections = connections;
    if (logging) loaded.logging = logging;
    for (const [id, s] of Object.entries(screens))
      if (s.bindings) loaded.screens[id] = { screen: s.screen, bindings: s.bindings };
    result.project02 = loaded;
  }
  return result;
}
