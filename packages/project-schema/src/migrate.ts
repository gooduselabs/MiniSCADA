// Nâng cấp project 0.1 -> 0.2 (contract project-format-0.2 §9; research R3) và 0.2 -> 0.3 (contract
// project-format-0.3 §8; research R6). Chạy trong bộ nhớ, chỉ ở Studio.
import {
  MIN_RUNTIME_02,
  MIN_RUNTIME_03,
  MIN_RUNTIME_04,
  MIN_RUNTIME_05,
  MIN_RUNTIME_06,
  MIN_RUNTIME_10,
  SUPPORTED_SCHEMA,
  SUPPORTED_SCHEMA_02,
  SUPPORTED_SCHEMA_03,
  SUPPORTED_SCHEMA_04,
  SUPPORTED_SCHEMA_05,
  SUPPORTED_SCHEMA_06,
  SUPPORTED_SCHEMA_10,
} from './codes.ts';
import { formatTagsFile, serialize } from './format-02.ts';
import { formatProject03, formatScreen03 } from './format-03.ts';
import { MIGRATED_SVG_ITEM_ID, legacyScreenTo03 } from './to-screen-model.ts';
import { compareSemver } from './rules.ts';
import { MemorySource, stripBom } from './source.ts';
import { validateProject } from './validate.ts';
import type { TagListV1, TagV1 } from './types-02.ts';
import { setOwn } from './own.js';

export type MigrateError =
  | { code: 'ALREADY_02' }
  /** Đã là 0.3 (`migrate02to03`, `migrateTo03`). */
  | { code: 'ALREADY_03' }
  /** Đã là 0.4 (`migrate03to04`) hoặc 0.5 (`migrate04to05`, `migrateTo05`). */
  | { code: 'ALREADY_04' }
  | { code: 'ALREADY_05' }
  /** Đã là 0.6 (`migrate05to06`, `migrateTo06`; feature 010). */
  | { code: 'ALREADY_06' }
  /** Đã là 1.0 (`migrate06to10`, `migrateTo10`; feature 011). */
  | { code: 'ALREADY_10' }
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
    setOwn(out, k, k === 'schemaVersion' ? '0.3.0' : v);
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

// ---------------- 0.4 -> 0.5 (feature 009, contract project-format-0.5 §7) ----------------
// 0.5 so với 0.4 chỉ thêm alarm (file alarm tùy chọn), nên `migrate04to05` chỉ đổi `schemaVersion` mọi file và nâng
// `minRuntimeVersion` lên 0.8.0; không tạo file alarm.

const BUMP_MIN_RUNTIME_RE = /("minRuntimeVersion"\s*:\s*")([^"]*)(")/;

interface BumpStep {
  /** Dạng của phiên bản nguồn và đích. */
  from: RegExp;
  fromMinor: string;
  target: RegExp;
  to: string;
  minRuntime: string;
  already: MigrateError;
}

/** Đổi `schemaVersion` mọi file JSON của project sang `to` (thay đúng chuỗi, giữ nguyên các byte còn lại). */
async function bumpFormat(files: Record<string, string>, step: BumpStep): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (step.target.test(version)) return { ok: false, error: step.already };
  if (!step.from.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  const before = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: step.minRuntime,
  });
  const originalCodes = new Set(before.errors.map((e) => e.code as string));

  const out: Record<string, string> = { ...files };
  const rewritten: string[] = [];
  const set = (path: string, text: string) => {
    out[path] = text;
    rewritten.push(path);
  };
  const versionRe = new RegExp(`("schemaVersion"\\s*:\\s*")0\\.${step.fromMinor}\\.\\d+(")`);
  const bump = (text: string): string => text.replace(versionRe, `$1${step.to}$2`);

  const ids = Array.isArray(project.screens)
    ? (project.screens as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const only = new Set<string>();
  for (const f of [
    project.tagFile,
    project.connectionFile,
    project.loggingFile,
    project.alarmFile,
    project.alarmClassFile,
    project.reportsFile,
    ...(Array.isArray(project.valueTables) ? project.valueTables : []).map(
      (n) => `value-tables/${String(n)}.json`,
    ),
    ...(Array.isArray(project.watchTables) ? project.watchTables : []).map(
      (n) => `watch-tables/${String(n)}.json`,
    ),
  ])
    if (typeof f === 'string') only.add(f);
  for (const id of ids) {
    const sf = `screens/${id}.screen.json`;
    only.add(sf);
    const sc = parse(files[sf]);
    for (const item of Array.isArray(sc?.items) ? (sc.items as unknown[]) : [])
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Obj).bindingFile === 'string'
      )
        only.add((item as Obj).bindingFile as string);
  }
  for (const f of only) {
    const text = files[f];
    if (text === undefined || !versionRe.test(text)) continue; // thiếu hoặc hỏng: lỗi của bản gốc, mang sang
    set(f, bump(text));
  }

  // project.json: schemaVersion, minRuntimeVersion (không thêm khóa nào khác)
  let pj = bump(files['project.json']!);
  const m = BUMP_MIN_RUNTIME_RE.exec(pj);
  if (m && compareSemver(m[2]!, step.minRuntime) < 0)
    pj = pj.replace(BUMP_MIN_RUNTIME_RE, `$1${step.minRuntime}$3`);
  set('project.json', pj);
  const newMin = BUMP_MIN_RUNTIME_RE.exec(pj)?.[2] ?? step.minRuntime;

  const after = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: step.minRuntime,
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
  changes.push({ kind: 'minRuntime', version: newMin });
  changes.push({ kind: 'rewrite', files: [...new Set(rewritten)].sort() });
  return { ok: true, files: out, changes, backup: [...new Set(rewritten)].sort() };
}

