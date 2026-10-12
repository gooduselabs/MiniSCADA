// Nâng cấp project 0.1 -> 0.2 (contract project-format-0.2 §9; research R3). Chạy trong bộ nhớ, chỉ ở Studio.
import { MIN_RUNTIME_02, SUPPORTED_SCHEMA, SUPPORTED_SCHEMA_02 } from './codes.ts';
import { formatTagsFile, serialize } from './format-02.ts';
import { compareSemver } from './rules.ts';
import { MemorySource, stripBom } from './source.ts';
import { validateProject } from './validate.ts';
import type { TagListV1, TagV1 } from './types-02.ts';

export type MigrateError =
  | { code: 'ALREADY_02' }
  /** `schemaVersion` mới hơn mức hiểu (0.3+, 1.x) hoặc không nhận ra: Studio cần bản mới hơn (FR-005). */
  | { code: 'UNSUPPORTED_VERSION'; version: string }
  /** File không đọc được: không đổi gì. */
  | { code: 'UNREADABLE'; file: string }
  /** Bản 0.2 có lỗi mà bản gốc không có: không áp. */
  | { code: 'NEW_ERRORS'; errors: string[] };

export type MigrateChange =
  | { kind: 'originalErrors'; count: number }
  | { kind: 'legacyTags'; count: number }
  | { kind: 'minRuntime'; version: string }
  | { kind: 'rewrite'; files: string[] };

export type MigrateResult =
  | { ok: true; files: Record<string, string>; changes: MigrateChange[]; backup: string[] }
  | { ok: false; error: MigrateError };

type Obj = Record<string, unknown>;
const parse = (text: string | undefined): Obj | null => {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(stripBom(text));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
  } catch {
    return null;
  }
};

/** Khóa của Tag 0.1 mang sang, theo thứ tự chuẩn của 0.2. */
function legacyTag(t: Obj): TagV1 {
  const src = (t.source ?? {}) as Obj;
  const out: Obj = { id: t.id, kind: 'simulation', type: t.type };
  for (const k of ['description', 'unit', 'min', 'max']) if (t[k] !== undefined) out[k] = t[k];
  out.sim = { kind: 'legacy', signal: src.signal };
  return out as unknown as TagV1;
}

export async function migrate01to02(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_02.test(version)) return { ok: false, error: { code: 'ALREADY_02' } };
  if (!SUPPORTED_SCHEMA.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  const before = await validateProject(new MemorySource(files), { checkSvg: false });
  const originalCodes = new Set(before.errors.map((e) => e.code as string));

  const tagFile = String(project.tagFile ?? 'tags.json');
  const tags = parse(files[tagFile]);
  if (!tags) return { ok: false, error: { code: 'UNREADABLE', file: tagFile } };

  const out: Record<string, string> = { ...files };
  const rewritten: string[] = [];
  const set = (path: string, text: string) => {
    out[path] = text;
    rewritten.push(path);
  };

  // project.json: khóa giữ nguyên thứ tự
  project.schemaVersion = '0.2.0';
  const min = String(project.minRuntimeVersion ?? '0.0.0');
  project.minRuntimeVersion = compareSemver(min, MIN_RUNTIME_02) >= 0 ? min : MIN_RUNTIME_02;
  set('project.json', serialize(project));

  // tags.json
  const list = Array.isArray(tags.tags) ? (tags.tags as Obj[]) : [];
  const doc: TagListV1 = { schemaVersion: '0.2.0', tags: list.map(legacyTag) };
  set(tagFile, formatTagsFile(doc));

  // file chỉ đổi schemaVersion
  const only = [
    project.loggingFile,
    ...((project.screens as string[]) ?? []).map((id) => `screens/${id}.screen.json`),
  ];
  for (const f of only) {
    if (typeof f !== 'string') continue;
    const j = parse(files[f]);
    if (!j) continue; // file hỏng/thiếu: lỗi của bản gốc, mang sang
    j.schemaVersion = '0.2.0';
    set(f, serialize(j));
    if (f.startsWith('screens/')) {
      const bf = j.bindingFile;
      const b = typeof bf === 'string' ? parse(files[bf]) : null;
      if (b && typeof bf === 'string') {
        b.schemaVersion = '0.2.0';
        set(bf, serialize(b));
      }
    }
  }

  const after = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: '0.5.0',
  });
  const fresh = [...new Set(after.errors.map((e) => e.code as string))].filter(
    (c) => !originalCodes.has(c),
  );
  if (before.errors.length === 0 && after.errors.length > 0)
    return {
      ok: false,
      error: {
        code: 'NEW_ERRORS',
        errors: [...new Set(after.errors.map((e) => e.code as string))],
      },
    };
  if (before.errors.length > 0 && fresh.length > 0 && !fresh.every((c) => c === 'E_SCHEMA_VERSION'))
    return { ok: false, error: { code: 'NEW_ERRORS', errors: fresh } };

  const changes: MigrateChange[] = [];
  if (before.errors.length > 0)
    changes.push({ kind: 'originalErrors', count: before.errors.length });
  changes.push({ kind: 'legacyTags', count: list.length });
  changes.push({ kind: 'minRuntime', version: String(project.minRuntimeVersion) });
  changes.push({ kind: 'rewrite', files: rewritten.sort() });
  return { ok: true, files: out, changes, backup: rewritten.sort() };
}
