// Bộ kiểm tra project v0, bản TypeScript (dùng chung Studio, runtime web, CLI).
// Bản C++ ở core/project-manager phải cho cùng tập mã lỗi trên tests/project-vectors (FR-008).
import { Validator, type Schema } from '@cfworker/json-schema';
import bindingSchema from '../../../schemas/binding.schema.json' with { type: 'json' };
import loggingSchema from '../../../schemas/logging.schema.json' with { type: 'json' };
import projectSchema from '../../../schemas/project.schema.json' with { type: 'json' };
import screenSchema from '../../../schemas/screen.schema.json' with { type: 'json' };
import tagSchema from '../../../schemas/tag.schema.json' with { type: 'json' };
import {
  MAX_FILE_BYTES,
  MAX_JSON_DEPTH,
  MAX_STRING_BYTES,
  type ErrorCode,
  type Issue,
} from './codes.ts';
import { findSecretKey, findUrlCredentials } from './logging.ts';
import { runRules, type RuleInput } from './rules.ts';
import { isSafeRelPath, stripBom, type ProjectSource } from './source.ts';
import type {
  BindingSet,
  LoadedProject,
  LoggingConfig,
  Project,
  Screen,
  TagList,
} from './types.ts';

export interface ValidationResult {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Có khi không còn lỗi. */
  project?: LoadedProject;
}

export interface ValidateOptions {
  /** Kiểm `data-mat-uid` trong SVG (cần DOMParser). Mặc định: có khi môi trường có DOMParser. */
  checkSvg?: boolean;
}

type Kind = 'project' | 'tag' | 'screen' | 'binding' | 'logging';
const validators: Record<Kind, Validator> = {
  project: new Validator(projectSchema as unknown as Schema, '7', false),
  tag: new Validator(tagSchema as unknown as Schema, '7', false),
  screen: new Validator(screenSchema as unknown as Schema, '7', false),
  binding: new Validator(bindingSchema as unknown as Schema, '7', false),
  logging: new Validator(loggingSchema as unknown as Schema, '7', false),
};

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

/** JSON Pointer của chuỗi (khóa hoặc giá trị) đầu tiên dài hơn MAX_STRING_BYTES, hoặc null. */
function findLongString(v: unknown, path: string): string | null {
  if (typeof v === 'string') return utf8Length(v) > MAX_STRING_BYTES ? path : null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findLongString(v[i], `${path}/${i}`);
      if (r !== null) return r;
    }
    return null;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, child] of Object.entries(v)) {
      const p = `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      if (utf8Length(k) > MAX_STRING_BYTES) return p;
      const r = findLongString(child, p);
      if (r !== null) return r;
    }
  }
  return null;
}

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
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
  const long = findLongString(data, '');
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
  const res = validators[kind].validate(data);
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
  const out = new Collector();
  const project = await loadJson<Project>(src, 'project.json', 'project', out);

  let tags: TagList | undefined;
  let logging: LoggingConfig | undefined;
  const screens: RuleInput['screens'] = {};
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
    const loaded: LoadedProject = { project, tags, screens: {} };
    if (logging) loaded.logging = logging;
    for (const [id, s] of Object.entries(screens))
      if (s.bindings) loaded.screens[id] = { screen: s.screen, bindings: s.bindings };
    result.project = loaded;
  }
  return result;
}
