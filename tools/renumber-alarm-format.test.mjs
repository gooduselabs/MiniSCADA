// node --test tools/renumber-alarm-format.test.mjs (T002): mẫu thay đúng; không đụng 0.4.0 của danh mục widget hay của
// 3b, không đụng số của `@mat/ui-components`; --dry-run không ghi; chạy trên cây thật không làm đổi gì ở dry-run.
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renumber, targets } from './renumber-alarm-format.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tool = join(here, 'renumber-alarm-format.mjs');

test('thay đúng các dạng của định dạng alarm', () => {
  const text = [
    '- `schemaVersion` `0.5.0`, `^0\\.5\\.\\d+$`, `0.5.x`',
    '"$id": "https://schemas.atpro.com.vn/mat/alarms/0.5.json",',
    "export const PROJECT_FORMAT_ALARMS = '0.5.0';",
    'constexpr const char* kProjectFormatAlarms = "0.5.0";',
    '{ "live": "1.3.0", "project": ["0.1", "0.4", "0.5"] }',
  ].join('\n');
  const out = renumber(text, '0.5.0', '0.6.0').split('\n');
  strictEqual(out[0], '- `schemaVersion` `0.6.0`, `^0\\.6\\.\\d+$`, `0.6.x`');
  strictEqual(out[1], '"$id": "https://schemas.atpro.com.vn/mat/alarms/0.6.json",');
  strictEqual(out[2], "export const PROJECT_FORMAT_ALARMS = '0.6.0';");
  strictEqual(out[3], 'constexpr const char* kProjectFormatAlarms = "0.6.0";');
  strictEqual(out[4], '{ "live": "1.3.0", "project": ["0.1", "0.4", "0.6"] }');
});

test('không đụng 0.4.0 của danh mục widget hay của 3b, số của ui-components, số lớn hơn', () => {
  const text = [
    'Danh mục widget `widgets.catalog.json` 0.5.0: thêm `alarm-list`',
    '`@mat/ui-components` 0.5.0',
    'catalogVersion 0.5.0',
    'Định dạng 3b là 0.4.0, runtime 0.8.0, Studio 0.7.0',
    'phiên bản 10.5.0 và 0.5.01 và 1.0.5.0 giữ nguyên',
  ].join('\n');
  strictEqual(renumber(text, '0.5.0', '0.6.0'), text);
});

test('--dry-run không ghi tệp; chạy thật ghi đúng các tệp mục tiêu', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-renumber-'));
  try {
    mkdirSync(join(tmp, 'specs/009-alarms'), { recursive: true });
    mkdirSync(join(tmp, 'schemas/0.3'), { recursive: true });
    mkdirSync(join(tmp, 'core/project-manager'), { recursive: true });
    mkdirSync(join(tmp, 'packages/project-schema/src'), { recursive: true });
    writeFileSync(join(tmp, 'specs/009-alarms/a.md'), 'định dạng `0.5.0`\n');
    writeFileSync(join(tmp, 'schemas/alarms.schema.json'), '{ "$id": "x/alarms/0.5.json" }\n');
    writeFileSync(join(tmp, 'schemas/widgets.catalog.json'), '{ "catalogVersion": "0.5.0" }\n');
    writeFileSync(
      join(tmp, 'schemas/0.3/project.schema.json'),
      '{ "$id": "x/project/0.5.json" }\n',
    );
    writeFileSync(
      join(tmp, 'core/project-manager/alarm_rules.hpp'),
      'kProjectFormatAlarms = "0.5.0";\n',
    );
    writeFileSync(
      join(tmp, 'packages/project-schema/src/format-05.ts'),
      "PROJECT_FORMAT_ALARMS = '0.5.0';\n",
    );
    deepStrictEqual(targets(tmp).sort(), [
      'core/project-manager/alarm_rules.hpp',
      'packages/project-schema/src/format-05.ts',
      'schemas/alarms.schema.json',
      'specs/009-alarms/a.md',
    ]);
    const dry = spawnSync(
      process.execPath,
      [tool, '--from', '0.5.0', '--to', '0.6.0', '--dry-run', '--root', tmp],
      { encoding: 'utf8' },
    );
    strictEqual(dry.status, 0);
    ok(dry.stdout.includes('[dry-run] specs/009-alarms/a.md'));
    strictEqual(readFileSync(join(tmp, 'specs/009-alarms/a.md'), 'utf8'), 'định dạng `0.5.0`\n');
    const real = spawnSync(
      process.execPath,
      [tool, '--from', '0.5.0', '--to', '0.6.0', '--root', tmp],
      { encoding: 'utf8' },
    );
    strictEqual(real.status, 0);
    strictEqual(readFileSync(join(tmp, 'specs/009-alarms/a.md'), 'utf8'), 'định dạng `0.6.0`\n');
    strictEqual(
      readFileSync(join(tmp, 'schemas/alarms.schema.json'), 'utf8'),
      '{ "$id": "x/alarms/0.6.json" }\n',
    );
    strictEqual(
      readFileSync(join(tmp, 'schemas/widgets.catalog.json'), 'utf8'),
      '{ "catalogVersion": "0.5.0" }\n',
    );
    strictEqual(
      readFileSync(join(tmp, 'schemas/0.3/project.schema.json'), 'utf8'),
      '{ "$id": "x/project/0.5.json" }\n',
    );
    strictEqual(
      readFileSync(join(tmp, 'core/project-manager/alarm_rules.hpp'), 'utf8'),
      'kProjectFormatAlarms = "0.6.0";\n',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('tham số sai: mã thoát 2; dry-run trên cây thật không ghi gì', () => {
  strictEqual(
    spawnSync(process.execPath, [tool, '--from', '0.5', '--to', '0.6.0'], { encoding: 'utf8' })
      .status,
    2,
  );
  const r = spawnSync(process.execPath, [tool, '--from', '0.5.0', '--to', '0.6.0', '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
  });
  strictEqual(r.status, 0);
  ok(r.stdout.includes('tệp sẽ đổi'));
});