/** 0.4 -> 0.5 (FR-012): chỉ đổi `schemaVersion` và nâng `minRuntimeVersion` lên 0.8.0; không tạo file alarm. */
export function migrate04to05(files: Record<string, string>): Promise<MigrateResult> {
  return bumpFormat(files, {
    from: SUPPORTED_SCHEMA_04,
    fromMinor: '4',
    target: SUPPORTED_SCHEMA_05,
    to: '0.5.0',
    minRuntime: MIN_RUNTIME_05,
    already: { code: 'ALREADY_05' },
  });
}

/**
 * Nâng cấp lên 0.5 trong một lần (một thư mục sao lưu): 0.1 -> 0.2 -> 0.3 -> 0.4 -> 0.5, hoặc từ 0.2, 0.3, 0.4.
 * Đã là 0.5: `ALREADY_05`.
 */
export async function migrateTo05(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_05.test(version)) return { ok: false, error: { code: 'ALREADY_05' } };
  const steps: Array<(f: Record<string, string>) => Promise<MigrateResult>> = [];
  if (SUPPORTED_SCHEMA.test(version)) steps.push(migrateTo03, migrate03to04, migrate04to05);
  else if (SUPPORTED_SCHEMA_02.test(version))
    steps.push(migrate02to03, migrate03to04, migrate04to05);
  else if (SUPPORTED_SCHEMA_03.test(version)) steps.push(migrate03to04, migrate04to05);
  else if (SUPPORTED_SCHEMA_04.test(version)) steps.push(migrate04to05);
  else return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  let current = files;
  const backup = new Set<string>();
  let changes: MigrateChange[] = [];
  let hadOriginal = false;
  for (const step of steps) {
    const r = await step(current);
    if (!r.ok) return r;
    current = r.files;
    r.backup.forEach((b) => backup.add(b));
    const keep = r.changes.filter(
      (c) => c.kind !== 'rewrite' && !(c.kind === 'originalErrors' && hadOriginal),
    );
    if (r.changes.some((c) => c.kind === 'originalErrors')) hadOriginal = true;
    // chỉ giữ mục `minRuntime` của bước cuối
    changes = [...changes.filter((c) => c.kind !== 'minRuntime'), ...keep];
  }
  const sorted = [...backup].sort();
  return {
    ok: true,
    files: current,
    changes: [...changes, { kind: 'rewrite', files: sorted }],
    backup: sorted,
  };
}

// ---------------- 0.5 -> 0.6 (feature 010) ----------------
// 0.6 so với 0.5 chỉ thêm trường tùy chọn (`reportsFile`, `navigation[].report`, trigger và tổng hợp của logging, widget lịch
// sử), nên `migrate05to06` chỉ đổi `schemaVersion` mọi file (kể cả file alarm) và nâng `minRuntimeVersion` lên 0.9.0.

