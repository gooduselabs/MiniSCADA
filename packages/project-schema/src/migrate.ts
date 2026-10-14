// Nâng cấp project 0.1 -> 0.2 (contract project-format-0.2 §9; research R3) và 0.2 -> 0.3 (contract
// project-format-0.3 §8; research R6). Chạy trong bộ nhớ, chỉ ở Studio.
import {
  MIN_RUNTIME_02,
  MIN_RUNTIME_03,
  MIN_RUNTIME_04,
  SUPPORTED_SCHEMA,
  SUPPORTED_SCHEMA_02,
  SUPPORTED_SCHEMA_03,
  SUPPORTED_SCHEMA_04,
} from './codes.ts';
import { formatTagsFile, serialize } from './format-02.ts';
import { formatProject03, formatScreen03 } from './format-03.ts';
import { MIGRATED_SVG_ITEM_ID, legacyScreenTo03 } from './to-screen-model.ts';
import { compareSemver } from './rules.ts';
import { MemorySource, stripBom } from './source.ts';
import { validateProject } from './validate.ts';
import type { TagListV1, TagV1 } from './types-02.ts';

export type MigrateError =
  | { code: 'ALREADY_02' }
  /** Đã là 0.3 (`migrate02to03`, `migrateTo03`). */
  | { code: 'ALREADY_03' }
  /** Đã là 0.4 (`migrate03to04`, `migrateTo04`; feature 008). */
  | { code: 'ALREADY_04' }
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
  | { kind: 'rewrite'; files: string[] }
  /** 0.2 -> 0.3: số màn hình chuyển được, id màn hình có `size` bị kẹp, id màn hình hỏng mang nguyên văn. */
  | { kind: 'screens'; count: number; clamped: string[]; skipped: string[] }
  /** 0.2 -> 0.3: số mục menu `navigation` thêm vào (project có từ 2 màn hình). */
  | { kind: 'navigation'; entries: number };

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
  const list = Array.isArray(tags.tags)
    ? (tags.tags as unknown[]).filter((t): t is Obj => typeof t === 'object' && t !== null)
    : [];
  const doc: TagListV1 = { schemaVersion: '0.2.0', tags: list.map(legacyTag) };
  set(tagFile, formatTagsFile(doc));

  // file chỉ đổi schemaVersion
  const only = [
    project.loggingFile,
    ...(Array.isArray(project.screens) ? (project.screens as string[]) : []).map(
      (id) => `screens/${id}.screen.json`,
    ),
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

// ---------------- 0.2 -> 0.3 ----------------

const SCHEMA_VERSION_02_RE = /("schemaVersion"\s*:\s*")0\.2\.\d+(")/;
const NAV_LABEL_MAX = 40;

/** Cắt nhãn menu tối đa 40 ký tự Unicode (`name` của màn hình dài tới 80). */
const navLabel = (name: string): string => [...name].slice(0, NAV_LABEL_MAX).join('');

/** `binding` 0.2 sang 0.3: đổi `schemaVersion`, thêm `itemId` ngay sau `screenId`; giữ thứ tự khóa còn lại. */
function bindingTo03(b: Obj): Obj {
  const out: Obj = {};
  let placed = false;
  for (const [k, v] of Object.entries(b)) {
    if (k === 'itemId') continue;
    out[k] = k === 'schemaVersion' ? '0.3.0' : v;
    if (k === 'screenId') {
      out.itemId = MIGRATED_SVG_ITEM_ID;
      placed = true;
    }
  }
  if (!placed) {
    const { schemaVersion, ...rest } = out;
    return { schemaVersion, itemId: MIGRATED_SVG_ITEM_ID, ...rest };
  }
  return out;
}

export async function migrate02to03(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_03.test(version)) return { ok: false, error: { code: 'ALREADY_03' } };
  if (!SUPPORTED_SCHEMA_02.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  const before = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_03,
  });
  const originalCodes = new Set(before.errors.map((e) => e.code as string));

  const out: Record<string, string> = { ...files };
  const rewritten: string[] = [];
  const set = (path: string, text: string) => {
    out[path] = text;
    rewritten.push(path);
  };

  // màn hình và binding của chúng
  const ids = Array.isArray(project.screens)
    ? (project.screens as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const names: string[] = [];
  const clamped: string[] = [];
  const skipped: string[] = [];
  let converted = 0;
  for (const id of ids) {
    const path = `screens/${id}.screen.json`;
    const o = parse(files[path]);
    const c = o ? legacyScreenTo03(o) : null;
    if (!o || !c) {
      // tệp hỏng hoặc thiếu: lỗi của bản gốc, mang nguyên văn
      skipped.push(id);
      names.push(id);
      continue;
    }
    converted++;
    names.push(c.model.name);
    if (c.clamped) clamped.push(id);
    set(path, formatScreen03(c.model));
    const bf = o.bindingFile;
    const b = typeof bf === 'string' ? parse(files[bf]) : null;
    if (b && typeof bf === 'string') set(bf, serialize(bindingTo03(b)));
  }

  // tệp chỉ đổi schemaVersion (thay đúng chuỗi, giữ nguyên mọi byte còn lại)
  const only: unknown[] = [
    project.tagFile,
    project.connectionFile,
    project.loggingFile,
    ...(Array.isArray(project.valueTables) ? project.valueTables : []).map(
      (n) => `value-tables/${String(n)}.json`,
    ),
    ...(Array.isArray(project.watchTables) ? project.watchTables : []).map(
      (n) => `watch-tables/${String(n)}.json`,
    ),
  ];
  for (const f of new Set(only)) {
    if (typeof f !== 'string' || files[f] === undefined) continue;
    if (!SCHEMA_VERSION_02_RE.test(files[f]!)) continue;
    set(f, files[f]!.replace(SCHEMA_VERSION_02_RE, '$10.3.0$2'));
  }

  // project.json
  project.schemaVersion = '0.3.0';
  const min = String(project.minRuntimeVersion ?? '0.0.0');
  project.minRuntimeVersion = compareSemver(min, MIN_RUNTIME_03) >= 0 ? min : MIN_RUNTIME_03;
  let navEntries = 0;
  if (ids.length >= 2 && project.navigation === undefined) {
    project.navigation = {
      position: 'left',
      items: ids.map((id, i) => ({ label: navLabel(names[i]!), screen: id })),
    };
    navEntries = ids.length;
  }
  set('project.json', formatProject03(project as never));

  const after = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_03,
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
  changes.push({ kind: 'screens', count: converted, clamped, skipped });
  if (navEntries > 0) changes.push({ kind: 'navigation', entries: navEntries });
  changes.push({ kind: 'minRuntime', version: String(project.minRuntimeVersion) });
  changes.push({ kind: 'rewrite', files: [...new Set(rewritten)].sort() });
  return { ok: true, files: out, changes, backup: [...new Set(rewritten)].sort() };
}

