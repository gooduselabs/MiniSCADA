// Cấu hình ký của Tauri (feature 011, T093; FR-047; contract release-signing §4; research R15 "Kết quả spike T010"):
// `bundle.windows.signCommand` phải là đối tượng {cmd, args} gọi sign.ps1 với `%1` trơn, đường dẫn tương đối đúng, và
// không có khóa ký nào khác (certificateThumbprint, digestAlgorithm, timestampUrl bị bundler bỏ qua khi có signCommand).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(here, '../../apps/studio/src-tauri');
const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));

test('tauri.conf.json: bundle.windows.signCommand gọi sign.ps1 với %1 trơn', () => {
  const sc = conf.bundle?.windows?.signCommand;
  assert.ok(sc && typeof sc === 'object', 'signCommand dạng đối tượng, không phải chuỗi');
  assert.equal(sc.cmd, 'powershell');
  assert.deepEqual(sc.args, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    '../../../tools/release/sign.ps1',
    '-Path',
    '%1',
  ]);
  for (const a of sc.args)
    assert.doesNotMatch(a, /["'%].*%|%[A-Za-z_]+%/, `không %VAR%/nháy: ${a}`);
  assert.equal(sc.args.filter((a) => a === '%1').length, 1, '%1 là một đối số riêng, đúng một lần');
});

test('signCommand: đường dẫn sign.ps1 tính từ src-tauri trỏ đúng tệp', () => {
  const sc = conf.bundle.windows.signCommand;
  const rel = sc.args[sc.args.indexOf('-File') + 1];
  assert.ok(existsSync(resolve(tauriDir, rel)), `${rel} không tồn tại từ ${tauriDir}`);
});

test('tauri.conf.json: không đặt khóa ký bị bundler bỏ qua (không có bí mật/dấu vân tay trong repo)', () => {
  const w = conf.bundle.windows;
  for (const k of ['certificateThumbprint', 'digestAlgorithm', 'timestampUrl', 'tsp']) {
    assert.ok(!(k in w), `${k} không được đặt trong repo`);
  }
});