/** 0.5 -> 0.6: chỉ đổi `schemaVersion` và nâng `minRuntimeVersion` lên 0.9.0; không tạo file nào. */
export function migrate05to06(files: Record<string, string>): Promise<MigrateResult> {
  return bumpFormat(files, {
    from: SUPPORTED_SCHEMA_05,
    fromMinor: '5',
    target: SUPPORTED_SCHEMA_06,
    to: '0.6.0',
    minRuntime: MIN_RUNTIME_06,
    already: { code: 'ALREADY_06' },
  });
}

/** Nâng cấp lên 0.6 trong một lần (một thư mục sao lưu): từ 0.1, 0.2, 0.3, 0.4 hoặc 0.5. Đã là 0.6: `ALREADY_06`. */
export async function migrateTo06(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_06.test(version)) return { ok: false, error: { code: 'ALREADY_06' } };
  if (SUPPORTED_SCHEMA_05.test(version)) return migrate05to06(files);
  const first = await migrateTo05(files);
  if (!first.ok) return first;
  const second = await migrate05to06(first.files);
  if (!second.ok) return second;
  const hadOriginal = first.changes.some((c) => c.kind === 'originalErrors');
  const backup = [...new Set([...first.backup, ...second.backup])].sort();
  return {
    ok: true,
    files: second.files,
    changes: [
      ...first.changes.filter((c) => c.kind !== 'rewrite' && c.kind !== 'minRuntime'),
      ...second.changes.filter(
        (c) => c.kind !== 'rewrite' && !(c.kind === 'originalErrors' && hadOriginal),
      ),
      { kind: 'rewrite', files: backup },
    ],
    backup,
  };
}

// ---------------- 0.6 -> 1.0.0 (feature 011, contracts/project-format-1.0.md §1) ----------------
// 1.0 so với 0.6 chỉ thêm trường tùy chọn (`logic`, `templates`, `tpl`, `params` của popup, `args` của hành động popup),
// nên `migrate06to10` chỉ đổi `schemaVersion` mọi tệp và nâng `minRuntimeVersion` lên 1.0.0; không tạo logic.json hay
// template. Cặp tệp: tests/migration-vectors/0.6-to-1.0.

/** 0.6 -> 1.0.0: chỉ đổi `schemaVersion` và nâng `minRuntimeVersion` lên 1.0.0; không tạo tệp nào. */
export function migrate06to10(files: Record<string, string>): Promise<MigrateResult> {
  return bumpFormat(files, {
    from: SUPPORTED_SCHEMA_06,
    fromMinor: '6',
    target: SUPPORTED_SCHEMA_10,
    to: '1.0.0',
    minRuntime: MIN_RUNTIME_10,
    already: { code: 'ALREADY_10' },
  });
}

/**
 * Nâng cấp lên 1.0.0 trong một lần (một thư mục sao lưu): từ 0.1, 0.2, 0.3, 0.4, 0.5 hoặc 0.6. Đã là 1.0: `ALREADY_10`
 * (không đổi gì); 1.1 trở lên hoặc không nhận ra: `UNSUPPORTED_VERSION`.
 */
export async function migrateTo10(files: Record<string, string>): Promise<MigrateResult> {
  const project = parse(files['project.json']);
  if (!project) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  const version = String(project.schemaVersion ?? '');
  if (SUPPORTED_SCHEMA_10.test(version)) return { ok: false, error: { code: 'ALREADY_10' } };
  if (SUPPORTED_SCHEMA_06.test(version)) return migrate06to10(files);
  const first = await migrateTo06(files);
  if (!first.ok) return first;
  const second = await migrate06to10(first.files);
  if (!second.ok) return second;
  const hadOriginal = first.changes.some((c) => c.kind === 'originalErrors');
  const backup = [...new Set([...first.backup, ...second.backup])].sort();
  return {
    ok: true,
    files: second.files,
    changes: [
      ...first.changes.filter((c) => c.kind !== 'rewrite' && c.kind !== 'minRuntime'),
      ...second.changes.filter(
        (c) => c.kind !== 'rewrite' && !(c.kind === 'originalErrors' && hadOriginal),
      ),
      { kind: 'rewrite', files: backup },
    ],
    backup,
  };
}