/**
 * Nâng cấp lên 0.3 trong một lần: 0.1 -> 0.2 -> 0.3 (một thư mục sao lưu: hợp các tệp bị ghi ở hai bước),
 * hoặc 0.2 -> 0.3. Đã là 0.3: `ALREADY_03`.
 */
export async function migrateTo03(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (!SUPPORTED_SCHEMA.test(version)) return migrate02to03(files);
  const first = await migrate01to02(files);
  if (!first.ok) return first;
  const second = await migrate02to03(first.files);
  if (!second.ok) return second;
  const hadOriginal = first.changes.some((c) => c.kind === 'originalErrors');
  const backup = [...new Set([...first.backup, ...second.backup])].sort();
  const changes: MigrateChange[] = [
    ...first.changes.filter((c) => c.kind !== 'rewrite' && c.kind !== 'minRuntime'),
    ...second.changes.filter(
      (c) => c.kind !== 'rewrite' && !(c.kind === 'originalErrors' && hadOriginal),
    ),
    { kind: 'rewrite', files: backup },
  ];
  return { ok: true, files: second.files, changes, backup };
}

// ---------------- 0.3 -> 0.4 (feature 008, contract project-format-0.4 §7) ----------------

const SCHEMA_VERSION_03_RE = /("schemaVersion"\s*:\s*")0\.3\.\d+(")/;
const MIN_RUNTIME_RE = /("minRuntimeVersion"\s*:\s*")(\d+\.\d+\.\d+)(")/;

