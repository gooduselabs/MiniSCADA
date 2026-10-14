// Nâng cấp project 0.3 -> 0.6 (feature 010, T021). Định dạng 0.6 giữ cấu trúc 0.3 và chỉ thêm trường tùy chọn
// (`reportsFile`, `navigation[].report`, trường trigger/tổng hợp của logging), nên nâng cấp chỉ đổi `schemaVersion` của
// mọi file `.json` và nâng `minRuntimeVersion` lên tối thiểu 0.9.0; mọi byte khác giữ nguyên. Chạy trong bộ nhớ, ở Studio.
import { MIN_RUNTIME_06, SUPPORTED_SCHEMA_03, SUPPORTED_SCHEMA_06 } from './codes.ts';
import { migrateTo03, type MigrateResult } from './migrate.ts';
import { compareSemver } from './rules.ts';
import { MemorySource, stripBom } from './source.ts';
import { validateProject } from './validate.ts';

const VERSION_RE = /("schemaVersion"\s*:\s*")0\.3\.\d+(")/;
const MIN_RUNTIME_RE = /("minRuntimeVersion"\s*:\s*")([^"]+)(")/;

function versionOf(text: string | undefined): string | null {
  if (text === undefined) return null;
  try {
    const v = JSON.parse(stripBom(text)) as { schemaVersion?: unknown } | null;
    return v !== null && typeof v === 'object' ? String(v.schemaVersion ?? '') : null;
  } catch {
    return null;
  }
}

export async function migrate03to06(files: Record<string, string>): Promise<MigrateResult> {
  const version = versionOf(files['project.json']);
  if (version === null) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  if (SUPPORTED_SCHEMA_06.test(version)) return { ok: false, error: { code: 'ALREADY_06' } };
  if (!SUPPORTED_SCHEMA_03.test(version))
    return { ok: false, error: { code: 'UNSUPPORTED_VERSION', version } };

  const before = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_06,
  });
  const originalCodes = new Set(before.errors.map((e) => e.code as string));

  const out: Record<string, string> = { ...files };
  const rewritten: string[] = [];
  let minRuntime = MIN_RUNTIME_06;
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.json')) continue;
    let next = text.replace(VERSION_RE, '$10.6.0$2');
    if (path === 'project.json') {
      next = next.replace(MIN_RUNTIME_RE, (m, a: string, v: string, c: string) => {
        if (compareSemver(v, MIN_RUNTIME_06) >= 0) {
          minRuntime = v;
          return m;
        }
        return `${a}${MIN_RUNTIME_06}${c}`;
      });
    }
    if (next !== text) {
      out[path] = next;
      rewritten.push(path);
    }
  }

  const after = await validateProject(new MemorySource(out), {
    checkSvg: false,
    runtimeVersion: MIN_RUNTIME_06,
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

  const backup = [...new Set(rewritten)].sort();
  return {
    ok: true,
    files: out,
    changes: [
      ...(before.errors.length > 0
        ? [{ kind: 'originalErrors' as const, count: before.errors.length }]
        : []),
      { kind: 'minRuntime', version: minRuntime },
      { kind: 'rewrite', files: backup },
    ],
    backup,
  };
}

/** Nâng cấp lên 0.6 trong một lần: 0.1/0.2 đi qua 0.3 (`migrateTo03`), rồi 0.3 -> 0.6. */
export async function migrateTo06(files: Record<string, string>): Promise<MigrateResult> {
  const version = versionOf(files['project.json']);
  if (version === null) return { ok: false, error: { code: 'UNREADABLE', file: 'project.json' } };
  if (SUPPORTED_SCHEMA_03.test(version) || SUPPORTED_SCHEMA_06.test(version) || version === '')
    return migrate03to06(files);
  const first = await migrateTo03(files);
  if (!first.ok) return first;
  const second = await migrate03to06(first.files);
  if (!second.ok) return second;
  const backup = [...new Set([...first.backup, ...second.backup])].sort();
  return {
    ok: true,
    files: second.files,
    changes: [
      ...first.changes.filter((c) => c.kind !== 'rewrite' && c.kind !== 'minRuntime'),
      ...second.changes.filter((c) => c.kind !== 'rewrite'),
      { kind: 'rewrite', files: backup },
    ],
    backup,
  };
}
