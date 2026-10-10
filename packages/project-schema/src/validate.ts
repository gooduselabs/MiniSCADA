// Bộ kiểm tra project v0, bản TypeScript (dùng chung Studio, runtime web, CLI).
// Bản C++ ở core/project-manager phải cho cùng tập mã lỗi trên tests/project-vectors (FR-008).
import { Validator, type Schema } from '@cfworker/json-schema';
import bindingSchema from '../../../schemas/binding.schema.json' with { type: 'json' };
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
import { runRules, type RuleInput } from './rules.ts';
import { isSafeRelPath, type ProjectSource } from './source.ts';
import type { BindingSet, LoadedProject, Project, Screen, TagList } from './types.ts';

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

type Kind = 'project' | 'tag' | 'screen' | 'binding';
const validators: Record<Kind, Validator> = {
  project: new Validator(projectSchema as unknown as Schema, '7', false),
  tag: new Validator(tagSchema as unknown as Schema, '7', false),
  screen: new Validator(screenSchema as unknown as Schema, '7', false),
  binding: new Validator(bindingSchema as unknown as Schema, '7', false),
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
  const text = await src.readText(file);
  if (text === null) {
    out.add('E_FILE_MISSING', file, '', `Không tìm thấy file '${file}'`);
    return undefined;
  }
  if (utf8Length(text) > MAX_FILE_BYTES) {
    out.add('E_JSON', file, '', 'File lớn hơn 1 MB');
    return undefined;
  }
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
  // Chuỗi quá dài bị chặn trước khi so pattern (std::regex của bản C++ đệ quy theo độ dài).
  const long = findLongString(data, '');
  if (long !== null) {
    out.add('E_SCHEMA', file, long, `Chuỗi dài hơn ${MAX_STRING_BYTES} byte`);
    return undefined;
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
        svgText = await src.readText(screen.svgFile);
        if (svgText === null)
          out.add('E_FILE_MISSING', file, '/svgFile', `Không tìm thấy '${screen.svgFile}'`);
      }
      screens[id] = { file, screen, bindings, svgText };
    }
  }

  const checkSvg = opts.checkSvg ?? typeof DOMParser !== 'undefined';
  if (project) {
    const r = runRules({ project, tags, screens, checkSvg });
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
  }

  const valid = out.errors.length === 0;
  const result: ValidationResult = { valid, errors: out.errors, warnings: out.warnings };
  if (valid && project && tags) {
    const loaded: LoadedProject = { project, tags, screens: {} };
    for (const [id, s] of Object.entries(screens))
      if (s.bindings) loaded.screens[id] = { screen: s.screen, bindings: s.bindings };
    result.project = loaded;
  }
  return result;
}