/**
 * Nâng cấp 0.3 -> 0.4: chỉ `schemaVersion` của mọi file JSON (0.3.x -> 0.4.0) và `minRuntimeVersion` của project.json
 * (lên tối thiểu 0.7.0), thay đúng chuỗi, mọi byte khác (kể cả BOM, thứ tự khóa, binding) giữ nguyên. File hỏng hoặc
 * không có `schemaVersion` 0.3.x mang nguyên văn. Lỗi của bản gốc mang sang; không nhận lỗi mới (trừ
 * `E_SCHEMA_VERSION` của file lệch phiên bản đã có từ trước).
 */
export async function migrate03to04(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_04.test(version)) return { ok: false, error: { code: 'ALREADY_04' } };
  if (!SUPPORTED_SCHEMA_03.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  const before = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_04,
  });
  const originalCodes = new Set(before.errors.map((e) => e.code as string));

  const out: Record<string, string> = { ...files };
  const rewritten: string[] = [];
  const names = new Set<unknown>([
    'project.json',
    project.tagFile,
    project.connectionFile,
    project.loggingFile,
    ...(Array.isArray(project.valueTables) ? project.valueTables : []).map(
      (n) => `value-tables/${String(n)}.json`,
    ),
    ...(Array.isArray(project.watchTables) ? project.watchTables : []).map(
      (n) => `watch-tables/${String(n)}.json`,
    ),
  ]);
  const ids = Array.isArray(project.screens)
    ? (project.screens as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  for (const id of ids) {
    const sf = `screens/${id}.screen.json`;
    names.add(sf);
    const s = parse(files[sf]);
    const items = Array.isArray(s?.items) ? (s.items as unknown[]) : [];
    for (const it of items) {
      const o = it as Obj | null;
      if (o && typeof o === 'object' && o.type === 'svg' && typeof o.bindingFile === 'string')
        names.add(o.bindingFile);
    }
  }
  let minRuntime = String(project.minRuntimeVersion ?? '0.0.0');
  for (const f of names) {
    if (typeof f !== 'string' || files[f] === undefined) continue;
    let t = files[f]!;
    if (!SCHEMA_VERSION_03_RE.test(t)) continue;
    t = t.replace(SCHEMA_VERSION_03_RE, '$10.4.0$2');
    if (f === 'project.json') {
      minRuntime = compareSemver(minRuntime, MIN_RUNTIME_04) >= 0 ? minRuntime : MIN_RUNTIME_04;
      t = t.replace(
        MIN_RUNTIME_RE,
        (_m, a: string, _v: string, c: string) => `${a}${minRuntime}${c}`,
      );
    }
    out[f] = t;
    rewritten.push(f);
  }

  const after = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_04,
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
  changes.push({ kind: 'minRuntime', version: minRuntime });
  const backup = [...new Set(rewritten)].sort();
  changes.push({ kind: 'rewrite', files: backup });
  return { ok: true, files: out, changes, backup };
}

/**
 * Nâng cấp lên 0.4 trong một lần: 0.1 hoặc 0.2 qua `migrateTo03` rồi `migrate03to04` (một danh sách sao lưu);
 * 0.3 đi thẳng. Đã là 0.4: `ALREADY_04`.
 */
export async function migrateTo04(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_03.test(version) || SUPPORTED_SCHEMA_04.test(version))
    return migrate03to04(files);
  if (!SUPPORTED_SCHEMA.test(version) && !SUPPORTED_SCHEMA_02.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };
  const first = await migrateTo03(files);
  if (!first.ok) return first;
  const second = await migrate03to04(first.files);
  if (!second.ok) return second;
  const hadOriginal = first.changes.some((c) => c.kind === 'originalErrors');
  const backup = [...new Set([...first.backup, ...second.backup])].sort();
  const changes: MigrateChange[] = [
    ...first.changes.filter((c) => c.kind !== 'rewrite' && c.kind !== 'minRuntime'),
    ...second.changes.filter(
      (c) => c.kind !== 'rewrite' && !(c.kind === 'originalErrors' && hadOriginal),
    ),
    { kind: 'rewrite', files: backup },
  ];
  return { ok: true, files: second.files, changes, backup };
}
